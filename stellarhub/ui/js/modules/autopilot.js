/* StellarHub · Autopilot: automatic maintenance routines.
   Starts empty. Each routine = When (triggers) → Only if (conditions) → What it does (actions in order) → Afterwards → Notifications.
   Saved in the settings (autopilotRoutines, autopilotNotify). Inside the app the engine (stellarhub/engine/autopilot.py)
   runs them for real in the background, also while the window is hidden in the tray: real triggers and conditions,
   actions through the other engines, its own log. Outside the app (design preview) it stays a sample. */
'use strict';
(() => {
const { $, $$, anim, EASE, ic, esc, fmt1, state } = SH;
const U = SH.unit;
const wait = ms => new Promise(r => setTimeout(r, ms));
let REAL = false;                        // true inside the app: the Python engine runs everything
let NA = { t: {}, c: {}, a: {} };        // what this PC/version can't do, with the reason (from the engine)
let engLog = null; const seenLog = new Set();
SH.icons.add({
  drag: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>',
  up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>',
  dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  plug: '<path d="M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0zM12 16.5V21"/>', moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  gamepad: '<rect x="2.5" y="7" width="19" height="11" rx="5.5"/><path d="M7 11v3M5.5 12.5h3M15.5 11.5h.01M17.5 13.5h.01"/>',
  flask: '<path d="M9.5 3h5M10.5 3v6L5 19a1.5 1.5 0 0 0 1.3 2h11.4a1.5 1.5 0 0 0 1.3-2L13.5 9V3"/><path d="M7.5 15h9"/>',
});

/* ================= text and date helpers ================= */
/* translations (i18n.js) with this module's context: "autopilot|Power" wins over a plain "Power" from another area.
   Named tr, not t: t is a common local name here. */
const tr = (s, v) => SH.tc('autopilot', s, v);
const LOC = SH.i18n.locale;
const ZH = SH.i18n.lang === 'zh', CJK = ZH || SH.i18n.lang === 'ja';
const SEP = CJK ? '、' : ', ', SP = CJK ? '' : ' ';   // list separator and space between sentences
const dtf = o => new Intl.DateTimeFormat(LOC, o);
const wdName = (i, style) => dtf({ weekday: style }).format(new Date(2024, 0, 1 + i));   // 1 Jan 2024 was a Monday
const W7 = [0, 1, 2, 3, 4, 5, 6];
const DAYS = W7.map(i => wdName(i, 'narrow'));
const DAYN = W7.map(i => wdName(i, 'long'));
const DAYS3 = W7.map(i => wdName(i, 'short'));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return iso(d); };
const fmtMD = d => dtf({ month: 'long', day: 'numeric' }).format(d);
const fmtDate = s => { if (!s) return tr('a date not chosen yet'); const [y, m, d] = s.split('-').map(Number); return fmtMD(new Date(y, m - 1, d)); };
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
/* a sentence used inside another one ("Incomplete: choose when it runs"); names and acronyms keep their capitals */
const lcFirst = s => s && !/^(\S*[A-Z]\S*[A-Z]|Windows|StellarHub|NVIDIA|Wi-Fi|Defender|Store)\b/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
const LF = {};
/* "a, b and c" / "a, b or c" in the interface language */
const join = (a, how = 'and') => {
  if (a.length <= 1) return a[0] || '';
  try { LF[how] = LF[how] || new Intl.ListFormat(LOC, { type: how === 'or' ? 'disjunction' : 'conjunction' }); return LF[how].format(a); }
  catch { return a.join(SEP); }
};
const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const clone = o => JSON.parse(JSON.stringify(o));
const isWorkweek = d => d.length === 5 && d.every((x, i) => x === i);
const isWeekend = d => d.length === 2 && d[0] === 5 && d[1] === 6;
/* days of the week for a trigger: "every Monday and Wednesday" */
function daysText(days) {
  const d = [...days].sort((a, b) => a - b);
  if (!d.length) return tr('no day');
  if (d.length === 7) return tr('every day');
  if (isWorkweek(d)) return tr('Monday to Friday');
  if (isWeekend(d)) return tr('on weekends');
  return tr('every {days}', { days: join(d.map(i => DAYN[i])) });
}
/* the same days as a condition: "it’s Monday or Wednesday" */
function daysCond(days) {
  const d = [...days].sort((a, b) => a - b);
  if (!d.length) return tr('it’s no day');
  if (d.length === 7) return tr('it’s any day');
  if (isWorkweek(d)) return tr('it’s Monday to Friday');
  if (isWeekend(d)) return tr('it’s the weekend');
  return tr('it’s {days}', { days: join(d.map(i => DAYN[i]), 'or') });
}
function relDay(d) {
  const a = new Date(); a.setHours(0, 0, 0, 0); const b = new Date(d); b.setHours(0, 0, 0, 0); const diff = Math.round((b - a) / 864e5);
  return diff === 0 ? tr('today') : diff === 1 ? tr('tomorrow') : diff > 1 && diff < 7 ? DAYN[(d.getDay() + 6) % 7] : fmtMD(d);
}
function pastDay(d) {
  const a = new Date(); a.setHours(0, 0, 0, 0); const b = new Date(d); b.setHours(0, 0, 0, 0); const diff = Math.round((a - b) / 864e5);
  return diff === 0 ? tr('Today') : diff === 1 ? tr('Yesterday') : cap(diff < 7 ? DAYN[(d.getDay() + 6) % 7] : fmtMD(d));
}
const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/* ================= catalogs =================
   Saved routines hold only ids and option values (k, p); names, option labels and descriptions are translated here.
   Group names are English ids (also used by openGroups) and are translated when shown. */
const APPS = ['Steam', 'Epic Games', 'FL Studio', 'Brave', 'Discord', 'OBS Studio', 'Medal', 'Spotify', 'OneDrive', 'Any game'];
const appName = a => tr(a);               // only "Any game" has a translation; the rest are product names
const APPS_O = APPS.map(a => [a, appName(a)]);
const CLEAN = ['Windows temporary files', 'User temporary files', 'Browser caches', 'Thumbnails', 'Crash dumps', 'Windows Update leftovers', 'Delivery Optimization', 'Shader caches', 'Old logs', 'Program leftovers'];
const CLEAN_O = CLEAN.map(c => [c, tr(c)]);   // the English names are the saved values (the engine maps them)
/* option values saved by older Spanish builds → current values */
const OLD_OPT = { 'Cualquier juego': 'Any game', 'Temporales de Windows': CLEAN[0], 'Temporales del usuario': CLEAN[1], 'Cachés de navegadores': CLEAN[2], 'Miniaturas': CLEAN[3], 'Volcados de errores': CLEAN[4], 'Restos de Windows Update': CLEAN[5], 'Optimización de distribución': CLEAN[6], 'Cachés de sombreadores': CLEAN[7], 'Registros antiguos': CLEAN[8], 'Restos de programas': CLEAN[9] };
/* drives offered in the pickers: this PC's real ones inside the app (storage engine), C: and D: in the design preview */
const DRIVES = [['C:', 'C:'], ['D:', 'D:']];
let drivesReal = false;
function loadDrives() {
  SH.engine('storage', 'drives').then(list => {
    if (!Array.isArray(list) || !list.length) return;
    DRIVES.splice(0, DRIVES.length, ...list.map(d => [d.letter, d.label ? `${d.letter} ${d.label}` : d.letter])); drivesReal = true;
    if (rEl && rEl.isConnected && $$('select.pi', rEl).some(s => /^[A-Z]:$/.test(s.value))) drawStage(0);
  }).catch(() => {});
}
const opts = o => o.map(x => Array.isArray(x) ? x : [x, x]);
const num = (def, min, max, unit, label, step) => ({ type: 'num', def, min, max, unit, label, step });

const TRIG = [
  ['Date and time', [
    { k: 'once', t: tr('Just once'), ic: 'calendar', sched: 1, p: { date: { type: 'date', def: tomorrow, label: tr('On') }, time: { type: 'time', def: '10:00', label: tr('at') } }, say: p => tr('on {date} at {time}', { date: fmtDate(p.date), time: p.time }) },
    { k: 'daily', t: tr('Every day'), ic: 'clock', sched: 1, p: { time: { type: 'time', def: '09:00', label: tr('At') } }, say: p => tr('every day at {time}', { time: p.time }) },
    { k: 'weekdays', t: tr('Specific days of the week'), ic: 'calendar', sched: 1, p: { days: { type: 'days', def: [6] }, time: { type: 'time', def: '10:00', label: tr('at') } }, say: p => tr('{days} at {time}', { days: daysText(p.days), time: p.time }) },
    { k: 'everyN', t: tr('Every few hours'), ic: 'restore', sched: 1, p: { hours: num(6, 1, 72, 'h', tr('Every')) }, say: p => +p.hours === 1 ? tr('every {n} hour', { n: p.hours }) : tr('every {n} hours', { n: p.hours }) },
    { k: 'monthly', t: tr('Once a month'), ic: 'calendar', sched: 1, p: {
        mode: { type: 'select', def: 'day', opts: [['day', tr('On day')], ['first', tr('On the first')], ['last', tr('On the last')]] },
        day: { ...num(1, 1, 28, ''), show: p => p.mode === 'day' },
        weekday: { type: 'select', def: '0', opts: DAYN.map((d, i) => [String(i), cap(d)]), show: p => p.mode !== 'day' },
        time: { type: 'time', def: '09:00', label: tr('at') } },
      say: p => p.mode === 'day' ? tr('on day {day} of every month at {time}', { day: p.day, time: p.time })
        : p.mode === 'first' ? tr('on the first {weekday} of every month at {time}', { weekday: DAYN[+p.weekday], time: p.time })
        : tr('on the last {weekday} of every month at {time}', { weekday: DAYN[+p.weekday], time: p.time }) },
  ]],
  ['Session and system', [
    { k: 'boot', t: tr('When Windows starts'), ic: 'power', p: { delay: num(2, 0, 30, 'min', tr('Wait')) }, say: p => +p.delay ? tr('when Windows starts (after {n} min)', { n: p.delay }) : tr('when Windows starts') },
    { k: 'login', t: tr('When you sign in'), ic: 'user', say: () => tr('when you sign in') },
    { k: 'lock', t: tr('When you lock the PC'), ic: 'lock', say: () => tr('when you lock the PC') },
    { k: 'unlock', t: tr('When you unlock the PC'), ic: 'lock', say: () => tr('when you unlock the PC') },
    { k: 'idle', t: tr('After a while unused'), ic: 'moon', p: { min: num(15, 1, 240, 'min', tr('After')) }, say: p => tr('after {n} min without using the PC', { n: p.min }) },
    { k: 'shutdown', t: tr('On shutdown'), ic: 'power', say: () => tr('when the PC shuts down') },
  ]],
  ['Power', [
    { k: 'plugIn', t: tr('When the charger is plugged in'), ic: 'plug', say: () => tr('when the charger is plugged in') },
    { k: 'plugOut', t: tr('When the charger is unplugged'), ic: 'battery', say: () => tr('when the charger is unplugged') },
    { k: 'batteryBelow', t: tr('Battery below a level'), ic: 'battery', p: { pct: num(20, 5, 95, '%', tr('Below'), 5) }, say: p => tr('when the battery drops below {pct}%', { pct: p.pct }) },
  ]],
  ['Drives and files', [
    { k: 'diskBelow', t: tr('Low free space on a drive'), ic: 'ssd', p: { drive: { type: 'select', def: 'C:', opts: DRIVES, label: tr('Drive') }, gb: num(50, 5, 500, U('GB'), tr('with less than'), 5) }, say: p => tr('when {drive} has less than {gb} GB free', { drive: p.drive, gb: p.gb }) },
    { k: 'download', t: tr('When a download finishes'), ic: 'download', p: { folder: { type: 'text', def: 'Downloads', label: tr('In the folder'), ph: 'Downloads' } }, say: p => tr('when a download finishes in {folder}', { folder: p.folder || tr('a folder') }) },
  ]],
  ['New versions', [
    { k: 'newDrivers', t: tr('New drivers available'), ic: 'drivers', say: () => tr('when new drivers show up') },
    { k: 'newUpdates', t: tr('Apps waiting to update'), ic: 'updater', say: () => tr('when there are apps to update') },
  ]],
  ['Network', [
    { k: 'wifi', t: tr('When connecting to a Wi-Fi network'), ic: 'wifi', p: { ssid: { type: 'text', def: tr('Home'), label: tr('Network'), ph: tr('Network name') } }, say: p => tr('when connecting to “{ssid}”', { ssid: p.ssid || tr('a network') }) },
  ]],
  ['Apps', [
    { k: 'appOpen', t: tr('When an app opens'), ic: 'play', p: { app: { type: 'select', def: 'Steam', opts: APPS_O } }, say: p => tr('when {app} opens', { app: appName(p.app) }) },
    { k: 'appClose', t: tr('When an app closes'), ic: 'stop', p: { app: { type: 'select', def: 'Steam', opts: APPS_O } }, say: p => tr('when {app} closes', { app: appName(p.app) }) },
  ]],
  ['Performance and temperature', [
    { k: 'temp', t: tr('High temperature'), ic: 'temp', p: { sensor: { type: 'select', def: 'gpu', opts: [['cpu', tr('Processor')], ['gpu', tr('Graphics card')]] }, deg: num(85, 60, 100, '°C', tr('above')), min: num(3, 1, 30, 'min', tr('for')) },
      say: p => p.sensor === 'cpu' ? tr('if the processor goes above {deg} °C for {min} min', { deg: p.deg, min: p.min }) : tr('if the graphics card goes above {deg} °C for {min} min', { deg: p.deg, min: p.min }) },
    { k: 'ram', t: tr('Memory almost full'), ic: 'ram', p: { pct: num(90, 50, 98, '%', tr('Above')), min: num(2, 1, 30, 'min', tr('for')) }, say: p => tr('if memory use goes above {pct}% for {min} min', { pct: p.pct, min: p.min }) },
  ]],
];
const COND = [
  ['Power', [
    { k: 'plugged', t: tr('Plugged in'), ic: 'plug', say: () => tr('it’s plugged in') },
    { k: 'battery', t: tr('Enough battery'), ic: 'battery', p: { pct: num(50, 10, 100, '%', tr('At least'), 5) }, say: p => tr('the battery is at {pct}% or more', { pct: p.pct }) },
  ]],
  ['PC usage', [
    { k: 'idle', t: tr('You’re not using it'), ic: 'moon', p: { min: num(5, 1, 120, 'min', tr('For')) }, say: p => tr('you haven’t used it for {min} min', { min: p.min }) },
    { k: 'noFull', t: tr('Nothing in full screen'), ic: 'gamepad', say: () => tr('no game or video is in full screen') },
    { k: 'cpu', t: tr('The processor is quiet'), ic: 'cpu', p: { pct: num(30, 5, 90, '%', tr('Below'), 5) }, say: p => tr('the processor is below {pct}%', { pct: p.pct }) },
    { k: 'noMeeting', t: tr('No call in progress'), ic: 'mic', say: () => tr('you’re not on a call') },
  ]],
  ['Schedule', [
    { k: 'window', t: tr('Within a time window'), ic: 'clock', p: { from: { type: 'time', def: '22:00', label: tr('From') }, to: { type: 'time', def: '08:00', label: tr('to') } }, say: p => tr('it’s between {from} and {to}', { from: p.from, to: p.to }) },
    { k: 'days', t: tr('Only on certain days'), ic: 'calendar', p: { days: { type: 'days', def: [0, 1, 2, 3, 4] } }, say: p => daysCond(p.days) },
  ]],
  ['Network', [
    { k: 'unmetered', t: tr('The connection isn’t metered'), ic: 'globe', say: () => tr('the connection isn’t metered') },
    { k: 'onWifi', t: tr('Connected to a specific Wi-Fi'), ic: 'wifi', p: { ssid: { type: 'text', def: tr('Home'), label: tr('Network'), ph: tr('Network name') } }, say: p => tr('you’re on the “{ssid}” Wi-Fi', { ssid: p.ssid || '…' }) },
  ]],
  ['Space', [
    { k: 'junk', t: tr('Plenty of junk'), ic: 'broom', p: { gb: num(5, 1, 100, U('GB'), tr('At least')) }, say: p => tr('there are {gb} GB of junk or more', { gb: p.gb }) },
    { k: 'diskFree', t: tr('Running low on space'), ic: 'ssd', p: { drive: { type: 'select', def: 'C:', opts: DRIVES, label: tr('Drive') }, gb: num(100, 5, 900, U('GB'), tr('with less than'), 5) }, say: p => tr('{drive} has less than {gb} GB free', { drive: p.drive, gb: p.gb }) },
  ]],
  ['System', [
    { k: 'admin', t: tr('Administrator rights available'), ic: 'shield', say: () => tr('StellarHub is in administrator mode') },
    { k: 'notSince', t: tr('Hasn’t run recently'), ic: 'restore', p: { hours: num(24, 1, 720, 'h', tr('In the last')) }, say: p => tr('it hasn’t run in the last {hours} h', { hours: p.hours }) },
    { k: 'app', t: tr('An app is open or closed'), ic: 'grid', p: { app: { type: 'select', def: 'FL Studio', opts: APPS_O }, st: { type: 'select', def: 'closed', opts: [['closed', tr('is closed')], ['open', tr('is open')]] } },
      say: p => p.st === 'open' ? tr('{app} is open', { app: appName(p.app) }) : tr('{app} is closed', { app: appName(p.app) }) },
  ]],
];
const ACT = [
  ['Cleanup', [
    { k: 'clean', t: tr('Clean temporary files and caches'), ic: 'broom', mod: 'Super Optimizer', est: 90, p: { cats: { type: 'multi', def: CLEAN.slice(0, 6), opts: CLEAN_O } },
      say: p => p.cats.length === CLEAN.length ? tr('clean up everything that isn’t needed') : p.cats.length === 1 ? tr('clean {n} category', { n: 1 }) : tr('clean {n} categories', { n: p.cats.length }) },
    { k: 'recycle', t: tr('Empty the Recycle Bin'), ic: 'trash', mod: 'Super Optimizer', est: 10, say: () => tr('empty the Recycle Bin') },
    { k: 'oldDl', t: tr('Clear out old downloads'), ic: 'download', mod: 'Super Optimizer', est: 20, p: { days: num(30, 7, 365, tr('days'), tr('Older than')), to: { type: 'select', def: 'bin', opts: [['bin', tr('to the Recycle Bin')], ['quar', tr('to quarantine')]], label: tr('Move them') } },
      say: p => p.to === 'bin' ? tr('move downloads older than {days} days to the Recycle Bin', { days: p.days }) : tr('move downloads older than {days} days to quarantine', { days: p.days }) },
    { k: 'quar', t: tr('Empty the quarantine'), ic: 'restore', mod: 'Program Remover', est: 15, p: { age: num(14, 0, 90, tr('days'), tr('Anything older than')) }, say: p => tr('remove anything older than {days} days from quarantine', { days: p.age }) },
    { k: 'dupes', t: tr('Find duplicate files'), ic: 'copy', mod: 'Storage Checker', est: 240, p: { min: num(50, 1, 2000, U('MB'), tr('Larger than'), 10) }, say: p => tr('find duplicates larger than {mb} MB', { mb: p.min }) },
  ]],
  ['Drivers', [
    { k: 'drvScan', t: tr('Check for new drivers'), ic: 'drivers', mod: 'Driver Updater', est: 60, say: () => tr('check for new drivers') },
    { k: 'drvInstall', t: tr('Install drivers'), ic: 'download', mod: 'Driver Updater', admin: 1, est: 300, p: { mode: { type: 'select', def: 'ask', opts: [['ask', tr('Ask me first')], ['rec', tr('Only recommended ones')], ['all', tr('All new ones')]] } }, decide: p => p.mode === 'ask',
      say: p => p.mode === 'ask' ? tr('get new drivers ready and ask you') : p.mode === 'rec' ? tr('install the recommended drivers') : tr('install all new drivers') },
    { k: 'drvBackup', t: tr('Back up drivers'), ic: 'package', mod: 'Driver Updater', est: 120, p: { keep: num(3, 1, 20, tr('copies'), tr('Keep the last')) },
      say: p => +p.keep === 1 ? tr('back up the drivers (keeping {n} copy)', { n: p.keep }) : tr('back up the drivers (keeping {n} copies)', { n: p.keep }) },
  ]],
  ['Updates', [
    { k: 'apps', t: tr('Update apps'), ic: 'updater', mod: 'Program Updater', est: 240, p: { scope: { type: 'select', def: 'all', opts: [['all', tr('All')], ['sec', tr('Security updates only')], ['list', tr('Only some')]], label: tr('Which') }, list: { type: 'multi', def: ['Brave', 'Discord'], opts: APPS.slice(0, 9), show: p => p.scope === 'list' } },
      say: p => p.scope === 'all' ? tr('update all apps') : p.scope === 'sec' ? tr('install security updates') : (p.list || []).length ? tr('update {apps}', { apps: join(p.list) }) : tr('update the apps you choose') },
    { k: 'winUpd', t: tr('Windows Update'), ic: 'windows', mod: 'Program Updater', admin: 1, est: 600, p: { mode: { type: 'select', def: 'search', opts: [['search', tr('Only check')], ['download', tr('Check and download')], ['install', tr('Install')]] } },
      say: p => ({ search: tr('check for Windows updates'), download: tr('download Windows updates'), install: tr('install Windows updates') })[p.mode] },
    { k: 'store', t: tr('Update Store apps'), ic: 'store', mod: 'Program Updater', est: 120, say: () => tr('update Store apps') },
    { k: 'defender', t: tr('Update Defender definitions'), ic: 'shield', mod: 'Program Updater', est: 30, say: () => tr('update Defender definitions') },
  ]],
  ['Windows maintenance', [
    { k: 'restore', t: tr('Create a restore point'), ic: 'restore', mod: 'Super Optimizer', admin: 1, est: 45, say: () => tr('create a restore point') },
    { k: 'sfc', t: tr('Check Windows files'), ic: 'shield', mod: 'Super Optimizer', admin: 1, est: 900, p: { kind: { type: 'select', def: 'sfc', opts: [['sfc', 'SFC'], ['dism', 'DISM'], ['both', tr('SFC and DISM')]] } },
      say: p => tr('check Windows with {tool}', { tool: p.kind === 'both' ? tr('SFC and DISM') : p.kind.toUpperCase() }) },
    { k: 'net', t: tr('Repair the network'), ic: 'globe', mod: 'Super Optimizer', est: 20, p: { kind: { type: 'select', def: 'dns', opts: [['dns', tr('Flush the DNS cache')]], legacy: [['full', tr('Full network reset (no longer runs on its own)')]] } }, say: p => p.kind === 'full' ? tr('flush the DNS cache (a full network reset is never run by a routine)') : tr('flush the DNS cache') },
    { k: 'explorer', t: tr('Restart File Explorer'), ic: 'folder', mod: 'Super Optimizer', est: 5, say: () => tr('restart File Explorer') },
    { k: 'scanDisk', t: tr('Analyze a drive'), ic: 'storage', mod: 'Storage Checker', est: 60, p: { drive: { type: 'select', def: 'C:', opts: DRIVES, label: tr('Drive') }, gb: num(10, 1, 200, U('GB'), tr('Warn if it grew by more than')) }, say: p => tr('analyze {drive} and warn if it grew by more than {gb} GB', { drive: p.drive, gb: p.gb }) },
  ]],
  ['Performance', [
    { k: 'plan', t: tr('Change the power plan'), ic: 'optimizer', mod: 'Super Optimizer', est: 2, p: { plan: { type: 'select', def: 'high', opts: [['saver', tr('Power saver')], ['balanced', tr('Balanced')], ['high', tr('High performance')], ['max', tr('Maximum')]] } },
      say: p => ({ saver: tr('switch to the power saver plan'), balanced: tr('switch to the balanced plan'), high: tr('switch to the high performance plan'), max: tr('switch to the maximum plan') })[p.plan] },
    { k: 'game', t: tr('Game Mode'), ic: 'gamepad', mod: 'Super Optimizer', est: 2, p: { on: { type: 'select', def: 'on', opts: [['on', tr('Turn on')], ['off', tr('Turn off')]] } }, say: p => p.on === 'on' ? tr('turn on Game Mode') : tr('turn off Game Mode') },
    { k: 'closeApp', t: tr('Close an app'), ic: 'x', mod: 'System', est: 3, p: { app: { type: 'select', def: 'OneDrive', opts: APPS_O } }, say: p => tr('close {app}', { app: appName(p.app) }) },
    { k: 'openApp', t: tr('Open an app or file'), ic: 'external', mod: 'System', est: 3, p: { path: { type: 'text', def: '', label: tr('Path'), ph: 'C:\\Program Files\\…' } }, say: p => p.path ? tr('open {file}', { file: p.path.split(/[\\/]/).pop() }) : tr('open an app') },
    { k: 'cmd', t: tr('Run a command or script'), ic: 'code', mod: 'System', est: 10, p: { cmd: { type: 'text', def: '', label: tr('Command'), ph: 'powershell -File cleanup.ps1' }, as: { type: 'select', def: 'user', opts: [['user', tr('As your user')], ['admin', tr('As administrator')]] } },
      say: p => p.cmd ? tr('run “{cmd}”', { cmd: p.cmd.length > 30 ? p.cmd.slice(0, 30) + '…' : p.cmd }) : tr('run a command') },
  ]],
  ['StellarHub and notifications', [
    { k: 'widget', t: tr('Open or close the widget'), ic: 'monitor', mod: 'StellarHub', est: 1, p: { st: { type: 'select', def: 'open', opts: [['open', tr('Open it')], ['close', tr('Close it')]] } }, say: p => p.st === 'open' ? tr('open the widget') : tr('close the widget') },
    { k: 'mute', t: tr('Mute notifications'), ic: 'bell', mod: 'Windows', est: 1, p: { min: num(60, 5, 480, 'min', tr('For'), 5) }, say: p => tr('mute notifications for {min} min', { min: p.min }) },
  ]],
  ['Control and power', [
    { k: 'wait', t: tr('Wait before continuing'), ic: 'clock', mod: 'Control', est: 0, p: { min: num(5, 1, 120, 'min', tr('Wait')) }, say: p => tr('wait {min} min', { min: p.min }) },
    { k: 'power', t: tr('Sleep, restart or shut down'), ic: 'power', mod: 'Windows', est: 0, p: { what: { type: 'select', def: 'sleep', opts: [['sleep', tr('Sleep')], ['restart', tr('Restart')], ['off', tr('Shut down')]] }, count: num(60, 0, 600, 's', tr('Countdown'), 10) },
      say: p => { const a = ({ sleep: tr('put the PC to sleep'), restart: tr('restart the PC'), off: tr('shut down the PC') })[p.what]; return +p.count ? tr('{action} (with {n} s to cancel)', { action: a, n: p.count }) : a; } },
  ]],
];
const CAT = { t: TRIG, c: COND, a: ACT };
const byK = { t: {}, c: {}, a: {} };
Object.entries(CAT).forEach(([s, groups]) => groups.forEach(([g, items]) => items.forEach(d => { d.g = g; byK[s][d.k] = d; })));
const sayOf = (s, x) => { const d = byK[s][x.k]; return d ? d.say(x.p) : ''; };
const modName = m => m ? tr(m) : '';
/* Log texts. Each one is stored in English plus a message {t: English text, v: {values}}, translated when shown, so the
   log follows the language even for runs made before it changed. A value may be a message itself, {n1: number} (one
   decimal), {wd: 0-6} (a weekday, Monday = 0) or {say: [step, k, p]} (a catalog item's sentence). */
function msgText(m) {
  if (m === undefined || m === null) return '';
  if (typeof m !== 'object') return tr(String(m));
  if (m.n1 !== undefined) return fmt1(m.n1);
  if (m.wd !== undefined) return DAYN[m.wd] || '';
  if (m.say) { const [s, k, p] = m.say; const d = byK[s] && byK[s][k]; return d ? cap(d.say(p)) : String(k); }
  const v = {}; Object.entries(m.v || {}).forEach(([k, x]) => { v[k] = x !== null && typeof x === 'object' ? msgText(x) : x; });
  return tr(m.t, v);
}
const M = (t, v) => v ? { t, v } : { t };
/* English text of a message (what gets stored next to it) */
function msgEn(m) {
  if (m === undefined || m === null) return '';
  if (typeof m !== 'object') return String(m);
  if (m.n1 !== undefined) return (+m.n1).toFixed(1);
  if (m.wd !== undefined) return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][m.wd] || '';
  if (m.say) return String(m.say[1]);
  return String(m.t).replace(/\{(\w+)\}/g, (s, k) => { const x = (m.v || {})[k]; return x === undefined ? s : x !== null && typeof x === 'object' ? msgEn(x) : x; });
}
/* a stored log text: its message when there is one, otherwise the English text (older entries) */
const logText = (text, msg) => msg ? msgText(msg) : tr(text);
function newItem(s, k, over) {
  const d = byK[s][k]; const p = {};
  Object.entries(d.p || {}).forEach(([n, spec]) => { p[n] = typeof spec.def === 'function' ? spec.def() : clone(spec.def); });
  return { k, p: { ...p, ...(over || {}) } };
}

/* ================= routines and state ================= */
const COLORS = ['var(--accent2)', 'var(--accent)', 'var(--ok)', 'var(--warn)', '#C9A7FF', '#FF8FB1'];
const NOTD = { when: 'decide', toast: true, tray: true, sound: false, weekly: true };
const AFTERD = { onFail: 'continue', retries: 2, tomorrow: true, limit: 60, report: true, okThen: 'none', failThen: 'none', okRoutine: '', failRoutine: '' };
let uid = Date.now() % 100000;
/* new routines and templates get their name in the current language; after that it is the user's text */
const mk = o => ({ id: 'r' + (uid++), on: true, name: tr('New routine'), color: 0, priority: 'normal', pausedUntil: '', triggers: [], condMode: 'all', conds: [], acts: [],
  after: { ...AFTERD }, notify: { ...NOTD }, ...o });
const T = (k, p) => newItem('t', k, p), C = (k, p) => newItem('c', k, p), A = (k, p) => newItem('a', k, p);
const TEMPLATES = [
  { n: tr('Weekly maintenance'), d: tr('Sundays at 10: restore point, cleanup, drivers and apps.'), ic: 'sparkle',
    r: () => mk({ name: tr('Weekly maintenance'), color: 0, triggers: [T('weekdays', { days: [6], time: '10:00' })], conds: [C('plugged'), C('noFull')], acts: [A('restore'), A('clean'), A('drvScan'), A('apps')] }) },
  { n: tr('When space runs low'), d: tr('If C: has less than 50 GB left: deep cleanup, Recycle Bin and old downloads.'), ic: 'ssd',
    r: () => mk({ name: tr('Free up space'), color: 1, triggers: [T('diskBelow')], acts: [A('clean', { cats: [...CLEAN] }), A('recycle'), A('oldDl')], notify: { ...NOTD, when: 'always' } }) },
  { n: tr('Night mode'), d: tr('At 3 a.m. with the PC plugged in: update Windows and apps, then sleep.'), ic: 'moon',
    r: () => mk({ name: tr('Night mode'), color: 4, triggers: [T('daily', { time: '03:00' })], conds: [C('plugged'), C('idle', { min: 30 })], acts: [A('restore'), A('winUpd', { mode: 'install' }), A('apps'), A('power', { what: 'sleep', count: 120 })], notify: { ...NOTD, when: 'errors' } }) },
  { n: tr('Before gaming'), d: tr('When Steam opens: high performance, Game Mode and notifications muted.'), ic: 'gamepad',
    r: () => mk({ name: tr('Before gaming'), color: 3, triggers: [T('appOpen', { app: 'Steam' })], acts: [A('plan', { plan: 'high' }), A('game'), A('closeApp', { app: 'OneDrive' }), A('mute', { min: 180 })], notify: { ...NOTD, when: 'never' } }) },
  { n: tr('When unplugged'), d: tr('Off the charger: power saver plan, and close what drains battery in the background.'), ic: 'battery',
    r: () => mk({ name: tr('Battery saver'), color: 2, triggers: [T('plugOut')], acts: [A('plan', { plan: 'saver' }), A('closeApp', { app: 'OneDrive' }), A('widget', { st: 'close' })], notify: { ...NOTD, when: 'never' } }) },
  { n: tr('Drivers on the first Monday'), d: tr('The first Monday of every month: back up the drivers and check for new ones.'), ic: 'drivers',
    r: () => mk({ name: tr('Monthly drivers'), color: 5, triggers: [T('monthly', { mode: 'first', weekday: '0', time: '09:00' })], conds: [C('plugged')], acts: [A('drvBackup'), A('drvScan'), A('drvInstall')] }) },
  { n: tr('Watch the heat'), d: tr('If the graphics card goes above 85 °C for 3 minutes, lowers the power plan and lets you know.'), ic: 'temp',
    r: () => mk({ name: tr('Watch the heat'), color: 1, triggers: [T('temp')], acts: [A('plan', { plan: 'balanced' })], notify: { ...NOTD, when: 'always' } }) },
  { n: tr('Daily light cleanup'), d: tr('After 15 minutes without using the PC, if there are more than 2 GB of junk.'), ic: 'broom',
    r: () => mk({ name: tr('Light cleanup'), color: 2, triggers: [T('idle', { min: 15 })], conds: [C('junk', { gb: 2 }), C('notSince', { hours: 20 })], acts: [A('clean'), A('recycle')], notify: { ...NOTD, when: 'never' } }) },
];

let R = null, LOG = null, NT = null, sel = null, step = 't';
const openGroups = { t: new Set(['Date and time']), c: new Set(['Power', 'PC usage']), a: new Set(['Cleanup']) };
const query = { t: '', c: '', a: '' };
function ensure() {
  if (R) return;
  const st = state.settings;
  if (st.autopilotSchema !== 2) {           // the previous version's sample routines are discarded once
    R = []; LOG = [];
    SH.setSetting('autopilotRoutines', []); SH.setSetting('autopilotLog', []); SH.setSetting('autopilotSchema', 2);
  } else {
    R = Array.isArray(st.autopilotRoutines) ? clone(st.autopilotRoutines) : [];
    LOG = (Array.isArray(st.autopilotLog) ? st.autopilotLog : []).map(l => ({ ...l, when: new Date(l.when) }));
  }
  if (REAL) LOG = engLog || [];
  R.forEach(r => { r.after = { ...AFTERD, ...(r.after || {}) }; r.notify = { ...NOTD, ...(r.notify || {}) };
    [...r.triggers, ...r.conds, ...r.acts].forEach(x => Object.keys(x.p || {}).forEach(k => { const v = x.p[k]; x.p[k] = Array.isArray(v) ? v.map(o => OLD_OPT[o] || o) : (OLD_OPT[v] || v); })); });
  sel = R[0] && R[0].id;
  NT = { toast: true, tray: true, sound: false, when: 'decide', quiet: true, qFrom: '23:00', qTo: '08:00', noGame: true, weekly: true, weeklyDay: 6, batterySaver: true, ...(st.autopilotNotify || {}) };
}
let saveT = 0;
/* save(r): r is the routine the user just edited. In administrator mode the engine only runs a command / open-app action
   that was saved from here, so those routines are sent to be approved (never the others: a program that edited the
   settings file must not get approved by the user editing something else) */
const PEND = new Set();
const save = r => {
  if (r && r.id) PEND.add(r.id);
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    SH.setSetting('autopilotRoutines', clone(R));
    if (REAL && PEND.size) { const l = R.filter(x => PEND.has(x.id)).map(clone); PEND.clear(); if (l.length) SH.engine('autopilot', 'approve', l).catch(() => {}); }
  }, 350);
};
const saveLog = () => REAL || SH.setSetting('autopilotLog', LOG.slice(0, 100).map(l => ({ ...l, when: l.when.toISOString(), fresh: false })));
const saveNT = () => SH.setSetting('autopilotNotify', { ...NT });
const cur = () => R.find(r => r.id === sel);
const colorOf = r => COLORS[(r.color || 0) % COLORS.length];
const listOf = (r, s) => s === 't' ? r.triggers : s === 'c' ? r.conds : r.acts;

/* ================= routine texts ================= */
function summary(r) {
  const tg = r.triggers.map(x => sayOf('t', x)), c = r.conds.map(x => sayOf('c', x)), a = r.acts.filter(x => x.k !== 'wait').map(x => sayOf('a', x));
  if (!tg.length && !a.length) return tr('This routine is still empty. Start with “When”, then choose “What it does”.');
  let s = tg.length ? cap(join(tg, 'or')) : tr('No time chosen yet');
  if (c.length) s = tr('{when}, if {conditions}', { when: s, conditions: join(c, r.condMode === 'all' ? 'and' : 'or') });
  const what = a.length ? (a.length > 3 ? tr('{list} and {n} more', { list: a.slice(0, 3).join(SEP), n: a.length - 3 }) : join(a)) : tr('it doesn’t do anything yet');
  s = tr('{when}: {actions}.', { when: s, actions: what });
  s += SP + ({ always: tr('Always notifies you.'), decide: tr('Notifies you only when there’s something to decide.'), errors: tr('Notifies you only if something fails.'), never: tr('Doesn’t notify you.') })[r.notify.when];
  if (r.pausedUntil) s += SP + tr('Paused until {date}.', { date: fmtDate(r.pausedUntil) });
  return s;
}
function problems(r) {
  const p = [];
  if (!r.triggers.length) p.push(['t', tr('Choose when it runs')]);
  if (!r.acts.length) p.push(['a', tr('Add at least one action')]);
  r.triggers.forEach(x => {
    if (x.k === 'weekdays' && !x.p.days.length) p.push(['t', tr('Pick at least one day of the week')]);
    if (x.k === 'once' && new Date(x.p.date + 'T' + x.p.time) < new Date()) p.push(['t', tr('The “Just once” date has already passed')]);
    if (x.k === 'wifi' && !String(x.p.ssid).trim()) p.push(['t', tr('Type the Wi-Fi network name')]);
    if (x.k === 'download' && !String(x.p.folder).trim()) p.push(['t', tr('Enter the downloads folder')]);
  });
  r.triggers.forEach(x => { if (NA.t[x.k]) p.push(['t', NA.t[x.k]]); });
  r.acts.forEach(x => { if (NA.a[x.k]) p.push(['a', NA.a[x.k]]); });
  r.conds.forEach(x => { if (x.k === 'days' && !x.p.days.length) p.push(['c', tr('Pick at least one day in “Only on certain days”')]); if (x.k === 'onWifi' && !String(x.p.ssid).trim()) p.push(['c', tr('Type the Wi-Fi network name')]); });
  r.acts.forEach(x => {
    if (x.k === 'openApp' && !String(x.p.path).trim()) p.push(['a', tr('Enter which app or file to open')]);
    if (x.k === 'cmd' && !String(x.p.cmd).trim()) p.push(['a', tr('Type the command to run')]);
    if (x.k === 'clean' && !x.p.cats.length) p.push(['a', tr('Choose at least one category to clean')]);
    if (x.k === 'apps' && x.p.scope === 'list' && !(x.p.list || []).length) p.push(['a', tr('Choose which apps to update')]);
  });
  if (r.after.okThen === 'routine' && !R.some(o => o.id === r.after.okRoutine)) p.push(['after', tr('Choose which routine runs when it finishes')]);
  if (r.after.failThen === 'routine' && !R.some(o => o.id === r.after.failRoutine)) p.push(['after', tr('Choose which routine runs if something fails')]);
  return p;
}
/* upcoming timed runs */
function occ(r, from, to) {
  if (!r.on) return [];
  const out = [], pz = r.pausedUntil ? new Date(r.pausedUntil + 'T23:59') : null;
  r.triggers.forEach(x => {
    const d = byK.t[x.k]; if (!d || !d.sched) return;
    if (x.k === 'everyN') { const s = new Date(from); s.setMinutes(0, 0, 0); let n = 0;
      for (let t = new Date(s); t < to && n < 60; t = new Date(t.getTime() + x.p.hours * 36e5), n++) if (t >= from) out.push({ d: new Date(t), x }); return; }
    if (x.k === 'once') { const t = new Date(x.p.date + 'T' + x.p.time); if (t >= from && t < to) out.push({ d: t, x }); return; }
    const [hh, mm] = (x.p.time || '00:00').split(':').map(Number);
    const day = new Date(from); day.setHours(0, 0, 0, 0);
    for (; day < to; day.setDate(day.getDate() + 1)) {
      const wd = (day.getDay() + 6) % 7; let ok = false;
      if (x.k === 'daily') ok = true;
      else if (x.k === 'weekdays') ok = x.p.days.includes(wd);
      else if (x.k === 'monthly') {
        if (x.p.mode === 'day') ok = day.getDate() === +x.p.day;
        else if (wd === +x.p.weekday) { if (x.p.mode === 'first') ok = day.getDate() <= 7; else { const n = new Date(day); n.setDate(n.getDate() + 7); ok = n.getMonth() !== day.getMonth(); } }
      }
      if (ok) { const t = new Date(day); t.setHours(hh, mm, 0, 0); if (t >= from) out.push({ d: t, x }); }
    }
  });
  return out.filter(o => !pz || o.d > pz).sort((a, b) => a.d - b.d);
}
function nextText(r) {
  if (!r.on) return tr('Off');
  if (!r.triggers.length) return tr('No time chosen');
  const now = new Date(); const n = occ(r, now, new Date(now.getTime() + 70 * 864e5))[0];
  const free = r.triggers.find(x => !byK.t[x.k].sched);
  if (n) return tr('Next: {day} at {time}', { day: relDay(n.d), time: hm(n.d) });
  if (r.pausedUntil) return tr('Paused until {date}', { date: fmtDate(r.pausedUntil) });
  return free ? cap(sayOf('t', free)) : tr('No upcoming date');
}

/* ================= controles ================= */
const segH = (key, list, val, cls = '') => `<div class="seg ${cls}" data-seg="${key}"><span class="ind"></span>${list.map(([v, n]) => `<button data-v="${v}"${String(val) === String(v) ? ' class="on"' : ''}>${n}</button>`).join('')}</div>`;
const togH = (attr, on, label) => `<button class="toggle${on ? ' on' : ''}" ${attr} aria-label="${esc(label)}"><i></i></button>`;
function paramH(s, i, k, spec, v) {
  const path = `${s}:${i}:${k}`; const lab = spec.label ? `<span class="pl">${esc(spec.label)}</span>` : '';   // labels are translated in the catalog
  switch (spec.type) {
    case 'time': return `<label class="pp">${lab}<input type="time" class="field pi" data-path="${path}" value="${esc(v)}"></label>`;
    case 'date': return `<label class="pp">${lab}<input type="date" class="field pi" data-path="${path}" value="${esc(v)}" min="${iso(new Date())}"></label>`;
    case 'text': return `<label class="pp grow">${lab}<input type="text" class="field pi" data-path="${path}" value="${esc(v)}" placeholder="${esc(spec.ph || '')}" spellcheck="false"></label>`;
    case 'num': return `<span class="pp">${lab}<span class="ap-num"><button data-step="-1" data-path="${path}" aria-label="${esc(tr('Less'))}">${ic('minus')}</button><input type="number" class="pi" data-path="${path}" value="${v}" min="${spec.min}" max="${spec.max}" step="${spec.step || 1}"><em>${esc(spec.unit || '')}</em><button data-step="1" data-path="${path}" aria-label="${esc(tr('More'))}">${ic('plus')}</button></span></span>`;
    case 'select': {
      const o = opts(spec.opts);
      /* a saved drive this PC no longer has: kept, selected and flagged */
      (spec.legacy || []).forEach(l => { if (String(v) === String(l[0])) o.push(l); });   /* an old value stays visible, but can't be picked for new routines */
      const gone = spec.opts === DRIVES && drivesReal && v && !o.some(([ov]) => String(ov) === String(v));
      if (gone) o.unshift([v, tr('{drive} (not found on this PC)', { drive: v })]);
      return `<label class="pp">${lab}<span class="ap-selw${gone ? ' gone' : ''}"${gone ? ` title="${esc(tr("This drive isn't connected now. Choose another one, or connect it again."))}"` : ''}><select class="pi" data-path="${path}">${o.map(([ov, ol]) => `<option value="${esc(ov)}"${String(v) === String(ov) ? ' selected' : ''}>${esc(ol)}</option>`).join('')}</select>${ic('chevd')}</span></label>`;
    }
    case 'days': return `<span class="pp">${lab}<span class="ap-days">${DAYS.map((d, j) => `<button class="ap-day${v.includes(j) ? ' on' : ''}" data-path="${path}" data-day="${j}" title="${esc(cap(DAYN[j]))}">${esc(d)}</button>`).join('')}</span></span>`;
    case 'multi': return `<span class="pp wide">${lab}<span class="ap-multi">${opts(spec.opts).map(([ov, ol]) => `<button class="ap-mc${v.includes(ov) ? ' on' : ''}" data-path="${path}" data-opt="${esc(ov)}">${ic('check')}${esc(ol)}</button>`).join('')}</span></span>`;
  }
  return '';
}
function itemH(s, x, i, n) {
  const d = byK[s][x.k]; if (!d) return '';
  const ps = Object.entries(d.p || {}).filter(([, spec]) => !spec.show || spec.show(x.p));
  const isA = s === 'a';
  return `<div class="si" data-i="${i}" data-k="${x.k}">
    ${isA ? `<span class="si-grip" title="${esc(tr('Drag to reorder'))}">${ic('drag')}</span>` : ''}
    <span class="si-ic">${isA ? `<em>${i + 1}</em>` : ic(d.ic)}</span>
    <div class="si-b"><div class="si-t"><b>${esc(d.t)}</b>${d.mod ? `<em>${esc(modName(d.mod))}</em>` : ''}${d.admin ? `<span class="chip">${tr('Administrator')}</span>` : ''}${d.decide && d.decide(x.p) ? `<span class="chip acc">${tr('Asks you')}</span>` : ''}</div>
      ${ps.length ? `<div class="si-p">${ps.map(([k, spec]) => paramH(s, i, k, spec, x.p[k])).join('')}</div>` : ''}
      ${ps.length ? `<div class="si-say">${esc(cap(d.say(x.p)))}</div>` : ''}</div>
    <div class="si-tools">${isA ? `<button class="iconbtn" data-mv="-1"${i === 0 ? ' disabled' : ''} title="${esc(tr('Move up'))}">${ic('up')}</button><button class="iconbtn" data-mv="1"${i === n - 1 ? ' disabled' : ''} title="${esc(tr('Move down'))}">${ic('down')}</button>` : ''}<button class="iconbtn" data-rm title="${esc(tr('Remove'))}">${ic('x')}</button></div>
  </div>`;
}

/* ================= Routines tab ================= */
let rEl = null;
const STEPS = [
  { id: 't', n: tr('When'), ic: 'clock', help: tr('Choose one or more moments. It runs on whichever comes first.') },
  { id: 'c', n: tr('Only if'), ic: 'filter', help: tr('Optional. If they aren’t met, the routine waits for the next time.') },
  { id: 'a', n: tr('What it does'), ic: 'list', help: tr('Runs in order, top to bottom. Drag by the dots to reorder.') },
  { id: 'after', n: tr('Afterwards'), ic: 'restore', help: tr('What happens if something fails, and what to do when it finishes.') },
  { id: 'n', n: tr('Notifications'), ic: 'bell', help: tr('When and how this routine lets you know. Quiet hours are set in the Notifications tab.') },
];
const stepCount = (r, s) => s === 't' ? r.triggers.length : s === 'c' ? r.conds.length : s === 'a' ? r.acts.length : 0;

function renderRoutines(el) { ensure(); rEl = el; el.classList.add('fill'); drawRoutines(); }
function drawRoutines() {
  const el = rEl; if (!el) return;
  if (!R.length) {
    el.innerHTML = `<div class="ap-empty pan" data-asm>
      <div class="ape-hero">
        <div class="ape-art" aria-hidden="true"><svg viewBox="0 0 120 120"><ellipse cx="60" cy="60" rx="50" ry="20" class="o1"/><ellipse cx="60" cy="60" rx="34" ry="14" class="o2"/><circle cx="60" cy="60" r="10" class="c0"/><circle r="4" class="p1"><animateMotion dur="9s" repeatCount="indefinite" path="M110,60 A50,20 0 1,1 10,60 A50,20 0 1,1 110,60"/></circle><circle r="3" class="p2"><animateMotion dur="6s" repeatCount="indefinite" path="M26,60 A34,14 0 1,0 94,60 A34,14 0 1,0 26,60"/></circle></svg></div>
        <h2>${tr('Create your first routine')}</h2>
        <p>${tr('A routine does the maintenance for you. You choose when, under what conditions and what it does; StellarHub takes care of the rest.')}</p>
        <div class="ape-btns"><button class="btn pri lg" data-new>${ic('plus')}${tr('Blank routine')}</button></div>
      </div>
      <div class="ape-tpls"><span class="ape-l">${tr('Or start from a template')}</span><div class="ape-grid">${TEMPLATES.map((t, i) => `<button class="ape-t" data-tpl="${i}"><span class="ape-ti">${ic(t.ic)}</span><b>${esc(t.n)}</b><span>${esc(t.d)}</span></button>`).join('')}</div></div>
    </div>`;
    const svg = $('.ape-art svg', el); if (svg && SH.effInt() === 'min') svg.pauseAnimations();
    $$('.ape-t', el).forEach((b, i) => anim(b, [{ opacity: 0, transform: 'translate3d(0,12px,0) scale(.97)' }, { opacity: 1, transform: 'none' }], { d: 460, delay: 200 + i * 45, e: EASE.spring, keep: true }));
    return;
  }
  if (!cur()) sel = R[0].id;
  el.innerHTML = `<div class="ap">
    <div class="ap-side">
      <div class="pan ap-listp"><div class="pan-h">${tr('Your routines')} <em id="apCount"></em></div><div class="ap-cards" id="apList"></div></div>
      <div class="pan ap-tplp"><button class="ap-tplh" id="apTplH">${ic('sparkle')}<span>${tr('Add from a template')}</span>${ic('chevd')}</button>
        <div class="ap-tplb"><div><div class="ap-tpls">${TEMPLATES.map((t, i) => `<button class="ap-t" data-tpl="${i}"><span class="ape-ti">${ic(t.ic)}</span><span><b>${esc(t.n)}</b><span>${esc(t.d)}</span></span></button>`).join('')}</div></div></div></div>
    </div>
    <div class="pan ap-ed" id="apEd"></div></div>`;
  drawList(true); drawEditor(false);
  $('#apList', el).addEventListener('click', e => {
    const card = e.target.closest('.ap-card'); if (!card) return; const r = R.find(x => x.id === card.dataset.id); if (!r) return;
    if (e.target.closest('.toggle')) { r.on = !r.on; e.target.closest('.toggle').classList.toggle('on', r.on); card.classList.toggle('off', !r.on); $('.ap-next', card).textContent = nextText(r); save(); if (r.id === sel) refreshMeta(); SH.toast(r.on ? tr('“{name}” turned on.', { name: r.name }) : tr('“{name}” turned off.', { name: r.name })); return; }
    if (r.id !== sel) { sel = r.id; $$('.ap-card', el).forEach(c => c.classList.toggle('sel', c.dataset.id === sel)); drawEditor(false); }
  });
  $('#apTplH', el).addEventListener('click', e => { const p = e.currentTarget.parentElement; p.classList.toggle('open'); });
}
function cardH(r) {
  const bad = problems(r).length;
  const first = r.triggers.length ? cap(sayOf('t', r.triggers[0])) : '';
  const tl = !r.triggers.length ? tr('No time chosen') : r.triggers.length > 1 ? tr('{list} and {n} more', { list: first, n: r.triggers.length - 1 }) : first;
  const run = RUN[r.id];
  return `<div class="ap-card${r.id === sel ? ' sel' : ''}${r.on ? '' : ' off'}${run ? ' running' : ''}" data-id="${r.id}" style="--c:${colorOf(r)}"><i class="ap-dot"></i>
    <div class="ap-ct"><b>${esc(r.name)}${r.priority === 'high' ? ` <span class="ap-pr">${tr('high')}</span>` : ''}</b><span>${esc(tl)}</span><span class="ap-next${bad && !run ? ' warn' : ''}">${run ? esc(runFor(run)) : bad ? esc(tr('Incomplete: {problem}', { problem: lcFirst(problems(r)[0][1]) })) : esc(nextText(r))}</span></div>
    ${togH('', r.on, tr('Turn on {name}', { name: r.name }))}</div>`;
}
function drawList(anims) {
  const list = $('#apList', rEl); if (!list) return;
  $('#apCount', rEl).textContent = tr('{n} of {total} active', { n: R.filter(r => r.on).length, total: R.length });
  list.innerHTML = R.map(cardH).join('');
  if (anims) $$('.ap-card', list).forEach((c, i) => anim(c, [{ opacity: 0, transform: 'translate3d(-10px,0,0)' }, { opacity: 1, transform: 'none' }], { d: 380, delay: i * 35, e: EASE.spring, keep: true }));
}
function refreshCard(r) { const c = $(`.ap-card[data-id="${r.id}"]`, rEl); if (!c) return; const t = document.createElement('div'); t.innerHTML = cardH(r); const n = t.firstElementChild; c.replaceWith(n); $('#apCount', rEl).textContent = tr('{n} of {total} active', { n: R.filter(x => x.on).length, total: R.length }); }
function addRoutine(r, quiet) {
  const first = !R.length; R.unshift(r); sel = r.id; step = r.triggers.length ? 't' : 't'; save(r);
  if (first) { drawRoutines(); } else { drawList(); drawEditor(false); }
  const c = $(`.ap-card[data-id="${r.id}"]`, rEl); if (c) anim(c, [{ opacity: 0, transform: 'translate3d(0,-12px,0) scale(.95)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 520, e: EASE.spring });
  if (!quiet) SH.toast(tr('“{name}” created.', { name: r.name }));
  if (calDirty) calDirty();
}

/* ---------- editor ---------- */
function drawEditor(soft) {
  const ed = $('#apEd', rEl); const r = cur(); if (!ed) return;
  if (!r) { ed.innerHTML = SH.emptyState({ art: 'first', title: tr('Choose a routine'), text: tr('Or create a new one at the top right.') }); return; }
  const html = `
    <div class="ape-head">
      <button class="ap-sw" style="--c:${colorOf(r)}" title="${esc(tr('Change the color'))}" aria-label="${esc(tr('Change the color'))}"></button>
      <input class="ap-name" id="apName" value="${esc(r.name)}" maxlength="48" spellcheck="false" aria-label="${esc(tr('Routine name'))}">
      <div class="ape-tools">
        <button class="btn ghost sm" id="apDry" title="${esc(tr('Shows what it would do right now, without doing anything'))}">${ic('flask')}<span class="lbl">${tr('Dry run')}</span></button>
        <button class="btn sec sm" id="apRun" title="${esc(tr('Run now'))}">${ic('play')}<span class="lbl">${tr('Run now')}</span></button>
        <div class="ap-more"><button class="iconbtn" id="apMore" aria-label="${esc(tr('More options'))}">${ic('dots')}</button>
          <div class="ap-menu" id="apMenu" hidden>
            <button data-m="dup">${ic('dup')}${tr('Duplicate')}</button>
            <div class="ap-mpause"><span>${ic('pause')}${tr('Pause until')}</span><input type="date" class="field" id="apPauseD" value="${esc(r.pausedUntil || '')}" min="${iso(new Date())}"></div>
            ${r.pausedUntil ? `<button data-m="unpause">${ic('play')}${tr('Resume')}</button>` : ''}
            <button data-m="color">${ic('palette')}${tr('Change the color')}</button>
            <button data-m="del" class="danger">${ic('trash')}${tr('Delete')}</button>
          </div></div>
      </div>
    </div>
    <div class="ap-live" id="apLive" role="status" aria-live="polite" hidden><span class="ap-spin"></span><span class="apl-t"><b></b><span></span></span><span class="apl-el"></span></div>
    <p class="ap-sum" id="apSum">${esc(summary(r))}</p>
    <nav class="ap-steps" id="apSteps"><span class="ind"></span>${STEPS.map((s, i) => `<button data-step="${s.id}"${s.id === step ? ' class="on"' : ''}><span class="sn">${ic(s.ic)}</span><span class="sl">${esc(s.n)}</span><em data-c="${s.id}"></em></button>`).join('')}</nav>
    <div class="ap-stage" id="apStage"></div>
    <footer class="ape-foot" id="apFoot"></footer>
    <div class="ap-dry" id="apDryP" hidden></div>`;
  const done = () => {
    ed.innerHTML = html; refreshMeta(); refreshCounts(); drawStage(0); refreshFoot(); bindEditor(ed); paintRun(r.id);
    requestAnimationFrame(() => placeStepInd(true));
  };
  if (soft) { done(); return; }
  const a = anim(ed, [{ opacity: 1, transform: 'none', filter: 'blur(0px)' }, { opacity: 0, transform: 'translate3d(14px,0,0)', filter: 'blur(5px)' }], { d: ed.childElementCount ? 140 : 1 });
  const go = () => { done(); anim(ed, [{ opacity: 0, transform: 'translate3d(-14px,0,0)', filter: 'blur(5px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 420, e: EASE.spring }); };
  a ? a.finished.then(go).catch(go) : go();
}
function refreshMeta() { refreshFoot(); }
function refreshCounts() { const r = cur(); $$('#apSteps [data-c]', rEl).forEach(e => { const n = stepCount(r, e.dataset.c); e.textContent = n || ''; e.hidden = !n; }); const bad = new Set(problems(r).map(p => p[0])); $$('#apSteps button', rEl).forEach(b => b.classList.toggle('bad', bad.has(b.dataset.step))); }
function refreshFoot() {
  const r = cur(), f = $('#apFoot', rEl); if (!f || !r) return; const p = problems(r); const i = STEPS.findIndex(s => s.id === step);
  f.innerHTML = `<div class="apf-st">${p.length ? `<span class="chip warn">${ic('alert')}${tr('Incomplete')}</span><button class="apf-go" data-go="${p[0][0]}">${esc(p[0][1])}</button>${p.length > 1 ? `<span class="faint">${tr('and {n} more', { n: p.length - 1 })}</span>` : ''}`
      : `${r.on ? `<span class="chip ok">${ic('check')}${tr('Ready to go')}</span>` : `<span class="chip">${tr('Off')}</span>`}${r.pausedUntil ? `<span class="chip warn">${ic('pause')}${esc(tr('Paused until {date}', { date: fmtDate(r.pausedUntil) }))}</span>` : ''}<span class="faint apf-next">${esc(r.on ? nextText(r) : tr('Turn it on in the list so it runs.'))}</span>`}</div>
    <div class="apf-nav"><button class="btn ghost sm" data-nav="-1"${i === 0 ? ' disabled' : ''}>${tr('Back')}</button><button class="btn sec sm" data-nav="1">${esc(i === STEPS.length - 1 ? tr('Done') : tr('Next: {step}', { step: STEPS[i + 1].n }))}</button></div>`;
}
function placeStepInd(snap) {
  const nav = $('#apSteps', rEl); if (!nav) return; const b = $(`button[data-step="${step}"]`, nav), ind = $('.ind', nav); if (!b) return;
  const x = b.offsetLeft, w = b.offsetWidth;
  if (snap || !ind.dataset.x) { ind.getAnimations().forEach(a => a.cancel()); ind.style.width = w + 'px'; ind.style.transform = `translateX(${x}px)`; }
  else anim(ind, [{ transform: `translateX(${ind.dataset.x}px)`, width: ind.dataset.w + 'px' }, { transform: `translateX(${x}px)`, width: w + 'px' }], { d: 420, e: EASE.spring });
  ind.dataset.x = x; ind.dataset.w = w;
}
function setStep(s) {
  if (s === step) return; const old = STEPS.findIndex(x => x.id === step), ni = STEPS.findIndex(x => x.id === s); step = s;
  $$('#apSteps button', rEl).forEach(b => b.classList.toggle('on', b.dataset.step === s)); placeStepInd(); drawStage(ni > old ? 1 : -1); refreshFoot();
}
function changed(opt = {}) {
  const r = cur(); save(r);
  const s = $('#apSum', rEl); if (s) { const t = summary(r); if (s.textContent !== t) { s.textContent = t; anim(s, [{ opacity: .45 }, { opacity: 1 }], { d: 260 }); } }
  refreshCounts(); refreshFoot(); refreshCard(r); if (opt.meta) refreshMeta(); if (calDirty) calDirty();
}

/* ---------- stage for each step ---------- */
function catH(s) {
  const q = norm(query[s].trim());
  const html = CAT[s].map(([g, items]) => {
    const f = items.filter(d => !q || norm(d.t + ' ' + tr(g) + ' ' + modName(d.mod)).includes(q)); if (!f.length) return '';
    const open = q || openGroups[s].has(g); const used = new Set(listOf(cur(), s).map(x => x.k));
    return `<div class="cg${open ? ' open' : ''}" data-g="${esc(g)}"><button class="cg-h"><span>${esc(tr(g))}</span><em>${f.length}</em>${ic('chevd')}</button>
      <div class="cg-b"><div>${f.map(d => { const na = NA[s][d.k];
        return `<button class="cg-it${na ? ' na' : ''}" data-add="${d.k}"${na ? ` aria-disabled="true" title="${esc(na)}"` : ''}><span class="cg-ic">${ic(d.ic)}</span><span class="cg-t">${esc(d.t)}${na ? `<i>${tr('not available')}</i>` : d.admin ? `<i>${tr('administrator')}</i>` : ''}</span>${used.has(d.k) ? `<em>${tr('added')}</em>` : ''}${ic(na ? 'info' : 'plus')}</button>`; }).join('')}</div></div></div>`;
  }).join('');
  return html || SH.emptyState({ art: 'none', small: true, title: esc(tr('Nothing matches “{q}”', { q: query[s] })), text: tr('Try another word.') });
}
function stageCatalogH(s) {
  const r = cur(), list = listOf(r, s), meta = STEPS.find(x => x.id === s);
  const head = s === 'c' && list.length > 1 ? `<div class="st-mode"><span>${tr('Met when')}</span>${segH('condMode', [['all', tr('all')], ['any', tr('any')]], r.condMode, 'sm')}</div>` : '';
  const emptyTxt = { t: [tr('No time yet'), tr('Choose from the catalog when it should run.')], c: [tr('No conditions'), tr('It will run every time its moment comes. Add conditions if you want more control.')], a: [tr('Doesn’t do anything yet'), tr('Add actions from the catalog. They run in the order of the list.')] }[s];
  return `<div class="st-grid">
    <div class="st-sel"><div class="st-h"><b>${s === 't' ? tr('Chosen times') : s === 'c' ? tr('Conditions') : tr('Actions, in order')}</b><span class="faint">${esc(meta.help)}</span></div>${head}
      <div class="st-list" id="stList">${list.length ? list.map((x, i) => itemH(s, x, i, list.length)).join('') : `<div class="st-empty"><span>${ic(meta.ic)}</span><b>${emptyTxt[0]}</b><p>${emptyTxt[1]}</p></div>`}</div></div>
    <div class="st-cat"><div class="field st-q">${ic('search')}<input id="stQ" placeholder="${esc(tr('Search the catalog'))}" value="${esc(query[s])}" spellcheck="false" autocomplete="off"></div>
      <div class="st-groups" id="stGroups">${catH(s)}</div></div>
  </div>`;
}
function stageAfterH() {
  const r = cur(), a = r.after; const others = R.filter(o => o.id !== r.id);
  const rsel = (k, v) => `<span class="ap-selw"><select class="pi" data-after="${k}">${others.length ? others.map(o => `<option value="${o.id}"${v === o.id ? ' selected' : ''}>${esc(o.name)}</option>`).join('') : `<option value="">${tr('No other routines')}</option>`}</select>${ic('chevd')}</span>`;
  return `<div class="st-cards">
    <div class="sc"><b>${tr('If an action fails')}</b><span class="faint">${tr('For example, if an app can’t be updated because it’s open.')}</span>
      ${segH('onFail', [['continue', tr('Move on to the next')], ['stop', tr('Stop the routine')], ['retry', tr('Retry')]], a.onFail)}
      <div class="sc-row${a.onFail === 'retry' ? '' : ' dis'}"><span>${tr('Retries')}</span><span class="ap-num"><button data-astep="-1" data-after="retries" aria-label="${esc(tr('Less'))}">${ic('minus')}</button><input type="number" class="pi" data-after="retries" value="${a.retries}" min="1" max="5"><em>${tr('times')}</em><button data-astep="1" data-after="retries" aria-label="${esc(tr('More'))}">${ic('plus')}</button></span></div></div>
    <div class="sc"><b>${tr('If it couldn’t run')}</b><span class="faint">${tr('Because the PC was off or the conditions weren’t met.')}</span>
      <div class="sc-row"><span>${tr('Try again the next day')}</span>${togH('data-atog="tomorrow"', a.tomorrow, tr('Try again the next day'))}</div>
      <div class="sc-row"><span>${tr('Cancel if it takes longer than')}</span><span class="ap-num"><button data-astep="-15" data-after="limit" aria-label="${esc(tr('Less'))}">${ic('minus')}</button><input type="number" class="pi" data-after="limit" value="${a.limit}" min="15" max="480" step="15"><em>min</em><button data-astep="15" data-after="limit" aria-label="${esc(tr('More'))}">${ic('plus')}</button></span></div></div>
    <div class="sc"><b>${tr('When it finishes well')}</b><span class="faint">${tr('Something else to do when everything went as expected.')}</span>
      ${segH('okThen', [['none', tr('Nothing')], ['sleep', tr('Sleep')], ['off', tr('Shut down')], ['routine', tr('Another routine')]], a.okThen)}
      <div class="sc-row${a.okThen === 'routine' ? '' : ' hid'}"><span>${tr('Run')}</span>${rsel('okRoutine', a.okRoutine)}</div></div>
    <div class="sc"><b>${tr('If something fails')}</b><span class="faint">${tr('What to do when at least one action didn’t go well.')}</span>
      ${segH('failThen', [['none', tr('Nothing')], ['notify', tr('Always notify me')], ['routine', tr('Another routine')]], a.failThen)}
      <div class="sc-row${a.failThen === 'routine' ? '' : ' hid'}"><span>${tr('Run')}</span>${rsel('failRoutine', a.failRoutine)}</div></div>
    <div class="sc"><b>${tr('Priority')}</b><span class="faint">${tr('If two routines overlap, the higher priority one goes first.')}</span>
      ${segH('priority', [['low', tr('Low')], ['normal', tr('Normal')], ['high', tr('High')]], r.priority)}</div>
    <div class="sc"><div class="sc-row"><span><b>${tr('Save a report to the log')}</b><span class="faint">${tr('Step by step: what was done, how long it took and what it freed up.')}</span></span>${togH('data-atog="report"', a.report, tr('Save a report to the log'))}</div></div>
  </div>`;
}
function stageNotifyH() {
  const n = cur().notify;
  return `<div class="st-cards two">
    <div class="sc"><b>${tr('When it notifies you')}</b><span class="faint">${tr('For this routine only.')}</span>
      ${segH('nwhen', [['always', tr('Always')], ['decide', tr('When there’s a decision')], ['errors', tr('If something fails')], ['never', tr('Never')]], n.when)}
      <div class="sc-row"><span>${tr('Windows notification')}</span>${togH('data-ntog="toast"', n.toast, tr('Windows notification'))}</div>
      <div class="sc-row"><span>${tr('Dot on the tray icon')}</span>${togH('data-ntog="tray"', n.tray, tr('Dot on the tray icon'))}</div>
      <div class="sc-row"><span>${tr('Soft sound')}</span>${togH('data-ntog="sound"', n.sound, tr('Soft sound'))}</div>
      <div class="sc-row"><span>${tr('Include it in the weekly summary')}</span>${togH('data-ntog="weekly"', n.weekly, tr('Include it in the weekly summary'))}</div></div>
    <div class="sc prev"><b>${tr('Preview')}</b><div class="nt-desk sm"><div class="nt-toast" id="stPrev"></div><div class="nt-tray"><span class="nt-ti">${ic('home')}<i id="stDot"></i></span><span class="faint">${hm(new Date())}</span></div></div></div>
  </div>`;
}
function previewToastH(when, sound, name) {
  const gb = fmt1(4.2);
  const msg = when === 'errors' ? [tr('Something didn’t go well'), tr('“{name}”: Spotify couldn’t be updated because it was open.', { name })]
    : when === 'decide' ? [tr('2 drivers are waiting for your approval'), tr('“{name}” finished the rest: {gb} GB freed.', { name, gb })]
    : when === 'never' ? [tr('No notifications'), tr('This routine works quietly. You’ll see everything in the log.')]
    : [tr('“{name}” finished', { name }), tr('{gb} GB freed and 3 apps updated.', { gb })];
  return `<div class="nt-th"><span class="nt-ai">${ic('autopilot')}</span><span>StellarHub</span>${sound ? `<span class="nt-snd">${ic('speaker')}</span>` : ''}</div><b>${esc(msg[0])}</b><span>${esc(msg[1])}</span>${when === 'decide' ? `<div class="nt-tb"><span>${tr('Review')}</span><span>${tr('Later')}</span></div>` : ''}`;
}
function drawStage(dir) {
  const st = $('#apStage', rEl); if (!st) return;
  const html = step === 'after' ? stageAfterH() : step === 'n' ? stageNotifyH() : stageCatalogH(step);
  st.innerHTML = html;
  if (step === 'n') { const n = cur().notify, p = $('#stPrev', st); p.innerHTML = previewToastH(n.when, n.sound, cur().name); p.classList.toggle('off', !n.toast || n.when === 'never'); $('#stDot', st).classList.toggle('on', n.tray && n.when !== 'never'); }
  requestAnimationFrame(() => $$('.seg', st).forEach(s => SH.placeSeg(s, true)));
  if (dir) {
    anim(st, [{ opacity: 0, transform: `translate3d(${dir * 34}px,0,0)`, filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 440, e: EASE.spring });
    $$('.si, .sc, .cg', st).forEach((x, i) => anim(x, [{ opacity: 0, transform: 'translate3d(0,8px,0)' }, { opacity: 1, transform: 'none' }], { d: 380, delay: 60 + Math.min(i, 10) * 30, e: EASE.spring, keep: true }));
  }
}
function redrawList(flashI) {
  const r = cur(), list = listOf(r, step), box = $('#stList', rEl); if (!box) return;
  const meta = STEPS.find(x => x.id === step);
  if (!list.length) { drawStage(0); return; }
  box.innerHTML = list.map((x, i) => itemH(step, x, i, list.length)).join('');
  if (step === 'c') { const sg = $('.st-sel', rEl); const has = $('.st-mode', sg); if (list.length > 1 && !has) drawStage(0); else if (list.length <= 1 && has) has.remove(); }
  if (flashI !== undefined) { const n = $(`.si[data-i="${flashI}"]`, box); if (n) { anim(n, [{ opacity: 0, transform: 'translate3d(0,10px,0) scale(.97)' }, { opacity: 1, transform: 'none' }], { d: 440, e: EASE.spring }); n.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }
  void meta;
}
function refreshItem(i) {
  const r = cur(), list = listOf(r, step), n = $(`#stList .si[data-i="${i}"]`, rEl); if (!n) return;
  const t = document.createElement('div'); t.innerHTML = itemH(step, list[i], i, list.length); const fresh = t.firstElementChild; n.replaceWith(fresh);
  const p = $('.si-p', fresh); if (p) anim(p, [{ opacity: .4 }, { opacity: 1 }], { d: 260 });
}
function updateSay(i) { const r = cur(), x = listOf(r, step)[i], n = $(`#stList .si[data-i="${i}"] .si-say`, rEl); if (n && x) n.textContent = cap(byK[step][x.k].say(x.p)); }
function setParam(path, raw) {
  const [s, si, k] = path.split(':'); const i = +si; const r = cur(), x = listOf(r, s)[i]; if (!x) return;
  const spec = byK[s][x.k].p[k]; let v = raw;
  if (spec.type === 'num') { const stp = spec.step || 1; v = Math.round(+raw / stp) * stp; if (!isFinite(v)) v = spec.def; v = Math.max(spec.min, Math.min(spec.max, v)); }
  x.p[k] = v;
  const deps = Object.values(byK[s][x.k].p).some(z => z.show);
  if (deps && spec.type === 'select') refreshItem(i); else updateSay(i);
  changed();
  return v;
}

/* ---------- drag to reorder actions ---------- */
function startDrag(e, item) {
  e.preventDefault(); const box = item.parentElement; const items = [...box.children]; const idx = items.indexOf(item);
  const h = item.offsetHeight + 8; const y0 = e.clientY; let to = idx;
  item.classList.add('drag'); box.classList.add('dragging');
  const move = ev => {
    const dy = ev.clientY - y0; item.style.transform = `translate3d(0,${dy}px,0) scale(1.015)`;
    to = Math.max(0, Math.min(items.length - 1, idx + Math.round(dy / h)));
    items.forEach((it, i) => { if (it === item) return; let s = 0; if (idx < to && i > idx && i <= to) s = -h; if (idx > to && i < idx && i >= to) s = h; it.style.transform = s ? `translate3d(0,${s}px,0)` : ''; });
  };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    box.classList.remove('dragging'); item.classList.remove('drag'); items.forEach(it => it.style.transform = '');
    if (to !== idx) { const r = cur(); const [a] = r.acts.splice(idx, 1); r.acts.splice(to, 0, a); redrawList(); changed(); const n = $(`#stList .si[data-i="${to}"]`, rEl); if (n) anim(n, [{ transform: 'scale(1.02)' }, { transform: 'none' }], { d: 300, e: EASE.spring }); }
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
}

/* ---------- editor events ---------- */
function bindEditor(ed) {
  const r = () => cur();
  $('#apName', ed).addEventListener('input', e => { r().name = e.target.value.trim() || tr('Untitled'); changed(); });
  const recolor = () => { const x = r(); x.color = ((x.color || 0) + 1) % COLORS.length; const sw = $('.ap-sw', ed); sw.style.setProperty('--c', colorOf(x)); anim(sw, [{ transform: 'scale(.6)' }, { transform: 'scale(1)' }], { d: 380, e: EASE.spring }); changed(); };
  $('.ap-sw', ed).addEventListener('click', recolor);
  $('#apSteps', ed).addEventListener('click', e => { const b = e.target.closest('[data-step]'); if (b) setStep(b.dataset.step); });
  $('#apFoot', ed).addEventListener('click', e => {
    const g = e.target.closest('[data-go]'); if (g) { setStep(g.dataset.go); return; }
    const n = e.target.closest('[data-nav]'); if (!n || n.disabled) return; const i = STEPS.findIndex(s => s.id === step) + +n.dataset.nav;
    if (i >= STEPS.length) { const p = problems(r()); SH.toast(p.length ? tr('Still missing: {problem}.', { problem: lcFirst(p[0][1]) }) : tr('“{name}” is ready and saved.', { name: r().name })); return; }
    if (i >= 0) setStep(STEPS[i].id);
  });
  /* more-options menu */
  const menu = $('#apMenu', ed);
  $('#apMore', ed).addEventListener('click', e => { e.stopPropagation(); if (!menu.hidden) { closeMenu(); return; } menu.hidden = false; anim(menu, [{ opacity: 0, transform: 'translate3d(0,-6px,0) scale(.96)' }, { opacity: 1, transform: 'none' }], { d: 260, e: EASE.spring }); });
  menu.addEventListener('click', e => {
    const b = e.target.closest('[data-m]'); if (!b) return; const x = r();
    if (b.dataset.m === 'dup') { closeMenu(); addRoutine({ ...clone(x), id: 'r' + (uid++), name: tr('{name} (copy)', { name: x.name }) }); }
    if (b.dataset.m === 'color') { recolor(); }
    if (b.dataset.m === 'unpause') { x.pausedUntil = ''; closeMenu(); changed({ meta: true }); drawEditor(true); SH.toast(tr('“{name}” is running again.', { name: x.name })); }
    if (b.dataset.m === 'del') { closeMenu(); delRoutine(x); }
  });
  $('#apPauseD', ed).addEventListener('change', e => { const x = r(); x.pausedUntil = e.target.value; changed({ meta: true }); SH.toast(x.pausedUntil ? tr('“{name}” paused until {date}.', { name: x.name, date: fmtDate(x.pausedUntil) }) : tr('Resumed.')); closeMenu(); setTimeout(() => drawEditor(true), 160); });
  $('#apRun', ed).addEventListener('click', () => runNow(r()));
  $('#apDry', ed).addEventListener('click', () => dryRun(r()));

  /* stage: catalog, items and settings */
  const st = $('#apStage', ed);
  st.addEventListener('input', e => {
    if (e.target.id === 'stQ') { query[step] = e.target.value; const g = $('#stGroups', st); g.innerHTML = catH(step); $$('.cg-it', g).forEach((b, i) => anim(b, [{ opacity: 0 }, { opacity: 1 }], { d: 200, delay: Math.min(i, 12) * 14 })); return; }
    const p = e.target.closest('[data-path]'); if (p && (p.type === 'text')) setParam(p.dataset.path, p.value);
  });
  st.addEventListener('change', e => {
    const p = e.target.closest('[data-path]'); if (p && p.tagName !== 'BUTTON' && p.type !== 'text') { const v = setParam(p.dataset.path, p.value); if (p.type === 'number') p.value = v; return; }
    const a = e.target.closest('[data-after]'); if (a && a.tagName !== 'BUTTON') { const x = r(); const k = a.dataset.after; x.after[k] = a.type === 'number' ? Math.max(+a.min, Math.min(+a.max, +a.value || +a.min)) : a.value; if (a.type === 'number') a.value = x.after[k]; changed(); }
  });
  st.addEventListener('pointerdown', e => { const g = e.target.closest('.si-grip'); if (g && step === 'a') startDrag(e, g.closest('.si')); });
  st.addEventListener('click', e => {
    const x = r();
    const add = e.target.closest('[data-add]'); if (add) {
      if (NA[step][add.dataset.add]) { SH.toast(NA[step][add.dataset.add]); return; }
      const list = listOf(x, step); list.push(newItem(step, add.dataset.add)); const i = list.length - 1;
      if (list.length === 1 || (step === 'c' && list.length === 2)) drawStage(0); else redrawList(i);
      if (list.length === 1) { const n = $(`#stList .si`, st); if (n) anim(n, [{ opacity: 0, transform: 'translate3d(0,10px,0) scale(.97)' }, { opacity: 1, transform: 'none' }], { d: 440, e: EASE.spring }); }
      const em = add.querySelector('em'); if (!em) add.insertAdjacentHTML('beforeend', `<em>${tr('added')}</em>`);
      anim(add, [{ transform: 'scale(.97)' }, { transform: 'none' }], { d: 260, e: EASE.spring });
      changed(); return;
    }
    const gh = e.target.closest('.cg-h'); if (gh) { const g = gh.parentElement; g.classList.toggle('open'); const name = g.dataset.g; openGroups[step][g.classList.contains('open') ? 'add' : 'delete'](name); return; }
    const si = e.target.closest('.si');
    if (si) {
      const i = +si.dataset.i, list = listOf(x, step);
      if (e.target.closest('[data-rm]')) { anim(si, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate3d(24px,0,0) scale(.97)' }], { d: 200 }).finished.then(() => { list.splice(i, 1); if (!list.length || (step === 'c' && list.length === 1)) drawStage(0); else redrawList(); const g = $('#stGroups', st); if (g) g.innerHTML = catH(step); changed(); }).catch(() => {}); return; }
      const mv = e.target.closest('[data-mv]'); if (mv && !mv.disabled) { const j = i + +mv.dataset.mv; [list[i], list[j]] = [list[j], list[i]]; redrawList(); const n = $(`#stList .si[data-i="${j}"]`, st); if (n) anim(n, [{ transform: `translate3d(0,${-mv.dataset.mv * 40}px,0)` }, { transform: 'none' }], { d: 420, e: EASE.spring }); changed(); return; }
      const sb = e.target.closest('[data-step]'); if (sb && sb.dataset.path) { const inp = $(`input[data-path="${sb.dataset.path}"]`, si); const spec = byK[step][list[i].k].p[sb.dataset.path.split(':')[2]]; const v = setParam(sb.dataset.path, +inp.value + (+sb.dataset.step) * (spec.step || 1)); inp.value = v; anim(inp, [{ transform: 'scale(1.12)' }, { transform: 'none' }], { d: 260, e: EASE.spring }); return; }
      const day = e.target.closest('.ap-day'); if (day) { const [, , k] = day.dataset.path.split(':'); const arr = list[i].p[k]; const d = +day.dataset.day; const at = arr.indexOf(d); if (at >= 0) arr.splice(at, 1); else arr.push(d); day.classList.toggle('on', arr.includes(d)); anim(day, [{ transform: 'scale(.85)' }, { transform: 'scale(1)' }], { d: 300, e: EASE.spring }); updateSay(i); changed(); return; }
      const mc = e.target.closest('.ap-mc'); if (mc) { const [, , k] = mc.dataset.path.split(':'); const arr = list[i].p[k]; const o = mc.dataset.opt; const at = arr.indexOf(o); if (at >= 0) arr.splice(at, 1); else arr.push(o); mc.classList.toggle('on', arr.includes(o)); updateSay(i); changed(); return; }
    }
    const sg = e.target.closest('.seg button'); if (sg && !sg.classList.contains('on')) {
      const s = sg.parentElement; $$('button', s).forEach(b => b.classList.toggle('on', b === sg)); SH.placeSeg(s); const k = s.dataset.seg, v = sg.dataset.v;
      if (k === 'condMode') { x.condMode = v; changed(); }
      else if (k === 'priority') { x.priority = v; changed(); }
      else if (k === 'nwhen') { x.notify.when = v; const p = $('#stPrev', st); p.innerHTML = previewToastH(v, x.notify.sound, x.name); p.classList.toggle('off', !x.notify.toast || v === 'never'); $('#stDot', st).classList.toggle('on', x.notify.tray && v !== 'never'); anim(p, [{ opacity: 0, transform: 'translate3d(30px,0,0)' }, { opacity: 1, transform: 'none' }], { d: 420, e: EASE.spring }); changed(); }
      else { x.after[k] = v; const row = $(`[data-after="${k === 'okThen' ? 'okRoutine' : k === 'failThen' ? 'failRoutine' : 'retries'}"]`, st); const box = row && row.closest('.sc-row');
        if (box) { const show = (k === 'onFail' && v === 'retry') || ((k === 'okThen' || k === 'failThen') && v === 'routine'); box.classList.toggle(k === 'onFail' ? 'dis' : 'hid', !show); if (show && k !== 'onFail') { const se = $('select', box); if (se && se.value) x.after[k === 'okThen' ? 'okRoutine' : 'failRoutine'] = se.value; } }
        changed(); }
      return;
    }
    const as = e.target.closest('[data-astep]'); if (as) { const k = as.dataset.after; const inp = $(`input[data-after="${k}"]`, st); const v = Math.max(+inp.min, Math.min(+inp.max, +inp.value + +as.dataset.astep)); inp.value = v; x.after[k] = v; anim(inp, [{ transform: 'scale(1.12)' }, { transform: 'none' }], { d: 260, e: EASE.spring }); changed(); return; }
    const at = e.target.closest('[data-atog]'); if (at) { const k = at.dataset.atog; x.after[k] = !x.after[k]; at.classList.toggle('on', x.after[k]); changed(); return; }
    const nt = e.target.closest('[data-ntog]'); if (nt) { const k = nt.dataset.ntog; x.notify[k] = !x.notify[k]; nt.classList.toggle('on', x.notify[k]); const p = $('#stPrev', st); if (p) { p.innerHTML = previewToastH(x.notify.when, x.notify.sound, x.name); p.classList.toggle('off', !x.notify.toast || x.notify.when === 'never'); $('#stDot', st).classList.toggle('on', x.notify.tray && x.notify.when !== 'never'); } changed(); return; }
  });
}
function closeMenu() {
  const menu = rEl && $('#apMenu', rEl); if (!menu || menu.hidden) return;
  anim(menu, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate3d(0,-4px,0) scale(.97)' }], { d: 140 }).finished.then(() => { menu.hidden = true; }).catch(() => { menu.hidden = true; });
}
document.addEventListener('pointerdown', ev => { if (rEl && !ev.target.closest('.ap-more')) closeMenu(); });
function delRoutine(x) {
  SH.sound('delete');  /* from the routine's menu: no confirmation, the toast has Undo */
  const i = R.indexOf(x); const card = $(`.ap-card[data-id="${x.id}"]`, rEl);
  const go = () => { R.splice(i, 1); sel = R[0] && R[0].id; save(); drawRoutines(); if (calDirty) calDirty();
    SH.toast(tr('“{name}” deleted.', { name: x.name }), { action: { label: tr('Undo'), sound: 'undo', run: () => { R.splice(i, 0, x); sel = x.id; save(); drawRoutines(); if (calDirty) calDirty(); } } }); };
  card ? anim(card, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate3d(-20px,0,0) scale(.96)' }], { d: 220 }).finished.then(go).catch(go) : go();
}

/* ---------- dry run and run ---------- */
function evalCond(x) {
  const v = SH.tele.v, p = x.p, now = new Date(), wd = (now.getDay() + 6) % 7, t = hm(now);
  switch (x.k) {
    case 'plugged': return [!!v.charging, v.charging ? tr('it’s plugged in') : tr('it’s on battery')];
    case 'battery': return [v.battery >= p.pct, tr('the battery is at {pct}%', { pct: Math.round(v.battery) })];
    case 'idle': return [false, tr('you’re using it right now')];
    case 'noFull': return [true, tr('nothing is in full screen')];
    case 'cpu': return [v.cpu < p.pct, tr('the processor is at {pct}%', { pct: Math.round(v.cpu) })];
    case 'noMeeting': return [true, tr('microphone and camera are free')];
    case 'window': { const inW = p.from <= p.to ? (t >= p.from && t < p.to) : (t >= p.from || t < p.to); return [inW, tr('it’s {time} now', { time: t })]; }
    case 'days': return [p.days.includes(wd), tr('today is {day}', { day: DAYN[wd] })];
    case 'unmetered': return [true, tr('the connection isn’t metered')];
    case 'onWifi': { const home = tr('Home'); return [p.ssid.toLowerCase() === home.toLowerCase(), tr('you’re on “{ssid}”', { ssid: home })]; }
    case 'junk': return [18.6 >= p.gb, tr('there are {gb} GB of junk', { gb: fmt1(18.6) })];
    case 'diskFree': return [(p.drive === 'C:' ? 361 : 820) < p.gb, tr('{drive} has {gb} GB free', { drive: p.drive, gb: p.drive === 'C:' ? 361 : 820 })];
    case 'admin': return [!!state.admin, state.admin ? tr('StellarHub is running as administrator') : tr('StellarHub is in normal mode')];
    case 'notSince': { const last = LOG.find(l => l.rid === cur().id); const h = last ? (Date.now() - last.when) / 36e5 : Infinity; return [h >= p.hours, last ? tr('it ran {h} h ago', { h: Math.max(1, Math.round(h)) }) : tr('it has never run')]; }
    case 'app': return [p.st === 'closed', tr('{app} is closed', { app: appName(p.app) })];
  }
  return [true, ''];
}
const fmtDur = s => s < 60 ? `${Math.max(1, Math.round(s))} ${U('s')}` : `${Math.round(s / 60)} ${U('min')}`;
async function dryRun(r) {
  const box = $('#apDryP', rEl); if (!box) return;
  let ev, ok, notes;
  if (REAL) {                      // the engine checks the conditions on this PC right now; nothing runs
    let d;
    try { d = await SH.engine('autopilot', 'dry_run', clone(r)); } catch (e) { SH.toast(tr('The dry run failed: {error}', { error: e.message }), { kind: 'error' }); return; }
    /* each condition: [met, text in the engine's language, message] — the message is shown in the interface's language */
    ev = r.conds.map((x, i) => { const c = (d.conds || [])[i] || [true, '']; return [x, c[0], c[2] ? msgText(c[2]) : c[1]]; }); ok = d.ok;
    notes = r.acts.map((x, i) => { const a = (d.acts || [])[i] || {}; return { text: a.noteM ? msgText(a.noteM) : a.note || '', admin: !!a.needAdmin }; });
  } else {
    ev = r.conds.map(x => [x, ...evalCond(x)]); ok = !ev.length || (r.condMode === 'all' ? ev.every(e => e[1]) : ev.some(e => e[1]));
    notes = r.acts.map(x => byK.a[x.k].admin && !state.admin ? { text: tr('would be skipped: needs administrator'), admin: true } : { text: byK.a[x.k].decide && byK.a[x.k].decide(x.p) ? tr('would ask you first') : '', admin: false });
  }
  const total = r.acts.reduce((s, x) => s + (x.k === 'wait' ? x.p.min * 60 : (byK.a[x.k].est || 10)), 0);
  const needsAdmin = notes.filter(n => n.admin);
  const naT = r.triggers.filter(x => NA.t[x.k]);
  const condK = ev.length > 1 ? (r.condMode === 'all' ? tr('Conditions, all') : tr('Conditions, any')) : tr('Conditions');
  box.innerHTML = `<div class="dry-h"><span class="dry-i">${ic('flask')}</span><div><b>${tr('Dry run')}</b><span>${REAL ? tr('Checked on this PC right now. Nothing actually runs.') : tr('This is how it would go if it fired now. Nothing actually happens.')}</span></div><button class="iconbtn" data-close aria-label="${esc(tr('Close'))}">${ic('x')}</button></div>
    <div class="dry-b">
      <div class="dry-s"><span class="dry-k">${tr('When')}</span>${r.triggers.length ? r.triggers.map(x => `<div class="dry-l${NA.t[x.k] ? ' bad' : ''}">${ic(byK.t[x.k].ic)}<span>${esc(cap(sayOf('t', x)))}${NA.t[x.k] ? `<em>${esc(NA.t[x.k])}</em>` : ''}</span></div>`).join('') : '<div class="dry-l bad">' + ic('alert') + `<span>${tr('No time chosen')}</span></div>`}</div>
      <div class="dry-s"><span class="dry-k">${condK}</span>${ev.length ? ev.map(([x, o, d]) => `<div class="dry-l ${o ? 'ok' : 'bad'}">${ic(o ? 'check' : 'x')}<span>${esc(cap(sayOf('c', x)))}<em>${esc(d)}</em></span></div>`).join('') : '<div class="dry-l ok">' + ic('check') + `<span>${tr('No conditions: it always runs')}</span></div>`}</div>
      <div class="dry-verdict ${ok && r.acts.length ? 'ok' : 'bad'}">${ok ? (r.acts.length ? tr('It would run now.') : tr('It would run, but it has no actions.')) : tr('It wouldn’t run now: a condition isn’t met.')}</div>
      <div class="dry-s"><span class="dry-k">${r.acts.length ? tr('It would do, in this order, about {time}', { time: fmtDur(total) }) : tr('It would do, in this order')}</span>${r.acts.map((x, i) => `<div class="dry-l n">${'<em class="dn">' + (i + 1) + '</em>'}<span>${esc(cap(sayOf('a', x)))}${notes[i].text ? `<em>${esc(notes[i].text)}</em>` : ''}</span></div>`).join('') || `<div class="dry-l faint"><span>${tr('Nothing yet')}</span></div>`}</div>
      ${naT.length && naT.length === r.triggers.length ? `<div class="dry-note">${ic('info')}<span>${tr('None of its triggers can fire on this PC yet, so it will only run with “Run now”.')}</span></div>` : ''}
      ${needsAdmin.length && !state.admin ? `<div class="dry-note">${ic('shield')}<span>${needsAdmin.length === 1 ? tr('{n} action needs administrator mode. Turn it on so they run.', { n: 1 }) : tr('{n} actions need administrator mode. Turn it on so they run.', { n: needsAdmin.length })}</span><button class="btn sec sm" data-admin>${tr('Turn on')}</button></div>` : ''}
    </div>`;
  box.hidden = false;
  anim(box, [{ opacity: 0, transform: 'translate3d(0,14px,0) scale(.98)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 440, e: EASE.spring });
  $$('.dry-l, .dry-verdict, .dry-note', box).forEach((x, i) => anim(x, [{ opacity: 0, transform: 'translate3d(-8px,0,0)' }, { opacity: 1, transform: 'none' }], { d: 360, delay: 120 + i * 70, e: EASE.spring, keep: true }));
  box.onclick = e => {
    if (e.target.closest('[data-admin]')) { SH.go('admin'); return; }
    if (e.target.closest('[data-close]')) anim(box, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate3d(0,10px,0) scale(.98)' }], { d: 180 }).finished.then(() => { box.hidden = true; }).catch(() => { box.hidden = true; });
  };
}
/* ---------- "Run now" live status: the button (step), a line under the editor head (what it is doing now, the last
   output line, elapsed time) and the card. Kept per routine, so switching routines and back still shows it. ---------- */
const RUN = {};                          // routine id -> { t0, btn, text, line }
let runTimer = 0;
const clock = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
const runSecs = x => (Date.now() - x.t0) / 1000;
const runFor = x => tr('Running for {time}', { time: clock(runSecs(x)) });
function paintRun(id) {
  if (!rEl) return;
  const x = RUN[id], r = cur();
  if (r && r.id === id) {
    const b = $('#apRun', rEl);
    if (b) {
      b.disabled = !!x; b.classList.toggle('busy', !!x);
      const lbl = x ? (x.btn || tr('Starting…')) : tr('Run now');
      if (b.dataset.lbl !== lbl) { b.dataset.lbl = lbl; b.innerHTML = `${x ? '<span class="ap-spin"></span>' : ic('play')}<span class="lbl">${esc(lbl)}</span>`; }
      b.title = x ? tr('Running. This can take several minutes.') : tr('Run now');
    }
    const l = $('#apLive', rEl);
    if (l) {
      l.hidden = !x;
      if (x) {
        $('.apl-t b', l).textContent = x.text || tr('Starting…');
        const sub = $('.apl-t span', l); sub.textContent = x.line || ''; sub.hidden = !x.line;
        $('.apl-el', l).textContent = tr('Elapsed {time}', { time: clock(runSecs(x)) });
      }
    }
  }
  const c = $(`.ap-card[data-id="${id}"]`, rEl);
  if (c) { c.classList.toggle('running', !!x); if (x) { const n = $('.ap-next', c); if (n) { n.classList.remove('warn'); n.textContent = runFor(x); } } }
}
function runBegin(id) {
  RUN[id] = { t0: Date.now(), btn: '', text: '', line: '' }; paintRun(id);
  if (!runTimer) runTimer = setInterval(() => { const ids = Object.keys(RUN); if (!ids.length) { clearInterval(runTimer); runTimer = 0; return; } ids.forEach(paintRun); }, 1000);
}
function runSet(id, o) { if (RUN[id]) { Object.assign(RUN[id], o); paintRun(id); const a = APACT[id]; if (a && ('pct' in o || 'text' in o)) a.progress(RUN[id].pct ?? null, RUN[id].text || null); } }
/* "Run now" is followed from anywhere (SH.activity); Autopilot's own toast (with View the log) says how it went */
const APACT = {};
function apEnd(id, res) { const a = APACT[id]; delete APACT[id]; if (a) a.end({ toast: false, ...res }); }
function runEnd(id) { delete RUN[id]; paintRun(id); }

async function runNow(r) {
  if (RUN[r.id]) return;                 // already running: a second click does nothing
  if (!r.acts.length) { SH.toast(tr('This routine doesn’t do anything yet. Add an action to it.'), { action: { label: tr('Add'), run: () => setStep('a') } }); return; }
  runBegin(r.id);
  APACT[r.id] = SH.activity.start('autopilot', { key: 'run:' + r.id, label: r.name || tr('Routine'), go: { tab: 'log' } });
  let ended = false;
  try {
    if (REAL) { await runReal(r, () => { runEnd(r.id); ended = true; }); return; }
    const steps = []; let gb = 0, upd = 0;
    for (let i = 0; i < r.acts.length; i++) {
      const x = r.acts[i], d = byK.a[x.k];
      runSet(r.id, { btn: tr('Step {n} of {total}', { n: i + 1, total: r.acts.length }), text: cap(sayOf('a', x)), line: '', pct: i / r.acts.length });
      await wait(x.k === 'wait' ? 500 : 520 + Math.random() * 700);
      const what = { say: ['a', x.k, clone(x.p)] };
      const addStep = (k, m) => steps.push([k, msgEn(m), m]);
      if (d.admin && !state.admin) { addStep('skip', M('{name}: {result}', { name: what, result: M('skipped, needs administrator mode') })); continue; }
      if (d.decide && d.decide(x.p)) { addStep('decide', M('{name}: {result}', { name: what, result: M('{n} waiting for your approval', { n: 2 }) })); continue; }
      if (x.k === 'clean') { const g = 1.2 + Math.random() * 5; gb += g; addStep('ok', M('{name}: {result}', { name: M('Cleanup'), result: M('{gb} GB freed', { gb: { n1: g } }) })); continue; }
      if (x.k === 'apps') { upd += 3; addStep('ok', M('{name}: {result}', { name: M('Apps'), result: M('{n} updated', { n: 3 }) })); continue; }
      addStep('ok', M('{name}: {result}', { name: what, result: M('done (simulated)') }));
    }
    const st = steps.some(s => s[0] === 'bad') ? 'bad' : steps.some(s => s[0] === 'skip' || s[0] === 'decide') ? 'warn' : 'ok';
    const res = []; if (gb) res.push(M('{gb} GB freed', { gb: { n1: gb } })); if (upd) res.push(M('{n} apps updated', { n: upd })); const sk = steps.filter(s => s[0] === 'skip').length; if (sk) res.push(sk === 1 ? M('{n} step skipped', { n: 1 }) : M('{n} steps skipped', { n: sk }));
    if (!res.length) res.push(M('Done'));
    LOG.unshift({ rid: r.id, when: new Date(), name: r.name, color: r.color || 0, st, gb, upd, manual: true, res: res.map(msgEn), resM: res, steps, fresh: true });
    saveLog();
    runEnd(r.id); ended = true;
    refreshCard(r); refreshMeta();
    if (lEl) drawLog(true); if (mctx) mctx.setBadge('log', LOG.filter(l => l.st === 'warn' || l.st === 'bad').length);
    apEnd(r.id, st === 'bad' ? { ok: false, error: tr('“{name}” had a problem.', { name: r.name }) } : { ok: true, summary: tr('“{name}” finished.', { name: r.name }) });
    SH.toast(tr('“{name}” finished.', { name: r.name }), { kind: st === 'bad' ? 'error' : st === 'warn' ? 'warning' : 'success', action: { label: tr('View the log'), run: () => SH.go('autopilot', { tab: 'log' }) } });
  } finally {
    if (!ended) { runEnd(r.id); refreshCard(r); }      // the button always comes back, whatever happened
    apEnd(r.id, { cancelled: true });                  // (already ended: nothing happens)
  }
}

/* "Run now" inside the app: the engine runs the routine as a job (live progress and output); the result lands in its log */
async function runReal(r, done) {
  let entry = null, err = null;
  try {
    entry = await SH.job('autopilot', 'run', [r.id, true, clone(r), ''], {
      sound: 'task',
      onProgress: m => {
        const d = m.data || {}, o = {};
        if (d.total) { o.btn = tr('Step {n} of {total}', { n: Math.min((d.step || 0) + 1, d.total), total: d.total }); o.pct = Math.min(1, (d.step || 0) / d.total); }
        if (m.text) o.text = m.text;      // the engine's live text (already translated), sub-jobs included
        runSet(r.id, o);
      },
      onLog: lines => { const last = (lines || []).map(x => String(x).trim()).filter(Boolean).pop(); if (last) runSet(r.id, { line: last }); },
    });
  } catch (e) { err = e; }
  done();
  await loadLog(true); refreshCard(r); refreshMeta();
  if (err) { apEnd(r.id, err.cancelled ? { cancelled: true } : { ok: false, error: err.message }); SH.toast(err.cancelled ? tr('“{name}” was cancelled.', { name: r.name }) : tr('“{name}” couldn’t run: {error}', { name: r.name, error: err.message }), err.cancelled ? {} : { kind: 'error' }); return; }
  const fin = { ok: '“{name}” finished.', warn: '“{name}” finished with warnings.', bad: '“{name}” had a problem.', skip: '“{name}” was skipped.' }[entry && entry.st] || '“{name}” finished.';
  apEnd(r.id, entry && entry.st === 'bad' ? { ok: false, error: tr(fin, { name: r.name }) } : { ok: true, summary: tr(fin, { name: r.name }) });
  const kind = { ok: 'success', warn: 'warning', bad: 'error' }[entry && entry.st];
  SH.toast(tr(fin, { name: r.name }), { kind, action: { label: tr('View the log'), run: () => SH.go('autopilot', { tab: 'log' }) } });
}
/* the engine's log (real runs, scheduled or manual) */
async function loadLog(animate) {
  if (!REAL) return;
  let l; try { l = await SH.engine('autopilot', 'log', 100); } catch { return; }
  const first = !seenLog.size;
  engLog = (l || []).map(x => ({ ...x, when: new Date(x.when), fresh: !first && !seenLog.has(x.id) }));
  engLog.forEach(x => seenLog.add(x.id));
  if (R) LOG = engLog;
  if (lEl && lEl.isConnected) drawLog(animate);
  if (mctx && LOG) mctx.setBadge('log', LOG.filter(x => x.st === 'warn' || x.st === 'bad').length);
}
SH.apiReady.then(a => {
  REAL = !!a; if (!REAL) return;
  loadDrives();
  SH.engine('autopilot', 'capabilities').then(c => { if (c) NA = { t: c.t || {}, c: c.c || {}, a: c.a || {} }; }).catch(() => {});
  SH.engine('autopilot', 'start').catch(() => {});      // safe if the app already started it
  loadLog(false);
});
SH.on('autopilot', m => {
  if (!m) return;
  if (m.kind === 'log') loadLog(true);
  else if (m.kind === 'pending') SH.setPending(m.key, m.n);
  else if (m.kind === 'toast') SH.toast(m.text);
  else if (m.kind === 'widget' && !!m.on !== !!SH.widgetOn) {
    const sz = SH.widgetSize(state.settings);
    SH.call('widget_toggle', sz.w, sz.h).then(v => { if (v !== undefined) SH.emit('widget', { on: !!v }); });
  }
});

/* ================= Calendar ================= */
let calOff = 0, cEl = null, calDirty = null;
function weekStart(off) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + off * 7); return d; }
function renderCalendar(el) {
  ensure(); cEl = el; el.classList.add('fill');
  el.innerHTML = `<div class="cal">
    <div class="pan cal-main" data-asm>
      <div class="cal-bar"><button class="iconbtn" data-w="-1" aria-label="${esc(tr('Previous week'))}">${ic('chev')}</button><button class="iconbtn" data-w="1" aria-label="${esc(tr('Next week'))}">${ic('chev')}</button>
        <b class="cal-t" id="calT"></b><button class="btn ghost sm" data-w="0">${tr('Today')}</button><span class="faint cal-legend" id="calLeg"></span></div>
      <div class="cal-grid" id="calGrid"></div></div>
    <div class="cal-side">
      <div class="pan cal-up" data-asm><div class="pan-h">${tr('This week')}</div><div class="cal-ul" id="calUp"></div></div>
      <div class="pan cal-fr" data-asm><div class="pan-h">${tr('No fixed time')}</div><div class="cal-ul" id="calFree"></div></div></div></div>`;
  $('.cal-bar', el).addEventListener('click', e => { const b = e.target.closest('[data-w]'); if (!b) return; const w = +b.dataset.w; const dir = w === 0 ? (calOff > 0 ? -1 : 1) : w; if (w === 0 && calOff === 0) return; calOff = w === 0 ? 0 : calOff + w; drawCal(dir); });
  el.addEventListener('click', e => { if (e.target.closest('[data-new]')) newRoutine(); const ev = e.target.closest('[data-rid]'); if (ev) { sel = ev.dataset.rid; SH.go('autopilot', { tab: 'routines' }); setTimeout(() => { if (rEl) drawRoutines(); }, 60); } });
  calDirty = () => { if (cEl && cEl.classList.contains('on')) drawCal(0); };
  drawCal(0);
}
function drawCal(dir) {
  const el = cEl; const ws = weekStart(calOff), we = new Date(ws); we.setDate(we.getDate() + 7);
  const last = new Date(we); last.setDate(last.getDate() - 1);
  const rf = dtf({ month: 'short', day: 'numeric', year: 'numeric' });
  $('#calT', el).textContent = rf.formatRange ? rf.formatRange(ws, last) : `${rf.format(ws)} – ${rf.format(last)}`;
  const today = new Date(); const todayIdx = calOff === 0 ? (today.getDay() + 6) % 7 : -1;
  const ev = []; R.forEach(r => { const perDay = {}; occ(r, ws, we).forEach(o => { const k = o.d.toDateString(); perDay[k] = (perDay[k] || 0) + 1; if (perDay[k] <= 6) ev.push({ r, d: o.d }); }); });
  const minH = ev.length ? Math.min(6, ...ev.map(e => e.d.getHours())) : 6; const H0 = minH, H1 = 24;
  const hours = Array.from({ length: H1 - H0 }, (_, i) => H0 + i);
  const grid = $('#calGrid', el);
  grid.style.setProperty('--rows', H1 - H0);
  grid.innerHTML = `<div class="cg-head"><span></span>${DAYS3.map((d, i) => { const x = new Date(ws); x.setDate(x.getDate() + i); return `<span class="${i === todayIdx ? 'today' : ''}">${esc(d)} <b>${x.getDate()}</b></span>`; }).join('')}</div>
    <div class="cg-body"><div class="cg-hours">${hours.map(h => `<span>${pad(h)}:00</span>`).join('')}</div>
    ${DAYS3.map((_, i) => `<div class="cg-col${i === todayIdx ? ' today' : ''}">${ev.filter(e => (e.d.getDay() + 6) % 7 === i).map(e => { const h = e.d.getHours() + e.d.getMinutes() / 60; const past = e.d < today;
      return `<button class="cg-ev${past ? ' past' : ''}" data-rid="${e.r.id}" style="--top:${((h - H0) / (H1 - H0) * 100).toFixed(3)}%;--c:${colorOf(e.r)}"><b>${hm(e.d)}</b><span>${esc(e.r.name)}</span>
        <span class="cg-tip"><b>${esc(e.r.name)}</b>${e.r.acts.slice(0, 5).map(a => `<span>${esc(cap(sayOf('a', a)))}</span>`).join('')}${e.r.acts.length > 5 ? `<span>${tr('and {n} more', { n: e.r.acts.length - 5 })}</span>` : ''}</span></button>`; }).join('')}
      ${i === todayIdx ? `<i class="cg-now" style="--top:${(Math.max(0, Math.min(1, (today.getHours() + today.getMinutes() / 60 - H0) / (H1 - H0))) * 100).toFixed(3)}%"></i>` : ''}</div>`).join('')}</div>
    ${!R.length ? `<div class="cal-empty"><span>${ic('calendar')}</span><b>${tr('Nothing scheduled yet')}</b><p>${tr('Routines with a date or time will show up here once you create them.')}</p><button class="btn pri" data-new>${ic('plus')}${tr('Create a routine')}</button></div>` : ''}`;
  const up = ev.filter(e => e.d >= today).sort((a, b) => a.d - b.d);
  $('#calUp', el).innerHTML = up.length ? up.slice(0, 12).map(e => `<button class="cal-row" data-rid="${e.r.id}" style="--c:${colorOf(e.r)}"><i></i><div><b>${esc(e.r.name)}</b><span>${esc(cap(tr('{day} at {time}', { day: relDay(e.d), time: hm(e.d) })))}</span></div></button>`).join('')
    : `<div class="cal-none">${R.length ? tr('Nothing else this week.') : tr('No routines yet.')}</div>`;
  const free = R.filter(r => r.on && r.triggers.some(x => !byK.t[x.k].sched));
  $('#calFree', el).innerHTML = free.length ? free.map(r => `<button class="cal-row" data-rid="${r.id}" style="--c:${colorOf(r)}"><i></i><div><b>${esc(r.name)}</b><span>${esc(cap(join(r.triggers.filter(x => !byK.t[x.k].sched).map(x => sayOf('t', x)), 'or')))}</span></div></button>`).join('')
    : `<div class="cal-none">${tr('Routines that depend on something happening (turning on the PC, unplugging, opening an app…) will show up here.')}</div>`;
  $('#calLeg', el).textContent = ev.length ? (ev.length === 1 ? tr('{n} run this week', { n: 1 }) : tr('{n} runs this week', { n: ev.length })) : tr('Nothing scheduled this week');
  if (dir) anim(grid, [{ opacity: 0, transform: `translate3d(${dir * 40}px,0,0)`, filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 440, e: EASE.spring });
  $$('.cg-ev', grid).forEach((e, i) => anim(e, [{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }], { d: 380, delay: 80 + i * 30, e: EASE.spring, keep: true }));
  const em = $('.cal-empty', grid); if (em) anim(em, [{ opacity: 0, transform: 'translate3d(-50%,-46%,0) scale(.96)' }, { opacity: 1, transform: 'translate3d(-50%,-50%,0)' }], { d: 520, delay: 120, e: EASE.spring });
}

/* ================= Notifications (general) ================= */
function renderNotify(el) {
  ensure();
  const row = (k, n, d) => `<div class="nt-row"><div class="rt"><b>${tr(n)}</b>${d ? `<span>${tr(d)}</span>` : ''}</div>${togH(`data-nt="${k}"`, NT[k], tr(n))}</div>`;
  el.innerHTML = `<div class="nt">
    <div class="pan nt-a" data-asm><div class="pan-h">${tr('Where it notifies you')}</div>
      ${row('toast', 'Windows notification', 'Bottom right, like any other app’s.')}${row('tray', 'Dot on the tray icon', 'Low-key: a colored dot until you open it.')}${row('sound', 'Soft sound', 'Only when it finishes or there’s something to decide.')}</div>
    <div class="pan nt-b" data-asm><div class="pan-h">${tr('When, unless the routine says otherwise')}</div>
      ${segH('when', [['always', tr('Always')], ['decide', tr('When there’s a decision')], ['errors', tr('If something fails')]], NT.when)}<p class="faint nt-p" id="ntWhenD"></p>
      ${row('batterySaver', 'Fewer notifications on battery', 'With Windows battery saver on, only what matters.')}</div>
    <div class="pan nt-prev" data-asm><div class="pan-h">${tr('Preview')}</div><div class="nt-desk"><div class="nt-toast" id="ntPrev"></div><div class="nt-tray"><span class="nt-ti">${ic('home')}<i id="ntDot"></i></span><span class="faint">${hm(new Date())}</span></div></div></div>
    <div class="pan nt-c" data-asm><div class="pan-h">${tr('Quiet')}</div>
      ${row('quiet', 'Quiet hours', 'Routines still run, just without notifying you.')}
      <div class="nt-q${NT.quiet ? '' : ' dis'}" id="ntQ"><label>${tr('From')} <input type="time" class="field" data-q="qFrom" value="${NT.qFrom}"></label><label>${tr('to')} <input type="time" class="field" data-q="qTo" value="${NT.qTo}"></label></div>
      ${row('noGame', 'Don’t disturb while gaming', 'No notifications or heavy routines while something is in full screen.')}</div>
    <div class="pan nt-d" data-asm><div class="pan-h">${tr('Weekly summary')}</div>
      ${row('weekly', 'One notification with the whole week', 'What your routines did, what was freed up and what’s pending.')}
      <div class="nt-wd${NT.weekly ? '' : ' dis'}" id="ntWd"><span class="faint">${tr('On')}</span>${segH('weeklyDay', DAYS.map((d, i) => [i, esc(d)]), NT.weeklyDay)}</div></div>
  </div>`;
  const WHEN_D = { always: tr('A notification every time a routine finishes.'), decide: tr('Only when there’s something to confirm, like installing a driver. Everything else happens quietly.'), errors: tr('Only if something didn’t go well. You’ll see the rest in the log.') };
  const preview = anim0 => { const p = $('#ntPrev', el);
    p.innerHTML = previewToastH(NT.when, NT.sound, tr('Weekly maintenance')); p.classList.toggle('off', !NT.toast);
    if (NT.toast && anim0) anim(p, [{ opacity: 0, transform: 'translate3d(40px,0,0)' }, { opacity: 1, transform: 'none' }], { d: 480, e: EASE.spring });
    $('#ntDot', el).classList.toggle('on', NT.tray); $('#ntWhenD', el).textContent = WHEN_D[NT.when]; };
  preview(true);
  el.addEventListener('click', e => {
    const t = e.target.closest('[data-nt]'); if (t) { const k = t.dataset.nt; NT[k] = !NT[k]; t.classList.toggle('on', NT[k]); if (k === 'quiet') $('#ntQ', el).classList.toggle('dis', !NT.quiet); if (k === 'weekly') $('#ntWd', el).classList.toggle('dis', !NT.weekly); saveNT(); preview(['toast', 'sound'].includes(k)); return; }
    const b = e.target.closest('.seg button'); if (b) { const s = b.parentElement; if (b.classList.contains('on')) return; $$('button', s).forEach(x => x.classList.toggle('on', x === b)); SH.placeSeg(s); NT[s.dataset.seg] = s.dataset.seg === 'weeklyDay' ? +b.dataset.v : b.dataset.v; saveNT(); preview(s.dataset.seg === 'when'); }
  });
  $$('[data-q]', el).forEach(i => i.addEventListener('change', e => { NT[i.dataset.q] = e.target.value; saveNT(); }));
  requestAnimationFrame(() => $$('.seg', el).forEach(s => SH.placeSeg(s, true)));
}

/* ================= Log ================= */
let lEl = null, logFilter = 'all';
function renderLog(el) {
  ensure(); lEl = el; el.classList.add('fill');
  el.innerHTML = `<div class="lgw">
    <div class="pan lg-main" data-asm><div class="lg-h"><div class="pan-h">${tr('Runs')}</div>${segH('f', [['all', tr('All')], ['issues', tr('With warnings or failures')]], logFilter, 'sm')}</div><div id="lgList" class="lg-list"></div></div>
    <div class="lg-side">
      <div class="pan lg-st" data-asm><div class="pan-h">${tr('This month')}</div>
        <div class="lg-n"><b class="big" id="lgN">0</b><span>${tr('runs')}</span></div>
        <div class="lg-n"><b class="big" id="lgGB">0</b><span>${tr('GB freed')}</span></div>
        <div class="lg-n"><b class="big" id="lgU">0</b><span>${tr('apps and drivers brought up to date')}</span></div>
        <div class="lg-n"><b class="big" id="lgW">0</b><span>${tr('with warnings or failures')}</span></div></div>
      <div class="pan lg-by" data-asm><div class="pan-h">${tr('By routine')}</div><div id="lgBy" class="lg-byl"></div></div>
      <div class="pan lg-cl" data-asm><div class="pan-h">${tr('When StellarHub is closed')}</div>
        <p>${tr('Routines run while StellarHub is open, even hidden in the tray. If you quit it, nothing runs; times missed in the last 12 hours run when it opens again.')}</p>
        ${state.settings.startWithWindows ? `<span class="chip ok">${ic('check')}${tr('Opens with Windows')}</span>` : `<button class="btn sec sm" data-autostart>${ic('power')}${tr('Open it with Windows')}</button>`}</div>
    </div></div>`;
  const s = $('.lg-h .seg', el);
  s.addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.classList.contains('on')) return; $$('button', s).forEach(x => x.classList.toggle('on', x === b)); SH.placeSeg(s); logFilter = b.dataset.v; drawLog(true); });
  el.addEventListener('click', e => { const b = e.target.closest('[data-autostart]'); if (!b) return;
    SH.call('set_autostart', true).then(v => {
      if (v === undefined) { SH.toast(tr('This only works inside the app.'), { kind: 'unavailable' }); return; }
      if (v === false) { SH.toast(tr('Windows did not allow changing automatic startup.'), { kind: 'error' }); return; }
      SH.setSetting('startWithWindows', true); b.outerHTML = `<span class="chip ok">${ic('check')}${tr('Opens with Windows')}</span>`;
      SH.toast(tr('StellarHub will open hidden in the tray when Windows starts.')); }); });
  $('#lgList', el).addEventListener('click', e => { if (e.target.closest('[data-goto]')) { SH.go('autopilot', { tab: 'routines' }); return; } const h = e.target.closest('.lg-hd'); if (h) h.parentElement.classList.toggle('open'); });
  requestAnimationFrame(() => SH.placeSeg(s, true));
  drawLog(false);
}
function drawLog(anims) {
  const el = lEl; if (!el) return;
  const items = LOG.filter(l => logFilter === 'all' || l.st !== 'ok');
  const ST = { ok: ['ok', tr('Done')], warn: ['warn', tr('With warnings')], skip: ['', tr('Skipped')], bad: ['bad', tr('Failed')] };
  const RSEP = ZH ? '，' : CJK ? '、' : ', ';
  const SI = { ok: 'check', decide: 'info', skip: 'clock', bad: 'alert' };
  let day = '', html = '';
  items.forEach(l => { const dl = pastDay(l.when); if (dl !== day) { day = dl; html += `<div class="lg-day">${esc(dl)}</div>`; }
    html += `<div class="lg-it${l.fresh ? ' fresh' : ''}" style="--c:${COLORS[(l.color || 0) % COLORS.length]}"><button class="lg-hd"><span class="lg-t">${hm(l.when)}</span><i class="lg-dot"></i><span class="rt"><b>${esc(l.name)}${l.manual ? ` <em>${tr('manual')}</em>` : ''}</b><span>${(l.res || []).map((x, i) => esc(logText(x, (l.resM || [])[i]))).join(RSEP)}</span></span><span class="chip ${(ST[l.st] || ST.ok)[0]}">${(ST[l.st] || ST.ok)[1]}</span>${ic('chevd')}</button>
      <div class="lg-d"><div><div class="lg-steps">${(l.steps || []).map(([k, text, m]) => `<div class="lg-s ${k}">${ic(SI[k] || 'check')}<span>${esc(logText(text, m))}</span></div>`).join('')}</div></div></div></div>`; });
  const list = $('#lgList', el);
  list.innerHTML = html || (LOG.length
    ? '<div class="lg-empty"><span>' + ic('check') + `</span><b>${tr('No warnings or failures')}</b><p>${tr('Everything that ran went well.')}</p></div>`
    : `<div class="lg-empty"><span>${ic('list')}</span><b>${tr('Nothing has run yet')}</b><p>${tr('When a routine runs, you’ll see what it did here, step by step: what was freed, what was updated and what needed your approval.')}</p><button class="btn sec" data-goto>${ic('autopilot')}${tr('Go to routines')}</button></div>`);
  LOG.forEach(l => l.fresh = false);
  if (anims) $$('.lg-it, .lg-day', list).forEach((x, i) => anim(x, [{ opacity: 0, transform: 'translate3d(0,8px,0)' }, { opacity: 1, transform: 'none' }], { d: 380, delay: Math.min(i, 12) * 28, e: EASE.spring }));
  const now = new Date(); const month = LOG.filter(l => l.when.getMonth() === now.getMonth() && l.when.getFullYear() === now.getFullYear());
  const n = month.length, gb = month.reduce((s, l) => s + (l.gb || 0), 0), u = month.reduce((s, l) => s + (l.upd || 0), 0), w = month.filter(l => l.st !== 'ok').length;
  const setN = (id, v, dec) => { const e = $(id, el); if (+e.dataset.v !== v) SH.countUp(e, v, 800, dec); };
  setN('#lgN', n); setN('#lgGB', +gb.toFixed(1), 1); setN('#lgU', u); setN('#lgW', w);
  const by = {}; LOG.forEach(l => { by[l.name] = by[l.name] || { n: 0, c: l.color || 0 }; by[l.name].n++; });
  const ent = Object.entries(by).sort((a, b) => b[1].n - a[1].n); const max = ent.length ? ent[0][1].n : 1;
  $('#lgBy', el).innerHTML = ent.length ? ent.map(([name, v]) => `<div class="lg-bi" style="--c:${COLORS[v.c % COLORS.length]}"><div><b>${esc(name)}</b><span>${v.n === 1 ? tr('{n} time', { n: 1 }) : tr('{n} times', { n: v.n })}</span></div><span class="bar"><span style="transform:scaleX(${(v.n / max).toFixed(3)})"></span></span></div>`).join('')
    : `<div class="cal-none">${tr('Once there are runs, you’ll see here how many times each routine ran.')}</div>`;
}

/* ================= module registration ================= */
let mctx = null;
function newRoutine() {
  ensure(); if (mctx) mctx.setTab('routines');
  const make = () => { if (!rEl) return; step = 't'; addRoutine(mk({ color: R.length % COLORS.length }), true);
    setTimeout(() => { const n = $('#apName', rEl); if (n) { n.focus(); n.select(); } }, 480); };
  rEl ? setTimeout(make, 60) : setTimeout(make, 380);
}
document.addEventListener('click', e => { if (rEl && rEl.isConnected && e.target.closest('#v-autopilot .ap-empty [data-new]')) newRoutine(); const t = e.target.closest('#v-autopilot [data-tpl]'); if (t && rEl) { step = 't'; addRoutine(TEMPLATES[+t.dataset.tpl].r()); } });
SH.module({
  id: 'autopilot',
  actions(el, ctx) {
    mctx = ctx; el.innerHTML = `<button class="btn pri" id="apNew">${ic('plus')}${tr('New routine')}</button>`;
    $('#apNew', el).addEventListener('click', newRoutine);
  },
  renderTab(tab, el) { ({ routines: renderRoutines, calendar: renderCalendar, notify: renderNotify, log: renderLog })[tab](el); },
  enterTab(tab) {
    if (tab === 'calendar' && cEl) drawCal(0);
    if (tab === 'routines' && rEl) { if (R.length && $('#apList', rEl)) { drawList(); refreshMeta(); } else drawRoutines(); }
    if (tab === 'log' && lEl) drawLog(false);
  },
  enter() { ensure(); if (REAL) loadLog(false); if (mctx) mctx.setBadge('log', LOG.filter(l => l.st === 'warn' || l.st === 'bad').length); },
});
SH.actions.add([
  { t: tr('Create an automatic routine'), go: 'autopilot', tab: 'routines', ic: 'autopilot' },
  { t: tr('See when routines run'), go: 'autopilot', tab: 'calendar', ic: 'calendar' },
  { t: tr('Change how scheduled tasks notify me'), go: 'autopilot', tab: 'notify', ic: 'bell' },
  { t: tr('See what scheduled tasks did'), go: 'autopilot', tab: 'log', ic: 'list' },
]);
})();
