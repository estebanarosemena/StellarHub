"""Leftover scanner with a confidence score (0-100).

Each candidate collects evidence; everything then goes through safety.Context, which can block it.
"""
import functools
import os
import re
import time

from ...i18n import tr
from . import index, paths, registry, safety
from . import programs as progmod
from .paths import is_within, kf, norm_name, norm_path
from .registry import V32, V64, RegRef

LEVELS = {"safe": 90, "moderate": 70, "advanced": 50}
LEVEL_ORDER = ["safe", "moderate", "advanced"]
PRESELECT = 85

COMMON = {
    "notepad", "photos", "update", "updater", "player", "studio", "launcher", "service", "services", "driver",
    "client", "helper", "tools", "tool", "manager", "browser", "editor", "plugin", "plugins", "audio", "video",
    "music", "games", "game", "media", "cloud", "sync", "agent", "apps", "data", "cache", "logs", "temp",
    "config", "settings", "common", "shared", "runtime", "framework", "engine", "desktop", "portal", "center",
    "control", "panel", "system", "windows", "microsoft", "google", "files", "program", "programs", "setup",
    "install", "installer", "uninstall", "support", "drivers", "help", "docs", "documents", "user", "users",
    "local", "global", "default", "public", "backup", "backups", "downloads", "download", "assets", "resources",
    "bin", "lib", "plugins", "presets", "preset", "sounds", "samples", "projects", "library", "packages",
    "package", "store", "office", "security", "network", "mail", "chat", "phone", "camera", "photo", "image",
    "images", "converter", "recorder", "viewer", "reader", "monitor", "assistant", "connect", "link", "hub",
    "home", "power", "light", "lighting", "remote", "mobile", "device", "devices", "printer", "scanner",
    "edge", "dawn", "medal", "brave", "copilot", "terminal", "python", "node", "java", "steam",
}
_VERSION = re.compile(
    r"(\s*[-–]\s*)?\s*(\bversion\b|\bversión\b|\bv)?\s*\d+(\.\d+)+[\w.\-]*|\s*\((x64|x86|64-bit|32-bit|64 bit|"
    r"32 bit|amd64|arm64|user|usuario|[a-z]{2}-[a-z]{2})[^)]*\)|\s+(x64|x86|64-bit|32-bit|amd64|arm64)\b|"
    r"\s+-\s+[a-z]{2}-[a-z]{2}$", re.I)
_PUB_SUFFIX = re.compile(r"[,.]?\s*\b(inc|incorporated|ltd|llc|gmbh|corp|corporation|co|company|limited|s\.?a|ag|"
                         r"bv|b\.v|pty|srl|s\.l|sl|oy|ab|as|kg|plc|software|technologies|technology|"
                         r"semiconductor|computer)\b\.?", re.I)
_BUNDLE_EXT = (".vst3", ".clap", ".aaxplugin", ".vst", ".bundle", ".component")


@functools.lru_cache(maxsize=65536)
def strip_version(name):
    prev = None
    s = name
    while s != prev:
        prev = s
        s = _VERSION.sub("", s).strip(" -–_,")
    return s


def publisher_tokens(pub):
    out = set()
    if not pub:
        return out
    clean = _PUB_SUFFIX.sub("", pub).strip(" ,.")
    for cand in (pub, clean, clean.split(" ")[0] if clean else ""):
        t = norm_name(cand)
        if len(t) >= 4 and t not in COMMON:
            out.add(t)
    return out


def name_tokens(p):
    """Name tokens of a program: {token: (points, reason)}. A fresh copy: the caller may change it."""
    return dict(_name_tokens(p.get("name", ""), p.get("publisher") or ""))


@functools.lru_cache(maxsize=4096)
def _name_tokens(name, publisher):
    p = {"name": name, "publisher": publisher}
    tokens = {}

    def add(tok, pts, why):
        if len(tok) >= 3 and (tok not in tokens or tokens[tok][0] < pts):
            tokens[tok] = (pts, why)

    name = p.get("name", "")
    stripped = strip_version(name)
    add(norm_name(name), 85, "full name")
    add(norm_name(stripped), 82, "name without version")
    add(norm_name(re.sub(r"\s+\d+$", "", stripped)), 72, "name without version number")
    # name without the vendor: "Xfer Records Serum 2" -> "Serum 2"
    pub_words = [w for w in re.split(r"[\s,]+", _PUB_SUFFIX.sub("", p.get("publisher") or "")) if w]
    for i in range(len(pub_words), 0, -1):
        prefix = " ".join(pub_words[:i])
        if prefix and stripped.lower().startswith(prefix.lower() + " "):
            prod = stripped[len(prefix):].strip()
            add(norm_name(prod), 76, "product name")
            add(norm_name(re.sub(r"\s+\d+$", "", prod)), 68, "product name without number")
            break
    return tokens


class Identity:
    """Everything that identifies a program: names, vendor, folders, executables."""

    def __init__(self, p, all_programs=()):
        self.p = p
        name = p.get("name", "")
        self.tokens = name_tokens(p)  # token -> (points, reason)

        def add(tok, pts, why):
            if len(tok) >= 3 and (tok not in self.tokens or self.tokens[tok][0] < pts):
                self.tokens[tok] = (pts, why)

        full = norm_name(name)
        self.vendor = publisher_tokens(p.get("publisher"))
        if p.get("source") == "store":
            add(norm_name(p.get("package_name", "")), 90, "Store package")
            fam = p.get("family", "")
            if fam:
                add(norm_name(fam), 95, "package family")
        # main executables
        self.locations = []        # normalized (for comparisons)
        self.location_paths = []   # as is (for display and deletion)
        loc = p.get("location")
        if loc and os.path.isabs(loc) and norm_path(loc) not in safety.protected_exact():
            self.locations.append(norm_path(loc))
            self.location_paths.append(os.path.normpath(loc))
        self.exes = set()
        if loc and os.path.isdir(loc):
            try:
                for f in os.listdir(loc):
                    if f.lower().endswith(".exe") and not re.match(r"(unins|uninst|setup|update|crash|helper|"
                                                                   r"vc_?redist|dotnet)", f, re.I):
                        t = norm_name(f[:-4])
                        if len(t) >= 4:
                            self.exes.add(f.lower())
                            add(t, 70, "executable name")
            except OSError:
                pass
        # tokens that also identify OTHER installed programs -> not usable
        # (FabFilter Pro-C 2 and Pro-C 3 share "pro-c": neither of them can claim it)
        self.shared = {}
        self.shared_note = {}  # token -> the other program that has the identical full name
        mine = set(self.tokens)
        self.foreign_locs = []
        for o in all_programs:
            if o.get("id") == p.get("id"):
                continue
            for t in name_tokens(o):
                if t in mine:
                    self.shared[t] = o.get("name", "")
            ol = norm_path(o.get("location"))
            # other programs' folders equal to or nested inside ours (Wallpaper Engine inside Steam)
            if ol and ol not in safety.protected_exact() and any(is_within(ol, l) for l in self.locations):
                self.foreign_locs.append(ol)
        # an InstallLocation that is really the VENDOR folder (Epic Games\ with games inside):
        # narrowed down to the subfolders matching the product (Epic Games\Launcher)
        self.vendor_location = ""
        if self.locations and self.is_vendor(os.path.basename(self.locations[0])):
            self.vendor_location = self.location_paths[0]
            narrowed = []
            for e in _safe_listdir(self.vendor_location):
                full = os.path.join(self.vendor_location, e)
                m = self.match(e, in_vendor=True)
                if os.path.isdir(full) and m and m[0] >= 70:
                    narrowed.append(full)
            self.location_paths = narrowed
            self.locations = [norm_path(x) for x in narrowed]
            self.exes = set()
        if any(fl in self.locations for fl in self.foreign_locs):
            # folder shared with another entry: its .exe files don't identify this program
            for exe in self.exes:
                t = norm_name(exe[:-4])
                if self.tokens.get(t, (0, ""))[1] == "executable name":
                    del self.tokens[t]
            self.exes = set()
        for t in list(self.tokens):
            if t in self.shared and t != full:
                del self.tokens[t]
            elif t in self.shared:  # the identical full name in two entries: very weak
                self.tokens[t] = (60, self.tokens[t][1])
                self.shared_note[t] = self.shared[t]

    def match(self, entry_name, in_vendor=False):
        """(points, reason) if the name matches, otherwise None."""
        stem = entry_name
        low = stem.lower()
        for ext in _BUNDLE_EXT + (".lnk", ".url", ".exe", ".dll", ".ini", ".log", ".json", ".xml", ".dat", ".cfg"):
            if low.endswith(ext):
                stem = stem[: -len(ext)]
                break
        n = norm_name(stem)
        if not n:
            return None
        # token reasons are English keys (compared above); they are translated here, when shown
        tok, other = n, False
        hit = self.tokens.get(n)
        if not hit:
            tok = norm_name(strip_version(stem))
            hit2 = self.tokens.get(tok)
            if hit2:
                hit, other = (hit2[0] - 4, hit2[1]), True
        if not hit:
            return None
        pts, why = hit[0], tr(hit[1])
        if tok in self.shared_note:
            why = tr("{why}, shared with “{name}”", why=why, name=self.shared_note[tok])
        if other:
            why = tr("{why} (another version)", why=why)
        if (len(n) < 5 or n in COMMON) and not in_vendor:
            pts -= 30
            why = tr("{why}, short or generic name", why=why)
        if in_vendor:
            pts = min(pts + 10, 95)
        return pts, why

    def is_vendor(self, entry_name):
        n = norm_name(entry_name)
        return bool(n) and (n in self.vendor or any(len(v) >= 5 and n == v for v in self.vendor))

    def refs_location(self, text):
        """True if the text points to OUR folder (and not to that of another nested or identical program)."""
        if not text or not self.locations:
            return False
        t = os.path.expandvars(str(text)).lower().replace("/", "\\")
        texts = [t]
        if "~" in t:  # short names (C:\Users\JOHNSM~1\..., even mixed with long ones): also compare them expanded
            texts.append(_DRIVE_PATH.sub(lambda m: norm_path(m.group(0)), t))
        if any(_contains_path(x, f) for x in texts for fl in self.foreign_locs for f in _path_forms(fl)):
            return False
        return any(_contains_path(x, f) for x in texts for loc in self.locations for f in _path_forms(loc))


_DRIVE_PATH = re.compile(r'[a-z]:\\[^"*?<>|\r\n,;]*')


@functools.lru_cache(maxsize=4096)
def _path_forms(loc):
    """A normalized folder (long names) plus its 8.3 short form: a command line or registry value may use either
    (C:\\PROGRA~1\\Foo\\foo.exe)."""
    forms = [loc]
    if os.name == "nt":
        try:
            import ctypes
            buf = ctypes.create_unicode_buffer(1024)
            n = ctypes.windll.kernel32.GetShortPathNameW(loc, buf, 1024)
            if 0 < n <= 1024:
                s = os.path.normcase(buf.value).rstrip("\\")
                if s and s != loc:
                    forms.append(s)
        except (AttributeError, OSError):
            pass
    return tuple(forms)


def _is_game_library(d):
    """Folder with games inside (Steam, Epic, GOG...): never preselected."""
    for marker in ("steamapps", "SteamLibrary", ".egstore", "GOG Games"):
        if os.path.exists(os.path.join(d, marker)):
            return True
    try:
        return any(os.path.exists(os.path.join(d, e, ".egstore")) for e in os.listdir(d)[:200])
    except OSError:
        return False


def _safe_listdir(d):
    try:
        return os.listdir(d)
    except OSError:
        return []


def _contains_path(t, loc):
    i = t.find(loc)
    while i != -1:
        end = i + len(loc)
        if end == len(t) or t[end] in '\\"\',;|' or (t[end] == " " and not _longer_name_exists(t, i, end)):
            return True
        i = t.find(loc, i + 1)
    return False


def _longer_name_exists(t, i, end):
    r"""A space after the folder may end it (an unquoted argument: "C:\Foo --tray") or be part of a longer name: a
    sibling folder such as "...\Microsoft VS Code Insiders\bin" read for "...\Microsoft VS Code". True when that longer
    name exists: it is another folder, and its shortcuts, PATH entries or services are not this program's."""
    m = re.match(r'[^\\"\',;|]*', t[end:])
    longer = t[i:end + m.end()].rstrip()
    return len(longer) > end - i and os.path.exists(longer)


class Scanner:
    def __init__(self, program, all_programs, level="moderate", still_installed=None, progress=None):
        self.p = program
        self.all = list(all_programs)
        cap = (program.get("protected") or {}).get("scan_level_max")
        if cap and LEVEL_ORDER.index(level) > LEVEL_ORDER.index(cap):
            level = cap
        self.level = level
        self.id = Identity(program, self.all)
        self.ctx = safety.Context(target=program, programs=self.all)
        self.items = {}
        self.progress = progress or (lambda *a: None)
        self.still_installed = still_installed if still_installed is not None else self._still_installed()
        self.vendor_dirs = set()

    # ---------------------------------------------------------- helpers
    def _still_installed(self):
        if self.p.get("source") == "store":
            return False
        key = self.p.get("key")
        return bool(key) and registry.key_exists(RegRef.from_str(key))

    def add(self, kind, target, score, reason, display=None, group=None, extra=None):
        if score < LEVELS["advanced"]:
            return
        if kind in ("folder", "file"):
            target = os.path.normpath(target)
            display = display or target
        key = f"{kind}:{target.lower() if isinstance(target, str) else target}"
        it = self.items.get(key)
        if it:
            if score > it["score"]:
                it["score"] = score
            if reason not in it["reasons"]:
                it["reasons"].append(reason)
            return
        self.items[key] = {"kind": kind, "target": target, "score": score, "reasons": [reason],
                           "display": display or target, "group": group, **(extra or {})}

    # ---------------------------------------------------------- files
    def _listdir(self, d):
        try:
            return os.listdir(d)
        except OSError:
            return []

    @staticmethod
    def _entries(d):
        """(name, path, is_folder) without an extra call per entry: the type comes from the listing itself.

        Links and junctions are checked with isdir (it follows the link, as before), because a
        broken junction shows up as a folder in the listing but isdir says it is not one.
        """
        out = []
        try:
            with os.scandir(d) as it:
                for e in it:
                    try:
                        if e.is_symlink() or paths.entry_is_junction(e):
                            isd = os.path.isdir(e.path)
                        else:
                            isd = e.is_dir(follow_symlinks=False)
                    except OSError:
                        isd = False
                    out.append((e.name, e.path, isd))
        except OSError:
            pass
        return out

    def scan_dir(self, root, vendor_depth=True, label="", bonus=0):
        if not root or not os.path.isdir(root):
            return
        label = f" · {label}" if label else ""
        for e, full, is_dir in self._entries(root):
            m = self.id.match(e)
            if m and bonus and m[0] >= 70:
                m = (min(m[0] + bonus, 95), m[1])
            if m:
                self.add("folder" if is_dir else "file", full, m[0], tr("Name matches ({why})", why=m[1]) + label)
            elif is_dir and vendor_depth and self.id.is_vendor(e):
                self.vendor_dirs.add(full)
                for e2 in self._listdir(full):
                    m2 = self.id.match(e2, in_vendor=True)
                    if m2:
                        f2 = os.path.join(full, e2)
                        self.add("folder" if os.path.isdir(f2) else "file", f2, m2[0],
                                 tr("Inside the vendor's folder ({why})", why=m2[1]) + label)

    def scan_files(self):
        k = paths.known_folders()
        pf, pf86, cf, cf86 = k.get("ProgramFiles"), k.get("ProgramFilesX86"), k.get("ProgramFilesCommon"), \
            k.get("ProgramFilesCommonX86")
        local, roam = k.get("LocalAppData"), k.get("RoamingAppData")
        # install folder
        for loc in self.id.location_paths:
            if os.path.exists(loc):
                if self.id.vendor_location:
                    self.add("folder", loc, 90, tr("Product folder inside the vendor's install folder"),
                             extra={"is_location": True})
                elif self.p.get("location_inferred"):
                    self.add("folder", loc, 80, tr("Folder deduced from the icon or the uninstaller"),
                             extra={"is_location": True})
                else:
                    self.add("folder", loc, 100, tr("The program's install folder"), extra={"is_location": True})
        if self.id.vendor_location:
            self.vendor_dirs.add(self.id.vendor_location)
        # uninstaller files outside the folder (Inno: unins000.exe + .dat)
        u = progmod.exe_from_command(self.p.get("uninstall"))
        if u and os.path.isfile(u) and not any(is_within(u, l) for l in self.id.locations) and \
                self.p.get("kind") == "inno":
            for f in (u, u[:-4] + ".dat", u[:-4] + ".msg"):
                if os.path.isfile(f):
                    self.add("file", f, 95, tr("The program's uninstaller"))
        roots = [pf, pf86, cf, cf86, k.get("ProgramData"), local, roam, k.get("LocalAppDataLow"),
                 os.path.join(local, "Programs") if local else None, k.get("UserProgramFiles")]
        for r in roots:
            self.scan_dir(r)
        # audio plugins
        for r in [os.path.join(cf, "VST3") if cf else None, os.path.join(cf, "VST2") if cf else None,
                  os.path.join(cf, "VST") if cf else None, os.path.join(cf, "CLAP") if cf else None,
                  os.path.join(cf, "Avid", "Audio", "Plug-Ins") if cf else None,
                  os.path.join(pf, "VSTPlugins") if pf else None, os.path.join(pf, "Steinberg", "VSTPlugins") if pf else None,
                  os.path.join(pf86, "VSTPlugins") if pf86 else None, os.path.join(pf86, "Steinberg", "VSTPlugins") if pf86 else None,
                  os.path.join(cf86, "VST3") if cf86 else None]:
            self.scan_dir(r, label=tr("audio plugin"), bonus=10)
        # temp files
        self.scan_dir(k.get("Temp"), vendor_depth=False, label=tr("temp file"))
        # personal data (never preselected)
        for r in (k.get("Documents"), k.get("SavedGames")):
            self.scan_dir(r, label=tr("user data"))
        # WinGet folders
        if local:
            wg = os.path.join(local, "Microsoft", "WinGet", "Packages")
            kn = norm_name(self.p.get("keyname", "").split("_")[0])
            for e in self._listdir(wg):
                if kn and norm_name(e.split("_")[0]) == kn:
                    self.add("folder", os.path.join(wg, e), 95, tr("The program's WinGet package"))
        # Store: app data
        if self.p.get("source") == "store" and self.p.get("family") and local:
            d = os.path.join(local, "Packages", self.p["family"])
            if os.path.isdir(d):
                self.add("folder", d, 95, tr("Store app data"), extra={"store_data": True})

    def scan_shortcuts(self):
        k = paths.known_folders()
        roots = [k.get("Programs"), k.get("CommonPrograms")]
        for r in roots:
            self.scan_dir(r, label=tr("Start menu"))
        for f, info in index.shortcut_files():
            tgt = info.get("target", "")
            if self.id.refs_location(tgt) or self.id.refs_location(info.get("workdir")):
                self.add("file", f, 95, tr("Shortcut pointing to the program"), group="Shortcuts")
            elif tgt and os.path.isabs(tgt) and not os.path.exists(tgt) and not tgt.lower().startswith(
                    ("http", "steam:", "com.epicgames")) and self.id.match(os.path.basename(f)):
                self.add("file", f, 90, tr("Broken shortcut with the program's name"), group="Shortcuts")
            else:
                m = self.id.match(os.path.basename(f))
                if m:
                    self.add("file", f, m[0], tr("Shortcut with the program's name ({why})", why=m[1]),
                             group="Shortcuts")
        # Start menu folders left empty after removing their shortcuts
        for r in roots:
            for e in self._listdir(r):
                d = os.path.join(r, e) if r else None
                if d and os.path.isdir(d):
                    inner = [os.path.join(dp, f) for dp, _, fn in os.walk(d) for f in fn
                             if f.lower() != "desktop.ini"]
                    if inner and all(f"file:{x.lower()}" in self.items for x in inner):
                        self.add("folder", d, 92, tr("Start menu folder with only the program's shortcuts"),
                                 group="Shortcuts")

    # ---------------------------------------------------------- registry
    def _reg_add(self, ref, score, reason, group="Registry"):
        self.add("regvalue" if ref.value is not None else "regkey", ref.to_str(), score, reason,
                 display=ref.display(), group=group)

    def scan_registry_names(self):
        roots = [("HKCU", "Software", 0), ("HKLM", "SOFTWARE", V64), ("HKLM", "SOFTWARE", V32),
                 ("HKCU", r"Software\AppDataLow\Software", 0)]
        for hive, base, view in roots:
            for sub in registry.subkeys(registry.HIVES[hive], base, view):
                m = self.id.match(sub)
                if m:
                    self._reg_add(RegRef(hive, f"{base}\\{sub}", view), m[0], tr("Key with the program's name ({why})", why=m[1]))
                elif self.id.is_vendor(sub):
                    vend = f"{base}\\{sub}"
                    children = registry.subkeys(registry.HIVES[hive], vend, view)
                    hits = 0
                    for s2 in children:
                        m2 = self.id.match(s2, in_vendor=True)
                        if m2:
                            hits += 1
                            self._reg_add(RegRef(hive, f"{vend}\\{s2}", view), m2[0],
                                          tr("Product key inside the vendor's key ({why})", why=m2[1]))
                    if children and hits == len(children) and not registry.values(registry.HIVES[hive], vend, view):
                        self._reg_add(RegRef(hive, vend, view), 60, tr("Vendor key that would be left empty"))

    def scan_registry_refs(self):
        p = self.p
        # uninstall entry
        if p.get("key"):
            ref = RegRef.from_str(p["key"])
            if registry.key_exists(ref):
                self.add("regkey", ref.to_str(), 100, tr("The program's uninstall entry"),
                         display=ref.display(), group="Registry", extra={"is_uninstall_key": True})
        others = {o.get("id") for o in self.all if o.get("id") != p.get("id")}
        for hive, view, kn, path, vals in index.uninstall_entries():
            if f"{hive}|{view}|{kn}" in others or f"{hive}|{view}|{kn}" == p.get("id"):
                continue
            if any(self.id.refs_location(vals.get(x)) for x in ("InstallLocation", "UninstallString", "DisplayIcon")):
                self._reg_add(RegRef(hive, path, view), 90, tr("Hidden uninstall entry pointing to the program"))
        # App Paths
        for hive, view, path, sub, default, extra_path in index.app_paths():
            if self.id.refs_location(default) or self.id.refs_location(extra_path):
                self._reg_add(RegRef(hive, path, view), 95, tr("Executable path registration (App Paths)"))
            elif sub.lower() in self.id.exes:
                self._reg_add(RegRef(hive, path, view), 75, tr("App Paths entry with the executable's name"))
        # Run / RunOnce + StartupApproved
        approved = index.startup_approved()
        for hive, base, view, name, data in index.run_values():
            if self.id.refs_location(data):
                score = 95
            else:
                m = self.id.match(name)
                score = m[0] if m else 0
            if score >= LEVELS["advanced"]:
                self._reg_add(RegRef(hive, base, view, name), min(score, 95), tr("Starts with Windows"), group="Startup")
                for shive, sbase, sname, _ in approved.get(name.lower(), []):
                    if shive == hive:
                        self._reg_add(RegRef(shive, sbase, 0, sname), min(score, 90), tr("The program's startup state"),
                                      group="Startup")
        # services
        for s in index.services():
            score = 0
            if self.id.refs_location(s["exe"]) or self.id.refs_location(s["image"]):
                score, why = 95, tr("Service that runs one of the program's files")
            else:
                m = self.id.match(s["name"]) or self.id.match(s["display"])
                win = kf("Windows")
                if m and m[0] >= 80 and not (win and is_within(s["exe"], win)):
                    score, why = min(m[0], 85), tr("Service with the program's name ({why})", why=m[1])
            if score:
                self.add("service", s["name"], score, why, display=tr("Service: {name} ({id})", name=s["display"], id=s["name"]),
                         group="Services and tasks", extra={"service": s})
        # scheduled tasks
        for t in index.tasks():
            if t["path"].lower().startswith("\\microsoft\\"):
                continue
            if any(self.id.refs_location(c) or self.id.refs_location(a) for c, a in t["commands"]):
                score, why = 95, tr("Scheduled task that runs the program")
            else:
                m = self.id.match(t["name"].split("_{")[0].split("-S-1-5")[0])
                if not m:
                    continue
                score, why = min(m[0], 85), tr("Task with the program's name ({why})", why=m[1])
            self.add("task", t["path"], score, why, display=tr("Task: {path}", path=t["path"]), group="Services and tasks")
        # SharedDLLs with a count of 1 inside the folder
        for view, base, name, data in index.shared_dlls():
            if self.id.refs_location(name) and str(data) in ("0", "1"):
                self._reg_add(RegRef("HKLM", base, view, name), 92, tr("Shared file counter (only this program uses it)"))
        # firewall rules
        for name, data in index.firewall_rules():
            m = re.search(r"\|App=([^|]+)", str(data))
            if m and self.id.refs_location(m.group(1)):
                nm = re.search(r"\|Name=([^|]+)", str(data))
                self.add("fwrule", name, 95, tr("Firewall rule for the program"),
                         display=tr("Firewall: {name}", name=nm.group(1) if nm else name), group="Services and tasks",
                         extra={"fw_data": str(data)})
        # PATH entries
        for scope, entry in index.env_paths():
            if self.id.refs_location(entry):
                self.add("envpath", f"{scope}|{entry}", 95, tr("PATH entry inside the program's folder"),
                         display=tr("PATH (user): {entry}", entry=entry) if scope == "user" else
                         tr("PATH (system): {entry}", entry=entry), group="Registry")
        # Windows Installer registration
        code = p.get("msi_code")
        if code and not progmod.msi_installed(code):
            packed = progmod.pack_guid(code)
            if packed:
                for ref in (RegRef("HKLM", rf"SOFTWARE\Classes\Installer\Products\{packed}"),
                            RegRef("HKLM", rf"SOFTWARE\Classes\Installer\Features\{packed}"),
                            RegRef("HKCU", rf"Software\Microsoft\Installer\Products\{packed}"),
                            RegRef("HKLM", rf"SOFTWARE\Microsoft\Windows\CurrentVersion\Installer\UserData\S-1-5-18\Products\{packed}", V64)):
                    if registry.key_exists(ref):
                        self._reg_add(ref, 95, tr("Windows Installer registration of a product that is already uninstalled"))

    def scan_classes(self):
        """ProgIDs, CLSIDs and associations pointing to the program (moderate level or higher)."""
        if not self.id.locations:
            return
        cl = index.classes()
        progids = set()
        for hive, base, sub, cmd, icon in cl["progids"]:
            if self.id.refs_location(cmd) or self.id.refs_location(icon):
                progids.add(sub.lower())
                self._reg_add(RegRef(hive, f"{base}\\{sub}"), 90, tr("File type registered by the program"))
        for hive, exe in cl["apps"]:
            if exe in self.id.exes:
                base = r"SOFTWARE\Classes" if hive == "HKLM" else r"Software\Classes"
                self._reg_add(RegRef(hive, rf"{base}\Applications\{exe}"), 85,
                              tr("App registration for “Open with”"))
        for hive, cp, server in cl["clsids"]:
            if self.id.refs_location(server):
                self._reg_add(RegRef(hive, cp), 92, tr("The program's COM component"))
        for hive, base, ext, name in cl["openwith"]:
            if name.lower() in progids:
                self._reg_add(RegRef(hive, rf"{base}\{ext}\OpenWithProgids", 0, name), 90,
                              tr("{ext} file association", ext=ext))

    # ---------------------------------------------------------- final
    def finish(self):
        out = []
        min_score = LEVELS[self.level]
        # vendor folder that would be left empty
        for vd in self.vendor_dirs:
            inner = self._listdir(vd)
            if inner and all(any(k.endswith(os.path.join(vd, e).lower()) for k in self.items) for e in inner):
                self.add("folder", vd, 60, tr("Vendor folder that would be left empty"))
        items = list(self.items.values())
        # drop what is already contained in another item with equal or higher confidence
        paths_sel = sorted([i for i in items if i["kind"] == "folder"], key=lambda i: len(i["target"]))
        regs_sel = sorted([i for i in items if i["kind"] == "regkey"], key=lambda i: len(i["target"]))
        for it in items:
            if it["kind"] in ("folder", "file"):
                for par in paths_sel:
                    if par is not it and is_within(it["target"], par["target"]) and par["score"] >= it["score"]:
                        it["covered"] = True
                        break
            elif it["kind"] in ("regkey", "regvalue"):
                r = RegRef.from_str(it["target"])
                for par in regs_sel:
                    pr = RegRef.from_str(par["target"])
                    if par is it or pr.hive != r.hive or pr.view != r.view:
                        continue
                    if (r.path.lower() + "\\").startswith(pr.path.lower() + "\\") and par["score"] >= it["score"] \
                            and (r.value is not None or r.path.lower() != pr.path.lower()):
                        it["covered"] = True
                        break
        n = 0
        for it in items:
            if it.get("covered") or it["score"] < min_score:
                continue
            blocked, personal = None, False
            if it["kind"] in ("folder", "file"):
                blocked, personal = self.ctx.check_path(it["target"])
                if not os.path.lexists(it["target"]):
                    continue
                if paths.is_reparse_point(it["target"]):
                    it["reasons"].append(tr("It is a link: only the link will be removed, not its contents"))
                if not blocked and it["kind"] == "folder" and _is_game_library(it["target"]):
                    personal = True
                    it["reasons"].append(tr("Contains a game library"))
                it["size"] = paths.path_size(it["target"]) if not blocked else 0
            elif it["kind"] in ("regkey", "regvalue"):
                blocked = safety.reg_rule(RegRef.from_str(it["target"]))
            elif it["kind"] == "service":
                blocked = safety.service_rule(it["target"], {k: it["service"][k] for k in ("type", "start", "image")})
                it.pop("service", None)
            elif it["kind"] == "task" and it["target"].lower().startswith("\\microsoft\\"):
                blocked = tr("Microsoft task")
            installed_part = self.still_installed and (it.get("is_location") or it.get("is_uninstall_key"))
            if installed_part:
                it["reasons"].append(tr("The program is still installed: check this only if you know it is broken"))
            if personal:
                it["reasons"].append(tr("Contains your data (projects, presets, saves…)"))
            it.update({
                "id": f"i{n}", "blocked": blocked, "personal": personal,
                "level": next(l for l in LEVEL_ORDER if it["score"] >= LEVELS[l]),
                "selected": not blocked and not personal and not installed_part and it["score"] >= PRESELECT,
                "group": "Blocked for safety" if blocked else ("Personal data" if personal else
                                                                    it.get("group") or _group(it["kind"])),
            })
            n += 1
            out.append(it)
        out.sort(key=lambda i: (bool(i["blocked"]), -i["score"], i["display"].lower()))
        return out

    def run(self):
        t0 = time.perf_counter()
        steps = [("Files and folders", self.scan_files), ("Shortcuts", self.scan_shortcuts),
                 ("Registry by name", self.scan_registry_names),
                 ("Services, tasks, startup and firewall", self.scan_registry_refs)]
        if self.level != "safe":
            steps.append(("File types and COM components", self.scan_classes))
        for i, (label, fn) in enumerate(steps):
            self.progress(i / len(steps), label)
            try:
                fn()
            except Exception as e:  # a failing step does not bring down the whole scan
                self.progress(i / len(steps), f"{label}: error {e}")
        self.progress(0.97, "Applying safety rules")
        items = self.finish()
        self.progress(1.0, "Done")
        return {"items": items, "level": self.level, "elapsed": round(time.perf_counter() - t0, 2),
                "still_installed": self.still_installed,
                "total_size": sum(i.get("size", 0) for i in items if not i["blocked"])}


def _group(kind):
    return {"folder": "Files and folders", "file": "Files and folders", "regkey": "Registry",
            "regvalue": "Registry", "service": "Services and tasks", "task": "Services and tasks",
            "fwrule": "Services and tasks", "envpath": "Registry"}.get(kind, "Other")


def scan(program, all_programs, level="moderate", still_installed=None, progress=None):
    return Scanner(program, all_programs, level, still_installed, progress).run()
