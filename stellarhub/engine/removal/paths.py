"""System paths, app data folders and path helpers."""
import ctypes
import os
import re
import sys
import time
import uuid
from ctypes import wintypes
from functools import lru_cache

# ---------------------------------------------------------------- app data
# Always in ProgramData: the Microsoft Store Python virtualizes whatever is created in AppData.
DATA_DIR = (os.environ.get("STELLARHUB_DATA") or os.environ.get("MINIREVO_DATA")
            or os.path.join(os.environ.get("ProgramData", r"C:\ProgramData"), "StellarHub", "remover"))


def data_path(*parts, make=True):
    p = os.path.join(DATA_DIR, *parts)
    if make:
        os.makedirs(p if not os.path.splitext(parts[-1])[1] else os.path.dirname(p), exist_ok=True)
    return p


APP_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))  # the StellarHub folder: never touched


# ---------------------------------------------------------------- known folders
class _GUID(ctypes.Structure):
    _fields_ = [("Data1", wintypes.DWORD), ("Data2", wintypes.WORD), ("Data3", wintypes.WORD),
                ("Data4", ctypes.c_ubyte * 8)]

    def __init__(self, s):
        super().__init__()
        u = uuid.UUID(s)
        self.Data1, self.Data2, self.Data3 = u.fields[0], u.fields[1], u.fields[2]
        for i, b in enumerate(u.bytes[8:]):
            self.Data4[i] = b


KNOWN = {
    "Desktop": "B4BFCC3A-DB2C-424C-B029-7FE99A87C641",
    "Documents": "FDD39AD0-238F-46AF-ADB4-6C85480369C7",
    "Downloads": "374DE290-123F-4565-9164-39C4925E467B",
    "Music": "4BD8D571-6D19-48D3-BE97-422220080E43",
    "Pictures": "33E28130-4E1E-4676-835A-98395C3BC3BB",
    "Videos": "18989B1D-99B5-455B-841C-AB7C74E4DDFC",
    "Profile": "5E6C858F-0E22-4760-9AFE-EA3317B67173",
    "LocalAppData": "F1B32785-6FBA-4FCF-9D55-7B8E7F157091",
    "RoamingAppData": "3EB685DB-65F9-4CF6-A03A-E3EF65729F3D",
    "LocalAppDataLow": "A520A1A4-1780-4FF6-BD18-167343C5AF16",
    "ProgramData": "62AB5D82-FDC1-4DC3-A9DD-070D1D495D97",
    "ProgramFiles": "905E63B6-C1BF-494E-B29C-65B732D3D21A",
    "ProgramFilesX86": "7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E",
    "ProgramFilesCommon": "F7F1ED05-9F6D-47A2-AAAE-29D317C6F066",
    "ProgramFilesCommonX86": "DE974D24-D9C6-4D3E-BF91-F4455120B917",
    "UserProgramFiles": "5CD7AEE2-2219-4A67-B85D-6C9CE15660CB",
    "Windows": "F38BF404-1D43-42F2-9305-67DE0B28FC23",
    "StartMenu": "625B53C3-AB48-4EC1-BA1F-A1EF4146FC19",
    "CommonStartMenu": "A4115719-D62E-491D-AA7C-E74B8BE3B067",
    "Programs": "A77F5D77-2E2B-44C3-A6A2-ABA601054A51",
    "CommonPrograms": "0139D44E-6AFE-49F2-8690-3DAFCAE6FFB8",
    "Startup": "B97D20BB-F46A-4C97-BA10-5E3608430854",
    "CommonStartup": "82A5EA35-D9CD-47C5-9629-E15D2F714E6E",
    "PublicDesktop": "C4AA340D-F20F-4863-AFEF-F87EF2E6BA25",
    "Public": "DFDF76A2-C82A-4D63-906A-5644AC457385",
    "SavedGames": "4C5C32FF-BB9D-43B0-B5B4-2D72E54EAAA4",
    "OneDrive": "A52BBA46-E9E1-435F-B3D9-28DAA648C0F6",
}


def _known_folder(guid):
    path = ctypes.c_wchar_p()
    try:
        hr = ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(_GUID(guid)), 0, None, ctypes.byref(path))
        if hr != 0:
            return None
        return path.value
    except Exception:
        return None
    finally:
        if path:
            ctypes.windll.ole32.CoTaskMemFree(path)


def user_temp_dir():
    """The user's temp folder as Windows itself resolves it (GetTempPathW honours TMP/TEMP/USERPROFILE), falling
    back to the Temp folder of LocalAppData. NOT validated here: the cleaner must run safety.temp_root_problem() on it."""
    try:
        buf = ctypes.create_unicode_buffer(32768)
        n = ctypes.windll.kernel32.GetTempPathW(len(buf), buf)
        if 0 < n < len(buf) and buf.value:
            p = buf.value
            return p.rstrip("\\") if len(p) > 3 else p
    except Exception:
        pass
    if os.environ.get("TEMP"):
        return os.environ["TEMP"]
    local = _known_folder(KNOWN["LocalAppData"]) or os.environ.get("LOCALAPPDATA")
    return os.path.join(local, "Temp") if local else None


@lru_cache(maxsize=1)
def known_folders():
    out = {k: _known_folder(g) for k, g in KNOWN.items()}
    env = os.environ
    out["Temp"] = user_temp_dir()
    if not out.get("OneDrive"):
        out["OneDrive"] = env.get("OneDrive")
    out["SystemDrive"] = (env.get("SystemDrive", "C:") + "\\")
    return {k: v for k, v in out.items() if v}


def kf(name):
    return known_folders().get(name)


# ---------------------------------------------------------------- helpers
# Two ways to compare a path, on purpose:
#   * norm_path()/is_within(): text only (lowercase, no trailing separator or dots, variables and 8.3 names
#     expanded). Fast and cached: for lists of names the program itself produced.
#   * forms()/real_norm()/within_norm(): the path Windows really means. A junction, a symlink, a short name, a
#     different case, a trailing dot or a ".." all end at the same final path. THIS is what the safety rules use:
#     a protected folder must not look unprotected because of how it was spelled or reached.
def norm_path(p):
    """Normalized path for comparisons (lowercase, no trailing slash, variables expanded)."""
    if not p:
        return ""
    return _norm_path(p if isinstance(p, str) else str(p))


def _long_name(p):
    r"""C:\Users\JOHNSM~1\... -> C:\Users\John Smith\... (Windows' 8.3 short names, which %TEMP% often uses for
    long or spaced user names). Expands the longest part that exists; the rest is kept as it is."""
    try:
        import ctypes
        get = ctypes.windll.kernel32.GetLongPathNameW
    except (AttributeError, OSError):
        return p
    head, tail = p, ""
    while head and "~" in head:
        buf = ctypes.create_unicode_buffer(1024)
        if 0 < get(head, buf, 1024) <= 1024:
            return buf.value + tail
        parent, name = os.path.split(head)
        if not name or parent == head:
            break
        head, tail = parent, "\\" + name + tail
    return p


def _clean(p):
    r"""Variables expanded, quotes and \\?\ or \??\ prefixes removed, ".." and "." resolved (text only)."""
    p = os.path.expandvars(p.strip().strip('"'))
    if p.startswith(r"\??" "\\"):
        p = p[4:]
    elif p.upper().startswith(r"\\?\UNC" "\\"):
        p = "\\\\" + p[8:]
    elif p.startswith(r"\\?" "\\"):
        p = p[4:]
    return os.path.normpath(p)


def _no_trailing_dots(p):
    r"""Windows ignores trailing dots and spaces in a name ("C:\Windows." is C:\Windows): drop them per component."""
    drive, rest = os.path.splitdrive(p)
    if not rest or (rest[-1] not in ". " and ". " not in rest and ".\\" not in rest and " \\" not in rest):
        return p
    parts = rest.split("\\")
    return drive + "\\".join((c.rstrip(". ") or c) if c not in (".", "..") else c for c in parts)


def _finish(p):
    p = os.path.normcase(_no_trailing_dots(p))
    return p.rstrip("\\") if len(p) > 3 else p


@lru_cache(maxsize=1 << 17)
def _norm_path(p):
    p = _no_trailing_dots(_clean(p))
    if "~" in p and len(p) > 2 and p[1] == ":":
        p = _long_name(p)
    return _finish(p)


def real_norm(p):
    """The final path Windows resolves for `p` (junctions, symlinks, 8.3 names, case, trailing dots), normalized like
    norm_path. For a path that does not exist yet, the part that exists is resolved and the rest is appended.
    NOT cached: a link can be made at any moment, so every safety decision looks again."""
    if not p:
        return ""
    t = _clean(p if isinstance(p, str) else str(p))
    if not os.path.isabs(t) or len(t) <= 3:
        return norm_path(t)
    try:
        t = os.path.realpath(t)   # Python 3.13: GetFinalPathNameByHandle, also expands 8.3 names
    except (OSError, ValueError):
        pass
    return _finish(t)


_real_cache = {}
_REAL_TTL = 300.0


def real_norm_cached(p):
    """real_norm() for fixed lists (the protected folders): remembered for a few minutes."""
    now = time.monotonic()
    hit = _real_cache.get(p)
    if hit is not None and now - hit[0] < _REAL_TTL:
        return hit[1]
    if len(_real_cache) > 4096:
        _real_cache.clear()
    r = real_norm(p)
    _real_cache[p] = (now, r)
    return r


def forms(p):
    """Every normalized spelling of `p` that must be checked: the text form and the real (final) path. One element
    when they are the same, which is the normal case."""
    n = norm_path(p)
    if not n:
        return ()
    r = real_norm(p)
    return (n,) if r == n or not r else (n, r)


def forms_cached(p):
    n = norm_path(p)
    if not n:
        return ()
    r = real_norm_cached(n)
    return (n,) if r == n or not r else (n, r)


def within_norm(child, parent):
    """child is parent or inside it. Both ALREADY normalized (norm_path / forms): no work, no resolution."""
    if not child or not parent:
        return False
    return child == parent or child.startswith(parent.rstrip("\\") + "\\")


def is_within(child, parent):
    """True if child is parent or is inside parent (text comparison, cached; see the note above)."""
    return within_norm(norm_path(child), norm_path(parent))


def is_within_real(child, parent):
    """Like is_within, but on the real paths: true if ANY spelling of child is inside ANY spelling of parent."""
    pf = forms(parent)
    return any(within_norm(c, p) for c in forms(child) for p in pf)


def is_reparse_point(path):
    """True for a junction, symlink or other reparse point. When Windows can't say (the call fails: no restype made
    INVALID_FILE_ATTRIBUTES -1, which read as "a link", and the quarantine then removed a real file as one) the
    answer comes from lstat; a path that can't be read at all is not a link."""
    try:
        attrs = _GetFileAttributesW(str(path)) & 0xFFFFFFFF
    except Exception:
        attrs = 0xFFFFFFFF
    if attrs != 0xFFFFFFFF:
        return bool(attrs & 0x400)
    try:
        return bool(os.lstat(path).st_file_attributes & 0x400)
    except (OSError, ValueError, AttributeError):
        return False


try:
    _GetFileAttributesW = ctypes.windll.kernel32.GetFileAttributesW
    _GetFileAttributesW.argtypes, _GetFileAttributesW.restype = [wintypes.LPCWSTR], wintypes.DWORD
except (AttributeError, OSError):
    def _GetFileAttributesW(_p):
        return 0xFFFFFFFF


_NOT_ALNUM = re.compile(r"[^a-z0-9]")


@lru_cache(maxsize=1 << 17)
def norm_name(s):
    return _NOT_ALNUM.sub("", (s or "").lower())


def folder_size(path, limit_files=None):
    """Size in bytes without following links. Return (bytes, files).

    Attributes and sizes come from the listing itself (FindNextFile): no extra call per file.
    """
    total = files = 0
    stack = [path]
    while stack:
        d = stack.pop()
        try:
            with os.scandir(d) as it:
                for e in it:
                    try:
                        st = e.stat(follow_symlinks=False)
                        if st.st_file_attributes & _REPARSE:   # link, junction or similar: not followed
                            continue
                        if st.st_file_attributes & _DIRECTORY:
                            stack.append(e.path)
                        else:
                            total += st.st_size
                            files += 1
                            if limit_files and files >= limit_files:
                                return total, files
                    except OSError:
                        pass
        except OSError:
            pass
    return total, files


_REPARSE, _DIRECTORY = 0x400, 0x10
_JUNCTION_TAG = 0xA0000003  # IO_REPARSE_TAG_MOUNT_POINT


def entry_is_junction(e):
    """DirEntry.is_junction() (Python 3.12+), falling back to the reparse tag on Python 3.11."""
    fn = getattr(e, "is_junction", None)
    return fn() if fn is not None else getattr(e.stat(follow_symlinks=False), "st_reparse_tag", 0) == _JUNCTION_TAG


def walk_nolinks(root):
    """Bottom-up walk that NEVER enters a link or junction (os.walk does on Windows).

    Yields (dirpath, files, dirs, links): `links` are reparse points (file or folder) found directly in dirpath;
    they are reported, never descended into. Delete a link with remove_link(), which never touches its target.
    """
    def visit(d):
        files, dirs, links = [], [], []
        try:
            with os.scandir(d) as it:
                for e in it:
                    try:
                        attrs = e.stat(follow_symlinks=False).st_file_attributes
                    except OSError:
                        continue
                    if attrs & _REPARSE:
                        links.append(e.path)
                    elif attrs & _DIRECTORY:
                        dirs.append(e.path)
                    else:
                        files.append(e.path)
        except OSError:
            return
        for sub in dirs:
            yield from visit(sub)
        yield d, files, dirs, links
    yield from visit(root)


def remove_link(path):
    """Remove the link itself (junction, directory or file symlink), never its target."""
    try:
        if os.stat(path, follow_symlinks=False).st_file_attributes & _DIRECTORY:
            os.rmdir(path)
            return
    except OSError:
        pass
    os.remove(path)


def path_size(path):
    try:
        if os.path.isdir(path) and not is_reparse_point(path):
            return folder_size(path)[0]
        return os.path.getsize(path)
    except OSError:
        return 0


@lru_cache(maxsize=1)
def running_packaged():
    """True if this Python runs as a packaged app (Microsoft Store Python)."""
    try:
        n = ctypes.c_uint32(0)
        rc = ctypes.windll.kernel32.GetCurrentPackageFullName(ctypes.byref(n), None)
        return rc != 15700  # APPMODEL_ERROR_NO_PACKAGE
    except Exception:
        return False


def self_paths():
    """Paths the remover must never touch (its own code, its data, its Python)."""
    out = {norm_path(APP_DIR), norm_path(DATA_DIR), norm_path(os.path.dirname(sys.executable))}
    if getattr(sys, "frozen", False):
        out.add(norm_path(os.path.dirname(sys.executable)))
    base = getattr(sys, "_MEIPASS", None)
    if base:
        out.add(norm_path(base))
    out |= {r for p in list(out) if p for r in forms_cached(p)}   # and where they really are (links, short names)
    return {p for p in out if p}
