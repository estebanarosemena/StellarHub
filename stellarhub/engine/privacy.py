"""Privacy & Security engine: what can see you, what is open and how well Windows protects you.

Read-only by default. Every change (Windows privacy settings, firewall profiles, UAC, SmartScreen, disabling an
auto-start) first saves the previous state as JSON under %LOCALAPPDATA%\\StellarHub\\privacy\\changes\\<user> (in the
user's own profile: always writable for that user, elevated or not, and not readable by other users) and can be undone
from the history. If the backup can't be written, the change is not made. Anything that needs
administrator rights returns {"needAdmin": True} instead of failing halfway.

Every area result carries "findings" (problems, each with a severity, a weight for the score and, when it is safe
and reversible, a one-click fix) and "passed" (checks that are fine). The last result of each area is cached on
disk so reopening the module is instant; the UI refreshes it in the background.
"""
import base64
import ctypes
import hashlib
import ipaddress
import json
import os
import re
import shutil
import tempfile
import threading
import time
import winreg
from concurrent.futures import ThreadPoolExecutor
from ctypes import wintypes

from ..i18n import language, tr
from .optimizer import USER_DATA, _admin, _need_admin, user_needs_admin
from .optimizer import open_location as _open_location
from .ps import ps, ps_json, run as ps_run
from .removal import icons as ricons
from .removal import paths, registry, startup
from .removal import system as rsys
from .removal.registry import V32, V64
from .removal.safety import image_path

EXPORTS = {"cached", "permissions", "perm_live", "tracking_read", "tracking_set", "history", "undo", "network",
           "fix", "persist_set", "icons", "open_location", "open_uri"}
JOBS = {"protection", "persistence", "perm_details", "quick_scan"}

DATA = os.path.join(os.path.dirname(USER_DATA), "privacy")
_LEGACY = os.path.join(os.environ.get("ProgramData", r"C:\ProgramData"), "StellarHub", "privacy")
_DEFAULT_DATA = DATA
_migrated = set()
HKCU, HKLM, HKU = winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_USERS
DW, QW, SZ = winreg.REG_DWORD, winreg.REG_QWORD, winreg.REG_SZ


def _user_tag():
    return re.sub(r"[^\w.-]", "_", os.environ.get("USERNAME") or "user")[:40] or "user"


def _migrate_legacy():
    """Once per run: copies this user's files from the old ProgramData folder (where an elevated run left them
    read-only for the same user's non-elevated runs) into DATA. Never overwrites."""
    if DATA != _DEFAULT_DATA or DATA in _migrated:
        return
    _migrated.add(DATA)
    tag = _user_tag()
    try:
        for name in (f"cache-{tag}.json", f"appnames-{tag}.json", "signatures.json"):
            src, dst = os.path.join(_LEGACY, name), os.path.join(DATA, name)
            if os.path.isfile(src) and not os.path.exists(dst):
                os.makedirs(DATA, exist_ok=True)
                shutil.copy2(src, dst)
        src = os.path.join(_LEGACY, "changes", tag)
        if os.path.isdir(src):
            dst = os.path.join(DATA, "changes", tag)
            os.makedirs(dst, exist_ok=True)
            for n in os.listdir(src):
                if not os.path.exists(os.path.join(dst, n)):
                    shutil.copy2(os.path.join(src, n), os.path.join(dst, n))
    except OSError:
        pass


def _dpath(*parts):
    _migrate_legacy()
    p = os.path.join(DATA, *parts)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


def _write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False)
    os.replace(tmp, path)


def _read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


# =============================================================== cache of the last results
_CACHE_LOCK = threading.Lock()


def _cache_file():
    return _dpath(f"cache-{_user_tag()}.json")


def _cache_put(area, data):
    with _CACHE_LOCK:
        c = _read_json(_cache_file(), {}) or {}
        c[area] = {"t": time.time(), "data": data, "lang": language()}
        try:
            _write_json(_cache_file(), c)
        except OSError:
            pass


def cached():
    """Last result of every area (instant), {area: {t, data}}. Only for showing something right away."""
    with _CACHE_LOCK:
        c = _read_json(_cache_file(), {}) or {}
    # the saved findings hold text in the language they were measured in: only show them in that same language
    c = {k: v for k, v in c.items() if isinstance(v, dict) and v.get("lang") == language()}
    c["admin"] = _admin()
    return c


# =============================================================== score and findings (pure)
SEV_ORDER = {"bad": 0, "warn": 1, "info": 2}


def finding(fid, area, sev, w, title, desc, tab=None, fix=None, uri=None):
    f = {"id": fid, "area": area, "sev": sev, "w": w, "title": title, "desc": desc, "tab": tab or area}
    if fix:
        f["fix"] = fix
    if uri:
        f["uri"] = uri
    return f


def score(findings):
    """0-100: starts at 100 and every problem takes away its weight. Never below 5."""
    lost = sum(max(0, float(f.get("w") or 0)) for f in findings or [])
    return int(max(5, min(100, round(100 - lost))))


def name_list(names, k=3):
    """'A, B, C' or 'A, B, C and 4 more' (never a sentence built from pieces: the whole list is one key)."""
    names = [str(n) for n in names]
    head = ", ".join(names[:k])
    return head if len(names) <= k else tr("{list} and {n} more", list=head, n=len(names) - k)


def sort_findings(findings):
    return sorted(findings, key=lambda f: (SEV_ORDER.get(f.get("sev"), 3), -float(f.get("w") or 0)))


# =============================================================== registry access (replaceable in tests)
_HIVE = {"HKCU": HKCU, "HKLM": HKLM}


class WinReg:
    """The real registry. Tests swap REG for an in-memory fake with the same three methods."""

    @staticmethod
    def _view(hive):
        return V64 if hive == "HKLM" else 0

    def read(self, hive, path, name):
        try:
            with winreg.OpenKey(_HIVE[hive], path, 0, winreg.KEY_READ | self._view(hive)) as k:
                data, typ = winreg.QueryValueEx(k, name)
                return True, data, typ
        except OSError:
            return False, None, None

    def write(self, hive, path, name, typ, data):
        with winreg.CreateKeyEx(_HIVE[hive], path, 0, winreg.KEY_SET_VALUE | self._view(hive)) as k:
            winreg.SetValueEx(k, name, 0, typ, data)

    def delete(self, hive, path, name):
        try:
            with winreg.OpenKey(_HIVE[hive], path, 0, winreg.KEY_SET_VALUE | self._view(hive)) as k:
                winreg.DeleteValue(k, name)
        except FileNotFoundError:
            pass


REG = WinReg()


def _enc(d):
    return {"hex": bytes(d).hex()} if isinstance(d, (bytes, bytearray)) else d


def _dec(d):
    return bytes.fromhex(d["hex"]) if isinstance(d, dict) and "hex" in d else d


# =============================================================== change history (backup first, undo later)
def _changes_dir():
    _migrate_legacy()
    d = os.path.join(DATA, "changes", _user_tag())
    os.makedirs(d, exist_ok=True)
    return d


def _L(key, tkeys=(), **kw):
    """A history label kept as its English sentence plus values, so it is translated when it is shown (tkeys: the values
    that are English names to translate too)."""
    return {"lk": key, "lkw": kw, "lkt": list(tkeys)}


def _lt(lab):
    """The text of a label made with _L (or of an old plain-text one)."""
    if isinstance(lab, dict) and "lk" in lab:
        kw = {k: (tr(v) if k in lab.get("lkt", ()) else v) for k, v in (lab.get("lkw") or {}).items()}
        return tr(lab["lk"], **kw)
    return lab


def _rec_label(rec):
    return _lt(rec) if rec.get("lk") else rec.get("label")


def _label_fields(lab):
    return {**lab, "label": _lt(lab)} if isinstance(lab, dict) else {"label": lab}


def _save_change(rec):
    """Saves the backup of a change. Raises OSError (with a clear message) if it can't: callers do this BEFORE
    changing anything, so a change without a backup is never made."""
    rec.setdefault("t", time.time())
    rec.setdefault("undone", False)
    try:
        base = time.strftime("%Y%m%d-%H%M%S")
        bid, n = base, 1
        while os.path.exists(os.path.join(_changes_dir(), bid + ".json")):
            n += 1
            bid = f"{base}-{n:02d}"
        rec["id"] = bid
        _write_json(os.path.join(_changes_dir(), bid + ".json"), rec)
    except OSError as e:
        raise OSError(tr("Not changed: the backup of the previous state couldn't be saved ({error}).", error=e)) from e
    return bid


def _load_change(bid):
    f = os.path.join(_changes_dir(), os.path.basename(str(bid)) + ".json")
    rec = _read_json(f)
    if not rec:
        raise FileNotFoundError(tr("That change can no longer be undone: its backup is gone."))
    return rec, f


def _restore_reg(prev):
    """Puts every saved value back, newest first. One that Windows refuses does not stop the others (it used to: the
    values before it in the list stayed changed, also on every later undo). Returns the errors, as text."""
    errors = []
    for p in reversed(prev):
        try:
            if p["exists"]:
                REG.write(p["hive"], p["path"], p["name"], p["type"], _dec(p["data"]))
            else:
                REG.delete(p["hive"], p["path"], p["name"])
        except OSError as e:
            errors.append(f"{p['hive']}\\{p['path']}\\{p['name']}: {e}")
    return errors


def apply_writes(writes, label, extra=None):
    """writes: [(hive, path, name, type, data or None to delete)]. Saves the previous value of each one, then writes.
    If any write fails, everything already written goes back and the error is raised. Returns the backup id."""
    prev, seen = [], set()
    for hive, path, name, typ, data in writes:
        k = (hive, path.lower(), name.lower())
        if k in seen:
            continue
        seen.add(k)
        ex, d, t = REG.read(hive, path, name)
        prev.append({"hive": hive, "path": path, "name": name, "exists": ex, "type": t, "data": _enc(d) if ex else None})
    bid = _save_change({"kind": "reg", **_label_fields(label), "prev": prev, **(extra or {})})
    written = set()
    try:
        for hive, path, name, typ, data in writes:
            if data is None:
                REG.delete(hive, path, name)
            else:
                REG.write(hive, path, name, typ, data)
            written.add((hive, path.lower(), name.lower()))
    except OSError:
        # only what really changed goes back: the value Windows just refused would refuse again and stop the rest
        if not _restore_reg([p for p in prev if (p["hive"], p["path"].lower(), p["name"].lower()) in written]):
            try:
                rec, f = _load_change(bid)
                rec["undone"] = True
                _write_json(f, rec)
            except OSError:
                pass   # all put back; only the history mark is missing (undoing it again changes nothing)
        # else: left as not undone, so the history still offers to put the rest back
        raise
    return bid


def history(limit=30):
    out = []
    try:
        names = sorted((n for n in os.listdir(_changes_dir()) if n.endswith(".json")), reverse=True)[:limit]
    except OSError:
        names = []
    for n in names:
        r = _read_json(os.path.join(_changes_dir(), n))
        if r:
            out.append({"id": r.get("id"), "t": r.get("t"), "label": _rec_label(r), "kind": r.get("kind"),
                        "area": r.get("area"), "undone": bool(r.get("undone"))})
    return out


def undo(bid):
    rec, f = _load_change(bid)
    if rec.get("undone"):
        return {"ok": True, "already": True, "label": _rec_label(rec), "area": rec.get("area")}
    kind = rec.get("kind")
    if kind == "reg":
        if any(user_needs_admin(p["hive"], p["path"]) for p in rec["prev"]) and not _admin():
            return _need_admin()
        bad = _restore_reg(rec["prev"])
        if bad:   # not marked undone: it can be tried again
            raise OSError(tr("Windows didn't accept the change") + " (" + "; ".join(bad)[:300] + ")")
    elif kind == "firewall":
        if not _admin():
            return _need_admin()
        bad = []
        for prof, on in (rec.get("prev") or {}).items():
            if prof in _FW_PROFILES:
                out = ps(f"Set-NetFirewallProfile -Profile {prof} -Enabled {'True' if on else 'False'} -ErrorAction Stop; 'ok'",
                         timeout=40)
                lines = [ln.strip() for ln in (out or "").splitlines() if ln.strip()]
                if "ok" not in lines:
                    bad.append(f"{prof}: {lines[-1] if lines else tr('no reason given')}")
        if bad:   # not marked undone: it can be tried again
            raise OSError(tr("Windows didn't accept the change") + " (" + "; ".join(bad)[:300] + ")")
    elif kind == "autostart":
        for it in rec.get("prev") or []:
            _set_autostart(it["id"], it["enabled"])
    else:
        raise ValueError(kind)
    rec["undone"] = True
    rec["undoneAt"] = time.time()
    try:
        _write_json(f, rec)
    except OSError:
        pass  # it is undone; only the history mark couldn't be saved
    out = {"ok": True, "label": _rec_label(rec), "area": rec.get("area")}
    if rec.get("area") == "tracking":
        out["tracking"] = tracking_read()
    return out


# =============================================================== tracking: Windows privacy settings
_ADV = r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"
_CDM = r"Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager"
_SRCH = r"Software\Microsoft\Windows\CurrentVersion\SearchSettings"
_CS = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore"
# vals: (hive, path, name, type, value when the feature is OFF, value when ON; None = delete it, Windows' default).
# The first value that exists decides the current state; if none exists, "default" applies.
TRACKING = [
    {"id": "adid", "g": "ads", "name": "Advertising ID", "page": "ms-settings:privacy-general", "w": 2,
     "desc": "Apps get an ID that lets them show you ads based on what you do in them.",
     "vals": [("HKCU", r"Software\Microsoft\Windows\CurrentVersion\AdvertisingInfo", "Enabled", DW, 0, 1)], "default": True},
    {"id": "tailored", "g": "ads", "name": "Tailored experiences", "page": "ms-settings:privacy-feedback", "w": 1.5,
     "desc": "Microsoft uses your diagnostic data to show you tips, ads and recommendations.",
     "vals": [("HKCU", r"Software\Microsoft\Windows\CurrentVersion\Privacy", "TailoredExperiencesWithDiagnosticDataEnabled", DW, 0, 1)], "default": True},
    {"id": "langlist", "g": "ads", "name": "Websites see your language list", "page": "ms-settings:privacy-general", "w": .5,
     "desc": "Websites can read the languages you use to show local content. It also helps tell you apart from others.",
     "vals": [("HKCU", r"Control Panel\International\User Profile", "HttpAcceptLanguageOptOut", DW, 1, None)], "default": True},
    {"id": "syncads", "g": "ads", "name": "Promotions in File Explorer", "page": "ms-settings:privacy-general", "w": .5,
     "desc": "File Explorer shows notices from Microsoft, such as OneDrive and Microsoft 365 offers.",
     "vals": [("HKCU", _ADV, "ShowSyncProviderNotifications", DW, 0, 1)], "default": True},
    {"id": "lockfacts", "g": "ads", "name": "Fun facts and tips on the lock screen", "page": "ms-settings:lockscreen", "w": .5,
     "desc": "The lock screen shows tips, facts and promotions picked by Microsoft.",
     "vals": [("HKCU", _CDM, "RotatingLockScreenOverlayEnabled", DW, 0, 1), ("HKCU", _CDM, "SubscribedContent-338387Enabled", DW, 0, 1)], "default": True},
    {"id": "diag", "g": "diag", "name": "Optional diagnostic data", "page": "ms-settings:privacy-feedback", "w": 2,
     "desc": "Besides the required data, Windows sends Microsoft which websites you visit and how you use apps.",
     "vals": [("HKLM", r"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\DataCollection", "AllowTelemetry", DW, 1, 3)], "default": True,
     "lock": [("HKLM", r"SOFTWARE\Policies\Microsoft\Windows\DataCollection", "AllowTelemetry")]},
    {"id": "activity", "g": "diag", "name": "Activity history", "page": "ms-settings:privacy-activityhistory", "w": 1,
     "desc": "Windows keeps a history of the apps, files and websites you open on this PC.",
     "vals": [("HKLM", r"SOFTWARE\Policies\Microsoft\Windows\System", "PublishUserActivities", DW, 0, None),
              ("HKLM", r"SOFTWARE\Policies\Microsoft\Windows\System", "UploadUserActivities", DW, 0, None)], "default": True},
    {"id": "launch", "g": "diag", "name": "App launch tracking", "page": "ms-settings:privacy-general", "w": 1,
     "desc": "Windows records which apps you open to improve Start and search results.",
     "vals": [("HKCU", _ADV, "Start_TrackProgs", DW, 0, 1)], "default": True},
    {"id": "feedback", "g": "diag", "name": "Feedback requests", "page": "ms-settings:privacy-feedback", "w": .5,
     "desc": "Windows asks you from time to time what you think of it.",
     "vals": [("HKCU", r"Software\Microsoft\Siuf\Rules", "NumberOfSIUFInPeriod", DW, 0, None)], "default": True},
    {"id": "startrec", "g": "start", "name": "Recommendations in Start", "page": "ms-settings:personalization-start", "w": 1,
     "desc": "Start shows tips, shortcuts and new apps that Microsoft recommends.",
     "vals": [("HKCU", _ADV, "Start_IrisRecommendations", DW, 0, 1)], "default": True},
    {"id": "settingsads", "g": "start", "name": "Suggested content in Settings", "page": "ms-settings:privacy-general", "w": 1,
     "desc": "The Settings app shows suggestions and offers for Microsoft products.",
     "vals": [("HKCU", _CDM, "SubscribedContent-338393Enabled", DW, 0, 1), ("HKCU", _CDM, "SubscribedContent-353694Enabled", DW, 0, 1),
              ("HKCU", _CDM, "SubscribedContent-353696Enabled", DW, 0, 1)], "default": True},
    {"id": "tips", "g": "start", "name": "Tips and suggestions", "page": "ms-settings:notifications", "w": 1,
     "desc": "Notifications with tips, tricks and suggestions while you use Windows.",
     "vals": [("HKCU", _CDM, "SubscribedContent-338389Enabled", DW, 0, 1), ("HKCU", _CDM, "SoftLandingEnabled", DW, 0, 1)], "default": True},
    {"id": "welcome", "g": "start", "name": "Welcome screens after updates", "page": "ms-settings:notifications", "w": .5,
     "desc": "After some updates Windows shows what is new and suggests finishing setting up your device.",
     "vals": [("HKCU", _CDM, "SubscribedContent-310093Enabled", DW, 0, 1),
              ("HKCU", r"Software\Microsoft\Windows\CurrentVersion\UserProfileEngagement", "ScoobeSystemSettingEnabled", DW, 0, 1)], "default": True},
    {"id": "bing", "g": "start", "name": "Web results in Start search", "page": "ms-settings:search-permissions", "w": 1.5,
     "desc": "What you type in Start search is also sent to Bing to show web results.", "note": "Takes effect after you sign out or restart File Explorer.",
     "vals": [("HKCU", r"Software\Policies\Microsoft\Windows\Explorer", "DisableSearchBoxSuggestions", DW, 1, None),
              ("HKCU", r"Software\Microsoft\Windows\CurrentVersion\Search", "BingSearchEnabled", DW, 0, None)], "default": True},
    {"id": "searchhist", "g": "start", "name": "Search history on this device", "page": "ms-settings:search-permissions", "w": .5,
     "desc": "Windows remembers what you searched for to improve suggestions.",
     "vals": [("HKCU", _SRCH, "IsDeviceSearchHistoryEnabled", DW, 0, 1)], "default": True},
    {"id": "cloudsearch", "g": "start", "name": "Search your online accounts", "page": "ms-settings:search-permissions", "w": .5,
     "desc": "Start search includes content from your Microsoft account, such as OneDrive and Outlook.",
     "vals": [("HKCU", _SRCH, "IsMSACloudSearchEnabled", DW, 0, 1), ("HKCU", _SRCH, "IsAADCloudSearchEnabled", DW, 0, 1)], "default": True},
    {"id": "speech", "g": "input", "name": "Online speech recognition", "page": "ms-settings:privacy-speech", "w": 1,
     "desc": "Your voice is sent to Microsoft to be recognized when you dictate or talk to apps.",
     "vals": [("HKCU", r"Software\Microsoft\Speech_OneCore\Settings\OnlineSpeechPrivacy", "HasAccepted", DW, 0, 1)], "default": False},
    {"id": "inking", "g": "input", "name": "Inking and typing personalization", "page": "ms-settings:privacy-speechtyping", "w": 1,
     "desc": "Windows learns words you write and type, and your contacts, to build a personal dictionary.",
     "vals": [("HKCU", r"Software\Microsoft\CPSS\Store\InkingAndTypingPersonalization", "Value", DW, 0, 1),
              ("HKCU", r"Software\Microsoft\InputPersonalization", "RestrictImplicitTextCollection", DW, 1, 0),
              ("HKCU", r"Software\Microsoft\InputPersonalization", "RestrictImplicitInkCollection", DW, 1, 0),
              ("HKCU", r"Software\Microsoft\InputPersonalization\TrainedDataStore", "HarvestContacts", DW, 0, 1),
              ("HKCU", r"Software\Microsoft\Personalization\Settings", "AcceptedPrivacyPolicy", DW, 0, 1)], "default": True},
    {"id": "typing", "g": "input", "name": "Typing insights", "page": "ms-settings:typing", "w": .5,
     "desc": "Windows keeps statistics of your typing, such as words per minute and corrections.",
     "vals": [("HKCU", r"Software\Microsoft\input\Settings", "InsightsEnabled", DW, 0, 1)], "default": True},
    {"id": "location", "g": "loc", "name": "Location for apps", "page": "ms-settings:privacy-location", "w": 0, "rec": None,
     "desc": "Apps you allow can see where you are. Weather, Maps and Find my device need it.",
     "vals": [("HKCU", _CS + r"\location", "Value", SZ, "Deny", "Allow")], "default": True, "str": True},
]
TRACKING_GROUPS = {"ads": "Ads and promotions", "diag": "Diagnostics and activity", "start": "Start, search and Settings",
                   "input": "Speech, inking and typing", "loc": "Location"}


def tracking_state(item, read=None):
    """True if the Windows feature is on. read(hive, path, name) -> (exists, data, type)."""
    read = read or REG.read
    for hive, path, name, typ, off, on in item["vals"]:
        ex, data, _ = read(hive, path, name)
        if ex:
            if item.get("str"):
                return str(data).strip().lower() != str(off).lower()
            return data != off
    return bool(item.get("default", True))


def tracking_writes(item, on):
    return [(h, p, n, t, (on_v if on else off_v)) for h, p, n, t, off_v, on_v in item["vals"]]


def tracking_findings(items):
    sharing = [i for i in items if i["on"] and i.get("rec") == "off" and not i.get("locked")]
    if not sharing:
        return [], [tr("Windows shares only what it needs")]
    w = min(12, round(sum(i.get("w", 1) for i in sharing), 1))
    names = name_list([i["name"] for i in sharing])
    ids = [i["id"] for i in sharing]
    f = finding("tracking", "tracking", "warn" if w >= 4 else "info", w,
                tr("Windows shares more than it needs: {n} settings", n=len(sharing)) if len(sharing) != 1 else
                tr("Windows shares more than it needs: 1 setting"),
                tr("{names}. Turning them off doesn't break anything and can be undone.", names=names),
                fix={"kind": "tracking", "arg": ids, "label": tr("Turn off {n}", n=len(sharing)),
                     "admin": any(i.get("admin") for i in sharing)})
    return [f], []


def tracking_read():
    adm = _admin()
    items = []
    for it in TRACKING:
        locked = any(REG.read(*lk)[0] for lk in it.get("lock", []))
        items.append({"id": it["id"], "g": it["g"], "name": tr(it["name"]), "desc": tr(it["desc"]),
                      "on": tracking_state(it), "rec": it.get("rec", "off"), "w": it.get("w", 1),
                      "admin": any(user_needs_admin(v[0], v[1]) for v in it["vals"]), "locked": locked, "page": it.get("page"),
                      "note": tr(it["note"]) if it.get("note") else ""})
    findings, passed = tracking_findings(items)
    res = {"items": items, "groups": {k: tr(v) for k, v in TRACKING_GROUPS.items()}, "admin": adm,
           "history": history(12), "findings": findings, "passed": passed}
    _cache_put("tracking", res)
    return res


def tracking_set(ids, on):
    """Turns Windows privacy settings on or off. Saves the previous values first; returns the new state and the
    backup id for undo."""
    if isinstance(ids, str):
        ids = [ids]
    cat = {t["id"]: t for t in TRACKING}
    chosen = [cat[i] for i in ids if i in cat]
    if not chosen:
        raise ValueError(ids)
    chosen = [c for c in chosen if not any(REG.read(*lk)[0] for lk in c.get("lock", []))]
    if not chosen:
        raise PermissionError(tr("Your organization manages this setting."))
    if any(user_needs_admin(v[0], v[1]) for c in chosen for v in c["vals"]) and not _admin():
        return _need_admin()
    on = bool(on)
    if len(chosen) == 1:
        label = _L("{name}: turned on" if on else "{name}: turned off", ("name",), name=chosen[0]["name"])
    else:
        label = _L("{n} privacy settings turned on" if on else "{n} privacy settings turned off", n=len(chosen))
    writes = [w for c in chosen for w in tracking_writes(c, on)]
    bid = apply_writes(writes, label, {"area": "tracking", "ids": [c["id"] for c in chosen], "on": on})
    r = tracking_read()
    r.update(backup=bid, label=_lt(label))
    return r


# =============================================================== one-click fixes from the overview
_FW_PROFILES = ("Domain", "Private", "Public")
_POL_SYS = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"


def fix(kind, arg=None):
    """Safe, reversible fixes. Returns {ok, backup, label} or {needAdmin: True}."""
    if kind == "tracking":
        r = tracking_set(arg or [], False)
        if r.get("needAdmin"):
            return r
        return {"ok": True, "backup": r["backup"], "label": r["label"], "tracking": r}
    if kind == "firewall":
        profs = [p for p in (arg or _FW_PROFILES) if p in _FW_PROFILES]
        if not profs:
            raise ValueError(arg)
        if not _admin():
            return _need_admin()
        cur = ps_json("Get-NetFirewallProfile | ForEach-Object { [pscustomobject]@{ n=[string]$_.Name; on=([string]$_.Enabled -eq 'True') } }",
                      timeout=40, as_list=True)
        prev = {c["n"]: bool(c.get("on")) for c in cur if c.get("n") in profs}
        if set(prev) != set(profs):   # the current state could not be read: an undo would have nothing to put back
            raise OSError(tr("Not changed: the backup of the previous state couldn't be saved ({error}).",
                             error="Get-NetFirewallProfile"))
        label = _L("Windows Firewall turned on")
        bid = _save_change({"kind": "firewall", **_label_fields(label), "prev": prev, "area": "protection"})  # raises: nothing is changed
        out = ps(f"Set-NetFirewallProfile -Profile {','.join(profs)} -Enabled True -ErrorAction Stop; 'ok'", timeout=40)
        lines = [ln.strip() for ln in (out or "").splitlines() if ln.strip()]
        if "ok" not in lines:   # it used to be reported as done (and offered for undo) whatever Windows answered
            try:
                rec, f = _load_change(bid)
                rec["undone"] = True
                _write_json(f, rec)
            except OSError:
                pass
            raise OSError(tr("Windows did not turn it on: {detail}",
                             detail=(lines[-1] if lines else tr("no reason given"))[:300]))
        return {"ok": True, "backup": bid, "label": _lt(label)}
    if kind == "uac":
        if not _admin():
            return _need_admin()
        label = _L("User Account Control back to the recommended level")
        bid = apply_writes([("HKLM", _POL_SYS, "EnableLUA", DW, 1), ("HKLM", _POL_SYS, "ConsentPromptBehaviorAdmin", DW, 5),
                            ("HKLM", _POL_SYS, "PromptOnSecureDesktop", DW, 1)], label, {"area": "protection"})
        return {"ok": True, "backup": bid, "label": _lt(label)}
    if kind == "smartscreen":
        if not _admin():
            return _need_admin()
        label = _L("SmartScreen for apps and files turned on")
        bid = apply_writes([("HKLM", r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer", "SmartScreenEnabled", SZ, "Warn")],
                           label, {"area": "protection"})
        return {"ok": True, "backup": bid, "label": _lt(label)}
    if kind == "edgess":
        label = _L("SmartScreen in Microsoft Edge turned on")
        bid = apply_writes([("HKCU", r"Software\Microsoft\Edge", "SmartScreenEnabled", DW, 1)], label, {"area": "protection"})
        return {"ok": True, "backup": bid, "label": _lt(label)}
    raise ValueError(kind)


# =============================================================== app permissions (CapabilityAccessManager)
CAPS = {
    "webcam": ("Camera", "privacy-webcam"), "microphone": ("Microphone", "privacy-microphone"),
    "location": ("Location", "privacy-location"), "contacts": ("Contacts", "privacy-contacts"),
    "appointments": ("Calendar", "privacy-calendar"), "phoneCall": ("Phone calls", "privacy-phonecalls"),
    "phoneCallHistory": ("Call history", "privacy-callhistory"), "email": ("Email", "privacy-email"),
    "userDataTasks": ("Tasks", "privacy-tasks"), "chat": ("Messaging", "privacy-messaging"),
    "radios": ("Radios", "privacy-radios"), "bluetoothSync": ("Other devices", "privacy-customdevices"),
    "appDiagnostics": ("App diagnostics", "privacy-appdiagnostics"), "documentsLibrary": ("Documents", "privacy-documents"),
    "picturesLibrary": ("Pictures", "privacy-pictures"), "videosLibrary": ("Videos", "privacy-videos"),
    "musicLibrary": ("Music library", "privacy-musiclibrary"), "broadFileSystemAccess": ("File system", "privacy-broadfilesystemaccess"),
    "userAccountInformation": ("Account info", "privacy-accountinfo"), "userNotificationListener": ("Notifications", "privacy-notifications"),
    "graphicsCaptureProgrammatic": ("Screen capture", "privacy-graphicscaptureprogrammatic"),
    "graphicsCaptureWithoutBorder": ("Screen capture without a border", "privacy-graphicscapturewithoutborder"),
    "gazeInput": ("Eye tracker", "privacy-eyetracker"), "systemAIModels": ("Text and image generation", "privacy-systemaimodels"),
    "humanInterfaceDevice": ("Human interface devices", "privacy-customdevices"), "activity": ("Motion", "privacy-motion"),
    "bluetooth": ("Bluetooth", "privacy-radios"), "usb": ("USB devices", "privacy-customdevices"),
    "serialCommunication": ("Serial ports", "privacy-customdevices"), "wifiData": ("Wi-Fi data", "privacy"),
    "cellularData": ("Cellular data", "privacy"), "wiFiDirect": ("Wi-Fi Direct", "privacy-customdevices"),
    "sensors.custom": ("Custom sensors", "privacy-customdevices"),
}
PRIMARY_CAPS = ("webcam", "microphone", "location")
_SKIP_CAPS = {"passkeys", "passkeysEnumeration"}  # websites with passkeys, not app permissions


def _int(v):
    if isinstance(v, (bytes, bytearray)) and len(v) >= 8:
        return int.from_bytes(bytes(v[:8]), "little")
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def filetime_to_unix(ft):
    """Windows FILETIME (100 ns intervals since 1601-01-01) to Unix seconds. None for 0, missing or garbage."""
    ft = _int(ft)
    if not ft or ft <= 0:
        return None
    s = ft / 1e7 - 11644473600
    return s if 0 < s < 4102444800 else None  # up to 2100


def usage(start_raw, stop_raw):
    """When an app last used a capability. LastUsedTimeStop = 0 with a start time means it is using it right now."""
    s, e = filetime_to_unix(start_raw), filetime_to_unix(stop_raw)
    return {"start": s, "stop": e, "active": s is not None and _int(stop_raw) == 0}


def _vals(root, path):
    return {n: d for n, d, _ in registry.values(root, path)}


def _np_path(key):
    return key.replace("#", "\\")


def _pretty_family(fam):
    name = fam.split("_")[0]
    last = name.split(".")[-1] if "." in name else name
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", last).strip() or name


def _version_str(path, field):
    try:
        ver = ctypes.windll.version
        size = ver.GetFileVersionInfoSizeW(path, None)
        if not size:
            return ""
        buf = ctypes.create_string_buffer(size)
        if not ver.GetFileVersionInfoW(path, 0, size, buf):
            return ""
        ptr, ln = ctypes.c_void_p(), ctypes.c_uint()
        keys = []
        if ver.VerQueryValueW(buf, r"\VarFileInfo\Translation", ctypes.byref(ptr), ctypes.byref(ln)) and ln.value >= 4:
            raw = ctypes.string_at(ptr, 4)
            lang, cp = int.from_bytes(raw[:2], "little"), int.from_bytes(raw[2:4], "little")
            keys.append(f"\\StringFileInfo\\{lang:04x}{cp:04x}\\{field}")
        keys += [f"\\StringFileInfo\\040904b0\\{field}", f"\\StringFileInfo\\040904e4\\{field}"]
        for k in keys:
            if ver.VerQueryValueW(buf, k, ctypes.byref(ptr), ctypes.byref(ln)) and ln.value:
                return ctypes.wstring_at(ptr, ln.value - 1).strip()
    except Exception:
        pass
    return ""


def _names_file():
    return _dpath(f"appnames-{_user_tag()}.json")


def _names():
    return _read_json(_names_file(), {}) or {}


def _read_permissions():
    """Raw read of the consent store: [{id, apps:[{key, kind, id, value, start, stop, active}], user, device, desktop}]."""
    out = []
    for cap in registry.subkeys(HKCU, _CS):
        if cap in _SKIP_CAPS:
            continue
        base = f"{_CS}\\{cap}"
        apps = []
        for sub in registry.subkeys(HKCU, base):
            if sub == "NonPackaged":
                for np in registry.subkeys(HKCU, base + "\\NonPackaged"):
                    v = _vals(HKCU, f"{base}\\NonPackaged\\{np}")
                    apps.append({"key": "np|" + np, "kind": "np", "id": _np_path(np), "value": v.get("Value"),
                                 **usage(v.get("LastUsedTimeStart"), v.get("LastUsedTimeStop"))})
            elif "_" in sub:  # package family names; the rest are devices (Bluetooth LE), not apps
                v = _vals(HKCU, f"{base}\\{sub}")
                apps.append({"key": "pkg|" + sub, "kind": "pkg", "id": sub, "value": v.get("Value"),
                             **usage(v.get("LastUsedTimeStart"), v.get("LastUsedTimeStop"))})
        out.append({"id": cap, "apps": apps, "user": registry.get_value(HKCU, base, "Value"),
                    "device": registry.get_value(HKLM, base, "Value", V64),
                    "desktop": registry.get_value(HKCU, base + "\\NonPackaged", "Value")})
    return out


def _confirm_active(caps):
    """A crashed app can leave Stop = 0 behind: a desktop app is only 'in use now' if it is really running."""
    if not any(a["active"] and a["kind"] == "np" for c in caps for a in c["apps"]):
        return
    running = {paths.norm_path(p["path"]) for p in rsys.list_processes() if p.get("path")}
    for c in caps:
        for a in c["apps"]:
            if a["active"] and a["kind"] == "np" and os.path.splitext(a["id"])[1].lower() == ".exe":
                if paths.norm_path(a["id"]) not in running:
                    a["active"] = False


def permissions():
    """Which apps used the camera, microphone, location... and when. Names and icons come from the cache;
    perm_details (job) resolves the missing ones."""
    caps = _read_permissions()
    _confirm_active(caps)
    names = _names()
    missing = []
    out = []
    for c in caps:
        name, page = CAPS.get(c["id"], (c["id"], "privacy"))
        apps = []
        for a in c["apps"]:
            info = names.get(a["key"])
            if a["kind"] == "np":
                nm = (info or {}).get("name") or os.path.splitext(os.path.basename(a["id"]))[0] or a["id"]
                exists = os.path.exists(a["id"])
            else:
                nm = (info or {}).get("name") or _pretty_family(a["id"])
                exists = True
            if info is None and exists and a["key"] not in missing:
                missing.append(a["key"])
            apps.append({**a, "name": nm, "icon": (info or {}).get("icon"), "path": a["id"] if a["kind"] == "np" else "",
                         "pub": (info or {}).get("pub", ""), "gone": not exists})
        apps.sort(key=lambda x: (not x["active"], -(x["start"] or 0), x["name"].lower()))
        out.append({"id": c["id"], "name": tr(name), "page": "ms-settings:" + page, "apps": apps, "user": c["user"],
                    "device": c["device"], "desktop": c["desktop"], "primary": c["id"] in PRIMARY_CAPS})
    order = {k: i for i, k in enumerate(CAPS)}
    out.sort(key=lambda c: (not c["primary"], order.get(c["id"], 99)))
    res = {"caps": out, "missing": missing, "now": time.time()}
    res["findings"], res["passed"] = perm_findings(out)
    _cache_put("permissions", res)
    return res


def perm_findings(caps, now=None):
    now = now or time.time()
    F, ok = [], []
    for c in caps:
        if c["id"] not in PRIMARY_CAPS:
            continue
        act = [a for a in c["apps"] if a.get("active")]
        if act:
            F.append(finding("inuse-" + c["id"], "permissions", "info", 0,
                             tr("{cap} in use now by {app}", cap=c["name"], app=act[0]["name"]),
                             tr("If you don't recognize it, close the app or turn off its access in Windows Settings."),
                             uri=c["page"]))
        recent = [a for a in c["apps"] if a.get("start") and now - a["start"] < 7 * 86400]
        if recent and not act:
            F.append(finding("recent-" + c["id"], "permissions", "info", 0,
                             tr("{n} apps used: {cap}, this week", n=len(recent), cap=c["name"]) if len(recent) != 1 else
                             tr("1 app used: {cap}, this week", cap=c["name"]),
                             name_list([a["name"] for a in recent]) + ".", uri=c["page"]))
    if not any(f["id"].startswith("inuse-") for f in F):
        ok.append(tr("Nothing is using your camera or microphone right now"))
    return F, ok


def perm_live():
    """Light poll for the live 'in use now' state: [{cap, key, start}] of what is being used right now."""
    caps = _read_permissions()
    _confirm_active(caps)
    return {"active": [{"cap": c["id"], "key": a["key"], "start": a["start"]} for c in caps for a in c["apps"] if a["active"]],
            "now": time.time()}


def _appx_info(families):
    """Name, publisher and logo of Store apps, from their manifests."""
    from .removal import programs
    fams = {f.lower() for f in families}
    out = {}
    for p in programs.cached_store_apps():
        if (p.get("family") or "").lower() in fams and p.get("name"):
            out[p["family"].lower()] = {"name": p["name"], "pub": p.get("publisher", ""), "icon": p.get("icon") or ""}
    todo = [f for f in fams if f not in out]
    if not todo:
        return out
    rows = ps_json("Get-AppxPackage | ForEach-Object { [pscustomobject]@{ Name=$_.Name; Full=$_.PackageFullName; "
                   "Family=$_.PackageFamilyName; Loc=$_.InstallLocation } }", timeout=60, as_list=True)
    for a in rows:
        fam = (a.get("Family") or "").lower()
        if fam not in todo or fam in out:
            continue
        pr = programs._manifest_props(a.get("Loc")) or {}
        nm = programs._resolve_resource(pr.get("DisplayName"), a) or programs._pretty_package_name(a.get("Name") or fam)
        pub = programs._resolve_resource(pr.get("PublisherDisplayName"), a) or ""
        out[fam] = {"name": nm, "pub": pub, "icon": programs._store_logo(a.get("Loc"), pr.get("Logo"))}
    return out


def perm_details(job, keys=None):
    """Real names, publishers and icons of the apps in the permission lists (slow the first time; then cached)."""
    names = _names()
    keys = [k for k in (keys or []) if isinstance(k, str)]
    pk = [k[4:] for k in keys if k.startswith("pkg|")]
    npk = [k for k in keys if k.startswith("np|")]
    job.progress(.1, tr("Reading app names…"))
    try:
        info = _appx_info(pk) if pk else {}
    except Exception:
        info = {}
    for fam in pk:
        i = info.get(fam.lower())
        ico = ricons.get_icon({"source": "store", "icon": i["icon"]}) if i and i.get("icon") and os.path.isfile(i["icon"]) else None
        names["pkg|" + fam] = {"name": (i or {}).get("name") or _pretty_family(fam), "pub": (i or {}).get("pub", ""), "icon": ico}
    for n, k in enumerate(npk):
        job.progress(.3 + .7 * n / max(1, len(npk)), tr("Reading app names…"))
        p = _np_path(k[3:])
        nm = os.path.splitext(os.path.basename(p))[0]
        pub = ""
        if os.path.isfile(p):
            nm = _version_str(p, "FileDescription") or nm
            pub = _version_str(p, "CompanyName")
        ico = ricons.icon_for_file(p) if os.path.isfile(p) else None
        names[k] = {"name": nm, "pub": pub, "icon": ico}
    try:
        _write_json(_names_file(), names)
    except OSError:
        pass
    job.progress(1, tr("Done"))
    return {k: names[k] for k in keys if k in names}


def icons(paths_):
    """PNG data URIs for executables (extracted once, then cached on disk). At most 60 per call."""
    out = {}
    for p in (paths_ or [])[:60]:
        if isinstance(p, str) and p and os.path.isfile(p):
            try:
                out[p] = ricons.icon_for_file(p)
            except Exception:
                out[p] = None
    return out


# =============================================================== protection
_SC2_PS = r"""
$o = [ordered]@{}
try { $m = Get-MpComputerStatus -ErrorAction Stop
  $o.mp = [pscustomobject]@{ mode=[string]$m.AMRunningMode; av=[bool]$m.AntivirusEnabled; rt=[bool]$m.RealTimeProtectionEnabled;
    sig=$(if ($m.AntivirusSignatureLastUpdated) { $m.AntivirusSignatureLastUpdated.ToString('o') } else { $null });
    quick=$(if ($m.QuickScanEndTime) { $m.QuickScanEndTime.ToString('o') } else { $null });
    full=$(if ($m.FullScanEndTime) { $m.FullScanEndTime.ToString('o') } else { $null });
    tamper=[bool]$m.IsTamperProtected; ver=[string]$m.AMProductVersion }
} catch { $o.mp = $null }
$o.av = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ n=[string]$_.displayName; s=[int64]$_.productState; p=[string]$_.pathToSignedProductExe } })
$o.fwp = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName FirewallProduct -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ n=[string]$_.displayName; s=[int64]$_.productState } })
$o.fw = @(Get-NetFirewallProfile -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ n=[string]$_.Name; on=([string]$_.Enabled -eq 'True'); inb=[string]$_.DefaultInboundAction } })
try { $o.bl = (New-Object -ComObject Shell.Application).NameSpace($env:SystemDrive + '\').Self.ExtendedProperty('System.Volume.BitLockerProtection') } catch { $o.bl = $null }
[pscustomobject]$o
"""
_QFE_PS = r"""
$o = [ordered]@{}
$q = @(Get-CimInstance Win32_QuickFixEngineering -ErrorAction SilentlyContinue | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending)
$s = $q | Where-Object { $_.Description -like '*Security*' } | Select-Object -First 1
$a = $q | Select-Object -First 1
$o.sec = $(if ($s) { [pscustomobject]@{ kb=[string]$s.HotFixID; d=$s.InstalledOn.ToString('o') } } else { $null })
$o.any = $(if ($a) { [pscustomobject]@{ kb=[string]$a.HotFixID; d=$a.InstalledOn.ToString('o') } } else { $null })
$o.tpm = @(Get-PnpDevice -Class SecurityDevices -PresentOnly -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ n=[string]$_.FriendlyName; st=[string]$_.Status } })
[pscustomobject]$o
"""


def product_state(v):
    """Security Center productState -> (enabled, up to date). 0x061100: '11'/'10' = on, last byte '00' = up to date."""
    try:
        h = f"{int(v):06x}"[-6:]
    except (TypeError, ValueError):
        return None, None
    return h[2:4] in ("10", "11"), h[4:6] == "00"


def uac_level(lua, consent, secure):
    """User Account Control slider position: off, never, nodim, default, always or custom."""
    if lua == 0:
        return "off"
    if consent == 0:
        return "never"
    if consent == 2:
        return "always"
    if consent == 5 or consent is None:
        return "default" if secure != 0 else "nodim"
    return "custom"


_BL = {1: "on", 2: "off", 3: "encrypting", 4: "decrypting", 5: "suspended", 6: "on"}


def _iso_days(iso, now=None):
    if not iso:
        return None
    try:
        from datetime import datetime, timezone
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return max(0, int(((now or time.time()) - d.timestamp()) // 86400))
    except ValueError:
        return None


def _reg(root, path, name, view=0):
    return registry.get_value(root, path, name, view)


def _smartscreen():
    pol = _reg(HKLM, r"SOFTWARE\Policies\Microsoft\Windows\System", "EnableSmartScreen", V64)
    v = _reg(HKLM, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer", "SmartScreenEnabled", V64)
    apps = ("on" if pol else "off") if pol is not None else ("off" if str(v).lower() == "off" else "on")
    epol = _reg(HKLM, r"SOFTWARE\Policies\Microsoft\Edge", "SmartScreenEnabled", V64)
    ev = _reg(HKCU, r"Software\Microsoft\Edge", "SmartScreenEnabled")
    edge = ("on" if epol else "off") if epol is not None else ("off" if ev == 0 else "on")
    store = "off" if _reg(HKCU, r"Software\Microsoft\Windows\CurrentVersion\AppHost", "EnableWebContentEvaluation") == 0 else "on"
    return {"apps": apps, "appsManaged": pol is not None, "edge": edge, "edgeManaged": epol is not None, "store": store}


def defender_normal(mode):
    """Defender is the active antivirus ("Normal"; Windows has been seen writing it in its own language, "ejecución
    normal" on a Spanish Windows), not passive, off or not running."""
    m = str(mode or "").strip().lower()
    return "normal" in m and "passive" not in m and "pasiv" not in m and "пассив" not in m


def protection(job):
    adm = _admin()
    job.progress(.05, tr("Asking Windows Security…"))
    with ThreadPoolExecutor(max_workers=2) as ex:
        f1 = ex.submit(ps_json, _SC2_PS, 60)
        f2 = ex.submit(ps_json, _QFE_PS, 60)
        job.progress(.2, tr("Reading device security…"))
        lua = _reg(HKLM, _POL_SYS, "EnableLUA", V64)
        consent = _reg(HKLM, _POL_SYS, "ConsentPromptBehaviorAdmin", V64)
        secure = _reg(HKLM, _POL_SYS, "PromptOnSecureDesktop", V64)
        sb = _reg(HKLM, r"SYSTEM\CurrentControlSet\Control\SecureBoot\State", "UEFISecureBootEnabled", V64)
        hvci = _reg(HKLM, r"SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity", "Enabled", V64)
        lsa = _reg(HKLM, r"SYSTEM\CurrentControlSet\Control\Lsa", "RunAsPPL", V64)
        sac = _reg(HKLM, r"SYSTEM\CurrentControlSet\Control\CI\Policy", "VerifiedAndReputablePolicyState", V64)
        ss = _smartscreen()
        a = f1.result() or {}
        job.progress(.7, tr("Checking Windows Update…"))
        b = f2.result() or {}
    mp = a.get("mp") or None
    avs = []
    for p in a.get("av") or []:
        on, fresh = product_state(p.get("s"))
        d = (p.get("p") or "").lower().startswith("windowsdefender") or "defender" in (p.get("n") or "").lower()
        avs.append({"name": p.get("n") or "?", "on": bool(on), "uptodate": fresh is not False, "defender": d})
    defender = None
    if mp:
        active = defender_normal(mp.get("mode")) and bool(mp.get("av"))
        defender = {"active": active, "mode": mp.get("mode"), "rt": bool(mp.get("rt")), "sig": mp.get("sig"),
                    "sigDays": _iso_days(mp.get("sig")), "quick": mp.get("quick"), "quickDays": _iso_days(mp.get("quick")),
                    "full": mp.get("full"), "tamper": bool(mp.get("tamper")), "version": mp.get("ver")}
        for x in avs:
            if x["defender"]:
                x["on"] = x["on"] or (active and defender["rt"])
    fw3 = []
    for p in a.get("fwp") or []:
        on, _ = product_state(p.get("s"))
        if on:
            fw3.append(p.get("n"))
    tpms = [t for t in (b.get("tpm") or []) if "tpm" in (t.get("n") or "").lower() or "trusted platform" in (t.get("n") or "").lower()
            or re.search(r"\b[12]\.\d\b", t.get("n") or "")]
    tpm = None
    if tpms:
        m = re.search(r"\b([12]\.\d)\b", tpms[0].get("n") or "")
        tpm = {"present": True, "ok": (tpms[0].get("st") or "OK").upper() == "OK", "version": m.group(1) if m else None}
    elif b:
        tpm = {"present": False, "ok": False, "version": None}
    sec = b.get("sec") or b.get("any")
    patch = {"kb": sec.get("kb"), "date": sec.get("d"), "days": _iso_days(sec.get("d")), "security": bool(b.get("sec"))} if sec else None
    res = {"admin": adm, "av": avs, "defender": defender,
           "firewall": {"profiles": [{"name": f.get("n"), "on": bool(f.get("on"))} for f in a.get("fw") or []], "third": fw3},
           "uac": uac_level(lua, consent, secure), "secureBoot": None if sb is None else bool(sb), "tpm": tpm,
           "bitlocker": _BL.get(_int(a.get("bl"))) if a.get("bl") is not None else None,
           "hvci": None if hvci is None else bool(hvci), "lsa": None if lsa is None else bool(lsa),
           "smartscreen": ss, "sac": {0: "off", 1: "on", 2: "eval"}.get(sac), "patch": patch}
    res["findings"], res["passed"] = protection_findings(res)
    job.progress(1, tr("Done"))
    _cache_put("protection", res)
    return res


def protection_findings(p):
    F, ok = [], []
    act = [a for a in p.get("av") or [] if a["on"]]
    d = p.get("defender") or {}
    if not p.get("av") and not d:
        pass
    elif not act:
        F.append(finding("av-off", "protection", "bad", 30, tr("No antivirus is protecting this PC"),
                         tr("Real-time protection is off and no other antivirus is active. Turn on Microsoft Defender in Windows Security."),
                         uri="windowsdefender://threat"))
    else:
        names = ", ".join(a["name"] for a in act)
        old = [a for a in act if not a["uptodate"]]
        if d.get("active") and (d.get("sigDays") or 0) > 7:
            F.append(finding("sig-old", "protection", "warn", 8, tr("Virus definitions are {n} days old", n=d["sigDays"]),
                             tr("Microsoft Defender can't recognize the newest threats. Update it from Windows Security or Windows Update."),
                             uri="windowsdefender://threat"))
        elif old:
            F.append(finding("sig-old", "protection", "warn", 8, tr("{name} needs updating", name=old[0]["name"]),
                             tr("Its virus definitions are out of date, so it can miss new threats. Open it and update it.")))
        else:
            ok.append(tr("Antivirus on and up to date: {names}", names=names))
        if d.get("active") and not d.get("rt"):
            F.append(finding("rt-off", "protection", "bad", 25, tr("Real-time protection is off"),
                             tr("Microsoft Defender only checks files when you scan. Turn it back on in Windows Security."),
                             uri="windowsdefender://threatsettings"))
    fw = (p.get("firewall") or {})
    off = [f["name"] for f in fw.get("profiles") or [] if not f["on"]]
    if off and not fw.get("third"):
        names = {"Domain": tr("Domain network"), "Private": tr("Private network"), "Public": tr("Public network")}
        F.append(finding("fw-off", "protection", "bad", 15, tr("Windows Firewall is off: {list}", list=", ".join(names.get(o, o) for o in off)),
                         tr("Other devices on the network can reach programs on your PC directly. Turning it back on can be undone."),
                         fix={"kind": "firewall", "arg": off, "label": tr("Turn on"), "admin": True}, uri="windowsdefender://network"))
    elif fw.get("third"):
        ok.append(tr("Firewall on: {name}", name=", ".join(fw["third"])))
    elif fw.get("profiles"):
        ok.append(tr("Windows Firewall on for every network"))
    u = p.get("uac")
    if u == "off":
        F.append(finding("uac", "protection", "bad", 20, tr("User Account Control is turned off"),
                         tr("Any program can make changes to Windows without asking you. Back to the recommended level, after a restart."),
                         fix={"kind": "uac", "label": tr("Fix"), "admin": True}))
    elif u == "never":
        F.append(finding("uac", "protection", "bad", 12, tr("Windows never asks before programs make changes"),
                         tr("User Account Control is set to “Never notify”. Back to the recommended level with one click."),
                         fix={"kind": "uac", "label": tr("Fix"), "admin": True}))
    elif u in ("nodim", "custom"):
        F.append(finding("uac", "protection", "info", 3, tr("User Account Control is below the recommended level"),
                         tr("The prompt doesn't use the secure desktop, so other programs could interfere with it."),
                         fix={"kind": "uac", "label": tr("Fix"), "admin": True}))
    elif u:
        ok.append(tr("User Account Control at the recommended level"))
    if p.get("secureBoot") is False:
        F.append(finding("secureboot", "protection", "warn", 6, tr("Secure Boot is off"),
                         tr("It stops malware from loading before Windows. It's turned on in the BIOS/UEFI settings, not from Windows.")))
    elif p.get("secureBoot"):
        ok.append(tr("Secure Boot on"))
    t = p.get("tpm")
    if t and not t.get("present"):
        F.append(finding("tpm", "protection", "info", 2, tr("No TPM security chip found"),
                         tr("Without it, encryption and Windows Hello are less secure. On many PCs it is turned on in the BIOS/UEFI.")))
    elif t:
        ok.append(tr("TPM security chip {v}", v=t.get("version") or "").strip())
    bl = p.get("bitlocker")
    if bl == "off":
        F.append(finding("bitlocker", "protection", "warn", 6, tr("Your system drive isn't encrypted"),
                         tr("If someone takes your PC or its drive, they can read your files. Turn on device encryption or BitLocker in Settings."),
                         uri="ms-settings:deviceencryption"))
    elif bl == "suspended":
        F.append(finding("bitlocker", "protection", "warn", 4, tr("Drive encryption is paused"),
                         tr("BitLocker is suspended, so the drive isn't protected right now. Resume it from BitLocker settings.")))
    elif bl in ("on", "encrypting"):
        ok.append(tr("System drive encrypted"))
    if p.get("hvci") is False:
        F.append(finding("hvci", "protection", "warn", 4, tr("Memory integrity is off"),
                         tr("It blocks malicious drivers from reaching the heart of Windows. Turn it on in Windows Security > Device security."),
                         uri="windowsdefender://coreisolation"))
    elif p.get("hvci"):
        ok.append(tr("Memory integrity on"))
    ss = p.get("smartscreen") or {}
    if ss.get("apps") == "off":
        F.append(finding("smartscreen", "protection", "warn", 6, tr("SmartScreen for apps and files is off"),
                         tr("Windows won't warn you before you open unknown programs downloaded from the internet."),
                         fix=None if ss.get("appsManaged") else {"kind": "smartscreen", "label": tr("Turn on"), "admin": True},
                         uri="windowsdefender://appbrowser"))
    elif ss.get("apps") == "on":
        ok.append(tr("SmartScreen warns you about unknown apps"))
    if ss.get("edge") == "off" and not ss.get("edgeManaged"):
        F.append(finding("edgess", "protection", "info", 3, tr("SmartScreen is off in Microsoft Edge"),
                         tr("Edge won't block phishing sites and malicious downloads."), fix={"kind": "edgess", "label": tr("Turn on")}))
    pa = p.get("patch")
    if pa and pa.get("days") is not None:
        n = pa["days"]
        if n > 60:
            F.append(finding("patch", "protection", "bad", 15, tr("No security updates for {n} days", n=n),
                             tr("Windows gets security fixes every month. Open Windows Update and install what is pending."),
                             uri="ms-settings:windowsupdate"))
        elif n > 35:
            F.append(finding("patch", "protection", "warn", 6, tr("Last security update was {n} days ago", n=n),
                             tr("Windows gets security fixes every month. Check Windows Update."), uri="ms-settings:windowsupdate"))
        else:
            ok.append(tr("Security updates installed {n} days ago", n=n) if n > 1 else tr("Security updates installed recently"))
    return F, ok


def _mpcmdrun():
    p = os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "Windows Defender", "MpCmdRun.exe")
    return p if os.path.isfile(p) else None


def quick_scan(job):
    """Microsoft Defender quick scan (only when Defender is the active antivirus)."""
    mp = _mpcmdrun()
    st = ps_json("Get-MpComputerStatus | Select-Object AMRunningMode, AntivirusEnabled", timeout=30) or {}
    if not mp or not defender_normal(st.get("AMRunningMode")) or not st.get("AntivirusEnabled"):
        raise RuntimeError(tr("Microsoft Defender isn't the active antivirus, so it can't scan. Use your antivirus instead."))
    job.progress(None, tr("Scanning the places malware usually hides…"), force=True)
    t0 = time.time()
    code, out = ps_run([mp, "-Scan", "-ScanType", "1"], on_line=lambda line: line.strip() and job.log(line.strip()), job=job)
    if job.cancelled:
        ps_run([mp, "-Scan", "-Cancel"], timeout=30)
        job.stop()
    found = ps_json("@(Get-MpThreatDetection -ErrorAction SilentlyContinue | Where-Object { $_.InitialDetectionTime -gt "
                    f"(Get-Date).AddSeconds(-{int(time.time() - t0) + 120}) }}).Count", timeout=30)
    job.progress(1, tr("Done"))
    return {"code": code, "threats": found if isinstance(found, int) else 0, "seconds": round(time.time() - t0)}


# =============================================================== network
_RISKY_PORTS = {21: "FTP", 22: "SSH", 23: "Telnet", 135: "RPC", 139: "NetBIOS", 445: "SMB", 3389: "Remote Desktop",
                5900: "VNC", 5985: "WinRM", 5986: "WinRM"}
KNOWN_DOMAINS = ("microsoft.com", "windowsupdate.com", "windows.com", "live.com", "office.com", "bing.com", "msn.com",
                 "google.com", "googleapis.com", "gstatic.com", "youtube.com", "facebook.com", "instagram.com", "whatsapp.com",
                 "apple.com", "icloud.com", "amazon.com", "paypal.com", "github.com", "steampowered.com", "steamcommunity.com",
                 "discord.com", "twitter.com", "x.com", "netflix.com", "outlook.com", "kaspersky.com", "avast.com",
                 "avg.com", "bitdefender.com", "malwarebytes.com", "eset.com", "norton.com", "mcafee.com", "sophos.com",
                 "trendmicro.com", "virustotal.com", "mozilla.org", "brave.com", "opera.com", "epicgames.com", "roblox.com")
SECURITY_HINTS = ("windowsupdate", "update.microsoft", "download.microsoft", "defender", "smartscreen", "wdcp.microsoft",
                  "kaspersky", "avast", "avg.com", "bitdefender", "malwarebytes", "eset.", "norton", "mcafee", "sophos",
                  "trendmicro", "virustotal")
_SINK = ("0.0.0.0", "127.0.0.1", "::1", "::", "0:0:0:0:0:0:0:0", "0:0:0:0:0:0:0:1")


def parse_hosts(text):
    """[{line, ip, host}] for every active mapping in a hosts file."""
    out = []
    for n, line in enumerate((text or "").splitlines(), 1):
        s = line.split("#", 1)[0].strip()
        parts = s.split()
        if len(parts) < 2:
            continue
        for h in parts[1:]:
            out.append({"line": n, "ip": parts[0], "host": h.lower().rstrip(".")})
    return out


def classify_host(e):
    """(kind, level): kind local, block or redirect; level bad, warn or info."""
    host, ip = e["host"], e["ip"]
    if host in ("localhost", "localhost.localdomain", "local", "broadcasthost") or host.endswith((".local", ".localhost", ".test", ".lan")):
        return "local", "info"
    sink = ip in _SINK or ip.startswith("127.")
    known = any(host == d or host.endswith("." + d) for d in KNOWN_DOMAINS)
    sec = any(s in host for s in SECURITY_HINTS)
    if sink:
        return "block", ("warn" if sec else "info")
    return "redirect", ("bad" if known or sec else "info")


def _hosts():
    p = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "drivers", "etc", "hosts")
    try:
        with open(p, "rb") as fh:
            raw = fh.read(4 * 1024 * 1024)
    except OSError:
        return {"path": p, "readable": False, "total": 0, "entries": [], "blocks": 0, "flagged": 0}
    entries = parse_hosts(raw.decode("utf-8", "replace"))
    rows, blocks, flagged, total = [], 0, 0, 0
    for e in entries:
        kind, lvl = classify_host(e)
        if kind == "local":
            continue
        total += 1
        blocks += kind == "block"
        if lvl != "info":
            flagged += 1
        if lvl != "info" or len(rows) < 40:
            rows.append({**e, "kind": kind, "level": lvl})
    rows.sort(key=lambda r: ({"bad": 0, "warn": 1}.get(r["level"], 2), r["line"]))
    return {"path": p, "readable": True, "total": total, "blocks": blocks, "flagged": flagged, "entries": rows[:80]}


def ip_scope(ip):
    """Where a listening socket can be reached from: local (this PC), lan (one network) or all."""
    if ip in ("0.0.0.0", "::", ""):
        return "all"
    try:
        a = ipaddress.ip_address(ip.split("%")[0])
    except ValueError:
        return "all"
    return "local" if a.is_loopback else "lan"


def _public(ip):
    try:
        a = ipaddress.ip_address(ip.split("%")[0])
    except ValueError:
        return True
    return not (a.is_private or a.is_loopback or a.is_link_local or a.is_multicast)


_SVC_CACHE = {"t": 0, "d": {}}


def _svc_by_pid():
    """pid -> service names (cached for a minute: the network list refreshes every few seconds)."""
    if time.time() - _SVC_CACHE["t"] < 60:
        return _SVC_CACHE["d"]
    out = {}
    try:
        import psutil
        for s in psutil.win_service_iter():
            try:
                pid = s.pid()  # only its status: as_dict() also read every service's description and config (5x slower)
            except Exception:
                continue
            if pid:
                out.setdefault(pid, []).append(s.name())
    except Exception:
        pass
    _SVC_CACHE.update(t=time.time(), d=out)
    return out


# ---- Wi-Fi through the WLAN API (independent of the Windows language)
class _GUID(ctypes.Structure):
    _fields_ = [("Data1", ctypes.c_ulong), ("Data2", ctypes.c_ushort), ("Data3", ctypes.c_ushort), ("Data4", ctypes.c_ubyte * 8)]


class _IFINFO(ctypes.Structure):
    _fields_ = [("guid", _GUID), ("desc", ctypes.c_wchar * 256), ("state", ctypes.c_uint)]


class _IFLIST(ctypes.Structure):
    _fields_ = [("n", wintypes.DWORD), ("i", wintypes.DWORD), ("items", _IFINFO * 64)]


class _SSID(ctypes.Structure):
    _fields_ = [("len", ctypes.c_ulong), ("ssid", ctypes.c_ubyte * 32)]


class _ASSOC(ctypes.Structure):
    _fields_ = [("ssid", _SSID), ("bss", ctypes.c_uint), ("bssid", ctypes.c_ubyte * 6), ("phy", ctypes.c_uint),
                ("phyi", ctypes.c_ulong), ("signal", ctypes.c_ulong), ("rx", ctypes.c_ulong), ("tx", ctypes.c_ulong)]


class _SEC(ctypes.Structure):
    _fields_ = [("on", wintypes.BOOL), ("onex", wintypes.BOOL), ("auth", ctypes.c_uint), ("cipher", ctypes.c_uint)]


class _CONN(ctypes.Structure):
    _fields_ = [("state", ctypes.c_uint), ("mode", ctypes.c_uint), ("profile", ctypes.c_wchar * 256), ("assoc", _ASSOC), ("sec", _SEC)]


_AUTH = {1: "Open", 2: "WEP", 3: "WPA-Enterprise", 4: "WPA-Personal", 5: "WPA", 6: "WPA2-Enterprise", 7: "WPA2-Personal",
         8: "WPA3-Enterprise", 9: "WPA3-Personal", 10: "OWE", 11: "WPA3-Enterprise"}
_CIPHER = {0: "", 1: "WEP", 2: "TKIP", 4: "AES-CCMP", 5: "WEP", 8: "GCMP", 9: "GCMP-256", 10: "CCMP-256", 0x101: "WEP"}


def wifi_level(auth, cipher=""):
    """good, weak or open, from the authentication and cipher names."""
    a, c = (auth or "").upper(), (cipher or "").upper()
    if a in ("OPEN", ""):
        return "open"
    if a == "WEP" or "WEP" in c or "TKIP" in c:
        return "weak"
    if a.startswith(("WPA3", "WPA2")) or a == "OWE":
        return "good"
    return "weak"


def _wifi():
    try:
        wl = ctypes.windll.wlanapi
    except OSError:
        return None
    h, ver = wintypes.HANDLE(), wintypes.DWORD()
    if wl.WlanOpenHandle(2, None, ctypes.byref(ver), ctypes.byref(h)) != 0:
        return None
    try:
        plist = ctypes.POINTER(_IFLIST)()
        if wl.WlanEnumInterfaces(h, None, ctypes.byref(plist)) != 0:
            return None
        try:
            for i in range(min(plist.contents.n, 64)):
                it = plist.contents.items[i]
                if it.state != 1:
                    continue
                size, data = wintypes.DWORD(), ctypes.c_void_p()
                r = wl.WlanQueryInterface(h, ctypes.byref(it.guid), 7, None, ctypes.byref(size), ctypes.byref(data), None)
                if r != 0 or not data.value:
                    return {"connected": True, "ssid": None, "auth": None, "cipher": None, "level": None, "denied": r == 5}
                try:
                    c = ctypes.cast(data, ctypes.POINTER(_CONN)).contents
                    ssid = bytes(c.assoc.ssid.ssid[:min(32, c.assoc.ssid.len)]).decode("utf-8", "replace")
                    auth, cipher = _AUTH.get(c.sec.auth, ""), _CIPHER.get(c.sec.cipher, "")
                    return {"connected": True, "ssid": ssid or c.profile, "profile": c.profile, "auth": auth, "cipher": cipher,
                            "level": wifi_level(auth, cipher), "signal": int(c.assoc.signal)}
                finally:
                    wl.WlanFreeMemory(data)
        finally:
            wl.WlanFreeMemory(plist)
    finally:
        wl.WlanCloseHandle(h, None)
    return {"connected": False}


def _net_category(name):
    """Public/private profile of a network by its name (NetworkList profiles)."""
    base = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\NetworkList\Profiles"
    for g in registry.subkeys(HKLM, base, V64):
        if (registry.get_value(HKLM, f"{base}\\{g}", "ProfileName", V64) or "") == name:
            return {0: "public", 1: "private", 2: "domain"}.get(registry.get_value(HKLM, f"{base}\\{g}", "Category", V64))
    return None


_SYS_PROCS = {"system", "svchost.exe", "lsass.exe", "services.exe", "wininit.exe", "spoolsv.exe", "system idle process"}


def network():
    import psutil
    procs = {p["pid"]: p for p in rsys.list_processes()}
    svc = _svc_by_pid()
    try:
        conns = psutil.net_connections(kind="inet")
    except Exception:
        conns = []
    listen, apps, tmp_udp = {}, {}, 0
    rank = {"local": 0, "lan": 1, "all": 2}

    def pinfo(pid):
        p = procs.get(pid) or {}
        name = "System" if pid == 4 else (p.get("name") or (f"PID {pid}" if pid else "?"))
        return name, p.get("path") or ""

    for c in conns:
        if not c.laddr:
            continue
        ip, port = c.laddr.ip, c.laddr.port
        proto = "TCP" if c.type == 1 else "UDP"
        if (proto == "TCP" and c.status == psutil.CONN_LISTEN) or (proto == "UDP" and not c.raddr):
            if proto == "UDP" and port >= 49152:
                tmp_udp += 1
                continue
            name, path = pinfo(c.pid)
            k = (proto, port, c.pid)
            sc = ip_scope(ip)
            cur = listen.get(k)
            if cur and rank[cur["scope"]] >= rank[sc]:
                continue
            listen[k] = {"proto": proto, "port": port, "addr": ip, "scope": sc, "pid": c.pid, "name": name, "path": path,
                         "svc": (svc.get(c.pid) or [])[:4], "known": _RISKY_PORTS.get(port),
                         "system": name.lower() in _SYS_PROCS or c.pid in (0, 4)}
        elif proto == "TCP" and c.status == psutil.CONN_ESTABLISHED and c.raddr:
            rip = c.raddr.ip
            if ip_scope(rip) == "local":
                continue
            name, path = pinfo(c.pid)
            a = apps.setdefault(name.lower(), {"name": name, "path": path, "pids": set(), "n": 0, "remotes": [], "public": 0})
            a["pids"].add(c.pid)
            a["n"] += 1
            pub = _public(rip)
            a["public"] += pub
            if len(a["remotes"]) < 8 and not any(r["ip"] == rip and r["port"] == c.raddr.port for r in a["remotes"]):
                a["remotes"].append({"ip": rip, "port": c.raddr.port, "public": pub})
    lst = sorted(listen.values(), key=lambda x: ({"all": 0, "lan": 1, "local": 2}[x["scope"]], x["system"], x["port"]))
    apl = sorted(({**a, "pids": sorted(a["pids"])} for a in apps.values()), key=lambda a: -a["n"])
    wifi = _wifi()
    if wifi and wifi.get("connected") and (wifi.get("profile") or wifi.get("ssid")):
        wifi["category"] = _net_category(wifi.get("profile") or wifi.get("ssid"))
    res = {"listen": lst, "apps": apl, "tmpUdp": tmp_udp, "hosts": _hosts(), "wifi": wifi, "admin": _admin(), "t": time.time()}
    res["findings"], res["passed"] = network_findings(res)
    _cache_put("network", res)
    return res


def network_findings(n):
    F, ok = [], []
    exposed = [x for x in n.get("listen") or [] if x["scope"] != "local" and x["proto"] == "TCP"]
    third = [x for x in exposed if not x["system"]]
    risky = [x for x in exposed if x.get("known") in ("Remote Desktop", "VNC", "Telnet", "FTP", "SSH")]
    if risky:
        r = risky[0]
        F.append(finding("port-" + str(r["port"]), "network", "warn", 6, tr("{svc} is open to the network", svc=r["known"]),
                         tr("{name} accepts connections on port {port}. If you don't use it, turn it off in the app or in Windows Settings.",
                            name=r["name"], port=r["port"])))
    if third:
        names = sorted({x["name"] for x in third})
        F.append(finding("listen", "network", "info", min(6, 2 * len(names)),
                         tr("{n} apps accept connections from other devices", n=len(names)) if len(names) != 1 else
                         tr("1 app accepts connections from other devices"),
                         name_list(names) + ". " + tr("Normal for games, sync and remote-access apps; check you know them.")))
    else:
        ok.append(tr("No apps of your own are open to the network"))
    h = n.get("hosts") or {}
    bad = [e for e in h.get("entries") or [] if e["level"] == "bad"]
    warn = [e for e in h.get("entries") or [] if e["level"] == "warn"]
    if bad:
        F.append(finding("hosts-redirect", "network", "bad", 15, tr("The hosts file redirects {host}", host=bad[0]["host"]),
                         tr("Visiting it takes you to {ip} instead of the real site. Malware does this to steal logins; remove the line if you didn't add it.",
                            ip=bad[0]["ip"])))
    if warn:
        F.append(finding("hosts-block", "network", "warn", 5, tr("The hosts file blocks {host}", host=warn[0]["host"]),
                         tr("Updates or your antivirus may not be able to reach their servers. Check that you added it on purpose.")))
    if not bad and not warn:
        ok.append(tr("Hosts file without suspicious redirects"))
    w = n.get("wifi") or {}
    if w.get("connected") and w.get("level") == "open":
        F.append(finding("wifi-open", "network", "bad", 10, tr("You're on an open Wi-Fi network"),
                         tr("Anyone nearby can see unencrypted traffic. Avoid signing in to anything important, or use a VPN.")))
    elif w.get("connected") and w.get("level") == "weak":
        F.append(finding("wifi-weak", "network", "warn", 5, tr("Your Wi-Fi uses old, weak security"),
                         tr("{auth} can be broken. Switch your router to WPA2 or WPA3 (AES).", auth=w.get("auth") or "WEP")))
    elif w.get("connected") and w.get("level") == "good":
        ok.append(tr("Wi-Fi protected with {auth}", auth=w.get("auth")))
    return F, ok


# =============================================================== persistence (auto-starts outside the normal list)
_LOLBINS = {"powershell.exe", "pwsh.exe", "wscript.exe", "cscript.exe", "mshta.exe", "rundll32.exe", "regsvr32.exe", "cmd.exe",
            "certutil.exe", "bitsadmin.exe", "conhost.exe", "msbuild.exe", "installutil.exe", "forfiles.exe"}
_SUSP_ARGS = re.compile(r"(?:^|\s)-(?:e|en|enc|encodedcommand)\s|frombase64string|downloadstring|downloadfile|invoke-expression|"
                        r"\biex\b|-w(?:indowstyle)?\s+h(?:idden)?|https?://|\.vbs\b|\.hta\b|javascript:", re.I)
_WRITABLE = ("\\appdata\\", "\\users\\public\\", "\\programdata\\", "\\downloads\\")


def assess(exe, args="", sig=None, signer="", company="", missing=False):
    """Risk hint of something that starts by itself: (low|medium|high, [reasons]). Pure: no disk access."""
    why, pts = [], 0
    lo = (exe or "").lower().replace("/", "\\")
    base = os.path.basename(lo)
    lol = base in _LOLBINS
    if missing:
        pts += 2
        why.append(tr("Points to a file that no longer exists"))
    if lol:
        pts += 2
        why.append(tr("Runs a script or Windows tool, not a program of its own"))
    if args and _SUSP_ARGS.search(args):
        pts += 2 if lol else 1
        why.append(tr("Hidden, encoded or downloaded command"))
    if "\\temp\\" in lo or "\\tmp\\" in lo:
        pts += 2
        why.append(tr("Runs from a temporary folder"))
    elif any(w in lo for w in _WRITABLE) and "\\programdata\\microsoft\\" not in lo:
        pts += 1
        why.append(tr("Runs from a folder any program can write to"))
    s = (sig or "").lower()
    if s == "notsigned":
        pts += 2
        why.append(tr("Not digitally signed"))
    elif s in ("hashmismatch", "nottrusted", "incompatible", "unknownerror"):
        pts += 3
        why.append(tr("Its digital signature is not valid"))
    if not missing and not signer and not company and s != "valid":
        pts += 1
        why.append(tr("Unknown publisher"))
    if s == "valid" and not lol:
        pts = max(0, pts - 2)
    return ("high" if pts >= 4 else "medium" if pts >= 2 else "low"), why


def _sig_cache_file():
    return _dpath("signatures.json")


def _signatures(files):
    """Authenticode status and signer of each file, cached by path + size + date."""
    cache = _read_json(_sig_cache_file(), {}) or {}
    out, todo = {}, []
    for f in {f for f in files if f}:
        try:
            st = os.stat(f)
        except OSError:
            continue
        k = hashlib.sha1(f"{paths.norm_path(f)}|{st.st_size}|{int(st.st_mtime)}".encode()).hexdigest()
        if k in cache:
            out[f] = cache[k]
        else:
            todo.append((f, k))
    chunks = [todo[i:i + 120] for i in range(0, len(todo), 120)]

    def check(chunk):
        fd, tmp = tempfile.mkstemp(suffix=".txt")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write("\n".join(f for f, _ in chunk))
            rows = ps_json("Get-Content -LiteralPath '" + tmp.replace("'", "''") + "' -Encoding UTF8 | ForEach-Object { "
                           "$s = Get-AuthenticodeSignature -LiteralPath $_ -ErrorAction SilentlyContinue; "
                           "[pscustomobject]@{ p=[string]$_; s=[string]$s.Status; c=$(if ($s.SignerCertificate) { $s.SignerCertificate.GetNameInfo(0, $false) } else { '' }) } }",
                           timeout=180, as_list=True)
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass
        return {r.get("p"): r for r in rows if r.get("p")}

    if chunks:
        with ThreadPoolExecutor(max_workers=3) as ex:
            for res in ex.map(check, chunks):
                for f, k in todo:
                    r = res.get(f)
                    if r:
                        cache[k] = out[f] = {"st": r.get("s") or "", "signer": r.get("c") or ""}
        try:
            _write_json(_sig_cache_file(), cache)
        except OSError:
            pass
    return out


def _current_sid():
    """String SID of the user running StellarHub (own WinDLL instances: argtypes don't leak to other modules)."""
    try:
        adv, k32 = ctypes.WinDLL("advapi32"), ctypes.WinDLL("kernel32")
        k32.GetCurrentProcess.restype = wintypes.HANDLE
        adv.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
        adv.GetTokenInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
        adv.ConvertSidToStringSidW.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.LPWSTR)]
        k32.LocalFree.argtypes = [ctypes.c_void_p]
        k32.CloseHandle.argtypes = [wintypes.HANDLE]
        tok = wintypes.HANDLE()
        if not adv.OpenProcessToken(k32.GetCurrentProcess(), 0x0008, ctypes.byref(tok)):
            return None
        try:
            n = wintypes.DWORD()
            adv.GetTokenInformation(tok, 1, None, 0, ctypes.byref(n))
            buf = ctypes.create_string_buffer(n.value)
            if not adv.GetTokenInformation(tok, 1, buf, n, ctypes.byref(n)):
                return None
            psid = ctypes.cast(buf, ctypes.POINTER(ctypes.c_void_p))[0]
            s = wintypes.LPWSTR()
            if not adv.ConvertSidToStringSidW(psid, ctypes.byref(s)):
                return None
            v = s.value
            k32.LocalFree(ctypes.cast(s, ctypes.c_void_p))
            return v
        finally:
            k32.CloseHandle(tok)
    except Exception:
        return None


def _sid_label(sid, me):
    if sid == me:
        return tr("You")
    if sid == "S-1-5-18":
        return tr("System account")
    if sid in ("S-1-5-19", "S-1-5-20"):
        return tr("Windows services")
    if sid == ".DEFAULT":
        return tr("New user profiles")
    p = registry.get_value(HKLM, rf"SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\{sid}", "ProfileImagePath", V64)
    return os.path.basename(str(p)) if p else sid


def _split_cmd(cmd):
    s = os.path.expandvars(str(cmd or "").strip())
    exe = image_path(s)
    if s.startswith('"'):
        rest = s[len(exe) + 2:]
    elif s.lower().startswith(exe.lower()):
        rest = s[len(exe):]
    else:
        rest = ""
    return exe, rest.strip()


def _resolve_exe(exe):
    """Bare names (powershell.exe) to their full path so they can be checked."""
    if not exe or os.path.isabs(exe):
        return exe
    win = os.environ.get("SystemRoot", r"C:\Windows")
    for d in (os.path.join(win, "System32"), win, os.path.join(win, "System32", "WindowsPowerShell", "v1.0")):
        p = os.path.join(d, exe if exe.lower().endswith(".exe") else exe + ".exe")
        if os.path.isfile(p):
            return p
    return exe


def _display(name):
    """Service display names like '@oem24.inf,%Name%;Intel(R) Service' resolved to their text."""
    name = str(name or "")
    if not name.startswith("@"):
        return name
    from .removal.programs import _indirect_string
    return _indirect_string(name) or name.rsplit(";", 1)[-1]


def _ms(sig):
    return bool(sig) and sig.get("st") == "Valid" and "microsoft" in (sig.get("signer") or "").lower()


def _run_entries(me):
    out = []
    keys = [(r"Software\Microsoft\Windows\CurrentVersion\Run", "run"), (r"Software\Microsoft\Windows\CurrentVersion\RunOnce", "runonce"),
            (r"Software\Microsoft\Windows\CurrentVersion\Policies\Explorer\Run", "policy")]
    for path, kind in keys:
        for view in (V64, V32):
            for name, data, _ in registry.values(HKLM, path, view):
                out.append({"hive": "HKLM", "sid": None, "path": path, "view": view, "kind": kind, "name": name, "cmd": str(data),
                            "user": tr("All users")})
    for sid in registry.subkeys(HKU, ""):
        if sid.endswith("_Classes"):
            continue
        for path, kind in keys:
            for name, data, _ in registry.values(HKU, f"{sid}\\{path}"):
                out.append({"hive": "HKU", "sid": sid, "path": path, "view": 0, "kind": kind, "name": name, "cmd": str(data),
                            "user": _sid_label(sid, me)})
    return out


_WL = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
_IFEO = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options"
_SPE = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\SilentProcessExit"


def _hooks():
    """Winlogon, AppInit and debugger hijacks: only what differs from Windows' defaults."""
    out = []
    shell = str(_reg(HKLM, _WL, "Shell", V64) or "explorer.exe").strip()
    if shell.lower() not in ("explorer.exe", r"c:\windows\explorer.exe"):
        out.append({"name": "Winlogon Shell", "cmd": shell, "where": "HKLM\\" + _WL, "why0": tr("Windows starts this instead of the normal desktop"), "pts": 4})
    ui = str(_reg(HKLM, _WL, "Userinit", V64) or "").strip().rstrip(",").lower()
    if ui and ui not in (r"c:\windows\system32\userinit.exe", "userinit.exe", r"%systemroot%\system32\userinit.exe"):
        out.append({"name": "Winlogon Userinit", "cmd": ui, "where": "HKLM\\" + _WL, "why0": tr("Runs extra programs every time someone signs in"), "pts": 4})
    cu = _reg(HKCU, _WL.replace("SOFTWARE", "Software"), "Shell")
    if cu:
        out.append({"name": "Winlogon Shell", "cmd": str(cu), "where": "HKCU\\" + _WL, "why0": tr("Windows starts this instead of the normal desktop"), "pts": 4})
    for view in (V64, V32):
        k = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Windows"
        dlls = str(_reg(HKLM, k, "AppInit_DLLs", view) or "").strip()
        if dlls and _reg(HKLM, k, "LoadAppInit_DLLs", view) == 1:
            out.append({"name": "AppInit_DLLs", "cmd": dlls, "where": "HKLM\\" + k, "why0": tr("Loads into every program that starts"), "pts": 3})
        for sub in registry.subkeys(HKLM, _IFEO, view):
            dbg = registry.get_value(HKLM, f"{_IFEO}\\{sub}", "Debugger", view)
            if dbg:
                out.append({"name": tr("Debugger for {exe}", exe=sub), "cmd": str(dbg), "where": f"HKLM\\{_IFEO}\\{sub}",
                            "why0": tr("Runs instead of {exe} whenever it is opened", exe=sub), "pts": 3})
        for sub in registry.subkeys(HKLM, _SPE, view):
            mon = registry.get_value(HKLM, f"{_SPE}\\{sub}", "MonitorProcess", view)
            if mon:
                out.append({"name": tr("Exit monitor for {exe}", exe=sub), "cmd": str(mon), "where": f"HKLM\\{_SPE}\\{sub}",
                            "why0": tr("Runs every time {exe} closes", exe=sub), "pts": 3})
    seen, uniq = set(), []
    for h in out:
        k = (h["name"], h["cmd"].lower())
        if k not in seen:
            seen.add(k)
            uniq.append(h)
    return uniq


# ---- browser extensions
_CHROMIUM = [("Google Chrome", "LOCALAPPDATA", r"Google\Chrome\User Data"), ("Microsoft Edge", "LOCALAPPDATA", r"Microsoft\Edge\User Data"),
             ("Brave", "LOCALAPPDATA", r"BraveSoftware\Brave-Browser\User Data"), ("Vivaldi", "LOCALAPPDATA", r"Vivaldi\User Data"),
             ("Opera", "APPDATA", r"Opera Software\Opera Stable"), ("Opera GX", "APPDATA", r"Opera Software\Opera GX Stable")]
_BROAD = re.compile(r"^(<all_urls>|(\*|https?|wss?)://\*/.*|file:///\*)$")
_SENSITIVE = ("cookies", "history", "webRequest", "webRequestBlocking", "debugger", "proxy", "nativeMessaging", "management",
              "clipboardRead", "privacy", "webNavigation", "downloads", "tabCapture", "desktopCapture")


def ext_risk(perms, from_store, enabled=True, overrides=False):
    """Risk hint of a browser extension from its permissions and origin. Pure."""
    why, pts = [], 0
    if overrides:
        pts += 2
        why.append(tr("Changes your search engine, home page or new tab"))
    perms = [str(p) for p in perms or []]
    if any(_BROAD.match(p) for p in perms):
        pts += 2
        why.append(tr("Can read and change everything on every website"))
    sens = [p for p in perms if p in _SENSITIVE]
    if sens:
        pts += min(2, len(sens))
        why.append(tr("Sensitive permissions: {list}", list=", ".join(sens[:4])))
    if not from_store:
        pts += 2
        why.append(tr("Not installed from the browser's store"))
    if not enabled:
        pts = max(0, pts - 2)
    return ("high" if pts >= 5 else "medium" if pts >= 2 else "low"), why


def _msg(ver_dir, manifest, s):
    if not isinstance(s, str) or not s.startswith("__MSG_"):
        return s
    key = s[6:-2].lower()
    for loc in (manifest.get("default_locale"), "en", "en_US"):
        if not loc:
            continue
        m = _read_json(os.path.join(ver_dir, "_locales", loc, "messages.json"), {}) or {}
        for k, v in m.items():
            if k.lower() == key and isinstance(v, dict) and v.get("message"):
                return v["message"]
    return s


def _ext_icon(ver_dir, manifest):
    ic = manifest.get("icons") or {}
    if not isinstance(ic, dict) or not ic:
        return None
    try:
        best = sorted(ic.items(), key=lambda kv: abs(int(kv[0]) - 48))[0][1]
    except (ValueError, TypeError):
        best = list(ic.values())[0]
    p = os.path.join(ver_dir, str(best).lstrip("/"))
    try:
        if not p.lower().endswith(".png") or os.path.getsize(p) > 96 * 1024:
            return None
        with open(p, "rb") as fh:
            return "data:image/png;base64," + base64.b64encode(fh.read()).decode()
    except OSError:
        return None


def _chromium_exts():
    out = []
    for browser, env, rel in _CHROMIUM:
        root = os.path.join(os.environ.get(env, ""), rel)
        if not os.path.isdir(root):
            continue
        if os.path.isdir(os.path.join(root, "Extensions")):  # Opera keeps a single profile in the root
            profiles = [(root, "")]
        else:
            ls = ((_read_json(os.path.join(root, "Local State"), {}) or {}).get("profile") or {}).get("info_cache") or {}
            profiles = []
            for d in sorted(os.listdir(root)):
                full = os.path.join(root, d)
                if os.path.isdir(os.path.join(full, "Extensions")) and os.path.isfile(os.path.join(full, "Preferences")):
                    profiles.append((full, (ls.get(d) or {}).get("name") or d))
        for prof, pname in profiles:
            settings = {}
            for fn in ("Preferences", "Secure Preferences"):
                s = ((_read_json(os.path.join(prof, fn), {}) or {}).get("extensions") or {}).get("settings") or {}
                for k, v in s.items():
                    if isinstance(v, dict):
                        settings.setdefault(k, {}).update(v)
            ext_dir = os.path.join(prof, "Extensions")
            try:
                ids = os.listdir(ext_dir)
            except OSError:
                continue
            for eid in ids:
                if eid == "Temp":
                    continue
                st = settings.get(eid, {})
                if st.get("location") in (5, 10) or st.get("was_installed_by_default") or st.get("was_installed_by_oem"):
                    continue
                try:
                    vers = sorted(os.listdir(os.path.join(ext_dir, eid)))
                except OSError:
                    continue
                vd = next((os.path.join(ext_dir, eid, v) for v in reversed(vers) if os.path.isfile(os.path.join(ext_dir, eid, v, "manifest.json"))), None)
                if not vd:
                    continue
                man = _read_json(os.path.join(vd, "manifest.json"), {}) or {}
                if man.get("theme") or not man:
                    continue
                name = _msg(vd, man, man.get("name") or eid)
                perms = [p for p in (man.get("permissions") or []) if isinstance(p, str)] + \
                        [p for p in (man.get("host_permissions") or []) if isinstance(p, str)]
                for cs in man.get("content_scripts") or []:
                    perms += [m for m in (cs.get("matches") or []) if isinstance(m, str)]
                perms = list(dict.fromkeys(perms))
                dr = st.get("disable_reasons")
                enabled = not dr and st.get("state", 1) != 0
                upd = (man.get("update_url") or "").lower()
                store = bool(st.get("from_webstore")) or any(d in upd for d in ("google.com", "microsoft.com", "opera.com", "brave.com"))
                if st.get("location") == 4:
                    store = False
                ov = bool(man.get("chrome_settings_overrides") or (man.get("chrome_url_overrides") or {}).get("newtab"))
                out.append({"browser": browser, "profile": pname, "id": eid, "name": name, "version": man.get("version", ""),
                            "perms": perms, "store": store, "on": enabled, "path": vd, "icon": _ext_icon(vd, man), "overrides": ov})
    return out


def _firefox_exts():
    out = []
    root = os.path.join(os.environ.get("APPDATA", ""), r"Mozilla\Firefox\Profiles")
    try:
        profs = os.listdir(root)
    except OSError:
        return out
    for p in profs:
        data = _read_json(os.path.join(root, p, "extensions.json"), {}) or {}
        for a in data.get("addons") or []:
            if a.get("type") != "extension" or (a.get("location") or "").startswith("app-") or a.get("isSystem"):
                continue
            up = a.get("userPermissions") or {}
            perms = list(up.get("permissions") or []) + list(up.get("origins") or [])
            src = (a.get("sourceURI") or "").lower()
            out.append({"browser": "Firefox", "profile": p.split(".", 1)[-1], "id": a.get("id"),
                        "name": (a.get("defaultLocale") or {}).get("name") or a.get("id"), "version": a.get("version", ""),
                        "perms": perms, "store": "addons.mozilla.org" in src or (a.get("signedState") or 0) >= 2,
                        "on": bool(a.get("active")), "path": a.get("path") or os.path.join(root, p), "icon": None, "overrides": False})
    return out


def persistence(job):
    """Things that run by themselves outside the normal startup list. Read-only; each item gets a risk hint."""
    me = _current_sid()
    win = paths.kf("Windows") or os.environ.get("SystemRoot", r"C:\Windows")
    items = []
    job.progress(.05, tr("Reading scheduled tasks…"))
    try:
        tasks = rsys.list_tasks(include_microsoft=True)
    except Exception:
        tasks = []
    task_rows = []
    for t in tasks:
        if not t.get("commands"):
            continue
        exe, args = t["commands"][0]
        exe = _resolve_exe(os.path.expandvars((exe or "").strip('"')))
        in_ms = t["path"].lower().startswith("\\microsoft\\")
        if in_ms and (not exe or paths.is_within(exe, win)):
            continue
        task_rows.append((t, exe, args or "", in_ms))
    job.progress(.2, tr("Reading services…"))
    svc_rows = []
    try:
        services = rsys.list_services()
    except Exception:
        services = []
    for s in services:
        if s.get("start") != 2 or not isinstance(s.get("type"), int) or not s["type"] & 0x30:
            continue
        exe = s.get("exe") or ""
        if exe.lower().endswith("svchost.exe"):
            dll = registry.get_value(HKLM, rf"SYSTEM\CurrentControlSet\Services\{s['name']}\Parameters", "ServiceDll")
            if not dll:
                continue
            exe = os.path.expandvars(str(dll))
        if paths.is_within(exe, win) and "microsoft" in (startup.file_company(exe) or "").lower():
            continue
        svc_rows.append((s, exe))
    job.progress(.32, tr("Reading the registry…"))
    run_rows = []
    for r in _run_entries(me):
        exe, args = _split_cmd(r["cmd"])
        run_rows.append((r, _resolve_exe(exe), args))
    hooks = _hooks()
    job.progress(.42, tr("Checking digital signatures…"))
    files = [e for _, e, _, _ in task_rows] + [e for _, e in svc_rows] + [e for _, e, _ in run_rows] + \
            [_resolve_exe(_split_cmd(h["cmd"])[0]) for h in hooks]
    sigs = _signatures([f for f in files if f and os.path.isabs(f)])

    def entry(kind, rid, name, exe, args, where, extra=None, base_pts=0, base_why=None):
        sig = sigs.get(exe)
        miss = bool(exe) and os.path.isabs(exe) and not os.path.exists(exe)
        comp = startup.file_company(exe) if exe and os.path.isfile(exe) else ""
        risk, why = assess(exe, args, (sig or {}).get("st"), (sig or {}).get("signer"), comp, miss)
        if base_pts:
            why = (base_why or []) + why
            risk = "high" if base_pts >= 4 or risk != "low" else "medium"
        st = (sig or {}).get("st")
        e = {"id": rid, "kind": kind, "name": name, "exe": exe, "cmd": (f'"{exe}" {args}'.strip() if exe else args), "where": where,
             "pub": (sig or {}).get("signer") or comp, "sig": None if miss or not st else {"Valid": "valid", "NotSigned": "unsigned"}.get(st, "invalid"),
             "missing": miss, "risk": risk, "why": why, "on": True, "can": None}
        e.update(extra or {})
        return e

    job.progress(.7, tr("Assessing each item…"))
    for t, exe, args, in_ms in task_rows:
        trig = tr("At sign-in") if t.get("logon") else tr("At startup") if t.get("boot") else tr("On a schedule or event")
        e = entry("task", "task|" + t["path"], t["name"], exe, args, t["path"], {"trigger": trig, "on": t.get("enabled", True), "can": "task"})
        if in_ms and not _ms(sigs.get(exe)):
            e["why"].insert(0, tr("Hides among Windows' own tasks"))
            e["risk"] = "high" if e["risk"] != "low" else "medium"
        items.append(e)
    for s, exe in svc_rows:
        items.append(entry("service", "service|" + s["name"], _display(s.get("display")) or s["name"], exe, "", s["name"], {"trigger": tr("At startup")}))
    for r, exe, args in run_rows:
        normal = r["kind"] == "run" and (r["hive"] == "HKLM" or r["sid"] == me)
        hive = "HKLM" if r["hive"] == "HKLM" else ("HKCU" if r["sid"] == me else f"HKU\\{r['sid']}")
        where = f"{hive}\\{r['path']}"
        if r["view"] == V32 and r["hive"] == "HKLM":
            where = where.replace("HKLM\\Software\\", "HKLM\\Software\\WOW6432Node\\")
        extra = {"user": r["user"], "trigger": tr("Once, at the next sign-in") if r["kind"] == "runonce" else tr("At sign-in"),
                 "normal": normal}
        if normal:
            hk = "HKLM" if r["hive"] == "HKLM" else "HKCU"
            view = V32 if r["view"] == V32 else (V64 if hk == "HKLM" else 0)
            extra.update(can="run", sid=f"run|{hk}|{view}|{r['name']}")
            try:
                extra["on"] = startup._approved(hk, "Run32" if r["view"] == V32 else "Run", r["name"])
            except Exception:
                pass
        e = entry("run", "run|" + where + "|" + r["name"], r["name"], exe, args, where, extra)
        if r["kind"] == "policy":
            e["why"].insert(0, tr("Set through a policy, which hides it from the usual places"))
            e["risk"] = "medium" if e["risk"] == "low" else e["risk"]
        if normal and e["risk"] == "low":
            continue  # already in Task Manager > Startup apps and nothing odd about it
        items.append(e)
    for h in hooks:
        exe, args = _split_cmd(h["cmd"])
        items.append(entry("hook", "hook|" + h["where"] + "|" + h["name"], h["name"], _resolve_exe(exe), args, h["where"],
                           {"trigger": h["why0"]}, base_pts=h["pts"], base_why=[h["why0"]]))
    job.progress(.85, tr("Reading browser extensions…"))
    try:
        exts = _chromium_exts() + _firefox_exts()
    except Exception:
        exts = []
    for x in exts:
        risk, why = ext_risk(x["perms"], x["store"], x["on"], x.get("overrides"))
        items.append({"id": f"ext|{x['browser']}|{x['profile']}|{x['id']}", "kind": "ext", "name": x["name"], "exe": "", "cmd": x["id"],
                      "where": x["browser"] + (f" · {x['profile']}" if x["profile"] else ""), "browser": x["browser"],
                      "pub": "", "sig": None, "missing": False, "risk": risk, "why": why, "on": x["on"], "can": None,
                      "perms": x["perms"][:24], "store": x["store"], "path": x["path"], "icon": x["icon"], "version": x["version"]})
    rank = {"high": 0, "medium": 1, "low": 2}
    items.sort(key=lambda e: (rank[e["risk"]], e["kind"], (e["name"] or "").lower()))
    res = {"items": items, "admin": _admin(), "hooksOk": not hooks,
           "counts": {k: sum(1 for e in items if e["kind"] == k) for k in ("task", "service", "run", "hook", "ext")}}
    res["findings"], res["passed"] = persist_findings(items, not hooks)
    job.progress(1, tr("Done"))
    _cache_put("persistence", res)
    return res


def persist_findings(items, hooks_ok=True):
    F, ok = [], []
    hi = [e for e in items if e["risk"] == "high" and e.get("on", True)]
    med = [e for e in items if e["risk"] == "medium" and e.get("on", True)]
    if hi:
        F.append(finding("persist-high", "persistence", "bad", min(20, 8 * len(hi)),
                         tr("{n} things start by themselves and look suspicious", n=len(hi)) if len(hi) != 1 else
                         tr("1 thing starts by itself and looks suspicious"),
                         name_list([e["name"] for e in hi]) + ". " + tr("Check what they are; you can disable them and undo it later.")))
    if med:
        F.append(finding("persist-med", "persistence", "info", min(6, len(med)),
                         tr("{n} auto-starts worth a look", n=len(med)) if len(med) != 1 else tr("1 auto-start worth a look"),
                         name_list([e["name"] for e in med]) + ". " +
                         tr("Usually harmless, but they're unsigned, run scripts or have broad access.")))
    if not hi:
        ok.append(tr("Nothing suspicious starts by itself"))
    if hooks_ok:
        ok.append(tr("Sign-in and program launch hooks at Windows defaults"))
    return F, ok


def _set_autostart(eid, enabled):
    kind, rest = eid.split("|", 1)
    if kind == "task":
        code, out = rsys.set_task_enabled(rest, enabled)
        if code != 0:
            raise OSError(out.strip()[:200] or tr("Windows didn't accept the change"))
    elif kind == "run":
        startup.set_enabled(eid, enabled)
    else:
        raise ValueError(kind)


def persist_set(eid, enabled, name=""):
    """Disables (or enables again) a scheduled task or a Run entry, saving how it was so it can be undone."""
    kind = str(eid).split("|", 1)[0]
    if kind not in ("task", "run"):
        raise ValueError(eid)
    if kind == "run" and eid.startswith("run|HKLM") and not _admin():
        return _need_admin()
    enabled = bool(enabled)
    label = _L("{name}: enabled" if enabled else "{name}: disabled", name=name or eid)
    bid = _save_change({"kind": "autostart", **_label_fields(label), "prev": [{"id": eid, "enabled": not enabled}], "area": "persistence"})
    try:
        _set_autostart(eid, enabled)
    except OSError:
        try:
            os.remove(os.path.join(_changes_dir(), bid + ".json"))  # nothing changed: no record
        except OSError:
            pass
        if not _admin():
            return _need_admin()
        raise
    return {"ok": True, "backup": bid, "label": _lt(label)}


def open_location(path):
    """Shows a file (selected) or a folder in File Explorer."""
    return _open_location(path)


def open_uri(uri):
    if isinstance(uri, str) and uri.startswith(("ms-settings:", "windowsdefender:", "https://")):
        os.startfile(uri)
        return True
    return False
