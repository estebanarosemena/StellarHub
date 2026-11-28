"""StellarHub's own updates, from the releases of its GitHub repository.

How an update runs (the same steps for every kind of install):
  1. The app asks GitHub for the latest release (check) and shows what is new.
  2. The user says yes: the app starts the updater, which is StellarHub.exe itself with --self-update:
       - installed for one user (the default, in %LOCALAPPDATA%\\Programs) or already running as administrator:
         started directly ("direct": no administrator rights, no task, no prompt, nothing to set up);
       - installed for everyone (in Program Files) with the "StellarHub\\Update" scheduled task: through the task,
         which runs it with administrator rights without the Windows prompt ("task");
       - installed for everyone without the task (the installer no longer creates it): Windows asks ONCE ("uac"),
         and the elevated updater then creates the task (ensure_task), so every later update is silent. The prompt
         only ever appears when the user clicks Update or at the start-time staged install; the background download
         (prefetch) never triggers it, so a new-features version on such an install shows the update window
         instead of being staged silently.
  3. The updater downloads the installer into <install folder>\\update (in Program Files only administrators can
     write there), checks its signature (see below) and says "ready" in
     <install folder>\\update\\state.json, which the app reads to show the progress.
  4. The app leaves a note for after the update (update-pending.json), starts a small helper that will reopen it,
     and closes. The updater waits for it to be gone, starts the installer silently (/VERYSILENT) and exits so no
     file of the install folder is in use. The installer shows its own small progress window (/SILENT: no
     questions, nothing to click; the start screen covers the moment before it appears), writes "done" (or
     "failed") to state.json when it ends, and opens StellarHub again itself (see StellarHub.iss); the helper is
     only a safety net for an installer that never got to run. StellarHub then says it was updated.

The portable version (stellarhub/paths.py) takes the release's StellarHub-Portable-X.zip instead: the updater
unpacks it into <program>/update/new and says "ready"; the app closes and starts the NEW copy with --finish-update,
which waits for the old one to be gone, copies its own files over it (never the Data folder) and opens it. No script
replaces the program behind the user's back: an earlier version did that with a hidden PowerShell, and Kaspersky
flagged it as malware (PDM:Trojan.Win32.Generic), which is why it works this way.

Signed releases. A SHA-256 published next to the file proves nothing against a stolen GitHub account (the thief
uploads both), so the trust anchor is an Ed25519 signature made on the owner's PC (tools/release_sign.py) with a
key that never leaves it. Each file has a detached StellarHub-Setup-X.exe.sig (or StellarHub-Portable-X.zip.sig)
that signs a small text, the manifest (see manifest()):
    StellarHub release / file: <name> / version: <X> / sha256: <hex of the file>
so a signature is tied to that file name, that version and those exact bytes: an old signed file cannot be passed
off as a newer version. The updater hashes what it downloaded itself, rebuilds the manifest and checks it against
TRUSTED_KEYS (stellarhub/ed25519.py, pure Python). A release without a valid signature is never installed. The
published .sha256 files are only for people. TRUSTED_KEYS is a list so the key can be rotated: ship a release
signed with the old key whose TRUSTED_KEYS also holds the new one.

The elevated updater never takes instructions from the user's side: it asks GitHub itself, only for this
repository, only for a newer version, and only runs a file whose signature is valid, held open from its last check
until it runs. What it reads from the user's profile are three flags (cancel, background download, install now): they
can stop it, or change when a verified update is installed, never what. In an installed copy running elevated the test
switches in the environment (STELLARHUB_UPDATE_DIR / _URL, STELLARHUB_PORTABLE...) are ignored (paths.env).
"""
import ctypes
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

from .. import VERSION, ed25519
from ..i18n import tr

EXPORTS = {"check", "mode", "start", "state", "cancel", "after_update", "finish", "prefetch", "staged"}

REPO = "estebanarosemena/StellarHub"
API = f"https://api.github.com/repos/{REPO}/releases/latest"
TASK = r"StellarHub\Update"
# Public keys (hex, 32 bytes) whose signature makes a release acceptable. The owner's key comes from
# `python tools/release_sign.py keygen`. To rotate: add the new key HERE, release it signed with the old one, and
# only later drop the old key.
TRUSTED_KEYS = [
    "cd88f316f9852616bee4a48ee1863dd821f0b9f686ea15b4758798b518fe88d7",  # Esteban Arosemena, release key 1 (2026-11-20)
]
ASSET_RE = re.compile(r"^StellarHub-Setup-(\d+(?:\.\d+){1,3})\.exe$", re.I)
PORTABLE_RE = re.compile(r"^StellarHub-Portable-(\d+(?:\.\d+){1,3})\.zip$", re.I)
NO_WINDOW = 0x08000000
DETACHED = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
NEW_GROUP, BREAKAWAY = 0x00000200, 0x01000000  # CREATE_NEW_PROCESS_GROUP, CREATE_BREAKAWAY_FROM_JOB
FROZEN = bool(getattr(sys, "frozen", False))


# ---------------------------------------------------------------- places
def _data_dir():
    from .. import paths
    return paths.data_dir()


def install_dir():
    return os.path.dirname(os.path.abspath(sys.executable))


def update_dir():
    """Where the updater downloads and reports: next to the program (STELLARHUB_UPDATE_DIR in tests)."""
    from .. import paths
    return paths.env("STELLARHUB_UPDATE_DIR") or os.path.join(install_dir(), "update")


def state_path():
    return os.path.join(update_dir(), "state.json")


def _prefetch_flag():
    """Present while an update is being downloaded in the background to be installed at the next start. Like the
    cancel flag, the only thing the updater reads from the user's side, and all it can do is stop earlier."""
    from .. import paths
    return os.path.join(paths.local_dir(), "update.prefetch")


def _now_flag():
    """Present when the user asked to install now while a background download may be running through the update
    task: Windows doesn't start a second copy of a running task, so that click would only follow the background run,
    which stops at "staged". This flag makes it go on to "ready" instead. Like the other flags, all it can do is change
    WHEN a downloaded and verified update is installed, never what is installed."""
    from .. import paths
    return os.path.join(paths.local_dir(), "update.now")


def _cancel_flag():
    from .. import paths
    return os.path.join(paths.local_dir(), "update.cancel")


def _pending_path():
    return os.path.join(_data_dir(), "update-pending.json")


def _alert(msg):
    """A last resort that never stays silent: the log and a Windows message box."""
    print("[update]", msg, flush=True)
    from .. import paths
    if not paths.dialogs_allowed():
        return
    try:
        ctypes.windll.user32.MessageBoxW(None, msg, "StellarHub", 0x10 | 0x00040000)  # error icon, topmost
    except Exception:
        pass


def _language(settings_file=None):
    """The start screen speaks the user's language. settings_file: where the user's settings are when this copy's own
    are not theirs (the new portable copy in the update folder: paths._portable_root). Nothing changes when they can't
    be read."""
    from .. import i18n
    try:
        with open(settings_file or os.path.join(_data_dir(), "settings.json"), encoding="utf-8") as fh:
            i18n.set_language((json.load(fh) or {}).get("language"))
    except (OSError, ValueError, AttributeError):
        pass


def _splash(text, settings_file=None):
    """The start screen in this process (the updater and the portable --finish-update have no window of their own),
    so the screen is never empty between the old app closing and the new one opening. None if it can't be shown."""
    if os.environ.get("STELLARHUB_NO_SPLASH") == "1":
        return None
    _language(settings_file)
    try:
        from .. import splash
        splash.show()
        splash.status(tr(text))
        return splash
    except Exception as e:
        print("[update] splash:", e, flush=True)
        return None


def _windows_of(pids):
    """True if any visible top-level window belongs to one of these processes."""
    pids, found = set(pids), []

    @ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)
    def cb(h, _):
        pid = ctypes.c_ulong(0)
        ctypes.windll.user32.GetWindowThreadProcessId(ctypes.c_void_p(h), ctypes.byref(pid))
        if pid.value in pids and ctypes.windll.user32.IsWindowVisible(ctypes.c_void_p(h)):
            found.append(h)
        return 1
    try:
        ctypes.windll.user32.EnumWindows(cb, 0)
    except Exception:
        return False
    return bool(found)


def _installer_window_up(proc, seconds=10):
    """Waits (bounded) until the installer (or the copy of itself it runs from a temp folder) shows its progress
    window, so the start screen can give way to it without a blank moment."""
    end = time.monotonic() + seconds
    try:
        import psutil
        me = psutil.Process(proc.pid)
    except Exception:
        return
    while time.monotonic() < end and proc.poll() is None:
        try:
            pids = [proc.pid] + [c.pid for c in me.children(recursive=True)]
        except Exception:
            pids = [proc.pid]
        if _windows_of(pids):
            return
        time.sleep(0.1)


def _under(path, root):
    if not root:
        return False
    path, root = os.path.normcase(os.path.abspath(path)), os.path.normcase(os.path.abspath(root))
    return path == root or path.startswith(root.rstrip("\\/") + os.sep)


APP_ID = "{0F1795D8-7D52-45CC-8518-7A1E4E76E43E}_is1"  # the installer's AppId (packaging/StellarHub.iss)


def _registered_scope():
    """'machine' or 'user' if the installer registered this very folder (HKLM or HKCU uninstall entry), else None."""
    import winreg
    here = os.path.normcase(os.path.abspath(install_dir())).rstrip("\\")
    for hive, scope in ((winreg.HKEY_LOCAL_MACHINE, "machine"), (winreg.HKEY_CURRENT_USER, "user")):
        try:
            with winreg.OpenKey(hive, "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\" + APP_ID) as k:
                loc = winreg.QueryValueEx(k, "InstallLocation")[0]
            if os.path.normcase(os.path.abspath(loc)).rstrip("\\") == here:
                return scope
        except OSError:
            continue
    return None


def per_machine():
    """Installed for everyone rather than for one user: as the installer registered it (a custom folder like
    D:\\Apps\\StellarHub too), else by whether it lives in Program Files."""
    scope = _registered_scope()
    if scope:
        return scope == "machine"
    return any(_under(install_dir(), os.environ.get(k)) for k in ("ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"))


def _writable(d):
    """Can this process write in folder d? (C:\\StellarHub, for instance, is not writable without rights.)"""
    probe = os.path.join(d, f".stellarhub-write-test-{os.getpid()}")
    try:
        with open(probe, "w") as fh:
            fh.write("1")
        os.remove(probe)
        return True
    except OSError:
        return False


def _admin():
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


# ---------------------------------------------------------------- versions and releases
def parse_version(v):
    m = re.match(r"^\s*v?(\d+(?:\.\d+){0,3})", str(v or ""))
    if not m:
        return None
    parts = [int(x) for x in m.group(1).split(".")]
    return tuple(parts + [0] * (4 - len(parts)))


def newer(a, b):
    """True if version a is newer than version b."""
    pa, pb = parse_version(a), parse_version(b)
    return bool(pa and pb and pa > pb)


def _get(url, limit, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "StellarHub-Updater", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(limit + 1)[:limit]


def _latest():
    """The latest release as GitHub describes it (STELLARHUB_UPDATE_URL points elsewhere in tests)."""
    from .. import paths
    url = paths.env("STELLARHUB_UPDATE_URL") or API
    return json.loads(_get(url, 2 * 1024 * 1024).decode("utf-8"))


def _portable():
    from .. import paths
    return paths.PORTABLE


def manifest(name, ver, sha256_hex):
    """The exact text that is signed for a release file: it binds the file name, the version and the content."""
    return f"StellarHub release\nfile: {name}\nversion: {ver}\nsha256: {sha256_hex.lower()}\n".encode("utf-8")


def signature_ok(name, ver, sha256_hex, sig, keys=None):
    """True if sig (64 raw bytes) is a valid signature of this file's manifest by any trusted key."""
    msg = manifest(name, ver, sha256_hex)
    for k in TRUSTED_KEYS if keys is None else keys:
        try:
            if ed25519.verify(bytes.fromhex(k), msg, sig):
                return True
        except ValueError:
            continue
    return False


def _pick(rel, portable=None):
    """Like pick(), but a release whose file has no .sig comes back with sig_url "" (check() offers its page)."""
    if not isinstance(rel, dict) or rel.get("draft") or rel.get("prerelease"):
        return None
    ver = str(rel.get("tag_name") or "").lstrip("vV")
    if not parse_version(ver):
        return None
    portable = _portable() if portable is None else portable
    pattern = PORTABLE_RE if portable else ASSET_RE
    assets = {str(a.get("name") or ""): a for a in rel.get("assets") or [] if isinstance(a, dict)}
    setup = None
    for name, a in assets.items():
        m = pattern.match(name)
        if m and parse_version(m.group(1)) == parse_version(ver):
            setup = a
            break
    if not setup:
        return None
    url = str(setup.get("browser_download_url") or "")
    sig = str((assets.get(setup["name"] + ".sig") or {}).get("browser_download_url") or "")
    if not url.startswith("https://") or (sig and not sig.startswith("https://")):
        from .. import paths
        if not paths.env("STELLARHUB_UPDATE_URL"):  # tests serve plain http from this PC
            return None
    return {"ver": ver, "setup": {"name": setup["name"], "url": url, "size": int(setup.get("size") or 0)},
            "sig_url": sig, "notes": str(rel.get("body") or "")[:20000], "url": str(rel.get("html_url") or ""),
            "date": str(rel.get("published_at") or "")}


def pick(rel, portable=None):
    """From a GitHub release: {ver, setup: {name, url, size}, sig_url, notes, url, date}, or None when the release
    has no file for this copy for its own version (or is a draft or a pre-release), or that file has no signature
    (.sig asset): such a release is never installed automatically. "setup" is the file this copy updates with: the
    installer, or the .zip in the portable version."""
    info = _pick(rel, portable)
    return info if info and info["sig_url"] else None


# ---------------------------------------------------------------- for the app
def mode():
    """How this copy updates: source (from the source code: no installer), direct (a per-user install, which needs
    no administrator rights, or a copy that already has them), task (installed for all users, through the scheduled
    task) or uac (installed for all users, no task yet: Windows asks once and the updater then makes the task)."""
    if not FROZEN:
        return "source"
    if _portable():
        return "portable"  # replaces its own files where it is (a USB drive): no installer, no rights needed
    if _admin() or (not per_machine() and _writable(install_dir())):
        return "direct"
    return "task" if _task_exists() else "uac"


def check(force=False):
    """Read-only: is there a newer StellarHub on GitHub?"""
    out = {"current": VERSION, "mode": mode()}
    try:
        info = _pick(_latest())
    except Exception as e:  # offline, GitHub down or rate-limited: say so, nothing else
        out.update(ok=False, error=str(e)[:200])
        return out
    if info and not info["sig_url"]:  # a newer release whose file is not signed: only its page, never an install
        if newer(info["ver"], VERSION):
            out.update(ok=True, newer=True, latest=info["ver"], notes=info["notes"], url=info["url"], date=info["date"],
                       size=info["setup"]["size"], mode="page", unsigned=True)
        else:
            out.update(ok=True, newer=False)
        return out
    if not info:
        # a newer release without a file for this kind of copy (e.g. no portable .zip): offer its page instead
        try:
            rel = _latest()
            any_ver = str(rel.get("tag_name") or "").lstrip("vV")
            if newer(any_ver, VERSION):
                out.update(ok=True, newer=True, latest=any_ver, notes=str(rel.get("body") or "")[:20000],
                           url=str(rel.get("html_url") or ""), date=str(rel.get("published_at") or ""), mode="page")
                return out
        except Exception:
            pass
        out.update(ok=True, newer=False)
        return out
    out.update(ok=True, newer=newer(info["ver"], VERSION), latest=info["ver"], notes=info["notes"], url=info["url"],
               date=info["date"], size=info["setup"]["size"])
    return out


def state():
    try:
        with open(state_path(), encoding="utf-8") as fh:
            d = json.load(fh)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def cancel():
    """Asks a running updater to stop (it checks this flag while downloading and while waiting)."""
    try:
        os.makedirs(os.path.dirname(_cancel_flag()), exist_ok=True)
        with open(_cancel_flag(), "w", encoding="utf-8") as fh:
            fh.write("1")
    except OSError:
        return False
    return True


def _clear_cancel():
    try:
        os.remove(_cancel_flag())
    except OSError:
        pass


def _updater_answered(at, seconds=8):
    """The updater writes state.json as soon as it starts: True if it did after `at`."""
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if (state().get("ts") or 0) >= at - 1:
            return True
        time.sleep(.25)
    return False


def start(allow_uac=True):
    """Starts the updater. Returns {ok, mode, at} or {ok: False, error}. allow_uac=False (background download, or
    at start): never shows the Windows prompt; reports {ok: False} instead."""
    m = mode()
    if m == "source":
        return {"ok": False, "mode": m, "error": tr("This copy runs from the source code: download the new version from GitHub.")}
    _clear_cancel()
    at = time.time()
    exe = sys.executable
    try:
        if m in ("direct", "portable"):
            subprocess.Popen([exe, "--self-update"], creationflags=DETACHED | NO_WINDOW, close_fds=True, cwd=install_dir())
        elif m == "task":
            if allow_uac:  # the user's click (not the background download): see _now_flag
                try:
                    os.makedirs(os.path.dirname(_now_flag()), exist_ok=True)
                    open(_now_flag(), "w").close()
                except OSError:
                    pass
            r = subprocess.run(["schtasks", "/run", "/tn", TASK], capture_output=True, creationflags=NO_WINDOW, timeout=20)
            if r.returncode != 0 or not _updater_answered(at):
                from .. import schtask
                schtask.end(TASK)  # queued (an old task on battery) or failed: don't let it start later by surprise
                m = "uac"
        if m == "uac" and not allow_uac:
            return {"ok": False, "mode": m, "error": tr("Windows did not give permission to install the update.")}
        if m == "uac":
            if ctypes.windll.shell32.ShellExecuteW(None, "runas", exe, "--self-update", install_dir(), 0) <= 32:
                return {"ok": False, "mode": m, "error": tr("Windows did not give permission to install the update.")}
    except Exception as e:
        return {"ok": False, "mode": m, "error": str(e)[:200]}
    return {"ok": True, "mode": m, "at": at}


def finish(to, route=None):
    """The updater said "ready": leave a note for after the update and start the helper that reopens StellarHub
    once the installer is done. The app closes right after this."""
    note = {"from": VERSION, "to": str(to)[:20], "route": str(route or "")[:80], "at": time.time()}
    try:
        os.makedirs(_data_dir(), exist_ok=True)
        with open(_pending_path(), "w", encoding="utf-8") as fh:
            json.dump(note, fh)
    except OSError:
        pass
    new = _new_copy() if _portable() else None
    if new:
        # the new copy waits for this one to close, copies itself over it and opens it
        cmd = [os.path.join(new, "StellarHub.exe"), "--finish-update", install_dir(), str(os.getpid())]
        try:
            subprocess.Popen(cmd, cwd=new, close_fds=True, creationflags=NEW_GROUP | BREAKAWAY)
        except OSError:
            subprocess.Popen(cmd, cwd=new, close_fds=True, creationflags=NEW_GROUP)
        return True
    spawn_reopener()
    return True


def spawn_reopener(timeout_min=20):
    """A hidden PowerShell that waits until state.json says the installer finished, then opens StellarHub.
    It runs as the user who has the app open (not with the updater's rights)."""
    ps = (f"$f = '{_ps(state_path())}'; $exe = '{_ps(sys.executable)}'; $end = (Get-Date).AddMinutes({int(timeout_min)});"
          "do { Start-Sleep -Milliseconds 700; $s = $null;"
          " try { $s = Get-Content -Raw -LiteralPath $f -ErrorAction Stop | ConvertFrom-Json } catch {} }"
          " until (($s -and ($s.st -eq 'done' -or $s.st -eq 'failed' -or $s.st -eq 'cancelled')) -or ((Get-Date) -gt $end));"
          " Start-Sleep -Milliseconds 400;"
          " $sid = (Get-Process -Id $PID).SessionId;"
          " if (-not (Get-Process -Name StellarHub -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $sid -and"
          " ($_.Path -eq $exe -or -not $_.Path) })) { Start-Process -FilePath $exe }")
    # a console of its own that has no window (CREATE_NO_WINDOW; not DETACHED_PROCESS: PowerShell started without a
    # console by a windowed app dies right away), so neither "-WindowStyle Hidden" nor "-ExecutionPolicy Bypass" (which
    # never applies to -Command) is passed: both are what antivirus behaviour rules match on. No inherited handles, and
    # out of any job the app may be in, so it outlives the app
    args = ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps]
    kw = dict(stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
    try:
        subprocess.Popen(args, creationflags=NO_WINDOW | NEW_GROUP | BREAKAWAY, **kw)
    except OSError:  # the job does not allow leaving it
        subprocess.Popen(args, creationflags=NO_WINDOW | NEW_GROUP, **kw)


def _ps(s):
    return str(s).replace("'", "''")


def after_update():
    """On the first start after an update: {from, to, ok, route} once, or None."""
    p = _pending_path()
    try:
        with open(p, encoding="utf-8") as fh:
            note = json.load(fh)
    except (OSError, ValueError):
        return None
    try:
        os.remove(p)
    except OSError:
        pass
    if not isinstance(note, dict) or time.time() - float(note.get("at") or 0) > 3 * 86400:
        return None
    note["ok"] = parse_version(note.get("to")) == parse_version(VERSION)
    note["now"] = VERSION
    return note


# ---------------------------------------------------------------- the scheduled task (made by the first elevated update)
def _task_exists():
    try:
        r = subprocess.run(["schtasks", "/query", "/tn", TASK, "/xml"], capture_output=True, timeout=10, creationflags=NO_WINDOW)
    except (OSError, subprocess.SubprocessError):
        return False
    if r.returncode != 0:
        return False
    raw = r.stdout
    xml = raw.decode("utf-16", "replace") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode("oem", "replace")
    m = re.search(r"<Command>(.*?)</Command>", xml, re.S)
    # the XML escapes the path ("&amp;" in a folder named "Tom & Jerry"): compared as plain text, such a task never
    # matched, so every update asked Windows again and made the task once more
    import html
    return bool(m) and os.path.normcase(html.unescape(m.group(1)).strip().strip('"')) == os.path.normcase(sys.executable)


def ensure_task():
    """A task that runs this StellarHub.exe --self-update with administrator rights for the user who made it, started
    on demand only (never on a schedule). Made by the elevated updater of an all-users install (the first update asks
    Windows once; this is what makes the later ones silent) and by --update-task on. Made from XML so it also runs
    on battery (see stellarhub/schtask.py)."""
    from .. import schtask
    return schtask.create(TASK, sys.executable, "--self-update", "Installs StellarHub updates without the Windows "
                          "prompt, when StellarHub asks for it.", multi="IgnoreNew", limit="PT2H")


def _make_task_if_missing():
    """Run by the elevated updater of an all-users install: makes the update task if it isn't there (the installer no
    longer makes it), so the next updates need no Windows prompt. Never stops the update if it fails."""
    try:
        if not _task_exists():
            print("[update] update task:", "created" if ensure_task() else "could not be created", flush=True)
    except Exception as e:
        print("[update] update task:", e, flush=True)


def delete_task():
    subprocess.run(["schtasks", "/delete", "/tn", TASK, "/f"], capture_output=True, creationflags=NO_WINDOW)


# ---------------------------------------------------------------- the updater (--self-update)
def _write_state(**kw):
    kw["ts"] = time.time()
    os.makedirs(update_dir(), exist_ok=True)
    tmp = state_path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(kw, fh)
    for i in range(20):
        try:
            os.replace(tmp, state_path())
            return
        except PermissionError:
            if i == 19:
                raise
            time.sleep(.05)


def _cancelled():
    return os.path.exists(_cancel_flag())


_HELPERS = ("--self-update", "--finish-update", "--quit", "--warm", "--setup", "--admin-task", "--update-task",
            "--uninstall-cleanup", "--multiprocessing")


def _app_running():
    """Another StellarHub.exe from this folder (not this updater) is still open."""
    try:
        import psutil
    except ImportError:
        return False
    me, exe = os.getpid(), os.path.normcase(sys.executable)
    for p in psutil.process_iter(["pid", "name", "exe", "cmdline"]):
        try:
            if p.info["pid"] == me or (p.info["name"] or "").lower() != os.path.basename(exe).lower():
                continue
            # a helper of this program is not the app: another updater waiting for this one's lock (it was counted,
            # and this one waited ten minutes for it and gave up), the installer's --quit, a --warm...
            if any(str(a).startswith(_HELPERS) for a in (p.info["cmdline"] or [])[1:]):
                continue
            if p.info["exe"] is None or os.path.normcase(p.info["exe"]) == exe:
                return True
        except (psutil.Error, OSError):
            continue
    return False


def _download(url, dest, size, on_progress):
    """Streams url into dest; returns the SHA-256. Stops (returns None) if the user cancels."""
    h = hashlib.sha256()
    got = 0
    req = urllib.request.Request(url, headers={"User-Agent": "StellarHub-Updater"})
    with urllib.request.urlopen(req, timeout=30) as r, open(dest, "wb") as fh:
        total = int(r.headers.get("Content-Length") or size or 0)
        last = 0.0
        while True:
            chunk = r.read(256 * 1024)
            if not chunk:
                break
            fh.write(chunk)
            h.update(chunk)
            got += len(chunk)
            if got > 500 * 1024 * 1024:
                raise ValueError(tr("download too large"))
            if time.monotonic() - last > .25:
                last = time.monotonic()
                if _cancelled():
                    return None
                on_progress(got, total)
        on_progress(got, total or got)
    return h.hexdigest()


def run_updater():
    """--self-update. Exit code 0 when it handed over to the installer (or there was nothing to do)."""
    d = update_dir()
    prefetch = os.path.exists(_prefetch_flag())
    _rm(_prefetch_flag())
    if not prefetch:
        _rm(_now_flag())  # this run installs anyway
    try:
        os.makedirs(d, exist_ok=True)
    except OSError:
        return 3
    global _LOCK
    closed = False  # True once the app was told to close: from then on a failure must be shown
    sp = None
    if _LOCK is None:  # (already held when this process runs the updater again: the tests do)
        _LOCK = _one_updater(d)
    if _LOCK is None:
        return 0  # another updater kept going for too long, or the user cancelled while waiting
    if not FROZEN:
        _write_state(st="failed", why="source")
        return 2
    if per_machine() and not _admin() and not _portable():
        _write_state(st="failed", why="admin")
        return 3
    try:
        _write_state(st="checking")
        if per_machine() and _admin() and not _portable():
            _make_task_if_missing()  # the first update of an all-users install: Windows asked once, never again
        info = pick(_latest())
        if not info or not newer(info["ver"], VERSION):
            _write_state(st="uptodate", ver=VERSION)
            return 0
        ver, setup = info["ver"], info["setup"]
        exe = os.path.join(d, setup["name"])
        for f in os.listdir(d):  # what an earlier update left behind (but not this version's file, if downloaded)
            if f.lower().endswith((".exe", ".part", ".log", ".zip")) and f != setup["name"]:
                _rm(os.path.join(d, f))
        sig = _get(info["sig_url"], 4096)
        if not (os.path.isfile(exe) and signature_ok(setup["name"], ver, _sha256(exe), sig)):
            _rm(exe)  # (a file left from before is checked again every time: it may have been swapped meanwhile)
            part = exe + ".part"
            _write_state(st="download", ver=ver, got=0, total=setup["size"])
            digest = _download(setup["url"], part, setup["size"],
                               lambda got, total: _write_state(st="download", ver=ver, got=got, total=total))
            if digest is None:
                _write_state(st="cancelled", ver=ver)
                _rm(part)
                return 0
            _write_state(st="verify", ver=ver)
            if not signature_ok(setup["name"], ver, digest, sig):
                _rm(part)
                _write_state(st="failed", ver=ver, why="signature")
                return 4
            os.replace(part, exe)
        if prefetch and os.path.exists(_now_flag()):  # the user asked for it meanwhile: installed now, not staged
            _rm(_now_flag())
            prefetch = False
        if prefetch:  # downloaded and checked: it is installed the next time StellarHub opens (app.py)
            _write_state(st="staged", ver=ver)
            return 0
        if _cancelled():  # Cancel pressed while the file was checked: never "ready" (the app would close for nothing)
            _rm(exe)
            _write_state(st="cancelled", ver=ver)
            return 0
        portable = _portable()
        if portable:
            try:
                new = unpack_portable(exe, os.path.join(d, "new"))
            finally:
                _rm(exe)
        if portable:
            _write_state(st="ready", ver=ver, new=new)
            return 0  # the app closes and the new copy finishes the update itself (see finish and finish_update)
        _write_state(st="ready", ver=ver)
        closed = True
        sp = _splash("Installing the update…")  # the app is fading out: the screen is never empty from here on
        end = time.monotonic() + 600  # the app closes as soon as it sees "ready"
        while _app_running():
            if _cancelled() or time.monotonic() > end:
                _rm(exe)
                _write_state(st="cancelled", ver=ver)
                return 0
            time.sleep(.3)
        # Once more, right before it runs, and this time the file stays open from the check until Windows has
        # started it: nobody can change, replace or rename it (or a folder above it) in between, and it is started
        # by its real path, so a junction swapped meanwhile can't hand Windows another file (_held).
        try:
            held = _held(exe)
        except OSError as e:
            _rm(exe)
            _write_state(st="failed", ver=ver, why="signature", error=str(e)[:200])
            return 4
        try:
            if not signature_ok(setup["name"], ver, held.sha256, sig):
                held.close()
                _rm(exe)
                _write_state(st="failed", ver=ver, why="signature")
                return 4
            _write_state(st="installing", ver=ver)
            # /SILENT, not /VERYSILENT: Setup shows its small progress window (no pages, no questions) for the 20-60
            # s it takes, instead of nothing at all
            args = [held.path, "/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/NOCANCEL",
                    "/LOG=" + os.path.join(d, "setup.log"), "/SELFUPDATE=" + state_path()]
            args.append("/ALLUSERS" if per_machine() else "/CURRENTUSER")
            env = None
            if _admin():
                # Setup's "open StellarHub" would run elevated from here (Inno's runasoriginaluser does nothing when
                # Setup itself was started elevated): the app would come back as administrator, or as the account
                # that answered the prompt. The reopener the app left (spawn_reopener) runs as the user and opens it.
                args.append("/NOREOPEN=1")
                env = _admin_temp_env()
            args.append("/DIR=" + install_dir())
            proc = subprocess.Popen(args, creationflags=DETACHED, close_fds=True, cwd=d, env=env)
        finally:
            held.close()
        if sp is not None:
            _installer_window_up(proc)  # then this process exits: the installer replaces this very program
        return 0
    except Exception as e:
        _write_state(st="failed", why="error", error=str(e)[:200])
        if closed:
            _alert(tr("The update could not be installed. StellarHub will open again as it was."))
            if not _admin():  # elevated: the user's reopener opens it (as the user) once it reads "failed"
                try:
                    subprocess.Popen([sys.executable], cwd=install_dir(), close_fds=True)
                except OSError:
                    pass
        return 5


_LOCK = None


def _one_updater(d, wait=900):
    """Only one updater works at a time (two would write the same file): waits for the other one to end, then the
    file it downloaded is simply reused. The lock goes away with the process."""
    import msvcrt
    try:
        fh = open(os.path.join(d, "updater.lock"), "a+b")
    except OSError:
        return True
    end = time.monotonic() + wait
    while True:
        try:
            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
            return fh
        except OSError:
            if time.monotonic() > end or _cancelled():
                fh.close()
                return None
            time.sleep(.5)


class _held:
    """A file opened so that, while it is open, nobody can write it, delete it or rename it or any folder above it
    (read sharing only), with its SHA-256 read through that same handle and its real path (junctions and links
    resolved). Windows can still run it: starting a program only needs to read it."""

    def __init__(self, path):
        import msvcrt
        from ctypes import wintypes as wt
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.CreateFileW.restype = ctypes.c_void_p
        k32.CreateFileW.argtypes = [wt.LPCWSTR, wt.DWORD, wt.DWORD, ctypes.c_void_p, wt.DWORD, wt.DWORD, ctypes.c_void_p]
        k32.GetFinalPathNameByHandleW.argtypes = [ctypes.c_void_p, wt.LPWSTR, wt.DWORD, wt.DWORD]
        k32.CloseHandle.argtypes = [ctypes.c_void_p]
        h = k32.CreateFileW(path, 0x80000000, 0x1, None, 3, 0x80, None)  # GENERIC_READ, FILE_SHARE_READ, OPEN_EXISTING
        if not h or h == ctypes.c_void_p(-1).value:
            raise OSError(ctypes.get_last_error(), "the installer could not be opened", path)
        try:
            buf = ctypes.create_unicode_buffer(32768)
            n = k32.GetFinalPathNameByHandleW(h, buf, 32768, 0)
            if not n or n >= 32768:
                raise OSError(ctypes.get_last_error(), "the installer's real path could not be read", path)
            real = buf.value
            if real.startswith("\\\\?\\UNC\\"):
                real = "\\\\" + real[8:]
            elif real.startswith("\\\\?\\"):
                real = real[4:]
            self.fd = msvcrt.open_osfhandle(h, os.O_RDONLY)
        except BaseException:
            k32.CloseHandle(h)
            raise
        self.path = real
        hs = hashlib.sha256()
        with open(self.fd, "rb", closefd=False) as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                hs.update(chunk)
        self.sha256 = hs.hexdigest()

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None


def _admin_temp_env():
    """The installer's environment when it runs elevated: its temporary folder (where Setup unpacks and runs its own
    files) is Windows' own Temp, where a program running as the user can't change what an administrator wrote, instead
    of the user's %TEMP%. The Windows folder is asked from Windows, not read from the (user-settable) environment."""
    env = dict(os.environ)
    buf = ctypes.create_unicode_buffer(260)
    if ctypes.windll.kernel32.GetSystemWindowsDirectoryW(buf, 260):
        tmp = os.path.join(buf.value, "Temp")
        if os.path.isdir(tmp):
            env["TEMP"] = env["TMP"] = tmp
    return env


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def prefetch():
    """Downloads a new version in the background, to be installed the next time StellarHub opens (new features:
    x.Y.0). Only where no Windows prompt is needed: a copy that can update itself, or through the update task."""
    m = mode()
    if m not in ("direct", "portable", "task"):
        return {"ok": False, "mode": m}
    _rm(_now_flag())  # an old one must not turn this background download into an install
    try:
        os.makedirs(os.path.dirname(_prefetch_flag()), exist_ok=True)
        open(_prefetch_flag(), "w").close()
    except OSError:
        return {"ok": False, "mode": m}
    r = start(allow_uac=False)
    if not r.get("ok") or r.get("mode") == "uac":
        _rm(_prefetch_flag())
        return {"ok": False, "mode": r.get("mode")}
    return r


def staged():
    """The version downloaded and waiting for the next start, or None."""
    st = state()
    if st.get("st") != "staged" or not newer(st.get("ver"), VERSION):
        return None
    return st.get("ver")


def apply_staged_at_start(say=None, timeout=120):
    """At start, before the window: installs the staged version. Starts the updater (which checks the file against
    GitHub again and reuses it), waits for "ready", hands over (finish) and returns True: the app must then exit
    right away and comes back updated. False if anything is off; the app then simply starts as usual."""
    ver = staged()
    if not ver:
        return False
    if say:
        say(tr("Updating to {v}…", v=ver))
    r = start(allow_uac=True)  # an all-users install without the task asks Windows once (the user staged this update)
    if not r.get("ok"):
        return False
    handing = _hand_over_splash(say)
    ok = _wait_staged(ver, r, say, timeout)
    if handing is not None:
        if ok:  # this process exits now: the updater's start screen replaces this one first (bounded)
            end = time.monotonic() + 4
            while time.monotonic() < end and not handing.handed() and handing.showing():
                time.sleep(0.02)
        elif not handing.handed():  # the update did not go ahead: the start screen is this process's own again
            handing.hand_over(False)
    return ok


def _hand_over_splash(say):
    """The start screen this process shows (when it has one), marked for the updater to take over (splash.py)."""
    if not say:
        return None
    try:
        from .. import splash
        if splash.showing() and splash.hand_over():
            return splash
    except Exception as e:
        print("[update] splash handoff:", e, flush=True)
    return None


def _wait_staged(ver, r, say, timeout):
    at, end = r.get("at") or time.time(), time.monotonic() + timeout
    while time.monotonic() < end:
        st = state()
        if (st.get("ts") or 0) >= at - 1:
            if say and st.get("st") == "download" and st.get("total"):
                say(tr("Updating to {v}… {p}%", v=ver, p=int(100 * (st.get("got") or 0) / st["total"])))
            if st.get("st") == "ready":
                if say:
                    say(tr("Installing the update…"))
                finish(st.get("ver") or ver, "home")
                return True
            if st.get("st") in ("failed", "uptodate", "cancelled"):
                print(f"[update] the staged update was not applied at start: {st.get('st')} {st.get('why') or ''}", flush=True)
                return False
        time.sleep(.3)
    print("[update] the staged update took too long at start: cancelled, opening as it was", flush=True)
    cancel()
    return False


def unpack_portable(zip_path, dest):
    """Unpacks the portable .zip into dest and returns the folder that holds StellarHub.exe. Refuses anything that
    would land outside dest, and a .zip without StellarHub.exe."""
    import shutil
    import zipfile
    shutil.rmtree(dest, ignore_errors=True)
    os.makedirs(dest)
    root = os.path.realpath(dest)
    with zipfile.ZipFile(zip_path) as z:
        for n in z.namelist():
            target = os.path.realpath(os.path.join(dest, n))
            if not (target == root or target.startswith(root + os.sep)):
                raise ValueError(tr("unsafe path in the update: {name}", name=n))
        z.extractall(dest)
    for base in (dest, *[os.path.join(dest, x) for x in os.listdir(dest)]):
        if os.path.isfile(os.path.join(base, "StellarHub.exe")):
            return base
    raise ValueError(tr("the update has no StellarHub.exe"))


def _new_copy():
    """Where the updater unpacked the new portable copy (only inside this copy's update folder)."""
    new = state().get("new") or ""
    d = os.path.realpath(update_dir())
    if new and os.path.realpath(new).startswith(d + os.sep) and os.path.isfile(os.path.join(new, "StellarHub.exe")):
        return new
    return None


def finish_update(dst, pid):
    """--finish-update <dst> <pid>, run by the NEW portable copy (unpacked in <dst>/update/new): waits for the old
    StellarHub to close, copies its own program files over the old ones (the Data folder with the settings and the
    update folder are left alone; the old files come back if something fails), then opens the updated StellarHub.
    No script and no hidden process: the updated program installs itself, as installers do."""
    import shutil
    src = install_dir()
    dst = os.path.realpath(dst)
    state_file = os.path.join(dst, "update", "state.json")
    exe = os.path.join(dst, "StellarHub.exe")

    def report(**kw):
        kw["ts"] = time.time()
        try:
            with open(state_file, "w", encoding="utf-8") as fh:
                json.dump(kw, fh)
        except OSError:
            pass
    here = os.path.realpath(src)
    if not os.path.isfile(exe) or not _under(here, dst) or os.path.normcase(here) == os.path.normcase(dst):
        # (_under, not startswith(dst + os.sep): a copy at the root of a drive, E:\, has dst "E:\" already)
        report(st="failed", why="apply", error="unexpected location")
        _alert(tr("The update could not be applied: this copy is not where it should be."))
        if os.path.isfile(exe):
            subprocess.Popen([exe], cwd=dst, close_fds=True)
        return 2  # only ever from <dst>\update\...
    # up while the old copy closes and the files are put in place, in the language of the copy being updated
    sp = _splash("Installing the update…", os.path.join(dst, "Data", "settings.json"))
    try:
        import psutil
        psutil.Process(int(pid)).wait(timeout=60)
    except Exception:
        pass
    end = time.monotonic() + 30
    while time.monotonic() < end:
        try:
            with open(exe, "r+b"):
                break  # nobody holds the old program any more
        except OSError:
            time.sleep(.3)
    moved = []
    try:
        for name in os.listdir(src):
            if name.lower() in ("data", "update"):
                continue
            target = os.path.join(dst, name)
            if os.path.exists(target):
                old = target + ".old"
                if os.path.isdir(old):
                    shutil.rmtree(old, ignore_errors=True)
                elif os.path.exists(old):
                    os.remove(old)
                os.replace(target, old)
                moved.append((target, old))
            if os.path.isdir(os.path.join(src, name)):
                shutil.copytree(os.path.join(src, name), target)
            else:
                shutil.copy2(os.path.join(src, name), target)
    except Exception as e:
        for target, old in reversed(moved):  # put the old version back
            try:
                if os.path.isdir(target):
                    shutil.rmtree(target, ignore_errors=True)
                elif os.path.exists(target):
                    os.remove(target)
                os.replace(old, target)
            except OSError:
                pass
        report(st="failed", why="apply", error=str(e)[:200])
        _alert(tr("The update could not be installed. StellarHub will open again as it was."))
        subprocess.Popen([exe], cwd=dst, close_fds=True)
        return 5
    for _target, old in moved:
        if os.path.isdir(old):
            shutil.rmtree(old, ignore_errors=True)
        else:
            try:
                os.remove(old)
            except OSError:
                pass
    report(st="done", ver=VERSION)
    if sp is not None:
        sp.hand_over()  # the updated app takes this start screen over (splash.py): never two on screen
    subprocess.Popen([exe], cwd=dst, close_fds=True)
    if sp is not None:  # no gap: hold this start screen until the updated app has put up its own
        end = time.monotonic() + 8
        while time.monotonic() < end and not sp.other_showing():
            time.sleep(0.1)
    return 0


def cleanup_after_update():
    """On start: remove what a finished portable update left (the unpacked copy can't delete itself)."""
    import shutil
    d = update_dir()
    new = os.path.join(d, "new")
    if os.path.isdir(new) and state().get("st") in ("done", "failed", "cancelled", "uptodate"):
        time.sleep(4)  # the copy that finished the update is still closing
        shutil.rmtree(new, ignore_errors=True)


def _rm(p):
    try:
        os.remove(p)
    except OSError:
        pass
