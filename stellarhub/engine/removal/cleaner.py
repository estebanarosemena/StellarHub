"""Junk file cleaner. A closed list of locations: it never deletes outside them.

It only empties the CONTENTS of the category folders, never the category folder itself.

Temp folders (%TEMP%, Windows\\Temp) are where other programs keep their WORKING files, so they get extra care
(an incident deleted ~47 GB including the working folders of tools that were still running):
- decisions are made per FIRST-LEVEL entry of the temp folder, never file by file inside a folder;
- a first-level folder is left alone completely if anything inside it changed within the grace period
  (default 7 days, the user picks 1 / 7 / 30), if a running process uses it (its working folder, its exe, a
  path in its command line or an open file), if the user excluded it, or if it is a link/junction;
- loose files directly in the temp folder follow the same age rule one by one;
- reparse points (junctions, symlinks) are never followed, anywhere;
- files that are locked are skipped once and counted, never retried in a loop.
Sources for the rules: CCleaner keeps temp files younger than 24 h by default; BleachBit's maintainers agreed an
age limit is needed so files in use are not deleted (bleachbit.org forum, "Only clean temp files older than a set
amount of time"); Windows Disk Cleanup is conservative with Temp. We go further with the per-folder rule.
"""
import ctypes
import glob
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from ...i18n import tr
from . import paths, safety, system

RECENT_GRACE = 3600        # legacy file-level grace (seconds) when grace=True is passed to _walk
TEMP_GRACE_DAYS = 7        # default for temp folders; the user can choose 1, 7 or 30 days
GRACE_CHOICES = (1, 7, 30)
WALK_WORKERS = 4           # threads per category when walking folders
CAT_WORKERS = 3            # categories measured at the same time
DELETE_WORKERS = 6         # threads when deleting
IN_USE_HELPERS = 8       # helper processes asking the programs for their open files
IN_USE_FAST_BUDGET = 3.0   # the same with helper processes: covers more programs (~880 paths vs ~520) in half the time
IN_USE_BUDGET = 6.0        # seconds spent at most asking processes for their open files
LOOSE = "(files directly in this folder)"   # English key; the row shows tr(LOOSE)
LOOSE_TOKEN = "loose:"      # exclude entry "loose:<temp folder>" skips the loose files of that folder only


def _k(name, *rest):
    base = paths.kf(name)
    return os.path.join(base, *rest) if base else None


def _browser(label, user_data, proc, extra=()):
    subs = ["Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache",
            "GrShaderCache", "ShaderCache", os.path.join("Service Worker", "CacheStorage"),
            os.path.join("Service Worker", "ScriptCache")] + list(extra)
    return {"label": label, "group": "Browsers", "process": proc,
            "globs": [os.path.join(user_data, prof, s) for prof in ("Default", "Profile *", "Guest Profile",
                                                                   "System Profile") for s in subs] +
                     [os.path.join(user_data, s) for s in ("ShaderCache", "GrShaderCache", "GraphiteDawnCache")]}


def categories():
    local, roam, win = paths.kf("LocalAppData") or "", paths.kf("RoamingAppData") or "", paths.kf("Windows") or ""
    pd = paths.kf("ProgramData") or ""
    c = {
        "user_temp": {"label": "User temporary files", "group": "Windows", "globs": [],
                      "grace": True, "temp": True, "default": True,
                      "desc": "Files programs leave in %TEMP%. Folders used recently or by a running program are kept."},
        "win_temp": {"label": "Windows temporary files", "group": "Windows", "globs": [],
                     "grace": True, "temp": True, "default": True, "admin": True},
        "thumbs": {"label": "Thumbnail cache", "group": "Windows", "default": True,
                   "files": [os.path.join(local, "Microsoft", "Windows", "Explorer", "thumbcache_*.db"),
                             os.path.join(local, "Microsoft", "Windows", "Explorer", "iconcache_*.db")],
                   "desc": "Windows rebuilds them when you open folders."},
        "dumps": {"label": "Crash dumps and error reports", "group": "Windows", "default": True,
                  "globs": [os.path.join(local, "CrashDumps"), os.path.join(win, "Minidump"),
                            os.path.join(pd, "Microsoft", "Windows", "WER", "ReportArchive"),
                            os.path.join(pd, "Microsoft", "Windows", "WER", "ReportQueue"),
                            os.path.join(local, "Microsoft", "Windows", "WER", "ReportArchive"),
                            os.path.join(local, "Microsoft", "Windows", "WER", "ReportQueue")],
                  "files": [os.path.join(win, "MEMORY.DMP")]},
        "wu_cache": {"label": "Windows Update downloads", "group": "Windows", "default": False, "admin": True,
                     "globs": [os.path.join(win, "SoftwareDistribution", "Download")],
                     "desc": "Updates that are already installed. Unchecked by default."},
        "do_cache": {"label": "Delivery Optimization", "group": "Windows", "default": False, "admin": True,
                     "globs": [os.path.join(win, "ServiceProfiles", "NetworkService", "AppData", "Local",
                                            "Microsoft", "Windows", "DeliveryOptimization", "Cache")]},
        "chrome": _browser("Google Chrome", os.path.join(local, "Google", "Chrome", "User Data"), "chrome.exe"),
        "edge": _browser("Microsoft Edge", os.path.join(local, "Microsoft", "Edge", "User Data"), "msedge.exe"),
        "brave": _browser("Brave", os.path.join(local, "BraveSoftware", "Brave-Browser", "User Data"), "brave.exe"),
        "opera": {"label": "Opera", "group": "Browsers", "process": "opera.exe",
                  "globs": [os.path.join(local, "Opera Software", "Opera Stable", "Cache"),
                            os.path.join(local, "Opera Software", "Opera GX Stable", "Cache")]},
        "firefox": {"label": "Firefox", "group": "Browsers", "process": "firefox.exe",
                    "globs": [os.path.join(local, "Mozilla", "Firefox", "Profiles", "*", "cache2"),
                              os.path.join(local, "Mozilla", "Firefox", "Profiles", "*", "startupCache")]},
        "discord": {"label": "Discord", "group": "Apps", "process": "discord.exe",
                    "globs": [os.path.join(roam, "discord", s) for s in ("Cache", "Code Cache", "GPUCache")]},
        "spotify": {"label": "Spotify", "group": "Apps", "process": "spotify.exe",
                    "globs": [os.path.join(local, "Spotify", "Data"), os.path.join(local, "Spotify", "Browser", "Cache")]},
        "steam_web": {"label": "Steam (built-in browser)", "group": "Apps", "process": "steamwebhelper.exe",
                      "globs": [os.path.join(local, "Steam", "htmlcache")]},
        "nvidia": {"label": "NVIDIA/DirectX shader cache", "group": "Apps", "default": False,
                   "globs": [os.path.join(local, "NVIDIA", "DXCache"), os.path.join(local, "NVIDIA", "GLCache"),
                             os.path.join(local, "D3DSCache")],
                   "desc": "Games rebuild it; after cleaning, the first session may take longer to load."},
        "recycle": {"label": "Recycle Bin", "group": "Windows", "default": True, "recycle": True},
    }
    # the temp roots are emptied (first-level entries, permanently): validate them before they become a glob
    for k, root, sysd in (("user_temp", paths.user_temp_dir(), False),
                          ("win_temp", os.path.join(win, "Temp") if win else None, True)):
        if root and "~" in root:
            root = paths._long_name(root)   # %TEMP% is often an 8.3 name; processes report the long one
        why = safety.temp_root_problem(root, system_temp=sysd)
        if why:
            c[k]["refused"] = why          # no globs: nothing is scanned or deleted in this category
            c[k]["desc"] = why
            c[k]["default"] = False
        else:
            c[k]["globs"] = [root]
    for k, v in c.items():
        v.setdefault("default", v.get("group") != "Apps" or k in ("discord", "steam_web"))
        v.setdefault("desc", "")
        v["id"] = k
    return c


def _absolute(g):
    """Only absolute drive paths: an empty known folder must never turn a glob into one relative to the cwd."""
    return bool(g) and os.path.isabs(g) and g[1:2] == ":"


def _expand(cat):
    dirs, files = [], []
    if cat.get("refused"):
        return dirs, files
    for g in cat.get("globs", []):
        if _absolute(g):
            dirs += [d for d in glob.glob(g) if os.path.isdir(d) and not paths.is_reparse_point(d)]
    for g in cat.get("files", []):
        if _absolute(g):
            files += [f for f in glob.glob(g) if os.path.isfile(f)]
    return dirs, files


def _norm(p):
    if not p:
        return ""
    if "~" in p:   # an 8.3 name (C:\Users\JOHNSM~1\...) and its long name are the same folder
        p = paths._long_name(os.path.normpath(p))
    return os.path.normcase(os.path.normpath(p))


def _grace_seconds(grace):
    """grace=True keeps the legacy 1-hour rule; a number is seconds; None/False/0 means no age filter."""
    if grace is True:
        return RECENT_GRACE
    return float(grace or 0)


def _list_dir(cur, grace, now, collect):
    """One folder: return (subfolders, files, bytes, [(path, size)] if collect, newest mtime seen).

    On Windows DirEntry.stat() comes from the listing (FindNextFile): no extra call per file. Links and junctions
    are never added to the subfolders, so they are never walked.
    """
    subdirs, files, size, found, newest = [], 0, 0, [], 0.0
    gs = _grace_seconds(grace)
    try:
        it = os.scandir(cur)
    except OSError:
        return subdirs, files, size, found, newest
    with it:
        for e in it:
            try:
                if e.is_dir(follow_symlinks=False):
                    if not paths.entry_is_junction(e) and not e.is_symlink():
                        subdirs.append(e.path)
                        newest = max(newest, e.stat(follow_symlinks=False).st_mtime)
                    continue
                st = e.stat(follow_symlinks=False)
            except OSError:
                continue
            newest = max(newest, st.st_mtime)
            if gs and now - st.st_mtime < gs:
                continue
            files += 1
            size += st.st_size
            if collect:
                found.append((e.path, st.st_size))
    return subdirs, files, size, found, newest


def _walk(dirs, grace, collect=False, workers=WALK_WORKERS, stats=None, cancel=None):
    """Walk several folders with several threads (scandir releases the GIL while waiting for the disk).

    Measured on a real PC, 508,000 temp files: 1 thread 10-22 s, 4 threads 4.9 s, 8 or more threads, worse.
    Return (files, bytes, [(path, size)] if collect). If `stats` is a dict it gets "newest" (latest mtime of any
    file or folder seen, including the roots' contents).
    """
    now = time.time()
    work = list(dirs)
    if not work:
        return 0, 0, []
    lock = threading.Lock()
    cond = threading.Condition(lock)
    state = {"pending": len(work), "files": 0, "size": 0, "newest": 0.0}
    found = []

    def worker():
        files = size = 0
        newest = 0.0
        mine = []
        while True:
            with cond:
                while not work and state["pending"]:
                    cond.wait()
                if not work:
                    break
                cur = work.pop()
            subs, f, s, fl, nw = [], 0, 0, [], 0.0
            try:
                if not (cancel and cancel()):
                    subs, f, s, fl, nw = _list_dir(cur, grace, now, collect)
            finally:
                files += f
                size += s
                newest = max(newest, nw)
                mine += fl
                with cond:
                    work.extend(subs)
                    state["pending"] += len(subs) - 1
                    cond.notify_all()
        with lock:
            state["files"] += files
            state["size"] += size
            state["newest"] = max(state["newest"], newest)
            found.extend(mine)

    threads = [threading.Thread(target=worker, daemon=True) for _ in range(max(1, workers))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    if stats is not None:
        stats["newest"] = state["newest"]
    return state["files"], state["size"], found


def _remove_empty_dirs(root, remove_root=False):
    """Delete empty subfolders (deepest first); the root only if remove_root.

    It does not use os.walk: on Windows os.walk DOES enter junctions and would delete empty folders outside
    the category. Here a link or junction is neither walked nor deleted.
    """
    def visit(d):
        try:
            entries = list(os.scandir(d))
        except OSError:
            return
        for e in entries:
            try:
                attrs = e.stat(follow_symlinks=False).st_file_attributes
            except OSError:
                continue
            if attrs & 0x10 and not attrs & 0x400:   # a real folder, not a link
                visit(e.path)
                try:
                    os.rmdir(e.path)   # only works if it ended up empty
                except OSError:
                    pass
    visit(root)
    if remove_root:
        try:
            os.rmdir(root)
        except OSError:
            pass


# ---------------------------------------------------------------- what running programs are using
_PATH_RE = re.compile(r"[A-Za-z]:\\[^\"'<>|*?\r\n]*")
_PATH_START = re.compile(r"(?<![^\s=,])[A-Za-z]:\\")


def _cmd_paths(cmd):
    r"""Absolute paths in a command line. psutil gives it as a list of arguments: each one is searched on its own
    (joined, "C:\Tools\app.exe C:\Temp\work" was ONE match and the second path was never seen). A path may contain
    spaces, so inside one argument it is cut wherever another path may start: "C:\a.exe C:\Temp\b" gives "C:\a.exe",
    "C:\Temp\b" and the whole text. More keys only ever keep more folders."""
    out = []
    for a in (cmd if isinstance(cmd, (list, tuple)) else [cmd]):
        for m in _PATH_RE.findall(str(a or "")):
            for piece in m.split(";"):
                starts = [x.start() for x in _PATH_START.finditer(piece)]
                for i, st in enumerate(starts):
                    out.append(piece[st:])
                    if i + 1 < len(starts):
                        out.append(piece[st:starts[i + 1]])
    return [x.strip() for x in out if x.strip()]


# Never asked for their working folder or their open files: Windows' core processes and security software. psutil
# reads another process's memory for the first and duplicates its handles for the second, and opening lsass.exe or an
# antivirus that way is what credential stealers do, so behaviour engines (Kaspersky's System Watcher, Defender) take
# it for an attack. None of them keeps working files in a temp folder a person cleans; their exe and command line are
# still read (that needs no such access).
NOT_INSPECTED = frozenset({
    "system", "system idle process", "registry", "secure system", "memory compression", "smss.exe", "csrss.exe",
    "wininit.exe", "winlogon.exe", "services.exe", "lsass.exe", "lsaiso.exe", "lsm.exe", "fontdrvhost.exe",
    "sgrmbroker.exe", "msmpeng.exe", "msmpengcp.exe", "nissrv.exe", "mpdefendercoreservice.exe", "mssense.exe",
    "sensecncproxy.exe", "smartscreen.exe", "securityhealthservice.exe", "securityhealthsystray.exe",
    "avp.exe", "avpui.exe", "avpsus.exe", "kavtray.exe", "ksde.exe", "ksdeui.exe", "klnagent.exe", "kavfs.exe",
    "kavfswp.exe", "pccntmon.exe", "ntrtscan.exe", "tmlisten.exe", "avira.servicehost.exe", "sophosfs.exe",
    "sedservice.exe", "vsserv.exe", "bdservicehost.exe", "bdagent.exe",
    "bdredline.exe", "ekrn.exe", "egui.exe", "avastsvc.exe", "avastui.exe", "aswengsrv.exe", "avgsvc.exe", "avgui.exe",
    "mbamservice.exe", "mbamtray.exe", "mcshield.exe", "mfemms.exe", "mfevtps.exe", "modulecoreservice.exe",
    "nortonsecurity.exe", "ns.exe", "nllauncher.exe", "wrsa.exe", "csfalconservice.exe", "sentinelagent.exe",
    "sophoshealth.exe", "savservice.exe", "coreserviceshell.exe", "psanhost.exe", "fsorsp64.exe", "f-secure.exe",
})


def _inspectable(name):
    """Whether a process may be asked for its working folder and open files (NOT_INSPECTED)."""
    return (name or "").lower() not in NOT_INSPECTED


def _cwd(p, info):
    """The process's working folder: from `info` when it is there (a test's stand-in), else asked, only of a process
    that may be inspected."""
    if "cwd" in info:
        return info.get("cwd")
    if not _inspectable(info.get("name")):
        return None
    try:
        c = p.cwd()
    except Exception:  # noqa: BLE001
        return None
    return c if isinstance(c, str) else None


def in_use_paths(budget=IN_USE_BUDGET, on_step=None):
    """{normalized path: process name} for everything running processes are using: their working folder, their
    executable, every absolute path in their command line and (time-boxed, best effort) their open files.
    on_step(done, total) is called after each process so a screen can show real progress."""
    try:
        import psutil
    except ImportError:
        return {}
    out = {}
    t0 = time.monotonic()
    me = os.getpid()
    procs = list(psutil.process_iter(["name", "exe", "cmdline"]))
    for i, p in enumerate(procs, 1):
        if on_step:
            try:
                on_step(i, len(procs))
            except Exception:
                pass
        try:
            info = p.info
        except Exception:
            continue
        name = info.get("name") or tr("a program")
        cands = [info.get("exe"), _cwd(p, info)]
        cmd = info.get("cmdline") or []
        cands += _cmd_paths(cmd)
        for x in cands:
            if x:
                out.setdefault(_norm(x.strip().rstrip("\\")), name)
        if p.pid != me and _inspectable(info.get("name")) and time.monotonic() - t0 < budget:
            try:
                for f in p.open_files():
                    out.setdefault(_norm(f.path), name)
            except Exception:
                pass
    return out


def _in_use_child(pq, rq, deadline):
    """A helper process (see in_use_isolated): takes (pid, name) from pq and answers with its open files."""
    try:
        import psutil
    except ImportError:
        rq.put(("x",))
        return
    while True:
        try:
            item = pq.get(timeout=20)
        except Exception:  # noqa: BLE001
            break
        if item is None:
            break
        pid, name = item
        paths = []
        if time.time() < deadline:
            try:
                paths = [f.path for f in psutil.Process(pid).open_files()]
            except Exception:  # noqa: BLE001
                pass
        rq.put(("f", pid, name, paths))
    rq.put(("x",))


def in_use_isolated(budget=IN_USE_FAST_BUDGET, on_step=None, helpers=IN_USE_HELPERS):
    """The same answer as in_use_paths(), found faster. psutil's open-files query costs ~0.1 s per process and keeps
    the interpreter lock while it runs, so on one thread it both took the whole time budget and froze every other
    thread (the folder walks included). Here several helper processes ask it for different programs at once, the
    programs a person uses (outside the Windows folder) first, so the same time budget covers more of them. If the
    helpers cannot start, it is done in this process."""
    try:
        import psutil
        import multiprocessing as mp
        import queue as _q
        ctx = mp.get_context("spawn")
        pq, rq = ctx.Queue(), ctx.Queue()
        deadline = time.time() + budget
        procs = [ctx.Process(target=_in_use_child, args=(pq, rq, deadline), daemon=True) for _ in range(helpers)]
        for pr in procs:
            pr.start()
    except Exception:  # noqa: BLE001
        return in_use_paths(budget, on_step)
    try:
        out = {}
        win = (paths.kf("Windows") or r"C:\Windows").lower()
        me = os.getpid()
        todo = []
        for p in psutil.process_iter(["name", "exe", "cmdline"]):
            try:
                info = p.info
            except Exception:  # noqa: BLE001
                continue
            name = info.get("name") or tr("a program")
            cands = [info.get("exe"), _cwd(p, info)]
            cmd = info.get("cmdline") or []
            cands += _cmd_paths(cmd)
            for x in cands:
                if x:
                    out.setdefault(_norm(x.strip().rstrip("\\")), name)
            if p.pid != me and _inspectable(info.get("name")):
                todo.append((0 if not (info.get("exe") or "").lower().startswith(win) else 1, p.pid, name))
        todo.sort()
        for _, pid, name in todo:
            pq.put((pid, name))
        for _ in procs:
            pq.put(None)
        got = ended = 0
        limit = deadline + 0.6      # a helper stuck on one slow program does not hold everything up
        while got < len(todo) and ended < len(procs) and time.time() < limit:
            try:
                msg = rq.get(timeout=0.25)
            except _q.Empty:
                if not any(pr.is_alive() for pr in procs):
                    break
                continue
            if msg[0] == "x":
                ended += 1
                continue
            _, pid, name, files = msg
            got += 1
            for f in files:
                out.setdefault(_norm(f), name)
            if on_step:
                on_step(got, len(todo))
        if on_step:
            on_step(len(todo), len(todo))
        return out
    finally:
        for pr in procs:
            if pr.is_alive():
                pr.terminate()


def _user_for(path, in_use):
    """Name of a process using `path` or anything inside it, or None."""
    n = _norm(path)
    pre = n + os.sep
    for u, name in in_use.items():
        if u == n or u.startswith(pre):
            return name
    return None


def _excluded(path, exclude):
    if not exclude:
        return False
    n, base = _norm(path), os.path.basename(path).lower()
    for x in exclude:
        x = str(x).strip()
        if not x or x.startswith(LOOSE_TOKEN):
            continue
        if os.path.isabs(x):
            # the exclusion as typed AND its real path (a junction, a short name, a redirected folder): the files
            # found by the scan come from real folders, so an exclusion written another way must still match
            from . import paths as _rp
            for xn in {_norm(x), *_rp.forms_cached(x)}:
                if xn and (n == xn or n.startswith(xn.rstrip(os.sep) + os.sep)):
                    return True
        elif base == x.lower():
            return True
    return False


def temp_entries(root, days=TEMP_GRACE_DAYS, exclude=(), in_use=None, cancel=None, tick=None):
    """First-level view of a temp folder. Every row says whether it will be cleaned and why not.

    status: "clean" (will be emptied), "recent" (changed within the grace period), "in_use" (a running program
    uses it), "excluded" (the user said no), "link" (a junction/symlink: never followed or deleted).
    `in_use` is a dict, or a function returning it (waited for only after the disk was read); tick(i, n) reports progress.
    The loose files directly in `root` are summarized in one row named LOOSE.
    """
    get_in_use = in_use if callable(in_use) else (lambda: in_use) if in_use is not None else in_use_paths
    skip_loose = any(_norm(str(x)[len(LOOSE_TOKEN):]) == _norm(root) for x in exclude or ()
                     if str(x).startswith(LOOSE_TOKEN))
    limit = max(0, float(days)) * 86400
    now = time.time()
    rows = []
    loose = {"name": tr(LOOSE), "path": root, "kind": "files", "size": 0, "files": 0, "kept": 0, "keptSize": 0,
             "newest": 0.0, "status": "clean", "reason": "", "items": []}
    try:
        it = list(os.scandir(root))
    except OSError:
        return rows
    # phase 1 (disk only): walk every folder and look at every loose file. Which running program uses what is
    # asked afterwards, so the slow "who has this open" query can run while the disk is being read.
    dirs, files_ = [], []
    for n_done, e in enumerate(it, 1):
        if cancel and cancel():
            break
        if tick:
            tick(n_done, len(it))
        try:
            st = e.stat(follow_symlinks=False)
        except OSError:
            continue
        is_link = bool(getattr(st, "st_file_attributes", 0) & 0x400) or e.is_symlink() or paths.entry_is_junction(e)
        if is_link:
            rows.append({"name": e.name, "path": e.path, "kind": "link", "size": 0, "files": 0,
                         "newest": st.st_mtime, "status": "link", "reason": tr("Link to another folder: never followed")})
            continue
        if e.is_dir(follow_symlinks=False):
            stats = {}
            files, size, _ = _walk([e.path], None, stats=stats, cancel=cancel)
            newest = max(stats.get("newest", 0.0), st.st_mtime)
            dirs.append({"name": e.name, "path": e.path, "kind": "dir", "size": size, "files": files, "newest": newest})
        else:
            files_.append((e.path, st))
    in_use = get_in_use()
    for row in dirs:
        user = _user_for(row["path"], in_use)
        if _excluded(row["path"], exclude):
            row.update(status="excluded", reason=tr("You chose to always keep it"))
        elif user:
            row.update(status="in_use", reason=tr("In use by {name}", name=user), process=user)
        elif now - row["newest"] < limit:
            row.update(status="recent", reason=tr("Used recently"))
        else:
            row.update(status="clean", reason="")
        rows.append(row)
    for path, st in files_:
        loose["newest"] = max(loose["newest"], st.st_mtime)
        if skip_loose or _excluded(path, exclude) or _user_for(path, in_use) or now - st.st_mtime < limit:
            loose["kept"] += 1
            loose["keptSize"] += st.st_size
            continue
        loose["files"] += 1
        loose["size"] += st.st_size
        loose["items"].append((path, st.st_size))
    if loose["files"] or loose["kept"]:
        if skip_loose:
            loose.update(status="excluded", reason=tr("You chose to keep them"), files=loose["kept"],
                         size=loose["keptSize"], kept=0, keptSize=0)
        elif not loose["files"]:
            loose.update(status="recent", reason=tr("All of them are recent or in use"))
        rows.append(loose)
    rows.sort(key=lambda r: (r["status"] != "clean", -r["size"]))
    return rows


def _public_rows(rows, limit=300):
    """Rows without the internal file lists, ready to send to the interface."""
    out = []
    for r in rows[:limit]:
        out.append({k: v for k, v in r.items() if k != "items"})
    return out


# ---------------------------------------------------------------- measuring
class _SHQUERYRBINFO(ctypes.Structure):
    _fields_ = [("cbSize", ctypes.c_uint32), ("i64Size", ctypes.c_int64), ("i64NumItems", ctypes.c_int64)]


def recycle_info():
    info = _SHQUERYRBINFO()
    info.cbSize = ctypes.sizeof(info)
    if ctypes.windll.shell32.SHQueryRecycleBinW(None, ctypes.byref(info)) == 0:
        return info.i64Size, info.i64NumItems
    return 0, 0


def running(proc, names=None):
    if not proc:
        return False
    if names is None:
        names = {p["name"].lower() for p in system.list_processes()}
    return proc.lower() in names


def _measure(c, days=TEMP_GRACE_DAYS, exclude=(), in_use=None, tick=None):
    """(bytes, files, rows). Temp categories only count what would really be deleted; rows explain the rest."""
    if c.get("recycle"):
        size, count = recycle_info()
        return size, count, None
    dirs, files = _expand(c)
    if c.get("temp"):
        size = count = 0
        rows = []
        for d in dirs:
            rs = temp_entries(d, days, exclude, in_use, tick=tick)
            for r in rs:
                r["root"] = d
            rows += rs
        for r in rows:
            if r["status"] == "clean":
                size += r["size"]
                count += r["files"]
        rows.sort(key=lambda r: (r["status"] != "clean", -r["size"]))
        return size, count, rows
    count, size, _ = _walk(dirs, c.get("grace"))
    for f in files:
        try:
            size += os.path.getsize(f)
            count += 1
        except OSError:
            pass
    return size, count, None


def scan(progress=None, on_item=None, days=TEMP_GRACE_DAYS, exclude=(), on_inuse=None, on_tick=None):
    """Measure every category at once; on_item(result) is called as soon as each one finishes.

    The query "which running program uses which file" is the slowest part (several seconds), so it runs on its own
    thread while the folders are read; a temp folder only waits for it after its disk reading is done.
    on_inuse(done, total) follows that query; on_tick(category id, done, total) follows the first-level folders of
    a temp category."""
    cats = categories()
    admin = system.is_admin()
    procs = {p["name"].lower() for p in system.list_processes()}
    order = {k: i for i, k in enumerate(cats)}
    out, done = [], 0
    iu_ex = ThreadPoolExecutor(max_workers=1)
    iu_fut = iu_ex.submit(in_use_isolated, IN_USE_FAST_BUDGET, on_inuse) if any(c.get("temp") for c in cats.values()) else None
    in_use = iu_fut.result if iu_fut else {}
    with ThreadPoolExecutor(max_workers=CAT_WORKERS) as ex:
        futs = {ex.submit(_measure, c, days, exclude, in_use,
                          (lambda i, n, _k=k: on_tick(_k, i, n)) if on_tick else None): k for k, c in cats.items()}
        for fut in as_completed(futs):
            k = futs[fut]
            c = cats[k]
            try:
                size, count, rows = fut.result()
            except Exception:
                size, count, rows = 0, 0, None
            item = {"id": k, "label": tr(c["label"]), "group": tr(c["group"]), "desc": tr(c["desc"]) if c["desc"] else "", "size": size,
                    "count": count, "default": c["default"] and size > 0,
                    "needs_admin": bool(c.get("admin")) and not admin,
                    "busy": running(c.get("process"), procs), "process": c.get("process", "")}
            if c.get("refused"):
                item["skipped"] = True
                item["skipReason"] = c["refused"]
                item["desc"] = c["refused"]    # already translated; the UI shows desc under the row
            if rows is not None:
                item["rows"] = _public_rows(rows)
                kept = [r for r in rows if r["status"] != "clean"]
                item["keptSize"] = sum(r["size"] for r in kept) + sum(r.get("keptSize", 0) for r in rows)
                item["keptCount"] = len(kept)
            out.append(item)
            done += 1
            if on_item:
                on_item(item)
            if progress:
                progress(done / len(cats), tr(c["label"]))
    iu_ex.shutdown(wait=False)
    out.sort(key=lambda i: order[i["id"]])
    if progress:
        progress(1, tr("Done"))
    return out


# ---------------------------------------------------------------- deleting
class _Counter:
    def __init__(self, total_files, total_bytes):
        self.lock = threading.Lock()
        self.total, self.total_bytes = total_files, total_bytes
        self.deleted = self.freed = self.skipped = 0
        self.current = ""


def _delete_list(found, counter, cancel=None, label=""):
    """Delete (path, size) pairs with several threads (os.remove releases the GIL). Locked files are skipped once.
    Stops between files as soon as cancel() is true."""
    if not found:
        return
    n = 1 if len(found) < 200 else DELETE_WORKERS
    chunks = [found[i::n] for i in range(n)]

    def work(chunk):
        for fp, s in chunk:
            if cancel and cancel():
                return
            try:
                os.remove(fp)
                with counter.lock:
                    counter.freed += s
                    counter.deleted += 1
                    counter.current = label or os.path.dirname(fp)
            except OSError:
                with counter.lock:
                    counter.skipped += 1
    with ThreadPoolExecutor(max_workers=n) as ex:
        list(ex.map(work, chunks))


def _report(counter, on_progress, t0, extra=None):
    if not on_progress:
        return
    with counter.lock:
        el = max(0.001, time.monotonic() - t0)
        rate = counter.deleted / el
        left = max(0, counter.total - counter.deleted - counter.skipped)
        d = {"deleted": counter.deleted, "total": counter.total, "freed": counter.freed,
             "totalBytes": counter.total_bytes, "skipped": counter.skipped, "current": counter.current,
             "rate": round(rate), "eta": round(left / rate) if rate > 1 else None}
    if extra:
        d.update(extra)
    on_progress(d)


def clean(ids, progress=None, days=TEMP_GRACE_DAYS, exclude=(), cancel=None, on_progress=None, in_use=None):
    """Clean the chosen categories. Returns {"freed", "deleted", "skipped", "cancelled", "per": {id: bytes}}.

    on_progress(dict) gets real numbers several times a second: deleted, total, freed, current folder, files per
    second and estimated seconds left. cancel() is checked between files.
    """
    cats = categories()
    t0 = time.monotonic()
    plans = []   # (category id, [(path, size)], [folders to tidy afterwards], [(folder, remove_root)])
    total_files = total_bytes = 0
    need_in_use = any(cats.get(k, {}).get("temp") for k in ids)
    if need_in_use and in_use is None:
        in_use = in_use_isolated()
    for k in ids:
        c = cats.get(k)
        if not c or c.get("recycle"):
            plans.append((k, None, []))
            continue
        dirs, files = _expand(c)
        found, tidy = [], []
        if c.get("temp"):
            for d in dirs:
                for r in temp_entries(d, days, exclude, in_use, cancel=cancel):
                    if r["status"] != "clean":
                        continue
                    if r["kind"] == "files":
                        found += r["items"]
                    else:
                        found += _walk([r["path"]], None, collect=True, cancel=cancel)[2]
                        tidy.append((r["path"], True))
        else:
            for d in dirs:
                found += _walk([d], c.get("grace"), collect=True, cancel=cancel)[2]
                tidy.append((d, False))
            for f in files:
                try:
                    found.append((f, os.path.getsize(f)))
                except OSError:
                    pass
        total_files += len(found)
        total_bytes += sum(s for _, s in found)
        plans.append((k, found, tidy))
        if progress:
            progress(0, tr("Preparing {name}", name=tr(c["label"]).lower()))
    counter = _Counter(total_files, total_bytes)
    per = {}
    stop = threading.Event()

    def ticker():
        while not stop.wait(0.2):
            _report(counter, on_progress, t0)
    tick = threading.Thread(target=ticker, daemon=True)
    tick.start()
    cancelled = False
    try:
        for k, found, tidy in plans:
            if cancel and cancel():
                cancelled = True
                break
            c = cats.get(k)
            if not c:
                continue
            before = counter.freed
            if found is None:   # Recycle Bin
                size, count = recycle_info()
                if ctypes.windll.shell32.SHEmptyRecycleBinW(None, None, 0x7) in (0, -2147418113):
                    with counter.lock:
                        counter.freed += size
                        counter.deleted += count
                per[k] = counter.freed - before
                continue
            if progress:
                progress(0, tr(c["label"]))
            # temp folders show the folder being emptied; other categories their name
            _delete_list(found, counter, cancel, label="" if c.get("temp") else tr(c["label"]))
            for folder, remove_root in tidy:
                _remove_empty_dirs(folder, remove_root=remove_root)  # never through links
            per[k] = counter.freed - before
            _report(counter, on_progress, t0, {"id": k, "catFreed": per[k]})
        if cancel and cancel():
            cancelled = True
    finally:
        stop.set()
    _report(counter, on_progress, t0)
    if progress:
        progress(1, tr("Done"))
    return {"freed": counter.freed, "deleted": counter.deleted, "skipped": counter.skipped,
            "cancelled": cancelled, "per": per}
