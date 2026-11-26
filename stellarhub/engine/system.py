"""Real PC information: model, type, components, displays and the Home figures.
pc_info() answers instantly with what was saved last time and refreshes in the background.

Languages: the saved copy (pcinfo.json) is language-neutral. Sentences are stored in English, and the ones built from
data as {"tr": "English {x}", "kw": {...}}; _localize() translates them each time the UI asks, so changing the
language never needs a new measurement. Row labels (rows[i][0]) stay in English on purpose: the interface looks rows
up by them and translates them where it shows them (they are marked with N_ so they reach the dictionaries)."""
import ctypes
import json
import os
import re
import threading
import time
import winreg
from ctypes import wintypes

import psutil

from ..i18n import tc, tr
from . import wmi
from . import fakepc
from .ps import ps_json, gather

EXPORTS = {"pc_info", "pc_info_fresh", "displays", "screen_thumb", "counts", "health"}


def health():
    """Real summary for Home: antivirus, devices with errors and the latest restore point. Asked to WMI inside this
    process; the PowerShell script below only runs if WMI (System.Management through pythonnet) is not available."""
    if fakepc.active():
        return fakepc.health()
    try:
        return _health_wmi()
    except Exception as e:
        print("[health] WMI failed, using PowerShell:", e, flush=True)
    return _health_ps()


def _health_wmi():
    def rows(ns, cls, props=None, where=None):
        try:
            return wmi.query(ns, cls, props, where)
        except wmi.WmiError:
            return None  # the PowerShell version used -ErrorAction SilentlyContinue: a missing class is "no data"
    mp = rows(r"root\Microsoft\Windows\Defender", "MSFT_MpComputerStatus", ["RealTimeProtectionEnabled", "AntivirusSignatureAge"])
    mp = mp[0] if mp else None
    av = rows(r"root\SecurityCenter2", "AntiVirusProduct", ["displayName"]) or []
    err = [e for e in (rows(r"root\cimv2", "Win32_PnPEntity", ["Name", "ConfigManagerErrorCode"], "ConfigManagerErrorCode<>0") or [])
           if e["ConfigManagerErrorCode"] != 22]
    restore = None
    try:  # Get-ComputerRestorePoint: needs administrator rights (access denied otherwise: no restore point is reported)
        pts = wmi.query(r"root\default", "SystemRestore", ["SequenceNumber", "CreationTime"])
        if pts:
            when = wmi.cim_datetime(max(pts, key=lambda x: x["SequenceNumber"])["CreationTime"])
            if when:
                restore = when.strftime("%Y-%m-%dT%H:%M:%S.") + f"{when.microsecond * 10:07d}"  # like .ToString('o')
    except wmi.WmiError:
        pass
    return {"defender": bool(mp["RealTimeProtectionEnabled"]) if mp else None,
            "sigAge": mp["AntivirusSignatureAge"] if mp else None,
            "antivirus": [a["displayName"] for a in av], "deviceErrors": len(err),
            "errorNames": [e["Name"] for e in err[:5]], "restore": restore,
            "restoreAccess": bool(ctypes.windll.shell32.IsUserAnAdmin())}


def _health_ps():
    r = ps_json(r"""
$mp = Get-CimInstance -Namespace root/Microsoft/Windows/Defender -ClassName MSFT_MpComputerStatus -ErrorAction SilentlyContinue
$err = @(Get-CimInstance Win32_PnPEntity -Filter 'ConfigManagerErrorCode<>0' -ErrorAction SilentlyContinue | Where-Object { $_.ConfigManagerErrorCode -ne 22 })
$rp = $null; try { $rp = Get-ComputerRestorePoint -ErrorAction Stop | Sort-Object SequenceNumber | Select-Object -Last 1 } catch {}
$av = @(Get-CimInstance -Namespace root\SecurityCenter2 AntiVirusProduct -ErrorAction SilentlyContinue | ForEach-Object { $_.displayName })
[pscustomobject]@{
  defender = if ($mp) { [bool]$mp.RealTimeProtectionEnabled } else { $null }
  sigAge = if ($mp) { $mp.AntivirusSignatureAge } else { $null }
  antivirus = $av
  deviceErrors = $err.Count
  errorNames = @($err | Select-Object -First 5 | ForEach-Object { $_.Name })
  restore = if ($rp) { $rp.ConvertToDateTime($rp.CreationTime).ToString('o') } else { $null }
  restoreAccess = [bool]([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}""", timeout=40) or {}
    return r

CACHE_VERSION = 6  # bump when labels or fields change, so an old cache is not shown
_CACHE = os.path.join(os.environ.get("ProgramData", r"C:\ProgramData"), "StellarHub", "pcinfo.json")
_lock = threading.Lock()
_mem = None

CHASSIS = {  # Win32_SystemEnclosure.ChassisTypes
    3: ("desktop", "Desktop"), 4: ("desktop", "Desktop"), 5: ("desktop", "Desktop"),
    6: ("desktop", "Mini tower"), 7: ("desktop", "Tower"), 8: ("laptop", "Laptop"), 9: ("laptop", "Laptop"),
    10: ("laptop", "Laptop"), 11: ("handheld", "Handheld"), 13: ("aio", "All-in-one"), 14: ("laptop", "Laptop"),
    15: ("desktop", "Compact PC"), 16: ("mini", "Mini PC"), 30: ("tablet", "Tablet"), 31: ("laptop", "Convertible"),
    32: ("tablet", "Detachable"), 34: ("desktop", "Embedded PC"), 35: ("mini", "Mini PC"), 36: ("mini", "Stick PC"),
}
_CLAMSHELL = {8, 9, 10, 14, 31}  # portable, laptop, notebook, sub-notebook, convertible: a keyboard under the screen

# What a PC is, beyond the chassis code. Windows' chassis code alone is not enough: an ROG Ally reports "Tablet", other
# handhelds "Desktop", "Notebook" or "Detachable". So the names the makers write in the firmware come first
# (Win32_ComputerSystem Manufacturer / Model / SystemFamily / SystemSKUNumber and Win32_BaseBoard Product, the same
# strings Linux shows as sys_vendor / product_name / product_family / product_sku / board_name). Sources: the Linux
# kernel's DMI tables (drm_panel_orientation_quirks.c), Handheld Companion's device list and dmidecode dumps.
# Each rule: (manufacturer pattern or None, pattern over "model | family | sku | board", all lower case).
_HANDHELD = [
    (r"asus", r"\brog (xbox )?ally\b|(^|\| )rc7[1-4][a-z]*\b"),          # ROG Ally RC71L, Ally X RC72LA, Xbox Ally RC73YA/XA
    (r"lenovo", r"\blegion go\b|^(83e1|83n0|83n1|83l3|83n6|83q2|83q3)\b"),  # Legion Go 8APU1 (83E1), Go S (83L3...), Go 2 (83N0/1)
    (r"micro-star|\bmsi\b", r"\bclaw\b|\bms-1t(41|42|52|8k|91)\b"),     # Claw A1M, Claw 7/8 AI+ A2VM, Claw A8 BZ2EM
    (r"valve", r"^(jupiter|galileo)\b"),                                   # Steam Deck LCD / OLED
    (r"zotac|pc partner", r"\bgaming zone\b|\bg0a1w\b"),                    # ZOTAC GAMING ZONE
    (r"one-netbook|onexplayer", r"x ?player|onexfly"),                     # ONEXPLAYER 2 / mini / X1 / F1 (OneXFly)
    (r"^gpd\b", r"^(g16(17|18|19)-|win ?\d|win ?(max|mini))"),            # Win Mini G1617, Win 3/4/5 G1618, Win Max G1619 (not Pocket)
    (r"^aokzoe\b", r""),                                                   # AOKZOE A1 / A1 Pro / A2
    (r"^ayn\b", r"\bloki\b"),                                              # Ayn Loki Max / Zero / MiniPro
    (r"anbernic", r"\bwin ?600\b"),
    (r"orangepi", r"^neo-01\b"),
    (r"mysten", r"\bsuiplay"),
    (None, r"\bsteam deck\b|\bnitro blaze\b"),
]
_AYANEO = r"^aya ?neo\b|^ayadevice\b|^aya\b"   # every AYANEO is a handheld except the mini PCs (AM01, AM02, Retro Mini PC)
_AYANEO_MINI = r"\bam\d\d\b|mini ?pc|\bag01\b"
_HANDHELD_CPU = r"\bryzen(\(tm\))? z\d\b|\bcustom apu 0(405|932)\b"   # Ryzen Z1 / Z2 only ship in handhelds; Steam Deck APUs
_TABLET = r"\bsurface (pro|go)\b|\bflow z13\b|\bgz30\d|\btablet\b|\bmiix\b|\bduet\b|\bdetachable\b|\bgalaxy book ?10\.6|(^|\| )hppac\b"
_AIO = r"\baio\b|all[- ]in[- ]one|\bimac\d|\bimac\b|\beliteone\b|\bproone\b|\bsurface studio\b|\bthinkcentre (m\d+a|neo \d+a)\b|\baspire c\d\d\b"
_MINI = (r"\bnuc(\d|\b)|\bmac ?mini|\bmacmini\d|\bthinkcentre (m\d+q|neo \d+q)\b|\btiny\b|\boptiplex\b.*\bmicro\b|\b(elitedesk|prodesk)\b.*\bmini\b"
         r"|\bmini ?pc\b|\bzbox\b|\bbrix\b|\bexpertcenter pn\d|\bdeskmini\b|\blarkbox\b")
_MINI_MAKERS = r"^(beelink|azw|gmktec|geekom|trigkey|acemagic|ace magician|peladn|firebat|bmax|t-bao|meegopad|micro computer \(hk\))"
_TABLET_CPU = r"\batom\b|\bceleron\b.* n\d{4}|\bpentium\b.* n\d{4}"   # old 8" Atom tablets are tablets, not handhelds
SMALL_SCREEN = 9   # inches (rounded): a built-in screen this small with a battery is a handheld's (7" to 8.8")


def classify(r, battery=False, inches=None):
    """(type, typeName) of the PC from the raw query `r`: 'handheld', 'tablet', 'aio', 'mini', 'laptop', 'desktop' or
    'virtual'. `battery`: the PC has one; `inches`: its built-in screen's size (None when it has none or it is unknown).
    Order: the makers' own names (exact models) first, then the processor, then the chassis code and the screen."""
    def low(k):
        return _text(r.get(k)).strip().lower()
    makers = [m for m in (low("maker"), low("boardMaker")) if m and not _placeholder(m)]
    hay = " | ".join(x for x in (low("model"), low("family"), low("sku"), low("board")) if x and not _placeholder(x))

    def has(p):
        return bool(re.search(p, hay))

    def made_by(p):
        return any(re.search(p, m) for m in makers)
    if _virtual(r.get("maker") or "", r.get("model") or ""):
        return "virtual", "Virtual machine"
    if made_by(_AYANEO):
        return ("mini", "Mini PC") if has(_AYANEO_MINI) else ("handheld", "Handheld")
    if made_by(r"valve") and has(r"^fremont\b"):
        return "mini", "Mini PC"   # Valve's Steam Machine: a small cube
    for mk, pat in _HANDHELD:
        if (mk is None or made_by(mk)) and (not pat or has(pat)):
            return "handheld", "Handheld"
    chassis = [c for c in (r.get("chassis") or []) if isinstance(c, int)]
    ch = chassis[0] if chassis else 0
    cpu = _text((r.get("cpu") or {}).get("name")).lower()
    if battery and re.search(_HANDHELD_CPU, cpu):
        return "handheld", "Handheld"
    if battery and has(_TABLET):
        return "tablet", "Detachable" if ch == 32 else "Tablet"
    if not battery and has(_AIO):
        return "aio", "All-in-one"
    if not battery and (has(_MINI) or made_by(_MINI_MAKERS)):
        return "mini", "Stick PC" if ch == 36 else "Mini PC"
    if ch == 11:
        return "handheld", "Handheld"
    # a handheld nobody listed yet: a battery and a small built-in screen, without a laptop's chassis code
    if battery and inches and inches <= SMALL_SCREEN and ch not in _CLAMSHELL and not re.search(_TABLET_CPU, cpu):
        return "handheld", "Handheld"
    if ch in CHASSIS:
        t = CHASSIS[ch]
        if t[0] == "mini" and battery:
            return "laptop", "Laptop"   # a "Mini PC" code on a PC with a battery: some small laptops report it
        return t
    if r.get("pcTypeEx") == 8 and battery:  # Win32_ComputerSystem.PCSystemTypeEx 8: Slate
        return "tablet", "Tablet"
    return ("laptop", "Laptop") if r.get("pcType") == 2 else ("desktop", "Desktop")
PNP_VENDORS = {
    "AUO": "AU Optronics", "BOE": "BOE", "CMN": "Chimei Innolux", "SDC": "Samsung Display", "LGD": "LG Display",
    "SHP": "Sharp", "IVO": "InfoVision", "CSO": "CSOT", "MNG": "CSOT", "NCP": "Nanjing CEC", "AOC": "AOC", "DEL": "Dell",
    "SAM": "Samsung", "SEC": "Samsung", "GSM": "LG", "ACR": "Acer", "ACI": "ASUS", "AUS": "ASUS", "BNQ": "BenQ",
    "HWP": "HP", "HPN": "HP", "LEN": "Lenovo", "MSI": "MSI", "VSC": "ViewSonic", "PHL": "Philips", "GBT": "Gigabyte",
    "AOU": "AOC", "HKC": "HKC", "CSW": "CSOT", "KOS": "KOORUI", "XMI": "Xiaomi", "HSD": "HannStar", "ENC": "Eizo", "NEC": "NEC",
}
GB = 1024 ** 3


def N_(text):
    """Marks a row label for the dictionaries; it stays in English here and is translated where it is shown."""
    return text


def _T(text, ctx=None, **kw):
    """A sentence to translate when the info is sent to the UI (see _localize); ctx as in i18n.tc."""
    d = {"tr": text}
    if ctx:
        d["ctx"] = ctx
    if kw:
        d["kw"] = kw
    return d


def _numfmt(v):
    """A number the engine measured, written with the interface language's decimal separator."""
    from ..i18n import language
    txt = f"{v['num']:.{v.get('d', 1)}f}"
    return txt.replace(".", ",") if language() in ("es", "pt", "it", "fr", "ru") else txt


def _tv(x):
    if isinstance(x, dict) and "tr" in x:
        kw = {k: _numfmt(v) if isinstance(v, dict) and "num" in v else v for k, v in (x.get("kw") or {}).items()}
        return tc(x["ctx"], x["tr"], **kw) if x.get("ctx") else tr(x["tr"], **kw)
    return x


def _localize(info):
    """A copy of the info with its texts in the interface language (the saved copy stays neutral)."""
    if not info:
        return info
    out = dict(info)
    out["model"] = _tv(info.get("model"))
    out["typeName"] = tr(info["typeName"]) if info.get("typeName") else info.get("typeName")
    comps = []
    for c in info.get("components") or []:
        c = dict(c)
        c["name"] = tr(c["name"]) if c.get("name") else c.get("name")
        c["title"] = _tv(c.get("title"))
        c["rows"] = [[r[0], _tv(r[1])] for r in c.get("rows") or []]
        comps.append(c)
    out["components"] = comps
    return out


_PLACEHOLDERS = {"", "system product name", "system manufacturer", "system version", "to be filled by o.e.m.",
                 "to be filled by oem", "o.e.m.", "oem", "default string", "not applicable", "not specified", "none",
                 "invalid", "all series", "base board product name", "base board manufacturer", "x.x", "unknown"}


def _placeholder(s):
    """A BIOS default instead of a real name."""
    return (s or "").strip().lower() in _PLACEHOLDERS


def _virtual(maker, model):
    s = f"{maker} {model}".lower()
    for k in ("virtualbox", "vmware", "virtual machine", "qemu", "kvm", "parallels", "hyper-v", "xen"):
        if k in s:
            return True
    return False


SCRIPT = r"""
$cs = Get-CimInstance Win32_ComputerSystem; $en = Get-CimInstance Win32_SystemEnclosure; $os = Get-CimInstance Win32_OperatingSystem
$bb = Get-CimInstance Win32_BaseBoard | Select-Object -First 1
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1; $bios = Get-CimInstance Win32_BIOS
$disp = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion')
$mons = @(Get-CimInstance -Namespace root\wmi WmiMonitorID -ErrorAction SilentlyContinue | ForEach-Object {
  $n = ($_.UserFriendlyName | Where-Object {$_}) ; $m = ($_.ManufacturerName | Where-Object {$_}); $c = ($_.ProductCodeID | Where-Object {$_})
  [pscustomobject]@{ inst=$_.InstanceName; name=(-join ($n | ForEach-Object {[char]$_})); maker=(-join ($m | ForEach-Object {[char]$_})); code=(-join ($c | ForEach-Object {[char]$_})) } })
$sizes = @(Get-CimInstance -Namespace root\wmi WmiMonitorBasicDisplayParams -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ inst=$_.InstanceName; w=$_.MaxHorizontalImageSize; h=$_.MaxVerticalImageSize } })
$conn = @(Get-CimInstance -Namespace root\wmi WmiMonitorConnectionParams -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ inst=$_.InstanceName; tech=$_.VideoOutputTechnology } })
[pscustomobject]@{
  maker=$cs.Manufacturer; model=$cs.Model; family=$cs.SystemFamily; sku=$cs.SystemSKUNumber; chassis=@($en.ChassisTypes); pcType=$cs.PCSystemType; pcTypeEx=$cs.PCSystemTypeEx
  os=$os.Caption; osVer=$disp.DisplayVersion; build=$os.BuildNumber; ubr=$disp.UBR; installDate=$os.InstallDate
  bios=$bios.SMBIOSBIOSVersion; biosDate=$bios.ReleaseDate; board=$bb.Product; boardMaker=$bb.Manufacturer
  cpu=[pscustomobject]@{ name="$($cpu.Name)".Trim(); cores=$cpu.NumberOfCores; threads=$cpu.NumberOfLogicalProcessors; maxMhz=$cpu.MaxClockSpeed; l2=$cpu.L2CacheSize; l3=$cpu.L3CacheSize; socket=$cpu.SocketDesignation }
  gpus=@(Get-CimInstance Win32_VideoController | ForEach-Object { [pscustomobject]@{ name=$_.Name; driver=$_.DriverVersion; driverDate=$_.DriverDate; ram=$_.AdapterRAM; w=$_.CurrentHorizontalResolution; h=$_.CurrentVerticalResolution; hz=$_.CurrentRefreshRate } })
  ram=@(Get-CimInstance Win32_PhysicalMemory | ForEach-Object { [pscustomobject]@{ cap=$_.Capacity; speed=$_.Speed; maker=$_.Manufacturer; part="$($_.PartNumber)".Trim(); slot=$_.DeviceLocator; type=$_.SMBIOSMemoryType } })
  slots=(Get-CimInstance Win32_PhysicalMemoryArray | Measure-Object -Property MemoryDevices -Sum).Sum
  disks=@(Get-PhysicalDisk | ForEach-Object { [pscustomobject]@{ id="$($_.DeviceId)"; name=$_.FriendlyName; media="$($_.MediaType)"; bus="$($_.BusType)"; size=$_.Size; health="$($_.HealthStatus)" } })
  audio=@(Get-CimInstance Win32_SoundDevice | Where-Object { $_.Status -eq 'OK' } | ForEach-Object { $_.Name })
  monitors=$mons; monSizes=$sizes; monConn=$conn
}
"""


# Loading the Storage and NetAdapter modules costs about a second each: they run in their own PowerShell at the same
# time as the main script instead of one after the other.
SCRIPT_SYSDISK = r"(Get-Partition -DriveLetter $env:SystemDrive[0] -ErrorAction SilentlyContinue | Select-Object -First 1).DiskNumber"
SCRIPT_NETS = r"""@(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up' | ForEach-Object { [pscustomobject]@{ name=$_.InterfaceDescription; speed=$_.LinkSpeed; media="$($_.PhysicalMediaType)" } })"""


# Windows' own names for the numbers WMI gives (what Get-PhysicalDisk and Get-NetAdapter print)
_MEDIA = {0: "Unspecified", 3: "HDD", 4: "SSD", 5: "SCM"}
_BUS = {0: "Unknown", 1: "SCSI", 2: "ATAPI", 3: "ATA", 4: "1394", 5: "SSA", 6: "Fibre Channel", 7: "USB", 8: "RAID", 9: "iSCSI",
        10: "SAS", 11: "SATA", 12: "SD", 13: "MMC", 14: "Virtual", 15: "File Backed Virtual", 16: "Spaces", 17: "NVMe",
        18: "SCM", 19: "UFS"}
_HEALTH = {0: "Healthy", 1: "Warning", 2: "Unhealthy", 5: "Unknown"}
_PHYS = {0: "Unspecified", 1: "Wireless LAN", 2: "Cable Modem", 3: "Phone Line", 4: "Power Line", 5: "DSL", 6: "Fibre Channel",
         7: "1394", 8: "Wireless WAN", 9: "Native 802.11", 10: "Bluetooth", 11: "Infiniband", 12: "WiMax", 13: "UWB",
         14: "802.3", 15: "802.5", 16: "Infiniband over Ethernet", 17: "Native Wireless WAN", 18: "Native 802.15.4"}


def _link_speed(bps):
    """Get-NetAdapter's LinkSpeed text: 1201000000 -> "1.2 Gbps", 100000000 -> "100 Mbps", 0 -> "0 bps"."""
    bps = int(bps or 0)
    for unit, name in ((10 ** 9, "Gbps"), (10 ** 6, "Mbps"), (10 ** 3, "Kbps")):
        if bps >= unit:
            return f"{round(bps / unit, 1):g} {name}"
    return f"{bps} bps"


def _text(v):
    return "" if v is None else str(v)


def _query_wmi():
    """What the PowerShell scripts below return, as dicts, from WMI queries inside this process (no powershell.exe)."""
    def q(cls, props, where=None, ns=r"root\cimv2"):
        return wmi.query(ns, cls, props, where)

    def soft(cls, props, ns):  # the PowerShell version used -ErrorAction SilentlyContinue for these
        try:
            return wmi.query(ns, cls, props)
        except wmi.WmiError:
            return []
    cs = q("Win32_ComputerSystem", ["Manufacturer", "Model", "SystemFamily", "PCSystemType"])[0]
    cs_ex = (soft("Win32_ComputerSystem", ["SystemSKUNumber", "PCSystemTypeEx"], r"root\cimv2") or [{}])[0]  # Windows 8+
    en = (q("Win32_SystemEnclosure", ["ChassisTypes"]) or [{}])[0]
    os_ = q("Win32_OperatingSystem", ["Caption", "BuildNumber", "InstallDate"])[0]
    bb = (q("Win32_BaseBoard", ["Product", "Manufacturer"]) or [{}])[0]
    cpu = (q("Win32_Processor", ["Name", "NumberOfCores", "NumberOfLogicalProcessors", "MaxClockSpeed", "L2CacheSize",
                                  "L3CacheSize", "SocketDesignation"]) or [{}])[0]
    bios = (q("Win32_BIOS", ["SMBIOSBIOSVersion", "ReleaseDate"]) or [{}])[0]
    disp = ubr = None
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion") as k:
            for name in ("DisplayVersion", "UBR"):
                try:
                    v = winreg.QueryValueEx(k, name)[0]
                except OSError:
                    v = None
                if name == "UBR":
                    ubr = v
                else:
                    disp = v
    except OSError:
        pass
    WMI_NS = r"root\wmi"
    mid = soft("WmiMonitorID", ["InstanceName", "UserFriendlyName", "ManufacturerName", "ProductCodeID"], WMI_NS)

    def chars(codes):  # the EDID strings are arrays of character codes, padded with zeros
        return "".join(chr(c) for c in (codes or []) if c)
    mons = [{"inst": m["InstanceName"], "name": chars(m["UserFriendlyName"]), "maker": chars(m["ManufacturerName"]),
             "code": chars(m["ProductCodeID"])} for m in mid]
    sizes = [{"inst": m["InstanceName"], "w": m["MaxHorizontalImageSize"], "h": m["MaxVerticalImageSize"]}
             for m in soft("WmiMonitorBasicDisplayParams", ["InstanceName", "MaxHorizontalImageSize", "MaxVerticalImageSize"], WMI_NS)]
    conn = [{"inst": m["InstanceName"], "tech": m["VideoOutputTechnology"]}
            for m in soft("WmiMonitorConnectionParams", ["InstanceName", "VideoOutputTechnology"], WMI_NS)]
    arrays = [a["MemoryDevices"] for a in q("Win32_PhysicalMemoryArray", ["MemoryDevices"]) if a["MemoryDevices"] is not None]
    pd = wmi.query(r"root\Microsoft\Windows\Storage", "MSFT_PhysicalDisk",
                   ["DeviceId", "FriendlyName", "MediaType", "BusType", "Size", "HealthStatus"])
    disks = [{"id": _text(d["DeviceId"]), "name": d["FriendlyName"], "media": _MEDIA.get(d["MediaType"], _text(d["MediaType"])),
              "bus": _BUS.get(d["BusType"], _text(d["BusType"])), "size": d["Size"],
              "health": _HEALTH.get(d["HealthStatus"], _text(d["HealthStatus"]))}
             for d in sorted(pd, key=lambda d: int(d["DeviceId"]) if str(d["DeviceId"]).isdigit() else 0)]
    return {"maker": cs["Manufacturer"], "model": cs["Model"], "family": cs["SystemFamily"],
            "chassis": list(en.get("ChassisTypes") or []), "pcType": cs["PCSystemType"], "sku": cs_ex.get("SystemSKUNumber"),
            "pcTypeEx": cs_ex.get("PCSystemTypeEx"), "os": os_["Caption"], "osVer": disp,
            "build": os_["BuildNumber"], "ubr": ubr, "installDate": os_["InstallDate"], "bios": bios.get("SMBIOSBIOSVersion"),
            "biosDate": bios.get("ReleaseDate"), "board": bb.get("Product"), "boardMaker": bb.get("Manufacturer"),
            "cpu": {"name": _text(cpu.get("Name")).strip(), "cores": cpu.get("NumberOfCores"),
                    "threads": cpu.get("NumberOfLogicalProcessors"), "maxMhz": cpu.get("MaxClockSpeed"),
                    "l2": cpu.get("L2CacheSize"), "l3": cpu.get("L3CacheSize"), "socket": cpu.get("SocketDesignation")},
            "gpus": [{"name": g["Name"], "driver": g["DriverVersion"], "driverDate": g["DriverDate"], "ram": g["AdapterRAM"],
                      "w": g["CurrentHorizontalResolution"], "h": g["CurrentVerticalResolution"], "hz": g["CurrentRefreshRate"]}
                     for g in q("Win32_VideoController", ["Name", "DriverVersion", "DriverDate", "AdapterRAM",
                                                          "CurrentHorizontalResolution", "CurrentVerticalResolution",
                                                          "CurrentRefreshRate"])],
            "ram": [{"cap": m["Capacity"], "speed": m["Speed"], "maker": m["Manufacturer"], "part": _text(m["PartNumber"]).strip(),
                     "slot": m["DeviceLocator"], "type": m["SMBIOSMemoryType"]}
                    for m in q("Win32_PhysicalMemory", ["Capacity", "Speed", "Manufacturer", "PartNumber", "DeviceLocator",
                                                        "SMBIOSMemoryType"])],
            "slots": sum(arrays) if arrays else None, "disks": disks,
            "audio": [a["Name"] for a in q("Win32_SoundDevice", ["Name", "Status"]) if a["Status"] == "OK"],
            "monitors": mons, "monSizes": sizes, "monConn": conn}


def _sysdisk_wmi():
    """The disk number of the partition that holds the system drive (Get-Partition -DriveLetter C)."""
    letter = os.environ.get("SystemDrive", "C:")[0].upper()
    rows = wmi.query(r"root\Microsoft\Windows\Storage", "MSFT_Partition", ["DiskNumber"], f"DriveLetter = {ord(letter)}")
    return rows[0]["DiskNumber"] if rows else None


def _nets_wmi():
    """Physical network adapters that are connected (Get-NetAdapter -Physical, Status Up)."""
    rows = wmi.query(r"root\StandardCimv2", "MSFT_NetAdapter",
                     ["InterfaceDescription", "InterfaceIndex", "InterfaceOperationalStatus", "MediaConnectState",
                      "HardwareInterface", "ReceiveLinkSpeed", "TransmitLinkSpeed", "NdisPhysicalMedium"])
    up = [r for r in rows if r["HardwareInterface"] and r["InterfaceOperationalStatus"] == 1 and r["MediaConnectState"] == 1]
    return [{"name": r["InterfaceDescription"], "speed": _link_speed(max(r["ReceiveLinkSpeed"] or 0, r["TransmitLinkSpeed"] or 0)),
             "media": _PHYS.get(r["NdisPhysicalMedium"], _text(r["NdisPhysicalMedium"]))}
            for r in sorted(up, key=lambda r: r["InterfaceIndex"])]


def _query():
    """The same data the old single script returned. From WMI inside this process; if that is not available, from three
    PowerShell processes running at once (as before)."""
    try:
        r = _query_wmi()
        r["sysDisk"], r["nets"] = _sysdisk_wmi(), _nets_wmi()
        return r
    except Exception as e:
        print("[pc_info] WMI failed, using PowerShell:", e, flush=True)
    return _query_ps()


def _query_ps():
    def safe(fn, default):
        try:
            return fn()
        except Exception:
            return default
    r, disk, nets = gather(lambda: ps_json(SCRIPT, 90),
                           lambda: safe(lambda: ps_json(SCRIPT_SYSDISK, 60), None),
                           lambda: safe(lambda: ps_json(SCRIPT_NETS, 60, True), []))
    r = r or {}
    r["sysDisk"], r["nets"] = disk, nets
    return r


def _clean(s):
    return (s or "").replace("(R)", "").replace("(TM)", "").replace("(tm)", "").replace("  ", " ").strip()


def _gpu_vram(name):
    # AdapterRAM tops out at 4 GB because it is 32-bit: for NVIDIA, NVML is asked instead (in this process; it was a
    # run of nvidia-smi.exe)
    if "nvidia" in name.lower():
        try:
            from .telemetry import nvml_once
            return (nvml_once() or {}).get("vramTotal")
        except Exception:
            return None
    return None


def _programs_count():
    """The same count as the Program Remover's Programs tab: every Win32 entry it lists (not just the ones with a unique
    name) plus the Microsoft Store apps it knows about."""
    from .removal import programs as _pm, settings as _rs
    seen = set()
    try:
        for hive, view in _pm.SOURCES:
            for keyname in _pm.registry.subkeys(_pm.registry.HIVES[hive], _pm.UNINSTALL, view):
                p = _pm._read_entry(hive, view, keyname)
                if p:
                    seen.add((p["name"].lower(), p["version"].lower(), p["user"]))
    except Exception:
        pass
    n = len(seen)
    try:
        if _rs.load().get("show_store", True):
            n += len(_pm.cached_store_apps())
    except Exception:
        pass
    return n


def _drivers_count():
    # the Drivers inventory is the same query: one shared (and cached) measurement for both
    from . import drivers
    return len(drivers.list_drivers(max_age=600))


def _sys_drive_usage():
    """Space on the Windows drive (C: on almost every PC; a Windows installed on another letter may have no C: at all,
    and psutil then raised and Home had no PC sheet)."""
    for root in (os.environ.get("SystemDrive", "C:").rstrip("\\") + "\\", "C:\\"):
        try:
            return psutil.disk_usage(root)
        except OSError:
            continue
    import types
    return types.SimpleNamespace(total=0, used=0, free=0)


def counts():
    if fakepc.active():
        return fakepc.counts()
    du = _sys_drive_usage()
    return {"programs": _programs_count(), "drivers": _drivers_count(), "freeC": round(du.free / GB)}


def displays():
    """Connected displays with their real position (for screenshots) and refresh rate."""
    user32 = ctypes.windll.user32
    out = []

    class MONITORINFOEX(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT),
                    ("dwFlags", wintypes.DWORD), ("szDevice", wintypes.WCHAR * 32)]

    class DEVMODE(ctypes.Structure):
        _fields_ = [("dmDeviceName", wintypes.WCHAR * 32), ("dmSpecVersion", wintypes.WORD), ("dmDriverVersion", wintypes.WORD),
                    ("dmSize", wintypes.WORD), ("dmDriverExtra", wintypes.WORD), ("dmFields", wintypes.DWORD),
                    ("dmPositionX", ctypes.c_long), ("dmPositionY", ctypes.c_long), ("dmDisplayOrientation", wintypes.DWORD),
                    ("dmDisplayFixedOutput", wintypes.DWORD), ("dmColor", ctypes.c_short), ("dmDuplex", ctypes.c_short),
                    ("dmYResolution", ctypes.c_short), ("dmTTOption", ctypes.c_short), ("dmCollate", ctypes.c_short),
                    ("dmFormName", wintypes.WCHAR * 32), ("dmLogPixels", wintypes.WORD), ("dmBitsPerPel", wintypes.DWORD),
                    ("dmPelsWidth", wintypes.DWORD), ("dmPelsHeight", wintypes.DWORD), ("dmDisplayFlags", wintypes.DWORD),
                    ("dmDisplayFrequency", wintypes.DWORD)]

    def cb(hmon, hdc, rect, data):
        mi = MONITORINFOEX()
        mi.cbSize = ctypes.sizeof(mi)
        user32.GetMonitorInfoW(hmon, ctypes.byref(mi))
        dm = DEVMODE()
        dm.dmSize = ctypes.sizeof(dm)
        user32.EnumDisplaySettingsW(mi.szDevice, -1, ctypes.byref(dm))  # ENUM_CURRENT_SETTINGS
        r = mi.rcMonitor
        out.append({"device": mi.szDevice, "x": dm.dmPositionX, "y": dm.dmPositionY, "w": dm.dmPelsWidth, "h": dm.dmPelsHeight,
                    "hz": dm.dmDisplayFrequency, "primary": bool(mi.dwFlags & 1), "lw": r.right - r.left, "lh": r.bottom - r.top})
        return True
    proto = ctypes.WINFUNCTYPE(ctypes.c_int, wintypes.HMONITOR, wintypes.HDC, ctypes.POINTER(wintypes.RECT), wintypes.LPARAM)
    user32.EnumDisplayMonitors(None, None, proto(cb), 0)
    return out


def screen_thumb(index=0, width=480):
    """JPEG thumbnail (data URL) of what that display is showing right now."""
    import base64
    import io
    from PIL import ImageGrab
    mons = displays()
    if not mons:
        return None
    m = mons[max(0, min(int(index), len(mons) - 1))]
    img = ImageGrab.grab(bbox=(m["x"], m["y"], m["x"] + m["w"], m["y"] + m["h"]), all_screens=True)
    width = max(120, min(960, int(width)))
    img.thumbnail((width, width), resample=3)
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=70)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def _build():
    r = _query()
    maker, model = (r.get("maker") or "").strip(), (r.get("model") or "").strip()
    family = (r.get("family") or "").strip()
    # many desktop boards leave the BIOS defaults in the system name ("System Product Name", "To be filled by
    # O.E.M."): then the motherboard says what the PC is, e.g. "ASUS ROG STRIX Z790-E GAMING WIFI"
    board, board_maker = (r.get("board") or "").strip(), (r.get("boardMaker") or "").strip()
    if _placeholder(maker) and not _placeholder(board_maker):
        maker = board_maker
    if _placeholder(model):
        model = "" if _placeholder(board) else board
    if _placeholder(family):
        family = ""
    nice = family or model
    BRANDS = {"asustek": "ASUS", "asus": "ASUS", "asrock": "ASRock", "biostar": "Biostar", "evga": "EVGA", "nzxt": "NZXT",
              "intel": "Intel", "medion": "Medion", "fujitsu": "Fujitsu", "alienware": "Alienware", "framework": "Framework",
              "gigabyte technology": "Gigabyte","hewlett-packard": "HP", "hp": "HP", "lenovo": "Lenovo", "dell": "Dell", "acer": "Acer",
              "micro-star": "MSI", "msi": "MSI", "gigabyte": "Gigabyte", "samsung": "Samsung", "microsoft": "Microsoft",
              "apple": "Apple", "razer": "Razer", "huawei": "Huawei", "xiaomi": "Xiaomi", "lg": "LG", "toshiba": "Toshiba"}
    first = (maker.split() or [""])[0].lower().strip(",.")
    brand = BRANDS.get(first, maker.split()[0].title() if maker else "")
    if brand and nice and not nice.lower().startswith(brand.lower()):
        nice = f"{brand} {nice}"
    code = model.split("_")[-1] if "_" in model else (model if model != nice else "")
    osname = (r.get("os") or "Windows").replace("Microsoft ", "").strip()
    os_full = f"{osname} {r.get('osVer') or ''}".strip()
    cpu = r.get("cpu") or {}
    gpus = [g for g in (r.get("gpus") or []) if g.get("name")]
    from .telemetry import gpu_kind, gpu_rank
    real = [g for g in gpus if gpu_kind(g["name"]) != "virtual"] or gpus
    discrete = sorted((gpu_rank(g["name"]), i) for i, g in enumerate(real) if gpu_kind(g["name"]) == "discrete")
    dgpu = real[discrete[0][1]] if discrete else (real[0] if real else {})
    igpu = next((g for g in real if g is not dgpu and gpu_kind(g["name"]) == "integrated"), None)
    rams = r.get("ram") or []
    ram_total = sum(int(m.get("cap") or 0) for m in rams)
    ram_speed = max((int(m.get("speed") or 0) for m in rams), default=0)
    ram_type = {34: "DDR5", 26: "DDR4", 24: "DDR3", 35: "LPDDR5", 30: "LPDDR4"}.get((rams[0].get("type") if rams else 0), "")
    slots = int(r.get("slots") or len(rams) or 1)
    disks = r.get("disks") or []
    sd = str(r.get("sysDisk") if r.get("sysDisk") is not None else "")
    sysd = next((d for d in disks if str(d.get("id")) == sd), disks[0] if disks else {})
    du = _sys_drive_usage()
    nets = r.get("nets") or []
    net = nets[0] if nets else {}
    audio = r.get("audio") or []
    # displays: commercial name from WMI + size in inches
    sizes = {s["inst"]: s for s in (r.get("monSizes") or [])}
    conn = {c["inst"]: c.get("tech") for c in (r.get("monConn") or [])}
    mons = []
    for m in r.get("monitors") or []:
        sz = sizes.get(m["inst"]) or {}
        diag = round(((sz.get("w") or 0) ** 2 + (sz.get("h") or 0) ** 2) ** .5 / 2.54) if sz.get("w") else None
        vendor = PNP_VENDORS.get((m.get("maker") or "").upper(), m.get("maker") or "")
        internal = conn.get(m["inst"]) in (6, 11, 13, 0x80000000, -2147483648)  # internal: LVDS, eDP, UDI embedded
        label = (m.get("name") or "").strip()
        mons.append({"vendor": vendor, "name": label, "code": m.get("code"), "inches": diag, "internal": internal})
    batt = psutil.sensors_battery()
    inside = [m["inches"] for m in mons if m["internal"] and m["inches"]]
    ptype, pname = classify(r, batt is not None, min(inside) if inside else None)  # typeName: translated in _localize
    comps = []
    comps.append({"id": "cpu", "name": "Processor", "title": _clean(cpu.get("name", "")),
                  "rows": [[N_("Cores"), str(cpu.get("cores", "–"))], [N_("Threads"), str(cpu.get("threads", "–"))],
                           [N_("Base clock"), _T("{v} GHz", v={"num": (cpu.get('maxMhz') or 0) / 1000, "d": 1})],
                           [N_("L3 cache"), f"{round((cpu.get('l3') or 0) / 1024)} MB"]]})
    if dgpu:
        vr = _gpu_vram(dgpu["name"])
        comps.append({"id": "gpu", "name": "Graphics", "title": _clean(dgpu["name"]),
                      "rows": ([[N_("Memory"), f"{vr} GB"]] if vr else []) + ([[N_("Integrated"), _clean(igpu["name"])]] if igpu else []) +
                              [[N_("Driver"), dgpu.get("driver") or "–"]], "vram": vr})
    comps.append({"id": "ram", "name": "Memory", "title": f"{round(ram_total / GB)} GB {ram_type}".strip(),
                  "rows": [[N_("Speed"), f"{ram_speed} MT/s" if ram_speed else "–"],
                           [N_("Manufacturer"), (rams[0].get("maker") or "–").strip() if rams else "–"],
                           [N_("Modules"), _T("{n} of {slots} slots, free slots available" if slots > len(rams) else "{n} of {slots} slots",
                                              n=len(rams), slots=slots)]],
                  "slots": slots, "modules": len(rams)})
    size = sysd.get("size") or 0
    # 256 GB is "256 GB", not "0.3 TB"
    cap = f"{round(size / 1e12, 1):g} TB" if size >= 0.95e12 else f"{round(size / 1e9):d} GB"
    comps.append({"id": "ssd", "name": "Storage", "title": f"{sysd['name']} {cap}" if sysd.get("name") else _T("Disk {size}", size=cap),
                  "rows": [[N_("Type"), f"{sysd.get('media', '')} {sysd.get('bus', '')}".strip() or "–"],
                           [N_("Used on C:"), f"{round(du.used / GB)} GB"], [N_("Free on C:"), f"{round(du.free / GB)} GB"],
                           [N_("Disks"), str(len(disks))]], "bar": round(du.used / du.total, 3) if du.total else 0})
    if mons:
        comps.append({"id": "display", "name": "Displays", "title": _T("{n} displays" if len(mons) > 1 else "{n} display", n=len(mons)),
                      "rows": [[(N_("Internal") if m["internal"] else N_("External")), " ".join(x for x in (m["vendor"], m["name"] or m["code"], f'{m["inches"]}"' if m["inches"] else "") if x)] for m in mons],
                      "monitors": mons})
    if batt is not None:
        comps.append({"id": "battery", "name": "Battery",
                      "title": _T("{pct}%, charging", pct=round(batt.percent)) if batt.power_plugged else f"{round(batt.percent)}%",
                      "rows": [[N_("Status"), _T("Plugged in" if batt.power_plugged else "On battery", ctx="battery")]]})
    if net:
        comps.append({"id": "wifi", "name": "Network", "title": net.get("name") or _T("Network"),
                      "rows": [[N_("Link"), net.get("speed", "–")], [N_("Type"), net.get("media", "–")]]})
    if audio:
        comps.append({"id": "audio", "name": "Audio", "title": audio[0], "rows": [[N_("Others"), ", ".join(audio[1:3]) or "–"]]})
    comps.append({"id": "sys", "name": "System", "title": os_full,
                  "rows": [[N_("Build"), f"{r.get('build', '')}.{r.get('ubr', '')}".strip(".")], [N_("BIOS"), r.get("bios") or "–"],
                           [N_("Motherboard"), r.get("board") or "–"]]})
    return {"model": nice or model or _T("This PC"), "code": code, "type": ptype, "typeName": pname, "maker": maker,
            "os": os_full, "build": str(r.get("build", "")), "bios": r.get("bios", ""), "components": comps,
            "facts": {"drivers": None, "programs": _programs_count(), "freeC": round(du.free / GB)}, "ts": time.time(), "v": CACHE_VERSION}


def _save(info):
    try:
        os.makedirs(os.path.dirname(_CACHE), exist_ok=True)
        with open(_CACHE, "w", encoding="utf-8") as fh:
            json.dump(info, fh, ensure_ascii=False)
    except OSError:
        pass


STALE_AFTER = 30 * 60  # facts (drivers, disks, GPU) older than this are measured again in the background
_refreshing = threading.Event()


def pc_info_fresh():
    global _mem
    if fakepc.active():  # developer-only test copy pretending to be a tower: nothing is measured or cached
        return _localize(fakepc.pc_info())
    t0 = time.time()
    with _lock:
        if _mem and _mem.get("ts", 0) >= t0:  # another caller measured while this one waited for the lock
            return _localize(_mem)
        def count():
            try:
                return _drivers_count()
            except Exception:
                return None
        info, n_drivers = gather(_build, count)  # the slowest query runs while the rest is measured
        if n_drivers is not None:
            info["facts"]["drivers"] = n_drivers
        _mem = info
        _save(info)
        return _localize(info)


def _refresh_bg():
    try:
        pc_info_fresh()
    except Exception:
        pass
    finally:
        _refreshing.clear()


def _refresh_async():
    """One background measurement at a time; never blocks the caller."""
    if _refreshing.is_set():
        return
    _refreshing.set()
    threading.Thread(target=_refresh_bg, daemon=True).start()


def pc_info():
    """What was measured last (instantly); older than STALE_AFTER it is measured again in the background, so the
    next call (the UI asks again when Home is shown after a while) has the new data. The first time it waits."""
    global _mem
    if fakepc.active():
        return _localize(fakepc.pc_info())
    if _mem:
        if time.time() - _mem.get("ts", 0) > STALE_AFTER:
            _refresh_async()
        return _localize(_mem)
    try:
        with open(_CACHE, encoding="utf-8") as fh:
            cached = json.load(fh)
        if not isinstance(cached, dict) or cached.get("v") != CACHE_VERSION:   # damaged (not an object) or older
            return pc_info_fresh()
        _mem = cached
        _refresh_async()
        return _localize(_mem)
    except (OSError, ValueError):
        return pc_info_fresh()
