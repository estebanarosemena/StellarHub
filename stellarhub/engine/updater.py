"""Program Updater engine: everything on this PC that can be updated, for real.

- Apps, Store, components and developer tools: winget (the `winget upgrade` and `winget list` tables).
  Icons come from the installed program (uninstall registry), with the same extractor as the Program Remover.
- Windows Update (software, not drivers): COM Microsoft.Update.Session (search, history, install), pause in the
  registry the same way Settings does it, pending restart.
- Development: pip (from the user's Python) and global npm packages.
Long tasks (search and install) are JOBS with real progress; searching is read-only.
"""
import ctypes
import json
import os
import re
import subprocess
import sys
import threading
import time
import winreg
from concurrent.futures import ThreadPoolExecutor

from ..i18n import tr
from .ps import ps_json, gather, NO_WINDOW, kill_tree, run as _run, ToolError

EXPORTS = {"status", "notes", "pin", "unpin", "set_pause", "store_auto", "set_store_auto", "icon_for"}
JOBS = {"scan_apps", "scan_windows", "scan_dev", "install"}

# ---------------------------------------------------------------- helpers
def _admin():
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _exe(name):
    from shutil import which
    return which(name) or which(name + ".exe") or which(name + ".cmd")


def _python():
    """The user's Python (not pythonw): the same one StellarHub runs on or, in the installed app (which carries
    its own private Python), the one the user has installed."""
    if getattr(sys, "frozen", False):
        return _exe("py") or _exe("python") or "python"
    exe = sys.executable
    if exe.lower().endswith("pythonw.exe"):
        cand = exe[:-11] + "python.exe"
        if os.path.exists(cand):
            return cand
    return exe


def _stream(cmd, on_text=None, job=None, timeout=None, env=None, on_tick=None):
    """Runs a command and hands over the text in pieces split on \\r and \\n (winget draws its bars with \\r).
    Returns (code, output). If the job is cancelled, or the timeout passes, kills the process.

    The pipe is read on its own thread and the command's END is what ends the wait, not the end of the pipe: an
    installer that winget starts can leave a process running (an update service, the app itself) that inherited
    the pipe, so the pipe may never close. on_tick(elapsed, quiet) runs about once a second."""
    import queue
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                         creationflags=NO_WINDOW, env=env)
    q = queue.Queue()

    def reader():
        try:
            while True:
                ch = p.stdout.read1(4096) if hasattr(p.stdout, "read1") else p.stdout.read(1)
                if not ch:
                    break
                q.put(ch)
        except (OSError, ValueError):
            pass
        q.put(None)
    threading.Thread(target=reader, daemon=True).start()
    out, buf = [], b""
    t0 = last = tick = time.monotonic()
    ended = None  # when the command itself exited

    def feed(ch):
        nonlocal buf
        buf += ch
        parts = re.split(rb"[\r\n]", buf)
        buf = parts.pop()
        for raw in parts:
            s = raw.decode("utf-8", "replace")
            out.append(s)
            if on_text and s.strip():
                on_text(s)
    while True:
        now = time.monotonic()
        if (job is not None and job.cancelled) or (timeout and now - t0 > timeout):
            kill_tree(p)  # the installer winget started is a child too: it must not outlive "Cancelled"
            break
        try:
            ch = q.get(timeout=.25)
        except queue.Empty:
            ch = b""
        if ch is None:
            break  # the pipe closed: everything was read
        now = time.monotonic()
        if ch:
            feed(ch)
            last = now
        if ended is None and p.poll() is not None:
            ended = now
        if ended is not None and q.empty() and now - ended > 1.5:
            break  # the command is over and someone else still holds the pipe open
        if on_tick and now - tick >= 1:
            tick = now
            try:
                on_tick(now - t0, now - last)
            except Exception:
                pass
    if buf:
        s = buf.decode("utf-8", "replace")
        out.append(s)
        if on_text and s.strip():
            on_text(s)
    try:
        p.wait(timeout=10)
    except subprocess.TimeoutExpired:
        p.kill()
    return p.returncode, "\n".join(out)


def consent_prompt_open():
    """True while Windows shows (or waits to show) an administrator permission prompt (consent.exe)."""
    try:
        import psutil
        return any((pr.info.get("name") or "").lower() == "consent.exe" for pr in psutil.process_iter(["name"]))
    except Exception:
        return False


def _winget_ex(args, timeout=180, job=None):
    """(exit code, text) of a winget command, or None when winget is not installed. Cancelling the job kills winget
    and what it started. Raises ToolError (short, translated) when it takes longer than `timeout`."""
    exe = _exe("winget")
    if not exe:
        return None
    try:
        return _run([exe, *args, "--accept-source-agreements", "--disable-interactivity"], timeout=timeout, job=job,
                    raise_on_timeout=True)
    except subprocess.TimeoutExpired:
        raise ToolError(tr("Windows took too long to answer. Try again."))


def _winget(args, timeout=180, job=None):
    r = _winget_ex(args, timeout, job)
    return None if r is None else r[1]


# winget exit codes that mean "nothing to show", not "it failed": no match, nothing to upgrade, not applicable
_WINGET_EMPTY_OK = {0, 0x8A150014, 0x8A15002B, 0x8A15004F}
_WINGET_FAIL_TEXT = re.compile(r"0x8a15\w{4}|0x8007\w{4}|0x8000\w{4}|0x800c\w{4}|failed when|failed to|unable to|"
                               r"internet|connection|conexi[oó]n", re.I)


def check_failed(code, text, rows):
    """True when a winget table read did not really work (no internet, a broken source): no rows, no table at all,
    and either an error exit code or error text. A table with no rows still means winget answered."""
    if rows or re.search(r"^-{10,}\s*$", text or "", re.M):
        return False
    c = (code if code is not None else 0) & 0xFFFFFFFF
    return c not in _WINGET_EMPTY_OK or bool(_WINGET_FAIL_TEXT.search(text or ""))


_PAD = "⁠"  # word joiner: placeholder for the second display cell of a wide character


def _cells(s):
    if s.isascii():
        return s
    import unicodedata
    return "".join(ch + _PAD if unicodedata.east_asian_width(ch) in ("W", "F") else ch for ch in s)


def parse_table(text):
    """winget table to a list of dicts {name,id,version,available,source}. Columns by header position
    (works with Spanish and English Windows and with variable widths)."""
    # winget pads columns by DISPLAY width: a wide character (CJK, fullwidth) takes two cells, so slicing by
    # character index would shift every column after it. Wide characters get a zero-width placeholder so that
    # character positions match display cells again; the placeholder is dropped from the values.
    lines = [_cells(ln.split("\r")[-1]) for ln in text.splitlines()]
    hdr_i = next((i for i in range(len(lines) - 1) if re.match(r"^-{10,}\s*$", lines[i + 1] or "")), None)
    if hdr_i is None:
        return []
    hdr = lines[hdr_i]
    starts, names = [], []
    known = set().union(*_HEADERS.values())
    for m in re.finditer(r"\S+(?: \S+)*", hdr):
        words = list(re.finditer(r"\S+", m.group(0)))
        # two headers only one space apart ("Available Source" when the column is exactly as wide as its title)
        if len(words) > 1 and all(w.group(0).lower() in known for w in words):
            for w in words:
                starts.append(m.start() + w.start())
                names.append(w.group(0).lower())
        else:
            starts.append(m.start())
            names.append(m.group(0).lower())
    keys = _column_keys(names, lines[hdr_i + 2:])
    rows = []
    for ln in lines[hdr_i + 2:]:
        if not ln.strip():
            break
        if len(ln) < starts[min(1, len(starts) - 1)]:
            break
        d = {}
        for j, k in enumerate(keys):
            a = starts[j]
            b = starts[j + 1] if j + 1 < len(starts) else len(ln)
            d[k] = ln[a:b].replace(_PAD, "").strip()
        wid = d.get("id") or ""
        if not wid or (" " in wid and not wid.startswith(("ARP\\", "MSIX\\"))) or not _ID_LIKE.match(wid):
            # a summary line ("14 upgrades available." in any language) or something that is not a package row
            if re.match(r"^\s*\d+\s", ln):
                break
            continue
        d.setdefault("name", "")
        rows.append(d)
    return rows


# a winget id ("Vendor.App"), a Store id ("9NBLGGH4NNS1"), or a winget list entry for an app outside winget
_ID_LIKE = re.compile(r"^(ARP\\|MSIX\\|[0-9A-Z]{12}$|\S+\.\S+)", re.I)

# column headers in the languages winget prints them in (it follows the Windows display language)
_HEADERS = {
    "name": {"name", "nombre", "nom", "nome", "名称", "名稱", "名前", "이름", "имя"},
    "id": {"id", "identificador", "identifiant", "identificatore", "kennung", "標識碼", "ид"},
    "version": {"version", "versión", "versão", "versione", "版本", "バージョン", "버전", "версия"},
    "available": {"available", "disponible", "disponível", "disponibile", "verfügbar", "可用", "利用可能", "사용 가능", "доступно"},
    "source": {"source", "origen", "fuente", "fonte", "origine", "quelle", "源", "ソース", "원본", "источник"},
    "match": {"match", "coincidencia", "correspondance", "corrispondenza", "correspondência", "übereinstimmung", "匹配",
              "совпадение"},
}


def _column_keys(names, rows):
    """The key for each header. Known words first; anything else by position, which is the same in every
    language: Name, Id, Version, [Available], [Source]. A lone 4th column is the source if it only holds source
    names (winget, msstore)."""
    keys = []
    for i, n in enumerate(names):
        k = next((key for key, words in _HEADERS.items() if n in words), None)
        keys.append(k)
    pos = ["name", "id", "version"]
    for i in range(min(3, len(keys))):
        if keys[i] is None:
            keys[i] = pos[i]
    if len(keys) >= 4:
        last = len(keys) - 1
        if keys[last] is None:
            vals = {ln[len(ln) and 0:].split()[-1].lower() for ln in rows[:15] if ln.strip()} if rows else set()
            keys[last] = "source" if len(keys) >= 5 or vals <= {"winget", "msstore"} else "available"
        for i in range(3, last):
            if keys[i] is None:
                keys[i] = "available"
    return [k or f"col{i}" for i, k in enumerate(keys)]


# ---------------------------------------------------------------- categories
RUNTIME_RE = re.compile(r"^(Microsoft\.(DotNet|VCRedist|EdgeWebView2Runtime|DirectX|WindowsAppRuntime|UI\.Xaml|VCLibs)|"
                        r"EclipseAdoptium\.|Oracle\.JavaRuntime|Oracle\.JDK|Microsoft\.OpenJDK|Azul\.|Amazon\.Corretto)", re.I)
DEV_RE = re.compile(r"^(Python\.Python|OpenJS\.NodeJS|Git\.Git|GitHub\.(cli|GitHubDesktop)|Microsoft\.PowerShell|astral-sh\.|"
                    r"Microsoft\.WSL|Kitware\.CMake|Rustlang\.|GoLang\.|CoreyButler\.NVMforWindows|Yarn\.|pnpm\.|Docker\.)", re.I)
STORE_IDS = {"microsoft.appinstaller", "microsoft.windowsterminal"}


def _category(row):
    i = row.get("id", "")
    if (row.get("source") or "").lower() == "msstore" or i.lower() in STORE_IDS or i.startswith("MSIX\\"):
        return "store"
    if RUNTIME_RE.match(i):
        return "runtimes"
    if DEV_RE.match(i):
        return "dev"
    return "apps"


# ---------------------------------------------------------------- icons and publisher (from the installed program)
_prog_idx = None
_prog_lock = threading.Lock()


def _norm(s):
    s = (s or "").lower().replace("…", "")
    s = re.sub(r"\(.*?\)|v?\d+(\.\d+)+|x64|x86|64-bit|32-bit", " ", s)
    return re.sub(r"[^a-z0-9áéíóúñü]+", "", s)


def _programs():
    global _prog_idx
    with _prog_lock:
        if _prog_idx is None:
            from .removal import programs
            try:
                progs = programs.get_win32_programs()
            except Exception:
                progs = []
            try:
                progs += programs.cached_store_apps() or []
            except Exception:
                pass
            by_key = {p.get("keyname", "").lower(): p for p in progs if p.get("keyname")}
            by_name = {}
            for p in progs:
                by_name.setdefault(_norm(p["name"]), p)
            _prog_idx = (progs, by_key, by_name)
        return _prog_idx


def _match(row):
    progs, by_key, by_name = _programs()
    rid = row.get("id", "")
    if rid.startswith(("ARP\\", "MSIX\\")):  # registry key or Store package full name
        p = by_key.get(rid.split("\\")[-1].lower())
        if p:
            return p
    n = _norm(row.get("name", ""))
    if not n:
        return None
    if n in by_name:
        return by_name[n]
    trunc = row.get("name", "").endswith("…")
    for k, p in by_name.items():
        if k and (k.startswith(n) if trunc else (k.startswith(n) or n.startswith(k)) and min(len(k), len(n)) >= 4):
            return p
    return None


def _icon(p):
    if not p:
        return None
    try:
        from .removal.icons import get_icon
        return get_icon(p)
    except Exception:
        return None


def icon_for(name):
    return _icon(_match({"name": name}))


# ---------------------------------------------------------------- search: apps, Store, components
def _pins():
    out = _winget(["pin", "list"], timeout=60) or ""
    return {r["id"]: r.get("version", "") for r in parse_table(out)}


def scan_apps(job):
    """Read-only: what winget can update and what is installed outside winget."""
    if not _exe("winget"):
        return {"winget": False}
    job.progress(.05, tr("Asking winget what's new…"))
    pool = ThreadPoolExecutor(4)
    f_up = pool.submit(_winget_ex, ["upgrade", "--include-unknown"], 240, job)
    f_ls = pool.submit(lambda: parse_table(_winget(["list"], timeout=240, job=job) or ""))
    f_pin = pool.submit(_pins)
    f_prog = pool.submit(_programs)
    code_up, text_up = f_up.result() or (0, "")
    job.check()
    ups = parse_table(text_up)
    if check_failed(code_up, text_up, ups):
        # no internet or a broken source: never show it as "everything is up to date"
        return {"winget": True, "failed": "offline", "items": [], "unknown": [], "storeOk": [], "runtimesOk": [],
                "devOk": [], "pins": {}, "ts": time.time()}
    job.progress(.45, tr("{n} updates found. Reading what's installed…", n=len(ups)))
    installed = f_ls.result()
    pins = f_pin.result()
    f_prog.result()
    job.check()
    up_ids = {u["id"] for u in ups}
    items = []
    for u in ups:
        if not u.get("available"):
            continue
        p = _match(u)
        # "Unknown" (winget writes it in the system language: "desconocido", "Inconnu", "Unbekannt"...) or "< x":
        # winget can't read the installed version, so "updating" just reinstalls the latest one every time (a
        # long-standing winget complaint). Shown, but optional: not in "Update all" nor in the pending count.
        ver = u.get("version") or ""
        unk = unknown_version(ver)
        items.append({"id": u["id"], "wid": u["id"], "kind": "winget", "name": u["name"].replace("…", "").strip(),
                      "pub": (p or {}).get("publisher") or (u.get("source") == "msstore" and "Microsoft Store") or "",
                      "from": "unknown" if unk else ver, "unknownVersion": unk, "optional": unk,
                      "to": u["available"], "source": u.get("source") or "",
                      "cat": _category(u), "mb": None, "admin": False, "reboot": False,
                      "notes": [tr("winget can't read the installed version, so updating reinstalls the latest one. "
                                   "That's why it isn't included in Update all.")] if unk else [],
                      "pinned": u["id"] in pins, "user": bool((p or {}).get("user")), "_p": p})
    # outside winget: registry programs (ARP) that winget can't update
    unknown, store_ok, rt_ok, dev_ok = [], [], [], []
    for r in installed:
        rid = r.get("id", "")
        if rid in up_ids:
            continue
        if rid.startswith("ARP\\") and not r.get("source"):
            p = _match(r)
            unknown.append({"name": r["name"].replace("…", "").strip(), "ver": r.get("version", ""),
                            "pub": (p or {}).get("publisher", ""), "url": (p or {}).get("url", ""), "_p": p})
        elif rid.startswith("MSIX\\") or (r.get("source") or "").lower() == "msstore":
            store_ok.append({"name": r["name"], "ver": r.get("version", ""), "_p": _match(r)})
        else:
            c = _category(r)
            if c == "runtimes":
                rt_ok.append({"name": r["name"], "ver": r.get("version", ""), "pub": "", "id": rid, "_p": _match(r)})
            elif c == "dev":
                dev_ok.append({"name": r["name"], "ver": r.get("version", ""), "id": rid, "_p": _match(r)})
    # components: no duplicates and no Store framework packages nobody recognizes
    noise = re.compile(r"UWP|Native Runtime Package|^Microsoft\.(UI\.Xaml|VCLibs|WindowsAppRuntime)", re.I)
    seen = set()
    rt_ok = [x for x in rt_ok if not noise.search(x["name"]) and not ((x["name"], x["ver"]) in seen or seen.add((x["name"], x["ver"])))]
    # WebView2 doesn't always show up in winget
    wv = _webview2()
    if wv and not any("webview2" in x["name"].lower() for x in rt_ok + [i for i in items if i["cat"] == "runtimes"]):
        exe = os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), "Microsoft", "EdgeWebView",
                           "Application", wv, "msedgewebview2.exe")
        rt_ok.append({"name": "WebView2 Runtime", "ver": wv, "pub": "Microsoft", "id": "Microsoft.EdgeWebView2Runtime",
                      "_p": {"source": "file", "icon": exe}})
    job.progress(.6, tr("Getting each program's icon…"))
    lists = items + unknown + store_ok + rt_ok + dev_ok
    for x in items:  # not in the registry index: the icon helper still looks in Program Files\<name>
        if not x.get("_p") and x.get("source") != "msstore":
            x["_p"] = {"name": x["name"], "source": "winget"}
    todo = [x for x in lists if x.get("_p")]
    done = [0]

    def ic(x):
        x["icon"] = _icon(x["_p"])
        done[0] += 1
        if done[0] % 4 == 0:
            job.progress(.6 + .38 * done[0] / max(1, len(todo)), tr("Getting each program's icon…"))
    list(ThreadPoolExecutor(6).map(ic, todo))
    for x in lists:
        x.pop("_p", None)
    unknown.sort(key=lambda x: x["name"].lower())
    store_ok.sort(key=lambda x: x["name"].lower())
    return {"winget": True, "items": items, "unknown": unknown, "storeOk": store_ok, "runtimesOk": rt_ok,
            "devOk": dev_ok, "pins": pins, "ts": time.time()}


def _webview2():
    for root, path in ((winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"),
                       (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}")):
        try:
            with winreg.OpenKey(root, path) as k:
                return winreg.QueryValueEx(k, "pv")[0]
        except OSError:
            pass
    return None


def notes(wid):
    """Release notes the publisher puts on winget (if any)."""
    out = _winget(["show", "--id", wid, "--exact"], timeout=60) or ""
    lines, take, url = [], False, ""
    for ln in out.splitlines():
        # field names in English, Spanish and Russian (winget follows the Windows language)
        if re.match(r"^\s*(Release Notes|Notas de la versión|Заметки о выпуске)\s*:", ln, re.I):
            take = True
            rest = ln.split(":", 1)[1].strip()
            if rest:
                lines.append(rest)
            continue
        m = re.match(r"^\s*(Release Notes Url|Dirección URL de las notas de la versión|URL-адрес заметок о выпуске)\s*:\s*(\S+)", ln, re.I)
        if m:
            url = m.group(2)
            take = False
            continue
        if take:
            if re.match(r"^\S.*:\s*", ln) and not ln.startswith(" "):
                take = False
                continue
            if ln.strip():
                lines.append(ln.strip())
    clean = [re.sub(r"^[-*•]\s*", "", x) for x in lines if not x.startswith("#")][:8]
    return {"notes": clean, "url": url}


def pin(wid):
    """Stay on the current version (winget pin)."""
    out = _winget(["pin", "add", "--id", wid, "--exact"], timeout=60) or ""
    return {"ok": True, "out": out[-300:]}


def unknown_version(ver):
    """True when winget could not read the installed version: empty, "< x", or a word with no digit in any language."""
    ver = (ver or "").strip()
    return not re.search(r"\d", ver) or ver.startswith("<")


def unpin(wid):
    out = _winget(["pin", "remove", "--id", wid, "--exact"], timeout=60) or ""
    return {"ok": True, "out": out[-300:]}


# ---------------------------------------------------------------- Windows Update
_WU_SCAN = r"""
$s=New-Object -ComObject Microsoft.Update.Session; $se=$s.CreateUpdateSearcher(); $err=$null; $r=$null
try { $r=$se.Search("IsInstalled=0 and Type='Software' and IsHidden=0") } catch { $err=$_.Exception.HResult }
$ups=@(foreach($u in $r.Updates){ [pscustomobject]@{ id=$u.Identity.UpdateID; title=$u.Title; kb=@($u.KBArticleIDs);
  cats=@($u.Categories | ForEach-Object { $_.Name }); mb=[math]::Round($u.MaxDownloadSize/1MB,1);
  reboot=[bool]($u.InstallationBehavior.RebootBehavior -ne 0); browse=[bool]$u.BrowseOnly; sev=$u.MsrcSeverity; desc=$u.Description } })
$n=$se.GetTotalHistoryCount(); $h=@(if($n){ $se.QueryHistory(0,[math]::Min($n,40)) | ForEach-Object { [pscustomobject]@{ t=$_.Title; d=$_.Date.ToString('o'); rc=[int]$_.ResultCode; hr=$_.HResult } } })
$ux=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings' -ErrorAction SilentlyContinue
$mp=Get-MpComputerStatus -ErrorAction SilentlyContinue
$av=@(Get-CimInstance -Namespace root\SecurityCenter2 AntiVirusProduct -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ n=$_.displayName; st=$_.productState } })
$cv=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
[pscustomobject]@{ err=$err; updates=$ups; hist=$h; reboot=(New-Object -ComObject Microsoft.Update.SystemInfo).RebootRequired;
  pause=$ux.PauseUpdatesExpiryTime; mpMode="$($mp.AMRunningMode)"; sig=$mp.AntivirusSignatureVersion;
  sigDate=$(if($mp.AntivirusSignatureLastUpdated){$mp.AntivirusSignatureLastUpdated.ToString('o')}else{$null}); av=$av;
  build="$($cv.CurrentBuild).$($cv.UBR)"; ver=$cv.DisplayVersion; prod=$cv.ProductName }
"""


def defender_running(mode):
    """Defender's running mode (AMRunningMode) says it protects the PC. Windows writes it in its own language
    ("ejecución normal", "Modo pasivo", "No se está ejecutando"...): any mode counts except a passive or not running
    one, in the languages StellarHub speaks (a Spanish "Modo pasivo" used to count as on: only English was checked)."""
    low = str(mode or "").strip().lower()
    return bool(low) and not re.search(r"pass?i[vf]|\bnot?\b|\bnon\b|\bpas\b|nicht|未|停止|無効|关闭|пассивн|не выполня", low)


def _pretty_title(t):
    t = re.sub(r"^9[A-Z0-9]{11}-", "", t or "")  # Store entries: "9NRZT3Q9R3DL-Microsoft.X"
    return t


def _wu_cat(u):
    cats = " ".join(u.get("cats") or []).lower()
    t = (u.get("title") or "").lower()
    # category and title words in English, Spanish and Russian (Windows Update answers in the system language)
    if u.get("browse") or "preview" in t or "vista previa" in t or "предварительн" in t:
        return "optional"
    if "security" in cats or "seguridad" in cats or "critical" in cats or "crítica" in cats or "definition" in cats \
            or "definici" in cats or "malicious" in t or "malintencionado" in t or u.get("sev") \
            or "безопасност" in cats or "критическ" in cats or "определени" in cats or "вредоносн" in t:
        return "security"
    return "windows"


def scan_windows(job):
    """Read-only: a real Windows Update search (takes 20-60 s), history, pause, restart and antivirus."""
    job.progress(.1, tr("Searching Windows Update…"))
    stop = threading.Event()

    def tick():  # the Windows search reports no progress: creep forward slowly so it looks alive
        p = .1
        while not stop.wait(1.0):
            p = min(.9, p + (.9 - p) * .06)
            job.progress(p, tr("Searching Windows Update…"))
    threading.Thread(target=tick, daemon=True).start()
    try:
        r = ps_json(_WU_SCAN, timeout=300)
    finally:
        stop.set()
    # A search that failed (no internet, the service disabled, a Windows Update error) is an error, never "no updates":
    # PowerShell goes on after the failed call, so it used to come back as an empty list that the page showed (and
    # kept) as "Windows is up to date".
    if not isinstance(r, dict):
        raise ToolError(tr("Windows Update did not respond"))
    if r.get("err") is not None:
        try:
            code = f"{int(r['err']) & 0xFFFFFFFF:08X}"
        except (TypeError, ValueError):
            code = str(r["err"])[:12]
        raise ToolError(tr("Windows Update returned 0x{code}", code=code))
    ups = []
    for u in r.get("updates") or []:
        cat = _wu_cat(u)
        kb = (u.get("kb") or [None])[0]
        ups.append({"id": "wu:" + u["id"], "uid": u["id"], "kind": "wu", "name": _pretty_title(u["title"]),
                    "pub": "Windows Update", "from": "", "to": f"KB{kb}" if kb else "", "kb": f"KB{kb}" if kb else "",
                    "cat": "windows" if cat == "optional" else cat, "optional": cat == "optional", "mb": u.get("mb"),
                    "admin": True, "reboot": bool(u.get("reboot")), "notes": [u["desc"]] if u.get("desc") else []})
    hist, seen = [], set()
    for h in r.get("hist") or []:
        key = (h["t"], (h.get("d") or "")[:16])
        if key in seen:
            continue
        seen.add(key)
        hist.append({"t": _pretty_title(h["t"]), "d": h["d"], "ok": h["rc"] in (2, 3), "hr": f"0x{(h.get('hr') or 0) & 0xFFFFFFFF:08X}"})
    av = [a["n"] for a in (r.get("av") or []) if a.get("n")]
    third = [a for a in av if "defender" not in a.lower()]
    mode = (r.get("mpMode") or "").strip()
    defender_on = defender_running(mode)
    prod = r.get("prod") or "Windows"
    try:  # the registry still says "Windows 10" on Windows 11
        if int(str(r.get("build", "0")).split(".")[0]) >= 22000:
            prod = prod.replace("Windows 10", "Windows 11")
    except ValueError:
        pass
    r["prod"] = prod
    return {"updates": ups, "history": hist, "reboot": bool(r.get("reboot")), "pause": r.get("pause"),
            "defender": {"on": bool(defender_on), "mode": mode, "sig": r.get("sig"), "sigDate": r.get("sigDate"), "others": third},
            "build": r.get("build"), "version": r.get("ver"), "product": r.get("prod"), "admin": _admin(), "ts": time.time()}


def set_pause(weeks):
    """Pause Windows Update for N weeks (0 = resume). The same keys Settings uses. Needs admin."""
    if not _admin():
        return {"needAdmin": True}
    path = r"SOFTWARE\Microsoft\WindowsUpdate\UX\Settings"
    keys = ("PauseFeatureUpdatesStartTime", "PauseFeatureUpdatesEndTime", "PauseQualityUpdatesStartTime",
            "PauseQualityUpdatesEndTime", "PauseUpdatesStartTime", "PauseUpdatesExpiryTime")
    with winreg.CreateKeyEx(winreg.HKEY_LOCAL_MACHINE, path, 0, winreg.KEY_SET_VALUE | winreg.KEY_WOW64_64KEY) as k:
        if int(weeks) <= 0:
            for n in keys:
                try:
                    winreg.DeleteValue(k, n)
                except OSError:
                    pass
            return {"ok": True, "pause": None}
        now = time.gmtime()
        end = time.gmtime(time.time() + int(weeks) * 7 * 86400)
        fmt = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", t)
        for n in keys:
            winreg.SetValueEx(k, n, 0, winreg.REG_SZ, fmt(now) if n.endswith("StartTime") else fmt(end))
    return {"ok": True, "pause": fmt(end)}


def store_auto():
    """Does the Store update apps on its own? (AutoDownload policy: 2 = no, 4 or no policy = yes)."""
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Policies\Microsoft\WindowsStore") as k:
            v = winreg.QueryValueEx(k, "AutoDownload")[0]
            return {"on": v != 2, "policy": True}
    except OSError:
        return {"on": True, "policy": False}


def set_store_auto(on):
    if not _admin():
        return {"needAdmin": True}
    with winreg.CreateKeyEx(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Policies\Microsoft\WindowsStore", 0, winreg.KEY_SET_VALUE) as k:
        if on:
            try:
                winreg.DeleteValue(k, "AutoDownload")
            except OSError:
                pass
        else:
            winreg.SetValueEx(k, "AutoDownload", 0, winreg.REG_DWORD, 2)
    return store_auto()


# ---------------------------------------------------------------- development
def scan_dev(job):
    """Read-only: outdated pip packages (from the user's Python), global npm packages and versions."""
    out = {"python": None, "pip": [], "node": None, "npm": [], "git": None, "tools": [], "ts": time.time()}
    py = _python()
    job.progress(.1, tr("Asking pip…"))

    # pip and npm ask the network for the latest versions (seconds each): they and the tool versions run together
    def pip():
        res = {}
        try:
            r = subprocess.run([py, "--version"], capture_output=True, text=True, timeout=20, creationflags=NO_WINDOW)
            ver = (r.stdout or r.stderr).strip()
            # no Python: Windows' Store alias answers "Python was not found..." (exit code 9009): not a version, and
            # an empty pip list from it is not "all up to date"
            if r.returncode != 0 or not re.match(r"Python \d", ver):
                return res
            res["python"] = ver.replace("Python ", "")
            r = subprocess.run([py, "-m", "pip", "list", "--outdated", "--format=json", "--disable-pip-version-check"],
                               capture_output=True, timeout=180, creationflags=NO_WINDOW)
            if r.returncode != 0 or not r.stdout.strip():
                res["pipError"] = (r.stderr.decode("utf-8", "replace").strip().splitlines() or ["pip"])[-1][:200]
                return res
            res["pip"] = [[p["name"], p["version"], p["latest_version"]] for p in json.loads(r.stdout.decode("utf-8", "replace"))]
        except Exception as e:
            res["pipError"] = str(e)[:200]
        return res

    def npm_scan():
        res = {}
        node = _exe("node")
        if node:
            try:
                res["node"] = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=15, creationflags=NO_WINDOW).stdout.strip().lstrip("v")
                npm = _exe("npm")
                r = subprocess.run([npm, "outdated", "-g", "--json"], capture_output=True, timeout=90, creationflags=NO_WINDOW)
                data = json.loads(r.stdout.decode("utf-8", "replace") or "{}")
                if isinstance(data.get("error"), dict):  # offline or npm failed: it says so in the same JSON
                    raise RuntimeError(str(data["error"].get("summary") or data["error"].get("code") or "npm")[:200])
                res["npm"] = [[n, d.get("current", ""), d.get("latest", "")] for n, d in data.items()
                              if isinstance(d, dict)]
            except Exception as e:
                res["npmError"] = str(e)[:200]
        return res

    def tool(name, cmd, rx):
        exe = _exe(cmd[0])
        if not exe:
            return None
        try:
            r = subprocess.run([exe, *cmd[1:]], capture_output=True, timeout=15, creationflags=NO_WINDOW)
            txt = r.stdout.decode("utf-16-le" if b"\x00" in r.stdout else "utf-8", "replace")
            m = re.search(rx, txt)
            return (name, m.group(1)) if m else None
        except Exception:
            return None
    specs = (("Git", ["git", "--version"], r"(\d+\.\d+\.\d+(?:\.windows\.\d+)?)"),
             ("PowerShell 7", ["pwsh", "--version"], r"(\d+\.\d+\.\d+)"),
             ("WSL", ["wsl", "--version"], r"(\d+\.\d+\.\d+(?:\.\d+)?)"),
             ("uv", ["uv", "--version"], r"(\d+\.\d+\.\d+)"))
    job.progress(.4, tr("Asking npm…"))
    res = gather(pip, npm_scan, *[(lambda sp=sp: tool(*sp)) for sp in specs])
    job.check()
    out.update(res[0])
    out.update(res[1])
    job.progress(.85, tr("Checking the other tools…"))
    for found in res[2:]:
        if found:
            if found[0] == "Git":
                out["git"] = found[1]
            else:
                out["tools"].append(list(found))
    return out


# ---------------------------------------------------------------- install (changes the system: only from the UI)
_SIZE = {"KB": 1 / 1024, "MB": 1, "GB": 1024}
_SIZES_RE = re.compile(r"([\d.,]+)\s*(KB|MB|GB)\s*/\s*([\d.,]+)\s*(KB|MB|GB)")


def _number(t):
    """"1.50", "1,5", "1,234.5" or "1.234,5" (winget writes numbers the Windows way); None when it isn't one."""
    if "," in t and "." in t:  # the later one is the decimal point
        t = t.replace(",", "") if t.rfind(".") > t.rfind(",") else t.replace(".", "").replace(",", ".")
    try:
        return float(t.replace(",", "."))
    except ValueError:
        return None


def download_sizes(line):
    """(downloaded, total) in MB from a winget progress line ("12.5 MB / 80.0 MB"), or None. A number it can't read
    is no progress, never an error: an error here ended the reading of winget's output halfway while winget, and
    the installer it started, went on unseen."""
    m = _SIZES_RE.search(line or "")
    if not m:
        return None
    got, tot = _number(m.group(1)), _number(m.group(3))
    if got is None or tot is None:
        return None
    return got * _SIZE[m.group(2)], tot * _SIZE[m.group(4)]


def _winget_upgrade(job, it, report):
    exe = _exe("winget")
    cmd = [exe, "upgrade", "--id", it["wid"], "--exact", "--silent", "--accept-package-agreements",
           "--accept-source-agreements", "--disable-interactivity"]
    if (it.get("source") or "").lower() == "msstore":
        cmd += ["--source", "msstore"]
    if it.get("force"):
        cmd += ["--force"]
    state = {"phase": "down", "p": 0.0, "mb": None}

    def on_text(s):
        m = download_sizes(s)
        if m:
            got, tot = m
            state["mb"] = tot
            state["p"] = got / tot if tot else 0
            report("down", state["p"], mb=tot)
            return
        m = re.search(r"(\d{1,3})\s*%", s)
        if m and state["phase"] == "down":
            state["p"] = int(m.group(1)) / 100
            report("down", state["p"], mb=state["mb"])
            return
        low = s.lower()
        # progress words in English, Spanish and Russian (winget follows the Windows language)
        if any(w in low for w in ("starting package install", "iniciando la instalación", "installing", "instalando",
                                  "запуск установки пакета")):
            state["phase"] = "inst"
            report("inst", 1, mb=state["mb"])
        job.log(s)
    code, out = _stream(cmd, on_text, job=job, timeout=3600)
    if job.cancelled:
        return "cancel", tr("Cancelled")
    # success text in English and Spanish
    if code == 0 or re.search(r"Successfully installed|Instalado correctamente|se instaló correctamente", out, re.I):
        return "done", None
    hexc = f"0x{code & 0xFFFFFFFF:08X}" if code is not None else "?"
    if hexc in WINGET_REBOOT_OK:
        return "done", tr("Installed. Restart the PC to finish."), True
    tail = [ln for ln in out.splitlines() if ln.strip()][-1:] or [""]
    if hexc in WINGET_CODES:
        return "fail", tr(WINGET_CODES[hexc])
    return "fail", tr("The installer returned {code}.", code=hexc) + (" " + tail[0][:120] if tail[0].strip() else "")


# winget return codes, from the official table (English keys; translated with tr() where they are shown):
# https://github.com/microsoft/winget-cli/blob/master/doc/windows/package-manager/winget/returnCodes.md
WINGET_REBOOT_OK = {"0x8A150109", "0x8A15010B"}  # installed, a restart finishes it / Windows will restart
WINGET_CODES = {
    "0x8A150010": "No installer fits this PC (architecture or Windows version).",
    "0x8A150011": "The downloaded installer didn't match its expected hash, so it wasn't run.",
    "0x8A150014": "winget can't find this package anymore.",
    "0x8A15002B": "There's no newer version to install anymore.",
    "0x8A15004F": "The available version isn't newer than the installed one.",
    "0x8A150056": "This installer refuses to run as administrator. Open StellarHub in normal mode to update it.",
    "0x8A150061": "This version is already installed.",
    "0x8A150077": "The sign-in was cancelled.",
    "0x8A150101": "The program is open: close it and try again.",
    "0x8A150102": "Another installation is running. Try again when it finishes.",
    "0x8A150103": "Some of its files are in use: close the program and try again.",
    "0x8A150104": "It needs a component that's missing on this PC.",
    "0x8A150105": "There isn't enough free disk space.",
    "0x8A150106": "There isn't enough free memory: close some apps and try again.",
    "0x8A150107": "It needs an internet connection.",
    "0x8A150108": "The installer failed. The publisher's support may help.",
    "0x8A15010A": "Restart the PC, then try again.",
    "0x8A15010C": "The installation was cancelled.",
    "0x8A15010D": "Another version of this app is already installed.",
    "0x8A15010E": "A newer version is already installed.",
    "0x80073D02": "The app is open: close it and try again.",
}


_WU_INSTALL = r"""
$ids = @('%s')
$s=New-Object -ComObject Microsoft.Update.Session; $se=$s.CreateUpdateSearcher()
$r=$se.Search("IsInstalled=0 and Type='Software'")
$col=New-Object -ComObject Microsoft.Update.UpdateColl
foreach($u in $r.Updates){ if($ids -contains $u.Identity.UpdateID){ if(-not $u.EulaAccepted){$u.AcceptEula()}; [void]$col.Add($u) } }
if($col.Count -eq 0){ Write-Output 'RESULT|none'; exit }
$dl=$s.CreateUpdateDownloader(); $dl.Updates=$col; Write-Output 'PHASE|down'; [void]$dl.Download()
Write-Output 'PHASE|inst'; $in=$s.CreateUpdateInstaller(); $in.Updates=$col; $res=$in.Install()
Write-Output ("RESULT|{0}|{1}" -f $res.ResultCode, [int]$res.RebootRequired)
"""


def _wu_install(job, it, report):
    if not _admin():
        return "admin", tr("Needs admin mode")
    script = _WU_INSTALL % it["uid"].replace("'", "")
    res = {"st": "fail", "msg": tr("Windows Update didn't respond.")}

    def on_text(s):
        if s.startswith("PHASE|"):
            report("down" if s.endswith("down") else "inst", 0.5 if s.endswith("down") else 1)
        elif s.startswith("RESULT|"):
            parts = s.split("|")
            if parts[1] == "none":
                res.update(st="fail", msg=tr("It's no longer available."))
            else:
                ok = parts[1] in ("2", "3")
                res.update(st="done" if ok else "fail", msg=None if ok else tr("Windows Update returned code {code}.", code=parts[1]),
                           reboot=len(parts) > 2 and parts[2] == "1")
        else:
            job.log(s)
    _stream(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
            on_text, job=job, timeout=7200)
    if job.cancelled:
        return "cancel", tr("Cancelled")
    return res["st"], res.get("msg"), res.get("reboot")


def _pkg_install(job, it, report):
    if it["kind"] == "pip":
        cmd = [_python(), "-m", "pip", "install", "-U", "--disable-pip-version-check", *it["pkgs"]]
    else:
        cmd = [_exe("npm"), "install", "-g", *[p + "@latest" for p in it["pkgs"]]]
    report("inst", 0.3)
    code, out = _stream(cmd, job.log, job=job, timeout=3600)
    if job.cancelled:
        return "cancel", tr("Cancelled")
    return ("done", None) if code == 0 else ("fail", ([ln for ln in out.splitlines() if ln.strip()] or [tr("Failed")])[-1][:160])


def _defender_update(job, it, report):
    report("down", .3)
    code, out = _stream(["powershell.exe", "-NoProfile", "-Command", "Update-MpSignature -ErrorAction Stop; 'ok'"],
                        job.log, job=job, timeout=900)
    if job.cancelled:
        return "cancel", tr("Cancelled")
    # the 'ok' line, not "ok" anywhere: PowerShell's error text has it too ("Invoke", "token"...)
    ok = code == 0 and any(ln.strip() == "ok" for ln in (out or "").splitlines())
    return ("done", None) if ok else ("fail", tr("Defender isn't active or couldn't be updated."))


def install(job, items):
    """Installs as a queue. items: [{kind: winget|wu|pip|npm|defender, ...}]. Progress: data.items[i] = {st, p, mb, msg}."""
    states = [{"st": "queued", "p": 0, "mb": it.get("mb"), "msg": None} for it in items]
    job.data["items"] = states
    reboot = False
    for i, it in enumerate(items):
        if job.cancelled:
            for s in states[i:]:
                s["st"] = "cancel"
            break
        cur = states[i]

        def report(phase, p, mb=None, cur=cur, i=i):
            cur["st"], cur["p"] = phase, max(0, min(1, p))
            if mb:
                cur["mb"] = mb
            done = sum(1 for s in states if s["st"] in ("done", "fail", "admin", "cancel"))
            job.progress((done + (cur["p"] * .8 if phase == "down" else .9)) / len(states), it.get("name", ""), cur=i, items=states)
        report("down", 0)
        try:
            k = it.get("kind")
            r = (_winget_upgrade if k == "winget" else _wu_install if k == "wu" else _defender_update if k == "defender"
                 else _pkg_install)(job, it, report)
        except Exception as e:
            r = ("fail", str(e)[:160])
        cur["st"], cur["msg"] = r[0], r[1]
        if len(r) > 2 and r[2]:
            reboot = True
        if cur["st"] == "done":
            cur["p"] = 1
        job.progress(sum(1 for s in states if s["st"] in ("done", "fail", "admin", "cancel")) / len(states),
                     it.get("name", ""), force=True, cur=i, items=states)
    return {"items": states, "reboot": reboot}


def status():
    return {"admin": _admin(), "winget": bool(_exe("winget"))}
