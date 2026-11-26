"""Autopilot: runs the user's routines for real while StellarHub is open (also hidden in the tray).

Routines are saved by the UI in the app settings (key "autopilotRoutines"; format defined in ui/js/modules/autopilot.js):
    {id, on, name, color, pausedUntil, triggers:[{k,p}], condMode:'all'|'any', conds:[{k,p}], acts:[{k,p}],
     after:{onFail, retries, limit, okThen, failThen, okRoutine, failRoutine}, notify:{when, toast, tray}}

How it works
- A background thread wakes up every few seconds, re-reads the routines (so edits apply at once), evaluates the
  triggers against real system state and, when one fires, checks the conditions and runs the actions in order by
  calling the other engines (optimizer, updater, drivers, storage, remover…). Runs go through engine/jobs.py, so the
  UI gets live progress, and every run is written to a log (autopilot/log.json next to settings.json).
- Scheduled times that were missed while StellarHub was closed are caught up if they are less than 12 hours old.
  A routine never fires for times that passed before it existed.
- Things Windows does not let a background app detect reliably are marked unavailable (capabilities()), and the UI
  says so instead of pretending.

Techniques (and why):
- Idle time: GetLastInputInfo vs GetTickCount, masked to 32 bits so the 49.7-day tick wraparound doesn't break it.
- Full screen: SHQueryUserNotificationState (2 = busy/full screen, 3 = Direct3D exclusive full screen,
  4 = presentation mode). Microsoft sends no event when it changes, so it is polled.
- Locked session: LogonUI.exe is running while the lock screen is shown.
- Microphone/camera in use: CapabilityAccessManager\\ConsentStore; an app whose LastUsedTimeStop is 0 with a start
  time set is using the device right now.
- Power: GetSystemPowerStatus (AC line, battery %).

Texts: what reaches the user now (progress, notifications, errors) goes through tc("autopilot", …), which looks up the
"autopilot|…" key first (short words can mean something else elsewhere). Log texts are stored twice: in
English, and as a message {"t": English text, "v": {values}} that the interface translates when it shows it (see
_m/_render), so the log follows the language even for entries written before it changed.
"""
import ctypes
import hashlib
import json
import os
import stat
import subprocess
import threading
import time
import uuid
import winreg
from ctypes import wintypes
from datetime import datetime, timedelta

import psutil

from . import jobs
from ..i18n import language, tc

EXPORTS = {"start", "status", "dry_run", "capabilities", "log", "clear_log", "approve"}
JOBS = {"run"}

NO_WINDOW = 0x08000000
TICK = 10            # seconds between checks
CATCH_UP = 12 * 3600  # missed scheduled runs younger than this still run

_lock = threading.RLock()
_thread = None
_stop = threading.Event()
_running = set()          # routine ids running right now
_queue = []               # (rid, routine, manual, reason)
_notify = None            # set by attach(): function(title, text)
_mute_timer = None


# =============================================================== small helpers
def _admin():
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _settings_path():
    import sys
    app = sys.modules.get("stellarhub.app")
    if app is not None and getattr(app, "SETTINGS", None):
        return app.SETTINGS
    from .. import paths
    return paths.settings_file()


def _data_dir():
    """Log and trigger state live next to settings.json (a copy of the settings gets its own log: safe for tests)."""
    sp = _settings_path()
    stem = os.path.splitext(os.path.basename(sp))[0]
    return os.path.join(os.path.dirname(sp), "autopilot" if stem == "settings" else stem + "_autopilot")


def _log_file():
    return os.path.join(_data_dir(), "log.json")


def _state_file():
    return os.path.join(_data_dir(), "state.json")


def _settings():
    try:
        with open(_settings_path(), encoding="utf-8") as fh:
            d = json.load(fh)
            return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _load(path, default):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def _save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False)
    os.replace(tmp, path)


def _emit(kind, **data):
    try:
        jobs._emit("autopilot", {"kind": kind, **data})
    except Exception:
        pass


def attach(notify=None):
    """Called by the app at startup: how to show a Windows/tray notification. Also starts the scheduler."""
    global _notify
    if notify:
        _notify = notify
    start()


def _say_notify(title, text):
    if _notify:
        try:
            _notify(title, text)
            return
        except Exception:
            pass
    _emit("toast", text=tc("autopilot", "{name}: {result}", name=title, result=text))


# =============================================================== log texts
def _m(_text, **v):
    """A log text: the English sentence (also the translation key) and its values. A value may be another message,
    {"n1": number} (shown with one decimal) or {"wd": 0-6} (a weekday, Monday = 0)."""
    return {"t": _text, "v": v} if v else {"t": _text}


def _n1(x):
    return {"n1": round(float(x), 1)}


_DAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


def _render(m, translate=True):
    """The text of a message: translated (for what is shown now) or English (what is stored next to it)."""
    if m is None:
        return ""
    if not isinstance(m, dict):
        return tc("autopilot", str(m)) if translate else str(m)
    if "n1" in m:
        s = f"{float(m['n1']):.1f}"
        return s.replace(".", ",") if translate and language() in ("es", "pt", "it", "fr", "ru") else s
    if "wd" in m:
        d = _DAYS[int(m["wd"]) % 7]
        return tc("autopilot", d) if translate else d
    vals = {k: (_render(x, translate) if isinstance(x, dict) else x) for k, x in (m.get("v") or {}).items()}
    text = m.get("t", "")
    if translate:
        return tc("autopilot", text, **vals)
    try:
        return text.format(**vals) if vals else text
    except (KeyError, IndexError, ValueError):
        return text


def _txt(m):
    return _render(m, True)


def _en(m):
    return _render(m, False)


def _msg(x):
    """A message from a message or a plain text (reasons saved by older versions are plain English)."""
    return x if isinstance(x, dict) else _m(str(x or ""))


# =============================================================== system state
class _LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]


def idle_seconds():
    li = _LASTINPUTINFO()
    li.cbSize = ctypes.sizeof(li)
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(li)):
        return 0
    now = ctypes.windll.kernel32.GetTickCount() & 0xFFFFFFFF
    return ((now - li.dwTime) & 0xFFFFFFFF) / 1000.0  # masked: survives the 49.7-day wraparound


class _SPS(ctypes.Structure):
    _fields_ = [("ACLineStatus", ctypes.c_byte), ("BatteryFlag", ctypes.c_byte), ("BatteryLifePercent", ctypes.c_byte),
                ("SystemStatusFlag", ctypes.c_byte), ("BatteryLifeTime", wintypes.DWORD), ("BatteryFullLifeTime", wintypes.DWORD)]


def battery_saver():
    s = _SPS()
    return bool(ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(s)) and (s.SystemStatusFlag & 1))


def power():
    """(plugged: bool|None, battery %: int|None)."""
    s = _SPS()
    if not ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(s)):
        return None, None
    ac = {0: False, 1: True}.get(s.ACLineStatus & 0xFF)
    pct = s.BatteryLifePercent & 0xFF
    no_battery = (s.BatteryFlag & 0xFF) == 128
    return ac, (None if pct == 255 or no_battery else pct)


def fullscreen_state():
    """0 = nothing, otherwise the QUERY_USER_NOTIFICATION_STATE value (2 busy/full screen, 3 D3D full screen, 4 presentation)."""
    st = ctypes.c_int(0)
    try:
        if ctypes.windll.shell32.SHQueryUserNotificationState(ctypes.byref(st)) != 0:
            return 0
    except Exception:
        return 0
    return st.value if st.value in (2, 3, 4) else 0


def locked():
    return any((p.info.get("name") or "").lower() == "logonui.exe" for p in psutil.process_iter(["name"]))


def _consent_in_use(cap):
    """True if an app is using the microphone/webcam right now (LastUsedTimeStop == 0 with a start set)."""
    base = rf"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\{cap}"

    def scan(path):
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path) as k:
                for i in range(winreg.QueryInfoKey(k)[0]):
                    sub = winreg.EnumKey(k, i)
                    if sub == "NonPackaged":
                        if scan(path + "\\NonPackaged"):
                            return True
                        continue
                    try:
                        with winreg.OpenKey(k, sub) as s:
                            start = winreg.QueryValueEx(s, "LastUsedTimeStart")[0]
                            stop = winreg.QueryValueEx(s, "LastUsedTimeStop")[0]
                            if start and not stop:
                                return True
                    except OSError:
                        pass
        except OSError:
            pass
        return False
    return scan(base)


def in_call():
    return _consent_in_use("microphone") or _consent_in_use("webcam")


def wifi_ssid():
    """The connected Wi-Fi network's name, from Windows' Wi-Fi API in this process (engine/wlan.py; it was netsh)."""
    try:
        from . import wlan
        return wlan.ssid()
    except Exception:
        return None


def _metered_com():
    """The cost of the internet connection from Windows' network list manager (INetworkCostManager::GetCost), a COM
    call from this process: the same answer as the WinRT NetworkCostType, without starting powershell.exe. True when
    the connection is fixed or variable (metered), False when unrestricted or unknown; raises if COM does not answer."""
    import uuid
    from ctypes import POINTER, byref, c_void_p, wintypes

    class GUID(ctypes.Structure):
        _fields_ = [("a", ctypes.c_uint32), ("b", ctypes.c_uint16), ("c", ctypes.c_uint16), ("d", ctypes.c_ubyte * 8)]

    def guid(text):
        u, g = uuid.UUID(text), GUID()
        g.a, g.b, g.c = u.time_low, u.time_mid, u.time_hi_version
        g.d[:] = u.bytes[8:]
        return g
    ole32 = ctypes.windll.ole32
    ole32.CoCreateInstance.argtypes = [POINTER(GUID), c_void_p, wintypes.DWORD, POINTER(GUID), POINTER(c_void_p)]
    ole32.CoCreateInstance.restype = ctypes.c_long
    init = ole32.CoInitializeEx(None, 0) & 0xFFFFFFFF  # S_OK / S_FALSE: ours to undo; a different mode already set: fine
    mgr = c_void_p()
    try:
        # CLSID_NetworkListManager, IID_INetworkCostManager
        hr = ole32.CoCreateInstance(byref(guid("DCB00C01-570F-4A9B-8D69-199FDBA5723B")), None, 1 | 4,
                                    byref(guid("DCB00008-570F-4A9B-8D69-199FDBA5723B")), byref(mgr))
        if hr != 0 or not mgr:
            raise OSError(f"CoCreateInstance 0x{hr & 0xFFFFFFFF:08x}")
        vtbl = ctypes.cast(mgr, POINTER(POINTER(c_void_p)))[0]
        cost = wintypes.DWORD(0)
        hr = ctypes.WINFUNCTYPE(ctypes.c_long, c_void_p, POINTER(wintypes.DWORD), c_void_p)(vtbl[3])(mgr, byref(cost), None)
        ctypes.WINFUNCTYPE(ctypes.c_ulong, c_void_p)(vtbl[2])(mgr)  # Release
        if hr != 0:
            raise OSError(f"GetCost 0x{hr & 0xFFFFFFFF:08x}")
        return bool(cost.value & (0x2 | 0x4))  # NLM_CONNECTION_COST_FIXED | _VARIABLE
    finally:
        if init in (0, 1):
            ole32.CoUninitialize()


def metered():
    """True/False, or None if Windows didn't answer."""
    try:
        return _metered_com()
    except Exception:
        pass  # (no COM answer: ask Windows through PowerShell, as before)
    try:
        out = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
                              "[void][Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime];"
                              "$p=[Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile();"
                              "if($p){$p.GetConnectionCost().NetworkCostType}"], capture_output=True, timeout=15,
                             creationflags=NO_WINDOW).stdout.decode("utf-8", "replace").strip()
        if not out:
            return None
        return out.lower() not in ("unrestricted", "unknown")
    except Exception:
        return None


def free_gb(drive):
    try:
        return psutil.disk_usage(drive.rstrip("\\") + "\\").free / 1024 ** 3
    except OSError:
        return None


# apps the UI offers, mapped to their process names
APP_PROCS = {
    "steam": ["steam.exe"], "epic games": ["epicgameslauncher.exe"], "fl studio": ["fl64.exe", "fl.exe"],
    "brave": ["brave.exe"], "discord": ["discord.exe"], "obs studio": ["obs64.exe", "obs32.exe", "obs.exe"],
    "medal": ["medal.exe"], "spotify": ["spotify.exe"], "onedrive": ["onedrive.exe"],
}


def app_running(app):
    a = (app or "").strip().lower()
    if a == "any game":
        return fullscreen_state() == 3
    names = set(APP_PROCS.get(a, [a if a.endswith(".exe") else a + ".exe"]))
    return any((p.info.get("name") or "").lower() in names for p in psutil.process_iter(["name"]))


def gpu_temp(wake=False):
    """The NVIDIA graphics card's temperature through NVML in this process (it was a run of nvidia-smi.exe), or None.
    A card that is powered down is not woken (the temperature trigger asks every 10 s, and on an Optimus laptop that
    kept the card awake on battery): it is cool, so None. wake=True asks anyway (the one-off "is there a card" check)."""
    try:
        from .telemetry import nvidia_asleep, nvml_once
        if not wake and nvidia_asleep():
            return None
        t = (nvml_once() or {}).get("temp")
        return float(t) if t is not None else None
    except Exception:
        return None


def cpu_temp():
    if not _admin():
        return None
    try:
        import clr  # noqa: F401
        clr.AddReference("System.Management")
        from System.Management import ManagementObjectSearcher
        en = ManagementObjectSearcher(r"root\WMI", "SELECT CurrentTemperature FROM MSAcpi_ThermalZoneTemperature").Get().GetEnumerator()
        temps = []
        while en.MoveNext():   # never list()/len(): a denied WMI query would crash the process through pythonnet
            c = int(en.Current["CurrentTemperature"]) / 10 - 273.15
            if 25 < c < 110:
                temps.append(c)
        return max(temps) if temps else None
    except Exception:
        return None


def _downloads_dir(name):
    name = (name or "").strip() or "Downloads"
    if os.path.isabs(name):
        return name
    try:
        from .removal import paths as _p
        d = _p.kf("Downloads")
        if d and name.lower() == "downloads":
            return d
    except Exception:
        pass
    return os.path.join(os.path.expanduser("~"), name)


def _downloads_ok(d):
    """False when `d` is not a place where old files can be cleaned safely: the user profile, a drive root, a folder
    that contains the profile or another known folder (Documents, Desktop, OneDrive...), or a Windows/program folder."""
    try:
        from .removal import paths as rp
        n = rp.norm_path(os.path.realpath(d))
        if not n or not os.path.isabs(n) or len(n) <= 3 or not os.path.isdir(n):
            return False
        k = rp.known_folders()
        for name, v in k.items():
            if name != "Downloads" and v and rp.is_within(v, n):       # n is that folder or holds it
                return False
        for name in ("Windows", "ProgramFiles", "ProgramFilesX86", "ProgramData"):
            if k.get(name) and rp.is_within(n, k[name]):
                return False
        return True
    except Exception:
        return False


def _stamp(st):
    """When a file was last really touched: the latest of its modified, changed and creation times. A copied or
    extracted file keeps its old modified time but gets a new creation time."""
    return max(st.st_mtime, st.st_ctime, getattr(st, "st_birthtime", 0) or 0)


def _newest_activity(path, st, cap=5000):
    """The newest time of a file, or of a folder and everything inside it. A folder too big to judge (more than `cap`
    items) counts as recent, so it is left alone."""
    t = _stamp(st)
    if not stat.S_ISDIR(st.st_mode):
        return t
    seen, stack = 0, [path]
    while stack:
        try:
            it = os.scandir(stack.pop())
        except OSError:
            continue
        with it:
            for e in it:
                seen += 1
                if seen > cap:
                    return time.time()
                try:
                    est = e.stat(follow_symlinks=False)
                except OSError:
                    continue
                t = max(t, _stamp(est))
                if e.is_dir(follow_symlinks=False) and not e.is_symlink():
                    stack.append(e.path)
    return t


def _grew_bytes(cmp_):
    """Bytes that grew according to storage.compare(): changes are [path, delta, dfiles] (older code expected
    dicts, both are read); with no changes listed, the total growth."""
    total = 0
    for c in cmp_.get("changes") or []:
        d = c[1] if isinstance(c, (list, tuple)) and len(c) > 1 else (c.get("delta", 0) if isinstance(c, dict) else 0)
        if isinstance(d, (int, float)) and d > 0:
            total += d
    if not total and isinstance(cmp_.get("delta"), (int, float)):
        total = max(0, cmp_["delta"])
    return total


def _storage():
    from . import storage
    return storage


# =============================================================== approved commands (administrator mode)
# Routines live in settings.json, which any program running as the user can edit. When StellarHub runs elevated, a
# "run a command" / "open a program" action would hand that program administrator rights, so in that mode only the
# actions the user saved from the UI (while elevated) run. Their SHA-256 hashes are kept in HKLM, where only
# administrators can write (Users can only read).
APPROVED_KEY = r"SOFTWARE\StellarHub\AutopilotApproved"
NEEDS_APPROVAL = ("cmd", "openApp")


def _action_hash(a):
    """SHA-256 of what an action would run (None for actions that need no approval)."""
    k, p = a.get("k"), a.get("p") or {}
    if k == "cmd":
        data = {"k": "cmd", "cmd": str(p.get("cmd") or "").strip(), "as": "admin" if p.get("as") == "admin" else "user"}
    elif k == "openApp":
        data = {"k": "openApp", "path": str(p.get("path") or "").strip().strip('"')}
    else:
        return None
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()


def _approved_load():
    out = set()
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, APPROVED_KEY, 0, winreg.KEY_READ | winreg.KEY_WOW64_64KEY) as k:
            for i in range(winreg.QueryInfoKey(k)[1]):
                out.add(winreg.EnumValue(k, i)[0].lower())
    except OSError:
        pass
    return out


def _approved_add(hashes):
    """Writes the hashes (needs administrator rights). True if it worked."""
    try:
        with winreg.CreateKeyEx(winreg.HKEY_LOCAL_MACHINE, APPROVED_KEY, 0, winreg.KEY_SET_VALUE | winreg.KEY_WOW64_64KEY) as k:
            for h in hashes:
                winreg.SetValueEx(k, h, 0, winreg.REG_SZ, "1")
        return True
    except OSError:
        return False


def is_approved(a):
    """True when the action may run now: it needs no approval, StellarHub is not elevated, or the user approved it."""
    h = _action_hash(a)
    return h is None or not _admin() or h in _approved_load()


def approve(routines):
    """The UI calls this when the user saves a routine: its command / open-app actions are approved, but only while
    StellarHub is elevated (otherwise a program running as the user could approve its own actions)."""
    if not _admin():
        return {"ok": False, "admin": False, "n": 0}
    rs = routines if isinstance(routines, list) else [routines]
    hs = {h for r in rs if isinstance(r, dict) for a in (r.get("acts") or []) if isinstance(a, dict)
          for h in [_action_hash(a)] if h}
    ok = _approved_add(hs) if hs else True
    return {"ok": ok, "admin": True, "n": len(hs)}


_AS_USER_ELEVATED = _m("skipped: this command runs as you, and StellarHub is running as administrator. Open StellarHub in "
                       "normal mode to run it, or set it to run as administrator")


def _closable(pr):
    """"Close an app" only ends the user's own programs: never another account's or Windows' own processes (from an
    elevated StellarHub it could end anything, and routines live in a file any program running as the user can edit),
    nor StellarHub itself."""
    try:
        if pr.pid == os.getpid():
            return False
        me = _me().lower()
        if not me or (pr.username() or "").lower() != me:
            return False
        exe = (pr.exe() or "").lower()
    except (psutil.Error, OSError):
        return False
    buf = ctypes.create_unicode_buffer(260)  # asked from Windows: %SystemRoot% is the user's to change
    windir = (buf.value if ctypes.windll.kernel32.GetSystemWindowsDirectoryW(buf, 260) else r"C:\Windows").lower().rstrip("\\") + "\\"
    return bool(exe) and not exe.startswith(windir)


def _me():
    try:
        return psutil.Process().username() or ""
    except (psutil.Error, OSError):
        return ""  # unknown: nothing is closed


_NOT_APPROVED = _m("skipped: this action wasn’t approved in administrator mode. Open StellarHub and save this routine again to allow it")


# =============================================================== capabilities
CLEAN_MAP = {
    "Windows temporary files": ["win_temp"], "User temporary files": ["user_temp"],
    "Browser caches": ["chrome", "edge", "brave", "opera", "firefox"], "Thumbnails": ["thumbs"],
    "Crash dumps": ["dumps"], "Windows Update leftovers": ["wu_cache"], "Delivery Optimization": ["do_cache"],
    "Shader caches": ["nvidia"], "Old logs": [], "Program leftovers": [],
}
UNAVAILABLE = {
    "t": {"shutdown": "Windows only tells the app in front that it's shutting down, so StellarHub can't run things on shutdown yet."},
    "c": {},
    "a": {},
}


def _engine_has(mod, fn, kind="call"):
    try:
        from . import resolve
        resolve(mod, fn, kind)
        return True
    except Exception:
        return False


def capabilities():
    """What works for real. {t:{k:reason}, c:{...}, a:{...}} lists only what is NOT available, with the reason
    (translated: the interface shows it as it comes)."""
    return {s: {k: _txt(m) for k, m in d.items()} for s, d in _caps().items()}


def _caps():
    """capabilities() as messages."""
    out = {"t": {k: _m(v) for k, v in UNAVAILABLE["t"].items()}, "c": {}, "a": {}}
    need = {
        "clean": ("optimizer", "clean", "job"), "recycle": ("optimizer", "clean", "job"),
        "restore": ("optimizer", "restore_point", "job"), "sfc": ("optimizer", "repair", "job"),
        "explorer": ("optimizer", "repair", "job"), "plan": ("optimizer", "perf_set", "call"),
        "game": ("optimizer", "perf_set", "call"), "drvScan": ("drivers", "search", "job"),
        "drvInstall": ("drivers", "install", "job"), "drvBackup": ("drivers", "export", "job"),
        "apps": ("updater", "install", "job"), "winUpd": ("updater", "scan_windows", "job"),
        "store": ("updater", "install", "job"), "defender": ("updater", "install", "job"),
        "quar": ("remover", "quarantine_list", "call"), "dupes": ("storage", "duplicates", "job"),
        "scanDisk": ("storage", "scan", "job"), "oldDl": ("storage", "trash", "call"),
    }
    for k, (m, f, kind) in need.items():
        if not _engine_has(m, f, kind):
            out["a"][k] = _m("The {engine} engine isn't available in this version.", engine=m)
    if not _gpu_ok():
        out["c"]["__gpu"] = _m("No NVIDIA graphics card found: graphics card temperature can't be read.")
    return out


_gpu_cache = {}


def _gpu_ok():
    if "ok" not in _gpu_cache:
        _gpu_cache["ok"] = gpu_temp(wake=True) is not None   # a card asleep right now is still there
    return _gpu_cache["ok"]


# =============================================================== log and state
def log(limit=100):
    return _load(_log_file(), [])[:limit]


def clear_log():
    with _lock:
        _save(_log_file(), [])
    _emit("log")
    return True


def _append_log(entry):
    with _lock:
        lg = _load(_log_file(), [])
        lg.insert(0, entry)
        _save(_log_file(), lg[:200])
    _emit("log", entry=entry)


def _state():
    return _load(_state_file(), {"fired": {}, "ev": {}, "last": {}})


def _save_state(st):
    with _lock:
        _save(_state_file(), st)


def status():
    return {"running": bool(_thread and _thread.is_alive()), "busy": sorted(_running), "queued": [q[0] for q in _queue],
            "admin": _admin(), "tick": TICK, "catchUpHours": CATCH_UP // 3600}


# =============================================================== schedule maths
def _hm(s, default="09:00"):
    try:
        h, m = (s or default).split(":")
        return int(h), int(m)
    except ValueError:
        h, m = default.split(":")
        return int(h), int(m)


def _last_occurrence(trig, now):
    """Most recent scheduled time <= now for time triggers, or None."""
    k, p = trig.get("k"), trig.get("p") or {}
    if k == "once":
        try:
            t = datetime.fromisoformat(f"{p.get('date')}T{p.get('time') or '10:00'}")
        except ValueError:
            return None
        return t if t <= now else None
    if k in ("daily", "weekdays", "monthly"):
        h, m = _hm(p.get("time"))
        for back in range(0, 63):
            d = (now - timedelta(days=back)).replace(hour=h, minute=m, second=0, microsecond=0)
            if d > now:
                continue
            wd = d.weekday()
            if k == "daily":
                return d
            if k == "weekdays" and wd in (p.get("days") or []):
                return d
            if k == "monthly":
                mode = p.get("mode") or "day"
                if mode == "day" and d.day == int(p.get("day") or 1):
                    return d
                if mode != "day" and wd == int(p.get("weekday") or 0):
                    if mode == "first" and d.day <= 7:
                        return d
                    if mode == "last" and (d + timedelta(days=7)).month != d.month:
                        return d
        return None
    return None


# =============================================================== triggers
def _trig_key(rid, i, trig):
    return f"{rid}:{i}:{trig.get('k')}"


def _check_triggers(r, st, now, ctx):
    """Returns a reason (a message, see _m) if any trigger of routine r fires now, else None. Updates st (fired/ev)."""
    rid = r.get("id")
    reason = None
    for i, t in enumerate(r.get("triggers") or []):
        k, p = t.get("k"), t.get("p") or {}
        key = _trig_key(rid, i, t)
        ev = st["ev"].setdefault(key, {})
        sig = json.dumps(p, sort_keys=True)
        if ev.get("sig") != sig:          # new or edited trigger: start from now, never fire for the past
            ev.clear()
            ev["sig"] = sig
            ev["since"] = now.timestamp()
            st["fired"][key] = now.timestamp()
            ev["init"] = True
        fired_at = st["fired"].get(key, 0)
        hit = None
        if k in ("once", "daily", "weekdays", "monthly"):
            occ = _last_occurrence(t, now)
            if occ and occ.timestamp() > fired_at and now.timestamp() - occ.timestamp() <= CATCH_UP:
                hit = _m("scheduled for {day} {time}", day={"wd": occ.weekday()}, time=occ.strftime("%H:%M"))
                st["fired"][key] = occ.timestamp()
        elif k == "everyN":
            every = max(1, float(p.get("hours") or 6)) * 3600
            if now.timestamp() - fired_at >= every:
                hit = _m("every {n} h", n=p.get("hours"))
                st["fired"][key] = now.timestamp()
        elif k == "boot":
            boot = psutil.boot_time()
            up = time.time() - boot
            delay = float(p.get("delay") or 0) * 60
            if ev.get("init"):
                ev["boot"] = boot   # a new trigger never fires for a startup that already happened
            elif ev.get("boot") != boot and delay <= up <= delay + 1800:
                ev["boot"] = boot
                hit = _m("Windows started")
            elif ev.get("boot") != boot and up > delay + 1800:
                ev["boot"] = boot   # StellarHub opened long after startup: that startup is gone
        elif k == "login":
            users = [u for u in psutil.users() if u.name.lower() == os.environ.get("USERNAME", "").lower()]
            started = max((u.started for u in users), default=None)
            if started and ev.get("login") != started:
                if time.time() - started <= 1800 and not ev.get("init"):
                    hit = _m("you signed in")
                ev["login"] = started
        elif k in ("lock", "unlock"):
            cur = ctx.setdefault("locked", locked())
            prev = ev.get("v")
            ev["v"] = cur
            if prev is not None and prev != cur and cur == (k == "lock"):
                hit = _m("the PC was locked") if k == "lock" else _m("the PC was unlocked")
        elif k == "idle":
            idle = ctx.setdefault("idle", idle_seconds())
            need = float(p.get("min") or 15) * 60
            if idle < 60:
                ev["armed"] = True
            elif idle >= need and ev.get("armed", True):
                ev["armed"] = False
                hit = _m("{n} min without using the PC", n=int(idle // 60))
        elif k in ("plugIn", "plugOut", "batteryBelow"):
            ac, pct = ctx.setdefault("power", power())
            if k == "batteryBelow":
                below = pct is not None and pct < float(p.get("pct") or 20)
                if below and ev.get("v") is False:
                    hit = _m("battery at {pct}%", pct=pct)
                ev["v"] = below
            else:
                prev = ev.get("v")
                ev["v"] = ac
                if prev is not None and ac is not None and prev != ac and ac == (k == "plugIn"):
                    hit = _m("the charger was plugged in") if k == "plugIn" else _m("the charger was unplugged")
        elif k == "diskBelow":
            fg = free_gb(p.get("drive") or "C:")
            lim = float(p.get("gb") or 50)
            if fg is not None:
                if fg < lim and ev.get("v") is not True:
                    hit = _m("{drive} has {gb} GB free", drive=p.get("drive"), gb=_n1(fg))
                    ev["v"] = True
                elif fg >= lim + 1:
                    ev["v"] = False
        elif k == "download":
            d = _downloads_dir(p.get("folder"))
            seen = ev.setdefault("files", {})
            cur = {}
            try:
                for e in os.scandir(d):
                    if e.is_file(follow_symlinks=False):
                        n = e.name.lower()
                        if n.endswith((".crdownload", ".part", ".partial", ".tmp", ".download", ".opdownload")):
                            continue
                        cur[e.name] = e.stat().st_size
            except OSError:
                cur = None
            if cur is not None:
                if ev.get("ready"):
                    pend = ev.setdefault("pend", {})
                    for n, sz in cur.items():
                        if n not in seen:
                            if pend.get(n) == sz:           # size stable for one whole tick: the download finished
                                hit = _m("{file} finished downloading", file=n)
                                pend.pop(n, None)
                                seen[n] = sz
                            else:
                                pend[n] = sz
                    for n in list(pend):
                        if n not in cur:
                            pend.pop(n)
                    for n in list(seen):
                        if n not in cur:
                            seen.pop(n)
                else:
                    ev["files"] = dict(cur)
                    ev["ready"] = True
        elif k in ("newDrivers", "newUpdates"):
            pend = (ctx.setdefault("settings", _settings()).get("pending") or {}).get("drivers" if k == "newDrivers" else "apps") or {}
            at, n = pend.get("at"), pend.get("n") or 0
            if at and at != ev.get("at"):
                if n > 0 and ev.get("at") is not None:
                    hit = _m("{n} drivers waiting", n=n) if k == "newDrivers" else _m("{n} apps waiting", n=n)
                ev["at"] = at
        elif k == "wifi":
            ssid = ctx.setdefault("ssid", wifi_ssid())
            want = (p.get("ssid") or "").strip().lower()
            cur = (ssid or "").lower() == want and bool(want)
            if cur and ev.get("v") is False:
                hit = _m("connected to {ssid}", ssid=ssid)
            ev["v"] = cur
        elif k in ("appOpen", "appClose"):
            cur = app_running(p.get("app"))
            prev = ev.get("v")
            ev["v"] = cur
            if prev is not None and prev != cur and cur == (k == "appOpen"):
                hit = _m("{app} opened", app=_m(p.get("app") or "")) if cur else _m("{app} closed", app=_m(p.get("app") or ""))
        elif k in ("temp", "ram"):
            if k == "temp":
                val = gpu_temp() if p.get("sensor") == "gpu" else cpu_temp()
                over = val is not None and val > float(p.get("deg") or 85)
            else:
                val = psutil.virtual_memory().percent
                over = val > float(p.get("pct") or 90)
            if over:
                if not ev.get("since"):
                    ev["since"] = time.time()
                if ev.get("since") and time.time() - ev["since"] >= float(p.get("min") or 3) * 60 and not ev.get("fired"):
                    ev["fired"] = True
                    hit = ((_m("graphics card at {deg} °C", deg=round(val)) if p.get("sensor") == "gpu" else _m("processor at {deg} °C", deg=round(val)))
                           if k == "temp" else _m("memory at {pct}%", pct=round(val)))
            else:
                ev["since"] = None
                ev["fired"] = False
        ev.pop("init", None)
        if hit and not reason:
            reason = hit
    return reason


# =============================================================== conditions
def _eval_cond(c, r, ctx):
    """(met, explanation as a message)."""
    k, p = c.get("k"), c.get("p") or {}
    now = datetime.now()
    if k in ("plugged", "battery"):
        ac, pct = ctx.setdefault("power", power())
        if k == "plugged":
            if ac is None:
                return True, _m("this PC has no battery: always plugged in")
            return ac, _m("it’s plugged in") if ac else _m("it’s on battery")
        if pct is None:
            return True, _m("this PC has no battery")
        return pct >= float(p.get("pct") or 50), _m("the battery is at {pct}%", pct=pct)
    if k == "idle":
        s = ctx.setdefault("idle", idle_seconds())
        return s >= float(p.get("min") or 5) * 60, (_m("unused for {min} min", min=int(s // 60)) if s >= 60 else _m("you’re using it right now"))
    if k == "noFull":
        fs = ctx.setdefault("full", fullscreen_state())
        return fs == 0, _m({0: "nothing is in full screen", 2: "an app is in full screen", 3: "a game is in full screen", 4: "a presentation is running"}[fs])
    if k == "cpu":
        v = ctx.setdefault("cpu", psutil.cpu_percent(interval=1))
        return v < float(p.get("pct") or 30), _m("the processor is at {pct}%", pct=round(v))
    if k == "noMeeting":
        busy = ctx.setdefault("call", in_call())
        return not busy, _m("the microphone or camera is in use") if busy else _m("microphone and camera are free")
    if k == "window":
        t = now.strftime("%H:%M")
        a, b = p.get("from") or "22:00", p.get("to") or "08:00"
        inside = (a <= t < b) if a <= b else (t >= a or t < b)
        return inside, _m("it’s {time} now", time=t)
    if k == "days":
        wd = now.weekday()
        return wd in (p.get("days") or []), _m("today is {day}", day={"wd": wd})
    if k == "unmetered":
        m = ctx.setdefault("metered", metered())
        if m is None:
            return True, _m("Windows didn’t say whether the connection is metered")
        return not m, _m("the connection is metered") if m else _m("the connection isn’t metered")
    if k == "onWifi":
        ssid = ctx.setdefault("ssid", wifi_ssid())
        want = (p.get("ssid") or "").strip()
        return bool(ssid) and ssid.lower() == want.lower(), _m("you’re on “{ssid}”", ssid=ssid) if ssid else _m("you’re not on Wi-Fi")
    if k == "junk":
        j = ((ctx.setdefault("settings", _settings()).get("pending") or {}).get("junk") or {})
        if j.get("n") is None:
            return False, _m("Super Optimizer hasn’t measured the junk yet")
        return float(j["n"]) >= float(p.get("gb") or 5), _m("there are {gb} GB of junk", gb=_n1(j["n"]))
    if k == "diskFree":
        fg = free_gb(p.get("drive") or "C:")
        if fg is None:
            return False, _m("{drive} isn’t available", drive=p.get("drive"))
        return fg < float(p.get("gb") or 100), _m("{drive} has {gb} GB free", drive=p.get("drive"), gb=round(fg))
    if k == "admin":
        a = _admin()
        return a, _m("StellarHub is running as administrator") if a else _m("StellarHub is in normal mode")
    if k == "notSince":
        last = _state()["last"].get(r.get("id"))
        if not last:
            return True, _m("it has never run")
        h = (time.time() - last) / 3600
        return h >= float(p.get("hours") or 24), _m("it ran {h} h ago", h=max(1, round(h)))
    if k == "app":
        on = app_running(p.get("app"))
        want_open = p.get("st") == "open"
        app = _m(p.get("app") or "")    # "Any game" is translated; app names stay as they are
        return on == want_open, _m("{app} is open", app=app) if on else _m("{app} is closed", app=app)
    return True, _m("")


def _conds_ok(r, ctx):
    ev = [(c, *_eval_cond(c, r, ctx)) for c in (r.get("conds") or [])]
    if not ev:
        return True, ev
    oks = [e[1] for e in ev]
    return (all(oks) if r.get("condMode", "all") == "all" else any(oks)), ev


# =============================================================== actions
class _Sub:
    """Lets an action call another engine's long job inside this run: logs and cancel are forwarded."""

    def __init__(self, parent, label):
        self.parent, self.label = parent, label
        self.data = {}
        self.id = parent.id

    @property
    def cancelled(self):
        return self.parent.cancelled

    def progress(self, pct=None, text=None, force=False, **data):
        self.data.update(data)
        if text:
            self.parent.progress(text=tc("autopilot", "{name}: {result}", name=tc("autopilot", self.label), result=text), force=force)

    def log(self, line):
        self.parent.log(line)

    def check(self):
        self.parent.check()

    def stop(self):
        self.parent.stop()


def _call(mod, fn, *args):
    from . import resolve
    return resolve(mod, fn, "call")(*args)


class _NeedAdmin(Exception):
    pass


def _job(job, label, mod, fn, *args):
    from . import resolve
    out = resolve(mod, fn, "job")(_Sub(job, label), *args)
    if isinstance(out, dict) and out.get("needAdmin"):
        raise _NeedAdmin()
    return out


POWER_PLANS = {"saver": "a1841308-3540-4fab-bc81-f71556f20b4a", "balanced": "381b4222-f694-41f0-9685-ff5bb260df2e",
               "high": "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c", "max": "e9a42b02-d5df-448d-aa00-03f14749eb61"}
OVERLAY = {"saver": "efficiency", "balanced": "balanced", "high": "best", "max": "best"}
ADMIN_ACTS = {"drvInstall", "winUpd", "restore", "sfc"}


def _no_admin_needed(k, p):
    """Admin actions that are read-only in this mode (only look, or ask first)."""
    return (k == "winUpd" and p.get("mode", "search") in ("search", "download")) or (k == "drvInstall" and p.get("mode", "ask") == "ask")


def _act(job, a, r):
    """Runs one action. Returns (kind, text as a message, gb_freed, updated). kind: ok | skip | decide | bad."""
    k, p = a.get("k"), a.get("p") or {}
    if k in ADMIN_ACTS and not _admin() and not _no_admin_needed(k, p):
        return "skip", _m("skipped: needs administrator mode"), 0, 0
    if k == "clean":
        ids = sorted({i for c in (p.get("cats") or []) for i in CLEAN_MAP.get(c, [])})
        if not ids:
            return "skip", _m("none of the chosen categories can be cleaned yet"), 0, 0
        res = _job(job, "Cleanup", "optimizer", "clean", ids) or {}
        gb = (res.get("freed") or 0) / 1024 ** 3
        sk = res.get("skippedCats") or []
        txt = _m("{gb} GB freed, {n} categories skipped (need administrator)", gb=_n1(gb), n=len(sk)) if sk else _m("{gb} GB freed", gb=_n1(gb))
        return ("ok" if not sk else "skip"), txt, gb, 0
    if k == "recycle":
        res = _job(job, "Recycle Bin", "optimizer", "clean", ["recycle"]) or {}
        gb = (res.get("freed") or 0) / 1024 ** 3
        return "ok", _m("Recycle Bin emptied ({gb} GB)", gb=_n1(gb)), gb, 0
    if k == "oldDl":
        if p.get("to") == "quar":
            return "skip", _m("moving downloads to quarantine isn’t available yet: choose the Recycle Bin"), 0, 0
        d = _downloads_dir("Downloads")
        if not _downloads_ok(d):
            return "skip", _m("the downloads folder ({path}) isn’t a safe place to clean, so nothing was touched", path=d), 0, 0
        from .removal import paths as rp
        limit = time.time() - float(p.get("days") or 30) * 86400
        n = size = nobin = 0
        try:
            for e in os.scandir(d):
                job.check()
                try:
                    stt = e.stat(follow_symlinks=False)
                except OSError:
                    continue
                if e.is_symlink() or rp.is_reparse_point(e.path) or _newest_activity(e.path, stt) > limit:
                    continue
                res = _call("storage", "trash", e.path) or {}   # never permanent: no Recycle Bin means it stays
                if res.get("ok"):
                    n += 1
                    size += stt.st_size if e.is_file(follow_symlinks=False) else 0
                elif res.get("noBin"):
                    nobin += 1
        except OSError as ex:
            return "bad", _m("couldn’t read the downloads folder ({error})", error=str(ex)), 0, 0
        if nobin:
            return "skip", _m("{n} old downloads sent to the Recycle Bin, {k} left alone (they can’t go to the Recycle Bin)", n=n, k=nobin), size / 1024 ** 3, 0
        return "ok", _m("{n} old downloads sent to the Recycle Bin", n=n), size / 1024 ** 3, 0
    if k == "quar":
        age = float(p.get("age") or 14) * 86400
        n = 0
        for s in _call("remover", "quarantine_list") or []:
            when = s.get("created")
            try:
                ts = float(when) if isinstance(when, (int, float)) else datetime.fromisoformat(str(when)).timestamp()
            except (TypeError, ValueError):
                continue
            if time.time() - ts >= age:
                _call("remover", "quarantine_delete", s["id"])
                n += 1
        return "ok", _m("{n} quarantine entry removed", n=n) if n == 1 else _m("{n} quarantine entries removed", n=n), 0, 0
    if k == "dupes":
        st = _storage()          # a private scan: the one the Storage Checker shows is left alone
        sc = st.scan_private(_Sub(job, "Disk scan"), os.environ.get("SystemDrive", "C:") + "\\")
        res = st._duplicates(_Sub(job, "Duplicates"), max(1, int(float(p.get("min") or 50))), sc) or {}
        groups = res.get("groups") or []
        waste = res.get("wasted") or 0
        if waste:
            return "ok", _m("{n} groups of duplicates found, {gb} GB repeated", n=len(groups), gb=_n1(waste / 1024 ** 3)), 0, 0
        return "ok", _m("{n} groups of duplicates found", n=len(groups)), 0, 0
    if k == "drvScan":
        res = _job(job, "Drivers", "drivers", "search") or {}
        n = len(res.get("updates") or [])
        _emit("pending", key="drivers", n=n)
        return "ok", _m("{n} new driver found", n=n) if n == 1 else _m("{n} new drivers found", n=n), 0, 0
    if k == "drvInstall":
        res = _job(job, "Drivers", "drivers", "search") or {}
        ups = res.get("updates") or []
        if not ups:
            return "ok", _m("no new drivers"), 0, 0
        if p.get("mode", "ask") == "ask":
            return "decide", (_m("{n} new driver is waiting for your approval in Driver Updater", n=1) if len(ups) == 1
                              else _m("{n} new drivers are waiting for your approval in Driver Updater", n=len(ups))), 0, 0
        pick = [u for u in ups if p.get("mode") == "all" or not u.get("optional")]
        out = _job(job, "Drivers", "drivers", "install", [u["id"] for u in pick]) or {}
        if out.get("needAdmin"):
            return "skip", _m("skipped: needs administrator mode"), 0, 0
        ok = sum(1 for x in (out.get("results") or []) if x.get("ok"))
        return ("ok" if ok == len(pick) else "skip"), _m("{n} of {total} drivers installed", n=ok, total=len(pick)), 0, ok
    if k == "drvBackup":
        out = _job(job, "Driver backup", "drivers", "export", None)
        if isinstance(out, dict) and out.get("needAdmin"):
            return "skip", _m("skipped: needs administrator mode"), 0, 0
        keep = int(float(p.get("keep") or 3))
        old = (_call("drivers", "backups") or [])[keep:]
        for b in old:
            _job(job, "Old backups", "drivers", "delete_backup", b["path"])
        if not old:
            return "ok", _m("drivers backed up"), 0, 0
        return "ok", (_m("drivers backed up, {n} old copy sent to the Recycle Bin", n=1) if len(old) == 1
                      else _m("drivers backed up, {n} old copies sent to the Recycle Bin", n=len(old))), 0, 0
    if k in ("apps", "store"):
        res = _job(job, "Apps", "updater", "scan_apps") or {}
        items = [i for i in (res.get("items") or []) if not i.get("pinned")]
        if k == "store":
            items = [i for i in items if (i.get("source") or "").lower() == "msstore"]
        elif p.get("scope") == "list":
            want = [w.lower() for w in (p.get("list") or [])]
            items = [i for i in items if any(w in (i.get("name") or "").lower() for w in want)]
        elif p.get("scope") == "sec":
            return _act(job, {"k": "winUpd", "p": {"mode": "install", "only": "security"}}, r)
        if not items:
            _emit("pending", key="apps", n=0)
            return "ok", _m("everything is already up to date"), 0, 0
        for i in items:
            i.pop("_p", None)
        out = _job(job, "Apps", "updater", "install", items) or {}
        done = sum(1 for s in (out.get("items") or []) if s.get("st") == "done") if isinstance(out, dict) else 0
        return ("ok" if done == len(items) else "skip"), _m("{n} of {total} apps updated", n=done, total=len(items)), 0, done
    if k == "winUpd":
        res = _job(job, "Windows Update", "updater", "scan_windows") or {}
        ups = res.get("updates") or []
        if p.get("only") == "security":
            ups = [u for u in ups if u.get("cat") == "security"]
        if p.get("mode", "search") in ("search", "download") or not ups:
            n = len(ups)
            if p.get("mode") == "download":
                txt = (_m("{n} Windows update available (downloading on its own isn’t available yet)", n=n) if n == 1
                       else _m("{n} Windows updates available (downloading on its own isn’t available yet)", n=n))
            else:
                txt = _m("{n} Windows update available", n=n) if n == 1 else _m("{n} Windows updates available", n=n)
            return "ok", txt, 0, 0
        out = _job(job, "Windows Update", "updater", "install", ups) or {}
        done = sum(1 for s in (out.get("items") or []) if s.get("st") == "done") if isinstance(out, dict) else 0
        return ("ok" if done == len(ups) else "skip"), _m("{n} of {total} Windows updates installed", n=done, total=len(ups)), 0, done
    if k == "defender":
        out = _job(job, "Defender", "updater", "install", [{"kind": "defender", "name": "Defender definitions"}]) or {}
        st = ((out.get("items") or [{}])[0] or {}).get("st") if isinstance(out, dict) else None
        return ("ok" if st == "done" else "skip"), _m("Defender definitions updated") if st == "done" else _m("Defender isn’t active (another antivirus protects the PC)"), 0, 0
    if k == "restore":
        res = _job(job, "Restore point", "optimizer", "restore_point", f"StellarHub Scheduled Tasks: {r.get('name', '')}") or {}
        if res.get("needAdmin"):
            return "skip", _m("skipped: needs administrator mode"), 0, 0
        ok = bool(res.get("ok"))
        return ("ok" if ok else "skip"), _m("restore point created") if ok else (_m("{error}", error=res["msg"]) if res.get("msg") else _m("Windows didn’t create a restore point")), 0, 0
    if k == "sfc":
        kinds = ["sfc", "dism"] if p.get("kind") == "both" else [p.get("kind") or "sfc"]
        for t in kinds:
            _job(job, t.upper(), "optimizer", "repair", t)
        return "ok", _m("SFC and DISM finished") if len(kinds) > 1 else _m("{tool} finished", tool=kinds[0].upper()), 0, 0
    if k == "net":
        # A full network reset erases static IP and DNS settings: it is never run by a routine (optimizer.repair("net")
        # refuses unattended calls too). Routines saved with it keep working: the safe part (the DNS flush) still runs.
        full = p.get("kind") == "full"
        if full:
            job.log(_en(_m("A full network reset is never run by a routine. Run it from Super Optimizer.")))
        code = subprocess.run(["ipconfig", "/flushdns"], capture_output=True, creationflags=NO_WINDOW).returncode
        if full:
            return "skip", (_m("The DNS cache was flushed, but a full network reset is never run by a routine. Run it from Super Optimizer.")
                            if code == 0 else _m("A full network reset is never run by a routine. Run it from Super Optimizer.")), 0, 0
        return ("ok" if code == 0 else "bad"), _m("DNS cache flushed") if code == 0 else _m("ipconfig couldn’t flush the DNS cache"), 0, 0
    if k == "explorer":
        _job(job, "File Explorer", "optimizer", "repair", "explorer")
        return "ok", _m("File Explorer restarted"), 0, 0
    if k == "scanDisk":
        drive = (p.get("drive") or "C:").rstrip("\\") + "\\"
        st = _storage()
        sc = st.scan_private(_Sub(job, "Disk"), drive)     # private: never replaces the scan the UI shows
        cmp_ = st._compare(sc) or {}
        gb = _grew_bytes(cmp_) / 1024 ** 3
        if cmp_.get("prev") is None:
            return "ok", _m("{drive} analyzed (next time it can compare)", drive=drive[:2]), 0, 0
        warn = gb > float(p.get("gb") or 10)
        if warn:
            return "decide", _m("{drive} grew {gb} GB since the last analysis — have a look in Storage Checker", drive=drive[:2], gb=_n1(gb)), 0, 0
        return "ok", _m("{drive} grew {gb} GB since the last analysis", drive=drive[:2], gb=_n1(gb)), 0, 0
    if k == "plan":
        guid = POWER_PLANS.get(p.get("plan") or "balanced")
        try:
            _call("optimizer", "power_plan_set", guid)
            return "ok", _PLAN_DONE.get(p.get("plan"), _PLAN_DONE["balanced"]), 0, 0
        except Exception:
            ac, _pct = power()
            key = "dc" if ac is False else "ac"
            _call("optimizer", "perf_set", key, OVERLAY.get(p.get("plan"), "balanced"))
            return "ok", _OVERLAY_DONE.get(OVERLAY.get(p.get("plan"), "balanced"), _OVERLAY_DONE["balanced"]), 0, 0
    if k == "game":
        _call("optimizer", "perf_set", "gameMode", p.get("on", "on") == "on")
        return "ok", _m("Game Mode turned on") if p.get("on", "on") == "on" else _m("Game Mode turned off"), 0, 0
    if k == "closeApp":
        a_ = (p.get("app") or "").lower()
        names = set(APP_PROCS.get(a_, [a_ + ".exe"]))
        procs = [pr for pr in psutil.process_iter(["name"]) if (pr.info.get("name") or "").lower() in names and _closable(pr)]
        for pr in procs:
            try:
                pr.terminate()
            except psutil.Error:
                pass
        psutil.wait_procs(procs, timeout=5)
        app = _m(p.get("app") or "")
        return "ok", _m("{app} closed", app=app) if procs else _m("{app} wasn’t open", app=app), 0, 0
    if k in NEEDS_APPROVAL and not is_approved(a):
        job.log(_en(_NOT_APPROVED))
        return "skip", _NOT_APPROVED, 0, 0
    if k == "openApp":
        path = (p.get("path") or "").strip().strip('"')
        if not path or not os.path.exists(path):
            return "bad", _m("“{path}” doesn’t exist", path=path or "…"), 0, 0
        os.startfile(path)
        return "ok", _m("opened {file}", file=os.path.basename(path)), 0, 0
    if k == "cmd":
        cmd = (p.get("cmd") or "").strip()
        if not cmd:
            return "bad", _m("no command to run"), 0, 0
        if p.get("as") == "admin" and not _admin():
            return "skip", _m("skipped: the command needs administrator mode"), 0, 0
        if p.get("as") != "admin" and _admin():
            # "as you" must not quietly run with administrator rights (a child of an elevated StellarHub is elevated)
            job.log(_en(_AS_USER_ELEVATED))
            return "skip", _AS_USER_ELEVATED, 0, 0
        limit = max(1, float((r.get("after") or {}).get("limit") or 60)) * 60
        try:
            pr = subprocess.run(["cmd.exe", "/c", cmd], capture_output=True, timeout=limit, creationflags=NO_WINDOW)
        except subprocess.TimeoutExpired:
            return "bad", _m("the command took too long and was stopped"), 0, 0
        from .ps import _decode  # the console's output is UTF-8, UTF-16 or this Windows' code page, depending on the tool
        out = pr.stdout if isinstance(pr.stdout, bytes) else b""
        for line in (_decode(out, "utf-8") if out else "").splitlines()[-20:]:
            job.log(line)
        return ("ok" if pr.returncode == 0 else "bad"), _m("command finished (exit code {code})", code=pr.returncode), 0, 0
    if k == "widget":
        _emit("widget", on=p.get("st", "open") == "open")
        return "ok", _m("widget opened") if p.get("st", "open") == "open" else _m("widget closed"), 0, 0
    if k == "mute":
        return _mute(float(p.get("min") or 60))
    if k == "wait":
        end = time.time() + float(p.get("min") or 1) * 60
        while time.time() < end:
            job.check()
            time.sleep(1)
        return "ok", _m("waited {min} min", min=p.get("min")), 0, 0
    if k == "power":
        what, count = p.get("what", "sleep"), int(float(p.get("count") or 0))
        if what in ("restart", "off"):
            subprocess.run(["shutdown", "/r" if what == "restart" else "/s", "/t", str(max(0, count)),
                            "/c", tc("autopilot", "StellarHub Scheduled Tasks. To cancel: shutdown /a")], creationflags=NO_WINDOW)
            return "ok", (_m("restart scheduled in {n} s (cancel with shutdown /a)", n=count) if what == "restart"
                          else _m("shutdown scheduled in {n} s (cancel with shutdown /a)", n=count)), 0, 0
        if count:
            _say_notify(tc("autopilot", "StellarHub Scheduled Tasks"), tc("autopilot", "The PC will sleep in {n} s. Move the mouse or press Cancel in StellarHub to stop it.", n=count))
            end = time.time() + count
            while time.time() < end:
                job.check()
                if idle_seconds() < 2:
                    return "skip", _m("sleep cancelled: you used the PC"), 0, 0
                time.sleep(1)
        ctypes.windll.powrprof.SetSuspendState(False, False, False)
        return "ok", _m("the PC went to sleep"), 0, 0
    return "skip", _m("this action isn’t available yet"), 0, 0


_PLAN_DONE = {"saver": _m("switched to the power saver plan"), "balanced": _m("switched to the balanced plan"),
              "high": _m("switched to the high performance plan"), "max": _m("switched to the maximum plan")}
_OVERLAY_DONE = {"efficiency": _m("power mode set to best power efficiency"), "balanced": _m("power mode set to balanced"),
                 "best": _m("power mode set to best performance")}


TOAST_KEY = r"Software\Microsoft\Windows\CurrentVersion\PushNotifications"


def _mute_file():
    """What to put back and when. Kept on disk (next to state.json, in its own file so the scheduler's state saves can't
    overwrite it) so that closing or crashing StellarHub can't leave the notifications off for good."""
    return os.path.join(_data_dir(), "mute.json")


def _toast_get():
    """ToastEnabled as it is now: 0, 1 or None (no value: Windows default, on)."""
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, TOAST_KEY) as k:
            return int(winreg.QueryValueEx(k, "ToastEnabled")[0])
    except (OSError, ValueError, TypeError):
        return None


def _toast_set(v):
    """Sets ToastEnabled (None removes the value). Raises OSError if it can't."""
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, TOAST_KEY, 0, winreg.KEY_SET_VALUE) as k:
        if v is None:
            try:
                winreg.DeleteValue(k, "ToastEnabled")
            except FileNotFoundError:
                pass
        else:
            winreg.SetValueEx(k, "ToastEnabled", 0, winreg.REG_DWORD, int(v))


def restore_mute(force=False):
    """Puts ToastEnabled back as it was before the mute, once its time is up (or now, with force). Runs when the timer
    fires, when the app starts and on every check. True if something was restored."""
    f = _mute_file()
    if not os.path.exists(f):
        return False
    with _lock:
        m = _load(f, None)
        if not isinstance(m, dict) or "prev" not in m:
            try:
                os.remove(f)
            except OSError:
                pass
            return False
        if not force and time.time() < float(m.get("until") or 0) - 1:
            return False
        prev = m.get("prev")
        try:
            _toast_set(prev if prev in (0, 1) else None)
        except OSError:
            return False          # try again at the next check
        try:
            os.remove(f)
        except OSError:
            pass
    return True


def _mute(minutes):
    """Turns Windows notifications off and back on after `minutes` (PushNotifications\\ToastEnabled), to the value they
    had before (if you already had them off they stay off). The deadline and the old value are saved, so they come back
    even if StellarHub is closed meanwhile."""
    global _mute_timer
    with _lock:
        old = _load(_mute_file(), None)
        prev = old["prev"] if isinstance(old, dict) and "prev" in old else _toast_get()   # a mute already running: keep its value
        try:
            _save(_mute_file(), {"prev": prev, "until": time.time() + minutes * 60})
            _toast_set(0)
        except OSError as e:
            return "bad", _m("couldn’t mute notifications ({error})", error=str(e)), 0, 0
        if _mute_timer:
            _mute_timer.cancel()
        _mute_timer = threading.Timer(minutes * 60 + 1, restore_mute)
        _mute_timer.daemon = True
        _mute_timer.start()
    return "ok", _m("notifications muted for {min} min", min=int(minutes)), 0, 0


# =============================================================== running a routine
def _find(rid):
    for r in _settings().get("autopilotRoutines") or []:
        if r.get("id") == rid:
            return r
    return None


def _quiet_now(nt):
    if not nt.get("quiet"):
        return False
    t = datetime.now().strftime("%H:%M")
    a, b = nt.get("qFrom") or "23:00", nt.get("qTo") or "08:00"
    return (a <= t < b) if a <= b else (t >= a or t < b)


def _maybe_notify(r, st, res, force=False):
    """res: the run's results as messages."""
    nt = _settings().get("autopilotNotify") or {}
    rn = r.get("notify") or {}
    when = rn.get("when") or nt.get("when") or "decide"
    want = force or when == "always" or (when == "decide" and st in ("bad", "decide")) or (when == "errors" and st == "bad")
    if nt.get("batterySaver", True) and battery_saver() and st not in ("bad", "decide"):
        want = False
    if not want or _quiet_now(nt) or (nt.get("noGame", True) and fullscreen_state()):
        return
    if rn.get("toast", True) is False and rn.get("tray", True) is False:
        return
    _say_notify(tc("autopilot", "Scheduled task: {name}", name=r.get("name") or tc("autopilot", "Routine")), _sep().join(_txt(x) for x in res) or tc("autopilot", "Done"))


def _sep():
    return {"zh": "，", "ja": "、"}.get(language(), ", ")


def _after_power(what, r):
    """"When it finishes: sleep / shut down". Shutting down gives 60 s to cancel (shutdown /a)."""
    if what == "off":
        subprocess.run(["shutdown", "/s", "/t", "60", "/c", tc("autopilot", "StellarHub finished the scheduled task “{name}”. To cancel: shutdown /a", name=r.get("name", ""))],
                       creationflags=NO_WINDOW)
    elif what == "sleep":
        _say_notify(tc("autopilot", "StellarHub Scheduled Tasks"), tc("autopilot", "“{name}” finished. The PC will sleep in 60 s unless you use it.", name=r.get("name", "")))
        def later():
            end = time.time() + 60
            while time.time() < end:
                if idle_seconds() < 2:
                    return
                time.sleep(1)
            ctypes.windll.powrprof.SetSuspendState(False, False, False)
        threading.Thread(target=later, daemon=True).start()


def run(job, rid, manual=True, routine=None, reason=""):
    """Runs a routine now (from "Run now", or from the scheduler). Returns the log entry."""
    r = routine or _find(rid)
    if not r:
        raise ValueError(tc("autopilot", "That routine doesn’t exist anymore."))
    rid = r.get("id") or rid
    if rid in _running:
        raise RuntimeError(tc("autopilot", "That routine is already running."))
    _running.add(rid)
    started = time.time()
    steps, gb, upd = [], 0.0, 0
    after = r.get("after") or {}
    limit = max(1, float(after.get("limit") or 60)) * 60
    acts = r.get("acts") or []
    failed = cancelled = False
    try:
        if reason:
            steps.append(["ok", _m("Started because {reason}", reason=_msg(reason))])
        for i, a in enumerate(acts):
            job.check()
            if time.time() - started > limit:
                steps.append(["bad", _m("Stopped: it went over the {min} min limit", min=int(limit // 60))])
                failed = True
                break
            job.progress(i / max(1, len(acts)), tc("autopilot", "Step {n} of {total}", n=i + 1, total=len(acts)), step=i, total=len(acts), force=True)
            tries = 1 + (int(after.get("retries") or 0) if after.get("onFail") == "retry" else 0)
            for attempt in range(tries):
                try:
                    kind, text, g, u = _act(job, a, r)
                except jobs.Cancelled:
                    raise
                except _NeedAdmin:
                    kind, text, g, u = "skip", _m("skipped: needs administrator mode"), 0, 0
                except Exception as e:
                    kind, text, g, u = "bad", _m("failed: {error}", error=str(e)), 0, 0
                if kind != "bad" or attempt == tries - 1:
                    break
                job.log(tc("autopilot", "Retrying ({n} of {total})…", n=attempt + 2, total=tries))
                time.sleep(5)
            gb += g or 0
            upd += u or 0
            label = a.get("k")
            steps.append([kind, _m("{name}: {result}", name=_m(_ACT_NAMES.get(label, label or "")), result=_msg(text))])
            if kind == "bad":
                failed = True
                if after.get("onFail") in ("stop", "retry"):
                    if i < len(acts) - 1:
                        steps.append(["skip", _m("The rest was skipped because a step failed")])
                    break
        job.progress(1, tc("autopilot", "Finished"), force=True)
    except jobs.Cancelled:
        steps.append(["skip", _m("Cancelled")])
        cancelled = True
    finally:
        _running.discard(rid)
    st = "bad" if failed else ("warn" if any(s[0] in ("skip", "decide") for s in steps) else "ok")
    res = []
    if gb >= .05:
        res.append(_m("{gb} GB freed", gb=_n1(gb)))
    if upd:
        res.append(_m("{n} updated", n=upd))
    sk = sum(1 for s in steps if s[0] == "skip")
    dc = sum(1 for s in steps if s[0] == "decide")
    if dc:
        res.append(_m("{n} waiting for you", n=dc))
    if sk:
        res.append(_m("{n} step skipped", n=sk) if sk == 1 else _m("{n} steps skipped", n=sk))
    if failed:
        res.append(_m("something failed"))
    res = res or [_m("Done")]
    # texts in English plus their messages (resM, the 3rd item of each step): the interface translates them
    entry = {"id": uuid.uuid4().hex[:10], "rid": rid, "when": datetime.now().astimezone().isoformat(), "name": r.get("name", "Routine"),
             "color": r.get("color", 0), "st": st, "gb": round(gb, 2), "upd": upd, "manual": bool(manual),
             "res": [_en(x) for x in res], "resM": res, "steps": [[k, _en(t), t] for k, t in steps],
             "secs": round(time.time() - started)}
    _append_log(entry)
    with _lock:
        s = _state()
        s["last"][rid] = time.time()
        _save_state(s)
    with _lock:
        s = _state()
        rt = s.setdefault("retry", {})
        if failed and not manual and after.get("tomorrow", True):
            rt[rid] = (datetime.now() + timedelta(days=1)).timestamp()
        else:
            rt.pop(rid, None)
        _save_state(s)
    _maybe_notify(r, "bad" if failed else ("decide" if dc else st), res, force=failed and after.get("failThen") == "notify")
    if not failed and not cancelled and after.get("okThen") in ("sleep", "off"):
        _after_power(after["okThen"], r)
    nxt = after.get("failRoutine") if failed and after.get("failThen") == "routine" else (
        after.get("okRoutine") if not failed and after.get("okThen") == "routine" else None)
    if nxt and nxt != rid:
        _enqueue(nxt, None, False, _m("“{name}” failed", name=r.get("name") or "") if failed else _m("“{name}” finished", name=r.get("name") or ""))
    return entry


_ACT_NAMES = {
    "clean": "Cleanup", "recycle": "Recycle Bin", "oldDl": "Old downloads", "quar": "Quarantine", "dupes": "Duplicates",
    "drvScan": "Drivers", "drvInstall": "Drivers", "drvBackup": "Driver backup", "apps": "Apps", "winUpd": "Windows Update",
    "store": "Store apps", "defender": "Defender", "restore": "Restore point", "sfc": "Windows files", "net": "Network",
    "explorer": "File Explorer", "scanDisk": "Disk analysis", "plan": "Power plan", "game": "Game Mode",
    "closeApp": "Close app", "openApp": "Open app", "cmd": "Command", "widget": "Widget", "mute": "Notifications",
    "wait": "Wait", "power": "Power",
}


def dry_run(routine):
    """Evaluates a routine right now without running anything: real conditions, what each action would do.
    conds: [met, explanation, explanation as a message]; acts: {k, note, noteM (message), needAdmin}."""
    r = routine if isinstance(routine, dict) else (_find(routine) or {})
    ctx = {}
    ok, ev = _conds_ok(r, ctx)
    caps = _caps()["a"]
    acts = []
    for a in r.get("acts") or []:
        k, p = a.get("k"), a.get("p") or {}
        note, need_admin = None, False
        if k in caps:
            note = caps[k]
        elif k in ADMIN_ACTS and not _admin() and not _no_admin_needed(k, p):
            note, need_admin = _m("would be skipped: needs administrator"), True
        elif k == "drvInstall" and p.get("mode", "ask") == "ask":
            note = _m("would ask you first")
        elif k in NEEDS_APPROVAL and not is_approved(a):
            note = _m("would be skipped: not approved in administrator mode. Save the routine again to allow it")
        elif k == "cmd" and p.get("as") != "admin" and _admin():
            note = _AS_USER_ELEVATED
        elif k == "clean" and not any(CLEAN_MAP.get(c) for c in (p.get("cats") or [])):
            note = _m("none of the chosen categories can be cleaned yet")
        acts.append({"k": k, "note": _txt(note) if note else "", "noteM": note, "needAdmin": need_admin})
    return {"ok": ok, "conds": [[o, _txt(d), d] for _c, o, d in ev], "acts": acts, "admin": _admin(),
            "running": rid_running(r.get("id"))}


def rid_running(rid):
    return rid in _running


# =============================================================== the scheduler
_PRIO = {"high": 0, "normal": 1, "low": 2}


def _enqueue(rid, routine, manual, reason):
    """Queues a run; higher priority routines go first when several are waiting."""
    with _lock:
        if rid in _running or any(q[0] == rid for q in _queue):
            return False
        pr = _PRIO.get(((routine or _find(rid) or {}).get("priority")) or "normal", 1)
        pos = next((i for i, q in enumerate(_queue) if q[4] > pr), len(_queue))
        _queue.insert(pos, (rid, routine, manual, reason, pr))
    _emit("queue", queued=[q[0] for q in _queue])
    return True


def _worker():
    while not _stop.is_set():
        item = None
        with _lock:
            if _queue:
                item = _queue.pop(0)
        if not item:
            _stop.wait(1)
            continue
        rid, routine, manual, reason, _pr = item
        done = threading.Event()

        def go(job, rid=rid, routine=routine, manual=manual, reason=reason):
            try:
                return run(job, rid, manual, routine, reason)
            finally:
                done.set()
        jobs.start("autopilot.run", go)
        done.wait(timeout=24 * 3600)


def _tick():
    # The whole check holds the lock: it reads state.json, changes it and saves it at the end, and run() (on a job
    # thread) records each run's "last" time and "try again tomorrow" in the same file. A run that ended in between
    # had its record erased by this save (notSince saw "never ran", the retry the next day was lost).
    with _lock:
        _tick_locked()


def _tick_locked():
    restore_mute()
    s = _settings()
    routines = [r for r in (s.get("autopilotRoutines") or []) if isinstance(r, dict)]
    if s.get("autopilotSchema") not in (None, 2):
        return
    st = _state()
    now = datetime.now()
    ctx = {"settings": s}
    nt = s.get("autopilotNotify") or {}
    alive = set()
    known = {r.get("id") for r in routines}
    defer = st.setdefault("deferred", {})
    retry = st.setdefault("retry", {})
    gaming = bool(nt.get("noGame", True)) and ctx.setdefault("full", fullscreen_state()) != 0
    if not gaming:                         # runs held back while something was in full screen
        for rid, why in list(defer.items()):
            defer.pop(rid)
            if rid in known:
                _enqueue(rid, None, False, _m("{reason} (held back while something was in full screen)", reason=_msg(why)))
    for rid, at in list(retry.items()):    # "Try again the next day"
        if rid not in known:
            retry.pop(rid)
        elif time.time() >= at and not gaming:
            retry.pop(rid)
            _enqueue(rid, None, False, _m("it failed yesterday and is trying again"))
    _weekly(st, nt, now)
    for r in routines:
        rid = r.get("id")
        for i, t in enumerate(r.get("triggers") or []):
            alive.add(_trig_key(rid, i, t))
        if not r.get("on", True) or not r.get("acts"):
            continue
        pz = r.get("pausedUntil")
        if pz:
            try:
                if now <= datetime.fromisoformat(pz + "T23:59"):
                    continue
            except ValueError:
                pass
        try:
            reason = _check_triggers(r, st, now, ctx)
        except Exception as e:
            print("[autopilot trigger]", e)
            reason = None
        if not reason or rid in _running:
            continue
        try:
            ok, ev = _conds_ok(r, ctx)
        except Exception as e:  # noqa: BLE001  one routine's odd condition must not stop the check of all the others
            print("[autopilot condition]", e)
            continue
        if not ok:
            failed = [d for _c, o, d in ev if not o]
            res = _m("Skipped: {reason}", reason=failed[0] if failed else _m("a condition was not met"))
            steps = [["ok", _m("Started because {reason}", reason=reason)]] + [["skip", _m("Not met: {reason}", reason=d)] for d in failed]
            _append_log({"id": uuid.uuid4().hex[:10], "rid": rid, "when": datetime.now().astimezone().isoformat(), "name": r.get("name", "Routine"),
                         "color": r.get("color", 0), "st": "skip", "gb": 0, "upd": 0, "manual": False,
                         "res": [_en(res)], "resM": [res], "steps": [[k, _en(t), t] for k, t in steps]})
            continue
        if gaming:
            defer[rid] = reason
            continue
        _enqueue(rid, None, False, reason)
    for key in list(st["ev"]):            # forget triggers that no longer exist
        if key not in alive:
            st["ev"].pop(key, None)
            st["fired"].pop(key, None)
    _save_state(st)


def _weekly(st, nt, now):
    """One notification with the whole week, on the chosen day after 18:00."""
    if not nt.get("weekly", True) or now.weekday() != int(nt.get("weeklyDay", 6)) or now.hour < 18:
        return
    wk = now.strftime("%G-%V")
    if st.get("weekly") == wk:
        return
    st["weekly"] = wk
    since = time.time() - 7 * 86400
    week = []
    for e in log(200):
        try:
            if datetime.fromisoformat(e["when"]).timestamp() >= since:
                week.append(e)
        except (KeyError, ValueError):
            pass
    if not week:
        return
    gb = sum(e.get("gb") or 0 for e in week)
    upd = sum(e.get("upd") or 0 for e in week)
    bad = sum(1 for e in week if e.get("st") == "bad")
    parts = [_m("{n} run", n=1) if len(week) == 1 else _m("{n} runs", n=len(week))]
    if gb >= .1:
        parts.append(_m("{gb} GB freed", gb=_n1(gb)))
    if upd:
        parts.append(_m("{n} updated", n=upd))
    if bad:
        parts.append(_m("{n} with problems", n=bad))
    _say_notify(tc("autopilot", "Scheduled tasks this week"), _sep().join(_txt(x) for x in parts))


def _loop():
    while not _stop.is_set():
        try:
            _tick()
        except Exception as e:
            print("[autopilot]", e)
        _stop.wait(TICK)


def start():
    """Starts the scheduler once (safe to call many times)."""
    global _thread
    with _lock:
        if _thread and _thread.is_alive():
            return status()
        _stop.clear()
        try:
            restore_mute()      # a mute left over from a previous run (the app closed before it ended)
        except Exception as e:
            print("[autopilot]", e)
        _thread = threading.Thread(target=_loop, daemon=True, name="autopilot")
        _thread.start()
        threading.Thread(target=_worker, daemon=True, name="autopilot-worker").start()
    return status()


def stop():
    _stop.set()
