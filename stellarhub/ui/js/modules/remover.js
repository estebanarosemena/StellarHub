/* StellarHub · Program Remover. UI with sample data shaped like the real API: program list,
   normal/silent/forced uninstall, leftover scanner with confidence, quarantine, batch, watched install, hunter. */
'use strict';
(() => {
const { $, $$, anim, EASE, Spring, tickers, ic, esc, fmt1 } = SH;
const T = SH.t;
const U = SH.unit;
/* words that mean something else elsewhere in the app: looked up as "remover|word" first */
const TC = s => SH.tc('remover', s);
/* two keys for singular and plural: PL(n, '{n} item', '{n} items', { more }) */
const PL = (n, one, many, v) => T(n === 1 ? one : many, Object.assign({ n }, v));
/* how a mode reads in history lines and quarantine sessions */
const SMODE = { normal: T('Normal mode'), silent: T('Silent mode'), quiet: T('Silent mode'), forced: T('Forced mode'), batch: T('Batch mode'), quarantine: T('In quarantine'), delete: T('Deleted permanently') };
const parts = a => a.filter(Boolean).join(', ');
const wait = ms => new Promise(r => setTimeout(r, ms));
/* elapsed time as m:ss */
const mmss = s => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/* a duration in words: "45 s", "2 min 5 s" (translated patterns, never hand-built units) */
const durTxt = sec => { const s = Math.max(0, Math.round(sec)); return s < 60 ? T('{n} s', { n: s }) : s % 60 ? T('{m} min {s} s', { m: Math.floor(s / 60), s: s % 60 }) : T('{n} min', { n: s / 60 }); };
const TODAY = new Date('2026-11-17');
SH.icons.add({
  crosshair: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1"/>',
  reg: '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="18.5" cy="18" r="2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  silent: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  force: '<path d="M13 2.5 4.5 13.5H12L11 21.5l8.5-11H12z"/>',
  export: '<path d="M12 15V3m-4.5 4.5L12 3l4.5 4.5"/><path d="M5 12v7.5h14V12"/>',
  sortaz: '<path d="m6 9 6-6 6 6"/>',
});

/* ---------- sample data (shaped like the real API) ---------- */
let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const RAW = `FL Studio 2025|Image-Line|2840|w|25.1.3.5570
iZotope Ozone 12|iZotope|1930|w|12.0.1
iZotope RX 11 Audio Editor|iZotope|2410|w|11.1.0
iZotope Neutron 5|iZotope|780|w|5.0.2
iZotope Nectar 4|iZotope|690|w|4.0.1
FabFilter Pro-Q 4|FabFilter|62|w|4.01
FabFilter Pro-L 2|FabFilter|48|w|2.21
FabFilter Pro-C 2|FabFilter|45|w|2.20
FabFilter Saturn 2|FabFilter|51|w|2.07
Melodyne 5|Celemony|520|w|5.4.2
Auto-Tune Pro 11|Antares Audio Technologies|310|w|11.0.3
Serum 2|Xfer Records|860|w|2.0.14
Phase Plant|Kilohearts|140|w|2.2.6
soothe2|oeksound|38|w|1.4.1
The Glue|Cytomic|22|w|1.5.2
ValhallaVintageVerb|Valhalla DSP|18|w|4.0.5
Native Access|Native Instruments|240|w|3.14.0
Kontakt 8|Native Instruments|1480|w|8.2.0
ASIO4ALL 2.16|Michael Tippach|2|w|2.16
Brave|Brave Software|640|w|1.84.112
Google Chrome|Google LLC|720|w|143.0.7499.40
Mozilla Firefox|Mozilla|290|w|145.0.1
Microsoft Edge|Microsoft Corporation|610|p|143.0.3650.28
Tor Browser|The Tor Project|220|w|15.0.2
Steam|Valve Corporation|1240|w|2.10.91.91
Epic Games Launcher|Epic Games, Inc.|980|w|19.1.2
Bloxstrap|pizzaboxer|64|w|2.9.1
Roblox Player|Roblox Corporation|480|w|0.698.0
Medal|Medal B.V.|590|w|4.2580.0
Discord|Discord Inc.|420|w|1.0.9214
Spotify|Spotify AB|380|s|1.2.76.312
Stremio|Smart Code OOD|260|w|5.0.0
Wallpaper Engine|Wallpaper Engine Team|760|w|2.6.112
Movavi Video Editor 27|Movavi Software|1720|w|27.1.0
CapCut|Bytedance Pte. Ltd.|1150|w|7.4.0
OBS Studio|OBS Project|470|w|32.0.2
HandBrake|The HandBrake Team|90|w|1.10.2
VLC media player|VideoLAN|160|w|3.0.21
Audacity|Audacity Team|110|w|3.7.5
Blender 4.2|Blender Foundation|1150|w|4.2.3
GIMP 3.0|The GIMP Team|820|w|3.0.4
Python 3.13|Python Software Foundation|140|s|3.13.14
Python Launcher|Python Software Foundation|2|w|3.13.14
Node.js|OpenJS Foundation|105|w|24.19.0
Git|The Git Development Community|340|w|2.56.0
GitHub CLI|GitHub, Inc.|48|w|2.102.0
Visual Studio Code|Microsoft Corporation|420|w|1.108.0
Cursor|Anysphere Inc.|610|w|2.1.3
Docker Desktop|Docker Inc.|2600|w|4.52.0
MSYS2|The MSYS2 Developers|1300|w|20250830
Ollama|Ollama|980|w|0.13.1
Oracle VirtualBox 7.1|Oracle and/or its affiliates|290|w|7.1.12
LDPlayer 9|XUANZHI INTERNATIONAL CO.|1800|w|9.1.48
Claude|Anthropic, PBC|410|w|1.0.3218
Obsidian|Dynalist Inc.|380|w|1.10.3
7-Zip 24.09|Igor Pavlov|6|w|24.09
WinRAR 7.10|win.rar GmbH|9|w|7.10.0
Everything 1.4|voidtools|3|w|1.4.1.1026
PowerToys|Microsoft Corporation|520|w|0.96.0
Microsoft 365 Apps for enterprise|Microsoft Corporation|3400|w|16.0.19328.20000
Microsoft OneDrive|Microsoft Corporation|310|p|25.205.1019.0001
Microsoft Teams|Microsoft Corporation|280|s|25290.205.4069
Zoom Workplace|Zoom Communications, Inc.|310|w|6.6.5
WhatsApp|WhatsApp Inc.|240|s|2.2546.4.0
Telegram Desktop|Telegram FZ-LLC|120|w|6.2.4
Adobe Acrobat Reader|Adobe Inc.|760|w|25.001.20756
NVIDIA App|NVIDIA Corporation|410|w|11.0.5.266
NVIDIA Graphics Driver 617.42|NVIDIA Corporation|1350|p|617.42
NVIDIA PhysX|NVIDIA Corporation|410|w|9.23.1019
Intel Driver & Support Assistant|Intel|120|w|25.4.32.8
Armoury Crate|ASUSTeK Computer Inc.|690|w|6.3.6.0
MyASUS|ASUSTeK Computer Inc.|230|s|4.0.42.0
ASUS Framework Service|ASUSTeK Computer Inc.|60|p|4.2.4.6
Realtek Audio Console|Realtek Semiconductor Corp|40|s|1.53.312.0
Microsoft Visual C++ 2015-2022 Redistributable (x64)|Microsoft Corporation|25|p|14.44.35211.0
Microsoft Visual C++ 2015-2022 Redistributable (x86)|Microsoft Corporation|21|p|14.44.35211.0
Microsoft Visual C++ 2013 Redistributable (x64)|Microsoft Corporation|19|p|12.0.40664.0
Microsoft Visual C++ 2010 Redistributable (x86)|Microsoft Corporation|13|p|10.0.40219
Microsoft .NET Runtime 8.0.11 (x64)|Microsoft Corporation|72|p|8.0.11
Microsoft Windows Desktop Runtime 9.0.0 (x64)|Microsoft Corporation|88|p|9.0.0
Microsoft Windows Desktop Runtime 6.0.36 (x64)|Microsoft Corporation|84|p|6.0.36
Microsoft Edge WebView2 Runtime|Microsoft Corporation|610|p|143.0.3650.28
Java 8 Update 451|Oracle Corporation|150|w|8.0.4510.9
Microsoft Update Health Tools|Microsoft Corporation|1|p|5.72.0.0
Windows PC Health Check|Microsoft Corporation|12|w|3.9.2406
Microsoft GameInput|Microsoft Corporation|6|p|10.1.26100.5074
Xbox|Microsoft Corporation|160|s|2511.1001.10.0
Xbox Game Bar|Microsoft Corporation|120|s|7.325.11061.0
Windows Terminal|Microsoft Corporation|90|s|1.23.12811.0
Microsoft Clipchamp|Microsoft Corp.|120|s|4.4.10520.0
Microsoft To Do|Microsoft Corporation|60|s|2.148.3611.0
Microsoft Solitaire Collection|Xbox Game Studios|110|s|4.24.10100.0
Microsoft News|Microsoft Corporation|30|s|4.55.62231.0
MSN Weather|Microsoft Corporation|40|s|4.53.52331.0
Copilot|Microsoft Corporation|80|s|1.25112.81.0
Bitwarden|Bitwarden Inc.|210|w|2025.10.1
KeePassXC|KeePassXC Team|70|w|2.7.10
Proton VPN|Proton AG|160|p|4.3.6
qBittorrent|The qBittorrent project|95|w|5.1.3
ShareX|ShareX Team|30|w|18.0.1
Greenshot|Greenshot|12|w|1.3.301
TranslucentTB|TranslucentTB Open Source Developers|4|s|2025.1.0.0
Rainmeter|Rainmeter|14|w|4.5.23
Logitech G HUB|Logitech|940|w|2025.9.785432
Elgato Wave Link|Corsair Memory, Inc.|210|w|2.0.6
Voicemod|Voicemod S.L.|520|w|3.12.31
NVIDIA Broadcast|NVIDIA Corporation|1600|w|2.0.2
Malwarebytes|Malwarebytes|380|p|5.4.5.205
CCleaner|Piriform Software Ltd|120|w|6.42.11425
Adobe Creative Cloud|Adobe Inc.|1100|w|6.7.0.278
Adobe Photoshop 2026|Adobe Inc.|4200|w|27.1.0
Figma|Figma, Inc.|360|w|125.10.8
Canva|Canva Pty Ltd|230|s|1.118.0
Postman|Postman, Inc.|520|w|11.72.4
DB Browser for SQLite|DB Browser for SQLite Team|40|w|3.13.1
Tailscale|Tailscale Inc.|80|w|1.90.6`;
const AUDIO = /Image-Line|iZotope|FabFilter|Celemony|Antares|Xfer|Kilohearts|oeksound|Cytomic|Valhalla|Native Instruments/;
const PROGRAMS = RAW.split('\n').map((l, i) => {
  const [name, pub, mb, k, ver] = l.split('|');
  const daysAgo = k === 'p' ? 40 + Math.floor(rnd() * 8) : Math.floor(rnd() * 47);
  const dt = new Date(TODAY - daysAgo * 864e5);
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  const ini = (words.length > 1 && !/^\d/.test(words[1]) ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
  return {
    id: 'p' + i, name, pub, mb: +mb, kind: k, ver, date: dt, h, ini, arch: /x86|32/.test(name) ? 32 : 64,
    silent: k !== 's' && rnd() > .25, store: k === 's', prot: k === 'p',
    loc: k === 's' ? `C:\\Program Files\\WindowsApps\\${name.replace(/\s+/g, '')}_${ver}_x64` : `C:\\Program Files\\${pub.split(/[ ,]/)[0]}\\${name.replace(/ \d.*$/, '')}`,
    cmd: k === 's' ? T('Remove the Store package') : rnd() > .5 ? `MsiExec.exe /X{${(1e7 + Math.floor(rnd() * 9e7)).toString(16).toUpperCase()}-...}` : `"C:\\Program Files\\${pub.split(/[ ,]/)[0]}\\unins000.exe"`,
    audio: AUDIO.test(pub),
  };
});
/* English values the engine sends (and caches) that are shown as they are */
const ENGINE_TEXT = { '32-bit': T('32-bit'), '64-bit': T('64-bit'), 'Current user': T('Current user'), 'Built into the program': T('Built into the program') };
const totalGB = () => PROGRAMS.reduce((a, p) => a + p.mb, 0) / 1024;
/* short date in the interface language; Chinese and Japanese use the compact numeric form (2026/10/31) so it fits the columns */
const DATE_OPTS = SH.i18n && (SH.i18n.lang === 'zh' || SH.i18n.lang === 'ja') ? { year: 'numeric', month: 'numeric', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' };
const fmtDate = d => d ? d.toLocaleDateString((SH.i18n && SH.i18n.locale) || 'en-US', DATE_OPTS) : '—';
const fmtMB = mb => !mb ? '—' : mb >= 1024 ? `${fmt1(mb / 1024)} ${U('GB')}` : `${Math.max(1, Math.round(mb))} ${U('MB')}`;
const NOW = () => (REAL() ? new Date() : TODAY);
const daysSince = d => d ? Math.round((NOW() - d) / 864e5) : Infinity;

const TYPES = {
  folder: [T('Folders'), 'folder'], shortcut: [TC('Shortcuts'), 'link'], plugin: [T('Audio plugins'), 'audio'], reg: [T('Registry'), 'reg'], task: [T('Scheduled tasks'), 'clock'],
  service: [T('Services'), 'gear'], firewall: [T('Firewall rules'), 'shield'], assoc: [T('File types'), 'file'], path: [T('PATH variable'), 'code'], personal: [T('Your data'), 'user'],
};
function leftoversFor(p) {
  const s = p.name.replace(/ \d[\d.]*$/, '').replace(/\s+\(.*\)$/, ''); const pubS = p.pub.split(/[ ,]/)[0];
  const samePub = PROGRAMS.filter(x => x.pub === p.pub && x !== p).length;
  const L = [];
  const add = (type, path, conf, why, mb = 0, personal = false) => L.push({ id: 'l' + L.length + '_' + p.id, type, path, conf, why, mb, personal, prog: p.name });
  if (p.store) {
    add('folder', `C:\\Users\\user\\AppData\\Local\\Packages\\${s.replace(/\s+/g, '')}_8wekyb3d8bbwe`, 95, T('Store package data; Windows does not delete it when removing the app'), 40 + rnd() * 200);
    add('reg', `HKCU\\Software\\Classes\\Local Settings\\...\\${s.replace(/\s+/g, '')}`, 84, T('Package settings with the same identifier'));
    return L;
  }
  add('folder', p.loc, 97, T('Install folder; no executables are left inside'), p.mb * (.02 + rnd() * .06));
  add('folder', `C:\\Users\\user\\AppData\\Roaming\\${s}`, 91, T('Only this program wrote here and it has the same name'), 5 + rnd() * 120);
  add('folder', `C:\\Users\\user\\AppData\\Local\\${s}\\Cache`, 93, T('Program cache; safe to delete without losing anything'), 20 + rnd() * 400);
  add('shortcut', `Start Menu\\Programs\\${s}.lnk`, 99, T('The shortcut points to a file that no longer exists'));
  if (rnd() > .4) add('shortcut', `Desktop\\${s}.lnk`, 99, T('Points to the deleted executable'));
  add('reg', `HKCU\\Software\\${pubS}\\${s}`, 89, T('Key with the publisher and program name'));
  add('reg', `HKLM\\SOFTWARE\\WOW6432Node\\${pubS}`, samePub ? 42 : 76, samePub ? T('Another installed {pub} program might use this key', { pub: p.pub }) : T('Publisher key; none of its other programs are left'));
  add('reg', `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${s.split(' ')[0].toLowerCase()}.exe`, 96, T('Registered path to an executable that no longer exists'));
  if (rnd() > .35) add('task', `\\${pubS}\\${s} Update`, 94, T('Update task that launches a deleted file'));
  if (rnd() > .6) add('service', `${s.replace(/\s+/g, '')}Service`, 87, T('Service without an executable; manual start, not used by Windows'));
  if (rnd() > .45) add('firewall', T('Inbound rule: {name}', { name: `${s.split(' ')[0].toLowerCase()}.exe` }), 92, T('The rule allows a program that is no longer there'));
  if (p.audio) {
    add('plugin', `C:\\Program Files\\Common Files\\VST3\\${s}.vst3`, 86, T('Plugin from this program; no other installed program uses it'), 30 + rnd() * 90);
    add('plugin', `C:\\Program Files\\Common Files\\CLAP\\${s}.clap`, 84, T('CLAP version of the same plugin'), 10 + rnd() * 40);
    add('personal', `C:\\Users\\user\\Documents\\${pubS}`, 25, T('Your projects and presets. They are listed but never selected automatically'), 300 + rnd() * 900, true);
  }
  if (/FL Studio/.test(p.name)) add('assoc', T('.flp files (FL Studio project)'), 81, T('The file type opens a program that no longer exists'));
  if (/Python|Node|Git|MSYS|Docker/.test(p.name)) add('path', `PATH: ${p.loc}\\bin`, 88, T('PATH entry that points to a deleted folder'));
  return L;
}
const sessions = [
  { id: 'q1', prog: 'CCleaner Browser', pub: 'Piriform Software Ltd', h: 120, ini: 'CB', date: new Date(TODAY - 5 * 864e5), mode: 'silent', items: leftoversFor({ name: 'CCleaner Browser', pub: 'Piriform', loc: 'C:\\Program Files\\CCleaner Browser', mb: 600 }).filter(l => !l.personal) },
  { id: 'q2', prog: 'Opera GX', pub: 'Opera Software', h: 350, ini: 'OG', date: new Date(TODAY - 11 * 864e5), mode: 'normal', items: leftoversFor({ name: 'Opera GX', pub: 'Opera', loc: 'C:\\Users\\user\\AppData\\Local\\Programs\\Opera GX', mb: 1400 }).filter(l => !l.personal) },
];
const history = [
  { type: 'uninstall', title: T('{name} uninstalled', { name: 'CCleaner Browser' }), sub: parts([SMODE.silent, T('{n} leftovers to the quarantine', { n: 9 })]), date: sessions[0].date },
  { type: 'restore', title: T('Restored: {name}', { name: 'Opera GX.lnk' }), sub: T('From the quarantine'), date: new Date(TODAY - 10 * 864e5) },
  { type: 'uninstall', title: T('{name} uninstalled', { name: 'Opera GX' }), sub: parts([SMODE.normal, T('{n} leftovers to the quarantine', { n: 10 })]), date: sessions[1].date },
  { type: 'watch', title: T('Watched install: {name}', { name: 'bx_console SSL 4000' }), sub: T('{files} files and {keys} keys recorded', { files: 312, keys: 41 }), date: new Date(TODAY - 19 * 864e5) },
];
const traces = [
  { id: 't1', name: 'bx_console SSL 4000', date: new Date(TODAY - 19 * 864e5), files: 312, keys: 41, mb: 186 },
  { id: 't2', name: 'Wacom tablet driver', date: new Date(TODAY - 33 * 864e5), files: 87, keys: 119, mb: 64 },
];
let qDays = 14;

/* ================= real engine =================
   Inside the app (pywebview) everything comes from stellarhub/engine/remover.py. In the browser the sample
   mode above stays so the UI can be designed. UI ids are short (r0, r1…); the engine's id goes in p.eid. */
const REAL = () => !!(window.pywebview && window.pywebview.api);
const hueOf = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const iniOf = name => { const w = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean); if (!w.length) return '?'; return (w.length > 1 && !/^\d/.test(w[1]) ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase(); };
let realSeq = 0; const byEid = new Map();
function fromEngine(e) {
  const known = byEid.get(e.id);
  const pub = e.publisher || '';
  const d = e.date ? new Date(e.date + 'T12:00:00') : null;
  const p = Object.assign(known || { id: 'r' + (realSeq++) }, {
    eid: e.id, name: e.name || '?', pub, mb: (e.size || 0) / 1048576, ver: e.version || '', date: d && !isNaN(d) ? d : null,
    h: hueOf(e.name || '?'), ini: iniOf(e.name || '?'), arch: e.arch || '', silent: !!e.can_quiet, store: e.source === 'store',
    prot: !!e.protected, protLabel: e.protected && e.protected.label, noForce: !!(e.protected && e.protected.no_force),
    loc: e.location || '', cmd: '', audio: AUDIO.test(pub), icon: e.icon || (known && known.icon) || null,
    kindLabel: e.kind_label || '', broken: !!e.broken, orphan: !!e.orphan, noUninst: !!e.no_uninstaller,
  });
  byEid.set(e.id, p); return p;
}
let realPromise = null, realInfo = null, bgJob = null;
function ensureReal(force) {
  if (realPromise && !force) return realPromise;
  realPromise = (async () => {
    if (!realInfo) { realInfo = await SH.engine('remover', 'init'); if (realInfo && realInfo.settings) qDays = realInfo.settings.quarantine_days || 14; }
    const list = await SH.engine('remover', 'programs');
    if (!Array.isArray(list)) throw new Error(T("StellarHub's engine did not answer. Close and open the app again."));
    PROGRAMS.splice(0, PROGRAMS.length, ...list.map(fromEngine));
    startBackground();
    return PROGRAMS;
  })();
  realPromise.catch(() => { realPromise = null; });
  /* the first read (opening the module) is followed from anywhere once it runs for a moment; the refreshes after an
     uninstall or a restore stay silent */
  if (!force) SH.activity.follow('remover', realPromise, { key: 'list', label: T('Reading programs…'), go: { tab: 'programs' } }).catch(() => {});
  return realPromise;
}
/* after drawing: missing icons, Store apps and real sizes, in batches */
function startBackground() {
  if (bgJob) bgJob.cancel();
  bgJob = SH.job('remover', 'background', [], { onProgress: m => {
    const d = m.data || {};
    if (d.icons && Object.keys(d.icons).length) applyIcons(d.icons);
    if (d.sizes && Object.keys(d.sizes).length) applySizes(d.sizes);
    if (d.store) { d.store.forEach(fromEngine); const ids = new Set(PROGRAMS.map(p => p.eid)); d.store.forEach(e => { if (!ids.has(e.id)) PROGRAMS.push(byEid.get(e.id)); }); refresh(); }
  } });
  bgJob.catch(() => {});
}
function applyIcons(map) {
  for (const eid in map) {
    const p = byEid.get(eid); if (!p) continue; p.icon = map[eid];
    $$(`[data-pi="${p.id}"]`).forEach(el => { el.outerHTML = pi(p, el.classList.contains('lg')); });
  }
}
function applySizes(map) {
  for (const eid in map) {
    const p = byEid.get(eid); if (!p) continue; p.mb = map[eid] / 1048576;
    $$(`.pr[data-p="${p.id}"] .sz`).forEach(el => { el.textContent = fmtMB(p.mb); });
  }
}
/* engine leftover -> UI shape */
function typeOf(it) {
  if (it.personal) return 'personal';
  const t = (it.target || '').toLowerCase();
  if (it.kind === 'file' && /\.(lnk|url)$/.test(t)) return 'shortcut';
  if ((it.kind === 'file' || it.kind === 'folder') && /\\(vst3?|vstplugins|clap|aax|steinberg\\vstplugins)\\|\.(vst3|clap|aaxplugin)$/.test(t)) return 'plugin';
  if (it.kind === 'file' || it.kind === 'folder') return 'folder';
  if (it.kind === 'regkey' || it.kind === 'regvalue') return /\\classes\\[^\\]*\.[a-z0-9]+|\\classes\\clsid/.test(t) ? 'assoc' : 'reg';
  return { service: 'service', task: 'task', fwrule: 'firewall', envpath: 'path' }[it.kind] || 'reg';
}
const mapItem = (key, progName) => it => ({
  id: key + '#' + it.id, eid: it.id, key, type: typeOf(it), path: it.display || it.target, conf: Math.round(it.score || 0),
  why: (it.blocked ? T('Blocked for safety: {reason}.', { reason: it.blocked }) + ' ' : '') + (it.reasons || []).join('. '), mb: (it.size || 0) / 1048576,
  personal: !!it.personal, blocked: !!it.blocked, selected: !!it.selected, prog: progName,
});
const jobErr = e => (e && e.message) || T('Something went wrong');
const API = {
  async list() { await wait(80); return PROGRAMS; },
  async restorePoint() { await wait(1300); return true; },
  async closeApp() { await wait(700); return true; },
  async runUninstaller(p, mode) { await wait(mode === 'forced' ? 600 : 1800 + rnd() * 900); return { ok: true }; },
  async scan(progs, onCat) { for (const t of Object.keys(TYPES)) { onCat(t); await wait(220 + rnd() * 260); } return progs.flatMap(leftoversFor); },
  async remove(progs, items, mode) {
    await wait(700);
    progs.forEach(p => { const i = PROGRAMS.indexOf(p); if (i >= 0) PROGRAMS.splice(i, 1); });
    const s = { id: 'q' + Date.now(), prog: progs.length === 1 ? progs[0].name : T('{n} programs in a batch', { n: progs.length }), pub: progs.length === 1 ? progs[0].pub : progs.map(p => p.name).join(', '), h: progs[0].h, ini: progs.length === 1 ? progs[0].ini : String(progs.length), date: new Date(TODAY), mode, items, progs };
    sessions.unshift(s);
    history.unshift({ type: 'uninstall', title: T('{name} uninstalled', { name: s.prog }), sub: parts([SMODE[mode], PL(items.length, '{n} leftover to the quarantine', '{n} leftovers to the quarantine')]), date: new Date(TODAY) });
    return s;
  },
  async restore(session, item, onProgress) {
    if (REAL()) {
      const r = await SH.job('remover', 'quarantine_restore', [session.id, item ? [item.idx] : null], { sound: 'task', onProgress: m => { if (onProgress) onProgress(m); } });
      if (r && r.failed) SH.toast(PL(r.failed, 'Could not restore {n} item: {error}', 'Could not restore {n} items: {error}', { error: (r.errors || [])[0] || '' }), { ms: 6000, kind: 'error' });
      if (r && r.needs_reboot) SH.toast(T('Some services or rules are fully restored after a restart.'), { ms: 5000, kind: 'warning' });
      SH.logActivity(item ? T('Restored an item from the quarantine') : T('{name}: put back in place', { name: session.prog }), { ic: 'restore', go: 'remover', tab: 'quarantine' });
      ensureReal(true).then(refresh).catch(() => {});
    } else await wait(350);
    if (item) { session.items = session.items.filter(x => x !== item); history.unshift({ type: 'restore', title: T('Restored: {name}', { name: item.path.split('\\').pop() }), sub: T('From {name}', { name: session.prog }), date: new Date(TODAY) }); }
    else { history.unshift({ type: 'restore', title: T('{name}: everything restored', { name: session.prog }), sub: PL(session.items.length, '{n} item put back in place', '{n} items put back in place'), date: new Date(TODAY) }); session.items = []; if (session.progs) session.progs.forEach(p => PROGRAMS.push(p)); }
    if (!session.items.length) sessions.splice(sessions.indexOf(session), 1);
  },
};

/* ---------- helpers ---------- */
const pi = (p, lg) => p.icon
  ? `<span class="pi img${lg ? ' lg' : ''}" data-pi="${p.id}"><img src="${p.icon}" alt="" loading="lazy" decoding="async"></span>`
  : `<span class="pi${lg ? ' lg' : ''}" data-pi="${p.id}" style="--h:${p.h}">${esc(p.ini)}</span>`;
const CHK = on => `<span class="check${on ? ' on' : ''}"><svg class="i" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span>`;
/* "select all" box with three states: none, some (a dash) or all */
const ALLCHK = (attr, label) => `<span class="check rv-all" role="checkbox" tabindex="0" aria-checked="false" ${attr} aria-label="${esc(label)}" title="${esc(T('Select all'))}"><svg class="i" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span>`;
function setTri(box, n, total) {
  if (!box) return;
  const st = !total || !n ? 'false' : n === total ? 'true' : 'mixed';
  box.classList.toggle('on', st === 'true'); box.classList.toggle('some', st === 'mixed'); box.setAttribute('aria-checked', st);
  box.classList.toggle('off', !total);
}
const triKeys = e => { if ((e.key === ' ' || e.key === 'Enter') && e.target.classList && e.target.classList.contains('rv-all')) { e.preventDefault(); e.target.click(); } };
/* icons of programs that were uninstalled: the quarantine and the history still show them (kept on this PC only) */
const ICON_KEY = 'sh.rmIcons';
function rememberIcons(progs) {
  try {
    const m = JSON.parse(localStorage.getItem(ICON_KEY) || '{}');
    progs.forEach(p => { if (p && p.icon && p.name) { delete m[p.name]; m[p.name] = p.icon; } });
    const keys = Object.keys(m); keys.slice(0, Math.max(0, keys.length - 60)).forEach(k => delete m[k]);
    localStorage.setItem(ICON_KEY, JSON.stringify(m));
  } catch { /* storage full or blocked: letters stay */ }
}
function iconByName(name) {
  const live = PROGRAMS.find(p => p.name === name && p.icon); if (live) return live.icon;
  try { return JSON.parse(localStorage.getItem(ICON_KEY) || '{}')[name] || null; } catch { return null; }
}
function flip(container, mutate) {
  const kids = [...container.children]; const first = new Map(kids.map(e => [e, e.getBoundingClientRect().top]));
  mutate();
  [...container.children].forEach(e => { const f = first.get(e); if (f == null || e.hidden) return; const d = f - e.getBoundingClientRect().top; if (Math.abs(d) > .5 && Math.abs(d) < 1600) anim(e, [{ transform: `translateY(${d}px)` }, { transform: 'none' }], { d: 480, e: EASE.spring }); });
}
const stagger = (els, base = 0, step = 30) => els.forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translate3d(0,10px,0)' }, { opacity: 1, transform: 'none' }], { d: 420, delay: base + Math.min(i, 16) * step, e: EASE.spring }));
function swap(el, html, dir = 1, after) {
  anim(el, [{ opacity: 1, transform: 'none', filter: 'blur(0px)' }, { opacity: 0, transform: `translate3d(${-dir * 18}px,0,0)`, filter: 'blur(6px)' }], { d: 160 }).finished.then(() => {
    el.innerHTML = html; el.scrollTop = 0; anim(el, [{ opacity: 0, transform: `translate3d(${dir * 26}px,0,0)`, filter: 'blur(8px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 460, e: EASE.spring }); after && after();
  }).catch(() => { el.innerHTML = html; after && after(); });
}
function segHTML(opts, on) { return `<div class="seg"><span class="ind"></span>${opts.map(([v, l]) => `<button data-v="${v}"${v === on ? ' class="on"' : ''}>${l}</button>`).join('')}</div>`; }
function wireSeg(seg, cb) {
  requestAnimationFrame(() => SH.placeSeg(seg, true));
  seg.addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.classList.contains('on')) return; $$('button', seg).forEach(x => x.classList.toggle('on', x === b)); SH.placeSeg(seg); cb(b.dataset.v); });
}
function ring(cls = 'ring') { return `<svg class="${cls}" viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" fill="none" style="stroke:var(--raise2)" stroke-width="4"/><circle class="rg" cx="32" cy="32" r="27" fill="none" style="stroke:var(--ok)" stroke-width="4" stroke-linecap="round" stroke-dasharray="169.6" stroke-dashoffset="169.6" transform="rotate(-90 32 32)"/><path class="ckp" d="m21 33 7.5 7.5L44 25" fill="none" style="stroke:var(--ok)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="40" stroke-dashoffset="40"/></svg>`; }
function playRing(svg, delay = 0) { if (!svg) return; anim($('.rg', svg), [{ strokeDashoffset: 169.6 }, { strokeDashoffset: 0 }], { d: 900, delay }); anim($('.ckp', svg), [{ strokeDashoffset: 40 }, { strokeDashoffset: 0 }], { d: 420, delay: delay + 650 }); }
const confColor = c => c >= 80 ? 'var(--ok)' : c >= 50 ? 'var(--warn)' : 'var(--faint)';
const refreshers = new Set(); const refresh = () => refreshers.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
let ctxRef = null;
const sectionEl = () => $('#v-remover .mod');

/* ================= uninstall flow ================= */
const STEPS = [T('Mode'), T('Prepare'), T('Uninstall'), T('Leftovers'), T('Review'), T('Done')];
function openFlow(progs, opts = {}) {
  const mod = sectionEl(); if (!mod || $('.rv-flow', mod)) return;
  const one = progs.length === 1 ? progs[0] : null;
  const prot = progs.some(p => p.prot); rememberIcons(progs);
  const f = document.createElement('div'); f.className = 'rv-flow';
  f.innerHTML = `<div class="rf-head">${one ? pi(one, true) : `<span class="pi lg" style="--h:200">${progs.length}</span>`}<div><h3>${one ? T('Uninstall {name}', { name: esc(one.name) }) : T('Leftovers from {n} programs', { n: progs.length })}</h3><div class="who">${one ? `${esc(one.pub)}, ${fmtMB(one.mb)}` : esc(progs.map(p => p.name).join(', '))}</div></div>
      <button class="iconbtn x" data-x aria-label="${T('Close')}">${ic('x')}</button></div>
    <div class="rf-steps"><div class="ln"><span></span></div>${STEPS.map((s, i) => `<div class="rf-st" data-i="${i}"><i>${i + 1}</i>${s}</div>`).join('')}</div>
    <div class="rf-body"></div><div class="rf-foot"><span class="t"></span></div>`;
  mod.appendChild(f);
  anim(f, [{ opacity: 0, transform: 'translate3d(0,24px,0) scale(.97)', filter: 'blur(10px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 520, e: EASE.spring });
  const body = $('.rf-body', f), foot = $('.rf-foot', f), lineSp = new Spring(0, 120, 18);
  const tk = dt => { lineSp.step(dt); $('.ln span', f).style.transform = `scaleX(${lineSp.v.toFixed(4)})`; }; tickers.add(tk);
  let step = -1, mode = opts.mode || (one && one.silent ? 'silent' : 'normal'), level = 'moderate', items = opts.items || [], sel = new Set(), closed = false, busy = false, answered = false;
  const MODE_NAME = { normal: TC('Normal'), silent: T('Silent'), forced: T('Forced') };
  function setStep(i) {
    const dir = i >= step ? 1 : -1; step = i; lineSp.t = i / (STEPS.length - 1);
    $$('.rf-st', f).forEach((s, k) => { s.classList.toggle('on', k === i); s.classList.toggle('done', k < i); $('i', s).innerHTML = k < i ? ic('check') : k + 1; });
    const on = $(`.rf-st[data-i="${i}"] i`, f); anim(on, [{ transform: 'scale(.7)' }, { transform: 'scale(1)' }], { d: 420, e: EASE.spring });
    return dir;
  }
  /* a footer that just replaced another ignores clicks for a moment: the second click of a double click on Start would
     land on the Cancel that takes its place */
  let footAt = 0;
  function setFoot(html) { foot.innerHTML = html; footAt = performance.now(); stagger([...foot.children], 0, 40); }
  foot.addEventListener('click', e => { if (performance.now() - footAt < 400) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  function close() {
    if (busy) { SH.toast(T('Wait for this step to finish.')); return; }
    closed = true; tickers.delete(tk);
    anim(f, [{ opacity: 1, transform: 'none', filter: 'blur(0px)' }, { opacity: 0, transform: 'translate3d(0,16px,0) scale(.98)', filter: 'blur(8px)' }], { d: 240, e: EASE.io }).finished.then(() => f.remove()).catch(() => f.remove());
  }
  f.addEventListener('click', e => { if (e.target.closest('[data-x]')) close(); });
  /* 1. mode */
  const LVL_HINT = { safe: T('Only what surely belongs to the program: its folder, shortcuts and keys with its name.'), moderate: T('Searches folders, shortcuts, registry, tasks, services and firewall. Recommended.'), advanced: T('Also checks file types, COM components, PATH and the installer registry. A deeper review.') };
  function stepMode() {
    const dir = setStep(0);
    const can = { silent: progs.every(p => p.silent || p.store), forced: !prot };
    swap(body, `<div class="mcards">
        <button class="mcard${mode === 'normal' ? ' on' : ''}" data-m="normal"><span class="mi">${ic('play')}</span><b>${MODE_NAME.normal}</b><span>${T('Opens the official uninstaller, with its windows, as if you ran it from Windows.')}</span></button>
        <button class="mcard${mode === 'silent' ? ' on' : ''}" data-m="silent"${can.silent ? '' : ' disabled'}><span class="mi">${ic('silent')}</span><b>${MODE_NAME.silent}</b><span>${can.silent ? T('No windows or questions. This installer supports it.') : T('This installer does not support silent mode.')}</span></button>
        <button class="mcard${mode === 'forced' ? ' on' : ''}" data-m="forced"${can.forced ? '' : ' disabled'}><span class="mi">${ic('force')}</span><b>${MODE_NAME.forced}</b><span>${can.forced ? T('For programs with a broken uninstaller: the scanner removes everything.') : T('Not available for protected components.')}</span></button></div>
      <div class="lvl"><div class="lbl">${T('Leftover search depth')}</div>${segHTML([['safe', T('Safe')], ['moderate', T('Moderate')], ['advanced', T('Advanced')]], level)}<div class="hint" id="lvlHint">${LVL_HINT[level]}</div></div>
      ${prot ? `<div class="pan" style="margin-top:18px;max-width:900px;font-size:12.5px;color:var(--mute)">${ic('shield')} <b style="color:var(--ink);font-weight:500">${T('Protected component.')}</b> ${T('Other programs may need it. The leftover search is limited to what is safe.')}</div>` : ''}`, dir, () => {
      $$('.mcard', body).forEach((c, i) => anim(c, [{ opacity: 0, transform: 'translate3d(0,14px,0) scale(.96)' }, { opacity: 1, transform: 'none' }], { d: 460, delay: 60 + i * 60, e: EASE.spring }));
      const sg = $('.seg', body); wireSeg(sg, v => { level = v; $('#lvlHint', body).textContent = LVL_HINT[v]; });
    });
    body.onclick = e => { const c = e.target.closest('.mcard'); if (!c || c.disabled) return; mode = c.dataset.m; $$('.mcard', body).forEach(x => x.classList.toggle('on', x === c)); anim($('.mi', c), [{ transform: 'scale(.7) rotate(-12deg)' }, { transform: 'none' }], { d: 420, e: EASE.spring }); };
    setFoot(`<span class="t">${one && one.silent ? T('This program supports <b>silent uninstall</b>.') : T('A restore point is created before anything is touched.')}</span><button class="btn ghost" data-x>${T('Cancel')}</button><button class="btn pri lg" id="rfGo">${T('Start')}</button>`);
    let armed = 0;
    $('#rfGo', f).onclick = e => {
      if (mode === 'forced' && !SH.requireAdmin(T('for forced uninstall: it deletes system files.'))) return;
      if (REAL() && mode === 'forced' && !armed) {  /* the irreversible needs a second click */
        const b = e.currentTarget; armed = setTimeout(() => { armed = 0; b.textContent = T('Start'); }, 4000);
        b.innerHTML = `${ic('alert')}${T('Click again: no official uninstaller')}`; anim(b, [{ transform: 'scale(.95)' }, { transform: 'none' }], { d: 300, e: EASE.spring }); return;
      }
      clearTimeout(armed);
      SH.sound('delete');  /* the uninstall is confirmed */
      REAL() && one ? realRun() : stepPrep();
    };
  }
  /* ---------- real path: a single engine task, and the UI follows its steps ---------- */
  /* English on purpose: they are compared with the engine's step label (data.label); shown through T() */
  const SCAN_STEPS = ['Files and folders', 'Shortcuts', 'Registry by name', 'Services, tasks, startup and firewall', 'File types and COM components'];
  async function realRun() {
    busy = true; let dir = setStep(1);
    swap(body, `<div class="checks">${ckRow('rp', 'restore', T('Restore point'), T('In case you want to go back'))}${ckRow('close', 'x', T('Close {name}', { name: one.name }), T('If it is open, it is closed gently'))}${ckRow('inst', 'eye', T('Official uninstaller'), one.store ? T('The Store package is removed') : T('It runs and all its processes are awaited'))}</div>`, dir, () => stagger($$('.ck', body), 40, 60));
    setFoot(`<span class="t">${T('Preparing. This takes a few seconds.')}</span><button class="btn ghost" id="rfCancel">${T('Cancel')}</button>`);
    let uninShown = false, scanShown = false, lastLabel = '', arcT = .08;
    const sp = new Spring(0, 60, 14); const t2 = dt => { sp.t = arcT; sp.step(dt); const a = $('#rfArc', body); if (a) a.style.strokeDashoffset = (326.7 * (1 - sp.v)).toFixed(2); };
    const STAT = { done: 'ok', warn: 'ok', skipped: 'ok', running: 'run' };
    /* the restore point alone can take minutes: the footer says so and counts the time */
    let rpTimer = 0;
    const rpStop = () => { clearInterval(rpTimer); rpTimer = 0; };
    const rpStart = () => {
      if (rpTimer) return; const t0 = Date.now();
      const s = $('.t', foot); if (s) s.innerHTML = `${esc(T('Creating a restore point. This can take a few minutes…'))} <span class="faint rv-el">${esc(T('Elapsed {time}', { time: mmss(0) }))}</span>`;
      rpTimer = setInterval(() => { const e = $('.rv-el', foot); if (!e || closed) { rpStop(); return; } e.textContent = T('Elapsed {time}', { time: mmss((Date.now() - t0) / 1000) }); }, 1000);
    };
    const act = SH.activity.start('remover', { key: 'uninstall', label: T('Uninstalling {name}', { name: one.name }), go: { tab: 'programs' } });
    const job = SH.job('remover', 'uninstall', [one.eid, { mode: mode === 'silent' ? 'quiet' : mode, level, restore_point: true }], { sound: 'task', activity: act, onProgress: m => {
      if (closed) { rpStop(); return; } const d = m.data || {};
      if (d.step === 'restore' && d.status === 'running') rpStart();
      else if (rpTimer) { rpStop(); const s = $('.t', foot); if (s && d.step === 'restore') s.textContent = T('Preparing. This takes a few seconds.'); }
      if (d.step === 'restore') { setCk('rp', STAT[d.status], { done: T('Created'), warn: T('Failed'), skipped: T('Not needed'), running: '' }[d.status]); if (d.status === 'warn' && d.detail) $(`.ck[data-c="rp"] .s`, body).textContent = d.detail; }
      if (d.step === 'close') setCk('close', STAT[d.status], d.status === 'done' ? (d.detail ? T('Closed: {names}', { names: d.detail }) : T('Was not open')) : '');
      if (d.step === 'uninstall') {
        if (d.status === 'skipped') setCk('inst', 'ok', T('Forced mode'));
        else if (!uninShown) {
          uninShown = true; setCk('inst', 'run'); dir = setStep(2); tickers.add(t2);
          swap(body, `<div class="unin"><div class="orb"><svg class="p" viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" fill="none" style="stroke:var(--raise2)" stroke-width="6"/><circle id="rfArc" cx="60" cy="60" r="52" fill="none" style="stroke:var(--accent)" stroke-width="6" stroke-linecap="round" stroke-dasharray="326.7" stroke-dashoffset="326.7" transform="rotate(-90 60 60)"/></svg>${pi(one, true)}</div>
            <div><h3 id="rfUt">${mode === 'silent' ? T('Uninstalling silently') : T('Waiting for the uninstaller')}</h3><p id="rfUp">${mode === 'silent' ? T('No windows. You do not need to do anything.') : T('Follow the steps in the uninstaller window. StellarHub waits for all its processes, not just the first one.')}</p><p class="faint" id="rfUd"></p></div></div>`, dir);
          setFoot(`<span class="t">${T('<b>{mode}</b> mode.', { mode: MODE_NAME[mode] })}</span><button class="btn ghost" id="rfCancel">${T('Stop waiting')}</button>`); wireCancel();
        }
        if (d.status === 'running') { arcT = Math.min(.9, arcT + .04); const u = $('#rfUd', body); if (u && d.detail) u.textContent = d.detail; }
        if (d.status === 'done' || d.status === 'warn') { arcT = 1; const h = $('#rfUt', body); if (h) h.textContent = d.status === 'done' ? T('Uninstaller finished') : T('The uninstaller finished with warnings'); const u = $('#rfUp', body); if (u) u.textContent = d.detail || T('Now we look for what it left behind.'); }
      }
      if (d.step === 'scan') {
        if (!scanShown) {
          scanShown = true; tickers.delete(t2); dir = setStep(3); SH.sound('scan_start');
          const rows = level === 'safe' ? SCAN_STEPS.slice(0, 4) : SCAN_STEPS;
          swap(body, `<div class="scan-grid">${rows.map((t, i) => ckRow('s' + i, ['folder', 'link', 'reg', 'gear', 'file'][i], TC(t), T('Waiting'))).join('')}</div>`, dir, () => stagger($$('.ck', body), 30, 30));
          setFoot(`<span class="t">${T('Looking for leftovers. Each one has a confidence from 0 to 100 and the reason.')}</span>`);
        }
        const lab = d.label || m.text || ''; const i = SCAN_STEPS.findIndex(s => lab.startsWith(s));
        if (i >= 0 && lab !== lastLabel) { lastLabel = lab; for (let k = 0; k < i; k++) { setCk('s' + k, 'ok'); const s = $(`.ck[data-c="s${k}"] .s`, body); if (s) s.textContent = T('Checked'); } setCk('s' + i, 'run'); const s = $(`.ck[data-c="s${i}"] .s`, body); if (s) s.textContent = T('Checking…'); }
      }
    } });
    function wireCancel() { const c = $('#rfCancel', f); if (c) c.onclick = () => { job.cancel(); c.disabled = true; c.textContent = T('Cancelling…'); }; }
    wireCancel();
    let res;
    try { res = await job; } catch (e) {
      act.end(e.cancelled ? { cancelled: true } : { ok: false, error: jobErr(e) });
      rpStop(); tickers.delete(t2); busy = false; if (closed) return;
      if (e.cancelled) { SH.toast(T('Cancelled. Nothing else was touched.')); close(); return; }
      swap(body, SH.emptyState({ art: 'error', small: true, title: T('Could not uninstall'), text: esc(jobErr(e)) })); setFoot(`<span class="t"></span><button class="btn pri" data-x>${T('Close')}</button>`); return;
    }
    rpStop(); tickers.delete(t2); busy = false;
    if (closed) { act.end(res && res.cancelled ? { cancelled: true } : { ok: true, summary: T('{name} uninstalled', { name: one.name }) }); return; }
    if (res.cancelled) { act.end({ cancelled: true }); SH.toast(T('Cancelled. The program is still installed.')); close(); return; }
    $$('.ck', body).forEach(c => { setCk(c.dataset.c, 'ok'); const s = $('.s', c); if (s) s.textContent = T('Checked'); });
    const sc = res.scan || { items: [], key: one.eid };
    items = sc.items.map(mapItem(sc.key, one.name)); sel = new Set(items.filter(l => l.selected).map(l => l.id));
    if (scanShown) SH.sound('scan_complete');
    act.end({ ok: true, summary: items.length ? T('{name} uninstalled. {n} leftovers to review.', { name: one.name, n: items.length }) : T('{name} uninstalled. Nothing was left behind.', { name: one.name }) });
    if (res.still_registered && mode !== 'forced') SH.toast(T('The program is still registered: maybe you cancelled the uninstaller. Review the leftovers carefully.'), { ms: 6000, kind: 'warning' });
    SH.logActivity(T('{name} uninstalled', { name: one.name }), { sub: SMODE[mode], ic: 'remover', go: 'remover', tab: 'history' });
    await wait(400); if (!closed) stepReview();
  }
  const ckRow = (id, icon, title, sub) => `<div class="ck" data-c="${id}"><span class="st">${ic(icon)}</span><div><b>${esc(title)}</b><span class="s">${esc(sub)}</span></div><span class="n"></span></div>`;
  const setCk = (id, state, n) => { const c = $(`.ck[data-c="${id}"]`, body); if (!c) return; c.classList.remove('run', 'ok'); if (state) c.classList.add(state); if (state === 'ok') { $('.st', c).innerHTML = ic('check'); anim($('.st', c), [{ transform: 'scale(.6)' }, { transform: 'none' }], { d: 400, e: EASE.spring }); } if (n != null) $('.n', c).textContent = n; };
  /* 2. prepare */
  async function stepPrep() {
    busy = true; const dir = setStep(1);
    swap(body, `<div class="checks">${ckRow('rp', 'restore', T('Restore point'), T('In case you want to go back'))}${ckRow('close', 'x', one ? T('Close {name}', { name: one.name }) : T('Close the programs'), T('If it is open, it is closed gently'))}${ckRow('snap', 'eye', T('System snapshot'), T('To find what it leaves behind later'))}</div>`, dir, () => stagger($$('.ck', body), 40, 60));
    setFoot(`<span class="t">${T('Preparing. This takes a few seconds.')}</span>`);
    await wait(300); if (closed) return; setCk('rp', 'run'); await API.restorePoint(); if (closed) return; setCk('rp', 'ok', T('Created'));
    setCk('close', 'run'); await API.closeApp(); if (closed) return; setCk('close', 'ok', T('Was not open'));
    setCk('snap', 'run'); await wait(600); if (closed) return; setCk('snap', 'ok', T('{n} entries', { n: SH.fmtInt(48213) })); await wait(400);
    if (closed) return; busy = false; mode === 'forced' ? stepScan() : stepUninstall();
  }
  /* 3. uninstall */
  async function stepUninstall() {
    busy = true; const dir = setStep(2);
    swap(body, `<div class="unin"><div class="orb"><svg class="p" viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" fill="none" style="stroke:var(--raise2)" stroke-width="6"/><circle id="rfArc" cx="60" cy="60" r="52" fill="none" style="stroke:var(--accent)" stroke-width="6" stroke-linecap="round" stroke-dasharray="326.7" stroke-dashoffset="326.7" transform="rotate(-90 60 60)"/></svg>${one ? pi(one, true) : `<span class="pi lg" style="--h:200">${progs.length}</span>`}</div>
      <div><h3 id="rfUt">${mode === 'silent' ? T('Uninstalling silently') : T('Waiting for the uninstaller')}</h3><p id="rfUp">${mode === 'silent' ? T('No windows. You do not need to do anything.') : T('Follow the steps in the uninstaller window. StellarHub waits for all its processes, not just the first one.')}</p></div></div>`, dir);
    setFoot(`<span class="t">${T('<b>{mode}</b> mode.', { mode: MODE_NAME[mode] })}</span>`);
    const sp = new Spring(0, 60, 14); const t2 = dt => { sp.step(dt); const a = $('#rfArc', body); if (a) a.style.strokeDashoffset = (326.7 * (1 - sp.v)).toFixed(2); }; tickers.add(t2);
    for (let i = 0; i < progs.length; i++) { if (closed) break; sp.t = (i + .55) / progs.length; await API.runUninstaller(progs[i], mode); sp.t = (i + 1) / progs.length; }
    await wait(500); tickers.delete(t2); if (closed) return;
    $('#rfUt', body).textContent = T('Uninstaller finished'); $('#rfUp', body).textContent = T('Now we look for what it left behind.'); await wait(600);
    if (closed) return; busy = false; stepScan();
  }
  /* 4. leftovers */
  async function stepScan() {
    busy = true; const dir = setStep(3);
    const cats = Object.keys(TYPES).filter(t => level !== 'safe' || ['folder', 'shortcut', 'reg'].includes(t));
    swap(body, `<div class="scan-grid">${cats.map(t => ckRow(t, TYPES[t][1], TYPES[t][0], T('Waiting'))).join('')}</div>`, dir, () => stagger($$('.ck', body), 30, 30));
    setFoot(`<span class="t">${T('Looking for leftovers. Each one has a confidence from 0 to 100 and the reason.')}</span>`);
    if (!opts.items) SH.sound('scan_start');
    const found = opts.items ? opts.items : await API.scan(progs, t => { if (closed) return; $$('.ck.run', body).forEach(c => { setCk(c.dataset.c, 'ok'); $('.s', c).textContent = T('Checked'); }); setCk(t, 'run'); const c = $(`.ck[data-c="${t}"] .s`, body); if (c) c.textContent = T('Checking…'); });
    if (closed) return;
    $$('.ck', body).forEach(c => { const n = found.filter(l => l.type === c.dataset.c).length; setCk(c.dataset.c, 'ok', n ? PL(n, '{n} leftover', '{n} leftovers') : T('None')); $('.s', c).textContent = n ? T('Found') : TC('Clean'); });
    if (!opts.items) SH.sound('scan_complete');
    items = found; sel = new Set(items.filter(l => l.conf >= 80 && !l.personal).map(l => l.id)); await wait(700);
    if (closed) return; busy = false; stepReview();
  }
  /* 5. review */
  function stepReview() {
    const dir = setStep(4);
    const groups = Object.keys(TYPES).map(t => [t, items.filter(l => l.type === t)]).filter(g => g[1].length);
    swap(body, items.length ? `<div class="rv-groups">${groups.map(([t, list]) => `<div class="rg" data-g="${t}"><h5>${list.some(l => !l.blocked) ? ALLCHK(`data-gall="${t}"`, T('Select all: {group}', { group: TYPES[t][0] })) : ''}${ic(TYPES[t][1])}${TYPES[t][0]} <span class="faint">${list.length}</span></h5>${list.sort((a, b) => (a.blocked - b.blocked) || (b.conf - a.conf)).map(l => `<button class="lo${l.blocked ? ' blk' : ''}" data-l="${esc(l.id)}"${l.blocked ? ' aria-disabled="true"' : ''}>${l.blocked ? `<span class="check lock">${ic('lock')}</span>` : CHK(sel.has(l.id))}<span class="p"><b>${esc(l.path)}</b><span>${esc(l.why)}${progs.length > 1 ? `. ${T('From {name}', { name: esc(l.prog) })}` : ''}</span></span><span class="conf" style="--c:${confColor(l.conf)}"><span class="bar"><span style="transform:scaleX(0)" data-v="${l.conf / 100}"></span></span><b>${l.conf}</b></span><span class="sz">${l.mb ? fmtMB(l.mb) : ''}</span></button>`).join('')}</div>`).join('')}</div>`
      : SH.emptyState({ art: 'ok', small: true, title: T('Nothing left'), text: T('The uninstaller removed everything. No cleanup needed.') }), dir, () => {
      stagger($$('.rg', body), 40, 50); syncGroups();
      setTimeout(() => $$('.conf .bar>span', body).forEach((b, i) => anim(b, [{ transform: 'scaleX(0)' }, { transform: `scaleX(${b.dataset.v})` }], { d: 700, delay: i * 18 })), 120);
    });
    const syncGroups = () => $$('.rg', body).forEach(g => { const ls = items.filter(l => l.type === g.dataset.g && !l.blocked); setTri($('[data-gall]', g), ls.filter(l => sel.has(l.id)).length, ls.length); });
    body.onkeydown = triKeys;
    body.onclick = e => {
      const ga = e.target.closest('[data-gall]');
      if (ga) {
        const ls = items.filter(l => l.type === ga.dataset.gall && !l.blocked); const all = ls.every(l => sel.has(l.id));
        ls.forEach(l => { if (all) sel.delete(l.id); else sel.add(l.id); const c = $(`.lo[data-l="${CSS.escape(l.id)}"] .check`, body); if (c) c.classList.toggle('on', sel.has(l.id)); });
        anim(ga, [{ transform: 'scale(.75)' }, { transform: 'none' }], { d: 320, e: EASE.spring }); sumFoot(); return;
      }
      const r = e.target.closest('.lo'); if (!r) return; if (r.classList.contains('blk')) { SH.toast(T('It is protected: StellarHub will not touch it.')); return; } const id = r.dataset.l; sel.has(id) ? sel.delete(id) : sel.add(id); const c = $('.check', r); c.classList.toggle('on', sel.has(id)); anim(c, [{ transform: 'scale(.75)' }, { transform: 'none' }], { d: 320, e: EASE.spring }); sumFoot(); };
    function sumFoot() {
      const s = items.filter(l => sel.has(l.id)); const mb = s.reduce((a, l) => a + l.mb, 0);
      $('.t', foot).innerHTML = items.length ? T('<b>{n} of {total}</b> selected, {size}. High-confidence items are selected by default. Everything goes to the quarantine.', { n: s.length, total: items.length, size: fmtMB(mb) }) : '';
      const b = $('#rfDel', f); if (b) b.disabled = !s.length || answered;
      syncGroups();
    }
    setFoot(`<span class="t"></span>${items.length ? `<button class="btn ghost" id="rfKeep">${T('Keep all')}</button><button class="btn pri lg" id="rfDel">${ic('trash')}${T('Remove selected')}</button>` : `<button class="btn pri lg" id="rfKeep">${T('Finish')}</button>`}`); sumFoot();
    /* one answer only: Keep all while the leftovers are being moved (or a double click) would finish twice, and its
       forget_scan would drop the scan the removal is still using */
    const keep = $('#rfKeep', f), del = $('#rfDel', f), answer = () => { if (answered) return false; answered = true; keep.disabled = true; if (del) del.disabled = true; return true; };
    keep.onclick = () => { if (answer()) stepDone([]); };
    if (del) del.onclick = async () => { if (!answer()) return; SH.sound('delete'); busy = true; del.innerHTML = T('Moving to the quarantine…'); const chosen = items.filter(l => sel.has(l.id)); stepDone(chosen); };
  }
  /* 6. done */
  async function realRemove(chosen) {
    /* one scan per program (or trace): each group is removed with its key; everything goes to the quarantine */
    const byKey = new Map(); items.forEach(l => { if (!byKey.has(l.key)) byKey.set(l.key, []); });
    chosen.forEach(l => byKey.get(l.key).push(l.eid));
    const out = { ok: 0, failed: 0, freed: 0, sessions: [], errors: [], restart: false, lost: 0 };
    for (const [key, ids] of byKey) {
      if (!ids.length) { SH.engine('remover', 'forget_scan', key).catch(() => {}); continue; }
      try {
        const r = await SH.job('remover', 'remove', [key, ids], { bg: true, label: T('Moving to the quarantine…'), onProgress: m => { const t = $('.t', foot); if (t && m.text) t.textContent = T('Moving to the quarantine: {item}', { item: m.text }); } });
        out.ok += r.ok || 0; out.failed += r.failed || 0; out.freed += r.freed || 0; if (r.session) out.sessions.push(r.session); out.errors.push(...(r.errors || []));
        if (r.restart_required) out.restart = true; out.lost += r.reboot_unrestorable || 0;
      } catch (e) { out.failed += ids.length; out.errors.push(jobErr(e)); }
    }
    return out;
  }
  async function stepDone(chosen) {
    if (REAL()) {
      busy = true; const r = await realRemove(chosen); busy = false; if (closed) return;
      const dir = setStep(5);
      swap(body, `<div class="fin">${ring('ring')}<div><h3>${one ? T('{name}: done', { name: esc(one.name) }) : T('{n} programs: done', { n: progs.length })}</h3><p>${chosen.length ? `${r.failed ? PL(r.ok, 'Moved to the quarantine: {n} leftover, {failed} could not be moved.', 'Moved to the quarantine: {n} leftovers, {failed} could not be moved.', { failed: r.failed }) : PL(r.ok, 'Moved to the quarantine: {n} leftover.', 'Moved to the quarantine: {n} leftovers.')} ${T('You can undo this for {days} days.', { days: qDays })}` : T('No leftovers were removed.')}</p>
        ${r.restart ? `<p class="rm-restart">${ic('alert')}<span>${T('Some files were in use and leave at the next restart. Restart the PC before installing it again.')}${r.lost ? ' ' + PL(r.lost, '{n} of them is deleted, not kept in the quarantine.', '{n} of them are deleted, not kept in the quarantine.') : ''}</span></p>` : ''}
        ${r.errors.length ? `<p class="faint" style="font-size:12px">${esc(r.errors.slice(0, 3).join(' · '))}</p>` : ''}
        <div class="fin-stats"><div><b>${r.ok}</b><span>${T('leftovers removed')}</span></div><div><b>${fmtMB(r.freed / 1048576)}</b><span>${T('freed')}</span></div><div><b>${MODE_NAME[mode]}</b><span>${T('mode')}</span></div></div></div></div>`, dir, () => playRing($('svg.ring', body), 100));
      setFoot(`<span class="t">${r.sessions.length ? T('Everything is in the quarantine in case something stopped working.') : ''}</span>${r.sessions.length ? `<button class="btn ghost" id="rfUndo">${ic('restore')}${T('Undo')}</button>` : ''}<button class="btn pri" data-x>${T('Done')}</button>`);
      const u = $('#rfUndo', f); if (u) u.onclick = async () => {
        SH.sound('undo'); u.disabled = true; u.textContent = T('Restoring…');
        /* what could not be put back is said (the engine counts it in `failed`), never "put back in place" for it */
        let back = 0, failed = 0, why = '';
        for (const sid of r.sessions) { try { const q = await SH.job('remover', 'quarantine_restore', [sid]) || {}; back += q.ok || 0; failed += q.failed || 0; why = why || (q.errors || [])[0] || ''; } catch (e) { failed++; why = why || jobErr(e); } }
        if (failed) SH.toast(PL(failed, 'Could not restore {n} item: {error}', 'Could not restore {n} items: {error}', { error: why }), { ms: 6000, kind: 'error' });
        if (!back) { u.disabled = false; u.innerHTML = `${ic('restore')}${T('Undo')}`; ensureReal(true).then(refresh); return; }
        if (!failed) SH.toast(T('Leftovers put back in place.')); SH.logActivity(T('Leftovers put back in place'), { sub: one ? one.name : T('{n} programs', { n: progs.length }), ic: 'restore', go: 'remover', tab: 'quarantine' });
        ensureReal(true).then(refresh); close();
      };
      ensureReal(true).then(refresh); opts.onDone && opts.onDone(); return;
    }
    busy = true; const session = await API.remove(progs, chosen, mode); busy = false; if (closed) return;
    const dir = setStep(5); const mb = chosen.reduce((a, l) => a + l.mb, 0);
    swap(body, `<div class="fin">${ring('ring')}<div><h3>${one ? T('{name} uninstalled', { name: esc(one.name) }) : T('{n} programs uninstalled', { n: progs.length })}</h3><p>${chosen.length ? `${PL(chosen.length, 'Moved to the quarantine: {n} leftover.', 'Moved to the quarantine: {n} leftovers.')} ${T('You can undo this for {days} days.', { days: qDays })}` : T('No leftovers were removed.')}</p>
      <div class="fin-stats"><div><b>${chosen.length}</b><span>${T('leftovers removed')}</span></div><div><b>${fmtMB(mb + progs.reduce((a, p) => a + p.mb, 0))}</b><span>${T('freed in total')}</span></div><div><b>${MODE_NAME[mode]}</b><span>${T('mode')}</span></div></div></div></div>`, dir, () => playRing($('svg.ring', body), 100));
    setFoot(`<span class="t">${T('A restore point is kept in case something stopped working.')}</span>${chosen.length ? `<button class="btn ghost" id="rfUndo">${ic('restore')}${T('Undo')}</button>` : ''}<button class="btn pri" data-x>${T('Done')}</button>`);
    const u = $('#rfUndo', f); if (u) u.onclick = async () => { SH.sound('undo'); await API.restore(session); refresh(); SH.toast(T('Leftovers put back in place.')); close(); };
    refresh(); opts.onDone && opts.onDone();
  }
  if (opts.startAt === 'review') { items = opts.items; sel = new Set(items.filter(l => l.selected !== undefined ? l.selected : (l.conf >= 80 && !l.personal)).map(l => l.id)); step = 3; stepReview(); }
  else stepMode();
}

/* ================= Programs ================= */
function renderPrograms(el, ctx) {
  el.classList.add('fill');
  el.innerHTML = `<div class="rv-left pan rv-listwrap" data-asm><div class="rv-tools"><label class="field">${ic('search')}<input id="rpQ" placeholder="${T('Search for a program or publisher')}" spellcheck="false"></label>
      ${segHTML([['all', TC('All')], ['recent', T('Recent')], ['big', TC('Large')], ['store', T('Store')], ['sys', T('System')]], 'all')}<span class="cnt" id="rpCnt"></span></div>
    <div class="tbl-head rv-cols"><button data-s="name" class="on">${T('Program')}${ic('sortaz')}</button><button data-s="ver">${T('Version')}${ic('sortaz')}</button><button data-s="mb">${T('Size')}${ic('sortaz')}</button><button data-s="date">${T('Installed')}${ic('sortaz')}</button></div>
      <div class="rv-scroll" id="rpList"></div></div>
    <div class="pan rv-detail" data-asm><div class="rv-dscroll" id="rpDetail"></div></div>`;
  const list = $('#rpList', el); let q = '', filt = 'all', sort = 'name', desc = false, selected = null;
  const rowHTML = p => `<button class="pr rv-cols" data-p="${p.id}"><span class="nm">${pi(p)}<span style="min-width:0"><b>${esc(p.name)}${p.prot ? `<span class="tagp">${T('protected')}</span>` : ''}</b><span>${esc(p.pub)}</span></span></span><span class="c">${esc(p.ver)}</span><span class="c sz">${fmtMB(p.mb)}</span><span class="c">${fmtDate(p.date)}</span></button>`;
  function build() { list.innerHTML = PROGRAMS.map(rowHTML).join(''); apply(false); }
  function visible(p) {
    const qq = q.toLowerCase(); const okQ = !qq || (p.name + ' ' + p.pub).toLowerCase().includes(qq);
    const okF = filt === 'all' || (filt === 'recent' && daysSince(p.date) <= 14) || (filt === 'big' && p.mb >= 1000) || (filt === 'store' && p.store) || (filt === 'sys' && p.prot);
    return okQ && okF;
  }
  const cmp = { name: (a, b) => a.name.localeCompare(b.name, 'en-US'), ver: (a, b) => a.ver.localeCompare(b.ver, 'en-US', { numeric: true }), mb: (a, b) => b.mb - a.mb, date: (a, b) => (b.date || 0) - (a.date || 0) };
  function apply(animate) {
    const order = PROGRAMS.slice().sort((a, b) => (desc ? -1 : 1) * cmp[sort](a, b));
    const doIt = () => { order.forEach(p => { const r = $(`.pr[data-p="${p.id}"]`, list); if (r) { r.hidden = !visible(p); list.appendChild(r); } }); };
    animate ? flip(list, doIt) : doIt();
    const vis = order.filter(visible); $('#rpCnt', el).textContent = PL(vis.length, '{n} program, {size} GB', '{n} programs, {size} GB', { size: fmt1(vis.reduce((a, p) => a + p.mb, 0) / 1024) });
    if (!animate) stagger($$('.pr:not([hidden])', list).slice(0, 16), 60, 22);
  }
  $$('.tbl-head button', el).forEach(b => b.addEventListener('click', () => {
    if (sort === b.dataset.s) desc = !desc; else { sort = b.dataset.s; desc = false; }
    $$('.tbl-head button', el).forEach(x => { x.classList.toggle('on', x === b); x.classList.toggle('desc', x === b && desc); }); apply(true);
  }));
  let qt = 0; $('#rpQ', el).addEventListener('input', e => { q = e.target.value.trim(); clearTimeout(qt); qt = setTimeout(() => { apply(false); }, 110); });
  wireSeg($('.seg', el), v => { filt = v; apply(false); });
  list.addEventListener('click', e => { const r = e.target.closest('.pr'); if (r) select(PROGRAMS.find(p => p.id === r.dataset.p), r); });
  list.addEventListener('dblclick', e => { const r = e.target.closest('.pr'); if (r) openFlow([PROGRAMS.find(p => p.id === r.dataset.p)]); });
  const det = $('#rpDetail', el);
  function summary() {
    const top = PROGRAMS.slice().sort((a, b) => b.mb - a.mb).slice(0, 4); const max = top[0] ? top[0].mb : 1;
    const recent = PROGRAMS.filter(p => p.date).sort((a, b) => b.date - a.date).slice(0, 3);
    return `<div class="rs"><h4 class="pan-h">${T('Summary')}</h4><div class="tot">${PROGRAMS.length}<small>${PROGRAMS.length === 1 ? T('program') : TC('programs')}</small></div><div class="sub">${T('{size} GB in total. Pick one to see its details or uninstall it; double-click goes straight there.', { size: fmt1(totalGB()) })}</div>
      <h4 class="pan-h">${TC('Largest')}</h4><div class="rs-top">${top.map(p => `<button data-p="${p.id}"><span>${esc(p.name)}</span><span class="muted">${fmtMB(p.mb)}</span><span class="bar acc"><span style="transform:scaleX(0)" data-v="${(p.mb / max).toFixed(3)}"></span></span></button>`).join('')}</div>
      <h4 class="pan-h">${TC('Recently installed')}</h4><div class="rows">${recent.map(p => `<button class="row" data-p="${p.id}" style="text-align:left;padding:6px 8px;margin:0 -8px">${pi(p)}<span class="rt"><b>${esc(p.name)}</b><span>${daysSince(p.date) === 0 ? T('today') : PL(daysSince(p.date), '{n} day ago', '{n} days ago')}</span></span></button>`).join('')}</div></div>`;
  }
  function growBars() { setTimeout(() => $$('.rs-top .bar>span', det).forEach((b, i) => { b.style.transform = `scaleX(${b.dataset.v})`; b.style.transitionDelay = i * 60 + 'ms'; }), 60); }
  function showSummary(first) { selected = null; if (first) { det.innerHTML = summary(); growBars(); } else swap(det, summary(), -1, growBars); }
  function select(p, row) {
    if (!p) return; selected = p; $$('.pr.sel', list).forEach(x => x.classList.remove('sel')); if (row) row.classList.add('sel');
    swap(det, `<div class="rd-top">${pi(p, true)}<div style="min-width:0"><h3>${esc(p.name)}</h3><div class="who">${esc(p.pub)}</div></div></div>
      <div class="rd-chips">${p.arch ? `<span class="chip">${typeof p.arch === 'number' ? T('{n}-bit', { n: p.arch }) : esc(ENGINE_TEXT[p.arch] || p.arch)}</span>` : ''}${p.store ? '<span class="chip acc">Microsoft Store</span>' : ''}${p.prot ? `<span class="chip warn">${T('Protected')}</span>` : ''}${p.silent && !p.prot ? `<span class="chip ok">${T('Supports silent mode')}</span>` : ''}${p.audio ? `<span class="chip">${T('Audio plugins')}</span>` : ''}</div>
      <dl><dt>${T('Version')}</dt><dd>${esc(p.ver || '—')}</dd><dt>${T('Installed')}</dt><dd>${fmtDate(p.date)}</dd><dt>${T('Size on disk')}</dt><dd>${fmtMB(p.mb)}</dd>${p.kindLabel ? `<dt>${T('Installer')}</dt><dd>${esc(ENGINE_TEXT[p.kindLabel] || p.kindLabel)}</dd>` : ''}<dt>${T('Location')}</dt><dd>${esc(p.loc || '—')}</dd><dt>${T('Uninstaller')}</dt><dd id="rdCmd">${esc(p.cmd || (REAL() ? T('Checking…') : '—'))}</dd></dl>
      ${p.broken || p.noUninst ? `<div class="rnote">${T('The official uninstaller is missing or broken: use forced mode, which removes everything with the leftover scanner.')}</div>` : ''}<div id="rdProcs"></div>
      ${p.prot ? `<div class="rnote">${T('Other programs may need it (runtimes, drivers, antivirus, VPN). It can be removed, but without forced mode and with a limited leftover search.')}</div>` : ''}
      <div class="rd-acts"><button class="btn pri lg" data-a="un">${ic('remover')}${T('Uninstall')}</button><div class="row2"><button class="btn sec" data-a="loc">${ic('folder')}${T('Location')}</button><button class="btn sec" data-a="web">${ic('globe')}${T('Search online')}</button></div></div>`);
    if (REAL() && p.eid) {
      const want = p; SH.engine('remover', 'details', p.eid).then(async d => {
        if (!d || selected !== want) return;
        want.cmd = d.uninstall_string || d.command || (want.store ? T('Remove the Store package') : T('None'));
        for (let i = 0; i < 40 && !$('#rdCmd', det); i++) await wait(30);
        const c = $('#rdCmd', det); if (c && selected === want) { c.textContent = want.cmd; anim(c, [{ opacity: 0 }, { opacity: 1 }], { d: 260 }); }
        const pr = $('#rdProcs', det); if (pr && d.processes && d.processes.length && selected === want) pr.innerHTML = `<div class="rnote">${T('It is open ({names}). It will be closed gently before uninstalling.', { names: esc(d.processes.map(x => x.name).slice(0, 3).join(', ')) })}</div>`;
      }).catch(e => { const c = $('#rdCmd', det); if (c) c.textContent = jobErr(e); });
    }
  }
  det.addEventListener('click', e => {
    const pb = e.target.closest('[data-p]'); if (pb) { const p = PROGRAMS.find(x => x.id === pb.dataset.p); const r = $(`.pr[data-p="${p.id}"]`, list); if (r) r.scrollIntoView({ block: 'center', behavior: 'smooth' }); select(p, r); return; }
    const a = e.target.closest('[data-a]'); if (!a || !selected) return;
    if (a.dataset.a === 'un') openFlow([selected], { onDone: () => {} });
    if (a.dataset.a === 'loc') { if (REAL()) SH.engine('remover', 'open_path', selected.loc).then(ok => { if (!ok) SH.toast(T('It has no folder to open.')); }); else SH.toast(T('Opening {path} (simulated).', { path: selected.loc })); }
    if (a.dataset.a === 'web') { if (REAL()) SH.engine('remover', 'search_web', selected.name); else SH.toast(T('Searching online for "{name}" (simulated).', { name: selected.name })); }
  });
  if (REAL()) {
    list.innerHTML = `<div class="sk-rows" style="padding:8px">${Array.from({ length: 9 }, (_, k) => `<div class="sk-row"><div class="sk a" style="--dl:${k * .07}s"></div><div class="sk b" style="--w:${[38, 52, 30, 46, 41][k % 5]}%;--dl:${k * .07}s"></div><div class="sk c"></div></div>`).join('')}</div>`;
    $('#rpCnt', el).textContent = T('Reading installed programs…');
    ensureReal().then(() => { build(); showSummary(true); }).catch(e => { list.innerHTML = SH.emptyState({ art: 'error', title: T('Could not read the program list'), text: esc(jobErr(e)) }); });
  } else { build(); showSummary(true); }
  refreshers.add(() => {
    const ids = new Set(PROGRAMS.map(p => p.id));
    $$('.pr', list).forEach(r => { if (!ids.has(r.dataset.p)) { anim(r, [{ opacity: 1 }, { opacity: 0, transform: 'translateX(30px)' }], { d: 220 }).finished.then(() => flip(list, () => r.remove())).catch(() => r.remove()); } });
    PROGRAMS.forEach(p => { if (!$(`.pr[data-p="${p.id}"]`, list)) list.insertAdjacentHTML('beforeend', rowHTML(p)); });
    if (selected && !ids.has(selected.id)) showSummary(false); setTimeout(() => apply(true), 260);
  });
  SH.remover = { select: key => { const p = PROGRAMS.find(x => x.eid === key || x.id === key || x.name === key); if (!p) return; filt = 'all'; q = ''; $('#rpQ', el).value = ''; apply(false); const r = $(`.pr[data-p="${p.id}"]`, list); if (r) r.scrollIntoView({ block: 'center' }); select(p, r); } };
}

/* ================= Batch ================= */
const QUEUE_EMPTY = SH.emptyState({ art: 'first', small: true, title: T('The queue is empty'), text: T('Select the programs you want to remove on the left.') });
function renderBatch(el) {
  el.classList.add('fill', 'rv-batch');
  el.innerHTML = `<div class="rv-left pan rv-listwrap" data-asm><div class="rv-tools"><label class="field">${ic('search')}<input id="rbQ" placeholder="${T('Filter programs')}" spellcheck="false"></label><span class="cnt" id="rbCnt"></span></div>
    <div class="tbl-head rv-cols">${ALLCHK('id="rbAll"', T('Select all programs'))}<span>${T('Program')}</span><span>${T('Size')}</span><span>${T('Installed')}</span></div><div class="rv-scroll" id="rbList"></div></div>
    <div class="pan rq" data-asm><h4 class="pan-h">${T('Uninstall queue')} <em id="rbN">0</em></h4><div class="opts">${segHTML([['silent', T('Silent when possible')], ['normal', T('With windows')]], 'silent')}</div>
      <div class="list" id="rbQueue">${QUEUE_EMPTY}</div>
      <div class="rd-acts"><button class="btn pri lg" id="rbGo" disabled>${ic('remover')}${T('Uninstall')}</button></div></div>`;
  const list = $('#rbList', el), queue = $('#rbQueue', el); const sel = new Set(); let mode = 'silent', running = false, q = '';
  const avail = () => PROGRAMS.filter(p => !p.prot);
  function build() {
    list.innerHTML = avail().map(p => `<button class="pr rv-cols" data-p="${p.id}">${CHK(sel.has(p.id))}<span class="nm">${pi(p)}<span style="min-width:0"><b>${esc(p.name)}</b><span>${esc(p.pub)}</span></span></span><span class="c sz">${fmtMB(p.mb)}</span><span class="c">${fmtDate(p.date)}</span></button>`).join('');
    filter(); stagger($$('.pr', list).slice(0, 16), 60, 22);
  }
  function filter() { const qq = q.toLowerCase(); let n = 0; $$('.pr', list).forEach(r => { const p = PROGRAMS.find(x => x.id === r.dataset.p); r.hidden = !!qq && !(p.name + ' ' + p.pub).toLowerCase().includes(qq); if (!r.hidden) n++; });
    /* the Programs tab lists everything; here the protected components (runtimes, drivers, security) are left out on purpose */
    const nProt = PROGRAMS.length - avail().length, cn = $('#rbCnt', el);
    cn.textContent = PL(n, '{n} program', '{n} programs') + (nProt ? ' · ' + T('{m} protected not listed', { m: nProt }) : '');
    cn.title = nProt ? T('Protected components are not offered for batch uninstall. You can still find them in the Programs tab.') : '';
    syncAll(); }
  const shown = () => $$('.pr', list).filter(r => !r.hidden).map(r => r.dataset.p);
  function syncAll() { const ids = shown(); setTri($('#rbAll', el), ids.filter(id => sel.has(id)).length, ids.length); }
  $('#rbAll', el).addEventListener('keydown', triKeys);
  $('#rbAll', el).addEventListener('click', e => {
    if (running) return; const ids = shown(); if (!ids.length) return; const all = ids.every(id => sel.has(id));
    ids.forEach(id => { if (all) sel.delete(id); else sel.add(id); const c = $(`.pr[data-p="${id}"] .check`, list); if (c) c.classList.toggle('on', sel.has(id)); });
    anim(e.currentTarget, [{ transform: 'scale(.75)' }, { transform: 'none' }], { d: 320, e: EASE.spring }); drawQueue();
  });
  $('#rbQ', el).addEventListener('input', e => { q = e.target.value.trim(); filter(); });
  wireSeg($('.seg', el), v => { mode = v; });
  function drawQueue() {
    const ps = [...sel].map(id => PROGRAMS.find(p => p.id === id)).filter(Boolean); syncAll();
    $('#rbN', el).textContent = ps.length; $('#rbGo', el).disabled = !ps.length || running;
    $('#rbGo', el).innerHTML = `${ic('remover')}${ps.length ? PL(ps.length, 'Uninstall {n} program, {size}', 'Uninstall {n} programs, {size}', { size: fmtMB(ps.reduce((a, p) => a + p.mb, 0)) }) : T('Uninstall')}`;
    if (!ps.length) { queue.innerHTML = QUEUE_EMPTY; return; }
    flip(queue, () => {
      $$('.empty', queue).forEach(x => x.remove());
      $$('.qi', queue).forEach(x => { if (!sel.has(x.dataset.p)) x.remove(); });
      ps.forEach(p => { if (!$(`.qi[data-p="${p.id}"]`, queue)) { queue.insertAdjacentHTML('beforeend', `<div class="qi" data-p="${p.id}">${pi(p)}<span class="rt"><b>${esc(p.name)}</b><span>${p.silent ? T('Silent') : TC('Normal')}, ${fmtMB(p.mb)}</span></span><span class="chip">${TC('Queued')}</span><span class="fill"></span></div>`); const n = queue.lastElementChild; anim(n, [{ opacity: 0, transform: 'translate3d(20px,0,0) scale(.96)' }, { opacity: 1, transform: 'none' }], { d: 420, e: EASE.spring }); } });
    });
  }
  list.addEventListener('click', e => { if (running) return; const r = e.target.closest('.pr'); if (!r) return; const id = r.dataset.p; sel.has(id) ? sel.delete(id) : sel.add(id); const c = $('.check', r); c.classList.toggle('on', sel.has(id)); anim(c, [{ transform: 'scale(.75)' }, { transform: 'none' }], { d: 320, e: EASE.spring }); drawQueue(); });
  $('#rbGo', el).addEventListener('click', async () => {
    const ps = [...sel].map(id => PROGRAMS.find(p => p.id === id)).filter(Boolean); if (!ps.length || running) return;
    SH.sound('delete');  /* the batch uninstall is confirmed */
    running = true; drawQueue();
    let all = [];
    const chipOf = p => { const it = $(`.qi[data-p="${p.id}"]`, queue); return it ? { chip: $('.chip', it), fill: $('.fill', it) } : null; };
    const setChip = (p, t, c, fillTo) => { const o = chipOf(p); if (!o) return; o.chip.className = 'chip ' + (c || ''); o.chip.textContent = t; anim(o.chip, [{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }], { d: 280, e: EASE.spring }); if (fillTo != null) anim(o.fill, [{ transform: `scaleX(${fillTo > .5 ? .5 : 0})` }, { transform: `scaleX(${fillTo})` }], { d: 900 }); };
    /* say what is happening: the restore point alone can take a few minutes before anything else moves */
    const goSay = (text, icon = 'restore') => { const b = $('#rbGo', el); if (b) { b.innerHTML = `${ic(icon)}${esc(text)}`; anim(b, [{ opacity: .6 }, { opacity: 1 }], { d: 240 }); } };
    ps.forEach(p => setChip(p, T('Waiting')));
    if (REAL()) {
      const byId = new Map(ps.map(p => [p.eid, p]));
      goSay(T('Getting ready…'));
      let rpT0 = 0, rpTimer = 0, rpToast = false;
      const rpStop = () => { clearInterval(rpTimer); rpTimer = 0; };
      const rpSay = () => goSay(T('Creating a restore point. This can take a few minutes…') + (rpT0 ? ' ' + T('Elapsed {time}', { time: mmss((Date.now() - rpT0) / 1000) }) : ''));
      try {
        const r = await SH.job('remover', 'batch_uninstall', [ps.map(p => p.eid), { quiet: mode === 'silent', level: 'moderate', restore_point: true }], { sound: 'task', onProgress: m => {
          const d = m.data || {};
          if (d.pid == null) {                     // no program yet: the restore point step
            if (d.step !== 'restore') return;
            if (d.status === 'running') { if (!rpTimer) { rpT0 = Date.now(); rpSay(); rpTimer = setInterval(() => { const b = $('#rbGo', el); if (!b) { rpStop(); return; } b.lastChild.textContent = T('Creating a restore point. This can take a few minutes…') + ' ' + T('Elapsed {time}', { time: mmss((Date.now() - rpT0) / 1000) }); }, 1000); } }
            else { rpStop(); goSay(T('Uninstalling…'), 'remover'); if (d.status === 'warn' && !rpToast) { rpToast = true; SH.toast(T('The restore point could not be created: {why}', { why: d.detail || T('Windows did not say why') }), { ms: 7000, kind: 'warning' }); } }
            return;
          }
          rpStop();
          const p = byId.get(d.pid); if (!p) return;
          if (d.status === 'running') goSay(T('Uninstalling {name}…', { name: p.name }), 'remover');
          if (d.status === 'running') setChip(p, T('Uninstalling'), 'acc', .6);
          else setChip(p, d.status === 'done' ? T('Done') : d.status === 'warn' ? T('With warnings') : T('Failed'), d.status === 'error' ? 'bad' : d.status === 'warn' ? 'warn' : 'ok', 1);
        } });
        (r.results || []).forEach(x => { const p = byEid.get(x.program.id); if (x.scan) all = all.concat(x.scan.items.map(mapItem(x.scan.key, p ? p.name : x.program.name))); if (p && !x.error) setChip(p, PL(x.scan ? x.scan.items.length : 0, '{n} leftover', '{n} leftovers'), 'ok'); if (p && x.error) setChip(p, x.error.slice(0, 40), 'bad'); });
        SH.logActivity(T('{n} programs uninstalled in a batch', { n: ps.length }), { ic: 'remover', go: 'remover', tab: 'history' });
      } catch (e) { SH.toast(jobErr(e), { kind: 'error' }); } finally { rpStop(); }
      running = false;
      const done = document.createElement('div'); done.className = 'rd-acts'; done.style.marginTop = '8px';
      done.innerHTML = `<button class="btn sec lg" id="rbReview">${ic('eye')}${PL(all.length, 'Review {n} leftover', 'Review {n} leftovers')}</button>`;
      $('#rbGo', el).parentElement.replaceWith(done); anim(done, [{ opacity: 0, transform: 'translate3d(0,8px,0)' }, { opacity: 1, transform: 'none' }], { d: 420, e: EASE.spring });
      $('#rbReview', el).addEventListener('click', () => openFlow(ps, { startAt: 'review', items: all, mode: mode === 'silent' ? 'silent' : 'normal', onDone: () => { sel.clear(); renderBatch(el); } }));
      ensureReal(true).then(refresh);
      return;
    }
    await API.restorePoint();
    for (const p of ps) {
      const it = $(`.qi[data-p="${p.id}"]`, queue); const chip = $('.chip', it); const fill = $('.fill', it);
      const set = (t, c) => { chip.className = 'chip ' + (c || ''); chip.textContent = t; anim(chip, [{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }], { d: 280, e: EASE.spring }); };
      set(T('Uninstalling'), 'acc'); anim(fill, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(.7)' }], { d: 1600 });
      await API.runUninstaller(p, mode === 'silent' && p.silent ? 'silent' : 'normal');
      set(T('Looking for leftovers'), 'acc'); anim(fill, [{ transform: 'scaleX(.7)' }, { transform: 'scaleX(1)' }], { d: 700 }); await wait(700);
      const lo = leftoversFor(p); all = all.concat(lo); set(PL(lo.length, '{n} leftover', '{n} leftovers'), 'ok');
    }
    running = false;
    const done = document.createElement('div'); done.className = 'rd-acts'; done.style.marginTop = '8px';
    done.innerHTML = `<button class="btn sec lg" id="rbReview">${ic('eye')}${PL(all.length, 'Review {n} leftover', 'Review {n} leftovers')}</button>`;
    $('#rbGo', el).parentElement.replaceWith(done); anim(done, [{ opacity: 0, transform: 'translate3d(0,8px,0)' }, { opacity: 1, transform: 'none' }], { d: 420, e: EASE.spring });
    $('#rbReview', el).addEventListener('click', () => openFlow(ps, { startAt: 'review', items: all, mode: mode === 'silent' ? 'silent' : 'normal', onDone: () => { sel.clear(); renderBatch(el); } }));
  });
  if (REAL()) { list.innerHTML = `<div class="empty"><b>${T('Reading programs…')}</b></div>`; ensureReal().then(() => { build(); drawQueue(); }).catch(e => { list.innerHTML = SH.emptyState({ art: 'error', small: true, title: T('Could not read the list'), text: esc(jobErr(e)) }); }); }
  else { build(); drawQueue(); }
  refreshers.add(() => { if (!running && el.isConnected) { const keep = [...sel].filter(id => PROGRAMS.some(p => p.id === id)); sel.clear(); keep.forEach(id => sel.add(id)); build(); drawQueue(); } });
}

/* ================= Watched install ================= */
function renderWatch(el) {
  el.innerHTML = `<div class="wv">
    <div class="pan wv-hero" data-asm><div class="wv-eye" id="wvEye"><i style="--in:0"></i><i style="--in:18px"></i><span class="pulse"></span><span class="pulse"></span><span class="pulse"></span><span class="core">${ic('eye')}</span></div>
      <div id="wvBody"></div>
      <ol class="wv-steps"><li><b>${T('Initial snapshot')}</b><span>${T('Files, registry, services and tasks as they are now.')}</span></li><li><b>${T('You install')}</b><span>${T('Use the installer as usual; StellarHub only watches.')}</span></li><li><b>${T('Final snapshot')}</b><span>${T('Compares both and saves what the installer created.')}</span></li></ol></div>
    <div class="pan wv-listp" data-asm><h4>${T('Watched installs')} <em id="wvN">${traces.length}</em></h4><div class="tbl-head wv-cols"><span>${TC('Install')}</span><span>${T('Files')}</span><span>${T('Keys')}</span><span>${T('Size')}</span><span></span></div><div class="rows wv-scroll" id="wvList"></div></div></div>`;
  const eye = $('#wvEye', el), wb = $('#wvBody', el), wl = $('#wvList', el);
  const trRow = t => `<div class="row wv-cols" data-t="${t.id}"><span class="rt"><b>${esc(t.name)}</b><span>${fmtDate(t.date)}</span></span><span class="muted">${t.files}</span><span class="muted">${t.keys}</span><span class="muted">${fmtMB(t.mb)}</span><span style="display:flex;gap:4px"><button class="btn sm sec" data-a="undo">${T('Remove what it installed')}</button><button class="btn sm ghost" data-a="del" title="${T('Forget')}">${ic('trash')}</button></span></div>`;
  wl.innerHTML = traces.map(trRow).join('');
  function idle() {
    eye.classList.remove('on');
    swap(wb, `<h3>${T('Watch an install')}</h3><p>${T('StellarHub takes a snapshot of the system before you install something and another when it finishes. Then you can remove exactly what it created, without relying on its uninstaller.')}</p>
      <div class="wv-form"><label class="field">${ic('package')}<input id="wvName" placeholder="${T('What are you installing (for example, a plugin)')}" spellcheck="false"></label><button class="btn pri" id="wvStart">${ic('eye')}${T('Take the initial snapshot')}</button></div>`);
  }
  let timer = 0;
  async function start(name) {
    swap(wb, `<h3>${T('Taking the initial snapshot')}</h3><p>${T('Files, keys, services and tasks are recorded. This takes a few seconds.')}</p><div class="bar" style="margin-top:16px;max-width:420px"><span id="wvBar" style="transform:scaleX(0)"></span></div>`);
    await wait(200); const b = $('#wvBar', wb); if (b) anim(b, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { d: 2200, e: EASE.io }); await wait(2300);
    eye.classList.add('on'); anim($('.core', eye), [{ transform: 'scale(.7)' }, { transform: 'none' }], { d: 500, e: EASE.spring });
    const c = { f: 0, k: 0, s: 0, t: 0 }; const t0 = Date.now();
    swap(wb, `<h3>${T('Watching: {name}', { name: esc(name) })}</h3><p>${T('Install the program as usual. When it finishes, come back and click the button.')} <span class="faint" id="wvT">0:00</span></p>
      <div class="wv-live"><div><b id="wvF">0</b><span>${T('new files')}</span></div><div><b id="wvK">0</b><span>${T('registry keys')}</span></div><div><b id="wvS">0</b><span>${T('services')}</span></div><div><b id="wvTk">0</b><span>${T('tasks')}</span></div></div>
      <div class="wv-form"><button class="btn pri" id="wvStop">${ic('check')}${T("I'm done installing")}</button><button class="btn ghost" id="wvCancel">${T('Cancel')}</button></div>`);
    timer = setInterval(() => {
      if (rnd() > .3) c.f += Math.floor(rnd() * 14); if (rnd() > .6) c.k += Math.floor(rnd() * 4); if (rnd() > .97) c.s++; if (rnd() > .97) c.t++;
      const s = Math.floor((Date.now() - t0) / 1000); const set = (id, v) => { const x = $(id, wb); if (x && x.textContent !== String(v)) { x.textContent = v; anim(x, [{ transform: 'translate3d(0,-4px,0)', opacity: .5 }, { transform: 'none', opacity: 1 }], { d: 260 }); } };
      set('#wvF', c.f); set('#wvK', c.k); set('#wvS', c.s); set('#wvTk', c.t); const t = $('#wvT', wb); if (t) t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 600);
    wb.onclick = async e => {
      if (e.target.closest('#wvCancel')) { clearInterval(timer); wb.onclick = null; idle(); return; }
      if (!e.target.closest('#wvStop')) return; clearInterval(timer); wb.onclick = null; eye.classList.remove('on'); SH.sound('scan_start');
      swap(wb, `<h3>${T('Comparing snapshots')}</h3><p>${T('Looking for everything that changed since you started.')}</p><div class="bar" style="margin-top:16px;max-width:420px"><span id="wvBar2" style="transform:scaleX(0)"></span></div>`);
      await wait(200); const b2 = $('#wvBar2', wb); if (b2) anim(b2, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { d: 1600, e: EASE.io }); await wait(1700);
      const t = { id: 't' + Date.now(), name, date: new Date(TODAY), files: Math.max(c.f, 24), keys: Math.max(c.k, 6), mb: Math.round(c.f * 1.7 + 12) };
      traces.unshift(t); history.unshift({ type: 'watch', title: T('Watched install: {name}', { name }), sub: T('{files} files and {keys} keys recorded', { files: t.files, keys: t.keys }), date: new Date(TODAY) });
      flip(wl, () => wl.insertAdjacentHTML('afterbegin', trRow(t))); anim(wl.firstElementChild, [{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { d: 420, e: EASE.spring }); $('#wvN', el).textContent = traces.length;
      SH.sound('scan_complete'); SH.toast(T('Recorded: {files} files and {keys} keys from {name}.', { files: t.files, keys: t.keys, name })); refresh(); idle();
    };
  }
  el.addEventListener('click', e => {
    if (e.target.closest('#wvStart')) { const n = ($('#wvName', el).value || '').trim(); if (!n) { const f = $('#wvName', el).closest('.field'); anim(f, [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' }, { transform: 'none' }], { d: 360 }); $('#wvName', el).focus(); return; } start(n); }
    const a = e.target.closest('[data-a]'); if (!a) return; const row = a.closest('.row'); const t = traces.find(x => x.id === row.dataset.t);
    if (a.dataset.a === 'undo') { openFlow([{ id: t.id, name: t.name, pub: T('Watched install'), mb: t.mb, h: 160, ini: t.name.slice(0, 2).toUpperCase(), silent: false, store: false, prot: false, loc: `C:\\Program Files\\${t.name}`, audio: false }], { startAt: 'review', items: leftoversFor({ name: t.name, pub: t.name.split(' ')[0], loc: `C:\\Program Files\\${t.name}`, mb: t.mb }).filter(l => !l.personal).map(l => ({ ...l, conf: 99, why: T('Created by this install (it is in the after snapshot but not in the before one)') })), mode: 'forced' }); }
    if (a.dataset.a === 'del') { SH.sound('delete'); const i = traces.indexOf(t); traces.splice(i, 1); anim(row, [{ opacity: 1 }, { opacity: 0, transform: 'translateX(28px)' }], { d: 220 }).finished.then(() => flip(wl, () => row.remove())).catch(() => row.remove()); $('#wvN', el).textContent = traces.length; SH.toast(T('Install forgotten.'), { action: { label: T('Undo'), sound: 'undo', run: () => { traces.splice(i, 0, t); wl.innerHTML = traces.map(trRow).join(''); $('#wvN', el).textContent = traces.length; } } }); }
  });
  if (REAL()) { realWatch(el, { eye, wb, wl, idle }); return; }
  idle(); setTimeout(() => stagger($$('.row', wl), 120, 50), 10);
}
/* real watched install: before and after snapshots from the engine; leftovers are removed with the normal review */
function realWatch(el, { eye, wb, wl, idle }) {
  let list = [];
  const head = $('.wv-listp .tbl-head', el); if (head) head.innerHTML = `<span>${TC('Install')}</span><span>${T('Items')}</span><span>${T('Status')}</span><span></span><span></span>`;
  const row = t => `<div class="row wv-cols" data-t="${esc(t.id)}"><span class="rt"><b>${esc(t.name)}</b><span>${fmtDate(t.started ? new Date(t.started * 1000) : null)}</span></span><span class="muted">${t.count ?? '—'}</span><span class="muted">${t.status === 'running' ? T('Watching') : T('Finished')}</span><span></span>
    <span style="display:flex;gap:4px">${t.status === 'running' ? `<button class="btn sm sec" data-a="resume">${T('Finish')}</button>` : `<button class="btn sm sec" data-a="undo"${t.count ? '' : ' disabled'}>${T('Remove what it installed')}</button>`}<button class="btn sm ghost" data-a="del" title="${T('Forget')}">${ic('trash')}</button></span></div>`;
  async function load(anim0) {
    try { list = await SH.engine('remover', 'traces') || []; } catch { list = []; }
    $('#wvN', el).textContent = list.length;
    wl.innerHTML = list.length ? list.map(row).join('') : SH.emptyState({ art: 'first', small: true, title: T('None yet'), text: T('The installs you watch will appear here.') });
    if (anim0) stagger($$('.row', wl), 80, 50);
  }
  function watching(meta) {
    eye.classList.add('on'); anim($('.core', eye), [{ transform: 'scale(.7)' }, { transform: 'none' }], { d: 500, e: EASE.spring });
    const t0 = (meta.started || Date.now() / 1000) * 1000;
    swap(wb, `<h3>${T('Watching: {name}', { name: esc(meta.name) })}</h3><p>${T('Install the program as usual. When it finishes (and you have opened it once, if you want to capture its settings), come back and click the button.')} <span class="faint" id="wvT">0:00</span></p>
      <div class="wv-form"><button class="btn pri" id="wvStop">${ic('check')}${T("I'm done installing")}</button></div>`);
    const tm = setInterval(() => { const t = $('#wvT', wb); if (!t) { clearInterval(tm); return; } const s = Math.floor((Date.now() - t0) / 1000); t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 1000);
    wb.onclick = async e => {
      if (!e.target.closest('#wvStop')) return; wb.onclick = null; clearInterval(tm); eye.classList.remove('on');
      swap(wb, `<h3>${T('Comparing snapshots')}</h3><p>${T('Looking for everything that changed since you started. This may take a while.')}</p>${waitBar('wvBar2')}`);
      const stopT = elapsedIn(wb);
      try {
        const r = await SH.job('remover', 'monitor_stop', [meta.id], { sound: 'scan', onProgress: m => waitProg(wb, 'wvBar2', m) });
        SH.toast(PL(r.count || 0, 'Recorded: {n} item created by {name}.', 'Recorded: {n} items created by {name}.', { name: meta.name }));
        SH.logActivity(T('Watched install: {name}', { name: meta.name }), { sub: PL(r.count || 0, '{n} item recorded', '{n} items recorded'), ic: 'eye', go: 'remover', tab: 'watch' });
      } catch (err) { SH.toast(jobErr(err), { kind: 'error' }); } finally { stopT(); }
      idle(); load(true);
    };
  }
  /* bar that moves without a known end (a real % takes over if the engine sends one), with live text and elapsed time */
  const waitBar = id => `<div class="bar rv-indet" id="${id}" style="margin-top:16px;max-width:420px"><span></span></div><p class="faint rv-wait"><span class="rv-wt"></span> <span class="rv-el">${esc(T('Elapsed {time}', { time: mmss(0) }))}</span></p>`;
  function waitProg(box, id, m) {
    const b = $('#' + id, box); if (!b) return;
    if (m.pct > .02 && m.pct < 1) { b.classList.remove('rv-indet'); $('span', b).style.transform = `scaleX(${m.pct.toFixed(3)})`; }
    const w = $('.rv-wt', box); if (w && m.text) w.textContent = m.text;
  }
  function elapsedIn(box) {
    const t0 = Date.now();
    const tm = setInterval(() => { const e = $('.rv-el', box); if (!e) { clearInterval(tm); return; } e.textContent = T('Elapsed {time}', { time: mmss((Date.now() - t0) / 1000) }); }, 1000);
    return () => clearInterval(tm);
  }
  async function start(name) {
    swap(wb, `<h3>${T('Taking the initial snapshot')}</h3><p>${T('Files, keys, services and tasks are recorded. This can take up to a minute.')}</p>${waitBar('wvBar')}`);
    const stopT = elapsedIn(wb);
    try { const meta = await SH.job('remover', 'monitor_start', [name], { onProgress: m => waitProg(wb, 'wvBar', m) }); stopT(); load(false); watching(meta); }
    catch (e) { stopT(); SH.toast(jobErr(e), { kind: 'error' }); idle(); }
  }
  el.addEventListener('click', async e => {
    if (e.target.closest('#wvStart')) { e.stopImmediatePropagation(); const n = ($('#wvName', el).value || '').trim(); if (!n) { $('#wvName', el).focus(); return; } start(n); return; }
    const a = e.target.closest('[data-a]'); if (!a) return; e.stopImmediatePropagation();
    const rowEl = a.closest('.row'); const t = list.find(x => x.id === rowEl.dataset.t); if (!t) return;
    if (a.dataset.a === 'resume') { watching(t); return; }
    if (a.dataset.a === 'undo') {
      a.disabled = true; a.textContent = T('Searching…');
      try {
        const r = await SH.job('remover', 'trace_scan', [t.id], { sound: 'scan' });
        openFlow([{ id: 'w' + t.id, name: t.name, pub: T('Watched install'), mb: (r.total_size || 0) / 1048576, h: 160, ini: iniOf(t.name), silent: false, store: false, prot: false, loc: '', audio: false }],
          { startAt: 'review', items: r.items.map(mapItem(r.key, t.name)), mode: 'forced', onDone: () => load(false) });
      } catch (err) { SH.toast(jobErr(err), { kind: 'error' }); }
      a.disabled = false; a.textContent = T('Remove what it installed'); return;
    }
    if (a.dataset.a === 'del') {
      SH.sound('delete');
      anim(rowEl, [{ opacity: 1 }, { opacity: 0, transform: 'translateX(28px)' }], { d: 220 }).finished.then(() => rowEl.remove()).catch(() => rowEl.remove());
      let undone = false; const timer = setTimeout(() => { if (!undone) SH.engine('remover', 'trace_delete', t.id).then(() => load(false)); }, 4200);
      SH.toast(T('Install forgotten.'), { action: { label: T('Undo'), sound: 'undo', run: () => { undone = true; clearTimeout(timer); load(true); } }, ms: 4000 });
    }
  }, true);
  load(true).then(() => { const run = list.find(x => x.status === 'running'); run ? watching(run) : idle(); });
}

/* ================= Quarantine ================= */
function renderQuarantine(el) {
  el.innerHTML = `<div class="du-wrap" style="display:flex;flex-direction:column;gap:14px">
    <div class="pan qz-hero" data-asm><div class="n"><b id="qzS">0</b><span>${T('uninstalls')}</span></div><div class="n"><b id="qzI">0</b><span>${T('items saved')}</span></div><div class="n"><b id="qzM">0</b><span>${T('used')}</span></div><span class="sp"></span>
      <div class="days">${T('Empties itself after')} ${segHTML([['7', T('{n} days', { n: 7 })], ['14', T('{n} days', { n: 14 })], ['30', T('{n} days', { n: 30 })]], String(qDays))}</div><button class="btn danger" id="qzEmpty">${ic('trash')}${T('Empty now')}</button></div>
    <div class="qz-grid"><div class="pan qz-main" data-asm><h4>${T('Saved uninstalls')} <em>${T('click to see each item')}</em></h4><div id="qzList" class="qz-list"></div></div>
      <div class="pan qz-side" data-asm><h4>${T('What is saved')}</h4><div class="qz-types" id="qzTypes"></div>
        <p class="qz-note"><span class="qz-kept" id="qzKept" hidden></span>${T('Each item is saved exactly as it was: files, registry keys as .reg, and tasks and services with their settings. Restoring puts them back in place.')}</p></div></div></div>`;
  const listEl = $('#qzList', el);
  const tot = () => { const items = sessions.flatMap(s => s.items); $('#qzS', el).textContent = sessions.length; $('#qzI', el).textContent = items.length; $('#qzM', el).textContent = fmtMB(items.reduce((a, l) => a + l.mb, 0));
    const by = {}; items.forEach(l => { by[l.type] = (by[l.type] || 0) + 1; }); const mx = Math.max(1, ...Object.values(by));
    const tEl = $('#qzTypes', el); if (tEl) tEl.innerHTML = Object.keys(by).length ? Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<div class="qt"><span class="ri">${ic(TYPES[k][1])}</span><span class="tn">${TYPES[k][0]}</span><b>${n}</b><span class="bar"><span style="transform:scaleX(${(n / mx).toFixed(3)})"></span></span></div>`).join('') : `<p class="faint" style="font-size:12.5px">${T('Nothing saved right now.')}</p>`; };
  const sHTML = s => { const left = Math.max(0, qDays - daysSince(s.date)); const mb = s.items.reduce((a, l) => a + l.mb, 0);
    return `<div class="qs" data-s="${s.id}"><div class="qs-h" role="button" tabindex="0">${ic('chev', 'i cv')}${pi({ id: 'q' + s.id, h: s.h, ini: s.ini, icon: iconByName(s.prog) })}<span class="rt"><b>${esc(s.prog)}</b><span>${fmtDate(s.date)}, ${esc(SMODE[s.mode] || s.mode)}</span></span><span class="muted" style="font-size:12.5px">${PL(s.items.length, '{n} item, {size}', '{n} items, {size}', { size: fmtMB(mb) })}</span>
      <span class="left">${PL(left, '{n} day left', '{n} days left')}<span class="bar ${left < 4 ? 'warn' : ''}"><span style="transform:scaleX(${(left / qDays).toFixed(3)})"></span></span></span>${s.restorable === false ? `<span class="chip">${T('Deleted permanently')}</span>` : s.pending ? `<span class="chip warn" title="${esc(T('Some files leave at the next restart. Restore them after restarting the PC.'))}">${T('Restart pending')}</span>` : `<button class="btn sm sec" data-a="all">${ic('restore')}${T('Restore all')}</button>`}</div>
      <div class="qs-b"><div><div class="qs-in">${s.items.map(l => `<div class="qit" data-l="${l.id}">${ic(TYPES[l.type][1])}<span class="p" title="${esc(l.path)}">${esc(l.path)}</span><span class="s">${l.mb ? fmtMB(l.mb) : ''}</span>${s.restorable === false || l.restorable === false || s.pending ? '' : `<button class="btn sm ghost" data-a="one">${T('Restore')}</button>`}</div>`).join('')}</div></div></div></div>`; };
  /* uninstalls the automatic emptying kept because they still wait for a restart (engine init: purgeKept): a quiet line */
  const kept = () => { const k = $('#qzKept', el), n = (realInfo && realInfo.purgeKept) || 0; if (!k) return; k.hidden = !n; k.textContent = n ? PL(n, '1 uninstall is kept until the PC restarts: some of its files are still waiting to be moved.', '{n} uninstalls are kept until the PC restarts: some of their files are still waiting to be moved.') : ''; };
  function draw() { tot(); kept(); listEl.innerHTML = sessions.length ? sessions.map(sHTML).join('') : SH.emptyState({ art: 'ok', title: T('The quarantine is empty'), text: T('What you remove when uninstalling is kept here for {days} days in case you need it back.', { days: qDays }) }); stagger([...listEl.children], 60, 50); }
  listEl.addEventListener('click', async e => {
    const qs = e.target.closest('.qs'); if (!qs) return; const s = sessions.find(x => x.id === qs.dataset.s);
    const a = e.target.closest('[data-a]');
    if (!a) { if (e.target.closest('.qs-h')) { qs.classList.toggle('open'); if (qs.classList.contains('open')) stagger($$('.qit', qs).slice(0, 12), 80, 20); } return; }
    if (a.disabled) return;
    const busyBtn = (b, txt) => { b.disabled = true; b.classList.add('rv-busy'); b.innerHTML = `<span class="rv-spin"></span><span class="rv-bl">${esc(txt)}</span>`; };
    const onProg = b => m => { const l = String(m.text || '').split('\\').pop(); const x = $('.rv-bl', b); if (x) x.textContent = l ? T('Restoring… {label}', { label: l }) : T('Restoring…'); if (l) b.title = m.text; };
    if (a.dataset.a === 'all' || a.dataset.a === 'one') {
      SH.sound('undo');  /* putting it back from the quarantine */
      const html = a.innerHTML; busyBtn(a, T('Restoring…'));
      $$('[data-a]', qs).forEach(x => { if (x !== a) x.disabled = true; });   // one restore per uninstall at a time
      let ok = false;
      try {
        if (a.dataset.a === 'all') await API.restore(s, null, onProg(a));
        else { const row = a.closest('.qit'); await API.restore(s, s.items.find(l => l.id === row.dataset.l), onProg(a)); }
        ok = true;
      } catch (err) { SH.toast(jobErr(err), { ms: 6000, kind: 'error' }); }
      finally { if (a.isConnected && !ok) { a.disabled = false; a.classList.remove('rv-busy'); a.innerHTML = html; a.title = ''; } $$('[data-a]', qs).forEach(x => { if (x !== a) x.disabled = false; }); }
      if (!ok) return;
    }
    if (a.dataset.a === 'all') { anim(qs, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(40px) scale(.97)' }], { d: 260 }).finished.then(() => flip(listEl, () => qs.remove())).catch(() => qs.remove()); setTimeout(() => { tot(); if (!sessions.length) draw(); }, 300); SH.toast(T('{name}: everything put back in place.', { name: s.prog })); refresh(); }
    if (a.dataset.a === 'one') { const row = a.closest('.qit'); anim(row, [{ opacity: 1 }, { opacity: 0, transform: 'translateX(24px)' }], { d: 200 }).finished.then(() => { row.remove(); if (!sessions.includes(s)) { qs.remove(); if (!sessions.length) draw(); } else { const m = $('.qs-h .muted', qs); m.textContent = PL(s.items.length, '{n} item, {size}', '{n} items, {size}', { size: fmtMB(s.items.reduce((x, l) => x + l.mb, 0)) }); } tot(); }).catch(() => {}); SH.toast(T('Restored.')); }
  });
  wireSeg($('.seg', el), v => { qDays = +v; draw(); if (REAL()) SH.engine('remover', 'set_settings', { quarantine_days: +v }); SH.toast(T('The quarantine will empty itself after {days} days.', { days: v })); });
  let armed = 0; $('#qzEmpty', el).addEventListener('click', e => {
    const b = e.currentTarget; if (!sessions.length) { SH.toast(T('The quarantine is already empty.')); return; }
    if (!armed) { armed = setTimeout(() => { armed = 0; b.innerHTML = `${ic('trash')}${T('Empty now')}`; }, 3000); b.innerHTML = `${ic('alert')}${T('Click again: this cannot be undone')}`; anim(b, [{ transform: 'scale(.95)' }, { transform: 'none' }], { d: 300, e: EASE.spring }); return; }
    clearTimeout(armed); armed = 0; b.innerHTML = `${ic('trash')}${T('Empty now')}`; SH.sound('delete');
    const n = sessions.flatMap(s => s.items).length;
    /* the engine keeps what still waits for a restart (and says so): then the list is read again, not shown empty */
    if (REAL()) { b.disabled = true; SH.engine('remover', 'quarantine_empty').then(() => { b.disabled = false; emptied(n); },
      err => { b.disabled = false; SH.toast(jobErr(err), { ms: 7000, kind: 'error' }); loadRealSessions().then(() => { draw(); refresh(); }); }); return; }
    emptied(n);
  });
  function emptied(n) {
    sessions.splice(0); history.unshift({ type: 'empty', title: T('Quarantine emptied'), sub: PL(n, '{n} item deleted permanently', '{n} items deleted permanently'), date: new Date(TODAY) });
    $$('.qs', listEl).forEach((q, i) => anim(q, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(-10px) scale(.97)' }], { d: 220, delay: i * 50 })); setTimeout(draw, 400); SH.toast(PL(n, '{n} item deleted permanently.', '{n} items deleted permanently.')); refresh();
  }
  if (REAL()) {
    listEl.innerHTML = `<div class="empty"><b>${T('Reading the quarantine…')}</b></div>`;
    const seg = $('.seg', el);
    loadRealSessions().then(() => { $$('button', seg).forEach(b => b.classList.toggle('on', b.dataset.v === String(qDays))); SH.placeSeg(seg, true); draw(); });
    refreshers.add(() => { if (el.isConnected) loadRealSessions().then(draw); });
    return;
  }
  draw(); refreshers.add(() => { if (el.isConnected) draw(); });
}
/* real quarantine and history -> the same structures the UI uses */
async function loadRealSessions() {
  if (!realInfo) { try { realInfo = await SH.engine('remover', 'init'); qDays = (realInfo.settings || {}).quarantine_days || qDays; } catch { /* carry on */ } }
  let list = []; try { list = await SH.engine('remover', 'quarantine_list') || []; } catch { list = []; }
  sessions.splice(0, sessions.length, ...list.map(s => {
    const name = s.program || T('Unnamed');
    return { id: s.id, prog: name, pub: s.publisher || '', h: hueOf(name), ini: iniOf(name), date: s.created ? new Date(s.created * 1000) : null,
      mode: s.mode === 'quarantine' ? 'quarantine' : 'delete', restorable: s.restorable, pending: s.pendingRestart || 0,
      items: (s.items || []).filter(i => i.status === 'done').map(i => ({ id: 'q' + i.idx, idx: i.idx, type: typeOf({ kind: i.kind, target: i.target || i.display }), path: i.display, mb: (i.size || 0) / 1048576, restorable: i.restorable !== false })) };
  }).filter(s => s.items.length));
}
const HIST_TYPE = { uninstall: 'uninstall', remove: 'uninstall', restore: 'restore', watch: 'watch', empty: 'empty', delete_session: 'empty' };
async function loadRealHistory() {
  let list = []; try { list = await SH.engine('remover', 'history') || []; } catch { list = []; }
  const sub = h => { const d = h.detail || {};
    const failed = d.failed ? T('{n} failed', { n: d.failed }) : '';
    if (h.action === 'uninstall') return parts([SMODE[d.mode] || (d.mode ? T('{mode} mode', { mode: d.mode }) : SMODE.normal), d.ok === false ? T('with warnings') : '', d.seconds ? durTxt(d.seconds) : '']);
    if (h.action === 'remove') return parts([d.mode === 'delete' ? PL(d.ok || 0, '{n} leftover deleted', '{n} leftovers deleted') : PL(d.ok || 0, '{n} leftover to the quarantine', '{n} leftovers to the quarantine'), failed]);
    if (h.action === 'restore') return parts([PL(d.ok || 0, '{n} item restored', '{n} items restored'), failed]);
    if (h.action === 'empty') return PL(d.items || 0, '{n} item deleted permanently', '{n} items deleted permanently');
    return ''; };
  const title = h => ({ uninstall: () => T('{name} uninstalled', { name: h.title }), remove: () => T('Leftovers from {name}', { name: h.title }), restore: () => T('Restored from the quarantine'), watch: () => T('Watched install: {name}', { name: h.title }), empty: () => T('Quarantine emptied'), delete_session: () => T('Deleted an uninstall from the quarantine') }[h.action] || (() => h.title))();
  history.splice(0, history.length, ...list.filter(h => HIST_TYPE[h.action]).map(h => ({ type: HIST_TYPE[h.action], title: title(h), sub: sub(h), date: new Date(h.time * 1000) })));
}

/* ================= History ================= */
function renderHistory(el) {
  const COL = { uninstall: 'var(--accent)', restore: 'var(--ok)', watch: 'var(--accent2)', empty: 'var(--warn)' };
  function draw() {
    const cnt = t => history.filter(h => h.type === t).length;
    el.innerHTML = `<div class="hv-grid"><div class="pan hv-main" data-asm><h4>${T('What Program Remover has done')} <em><button class="btn sm ghost" id="hvClear">${T('Clear history')}</button></em></h4>
      ${history.length ? `<div class="hv-scroll"><div class="hv">${history.map(h => `<div class="he" style="--c:${COL[h.type]}"><div><b>${esc(h.title)}</b><span>${esc(h.sub)}</span></div><span class="d">${fmtDate(h.date)}</span></div>`).join('')}</div></div>` : SH.emptyState({ art: 'first', title: T('No activity'), text: T('Every uninstall, restore and watched install will appear here.') })}</div>
      <div class="pan hv-side" data-asm><h4>${T('At a glance')}</h4><div class="hv-stats">
        <div><b>${cnt('uninstall')}</b><span>${T('programs uninstalled')}</span></div><div><b>${cnt('restore')}</b><span>${T('restores')}</span></div>
        <div><b>${cnt('watch')}</b><span>${T('watched installs')}</span></div><div><b>${sessions.flatMap(x => x.items).length}</b><span>${T('leftovers in quarantine')}</span></div></div>
        <div class="hv-legend"><span><i style="background:var(--accent)"></i>${T('uninstall')}</span><span><i style="background:var(--ok)"></i>${T('restore')}</span><span><i style="background:var(--accent2)"></i>${T('watched install')}</span><span><i style="background:var(--warn)"></i>${T('quarantine emptied')}</span></div></div></div>`;
    stagger($$('.he', el), 60, 40);
    $('#hvClear', el).addEventListener('click', () => {
      SH.sound('delete'); const old = history.splice(0); draw(); let undone = false;
      const t = REAL() ? setTimeout(() => { if (!undone) SH.engine('remover', 'clear_history'); }, 4200) : 0;
      SH.toast(T('History cleared.'), { action: { label: T('Undo'), sound: 'undo', run: () => { undone = true; clearTimeout(t); history.push(...old); draw(); } }, ms: 4000 });
    });
  }
  if (REAL()) { el.innerHTML = `<div class="empty"><b>${T('Reading the history…')}</b></div>`; Promise.all([loadRealHistory(), loadRealSessions()]).then(draw); refreshers.add(() => { if (el.isConnected) Promise.all([loadRealHistory(), loadRealSessions()]).then(draw); }); return; }
  draw(); refreshers.add(() => { if (el.isConnected) draw(); });
}

/* ================= Hunter mode ================= */
const HUNT_TIP = T('Click "Point at a window": StellarHub hides and you have 3 seconds to hover the mouse over the window you want.');
function hunter() {
  const mod = sectionEl(); if (!mod || $('.hunt', mod)) return;
  const h = document.createElement('div'); h.className = 'hunt';
  h.innerHTML = `<div class="tip2"><h3>${T('Hunter mode')}</h3><p>${REAL() ? HUNT_TIP : T('Drag the crosshair onto any open window and I will tell you which program it is.')}</p><div class="row-btns">${REAL() ? `<button class="btn sec" data-h="win">${T('Point at a window')}</button>` : `<button class="btn sec" data-h="demo">${T('Try it on the FL Studio window')}</button>`}<button class="btn ghost" data-h="file">${T('Choose an .exe or shortcut')}</button><button class="btn ghost" data-h="x">${T('Exit')}</button></div></div><div class="cross">${ic('crosshair')}</div>`;
  mod.appendChild(h);
  anim(h, [{ opacity: 0 }, { opacity: 1 }], { d: 260 }); anim($('.tip2', h), [{ opacity: 0, transform: 'translate(-50%,-12px)', filter: 'blur(6px)' }, { opacity: 1, transform: 'translate(-50%,0)', filter: 'blur(0px)' }], { d: 480, e: EASE.spring });
  const cx = new Spring(0, 260, 22), cy = new Spring(0, 260, 22); const r0 = h.getBoundingClientRect(); cx.set(r0.width / 2); cy.set(r0.height / 2 + 40);
  const cross = $('.cross', h); let rot = 0;
  const tk = dt => { cx.step(dt); cy.step(dt); rot += dt * 40 * (SH.effInt() === 'min' ? 0 : 1); cross.style.transform = `translate3d(${cx.v.toFixed(1)}px,${cy.v.toFixed(1)}px,0) rotate(${rot.toFixed(1)}deg)`; };
  tickers.add(tk);
  h.addEventListener('pointermove', e => { const r = h.getBoundingClientRect(); cx.t = e.clientX - r.left; cy.t = e.clientY - r.top; });
  const close = () => { tickers.delete(tk); anim(h, [{ opacity: 1 }, { opacity: 0 }], { d: 200 }).finished.then(() => h.remove()).catch(() => h.remove()); };
  function showResult(r) {
    $$('.pan.res', h).forEach(x => x.remove());
    const res = document.createElement('div'); res.className = 'pan res';
    const p = r && r.program ? fromEngine(r.program) : null;
    const file = r && r.info && r.info.path ? r.info.path.split('\\').pop() : '';
    res.innerHTML = p ? `<div class="rd-top">${pi(p, true)}<div><h3>${T("It's {name}", { name: esc(p.name) })}</h3><div class="who">${esc(p.pub || '')}${file ? `, ${esc(file)}` : ''}</div></div></div><div class="row-btns"><button class="btn pri" data-h="goreal" data-e="${esc(p.eid)}">${T('Show in the list')}</button><button class="btn ghost" data-h="x">${T('Close')}</button></div>`
      : `<div class="rd-top"><div><h3>${T('Not an installed program')}</h3><div class="who">${r && r.info && (r.info.path || r.info.title) ? esc(r.info.path || r.info.title) : T('Could not identify the window')}</div></div></div><div class="row-btns"><button class="btn ghost" data-h="x">${T('Close')}</button></div>`;
    h.appendChild(res); anim(res, [{ opacity: 0, transform: 'scale(.9)', filter: 'blur(8px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 480, e: EASE.spring });
  }
  h.addEventListener('click', async e => {
    const b = e.target.closest('[data-h]'); if (!b) return;
    if (b.dataset.h === 'x') { close(); return; }
    if (b.dataset.h === 'goreal') { const eid = b.dataset.e; close(); ctxRef && ctxRef.setTab('programs'); ensureReal().then(() => setTimeout(() => SH.remover && SH.remover.select(eid), 300 * SH.motion())); return; }
    if (REAL() && b.dataset.h === 'win') {
      b.disabled = true; const tip = $('.tip2 p', h);
      try { const r = await SH.job('remover', 'hunter_window', [], { onProgress: m => { if (m.data && m.data.count && tip) tip.textContent = T('Hover over the window… {n}', { n: m.data.count }); } }); showResult(r); }
      catch (err) { SH.toast(jobErr(err), { kind: 'error' }); }
      b.disabled = false; if (tip) tip.textContent = HUNT_TIP; return;
    }
    if (REAL() && b.dataset.h === 'file') { try { const r = await SH.engine('remover', 'hunter_file'); if (r) showResult(r); } catch (err) { SH.toast(jobErr(err), { kind: 'error' }); } return; }
    if (b.dataset.h === 'file') SH.toast(T('The Windows file picker will open here.'));
    if (b.dataset.h === 'demo' || b.dataset.h === 'go') {
      if (b.dataset.h === 'go') { close(); ctxRef && ctxRef.setTab('programs'); setTimeout(() => SH.remover && SH.remover.select('FL Studio 2025'), 300 * SH.motion()); return; }
      const p = PROGRAMS.find(x => x.name === 'FL Studio 2025'); if (!p) { SH.toast(T('FL Studio is no longer installed.')); return; }
      const r = h.getBoundingClientRect(); cx.t = r.width / 2; cy.t = r.height / 2 - 20;
      setTimeout(() => {
        const res = document.createElement('div'); res.className = 'pan res';
        res.innerHTML = `<div class="rd-top">${pi(p, true)}<div><h3>${T("It's {name}", { name: esc(p.name) })}</h3><div class="who">${T('{publisher}, process {exe}', { publisher: esc(p.pub), exe: 'FL64.exe' })}</div></div></div><div class="row-btns"><button class="btn pri" data-h="go">${T('Show in the list')}</button><button class="btn ghost" data-h="x">${T('Close')}</button></div>`;
        h.appendChild(res); anim(res, [{ opacity: 0, transform: 'scale(.9)', filter: 'blur(8px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 480, e: EASE.spring });
        anim(cross, [{ opacity: 1 }, { opacity: 0 }], { d: 300, keep: true });
      }, 500 * SH.motion());
    }
  });
}

SH.module({
  id: 'remover', real: true,
  actions(el, ctx) {
    ctxRef = ctx;
    el.innerHTML = `<button class="btn ghost" id="rvExport">${ic('export')}${T('Export list')}</button><button class="btn sec" id="rvHunt">${ic('crosshair')}${T('Hunter mode')}</button>`;
    $('#rvHunt', el).addEventListener('click', hunter);
    $('#rvExport', el).addEventListener('click', async () => {
      if (!REAL()) { SH.toast(T('List of {n} programs saved to Documents (simulated).', { n: PROGRAMS.length })); return; }
      try { const path = await SH.engine('remover', 'export_programs'); if (path) SH.toast(T('List saved to {file}.', { file: path.split('\\').pop() })); } catch (err) { SH.toast(jobErr(err), { kind: 'error' }); }
    });
  },
  renderTab(tab, el, ctx) {
    ctxRef = ctx;
    if (tab === 'programs') renderPrograms(el, ctx);
    else if (tab === 'batch') renderBatch(el);
    else if (tab === 'watch') renderWatch(el);
    else if (tab === 'quarantine') renderQuarantine(el);
    else if (tab === 'history') renderHistory(el);
  },
  enterTab(tab, el) { requestAnimationFrame(() => $$('.seg', el).forEach(s => SH.placeSeg(s, true))); },
});
SH.actions.add([
  { t: T('Batch uninstall'), go: 'remover', tab: 'batch', ic: 'list' },
  { t: T('Watch a program install'), go: 'remover', tab: 'watch', ic: 'eye' },
  { t: T('Which program is this window (hunter mode)'), run: () => { SH.go('remover'); setTimeout(hunter, 650 * SH.motion()); }, ic: 'crosshair' },
  { t: T('See the largest programs'), go: 'remover', tab: 'programs', ic: 'sort' },
]);
})();
