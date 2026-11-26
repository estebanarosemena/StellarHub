"""Safe removal with a restorable quarantine.

Every removal creates a session in <data>\\quarantine\\<id> with:
  manifest.json  - what was removed, from where and how to put it back
  files\\         - moved files and folders
  reg\\           - .reg backups of keys and services
  tasks\\         - XML of scheduled tasks
Safety is checked again item by item right before touching anything.
"""
import base64
import ctypes
import datetime
import json
import os
import re
import shutil
import stat
import sys
import time
import winreg

from ...i18n import tr
from . import index, paths, registry, safety, system
from .paths import is_within, norm_path
from .registry import RegRef

ORDER = {"service": 0, "task": 1, "fwrule": 2, "regvalue": 3, "regkey": 4, "envpath": 5, "file": 6, "folder": 7}


def qroot():
    return paths.data_path("quarantine")


def _session_dir(sid):
    return os.path.join(qroot(), sid)


def _save(manifest):
    d = _session_dir(manifest["id"])
    os.makedirs(d, exist_ok=True)
    tmp = os.path.join(d, "manifest.json.tmp")
    for attempt in range(5):  # the antivirus may hold the file open for a moment
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(manifest, f, ensure_ascii=False, indent=1)
            os.replace(tmp, os.path.join(d, "manifest.json"))
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.1 * (attempt + 1))


def _slug(s):
    return re.sub(r"[^A-Za-z0-9]+", "-", s or "x").strip("-")[:30] or "x"


# ---------------------------------------------------------------- file helpers
def _make_writable(func, path, exc):
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except Exception:
        raise exc[1] if isinstance(exc, tuple) else exc


def _rmtree(path, tries=6):
    """Antivirus and the search indexer briefly open files that were just written, so Windows can answer "directory
    not empty" or "in use" for a moment: try again a few times before giving up."""
    import time
    for i in range(tries):
        try:
            shutil.rmtree(path, **({"onexc" if sys.version_info >= (3, 12) else "onerror": _make_writable}))
            return
        except FileNotFoundError:
            return
        except OSError:
            if i == tries - 1 or not os.path.exists(path):
                if os.path.exists(path):
                    raise
                return
            time.sleep(0.15 * (i + 1))


def _move_on_reboot(src, dst):
    """Schedule a MOVE of src to dst at the next restart (needs admin, same volume): the file stays recoverable."""
    try:
        # MOVEFILE_DELAY_UNTIL_REBOOT | MOVEFILE_REPLACE_EXISTING
        return bool(ctypes.windll.kernel32.MoveFileExW(str(src), str(dst), 0x4 | 0x1))
    except Exception:
        return False


def _same_volume(a, b):
    da, db = os.path.splitdrive(os.path.abspath(a))[0].lower(), os.path.splitdrive(os.path.abspath(b))[0].lower()
    return bool(da) and da == db


def _locked_file(src, dst, result):
    """A file that can be neither moved nor copied now (in use). Returns True if something was scheduled.

    Same volume as the quarantine: a delayed MOVE into it, so the file is still restorable after the restart.
    Another volume: a delayed DELETE; that file cannot be restored, and the item says so. Either way the
    operation acts on the PATH at the next restart, so the program must not be reinstalled before restarting.
    """
    if _same_volume(src, dst) and _move_on_reboot(src, dst):
        result["reboot"] += 1
        result["_pending"].append([src, dst])
        return True
    if system.delete_on_reboot(src):
        result["reboot"] += 1
        result["reboot_unrestorable"] += 1
        return True
    return False


def _move_tree(src, dst, result):
    """Move src to dst. If something is locked, move what it can and schedule the rest for reboot."""
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try:
        if _same_volume(src, dst):
            os.replace(src, dst)
        else:
            shutil.move(src, dst)
        return
    except OSError:
        pass
    if os.path.isfile(src):
        try:
            shutil.copy2(src, dst)
            os.remove(src)
        except OSError:
            try:
                if os.path.lexists(dst):
                    os.remove(dst)       # half-copied
            except OSError:
                pass
            if not _locked_file(src, dst, result):
                raise
        return
    # folder with files in use: file by file. Links/junctions are moved (or removed) as links, never entered.
    for dp, files, dirs, links in paths.walk_nolinks(src):
        rel = os.path.relpath(dp, src)
        tdir = os.path.join(dst, rel) if rel != "." else dst
        os.makedirs(tdir, exist_ok=True)
        for f in files:
            t = os.path.join(tdir, os.path.basename(f))
            try:
                os.replace(f, t)
            except OSError:
                try:
                    shutil.copy2(f, t)
                    os.remove(f)
                except OSError:
                    try:
                        if os.path.lexists(t):
                            os.remove(t)     # the copy of a file that stays: one place only (restore would clash)
                    except OSError:
                        pass
                    if not _locked_file(f, t, result):
                        _left_behind(f, result)
        for lk in links:
            try:
                os.replace(lk, os.path.join(tdir, os.path.basename(lk)))
            except OSError:
                try:
                    paths.remove_link(lk)
                except OSError:
                    pass
    _remove_empty_dirs(src, result)


def _left_behind(f, result):
    """A file of a folder that could be neither moved (or deleted) nor scheduled for the restart (in use, and no
    administrator rights): it stays where it was. Counted, so the item does not claim it is gone."""
    result["_left"] = result.get("_left", 0) + 1
    try:
        result["_left_bytes"] = result.get("_left_bytes", 0) + os.path.getsize(f)
    except OSError:
        pass


def _merge_back(stored, target):
    """Puts the files and links of a stored folder back into `target`, which still exists because some of its files
    stayed (in use when it was removed). Nothing in `target` is replaced: a name that exists there again is an error,
    and that file stays in the quarantine."""
    clash = 0
    for dp, files, dirs, links in paths.walk_nolinks(stored):
        rel = os.path.relpath(dp, stored)
        tdir = target if rel == "." else os.path.join(target, rel)
        for f in files + links:
            t = os.path.join(tdir, os.path.basename(f))
            if os.path.lexists(t):
                clash += 1
                continue
            _real_move(f, t)
        if not clash:
            try:
                os.rmdir(dp)
            except OSError:
                pass
    if clash:
        raise OSError(tr("Something already exists at the original path"))


def _remove_empty_dirs(root, result):
    """rmdir every folder under root (deepest first, never entering links); what stays goes at reboot."""
    for dp, files, dirs, links in paths.walk_nolinks(root):
        try:
            os.rmdir(dp)
        except OSError:
            if system.delete_on_reboot(dp):
                result["reboot"] += 1


def _delete_tree(path, result):
    if os.path.isdir(path):
        try:
            _rmtree(path)
            return
        except OSError:
            pass
        for dp, files, dirs, links in paths.walk_nolinks(path):
            for lk in links:            # the link itself; what it points to is never touched
                try:
                    paths.remove_link(lk)
                except OSError:
                    pass
            for fp in files:
                try:
                    os.chmod(fp, stat.S_IWRITE)
                    os.remove(fp)
                except OSError:
                    if system.delete_on_reboot(fp):
                        result["reboot"] += 1
                    else:
                        _left_behind(fp, result)
        _remove_empty_dirs(path, result)
    else:
        try:
            os.chmod(path, stat.S_IWRITE)
            os.remove(path)
        except OSError:
            if system.delete_on_reboot(path):
                result["reboot"] += 1
            else:
                raise


def _real_move(src, dst):
    """Move back to its place. With the Store Python, AppData is virtualized: a child process is used."""
    os.makedirs(os.path.dirname(dst), exist_ok=True) if not paths.running_packaged() else None
    if paths.running_packaged():
        # Windows PowerShell's Move-Item can't find an 8.3 path ("No object exists at C:\Users\JOHNSM~1"): a leftover
        # found through a short %TEMP%, or a short data folder, failed to restore. Long names (the part that exists).
        src, dst = paths._long_name(src), paths._long_name(dst)
        ps_src, ps_dst = src.replace("'", "''"), dst.replace("'", "''")
        code, out = system.powershell(
            f"New-Item -ItemType Directory -Force -Path (Split-Path -LiteralPath '{ps_dst}') | Out-Null; "
            f"Move-Item -LiteralPath '{ps_src}' -Destination '{ps_dst}' -Force -ErrorAction Stop")
        if code != 0:
            raise OSError(out.strip()[:300])
        return
    if os.path.splitdrive(src)[0].lower() == os.path.splitdrive(dst)[0].lower():
        os.replace(src, dst)
    else:
        shutil.move(src, dst)


# ---------------------------------------------------------------- registry values
def _pack_value(data, typ):
    if isinstance(data, bytes):
        return {"b64": base64.b64encode(data).decode(), "type": typ}
    return {"v": data, "type": typ}


def _unpack_value(d):
    return (base64.b64decode(d["b64"]) if "b64" in d else d["v"]), d["type"]


# ---------------------------------------------------------------- remove
def remove(program, items, programs=(), mode="quarantine", progress=None):
    """Remove the items (scanner dicts). Return the summary."""
    progress = progress or (lambda *a: None)
    base = datetime.datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + _slug(program.get("name"))
    # unique session: two removals of the same program in the same second must not share a folder
    # (the second would overwrite the manifest and the first one could no longer be restored)
    sid, n = base, 1
    while True:
        try:
            os.makedirs(_session_dir(sid))
            break
        except FileExistsError:
            n += 1
            sid = f"{base}-{n}"
    sdir = _session_dir(sid)
    manifest = {"id": sid, "program": program.get("name"), "publisher": program.get("publisher", ""),
                "created": time.time(), "mode": mode, "items": []}
    ctx = safety.Context(target=program, programs=programs)
    # reboot: files/folders left for the next restart. reboot_unrestorable: those deleted (not moved) at restart.
    result = {"ok": 0, "failed": 0, "skipped": 0, "reboot": 0, "reboot_unrestorable": 0, "freed": 0, "errors": [],
              "session": sid, "_pending": []}
    items = sorted(items, key=lambda i: ORDER.get(i["kind"], 9))
    fw_batch = []
    for n, it in enumerate(items):
        progress(n / max(len(items), 1), it.get("display", it["target"])[:80])
        rec = {"kind": it["kind"], "target": it["target"], "display": it.get("display", it["target"]),
               "status": "pending"}
        manifest["items"].append(rec)
        try:
            blocked = _recheck(it, ctx)
            if blocked:
                rec.update(status="skipped", error=tr("Blocked for safety: {reason}", reason=blocked))
                result["skipped"] += 1
                continue
            k = it["kind"]
            if k in ("file", "folder"):
                _do_path(it, rec, sdir, n, mode, result)
            elif k == "regkey":
                ref = RegRef.from_str(it["target"])
                if not registry.key_exists(ref):
                    rec["status"] = "gone"
                    continue
                regf = os.path.join(sdir, "reg", f"{n}.reg")
                if not registry.export_key(ref, regf):
                    raise OSError(tr("Could not make the .reg backup; not deleting for safety"))
                rec.update(reg_file=regf, view=ref.view)
                registry.delete_tree(ref)
            elif k == "regvalue":
                ref = RegRef.from_str(it["target"])
                cur = registry.read_value_full(ref)
                if cur is None:
                    rec["status"] = "gone"
                    continue
                rec["value"] = _pack_value(*cur)
                registry.delete_value(ref)
            elif k == "service":
                regf = os.path.join(sdir, "reg", f"{n}.reg")
                svc = RegRef("HKLM", rf"SYSTEM\CurrentControlSet\Services\{it['target']}")
                if not registry.export_key(svc, regf) and registry.key_exists(svc):
                    # like a registry key: a service is never deleted without the backup that can bring it back
                    raise OSError(tr("Could not make the .reg backup; not deleting for safety"))
                rec["reg_file"] = regf
                code, out = system.delete_service(it["target"])
                if code not in (0, 1060):  # 1060 = no longer exists
                    raise OSError(out.strip()[:200])
            elif k == "task":
                xml = system.export_task(it["target"])
                if not xml:
                    # no copy of the task means no undo: it is not deleted (a task that is already gone fails here too,
                    # as the delete below would)
                    raise OSError(tr("Nothing was changed: the backup couldn't be saved ({error}).",
                                     error="schtasks /Query /XML"))
                tf = os.path.join(sdir, "tasks", f"{n}.xml")
                os.makedirs(os.path.dirname(tf), exist_ok=True)
                with open(tf, "w", encoding="utf-16") as f:
                    f.write(xml)
                rec["task_file"] = tf
                code, out = system.delete_task(it["target"])
                if code != 0:
                    raise OSError(out.strip()[:200])
            elif k == "fwrule":
                rec["fw_data"] = it.get("fw_data", "")
                fw_batch.append((it["target"], rec))
                continue  # applied in one go at the end
            elif k == "envpath":
                _do_envpath(it, rec)
            if rec["status"] == "pending":
                rec["status"] = "done"
            result["ok"] += 1
        except Exception as e:
            rec.update(status="failed", error=str(e)[:300])
            result["failed"] += 1
            result["errors"].append(f"{rec['display'][:90]}: {str(e)[:160]}")
        finally:
            _save(manifest)
    if fw_batch:
        names = ",".join("'" + n.replace("'", "''") + "'" for n, _ in fw_batch)
        code, out = system.powershell(f"Remove-NetFirewallRule -Name {names} -ErrorAction SilentlyContinue; "
                                      f"exit 0")
        fw = r"SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters\FirewallPolicy\FirewallRules"
        for name, rec in fw_batch:
            ref = RegRef("HKLM", fw, 0, name)
            if registry.value_exists(ref):
                try:
                    registry.delete_value(ref)
                except OSError as e:
                    rec.update(status="failed", error=str(e))
                    result["failed"] += 1
                    continue
            rec["status"] = "done"
            result["ok"] += 1
        _save(manifest)
    for k in ("_pending", "_left", "_left_bytes"):
        result.pop(k, None)
    result["restart_required"] = result["reboot"] > 0
    manifest["result"] = {k: v for k, v in result.items() if k != "errors"}
    _save(manifest)
    index.invalidate()
    progress(1.0, tr("Done"))
    return result


def _recheck(it, ctx):
    k = it["kind"]
    if k in ("file", "folder"):
        if not os.path.lexists(it["target"]):
            return None
        return ctx.check_path(it["target"])[0]
    if k in ("regkey", "regvalue"):
        return safety.reg_rule(RegRef.from_str(it["target"]))
    if k == "service":
        return safety.service_rule(it["target"])
    if k == "task" and it["target"].lower().startswith("\\microsoft\\"):
        return tr("Microsoft task")
    return None


def _do_path(it, rec, sdir, n, mode, result):
    src = it["target"]
    if not os.path.lexists(src):
        rec["status"] = "gone"
        return
    if paths.is_reparse_point(src):
        rec["link_target"] = os.readlink(src) if hasattr(os, "readlink") else ""
        (os.rmdir if os.path.isdir(src) else os.remove)(src)  # removes the link, never its contents
        rec["status"] = "done"
        rec["restorable"] = False   # nothing was stored: restore() refuses it, so the list must not offer it
        return
    size = paths.path_size(src)
    before, lost0, pend0 = result["reboot"], result["reboot_unrestorable"], len(result["_pending"])
    left0, left_b0 = result.get("_left", 0), result.get("_left_bytes", 0)
    if mode == "delete":
        _delete_tree(src, result)
    else:
        dst = os.path.join(sdir, "files", f"{n}_{_slug(os.path.basename(src))}")
        _move_tree(src, dst, result)
        pend = result["_pending"][pend0:]
        if os.path.lexists(dst) or pend:
            rec["stored"] = dst
        else:
            rec["restorable"] = False     # nothing reached the quarantine: it will only be deleted at restart
        if pend:
            rec["pending_moves"] = pend   # [source, destination in the quarantine], done at the next restart
    if result["reboot"] > before:
        rec["reboot"] = result["reboot"] - before
        rec["restart_required"] = True
    if result["reboot_unrestorable"] > lost0:
        rec["unrestorable"] = result["reboot_unrestorable"] - lost0   # files deleted at restart, no copy kept
    left, left_b = result.get("_left", 0) - left0, result.get("_left_bytes", 0) - left_b0
    if left:   # still in place: not freed, and said (the item stays "done": what did move can be restored)
        rec["left"] = left
        result["errors"].append(f"{rec['display'][:90]}: {tr('Some of its files are in use: close the program and try again.')}")
        size = max(0, size - left_b)
    result["freed"] += size
    rec["size"] = size


def _do_envpath(it, rec):
    scope, entry = it["target"].split("|", 1)
    if scope == "user":
        hive, path = winreg.HKEY_CURRENT_USER, "Environment"
    else:
        hive, path = winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"
    with winreg.OpenKey(hive, path, 0, winreg.KEY_READ | winreg.KEY_SET_VALUE) as k:
        val, typ = winreg.QueryValueEx(k, "Path")
        new, removed = _path_without(str(val).split(";"), entry)
        if not removed:
            rec["status"] = "gone"
            return
        rec["env_old_index"] = removed[0][0]
        rec["env_removed"] = removed     # every copy, as written and where it was: restore puts back all of them
        winreg.SetValueEx(k, "Path", 0, typ, ";".join(new))
    system.broadcast_env_change()


def _path_without(parts, entry):
    """PATH parts without `entry` (any spelling of it): (kept parts, [[index, text as written] of each removed one])."""
    key = entry.strip().lower().rstrip("\\")
    removed = [[i, p] for i, p in enumerate(parts) if p.strip().lower().rstrip("\\") == key]
    return [p for p in parts if p.strip().lower().rstrip("\\") != key], removed


def _path_with(parts, removed):
    """PATH parts with the removed entries back at their old places (lowest index first, so each lands where it was)."""
    out = list(parts)
    for i, text in sorted(removed, key=lambda r: r[0]):
        out.insert(min(int(i), len(out)), text)
    return out


# ---------------------------------------------------------------- sessions
def sessions():
    out = []
    root = qroot()
    for sid in sorted(os.listdir(root), reverse=True) if os.path.isdir(root) else []:
        mf = os.path.join(root, sid, "manifest.json")
        try:
            with open(mf, encoding="utf-8") as f:
                m = json.load(f)
        except (OSError, ValueError):
            continue
        items = m.get("items", [])
        out.append({"id": sid, "program": m.get("program"), "publisher": m.get("publisher", ""), "created": m.get("created"), "mode": m.get("mode"),
                    "restored": m.get("restored", False),
                    "count": sum(1 for i in items if i["status"] == "done"),
                    "size": sum(i.get("size", 0) for i in items if i["status"] == "done"),
                    "restorable": m.get("mode") == "quarantine" and not m.get("restored") and
                                  any(i["status"] == "done" and i.get("restorable", True) for i in items),
                    "pendingRestart": sum(1 for i in items if i["status"] == "done" and i.get("restart_required")),
                    "waitingRestart": _waiting_restart(items),
                    "unrestorableFiles": sum(i.get("unrestorable", 0) for i in items if i["status"] == "done"),
                    "items": [{"idx": n, "kind": i["kind"], "display": i["display"], "status": i["status"],
                               "target": i.get("target", ""), "size": i.get("size", 0),
                               "error": i.get("error", ""),
                               "restorable": i.get("restorable", True) and i["status"] == "done",
                               "pendingRestart": bool(i.get("restart_required")),
                               "unrestorable": i.get("unrestorable", 0)} for n, i in enumerate(items)]})
    return out


def restore(sid, progress=None, only=None):
    """Put back what a session stored. With `only` (indexes into sessions()[..]["items"]) just those."""
    progress = progress or (lambda *a: None)
    only = None if only is None else {int(x) for x in only}
    mf = os.path.join(_session_dir(sid), "manifest.json")
    with open(mf, encoding="utf-8") as f:
        m = json.load(f)
    res = {"ok": 0, "failed": 0, "errors": [], "needs_reboot": False}
    items = [i for n, i in enumerate(m["items"]) if i["status"] == "done" and (only is None or n in only)]
    # reverse order: folders/files first, then registry, then services
    items.sort(key=lambda i: -ORDER.get(i["kind"], 9))
    for n, it in enumerate(items):
        progress(n / max(len(items), 1), it["display"][:80])
        try:
            k = it["kind"]
            if k in ("file", "folder"):
                if not it.get("stored") or it.get("restorable") is False:
                    raise OSError(tr("It was deleted permanently or was a link"))
                pend = it.get("pending_moves") or []
                if (pend and not os.path.lexists(it["stored"])) or any(os.path.lexists(a) for a, _ in pend):
                    raise OSError(tr("Restart the PC first: some files are still waiting to be moved to the quarantine"))
                if os.path.lexists(it["target"]):
                    # a folder that kept some files in use (it["left"]) is still there: what moved goes back into it
                    if not (it.get("left") and os.path.isdir(it["target"]) and not paths.is_reparse_point(it["target"])
                            and os.path.isdir(it["stored"])):
                        raise OSError(tr("Something already exists at the original path"))
                    _merge_back(it["stored"], it["target"])
                else:
                    _real_move(it["stored"], it["target"])
            elif k in ("regkey", "service"):
                ok, out = registry.import_reg(it["reg_file"], it.get("view", 0))
                if not ok:
                    raise OSError(out)
                if k == "service":
                    res["needs_reboot"] = True
            elif k == "regvalue":
                data, typ = _unpack_value(it["value"])
                registry.set_value(RegRef.from_str(it["target"]), data, typ)
            elif k == "task":
                if not it.get("task_file") or not os.path.isfile(it["task_file"]):
                    # nothing to recreate it from: not a success (it used to be counted as restored)
                    raise OSError(tr("That change can no longer be undone: its backup is gone."))
                code, out = system.run(["schtasks", "/Create", "/TN", it["target"], "/XML", it["task_file"], "/F"])
                if code != 0:
                    raise OSError(out)
            elif k == "fwrule":
                fw = r"SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters\FirewallPolicy\FirewallRules"
                registry.set_value(RegRef("HKLM", fw, 0, it["target"]), it["fw_data"], winreg.REG_SZ)
                res["needs_reboot"] = True
            elif k == "envpath":
                scope, entry = it["target"].split("|", 1)
                hive, path = ((winreg.HKEY_CURRENT_USER, "Environment") if scope == "user" else
                              (winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"))
                with winreg.OpenKey(hive, path, 0, winreg.KEY_READ | winreg.KEY_SET_VALUE) as kk:
                    val, typ = winreg.QueryValueEx(kk, "Path")
                    parts = str(val).split(";")
                    removed = it.get("env_removed") or [[it.get("env_old_index", len(parts)), entry]]  # older sessions
                    winreg.SetValueEx(kk, "Path", 0, typ, ";".join(_path_with(parts, removed)))
                system.broadcast_env_change()
            it["status"] = "restored"
            res["ok"] += 1
        except Exception as e:
            res["failed"] += 1
            res["errors"].append(f"{it['display'][:90]}: {str(e)[:160]}")
    m["restored"] = not any(i["status"] == "done" for i in m["items"])
    _save(m)
    index.invalidate()
    progress(1.0, tr("Done"))
    return res


def delete_session(sid):
    d = _session_dir(sid)
    if is_within(d, qroot()) and norm_path(d) != norm_path(qroot()):
        _rmtree(d)


def purge(days=14, kept=None):
    """Delete the sessions older than `days`. A session still waiting for the restart that moves files into it is
    kept (deleted, those files would stay where they were): its id goes into `kept` when a list is given."""
    cutoff = time.time() - days * 86400
    n = 0
    for s in sessions():
        if (s.get("created") or 0) < cutoff:
            if s.get("waitingRestart"):
                if kept is not None:
                    kept.append(s["id"])
                continue
            delete_session(s["id"])
            n += 1
    return n


def _waiting_restart(items):
    """True while a file of the session is still at its old place, waiting for the restart that moves it in."""
    return any(i.get("status") == "done" and any(os.path.lexists(src) for src, _ in i.get("pending_moves") or [])
               for i in items)


def stats():
    s = sessions()
    return {"sessions": len(s), "size": sum(x["size"] for x in s if x["restorable"])}
