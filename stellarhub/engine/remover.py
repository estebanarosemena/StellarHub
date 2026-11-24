"""Program Remover: the real engine (inherited from MiniRevo, in stellarhub/engine/removal) as seen from the UI.

Quick calls (EXPORTS) and long tasks (JOBS, which receive `job`). Tasks report progress with
job.progress(pct, text, **data); the data travels in the UI's 'job' message.
Nothing here deletes anything unless the UI explicitly asks for it (uninstall, remove leftovers, empty).
"""
import csv
import ctypes
import os
import shutil
import subprocess
import threading
import time
import urllib.parse
import webbrowser
import winreg
from ctypes import wintypes

from ..i18n import tc, tr
from .removal import (hunter, index, monitor, paths, quarantine, registry, scanner, settings, system, uninstaller)
from .removal import icons as _icons
from .removal import programs as _pm
from .removal.registry import RegRef

EXPORTS = {"init", "programs", "icons", "details", "quarantine_list", "quarantine_delete", "quarantine_empty",
           "history", "clear_history", "set_settings", "traces", "trace_rename", "trace_delete", "hunter_file",
           "open_path", "open_regedit", "search_web", "export_programs", "forget_scan"}
JOBS = {"background", "scan", "remove", "uninstall", "batch_uninstall", "monitor_start", "monitor_stop",
        "trace_scan", "quarantine_restore", "hunter_window"}

UI_FIELDS = ("id", "name", "version", "publisher", "location", "size", "date", "kind", "kind_label", "source",
             "arch", "user", "protected", "broken", "orphan", "no_uninstaller", "can_quiet", "url",
             "location_inferred", "msi_code", "no_remove")

_progs = {}
_progs_lock = threading.Lock()
_scans = {}              # key -> {"program": p, "items": [...]}
_migrated = False


class _Cancel:
    """The removal engine expects a threading.Event; here cancellation lives in the job."""
    def __init__(self, job):
        self.job = job

    def is_set(self):
        return bool(self.job and self.job.cancelled)

    def set(self):
        if self.job:
            self.job.cancelled = True


def _ui(p):
    return {k: p.get(k) for k in UI_FIELDS}


def _all():
    with _progs_lock:
        return list(_progs.values())


def _get(pid):
    with _progs_lock:
        p = _progs.get(pid)
    if not p:
        if not _progs:
            programs_list()  # the list was lost (e.g. after a reload): rebuild it
            with _progs_lock:
                p = _progs.get(pid)
    if not p:
        raise KeyError(tr("Program not found; refresh the list"))
    return p


def _progress(job, **extra):
    def cb(frac, label=""):
        job.check()
        job.progress(frac, label, **extra)
    return cb


# ------------------------------------------------------------ startup and settings
def _migrate():
    """Once only: what MiniRevo had saved (quarantine, history, traces, caches) moves to StellarHub."""
    global _migrated
    if _migrated:
        return
    _migrated = True
    old = os.path.join(os.environ.get("ProgramData", r"C:\ProgramData"), "MiniRevo")
    new = paths.DATA_DIR
    mark = os.path.join(new, ".migrado")
    if not os.path.isdir(old) or os.path.exists(mark) or os.path.normcase(old) == os.path.normcase(new):
        return
    try:
        os.makedirs(new, exist_ok=True)
        for name in ("quarantine", "monitor", "cache"):
            src, dst = os.path.join(old, name), os.path.join(new, name)
            if os.path.isdir(src) and not os.path.exists(dst):
                shutil.copytree(src, dst)
        for name in ("history.jsonl", "settings.json"):
            src, dst = os.path.join(old, name), os.path.join(new, name)
            if os.path.isfile(src) and not os.path.exists(dst):
                shutil.copy2(src, dst)
        with open(mark, "w", encoding="utf-8") as fh:
            fh.write(time.strftime("%Y-%m-%d %H:%M:%S"))
    except OSError as e:
        print("remover: migration incomplete:", e)


def init():
    _migrate()
    s = settings.load()
    kept = []   # old sessions still waiting for a restart to receive their files: not purged yet
    try:
        purged = quarantine.purge(int(s["quarantine_days"]), kept=kept)
    except Exception:
        purged = 0
    return {"admin": system.is_admin(), "settings": s, "pending_reboot": system.pending_reboot(),
            "quarantine": quarantine.stats(), "purged": purged, "purgeKept": len(kept)}


def set_settings(changes):
    return settings.save(changes or {})


# ------------------------------------------------------------ programs
def programs_list(fresh=False):
    """Win32 right away + Store from the cache; icons that are already cached are included."""
    _migrate()
    win = _pm.get_win32_programs()
    store = _pm.cached_store_apps() if settings.load().get("show_store", True) else []
    with _progs_lock:
        keep = {k: v for k, v in _progs.items() if v.get("source") == "store"}
        _progs.clear()
        _progs.update({p["id"]: p for p in win})
        _progs.update(keep or {p["id"]: p for p in store})
        progs = sorted(_progs.values(), key=lambda p: p["name"].lower())
    out = []
    for p in progs:
        s = _pm.real_size(p, cached_only=True)
        if s:
            p["size"] = s
        d = _ui(p)
        d["icon"] = _icons.get_icon(p, extract=False)
        out.append(d)
    return out


def programs(fresh=False):
    """Public name for the UI: remover.programs()."""
    return programs_list(fresh)


def icons(ids):
    """Real icons (PNG data URI) of the requested programs; extracts the ones not yet cached."""
    out = {}
    for pid in ids or []:
        with _progs_lock:
            p = _progs.get(pid)
        if p:
            ic = _icons.get_icon(p)
            if ic:
                out[pid] = ic
    return out


def background(job):
    """After the list is drawn: missing icons, refreshed Store apps and real sizes.
    Everything reaches the UI in batches through job.progress(..., icons=..., sizes=..., store=...)."""
    if not _progs:
        programs_list()
    # 1. icons
    missing = [p for p in _all() if not _icons.get_icon(p, extract=False)]
    batch = {}
    for n, p in enumerate(missing):
        job.check()
        ic = _icons.get_icon(p)
        if ic:
            batch[p["id"]] = ic
        if len(batch) >= 10:
            job.progress(n / max(1, len(missing)) * .3, tr("Icons"), force=True, icons=batch, sizes={}, store=None)
            batch = {}
    if batch:
        job.progress(.3, tr("Icons"), force=True, icons=batch, sizes={}, store=None)
    threading.Thread(target=index.warm, daemon=True, name="index-warm").start()
    # 2. Store
    if settings.load().get("show_store", True):
        job.check()
        store = _pm.get_store_apps()
        if store:
            _pm.save_store_cache(store)
            with _progs_lock:
                for k in [k for k, v in _progs.items() if v.get("source") == "store"]:
                    del _progs[k]
                for p in store:
                    _progs[p["id"]] = p
            job.progress(.45, "Microsoft Store", force=True, icons={}, sizes={},
                         store=[{**_ui(p), "icon": _icons.get_icon(p, extract=False)} for p in store])
            sb = {}
            for p in store:
                job.check()
                if not _icons.get_icon(p, extract=False):
                    ic = _icons.get_icon(p)
                    if ic:
                        sb[p["id"]] = ic
            if sb:
                job.progress(.5, tr("Store icons"), force=True, icons=sb, sizes={}, store=None)
    # 3. real sizes on disk
    from concurrent.futures import ThreadPoolExecutor, as_completed
    progs = _all()
    sizes, last, done = {}, time.time(), 0
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = {ex.submit(_pm.real_size, p): p for p in progs}
        for fut in as_completed(futs):
            if job.cancelled:
                break
            done += 1
            p = futs[fut]
            try:
                s = fut.result()
            except Exception:
                s = None
            if s and s != p.get("size"):
                p["size"] = s
                sizes[p["id"]] = s
            if sizes and time.time() - last > 0.3:
                job.progress(.5 + .5 * done / max(1, len(progs)), tr("Sizes"), force=True, icons={}, sizes=sizes, store=None)
                sizes, last = {}, time.time()
    _pm.save_size_cache()
    if sizes:
        job.progress(1, tr("Sizes"), force=True, icons={}, sizes=sizes, store=None)
    return True


def details(pid):
    p = _get(pid)
    info = uninstaller.prepare(p)
    key = RegRef.from_str(p["key"]).display() if p.get("key") else ""
    return {**_ui(p), **info, "key_display": key, "package": p.get("package", ""),
            "uninstall_string": p.get("uninstall", ""), "quiet_string": p.get("quiet", "")}


# ------------------------------------------------------------ leftovers
def _scan_into(key, p, level, job, still=None, base=0.0, span=1.0, step=None):
    def prog(frac, label=""):
        job.check()
        # the text is translated; data.label stays in English because the UI compares it with its scan steps
        job.progress(base + span * frac, tc("remover", label), step=step or "scan", label=label)
    res = scanner.scan(p, _all(), level=level, still_installed=still, progress=prog)
    _scans[key] = {"program": p, "items": res["items"]}
    res["key"] = key
    res["program"] = _ui(p)
    return res


def scan(job, pid, level="moderate"):
    """Look for a program's leftovers (without touching anything)."""
    return _scan_into(pid, _get(pid), level, job)


def forget_scan(key):
    _scans.pop(key, None)
    return True


def remove(job, scan_key, item_ids):
    """Remove the chosen leftovers from a scan. By default they go to the quarantine (they can be restored)."""
    sc = _scans.get(scan_key)
    if not sc:
        raise KeyError(tr("The scan has expired; scan again"))
    wanted = set(item_ids or [])
    items = [i for i in sc["items"] if i["id"] in wanted and not i.get("blocked")]
    s = settings.load()
    p = sc["program"]
    # the user's exclusions match by real path too (an exclusion typed through a junction or a short name)
    excl = [f for x in s.get("exclusions", []) for f in paths.forms_cached(x)]
    items = [i for i in items if not (i["kind"] in ("file", "folder") and
                                      any(paths.within_norm(t, e) for t in paths.forms(i["target"]) for e in excl))]
    res = quarantine.remove(p, items, _all(), mode=s["delete_mode"],
                            progress=lambda f, l="": job.progress(f, l))
    settings.log("remove", p.get("name", "?"), {"ok": res["ok"], "failed": res["failed"], "freed": res["freed"],
                                                 "session": res["session"], "mode": s["delete_mode"]})
    _scans.pop(scan_key, None)
    return res


# ------------------------------------------------------------ uninstall
def _step(job, step, status, detail=""):
    job.progress(None, detail or status, force=True, step=step, status=status, detail=detail)


def uninstall(job, pid, opts=None):
    """Restore point -> close the program -> official uninstaller (waiting for all its processes)
    -> leftover scan. Leftovers are NOT deleted here: the UI shows them and the user chooses."""
    opts = opts or {}
    p = _get(pid)
    mode = opts.get("mode", "normal")  # normal | quiet | forced
    level = opts.get("level", settings.load()["default_level"])
    out = {"program": _ui(p), "mode": mode}
    prot = p.get("protected") or {}
    if prot.get("blocked"):
        raise PermissionError(tr("This component is essential to Windows and cannot be uninstalled"))
    if mode == "forced" and prot.get("no_force"):
        raise PermissionError(tr("For safety, this program can only be removed with its official uninstaller"))
    if opts.get("restore_point", True) and p.get("source") != "store":
        _step(job, "restore", "running")
        ok, msg = system.create_restore_point(f"StellarHub: {p['name']}") if system.is_admin() else (
            False, tr("Administrator permissions are needed"))
        _step(job, "restore", "done" if ok else "warn", "" if ok else (msg or "")[-200:])
        out["restore_point"] = ok
    else:
        _step(job, "restore", "skipped")
    job.check()
    _step(job, "close", "running")
    closed = uninstaller.close_processes(p)
    _step(job, "close", "done", ", ".join(closed))
    out["closed"] = closed
    if mode != "forced":
        _step(job, "uninstall", "running")
        r = uninstaller.uninstall(p, quiet=(mode == "quiet"), cancel=_Cancel(job),
                                  on_tick=lambda s, n: _step(job, "uninstall", "running",
                                                                tr("{s} s, 1 process", s=int(s)) if n == 1 else
                                                                tr("{s} s, {n} processes", s=int(s), n=n)))
        out["uninstall"] = r
        if r.get("cancelled"):
            _step(job, "uninstall", "warn", tr("Cancelled"))
            return {**out, "cancelled": True}
        _step(job, "uninstall", "done" if r.get("ok") else "warn",
              "" if r.get("ok") else (tr("The program is still registered") if r.get("still_registered") else r.get("error", "")))
        settings.log("uninstall", p["name"], {"ok": r.get("ok"), "seconds": r.get("seconds"), "mode": mode})
    else:
        _step(job, "uninstall", "skipped")
        settings.log("uninstall", p["name"], {"ok": True, "mode": "forced"})
    _step(job, "scan", "running")
    still = uninstaller.still_registered(p) if mode != "forced" else False
    res = _scan_into(pid, p, level, job, still=still, step="scan")
    n = len(res["items"])
    _step(job, "scan", "done", tr("{n} item", n=n) if n == 1 else tr("{n} items", n=n))
    out["scan"] = res
    out["still_registered"] = still
    return out


def batch_uninstall(job, pids, opts=None):
    opts = opts or {}
    level = opts.get("level", "safe")
    if opts.get("restore_point", True) and system.is_admin():
        _step(job, "restore", "running")
        ok, msg = system.create_restore_point(tr("StellarHub: {n} programs", n=len(pids)))
        _step(job, "restore", "done" if ok else "warn", "" if ok else (msg or "")[-200:])
    results = []
    for n, pid in enumerate(pids):
        if job.cancelled:
            break
        name = str(pid)
        entry = {"program": {"id": pid, "name": name}}
        try:
            p = _get(pid)   # inside the try: one program that is gone from the list must not stop the others
            name = p["name"]
            entry["program"] = _ui(p)
            job.progress(n / max(1, len(pids)), name, force=True, index=n, total=len(pids), pid=pid, status="running")
            if (p.get("protected") or {}).get("blocked"):
                raise PermissionError(tr("Essential Windows component"))
            uninstaller.close_processes(p)
            quiet = bool(opts.get("quiet", True)) and p.get("can_quiet")
            r = uninstaller.uninstall(p, quiet=quiet, cancel=_Cancel(job))
            entry["uninstall"] = r
            still = uninstaller.still_registered(p)
            sc = scanner.scan(p, _all(), level=level, still_installed=still)
            _scans[pid] = {"program": p, "items": sc["items"]}
            sc["key"] = pid
            entry["scan"] = sc
            settings.log("uninstall", p["name"], {"ok": r.get("ok"), "mode": "batch"})
            status = "done" if r.get("ok") else "warn"
        except Exception as e:
            entry["error"] = str(e)
            status = "error"
        results.append(entry)
        job.progress((n + 1) / max(1, len(pids)), name, force=True, index=n, total=len(pids), pid=pid, status=status)
    return {"results": results}


# ------------------------------------------------------------ watched install
def monitor_start(job, name):
    job.progress(.1, tr("Taking the initial snapshot"), force=True)
    return monitor.start(name)


def monitor_stop(job, mid):
    job.progress(.1, tr("Comparing the snapshots"), force=True)
    r = monitor.stop(mid)
    settings.log("watch", (r or {}).get("name") if isinstance(r, dict) else str(mid), {})
    return r


def traces():
    return monitor.traces()


def trace_rename(mid, name):
    monitor.rename(mid, name)
    return True


def trace_delete(mid):
    monitor.delete(mid)
    return True


def trace_scan(job, mid):
    if not _progs:
        programs_list()
    meta = next((t for t in monitor.traces() if t["id"] == mid), {"name": tr("Watched install")})
    items = monitor.trace_items(mid, _all())
    key = f"trace:{mid}"
    _scans[key] = {"program": {"name": meta["name"], "id": key}, "items": items}
    return {"key": key, "items": items, "name": meta["name"],
            "total_size": sum(i.get("size", 0) for i in items if not i["blocked"])}


# ------------------------------------------------------------ quarantine and history
def quarantine_list():
    return quarantine.sessions()


def quarantine_restore(job, sid, only=None):
    r = quarantine.restore(sid, lambda f, l="": job.progress(f, l), only=only)
    settings.log("restore", sid, {"ok": r["ok"], "failed": r["failed"], "partial": bool(only)})
    return r


def quarantine_delete(sid):
    quarantine.delete_session(sid)
    settings.log("delete_session", sid, {})
    return True


def quarantine_empty():
    n, kept = 0, 0
    for s in quarantine.sessions():
        if s.get("waitingRestart"):   # its files only move in at the next restart: deleted now, they would stay put
            kept += 1
            continue
        quarantine.delete_session(s["id"])
        n += s.get("count", 0)
    settings.log("empty", "Quarantine emptied", {"items": n, "kept": kept})
    if kept:   # the rest was emptied; the interface shows this as an error toast
        raise OSError(tr("Restart the PC first: some files are still waiting to be moved to the quarantine"))
    return n


def history():
    return settings.history()


def clear_history():
    settings.clear_history()
    return True


# ------------------------------------------------------------ hunter mode
_u32 = ctypes.windll.user32


def hunter_window(job):
    """Minimize StellarHub, count 3 s and see which window is under the cursor."""
    me = _u32.GetForegroundWindow()
    if me:
        _u32.ShowWindow(me, 6)  # SW_MINIMIZE
    for n in (3, 2, 1):
        job.check()
        job.progress((3 - n) / 3, str(n), force=True, count=n)
        time.sleep(1)
    info = hunter.window_at_cursor()
    if me:
        _u32.ShowWindow(me, 9)  # SW_RESTORE
        _u32.SetForegroundWindow(me)
    if not _progs:
        programs_list()
    if not info or not info.get("path"):
        return {"found": False, "info": info}
    p = hunter.find_program(info["path"], _all())
    return {"found": bool(p), "info": info, "program": _ui(p) if p else None}


class _OFN(ctypes.Structure):
    _fields_ = [("lStructSize", wintypes.DWORD), ("hwndOwner", wintypes.HWND), ("hInstance", wintypes.HINSTANCE),
                ("lpstrFilter", wintypes.LPCWSTR), ("lpstrCustomFilter", wintypes.LPWSTR), ("nMaxCustFilter", wintypes.DWORD),
                ("nFilterIndex", wintypes.DWORD), ("lpstrFile", wintypes.LPWSTR), ("nMaxFile", wintypes.DWORD),
                ("lpstrFileTitle", wintypes.LPWSTR), ("nMaxFileTitle", wintypes.DWORD), ("lpstrInitialDir", wintypes.LPCWSTR),
                ("lpstrTitle", wintypes.LPCWSTR), ("Flags", wintypes.DWORD), ("nFileOffset", wintypes.WORD),
                ("nFileExtension", wintypes.WORD), ("lpstrDefExt", wintypes.LPCWSTR), ("lCustData", wintypes.LPARAM),
                ("lpfnHook", ctypes.c_void_p), ("lpTemplateName", wintypes.LPCWSTR), ("pvReserved", ctypes.c_void_p),
                ("dwReserved", wintypes.DWORD), ("FlagsEx", wintypes.DWORD)]


def _file_dialog(save, title, filt, default="", ext=""):
    """Native Windows dialog (open or save) without depending on the pywebview window."""
    buf = ctypes.create_unicode_buffer(default, 1024)
    ofn = _OFN()
    ofn.lStructSize = ctypes.sizeof(_OFN)
    ofn.hwndOwner = _u32.GetForegroundWindow()
    ofn.lpstrFilter = filt
    ofn.lpstrFile = ctypes.cast(buf, wintypes.LPWSTR)
    ofn.nMaxFile = 1024
    ofn.lpstrTitle = title
    ofn.lpstrDefExt = ext or None
    ofn.Flags = (0x2 | 0x800) if save else (0x1000 | 0x800 | 0x80000)  # OVERWRITEPROMPT|PATHMUSTEXIST / FILEMUSTEXIST|NOCHANGEDIR
    fn = ctypes.windll.comdlg32.GetSaveFileNameW if save else ctypes.windll.comdlg32.GetOpenFileNameW
    return buf.value if fn(ctypes.byref(ofn)) else None


def hunter_file():
    path = _file_dialog(False, tr("Choose a program or shortcut"),
                        tr("Programs and shortcuts") + " (*.exe;*.lnk;*.url)\0*.exe;*.lnk;*.url\0" + tr("All files") +
                        " (*.*)\0*.*\0\0")
    if not path:
        return None
    if not _progs:
        programs_list()
    p = hunter.find_program(path, _all())
    return {"found": bool(p), "info": {"path": hunter.resolve_target(path)}, "program": _ui(p) if p else None}


# ------------------------------------------------------------ helpers
def open_path(path):
    if path and os.path.exists(path):
        subprocess.Popen(["explorer", "/select,", path] if os.path.isfile(path) else ["explorer", path])
        return True
    parent = os.path.dirname(path or "")
    if parent and os.path.isdir(parent):
        subprocess.Popen(["explorer", parent])
        return True
    return False


def open_regedit(display):
    key = (display or "").split("  →  ")[0]
    full = {"HKLM": "HKEY_LOCAL_MACHINE", "HKCU": "HKEY_CURRENT_USER", "HKU": "HKEY_USERS", "HKCR": "HKEY_CLASSES_ROOT"}
    hive, _, rest = key.partition("\\")
    target = f"{full.get(hive, hive)}\\{rest}"
    last = registry.get_value(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Applets\Regedit",
                              "LastKey") or ""
    if "\\HKEY_" in last:
        prefix = last.split("\\HKEY_")[0]
    else:  # regedit names its root after the Windows display language and has not saved one yet
        from ..i18n import windows_language
        prefixes = {"es": "Equipo", "pt": "Computador", "fr": "Ordinateur",
                    "zh": "计算机", "ja": "コンピューター", "ru": "Компьютер"}
        prefix = prefixes.get(windows_language(), "Computer")
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Applets\Regedit") as k:
        winreg.SetValueEx(k, "LastKey", 0, winreg.REG_SZ, f"{prefix}\\{target}")
    subprocess.Popen(["regedit", "/m"])
    return True


def search_web(name):
    webbrowser.open("https://www.google.com/search?q=" + urllib.parse.quote(tr("{name} uninstall", name=name)))
    return True


def export_programs():
    path = _file_dialog(True, tr("Save the program list"), "CSV (*.csv)\0*.csv\0\0",
                        default="programs.csv", ext="csv")
    if not path:
        return None
    if not _progs:
        programs_list()
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow([tr("Name"), tr("Version"), tr("Publisher"), tr("Size (MB)"), tr("Installed"), tr("Type"), tr("Folder")])
        for p in sorted(_all(), key=lambda p: p["name"].lower()):
            w.writerow([p["name"], p.get("version"), p.get("publisher"), round((p.get("size") or 0) / 1048576, 1),
                        p.get("date"), p.get("kind_label"), p.get("location")])
    return path
