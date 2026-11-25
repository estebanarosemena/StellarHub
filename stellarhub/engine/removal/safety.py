"""Hard safety rules. Nothing is deleted without going through here.

Principle: when in doubt, block. A leftover that stays behind is an annoyance;
a system file that gets deleted is a broken PC.
"""
import os
import re
import winreg

from ...i18n import tr
from . import paths, registry
from .paths import kf, norm_path, within_norm

# ================================================================ paths

def _j(base, *parts):
    return os.path.join(base, *parts) if base else None


def _norm_set(items):
    """Each path normalized, plus where it really is: a protected folder that is a junction, or that has a short
    name, is protected under every name Windows gives it (see paths.forms)."""
    out = set()
    for p in items:
        if p:
            out.update(paths.forms_cached(p))
    return out


def protected_exact():
    """Folders that cannot be deleted (neither them nor any folder containing them)."""
    k = paths.known_folders()
    pf, pf86 = k.get("ProgramFiles"), k.get("ProgramFilesX86")
    cf, cf86 = k.get("ProgramFilesCommon"), k.get("ProgramFilesCommonX86")
    local, roam, pd = k.get("LocalAppData"), k.get("RoamingAppData"), k.get("ProgramData")
    prof = k.get("Profile")
    out = [
        k.get("SystemDrive"), k.get("Windows"), pf, pf86, cf, cf86, pd, prof, local, roam, k.get("LocalAppDataLow"),
        k.get("Desktop"), k.get("Documents"), k.get("Downloads"), k.get("Music"), k.get("Pictures"),
        k.get("Videos"), k.get("SavedGames"), k.get("OneDrive"), k.get("Public"), k.get("PublicDesktop"),
        k.get("StartMenu"), k.get("CommonStartMenu"), k.get("Programs"), k.get("CommonPrograms"),
        k.get("Startup"), k.get("CommonStartup"), k.get("Temp"), k.get("UserProgramFiles"),
        _j(prof, "AppData"), _j(local, "Programs"), _j(local, "Temp"), _j(prof, ".."),
        _j(local, "Microsoft", "WinGet", "Packages"),
        # the profile's own folders where Windows first made them: OneDrive backup (or a move to another drive)
        # points Documents and the rest elsewhere, and the old folder often still holds files
        *(_j(prof, n) for n in ("Desktop", "Documents", "Downloads", "Music", "Pictures", "Videos", "Saved Games",
                                "Contacts", "Favorites", "Links", "Searches", "OneDrive")),
        # shared audio plugin folders
        _j(cf, "VST3"), _j(cf, "VST2"), _j(cf, "VST"), _j(cf, "CLAP"), _j(cf, "Avid"),
        _j(cf, "Avid", "Audio"), _j(cf, "Avid", "Audio", "Plug-Ins"), _j(pf, "VSTPlugins"),
        _j(pf, "Steinberg"), _j(pf, "Steinberg", "VSTPlugins"), _j(pf, "Common Files", "Steinberg"),
        _j(pf86, "VSTPlugins"), _j(pf86, "Steinberg", "VSTPlugins"), _j(cf86, "VST3"),
    ]
    # roots of every drive
    for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        out.append(f"{letter}:\\")
    # the same shared folders on the other drives: an installer that records "D:\Program Files" or "E:\Games" as
    # its install location must never get that whole folder offered as its leftovers
    for root in _drives():
        out += [os.path.join(root, n) for n in _SHARED_ON_EVERY_DRIVE]
    return _norm_set(out)


_SHARED_ON_EVERY_DRIVE = ("Program Files", "Program Files (x86)", os.path.join("Program Files", "Common Files"),
                          "Games", "SteamLibrary", "XboxGames", "Epic Games", "Riot Games", "GOG Games",
                          "Program Files (Arm)", "Programs", "Apps", "Software", "Tools")
_SYSTEM_ON_EVERY_DRIVE = ("$Recycle.Bin", "System Volume Information", "WindowsApps", "$WinREAgent", "Recovery",
                          os.path.join("Program Files", "WindowsApps"), os.path.join("Program Files", "ModifiableWindowsApps"))


def _drives():
    """The drive letters that exist right now (GetLogicalDrives: no disk is touched)."""
    try:
        import ctypes
        mask = ctypes.windll.kernel32.GetLogicalDrives()
    except Exception:
        return []
    return [f"{chr(65 + i)}:\\" for i in range(26) if mask >> i & 1]


def forbidden_trees():
    """Trees where NOTHING is touched (except for the exceptions)."""
    k = paths.known_folders()
    win, pf, pf86 = k.get("Windows"), k.get("ProgramFiles"), k.get("ProgramFilesX86")
    cf, cf86, pd = k.get("ProgramFilesCommon"), k.get("ProgramFilesCommonX86"), k.get("ProgramData")
    local, roam, prof = k.get("LocalAppData"), k.get("RoamingAppData"), k.get("Profile")
    sysd = k.get("SystemDrive", "C:\\")
    out = [
        win, _j(pf, "WindowsApps"), _j(pf, "Windows Defender"), _j(pf, "Windows Defender Advanced Threat Protection"),
        _j(pf, "Windows NT"), _j(pf, "Windows Mail"), _j(pf, "Windows Media Player"), _j(pf, "Windows Photo Viewer"),
        _j(pf, "Windows Sidebar"), _j(pf, "Windows Security"), _j(pf, "Internet Explorer"), _j(pf, "ModifiableWindowsApps"),
        _j(pf86, "Windows Defender"), _j(pf86, "Windows NT"), _j(pf86, "Windows Mail"), _j(pf86, "Windows Media Player"),
        _j(pf86, "Windows Photo Viewer"), _j(pf86, "Windows Sidebar"), _j(pf86, "Internet Explorer"),
        _j(pf, "dotnet"), _j(pf86, "dotnet"), _j(pf, "Windows Kits"), _j(pf86, "Windows Kits"),
        _j(cf, "microsoft shared"), _j(cf, "System"), _j(cf, "Services"),
        _j(cf86, "microsoft shared"), _j(cf86, "System"), _j(cf86, "Services"),
        _j(pd, "Microsoft"), _j(pd, "Package Cache"), _j(pd, "Packages"),
        _j(local, "Microsoft"), _j(roam, "Microsoft"), _j(local, "Packages"), _j(local, "Windows"),
        _j(prof, "..", "Default"), _j(prof, "..", "All Users"), _j(prof, "..", "Default User"),
        _j(sysd, "System Volume Information"), _j(sysd, "$Recycle.Bin"), _j(sysd, "Recovery"), _j(sysd, "Boot"),
        _j(sysd, "PerfLogs"), _j(sysd, "$WinREAgent"), _j(sysd, "Config.Msi"),
    ]
    for root in _drives():  # the recycle bin, restore data and Store apps of every drive, not only C:
        out += [os.path.join(root, n) for n in _SYSTEM_ON_EVERY_DRIVE]
    return _norm_set(out)


_PERSONAL = ("Desktop", "Documents", "Downloads", "Music", "Pictures", "Videos", "SavedGames", "OneDrive", "Public",
             "PublicDesktop", "StartMenu", "CommonStartMenu", "Programs", "CommonPrograms", "Startup", "CommonStartup")


def temp_root_problem(root, system_temp=False):
    """Why `root` must NOT be emptied as a temp folder, or None if it is acceptable (message already translated).

    Refuses: nothing/relative/missing/link, a drive root, the user profile or a parent of it, any shell folder
    (Documents, Desktop, Downloads, OneDrive...) or anything inside one, and any folder that is or contains a
    protected_exact()/forbidden_trees() path. system_temp=True (the Windows temp folder) may live inside the Windows tree.
    """
    if not root or not isinstance(root, str):
        return tr("Skipped for safety: the temporary folder could not be found")
    n = norm_path(root)
    if not os.path.isabs(root) or len(n) < 3 or n[1:2] != ":":
        return tr("Skipped for safety: the temporary folder could not be found")
    if len(n) <= 3:
        return tr("Skipped for safety: the temporary folder is a whole drive ({path})", path=root)
    if not os.path.isdir(root) or paths.is_reparse_point(root):
        return tr("Skipped for safety: the temporary folder ({path}) does not exist or is a link", path=root)
    k = paths.known_folders()
    rforms = paths.forms(root)      # as written and where it really is (a junction, a short name...)
    for name in _PERSONAL:
        for f in paths.forms_cached(k.get(name) or ""):
            if any(within_norm(r, f) for r in rforms):
                return tr("Skipped for safety: the temporary folder ({path}) is a personal folder or inside one", path=root)
    prot = list(protected_exact())
    if os.path.basename(n) in ("temp", "tmp"):   # the normal temp folders are protected against deletion; emptying them is the point
        prot = [p for p in prot if p not in rforms]
    for p in prot:
        if any(within_norm(p, r) for r in rforms):
            return tr("Skipped for safety: the temporary folder ({path}) is, or contains, a protected folder", path=root)
    for p in forbidden_trees():
        if any(within_norm(p, r) or (not system_temp and within_norm(r, p)) for r in rforms):
            return tr("Skipped for safety: the temporary folder ({path}) is, or contains, a protected folder", path=root)
    return None


def forbidden_exceptions():
    """Subtrees allowed INSIDE a forbidden tree."""
    k = paths.known_folders()
    local = k.get("LocalAppData")
    out = [k.get("Programs"), k.get("CommonPrograms"), k.get("Startup"), k.get("CommonStartup"),
           _j(local, "Microsoft", "WinGet", "Packages"),
           _j(k.get("RoamingAppData"), "Microsoft", "Internet Explorer", "Quick Launch")]
    return _norm_set(out)


def personal_roots():
    k = paths.known_folders()
    return _norm_set(k.get(n) for n in ("Documents", "Pictures", "Music", "Videos", "Downloads",
                                        "OneDrive", "SavedGames"))


def read_shared_dlls():
    out = {}
    for view in registry.hklm_views():
        for name, data, _ in registry.values(winreg.HKEY_LOCAL_MACHINE,
                                             r"SOFTWARE\Microsoft\Windows\CurrentVersion\SharedDLLs", view):
            try:
                out[norm_path(name)] = max(out.get(norm_path(name), 0), int(data))
            except (TypeError, ValueError):
                pass
    return out


class Context:
    """Everything needed to decide whether something can be deleted when cleaning up a program."""

    def __init__(self, target=None, programs=(), extra_protected=(), shared_dlls=None):
        self.protected = protected_exact() | paths.self_paths() | _norm_set(extra_protected)
        self.forbidden = forbidden_trees() | paths.self_paths()
        self.exceptions = forbidden_exceptions()
        self.personal = personal_roots()
        self.shared_dlls = read_shared_dlls() if shared_dlls is None else shared_dlls
        self.target = target
        tloc = norm_path(target.get("location")) if target else ""
        self.target_loc = tloc if tloc and tloc not in self.protected else ""
        self.others = []  # (path, name)
        for p in programs:
            if target is not None and p.get("id") == target.get("id"):
                continue
            loc = norm_path(p.get("location"))
            if loc and loc not in self.protected and os.path.isabs(loc):
                self.others.append((loc, p.get("name", "?")))

    # -------------------------------------------------------------- files
    def check_path(self, path):
        """Return (block_reason | None, is_personal). The path is checked under every name it has: as written and
        where it really is (a junction into Windows, an 8.3 alias, other case, a trailing dot): blocked if ANY of
        them is protected."""
        forms = paths.forms(path)
        if not forms:
            return tr("Drive root or invalid path"), False
        personal = False
        for n in forms:
            why, pers = self._check_norm(n, path)
            if why:
                return why, False
            personal = personal or pers
        return None, personal

    def _check_norm(self, n, path):
        if not n or not os.path.isabs(n) or len(n) <= 3:
            return tr("Drive root or invalid path"), False
        for p in self.protected:
            if within_norm(p, n):
                return (tr("Protected system folder") if p == n else
                        tr("Contains a protected system folder")), False
        for f in self.forbidden:
            if within_norm(n, f) and not any(within_norm(n, e) for e in self.exceptions):
                return tr("Protected Windows area"), False
            if within_norm(f, n):
                return tr("Contains a protected Windows area"), False
        for loc, name in self.others:
            # A) deleting this would take another installed program with it: always blocked
            if within_norm(loc, n):
                return tr("Contains “{name}”, which is still installed", name=name), False
            # B) it is inside another program
            if within_norm(n, loc):
                # Inside another program: only allowed if it is the target program's nested folder (e.g. a game inside Steam)
                if not (self.target_loc and within_norm(self.target_loc, loc) and within_norm(n, self.target_loc)):
                    return tr("Belongs to “{name}”, which is still installed", name=name), False
        for dll, count in self.shared_dlls.items():
            if count > 1 and within_norm(dll, n):
                return tr("Contains files shared with other programs (SharedDLLs)"), False
        personal = any(within_norm(n, r) for r in self.personal)
        desk = norm_path(kf("Desktop"))
        if desk and within_norm(n, desk) and os.path.isdir(path):
            personal = True
        return None, personal

    # -------------------------------------------------------------- registry
    def check_reg(self, ref):
        return reg_rule(ref)


# ================================================================ registry
_SW_BLOCK = {"microsoft", "classes", "policies", "wow6432node", "clients", "registeredapplications",
             "odbc", "intel", "nvidia corporation", "realtek", "amd", "ati technologies", "khronos",
             "wow6432node", "partner", "regex"}
_CLASSES_BLOCK = {"*", "directory", "folder", "drive", "allfilesystemobjects", "clsid", "interface", "typelib",
                  "appid", "installer", "wow6432node", "applications", "systemfileassociations", "mime",
                  "local settings", "protocols", "exefile", "lnkfile", "batfile", "cmdfile", "comfile",
                  "dllfile", "msi.package", "unknown", "http", "https", "ftp", "mailto", "file", "network",
                  "drivefile", "zapfile", "inffile", "regfile", "txtfile", "htmlfile", "jsfile", "vbsfile",
                  "microsoft.powershellscript.1", "progid"}
_GUID = r"\{[0-9a-f-]{36}\}"
_CV = r"software\\(?:wow6432node\\)?microsoft\\windows\\currentversion"


def _canon(ref):
    """Canonical lowercase path: 'hkcu\\software\\x' (HKU\\SID is treated as HKCU)."""
    hive, path = ref.hive.upper(), ref.path.lower().strip("\\")
    if hive == "HKU":
        parts = path.split("\\", 1)
        hive, path = "HKCU", (parts[1] if len(parts) > 1 else "")
    if hive == "HKCR":
        hive, path = "HKLM", "software\\classes\\" + path
    return hive.lower(), path


def reg_rule(ref):
    """Block reason, or None if the key/value can be removed."""
    hive, p = _canon(ref)
    parts = p.split("\\") if p else []
    is_val = ref.value is not None
    if len(parts) < 2 and not is_val:
        return tr("Registry root key")
    # values that can be removed one by one
    if is_val:
        if re.fullmatch(_CV + r"\\(run|runonce|runonceex)", p):
            return None
        if re.fullmatch(_CV + r"\\explorer\\startupapproved\\[^\\]+", p):
            return None
        if re.fullmatch(_CV + r"\\shareddlls", p):
            return None
        if re.fullmatch(r"software\\classes\\\.[^\\]+\\openwithprogids", p):
            return None
        if re.fullmatch(r"software\\classes\\applications\\[^\\]+", p):
            return None
        if re.fullmatch(r"software\\registeredapplications", p) or re.fullmatch(
                r"software\\wow6432node\\registeredapplications", p):
            return None
        if p.startswith("software\\") and len(parts) >= 3 and parts[1] not in _SW_BLOCK:
            return None
        return tr("Value in a protected registry area")
    # keys
    if re.fullmatch(_CV + r"\\uninstall\\[^\\]+", p) or re.fullmatch(_CV + r"\\app paths\\[^\\]+", p):
        return None
    if re.fullmatch(_CV + r"\\installer\\userdata\\[^\\]+\\products\\[0-9a-f]{32}", p):
        return None
    if hive == "hklm" and re.fullmatch(r"system\\(currentcontrolset|controlset00\d)\\services\\[^\\]+", p):
        return service_rule(parts[-1])
    if p.startswith("software\\classes\\") or p.startswith("software\\wow6432node\\classes\\"):
        rest = p.split("classes\\", 1)[1].split("\\")
        head = rest[0]
        if head in ("clsid", "appid", "typelib") and len(rest) == 2 and re.fullmatch(_GUID, rest[1]):
            return None
        if head == "installer" and len(rest) == 3 and rest[1] in ("products", "features", "upgradecodes") \
                and re.fullmatch(r"[0-9a-f]{32}", rest[2]):
            return None
        if head == "applications" and len(rest) == 2 and rest[1].endswith(".exe"):
            return None
        if len(rest) == 1 and head and not head.startswith(".") and head not in _CLASSES_BLOCK \
                and not head.startswith("windows.") and not head.startswith("microsoft."):
            return None
        return tr("Protected registry area (Classes)")
    if p.startswith("software\\"):
        sub = parts[1] if parts[1] != "wow6432node" else (parts[2] if len(parts) > 2 else "")
        depth = len(parts) - (1 if parts[1] == "wow6432node" else 0)
        if not sub or sub in _SW_BLOCK:
            return tr("Protected registry area")
        if sub == "appdatalow":
            return None if len(parts) >= 4 and parts[2] == "software" and parts[3] not in _SW_BLOCK else \
                tr("Protected registry area")
        if depth >= 2:
            return None
    return tr("Protected registry area")


# ================================================================ services
_CRITICAL_SVC = {"wuauserv", "bits", "cryptsvc", "eventlog", "rpcss", "lsm", "winmgmt", "windefend",
                 "mpssvc", "bfe", "dhcp", "dnscache", "netlogon", "schedule", "plugplay", "power",
                 "audiosrv", "audioendpointbuilder", "msiserver", "trustedinstaller", "wscsvc", "sense"}


def service_info(name):
    base = rf"SYSTEM\CurrentControlSet\Services\{name}"
    hk = winreg.HKEY_LOCAL_MACHINE
    return {
        "name": name,
        "start": registry.get_value(hk, base, "Start"),
        "type": registry.get_value(hk, base, "Type"),
        "image": registry.get_value(hk, base, "ImagePath") or "",
        "display": registry.get_value(hk, base, "DisplayName") or name,
    }


def service_rule(name, info=None):
    info = info or service_info(name)
    if name.lower() in _CRITICAL_SVC:
        return tr("Essential Windows service")
    typ, start = info.get("type"), info.get("start")
    if typ is None and start is None:
        return None  # no longer exists: the key is a leftover
    if isinstance(typ, int) and typ & 0x0F:
        return tr("System driver: only its official uninstaller can remove it")
    if isinstance(start, int) and start <= 1:
        return tr("Loads when Windows starts: deleting it could stop Windows from booting")
    img = _image_path(info.get("image", ""))
    win = kf("Windows")
    if img and win and paths.is_within_real(img, win):
        return tr("Service hosted in Windows")
    return None


def _image_path(cmd):
    cmd = os.path.expandvars((cmd or "").strip())
    if cmd.lower().startswith("\\systemroot\\"):
        cmd = os.path.join(kf("Windows") or r"C:\Windows", cmd[12:])
    if cmd.startswith('"'):
        return cmd[1:].split('"', 1)[0]
    m = re.match(r"(.+?\.(exe|sys|dll))\b", cmd, re.I)
    return m.group(1) if m else cmd.split(" ")[0]


image_path = _image_path


# ================================================================ programs
_PROTECTED_PROGRAMS = [
    ("security", "Antivirus / security",
     r"kaspersky|avast|\bavg\b|norton|mcafee|\beset\b|bitdefender|malwarebytes|sophos|trend ?micro|panda dome|"
     r"avira|webroot|f-secure|comodo|zonealarm|windows defender|microsoft defender|360 total security|gdata|g data"),
    ("runtime", "Shared component (other programs depend on it)",
     r"visual c\+\+|\.net (runtime|framework|desktop runtime)|desktop runtime|asp\.net|directx|webview2|"
     r"microsoft windows desktop runtime|vcredist|redistributable|java\(tm\)|java \d+|openjdk|python launcher|"
     r"microsoft gameinput|windows sdk|windows software development kit|universal crt|msvc|xna framework|"
     r"physx|vulkan runtime|openal|microsoft update health|windows pc health|application compatibility"),
    ("driver", "Driver or hardware software",
     r"driver|controlador|chipset|nvidia|realtek|intel\(r\)|intel .*(management|serial|graphics|wireless|"
     r"bluetooth|rapid)|amd (chipset|software|radeon)|radeon|thunderbolt|bluetooth|touchpad|synaptics|elan |"
     r"dolby|asio|framework service|armoury|aura (service|lighting)|rog live|asus .*service|logitech g hub|"
     r"razer synapse|icue|wintun|tap-windows|npcap|winpcap|usb|vbcable|vb-audio|virtual audio"),
    ("network", "Network / VPN (installs network drivers)", r"\bvpn\b|wireguard|openvpn|zerotier|tailscale|hamachi"),
    ("windows", "Windows component",
     r"^microsoft edge|^microsoft onedrive|^windows |^microsoft windows|^update for|^security update|"
     r"^microsoft 365|^microsoft office|^office 16|click-to-run|^copilot$|^microsoft teams"),
]


def classify_program(p):
    """Return a dict with the protected category, or None."""
    text = f"{p.get('name', '')} | {p.get('publisher', '')}".lower()
    for cat, label, rx in _PROTECTED_PROGRAMS:
        if re.search(rx, text):
            return {"category": cat, "label": label, "no_force": True,
                    "scan_level_max": "safe" if cat in ("security", "windows", "runtime") else "moderate"}
    if "microsoft" in (p.get("publisher") or "").lower():
        return {"category": "microsoft", "label": "Microsoft software", "no_force": False,
                "scan_level_max": "moderate"}
    return None
