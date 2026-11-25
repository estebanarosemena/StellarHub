/* StellarHub · Program Updater.
   Inside the app everything is REAL (stellarhub/engine/updater.py): winget, Windows Update, Store, components, pip and npm.
   Outside the app (browser, design tests) it uses the sample data below, with the same shape. */
'use strict';
(() => {
const { $, $$, state, Spring, EASE, anim, tickers, ic, esc, fmt1 } = SH;
const t = SH.t;
const ID = 'updater';
SH.icons.add({
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  pin: '<path d="M9 3.5h6l-1 5.5 3.5 3.5h-11L10 9z"/><path d="M12 12.5V21"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 6.1"/><path d="M20 4v7h-7"/>',
  plug: '<path d="M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0z"/><path d="M12 16.5V21"/>',
  gamepad: '<rect x="2.5" y="7" width="19" height="11" rx="5"/><path d="M7.5 10.5v4M5.5 12.5h4M15.5 11.5h.01M18 13.5h.01"/>',
});
let REAL = false;
SH.apiReady.then(a => { REAL = !!a; });

/* ---------------- categories ---------------- */
const CATS = {
  security: { n: t('Security'), l: t('security'), u: t('Update security'), ic: 'shield', tab: 'windows' },
  apps: { n: t('Apps'), l: t('apps'), u: t('Update apps'), ic: 'package', tab: 'apps' },
  windows: { n: 'Windows', l: 'Windows', u: t('Update Windows'), ic: 'windows', tab: 'windows' },
  store: { n: t('Store'), l: t('store'), u: t('Update the Store'), ic: 'store', tab: 'store' },
  runtimes: { n: t('Components'), l: t('components'), u: t('Update components'), ic: 'layers', tab: 'runtimes' },
  dev: { n: t('Development'), l: t('development'), u: t('Update development'), ic: 'code', tab: 'dev' },
};
const CAT_ORDER = ['security', 'apps', 'windows', 'store', 'runtimes', 'dev'];

/* ---------------- sample data (only outside the app) ---------------- */
const N = (o) => ({ admin: false, reboot: false, notes: [], kind: 'mock', ...o });
const ITEMS = [
  N({ id: 'def', cat: 'security', name: t('Microsoft Defender signatures'), pub: 'Microsoft', from: '1.441.212.0', to: '1.441.388.0', mb: 82, notes: [t('New threat definitions released today.')] }),
  N({ id: 'kb-cu', cat: 'security', name: 'November cumulative update (KB5072033)', pub: 'Windows Update', from: '26200.7019', to: '26200.7171', mb: 412, admin: true, reboot: true, kb: 'KB5072033', notes: [t('Fixes 64 vulnerabilities, 3 of them critical.')] }),
  N({ id: 'chrome', cat: 'apps', name: 'Google Chrome', pub: 'Google', from: '131.0.6778.86', to: '131.0.6778.109', mb: 112, color: '#6FA8FF', notes: [t('Fixes 7 security bugs.')] }),
  N({ id: 'discord', cat: 'apps', name: 'Discord', pub: 'Discord Inc.', from: '1.0.9172', to: '1.0.9175', mb: 98, color: '#8EA2FF' }),
  N({ id: 'vscode', cat: 'apps', name: 'Visual Studio Code', pub: 'Microsoft', from: '1.106.2', to: '1.107.0', mb: 104, color: '#4FB3FF' }),
  N({ id: '7zip', cat: 'apps', name: '7-Zip', pub: 'Igor Pavlov', from: '24.08', to: '25.01', mb: 1.6, color: '#C9D4E8' }),
  N({ id: 'vlc', cat: 'apps', name: 'VLC media player', pub: 'VideoLAN', from: '3.0.21', to: '3.0.22', mb: 42, color: '#FFB27A' }),
  N({ id: 'obs', cat: 'apps', name: 'OBS Studio', pub: 'OBS Project', from: '31.1.2', to: '32.0.2', mb: 140, color: '#B8C4D9' }),
  N({ id: 'npp', cat: 'apps', name: 'Notepad++', pub: 'Don Ho', from: '8.8.6', to: '8.8.8', mb: 6, color: '#A8D672' }),
  N({ id: 'ssu', cat: 'windows', name: 'Servicing stack update', pub: 'Windows Update', from: '', to: '', mb: 18, admin: true }),
  N({ id: 'kb-prev', cat: 'windows', name: 'November cumulative preview (KB5072590)', pub: 'Windows Update', from: '', to: 'KB5072590', mb: 420, admin: true, reboot: true, optional: true, kb: 'KB5072590' }),
  N({ id: 'terminal', cat: 'store', name: 'Windows Terminal', pub: 'Microsoft Store', from: '1.23.12811', to: '1.23.13013', mb: 36, color: '#C9D4E8' }),
  N({ id: 'dotnet8', cat: 'runtimes', name: '.NET Desktop Runtime 8', pub: 'Microsoft', from: '8.0.21', to: '8.0.22', mb: 55 }),
  N({ id: 'vcredist', cat: 'runtimes', name: 'Visual C++ 2015-2022 (x64)', pub: 'Microsoft', from: '14.44.35211', to: '14.50.35719', mb: 25 }),
  N({ id: 'node', cat: 'dev', name: 'Node.js', pub: 'OpenJS Foundation', from: '24.19.0', to: '24.20.0', mb: 31 }),
  N({ id: 'ghcli', cat: 'dev', name: 'GitHub CLI', pub: 'GitHub', from: '2.102.0', to: '2.104.0', mb: 12 }),
];
const MOCK = {
  apps: () => ({ winget: true, items: ITEMS.filter(i => !['security', 'windows'].includes(i.cat)).map(x => ({ ...x })), pins: {},
    unknown: [{ name: 'FL Studio 2026', pub: 'Image-Line', ver: '26.1.3.5570', url: 'https://www.image-line.com/' }, { name: 'Melodyne 5', pub: 'Celemony', ver: '5.4.2', url: 'https://www.celemony.com/' }, { name: 'iZotope RX 11 Audio Editor', pub: 'iZotope', ver: '11.3.0', url: 'https://www.izotope.com/' }],
    storeOk: [['Calculator', '11.2508.4.0'], ['Snipping Tool', '11.2509.23.0'], ['Notepad', '11.2508.38.0'], ['Paint', '11.2508.361.0']].map(([name, ver]) => ({ name, ver })),
    runtimesOk: [{ name: 'WebView2 Runtime', ver: '157.0.4341.60' }, { name: '.NET Desktop Runtime 9', ver: '9.0.11' }],
    devOk: [{ name: 'Git', ver: '2.56.0' }], ts: Date.now() / 1000 }),
  win: () => ({ updates: ITEMS.filter(i => ['security', 'windows'].includes(i.cat) && i.id !== 'def').map(x => ({ ...x })), reboot: false, pause: null,
    history: [['October cumulative update (KB5068861)', '2026-10-15', true], ['September cumulative preview (KB5066198)', '2026-09-25', false]].map(([t, d, ok]) => ({ t, d, ok, hr: '0x800F0922' })),
    defender: { on: true, sig: '1.441.212.0' }, build: '26200.7019', version: '25H2', product: 'Windows 11 Pro', ts: Date.now() / 1000 }),
  dev: () => ({ python: '3.13.14', pip: [['pip', '26.1.2', '26.3'], ['pywebview', '6.2.1', '6.3.0'], ['pillow', '12.0.0', '12.1.0']], node: '24.19.0', npm: [['typescript', '5.9.3', '6.0.2']], git: '2.56.0', tools: [['WSL', '3.0.5.0']] }),
};
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- state ---------------- */
const S = { items: [], byId: {}, sel: new Set(), ignored: new Set(), pinned: new Set(), apps: null, win: null, dev: null,
  scanned: false, winScanned: false, devScanned: false, paused: null, reboot: false, errs: {}, prog: {}, acts: {},
  /* fromCache[kind]: what is shown comes from the last check of an earlier session (see hydrate) */
  fromCache: {} };
/* ---- checks on demand ----
   Opening the module or a tab searches nothing: it shows the last results (this session's, or the ones kept from the
   last check, with their age) or invites to check. Searching is the user's: Check for updates (header and empty states),
   Check now (Windows), Check (development tools). Settings > General > "Analyze automatically when opening a module"
   brings back the searches on opening. The light check at start-up (winget only, for Home's counts) stays. */
const CK = k => 'sh.upd.cache.' + k;
function cachePut(k, d) {
  const put = v => localStorage.setItem(CK(k), JSON.stringify({ v: 1, lang: SH.i18n && SH.i18n.lang, t: Date.now(), d: v }));
  try { put(d); } catch { try { put(JSON.parse(JSON.stringify(d, (key, v) => key === 'icon' ? undefined : v))); } catch {} }   /* full storage: without the icons */
}
function cacheGet(k) { try { const c = JSON.parse(localStorage.getItem(CK(k)) || 'null'); return c && c.v === 1 && c.d && c.lang === (SH.i18n && SH.i18n.lang) ? c : null; } catch { return null; } }
let hydrated = false;
function hydrate() {
  if (hydrated) return; hydrated = true;
  const a = !S.scanned && !S.appsScanning && cacheGet('apps'), w = !S.winScanned && !S.winScanning && cacheGet('win'), d = !S.devScanned && !S.devScanning && cacheGet('dev');
  if (a) { S.apps = a.d; S.noWinget = false; S.scanned = true; S.fromCache.apps = a.t; }
  if (w) { S.win = w.d; S.winScanned = true; S.reboot = !!w.d.reboot; S.paused = w.d.pause ? Date.parse(w.d.pause) : null; S.fromCache.win = w.t; }
  if (d) { S.dev = d.d; S.devScanned = true; S.fromCache.dev = d.t; }
  if (a || w) setItems();
}
/* what opening the module or a tab used to search by itself, now only with the automatic setting */
function autoScan(...kinds) {
  if (!SH.autoAnalyze()) return;
  if (kinds.includes('apps')) scanApps(); if (kinds.includes('win')) scanWindows(); if (kinds.includes('dev')) scanDev();
}
/* the development tools' own Check (their tab has no other way to search them) */
function checkDev() { if (S.devScanning) return; SH.sound('scan_start'); scanDev(true, 'user').then(() => { if (!S.errs.dev) SH.sound('scan_complete'); }); paintNotChecked(); }
const CHECK_BTN = () => ({ label: t('Check for updates'), click: '#v-updater [data-check]', icon: 'refresh', pri: true, big: true });
const ovSkel = () => CAT_ORDER.map((c, k) => `<div class="pan u-group" data-asm><div class="u-gh"><span class="sk" style="width:32px;height:32px;border-radius:var(--r-s)"></span><span class="sk" style="width:${120 + k * 18}px;height:12px"></span></div>${[0, 1].map(i => `<div class="sk-row" style="border:0;padding:8px 4px"><div class="sk a" style="--dl:${i * .1}s"></div><div class="sk b" style="--w:46%"></div><div class="sk c"></div></div>`).join('')}</div>`).join('');
const skRows3 = () => `<div class="sk-rows">${[0, 1, 2].map(() => '<div class="sk-row"><div class="sk a"></div><div class="sk b" style="--w:50%"></div></div>').join('')}</div>`;
/* every place that waits for a check: a skeleton while it runs, an invitation before it ever ran, and above the overview
   the age of results kept from an earlier session */
function paintNotChecked() {
  const v = $(`#v-${ID}`); if (!v) return;
  const tab = id => $(`.tab[data-tab="${id}"]`, v);
  const set = (box, html) => { if (box && box.dataset.nc !== html) { box.dataset.nc = html; box.innerHTML = html; } };
  const ov = tab('overview');
  if (ov && $('.u-groups', ov)) {
    if (!S.scanned) {
      set($('.u-groups', ov), S.appsScanning ? ovSkel() : SH.emptyState({ art: 'first', title: t('Not checked yet'), text: t('Check for updates looks for new versions of your apps (winget), the Microsoft Store and Windows Update. Nothing is installed until you choose.'), action: CHECK_BTN(), cls: 'pan u-idle' }));
      const cnt = $('.u-cnt', ov); if (cnt && !S.appsScanning) { SH.rollNumber(cnt, '—'); cnt.dataset.nc = '1'; }
      const sub = $('.u-sub', ov); if (sub && !S.appsScanning && !S.winScanning) sub.textContent = t('Not checked yet.');
    } else delete $('.u-groups', ov).dataset.nc;
    const last = $('.u-last', ov);
    if (last) { const when = S.fromCache.apps; last.innerHTML = when && !S.appsScanning ? SH.lastRun({ when, title: t('Last check: {when}'), text: t('These results are from then. Check again to see what is new.'), action: { label: t('Check for updates'), data: 'data-upd-check', icon: 'refresh' } }) : ''; last.hidden = !last.innerHTML; }
  }
  const ap = tab('apps');
  if (ap && $('.u-applist', ap) && !S.scanned) {
    set($('.u-applist', ap), S.appsScanning ? skRows3() : SH.emptyState({ art: 'first', title: t('Not checked yet'), text: t('Check for updates to see which of your apps have a new version.'), action: CHECK_BTN() }));
    set($('.u-unk', ap), S.appsScanning ? skRows3() : `<div class="faint u-none">${t('Not checked yet.')}</div>`);
  }
  const st = tab('store');
  if (st && $('.u-storelist', st) && !S.scanned) {
    set($('.u-storelist', st), S.appsScanning ? skRows3() : SH.emptyState({ art: 'first', title: t('Not checked yet'), text: t('Check for updates to see which Store apps have a new version.'), action: CHECK_BTN() }));
    set($('.u-sok', st), S.appsScanning ? skRows3() : `<div class="faint u-none">${t('Not checked yet.')}</div>`);
  }
  const rt = tab('runtimes'); if (rt && rt.dataset.ready && !S.scanned) fillRuntimes(rt);
  const wi = tab('windows');
  if (wi && $('.u-wl', wi) && !S.winScanned) {
    const sk = '<div class="sk-row" style="border:0;padding:8px 4px"><div class="sk a"></div><div class="sk b" style="--w:52%"></div><div class="sk c"></div></div>';
    $$('.u-wl', wi).forEach(b => set(b, S.winScanning ? sk : `<div class="faint u-none">${t('Not checked yet.')}</div>`));
    set($('.u-hist', wi), S.winScanning ? sk : `<div class="faint u-none">${t('Not checked yet.')}</div>`);
    const wb = $('.u-wbuild', wi); if (wb && !S.winScanning) wb.textContent = t('Not checked yet. Check now searches Windows Update; it takes a minute or two.');
    const wc = $('[data-wcheck]', wi); if (wc) wc.classList.toggle('pri', !S.winScanning); if (wc) wc.classList.toggle('sec', !!S.winScanning);
  }
  const dv = tab('dev');
  if (dv && dv.dataset.ready && !S.devScanned) {
    const box = $('.u-dev', dv);
    set(box, S.devScanning ? [0, 1, 2].map(() => '<div class="pan u-dcol"><div class="sk" style="height:16px;width:50%"></div><div class="sk" style="height:10px;width:70%;margin-top:12px"></div><div class="sk" style="height:10px;width:60%;margin-top:8px"></div></div>').join('')
      : SH.emptyState({ art: 'first', title: t('Not checked yet'), text: t('Check now looks for new versions of Python and its packages, Node.js and npm packages, Git and WSL. Nothing is installed until you choose.'), action: { label: t('Check now'), data: 'data-devcheck', icon: 'refresh', pri: true, big: true }, cls: 'pan u-idle' }));
  }
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('#v-updater [data-upd-check], #v-updater [data-devcheck]'); if (!b || b.disabled) return;
  if (b.matches('[data-devcheck]')) { checkDev(); return; }
  const h = $('#v-updater [data-check]'); if (h) h.click();
});
const pending = () => S.items.filter(i => !i.done && !S.ignored.has(i.id) && !S.pinned.has(i.id));
const pendingIn = cat => pending().filter(i => i.cat === cat && !i.optional);
/* display name: no version tacked on the end (it is shown next to it anyway), and a readable name for package ids */
function dn(name) {
  const n = String(name == null ? '' : name).trim(); let m;
  if ((m = n.match(/^([A-Z][A-Za-z]+)\.(\d+(?:\.\d+)*)$/)) && /[a-z][A-Z]/.test(m[1])) return m[1].replace(/([a-z])([A-Z])/g, '$1 $2') + ' ' + m[2];
  return n.replace(/\s+[-–]\s+v?\d+(?:\.\d+){1,}\S*(?=\s*(?:\(|$))/, '').trim() || n;
}
const cv = v => String(v == null ? '' : v).replace(/^\s*[<>~=]+\s*/, '');   /* winget writes "> 1.8.10" when it cannot be sure */
const mb = v => v == null || isNaN(v) ? '—' : v >= 1024 ? fmt1(v / 1024) + ' GB' : (v < 10 ? fmt1(v) : Math.round(v)) + ' MB';
const CAT_COL = { security: 'var(--warn)', windows: 'var(--accent2)', store: 'var(--accent2)', runtimes: 'var(--accent)', dev: 'var(--ok)', apps: 'var(--accent2)' };
const PAL = ['#6FA8FF', '#8EA2FF', '#7FE0B4', '#FFB27A', '#F4C26B', '#A8D672', '#FF8FB1', '#5FD3C6', '#C9D4E8'];
const colorFor = s => PAL[[...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % PAL.length];
const initial = s => (String(s).replace(/^[^A-Za-z0-9]+/, '')[0] || '?').toUpperCase();
function tile(it) {
  if (it.icon) return `<span class="u-tile img"><img src="${it.icon}" alt="" loading="lazy" decoding="async"></span>`;
  if (it.cat === 'apps' || it.cat === 'store' || it.color) { const c = it.color || colorFor(it.name); return `<span class="u-tile" style="--c:${c}">${esc(initial(it.name))}</span>`; }
  return `<span class="u-tile" style="--c:${CAT_COL[it.cat] || 'var(--accent2)'}">${ic((CATS[it.cat] || CATS.apps).ic)}</span>`;
}
const smallTile = (o, fallbackIc = 'package', col = 'var(--mute)') => o.icon ? `<span class="u-tile img sm"><img src="${o.icon}" alt="" loading="lazy" decoding="async"></span>` : `<span class="u-tile sm" style="--c:${o.name ? colorFor(o.name) : col}">${o.name ? esc(initial(o.name)) : ic(fallbackIc)}</span>`;
/* "Unknown": winget can't read the installed version, so updating reinstalls the latest one (not in Update all) */
const vers = it => it.unknownVersion
  ? `<span class="u-ver" title="${esc(t("winget can't read the installed version: updating reinstalls the latest one"))}"><span class="u-unk">${t('Unknown')}</span>${ic('arrow')}<b>${esc(cv(it.to))}</b></span>`
  : it.from ? `<span class="u-ver"><span>${esc(cv(it.from))}</span>${ic('arrow')}<b>${esc(cv(it.to))}</b></span>` : `<span class="u-ver"><b>${esc(cv(it.to))}</b></span>`;
const ago = ts => { if (!ts) return t('not yet'); const s = (Date.now() - ts) / 1000; if (s < 60) return t('a moment ago'); if (s < 3600) return t('{n} min ago', { n: Math.round(s / 60) }); if (s < 86400) return t('{n} h ago', { n: Math.round(s / 3600) }); const d = Math.round(s / 86400); return d === 1 ? t('1 day ago') : t('{n} days ago', { n: d }); };
const fdate = d => { const ms = Date.parse(d); return isNaN(ms) ? esc(d) : new Date(ms).toLocaleDateString(SH.i18n.locale, { day: 'numeric', month: 'short', year: 'numeric' }); };
let ctxRef = null;
function ignoredMap() { return { ...(state.settings.updIgnored || {}) }; }
function setItems() {
  const items = [...((S.apps && S.apps.items) || []), ...((S.win && S.win.updates) || [])];
  /* Defender signatures: only if Defender is the active antivirus */
  const d = S.win && S.win.defender;
  if (REAL && d && d.on) items.unshift({ id: 'defender', kind: 'defender', cat: 'security', name: t('Microsoft Defender signatures'), pub: 'Microsoft', from: d.sig || '', to: 'latest', mb: null, admin: false, reboot: false, notes: d.sigDate ? [t('Last updated on {date}.', { date: fdate(d.sigDate) })] : [] });
  const old = S.byId; const vroot = document.getElementById('v-updater'); if (vroot) vroot.classList.toggle('u-nosz', !items.some(i => i.mb != null));
  S.items = items.map(i => (old[i.id] && old[i.id].done) ? { ...i, done: true } : i);
  S.byId = Object.fromEntries(S.items.map(i => [i.id, i]));
  const ig = ignoredMap(); S.ignored = new Set(S.items.filter(i => ig[i.id] && ig[i.id] === i.to).map(i => i.id));
  S.pinned = new Set(REAL ? Object.keys((S.apps && S.apps.pins) || {}) : [...S.pinned]);
}
function publishPending() {
  const n = pending().filter(i => !i.optional).length;
  if (ctxRef) ctxRef.setBadge('overview', n);
  /* results from an earlier session's cache are not a new check: Home keeps the date of the last real one */
  if (S.scanned && !S.fromCache.apps && !S.appsScanning && !S.errs.apps && !S.noWinget) SH.setPending('apps', n);
}
function refreshBadge() { publishPending(); }

/* ---------------- searches (real inside the app) ---------------- */
let pA = null, pW = null, pD = null;
/* Each search is followed from anywhere (SH.activity, its own key): one the user asked for ('user') at once, one that
   started by itself (opening the module or a tab) once it has run for a moment (bg). Inside the user's Check
   (S.checkAct) they add nothing; the light check at start-up and the refresh after installing stay silent ('quiet').
   A search already running is reused: the user asking for it makes it theirs, opening the module follows a quiet one. */
const SCAN_ACT = { apps: [() => t('Looking for updates…'), 'overview'], win: [() => t('Searching Windows Update…'), 'windows'], dev: [() => t('Checking development tools…'), 'dev'] };
function scanAct(kind, how) {
  if (how === 'quiet' || S.checkAct) return;
  const cur = S.acts[kind]; if (cur && cur.open && how !== 'user') return;
  const [label, tab] = SCAN_ACT[kind];
  S.acts[kind] = SH.activity.start(ID, { key: 'scan:' + kind, label: label(), go: { tab }, bg: how !== 'user' });
}
/* true: it ended while the user was elsewhere and the toast with View already said how it went */
function scanEnd(kind, r) {
  const a = S.acts[kind]; delete S.acts[kind]; if (!a) return false;
  return a.end(S.checkAct ? { ...r, quiet: true } : r);
}
function winSummary() {
  const n = ((S.win && S.win.updates) || []).filter(u => !u.optional).length;
  return n === 0 ? t('No Windows updates found.') : n === 1 ? t('1 Windows update found.') : t('{n} Windows updates found.', { n });
}
/* sample mode: the searches take a moment and report progress, as the real ones do (Windows Update the longest) */
function mockScan(kind, ms, data) {
  const t0 = performance.now(), text = SCAN_ACT[kind][0]();
  return new Promise(res => { const iv = setInterval(() => { const k = (performance.now() - t0) / ms; if (k >= 1) { clearInterval(iv); res(data()); } else scanProgress(kind, { kind: 'progress', pct: .1 + k * .8, text }); }, 250); });
}
function scanProgress(kind, m) {
  S.prog[kind] = m; if (S.checkAct && m && m.text) S.checkAct.progress(null, m.text);
  const a = S.acts[kind]; if (a && m) a.progress(typeof m.pct === 'number' && m.pct > 0 ? m.pct : null, m.text || null); const el = $(`#v-${ID} .u-sub`); if (el && (kind === 'apps' ? S.appsScanning : !S.scanned)) el.textContent = m.text || t('Searching…'); updateWinWait(); }
/* while the apps search runs again, the lists keep the previous results but look dimmed */
function setAppsScanning(on) {
  S.appsScanning = on; const v = $(`#v-${ID}`); if (v) v.classList.toggle('u-rescan', on && S.scanned);
  if (on && S.scanned) { const el = $(`#v-${ID} .u-sub`); if (el) el.textContent = t('Looking for updates…'); }
}
/* how: undefined (started by itself: opening the module or a tab), 'user' or 'quiet' (see scanAct) */
function scanApps(force, how) {
  if (pA && (!force || S.appsScanning)) { if (S.appsScanning) scanAct('apps', how); return pA; }  // a search already running is reused, never doubled
  setAppsScanning(true); scanAct('apps', how); paintNotChecked();
  pA = (REAL ? SH.job(ID, 'scan_apps', [], { onProgress: m => scanProgress('apps', m) }) : mockScan('apps', 900, MOCK.apps))
    .then(r => { r = r || { items: [] }; S.noWinget = r.winget === false; S.errs.apps = r.failed ? 'offline' : null; S.apps = S.noWinget ? { items: [] } : r; S.scanned = true; S.fromCache.apps = 0; if (!S.noWinget && !S.errs.apps) cachePut('apps', r); setAppsScanning(false); setItems();
      const err = S.noWinget ? t("winget isn't available on this PC.") : S.errs.apps ? ERR_MSG.apps(S.errs.apps) : '';
      scanEnd('apps', err ? { ok: false, error: err } : { ok: true, summary: t('{n} pending updates.', { n: pending().filter(i => !i.optional).length }) });
      onData('apps'); return r; })
    .catch(e => { S.errs.apps = e.message; S.scanned = true; setAppsScanning(false); S.apps = S.apps || { items: [] }; setItems(); scanEnd('apps', e.cancelled ? { cancelled: true } : { ok: false, error: ERR_MSG.apps(e.message) }); onData('apps'); });
  return pA;
}
function scanWindows(force, how) {
  if (pW && (!force || S.winScanning)) { if (S.winScanning) scanAct('win', how); return pW; }
  S.winScanning = true; S.winTold = false; scanAct('win', how); updateWinWait(); paintNotChecked();
  pW = (REAL ? SH.job(ID, 'scan_windows', [], { onProgress: m => scanProgress('win', m) }) : mockScan('win', 4500, MOCK.win))
    .then(r => { S.errs.win = null; S.win = r; S.winScanned = true; S.winScanning = false; S.reboot = !!r.reboot; S.paused = r.pause ? Date.parse(r.pause) : null; S.fromCache.win = 0; cachePut('win', r); setItems();
      S.winTold = scanEnd('win', { ok: true, summary: winSummary() }); onData('win'); return r; })
    .catch(e => { S.errs.win = e.message; S.winScanning = false; S.winScanned = true; S.winTold = scanEnd('win', e.cancelled ? { cancelled: true } : { ok: false, error: ERR_MSG.win(e.message) }); onData('win'); });
  return pW;
}
function scanDev(force, how) {
  if (pD && (!force || S.devScanning)) { if (S.devScanning) scanAct('dev', how); return pD; }
  S.devScanning = true; scanAct('dev', how); paintNotChecked();
  pD = (REAL ? SH.job(ID, 'scan_dev', [], { onProgress: m => scanProgress('dev', m) }) : mockScan('dev', 700, MOCK.dev))
    .then(r => { S.errs.dev = null; S.dev = r; S.devScanned = true; S.devScanning = false; S.fromCache.dev = 0; cachePut('dev', r); scanEnd('dev', { ok: true }); onData('dev'); return r; })
    .catch(e => { S.errs.dev = e.message; S.devScanned = true; S.devScanning = false; scanEnd('dev', e.cancelled ? { cancelled: true } : { ok: false, error: e.message }); onData('dev'); });
  return pD;
}
function onData(kind) {
  rerenderAll(); publishPending(); updateWinWait(); paintNotChecked();
  const v = $(`#v-${ID}`); if (!v) return;
  if (kind === 'win') { const w = $('.tab[data-tab="windows"]', v); if (w && w.dataset.ready) fillWindows(w); }
  if (kind !== 'dev') { const st = $('.tab[data-tab="store"]', v); if (st && st.dataset.ready) fillStore(st); const rt = $('.tab[data-tab="runtimes"]', v); if (rt && rt.dataset.ready) fillRuntimes(rt); }
  if (kind !== 'win') { const d = $('.tab[data-tab="dev"]', v); if (d && d.dataset.ready) fillDev(d); }
  const s = $('.tab[data-tab="schedule"]', v); if (s && s.dataset.ready) renderNext(s, false);
}
function updateWinWait() {
  const p = S.prog.win;
  $$(`#v-${ID} .u-wwait`).forEach(g => {
    g.querySelector('span').textContent = S.winScanning ? (p && p.text) || t('Searching Windows Update…') : '';
    const bar = g.querySelector('.bar>span'); if (bar) bar.style.transform = `scaleX(${(p && p.pct) || .05})`;
    g.classList.toggle('on', !!S.winScanning);
  });
  $$(`#v-${ID} [data-wcheck]`).forEach(b => { b.disabled = !!S.winScanning; b.classList.toggle('u-busy', !!S.winScanning); });
}
/* a row's action area while winget pins or unpins it: spinner + text, nothing clickable; returns the undo */
function rowBusy(id, label) {
  const saved = [];
  $$(`#v-${ID} .u-row[data-item="${CSS.escape(id)}"] .u-act`).forEach(a => { saved.push([a, a.innerHTML]); a.innerHTML = `<button class="btn sm sec" disabled><span class="u-spin"></span>${esc(label)}</button>`; });
  return () => saved.forEach(([a, h]) => { if (a.isConnected) a.innerHTML = h; });
}

/* ---------------- install queue ---------------- */
const Q = { list: [], running: false, paused: false, timer: 0, total: new Spring(0, 80, 17) };
function enqueue(ids) {
  let added = 0;
  ids.forEach(id => { const it = typeof id === 'object' ? id : S.byId[id]; if (!it || it.done || Q.list.some(q => q.it === it && ['queued', 'down', 'inst'].includes(q.st))) return;
    Q.list.push({ it, st: 'queued', p: 0, ph: 0, sp: new Spring(0, 140, 20) }); added++; });
  if (added) { renderQueue(true); startQueue(); }
  return added;
}
function startQueue() {
  if (Q.running) { if (REAL && !Q.paused) runQueueReal(); return; }  /* resumed or retried while some still run */
  Q.askedAdmin = false; Q.running = true; Q.paused = false; Q.stop = false;
  Q.act = SH.activity.start(ID, { key: 'queue', label: t('Installing updates'), go: { tab: 'overview' } }); queueAct();
  if (REAL) runQueueReal(); else { clearInterval(Q.timer); Q.timer = setInterval(stepQueue, 60); }
  renderQueueHead();
}
/* --- real: one engine job per item (pause = don't start the next one; cancel = stop the download) --- */
function payload(it) {
  if (it.kind === 'winget') return { kind: 'winget', wid: it.wid, source: it.source, name: it.name };
  if (it.kind === 'wu') return { kind: 'wu', uid: it.uid, name: it.name };
  if (it.kind === 'defender') return { kind: 'defender', name: it.name };
  return { kind: it.kind, pkgs: it.pkgs, name: it.name };
}
/* winget updates run up to PAR at once, each its own engine job: a download no longer waits for the installer before
   it. Windows Update, Defender, pip and npm run alone, as before (Windows installs one thing at a time). */
const PAR = 3;
const busyQ = () => Q.list.filter(q => q.st === 'down' || q.st === 'inst');
const qWait = () => new Promise(r => (Q.waiters || (Q.waiters = [])).push(r));
const qWake = () => { const w = Q.waiters || []; Q.waiters = []; w.forEach(f => f()); };
function runQueueReal() {
  Q.workers = Q.workers || 0;
  while (Q.workers < PAR) { Q.workers++; queueWorker().catch(e => console.error(e)).finally(queueWorkerDone); }
}
function queueWorkerDone() {
  if (--Q.workers > 0) return;
  Q.running = false; renderQueueHead(); finishedToast(); publishPending();
  if (Q.list.some(q => q.st === 'done' && q.it.kind === 'winget')) setTimeout(() => scanApps(true, 'quiet'), 1500);
  if (Q.list.some(q => q.st === 'done' && (q.it.kind === 'pip' || q.it.kind === 'npm')) && S.devScanned) setTimeout(() => scanDev(true, 'quiet'), 1500);
}
async function queueWorker() {
  for (;;) {
    if (Q.paused || Q.stop) return;
    const cur = Q.list.find(q => q.st === 'queued'); if (!cur) return;
    const it = cur.it, busy = busyQ();
    if (busy.length && (it.kind !== 'winget' || busy.some(q => q.it.kind !== 'winget'))) { await qWait(); continue; }
    if (it.admin && !state.admin) { cur.st = 'admin'; if (!Q.askedAdmin) { Q.askedAdmin = true; SH.requireAdmin(t('to install Windows updates.')); } updQRow(cur); continue; }
    cur.st = 'down'; cur.p = 0; updQRow(cur); scrollQ(cur);
    const job = SH.job(ID, 'install', [[payload(it)]], { sound: 'task', onProgress: m => {
      const s = m.data && m.data.items && m.data.items[0]; if (!s) return;
      const st = s.st === 'queued' ? 'down' : s.st; if (s.mb) cur.mb = s.mb; cur.p = s.p || 0;
      if (st !== cur.st && ['down', 'inst'].includes(st)) { cur.st = st; updQRow(cur); } else updQRow(cur, true);
    }, onLog: lines => { const l = lines.filter(x => x && !/^[\s\-\\|/█▒]+$/.test(x)).pop(); if (l) cur.last = l; } });
    cur.job = job;
    try {
      const res = await job; const s = (res && res.items && res.items[0]) || { st: 'fail', msg: t('No answer from the engine') };
      cur.st = s.st === 'queued' ? 'fail' : s.st; cur.msg = s.msg; if (res && res.reboot) S.reboot = true;
    } catch (e) { cur.st = e.cancelled ? 'cancel' : 'fail'; cur.msg = e.message; }
    if (cur.cancelAfter && cur.st !== 'done') cur.st = 'cancel';
    if (cur.st === 'done') { it.done = true; onItemDone(it); SH.logActivity(t('{name} updated', { name: dn(it.name) }), { sub: it.to && it.kind !== 'wu' ? t('to version {v}', { v: it.to }) : (it.kb || ''), ic: 'updater', go: ID, tab: 'apps' }); }
    /* a failed update stays in the history too, with the reason: nobody should believe it was installed */
    else if (cur.st === 'fail') SH.logActivity(t('{name} could not be updated', { name: dn(it.name) }), { sub: String(cur.msg || t('Something went wrong.')).slice(0, 120), ic: 'alert', go: ID, tab: 'apps' });
    updQRow(cur);
    qWake();
    if (cur.cancelAfter) { Q.stop = true; Q.list.forEach(q => { if (q.st === 'queued') { q.st = 'cancel'; updQRow(q); } }); qWake(); return; }
  }
}
/* --- sample: simulation --- */
function stepQueue() {
  if (Q.paused) return;
  let cur = Q.list.find(q => q.st === 'down' || q.st === 'inst');
  if (!cur) {
    cur = Q.list.find(q => q.st === 'queued');
    if (!cur) { Q.running = false; clearInterval(Q.timer); renderQueueHead(); finishedToast(); return; }
    if (cur.it.admin && !state.admin) { cur.st = 'admin'; if (!Q.askedAdmin) { Q.askedAdmin = true; SH.requireAdmin(t('to install Windows updates and system components.')); } updQRow(cur); return; }
    cur.st = 'down'; cur.ph = 0; updQRow(cur); scrollQ(cur);
  }
  const it = cur.it, w = it.mb || 40;
  if (cur.st === 'down') { cur.p = Math.min(1, cur.p + .06 / Math.max(.7, Math.min(3.2, w / 70))); if (cur.p >= 1) { cur.st = 'inst'; cur.ph = 0; updQRow(cur); } }
  else { cur.ph += .06 / Math.max(.6, Math.min(2, w / 160)); if (cur.ph >= 1) { cur.st = 'done'; it.done = true; if (it.reboot) S.reboot = true; onItemDone(it); updQRow(cur); } }
  updQRow(cur, true);
}
function finishedToast() {
  /* this run only: what an earlier run already reported (still listed in the queue) is not counted again */
  const fresh = Q.list.filter(q => !q.told);
  const done = fresh.filter(q => q.st === 'done').length, fail = fresh.filter(q => q.st === 'fail').length, adm = fresh.filter(q => q.st === 'admin').length;
  fresh.forEach(q => { if (['done', 'fail', 'admin', 'cancel'].includes(q.st)) q.told = true; });
  const act = Q.act; Q.act = null;
  if (!done && !fail && !adm) { if (act) act.end({ cancelled: true }); return; }
  const msg = [done === 1 ? t('{n} update installed.', { n: done }) : t('{n} updates installed.', { n: done })];
  if (fail) msg.push(t('{n} failed.', { n: fail })); if (adm) msg.push(t('{n} waiting for admin mode.', { n: adm }));
  const kind = fail && !done ? 'error' : fail || adm ? 'warning' : 'success';
  if (act && act.end({ ok: !(fail && !done), summary: msg.join(' '), error: fail && !done ? msg.join(' ') : '', kind })) return;
  SH.toast(msg.join(' '), S.reboot ? { kind, action: { label: t('Restart now'), run: () => SH.toast(t('Save your work and restart from the Start menu when you can.')) }, group: 'upd-done' } : { kind, group: 'upd-done' });
}
function onItemDone(it) {
  S.sel.delete(it.id);
  $$(`#v-${ID} [data-item="${CSS.escape(it.id)}"]`).forEach(row => markDone(row));
  refreshBadge(); updateOverviewCounts(); updateSelBars();
}
function markDone(row) {
  if (row.classList.contains('is-done')) return; row.classList.add('is-done');
  const act = $('.u-act', row); if (act) { act.innerHTML = `<span class="chip ok">${ic('check')}${t('Updated')}</span>`; anim(act.firstElementChild, [{ opacity: 0, transform: 'scale(.7)' }, { opacity: 1, transform: 'scale(1)' }], { d: 380, e: EASE.spring }); }
  const ck = $('.check', row); if (ck) ck.classList.remove('on');
}
const QST = { queued: t('Queued'), down: t('Downloading'), inst: t('Installing'), done: t('Installed'), fail: t('Error'), cancel: t('Cancelled'), admin: t('Needs admin mode') };
function qRowHTML(q, i) {
  return `<div class="u-qrow st-${q.st}" data-q="${i}">${tile(q.it)}<div class="u-qt"><b>${esc(dn(q.it.name))}</b><span class="u-qs">${qStateText(q)}</span>
    <div class="u-qbar"><span></span></div></div><span class="u-qi">${qIcon(q)}</span></div>`;
}
function qStateText(q) {
  const tot = q.mb || q.it.mb;
  if (q.st === 'down') return tot ? t('Downloading, {got} of {total}', { got: mb(tot * q.p), total: mb(tot) }) : q.p ? t('Downloading, {pct}%', { pct: Math.round(q.p * 100) }) : t('Downloading…');
  if (q.st === 'inst') return q.cancelAfter ? t('Installing; will stop when it finishes') : t('Installing…');
  if (q.st === 'fail') return esc(q.msg || t('Error'));
  return QST[q.st];
}
function qIcon(q) {
  if (q.st === 'done') return `<svg class="i u-okmark" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`;
  if (q.st === 'fail') return `<button class="btn sm sec" data-retry="${Q.list.indexOf(q)}">${t('Retry')}</button>`;
  if (q.st === 'admin') return `<button class="btn sm sec" data-admin>${t('Turn on')}</button>`;
  if (q.st === 'down' || q.st === 'inst') return '<span class="u-spin"></span>';
  return '';
}
/* the queue's activity: the overall progress and what it is doing now */
function queueAct() {
  if (!Q.act || !Q.act.open) return;
  const live = Q.list.filter(q => q.st !== 'cancel'), cur = Q.list.find(q => q.st === 'down' || q.st === 'inst');
  Q.act.progress(qProgress(), cur ? `${dn(cur.it.name)} · ${t('{done} of {total} done', { done: live.filter(q => q.st === 'done').length, total: live.length })}` : null);
}
function updQRow(q, light) {
  queueAct();
  const row = $(`#v-${ID} .u-qrow[data-q="${Q.list.indexOf(q)}"]`); if (!row) return;
  const s = $('.u-qs', row), txt = qStateText(q); if (s.innerHTML !== txt) s.innerHTML = txt;
  Q.dirty = true;
  if (light) return;
  row.className = `u-qrow st-${q.st}`; $('.u-qi', row).innerHTML = qIcon(q);
  if (q.st === 'done') { const m = $('.u-okmark', row); if (m) anim(m, [{ strokeDashoffset: 24 }, { strokeDashoffset: 0 }], { d: 420 }); }
  renderQueueHead();
}
function scrollQ(q) { const row = $(`#v-${ID} .u-qrow[data-q="${Q.list.indexOf(q)}"]`); if (row && row.offsetParent) row.scrollIntoView({ block: 'nearest', behavior: SH.effInt() === 'min' ? 'auto' : 'smooth' }); }
function qProgress() {
  const live = Q.list.filter(q => q.st !== 'cancel'); if (!live.length) return 0;
  const w = q => q.mb || q.it.mb || 50; const tot = live.reduce((a, q) => a + w(q), 0) || 1;
  const got = live.reduce((a, q) => a + (q.st === 'done' ? w(q) : q.st === 'down' ? w(q) * q.p * .8 : q.st === 'inst' ? w(q) * (.8 + .2 * Math.min(1, REAL ? .5 : q.ph)) : 0), 0);
  return got / tot;
}
function renderQueueHead() {
  const box = $(`#v-${ID} .u-queue`); if (!box) return;
  const live = Q.list.filter(q => q.st !== 'cancel'); const done = live.filter(q => q.st === 'done').length;
  $('.u-qnum', box).textContent = live.length ? t('{done} of {total} done', { done, total: live.length }) : t('Nothing queued');
  const ctl = $('.u-qctl', box);
  const want = Q.running ? (Q.paused ? 'paused' : 'run') : (Q.list.length ? 'idle' : 'empty');
  if (ctl.dataset.mode !== want) {
    ctl.dataset.mode = want;
    ctl.innerHTML = want === 'empty' ? '' : want === 'idle' ? `<button class="btn sm ghost" data-qclear>${t('Clear')}</button>${Q.list.some(q => q.st === 'queued') ? `<button class="btn sm sec" data-qresume>${ic('play')}${t('Resume')}</button>` : ''}`
      : `<button class="btn sm sec" data-qpause>${ic(Q.paused ? 'play' : 'pause')}${Q.paused ? t('Resume') : t('Pause')}</button><button class="btn sm ghost" data-qcancel>${t('Cancel')}</button>`;
    $$('button', ctl).forEach((b, i) => anim(b, [{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'scale(1)' }], { d: 300, delay: i * 40, e: EASE.spring }));
  }
  box.classList.toggle('is-paused', Q.paused);
  Q.dirty = true;
}
function recentHTML() {
  let rows = [];
  if (REAL) {
    rows = (state.settings.activity || []).filter(a => a.go === ID).slice(0, 4).map(a => { const x = SH.activityText ? SH.activityText(a) : a; return [x.t, x.sub, ago(a.at)]; });
    if (rows.length < 4 && S.win) rows = rows.concat(S.win.history.filter(h => h.ok).slice(0, 4 - rows.length).map(h => [h.t, 'Windows Update', fdate(h.d)]));
  } else rows = [['Brave', t('version {v}', { v: '1.84.132' }), t('yesterday')], ['NVIDIA App', t('version {v}', { v: '11.0.5.420' }), t('{n} days ago', { n: 4 })]];
  if (!rows.length) return '';
  return `<div class="u-qrecent"><h5>${t('Recently installed')}</h5>${rows.map(([n, v, d]) => `<div class="u-qrow st-done"><span class="u-qi"><svg class="i u-okmark" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span><div class="u-qt"><b>${esc(n)}</b><span class="u-qs">${esc(v || '')}</span></div><span class="faint u-qd">${esc(d)}</span></div>`).join('')}</div>`;
}
function renderQueue(animateNew) {
  const box = $(`#v-${ID} .u-queue`); if (!box) return;
  const list = $('.u-qlist', box);
  if (!Q.list.length) { list.innerHTML = `<div class="u-qempty"><span class="u-qei">${ic('download')}</span><b>${t('The queue is empty')}</b>${t('Check what you want to update or press Update all.')}</div>${recentHTML()}`; renderQueueHead(); return; }
  if ($('.u-qempty', list)) list.innerHTML = '';
  const known = new Set($$('.u-qrow', list).map(r => r.dataset.q));
  let n = 0;
  Q.list.forEach((q, i) => { if (known.has(String(i))) return; list.insertAdjacentHTML('beforeend', qRowHTML(q, i));
    const row = list.lastElementChild; q.bar = $('.u-qbar>span', row); if (animateNew) anim(row, [{ opacity: 0, transform: 'translate3d(16px,0,0)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 420, delay: Math.min(n++, 12) * 35, e: EASE.spring }); });
  renderQueueHead();
}
/* queue bars: only written while something moves (no per-frame work when idle) */
tickers.add(dt => {
  if (state.view !== ID || (!Q.running && !Q.dirty)) return;
  const box = $(`#v-${ID} .u-queue`); if (!box || !box.offsetParent) return;
  Q.total.t = qProgress(); Q.total.step(dt);
  let moving = !Q.total.idle;
  const pct = String(Math.round(Math.max(0, Math.min(1, Q.total.v)) * 100)); const pe = $('.u-qpct', box); if (pe.textContent !== pct) pe.textContent = pct;
  $('.u-qtot>span', box).style.transform = `scaleX(${Math.max(0, Math.min(1, Q.total.v)).toFixed(4)})`;
  Q.list.forEach(q => {
    q.sp.t = q.st === 'down' ? q.p : (q.st === 'inst' || q.st === 'done') ? 1 : 0; if (q.sp.idle && q.drawn === q.sp.t) return;
    q.sp.step(dt); moving = true; if (q.bar && q.bar.isConnected) q.bar.style.transform = `scaleX(${Math.max(0, q.sp.v).toFixed(4)})`; q.drawn = q.sp.idle ? q.sp.t : null;
  });
  if (!moving && !Q.running) Q.dirty = false;
});
function queueClicks(e) {
  if (e.target.closest('[data-qpause]')) { Q.paused = !Q.paused; if (!Q.paused && REAL) startQueue(); renderQueueHead(); SH.toast(Q.paused ? (REAL ? t('Stops after what is installing now finishes.') : t('Queue paused.')) : t('Resuming.'), { group: 'upd-q' }); return true; }
  if (e.target.closest('[data-qresume]')) { Q.paused = false; startQueue(); return true; }
  if (e.target.closest('[data-qcancel]')) {
    Q.list.forEach(q => {
      if (q.st === 'queued') { q.st = 'cancel'; updQRow(q); }
      else if (q.st === 'down' && q.job) q.job.cancel();
      else if (q.st === 'inst') { q.cancelAfter = true; updQRow(q, true); }
      else if (!REAL && ['down', 'inst'].includes(q.st)) { q.st = 'cancel'; updQRow(q); }
    });
    if (!REAL) { Q.running = false; clearInterval(Q.timer); if (Q.act) { Q.act.end({ cancelled: true }); Q.act = null; } }
    renderQueueHead(); rerenderAll(); SH.toast(REAL && Q.list.some(q => q.cancelAfter) ? t('What is installing now will finish; the rest is cancelled.') : t('Queue cancelled. What was already installed stays.'), { group: 'upd-q' }); return true;
  }
  if (e.target.closest('[data-qclear]')) { Q.list = Q.list.filter(q => ['down', 'inst'].includes(q.st)); $(`#v-${ID} .u-qlist`).innerHTML = ''; renderQueue(); return true; }
  const r = e.target.closest('[data-retry]'); if (r) { const q = Q.list[+r.dataset.retry]; q.st = 'queued'; q.p = 0; q.ph = 0; q.msg = null; q.cancelAfter = false; q.told = false; q.sp.set(0); updQRow(q); startQueue(); return true; }
  if (e.target.closest('[data-admin]')) { SH.go('admin'); return true; }
  return false;
}
/* confirm before installing several things at once (inside the app they really change the system) */
function confirmRun(ids, label, go) {
  const list = ids.map(id => S.byId[id] || id).filter(Boolean);
  if (!REAL || list.length <= 1) { go(); return; }
  const v = $(`#v-${ID}`); let d = $('.u-confirm', v); if (d) { if (d._off) d._off(); d.remove(); }
  d = document.createElement('div'); d.className = 'u-confirm';
  const adm = list.filter(i => i.admin && !state.admin).length, reb = list.some(i => i.reboot);
  d.innerHTML = `<div class="u-cbox pan" role="dialog" aria-modal="true"><h3>${esc(label)}</h3>
    <p class="muted">${t('{n} updates will be installed, one after another. Open programs may close while they install and Windows may ask for permission on some of them.', { n: list.length })}${reb ? ' ' + t('Some need a restart at the end.') : ''}${adm ? ' ' + t('{n} need admin mode.', { n: adm }) : ''}</p>
    <div class="u-clist">${list.slice(0, 8).map(i => `<div>${tile(i)}<span>${esc(i.name)}</span>${vers(i)}</div>`).join('')}${list.length > 8 ? `<div class="faint">${t('and {n} more', { n: list.length - 8 })}</div>` : ''}</div>
    <div class="u-cbtns"><button class="btn ghost" data-cno>${t('Not now')}</button><button class="btn pri" data-cyes>${ic('download')}${t('Update')}</button></div></div>`;
  v.appendChild(d);
  anim(d, [{ opacity: 0 }, { opacity: 1 }], { d: 200 }); anim($('.u-cbox', d), [{ opacity: 0, transform: 'translate3d(0,14px,0) scale(.96)' }, { opacity: 1, transform: 'none' }], { d: 420, e: EASE.spring });
  /* Esc (and the controller's B, which sends it) closes the dialog instead of going back to Home behind it; a second
     click on Update while it fades out does not run it again */
  let shut = false;
  const close = () => { if (shut) return false; shut = true; removeEventListener('keydown', key, true); anim(d, [{ opacity: 1 }, { opacity: 0 }], { d: 160 }).finished.then(() => d.remove()).catch(() => d.remove()); return true; };
  const key = e => { if (e.key === 'Escape' && d.isConnected && !shut && state.view === ID && !state.palOpen && !state.setOpen) { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
  addEventListener('keydown', key, true); d._off = () => removeEventListener('keydown', key, true);
  d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-cno]')) close(); if (e.target.closest('[data-cyes]') && close()) go(); });
}
function updateAll() { const ids = pending().filter(i => !i.optional).map(i => i.id); if (!ids.length) { SH.toast(t('Everything is up to date.')); return; } confirmRun(ids, t('Update all'), () => { goOverview(); enqueue(ids); }); }
function goOverview() { if (ctxRef) ctxRef.setTab('overview'); }

/* ---------------- shared pieces ---------------- */
function itemRow(it, o = {}) {
  const done = it.done; const queued = Q.list.some(q => q.it === it && ['queued', 'down', 'inst'].includes(q.st));
  const notes = it.notes && it.notes.length ? it.notes : null;
  return `<div class="u-row${done ? ' is-done' : ''}" data-item="${esc(it.id)}">
    ${o.check !== false ? `<button class="check${S.sel.has(it.id) ? ' on' : ''}" data-sel="${esc(it.id)}" aria-label="${t('Select {name}', { name: esc(dn(it.name)) })}">${ic('check')}</button>` : ''}
    ${tile(it)}
    <button class="u-name" data-notes="${esc(it.id)}" title="${esc(t('See the release notes'))}"><b>${esc(dn(it.name))}</b><span>${[esc(it.pub || ''), it.kb ? esc(it.kb) : '', it.reboot ? t('needs a restart') : ''].filter(Boolean).join(', ')}</span></button>
    ${vers(it)}<span class="u-size">${mb(it.mb)}</span>
    <span class="u-act">${done ? `<span class="chip ok">${ic('check')}${t('Updated')}</span>` : queued ? `<button class="btn sm sec" disabled><span class="u-spin"></span>${t('Queued')}</button>` : `<button class="btn sm sec" data-one="${esc(it.id)}">${t('Update')}</button>`}${!done && o.menu !== false && it.kind !== 'wu' ? `<button class="iconbtn u-more" data-menu="${esc(it.id)}" aria-label="${esc(t('More options'))}">${ic('dots')}</button>` : ''}</span>
    <div class="u-notes"><div>${notes ? `<ul>${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : `<ul class="u-nload"><li>${REAL && it.kind === 'winget' ? t('Looking for the release notes…') : t('No release notes from the publisher.')}</li></ul>`}</div></div>
  </div>`;
}
async function toggleNotes(id, root) {
  const row = $(`.u-row[data-item="${CSS.escape(id)}"]`, root); if (!row) return;
  row.classList.toggle('open');
  if (!row.classList.contains('open')) return;
  const it = S.byId[id];
  if (REAL && it && it.kind === 'winget' && !it.notesLoaded) {
    it.notesLoaded = true;
    let r = null; try { r = await SH.engine(ID, 'notes', it.wid); } catch { r = null; }
    it.notes = (r && r.notes) || []; it.notesUrl = r && r.url;
    const ul = $('.u-notes ul', row);
    if (ul) ul.outerHTML = `<ul>${it.notes.length ? it.notes.map(n => `<li>${esc(n)}</li>`).join('') : `<li>${t("The publisher doesn't post notes on winget.")}</li>`}${it.notesUrl ? `<li class="u-nurl"><button class="btn sm ghost" data-url="${esc(it.notesUrl)}">${ic('external')}${t('See the notes on their website')}</button></li>` : ''}</ul>`;
  }
  $$('li', row).forEach((li, i) => anim(li, [{ opacity: 0, transform: 'translate3d(0,-4px,0)' }, { opacity: 1, transform: 'none' }], { d: 320, delay: 60 + i * 40 }));
}
function toggleSel(id, btn) {
  if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id);
  $$(`#v-${ID} [data-sel="${CSS.escape(id)}"]`).forEach(b => b.classList.toggle('on', S.sel.has(id)));
  if (btn) anim(btn, [{ transform: 'scale(.82)' }, { transform: 'scale(1)' }], { d: 300, e: EASE.spring });
  updateSelBars();
}
/* tri-state "select all" in each group header: none, some (dash) or all */
const live = i => i && !i.done && !S.ignored.has(i.id) && !S.pinned.has(i.id);
function groupIds(key) {
  const ids = l => l.filter(live).map(i => i.id);
  if (key.startsWith('cat:')) return pendingIn(key.slice(4)).map(i => i.id);
  if (key === 'w:security') return ids(S.items.filter(i => i.cat === 'security' && i.kind !== 'defender'));
  if (key === 'w:windows') return ids(S.items.filter(i => i.cat === 'windows' && !i.optional));
  if (key === 'w:optional') return ids(S.items.filter(i => i.optional));
  if (key === 'store') return ids(S.items.filter(i => i.cat === 'store'));
  if (key === 'apps') return $$(`#v-${ID} .u-applist .u-row [data-sel]`).map(b => b.dataset.sel).filter(id => live(S.byId[id]));
  return [];
}
const groupCheck = (key, name) => `<button class="check u-gall" role="checkbox" aria-checked="false" data-gall="${key}" aria-label="${esc(t('Select all: {group}', { group: name }))}" title="${esc(t('Select all'))}">${ic('check')}</button>`;
function setTri(b, n, total) {
  const st = !total || !n ? 'false' : n === total ? 'true' : 'mixed';
  b.classList.toggle('on', st === 'true'); b.classList.toggle('some', st === 'mixed'); b.setAttribute('aria-checked', st); b.disabled = !total;
}
function syncGroupChecks() { $$(`#v-${ID} [data-gall]`).forEach(b => { const ids = groupIds(b.dataset.gall); setTri(b, ids.filter(id => S.sel.has(id)).length, ids.length); }); }
function toggleGroup(b) {
  const ids = groupIds(b.dataset.gall); if (!ids.length) return;
  const all = ids.every(id => S.sel.has(id));
  ids.forEach(id => { if (all) S.sel.delete(id); else S.sel.add(id); });
  $$(`#v-${ID} [data-sel]`).forEach(x => x.classList.toggle('on', S.sel.has(x.dataset.sel)));
  anim(b, [{ transform: 'scale(.82)' }, { transform: 'scale(1)' }], { d: 300, e: EASE.spring });
  updateSelBars();
}
function updateSelBars() {
  syncGroupChecks();
  $$(`#v-${ID} .u-selbar`).forEach(bar => {
    const n = S.sel.size; const show = n > 0; const was = bar.classList.contains('on');
    $('b', bar).textContent = t('{n} selected', { n });
    if (show !== was) { bar.classList.toggle('on', show); if (show) anim(bar, [{ opacity: 0, transform: 'translate3d(0,8px,0) scale(.97)' }, { opacity: 1, transform: 'none' }], { d: 360, e: EASE.spring }); }
  });
}
const selBar = () => `<div class="u-selbar"><b>${t('{n} selected', { n: 0 })}</b><span class="sp"></span><button class="btn sm ghost" data-selclear>${t('Clear selection')}</button><button class="btn sm pri" data-selgo>${ic('download')}${t('Update selected')}</button></div>`;

/* context menu */
let menuEl = null;
function openMenu(btn, id) {
  closeMenu(); const it = S.byId[id]; const host = btn.closest('.tab');
  menuEl = document.createElement('div'); menuEl.className = 'u-menu';
  menuEl.innerHTML = `<button data-m="notes">${ic('file')}${t('Release notes')}</button><button data-m="ignore">${ic('ban')}${t('Ignore version {v}', { v: esc(it.to) })}</button>${it.kind === 'winget' || !REAL ? `<button data-m="pin">${ic('pin')}${t('Stay on {v}', { v: esc(it.from) })}</button>` : ''}`;
  host.appendChild(menuEl);
  const r = btn.getBoundingClientRect(), hr = host.getBoundingClientRect();
  menuEl.style.top = (r.bottom - hr.top + host.scrollTop + 6) + 'px'; menuEl.style.right = Math.max(4, hr.right - r.right) + 'px';
  const up = r.bottom + 6 + menuEl.offsetHeight > hr.bottom - 4;
  if (up) { menuEl.style.top = (r.top - hr.top + host.scrollTop - 6 - menuEl.offsetHeight) + 'px'; menuEl.style.transformOrigin = '90% 100%'; }
  anim(menuEl, [{ opacity: 0, transform: `translate3d(0,${up ? 6 : -6}px,0) scale(.94)` }, { opacity: 1, transform: 'none' }], { d: 260, e: EASE.spring });
  menuEl.addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; const m = b.dataset.m; closeMenu();
    if (m === 'notes') toggleNotes(id, host); else hideItem(id, m); });
  menuEl.dataset.id = id;
}
function closeMenu() { if (!menuEl) return; const m = menuEl; menuEl = null; anim(m, [{ opacity: 1 }, { opacity: 0, transform: 'scale(.96)' }], { d: 140 }).finished.then(() => m.remove()).catch(() => m.remove()); }
document.addEventListener('pointerdown', e => { if (menuEl && !e.target.closest('.u-menu') && !e.target.closest('[data-menu]')) closeMenu(); });
document.addEventListener('scroll', e => { if (menuEl && e.target.nodeType === 1 && e.target.closest && e.target.closest(`#v-${ID}`) && !e.target.closest('.u-menu')) closeMenu(); }, true);
async function hideItem(id, how) {
  const it = S.byId[id];
  if (how === 'pin' && REAL) {
    const back = rowBusy(id, t('Pinning…'));
    let r; try { r = await SH.engine(ID, 'pin', it.wid); } catch (e) { back(); SH.toast(t("winget couldn't pin the version: {error}", { error: e.message }), { kind: 'error' }); return; }
    if (S.apps) S.apps.pins = { ...(S.apps.pins || {}), [it.id]: it.from };
  }
  if (how === 'ignore') { const ig = ignoredMap(); ig[id] = it.to; SH.setSetting('updIgnored', ig); }
  (how === 'ignore' ? S.ignored : S.pinned).add(id); S.sel.delete(id); updateSelBars();
  $$(`#v-${ID} .u-row[data-item="${CSS.escape(id)}"]`).forEach(row => collapseRow(row));
  refreshBadge(); updateOverviewCounts();
  setTimeout(() => refreshAppsFilter(false), 440);
  SH.toast(how === 'ignore' ? t('{name}: version {v} is ignored.', { name: it.name, v: it.to }) : t('{name} stays on {v}.', { name: it.name, v: it.from }), { action: { label: t('Undo'), sound: 'undo', run: () => unhide(id) } });
}
async function unhide(id) {
  const it = S.byId[id];
  if (S.pinned.has(id) && REAL && it && it.wid) {
    if (unpinning.has(id)) return; unpinning.add(id);
    const back = rowBusy(id, t('Unpinning…'));
    if (!$(`#v-${ID} .u-row[data-item="${CSS.escape(id)}"]`)) SH.toast(t('Unpinning {name}…', { name: it.name }), { group: 'upd-unpin' });
    try { await SH.engine(ID, 'unpin', it.wid); } catch { /* carry on */ } finally { unpinning.delete(id); back(); }
    if (S.apps && S.apps.pins) delete S.apps.pins[id];
  }
  const ig = ignoredMap(); if (ig[id]) { delete ig[id]; SH.setSetting('updIgnored', ig); }
  S.ignored.delete(id); S.pinned.delete(id); rerenderAll();
}
const unpinning = new Set();
function collapseRow(row) {
  const h = row.offsetHeight;
  anim(row, [{ opacity: 1, transform: 'none', height: h + 'px' }, { opacity: 0, transform: 'translate3d(24px,0,0)', height: h + 'px', offset: .55 }, { opacity: 0, transform: 'translate3d(24px,0,0)', height: '0px', paddingTop: '0px', paddingBottom: '0px' }], { d: 420, e: EASE.out })
    .finished.then(() => row.remove()).catch(() => row.remove());
}
const ERR_MSG = { apps: error => error === 'offline' ? t("Couldn't check for updates (no internet?)") : t("Couldn't ask winget: {error}", { error }), win: error => t("Couldn't search Windows Update: {error}", { error }) };
const errBox = k => k === 'apps' && S.noWinget && !S.errs.apps ? `<div class="u-err">${ic('alert')}<span>${t("winget isn't available on this PC, so StellarHub can't check your apps for updates. Install or update App Installer from the Microsoft Store, then check again.")}</span><button class="btn sm sec" data-url="https://apps.microsoft.com/detail/9nblggh4nns1">${ic('external')}${t('Open the Store')}</button><button class="btn sm sec" data-rescan="apps">${ic('refresh')}${t('Retry')}</button></div>` : S.errs[k] ? `<div class="u-err">${ic('alert')}<span>${ERR_MSG[k](esc(S.errs[k]))}</span><button class="btn sm sec" data-rescan="${k}">${ic('refresh')}${t('Retry')}</button></div>` : '';

/* ---------------- Overview ---------------- */
function renderOverview(el) {
  el.classList.add('fill');
  el.innerHTML = `<div class="u-ov">
    <div class="u-ovl">
      <div class="u-hero" data-asm>
        <div><div class="big"><span class="u-cnt">0</span><small>${t('pending updates')}</small></div>
        <p class="muted u-sub">${t('Looking for updates…')}</p></div>
      </div>
      <div class="u-last" hidden></div>
      <div class="u-wwait"><span></span><div class="bar"><span></span></div></div>
      ${selBar()}
      <div class="u-errs"></div>
      <div class="u-groups"></div>
    </div>
    <aside class="pan u-queue" data-asm>
      <div class="u-qhead"><h4>${t('Install queue')}</h4><span class="u-qctl"></span></div>
      <div class="u-qsum"><div class="big"><span class="u-qpct">0</span><small>%</small></div><span class="muted u-qnum">${t('Nothing queued')}</span></div>
      <div class="bar acc u-qtot"><span></span></div>
      <div class="u-qlist"></div>
    </aside>
  </div>`;
  renderQueue(false);
  const groups = $('.u-groups', el);
  hydrate(); autoScan('apps', 'win'); updateWinWait();
  if (S.scanned) { fillGroups(el, true); updateOverviewCounts(true); }
  paintNotChecked();
}
function fillGroups(el, animate) {
  const groups = $('.u-groups', el); if (!groups) return;
  const cats = CAT_ORDER.filter(c => S.items.some(i => i.cat === c && !i.optional));
  groups.innerHTML = cats.length ? cats.map(c => groupHTML(c)).join('') : (S.scanned && !S.winScanning && !S.errs.apps && !S.noWinget && !S.errs.win ? `<div class="pan u-allok"><span class="u-qei">${ic('check')}</span><b>${t('Everything is up to date')}</b><span class="muted">${t('winget, the Store and Windows Update have nothing new for this PC.')}</span></div>` : '');
  const errs = $('.u-errs', el); if (errs) errs.innerHTML = errBox('apps') + errBox('win');
  if (animate) SH.assemble(groups, 0, 45, '.u-group, .u-allok');
  syncGroupChecks();
}
function groupHTML(c) {
  const all = S.items.filter(i => i.cat === c && !i.optional && !S.ignored.has(i.id) && !S.pinned.has(i.id));
  const pend = all.filter(i => !i.done);
  const show = all.slice(0, c === 'apps' ? 6 : 4);
  return `<div class="pan u-group${c === 'security' ? ' is-sec' : ''}" data-cat="${c}">
    <div class="u-gh">${groupCheck('cat:' + c, CATS[c].n)}<span class="u-gi">${ic(CATS[c].ic)}</span><b>${CATS[c].n}</b><span class="chip u-gc${c === 'security' && pend.length ? ' warn' : pend.length ? '' : ' ok'}">${pend.length ? t('{n} pending', { n: pend.length }) : t('Up to date')}</span>${c === 'security' && pend.length ? `<span class="faint u-rec">${t('Best installed first')}</span>` : ''}
      <span class="sp"></span><button class="btn sm ghost" data-gotab="${CATS[c].tab}">${t('See all')}${ic('chev')}</button>${pend.length ? `<button class="btn sm sec" data-grp="${c}">${t('Update')}</button>` : ''}</div>
    <div class="u-gl">${show.map(it => itemRow(it, { menu: c === 'apps' })).join('')}</div>
    ${all.length > show.length ? `<button class="u-gmore" data-gotab="${CATS[c].tab}">${t('and {n} more', { n: all.length - show.length })}</button>` : ''}
  </div>`;
}
function updateOverviewCounts(first) {
  const el = $(`#v-${ID} .tab[data-tab="overview"]`); if (!el || !S.scanned) return;
  const p = pending().filter(i => !i.optional); const known = p.filter(i => i.mb != null); const tot = known.reduce((a, i) => a + i.mb, 0);
  const cnt = $('.u-cnt', el); if (cnt && (+(cnt.dataset.v || 0) !== p.length || cnt.dataset.nc)) { delete cnt.dataset.nc; SH.countUp(cnt, p.length, first ? 900 : 400); }
  const when = S.apps && S.apps.ts ? ago(S.apps.ts * 1000) : t('just now');
  const sub = $('.u-sub', el); if (sub && !S.appsScanning) sub.textContent = [p.length ? (known.length && tot ? t('{size} known to download.', { size: mb(tot) }) : '') : S.errs.apps || S.noWinget ? t("Your apps couldn't be checked.") : t('Everything is up to date.'), t('Last checked {when}.', { when }), S.winScanning ? t('Windows Update is still searching.') : ''].filter(Boolean).join(' ');
  $$('.u-group', el).forEach(g => { const c = g.dataset.cat; const n = pendingIn(c).length; const chip = $('.u-gc', g); if (!chip) return; const txt = n ? t('{n} pending', { n }) : t('Up to date');
    if (chip.textContent !== txt) { chip.textContent = txt; chip.classList.toggle('warn', c === 'security' && !!n); chip.classList.toggle('ok', !n); anim(chip, [{ transform: 'scale(.8)', opacity: .4 }, { transform: 'scale(1)', opacity: 1 }], { d: 360, e: EASE.spring }); } });
}

/* ---------------- Apps ---------------- */
let appsFilter = 'all', appsQuery = '';
function renderApps(el) {
  el.classList.add('fill');
  el.innerHTML = `<div class="u-apps">
    <div class="pan u-list u-fp" data-asm>
      <div class="u-ph"><label class="field u-search">${ic('search')}<input placeholder="${esc(t('Search for an app'))}" spellcheck="false"></label>
        <div class="seg u-filt"><span class="ind"></span><button data-f="all" class="on">${t('Pending')}</button><button data-f="sel">${t('Selected')}</button><button data-f="hidden">${t('Ignored and pinned')}</button></div>
        <span class="sp"></span><span class="faint u-acount"></span></div>
      ${selBar()}
      <div class="tbl-head u-th">${groupCheck('apps', t('Apps'))}<span>${t('App')}</span><span>${t('Version')}</span><span>${t('Size')}</span><span></span></div>
      <div class="u-scroll"><div class="u-applist rows"></div></div>
    </div>
    <aside class="u-aside">
      <div class="pan u-asum" data-asm><h4>${t('With winget')} <em>${t('the Windows package manager')}</em></h4>
        <div class="u-asb"><div class="big"><span class="u-apend">0</span><small>${t('pending')}</small></div><span class="muted u-asz"></span></div>
        <button class="btn pri" data-grp="apps">${ic('download')}${t('Update all')}</button></div>
      <div class="pan u-unknown u-fp" data-asm><h4>${t('Outside winget')} <em>${t('updated from their website')}</em></h4>
        <div class="u-scroll"><div class="rows u-unk"><div class="sk-rows">${[0, 1, 2].map(() => '<div class="sk-row"><div class="sk a"></div><div class="sk b" style="--w:50%"></div></div>').join('')}</div></div></div></div>
    </aside></div>`;
  requestAnimationFrame(() => SH.placeSeg($('.u-filt', el), true));
  $('.u-search input', el).addEventListener('input', e => { appsQuery = e.target.value.trim().toLowerCase(); refreshAppsFilter(true); });
  $('.u-filt', el).addEventListener('click', e => { const b = e.target.closest('button[data-f]'); if (!b || b.classList.contains('on')) return; $$('.u-filt button', el).forEach(x => x.classList.toggle('on', x === b)); SH.placeSeg($('.u-filt', el)); appsFilter = b.dataset.f; refreshAppsFilter(true); });
  hydrate(); autoScan('apps'); refreshAppsFilter(true); paintNotChecked();
}
function fillUnknown(el) {
  const box = $('.u-unk', el); if (!box || !S.apps) return;
  const u = S.apps.unknown || [];
  const h4 = $('.u-unknown>h4 em', el); if (h4) h4.textContent = t('{n} apps, updated from their website', { n: u.length });
  box.innerHTML = u.length ? u.map(x => `<div class="row">${smallTile(x)}<div class="rt"><b>${esc(dn(x.name))}</b><span>${esc(x.pub ? x.pub + ', ' : '')}${t('version {v}', { v: esc(cv(x.ver) || '—') })}</span></div>${x.url ? `<button class="iconbtn" data-url="${esc(x.url)}" title="${esc(t('Open their website'))}">${ic('external')}</button>` : ''}</div>`).join('')
    : `<div class="faint u-none">${t('winget recognizes everything you have installed.')}</div>`;
}
function refreshAppsFilter(animate) {
  const el = $(`#v-${ID} .tab[data-tab="apps"]`); if (!el || !S.scanned) return; const list = $('.u-applist', el); if (!list) return;
  fillUnknown(el);
  let apps = S.items.filter(i => i.cat === 'apps');
  if (appsFilter === 'all') apps = apps.filter(i => !S.ignored.has(i.id) && !S.pinned.has(i.id));
  if (appsFilter === 'sel') apps = apps.filter(i => S.sel.has(i.id));
  if (appsFilter === 'hidden') apps = apps.filter(i => S.ignored.has(i.id) || S.pinned.has(i.id));
  if (appsQuery) apps = apps.filter(i => (i.name + ' ' + (i.pub || '')).toLowerCase().includes(appsQuery));
  const html = apps.map(it => appsFilter === 'hidden'
    ? `<div class="u-row" data-item="${esc(it.id)}">${tile(it)}<span class="u-name"><b>${esc(dn(it.name))}</b><span>${S.ignored.has(it.id) ? t('You ignore version {v}', { v: esc(it.to) }) : t('Pinned to {v}', { v: esc(it.from) })}</span></span>${vers(it)}<span class="u-size">${mb(it.mb)}</span><span class="u-act"><button class="btn sm ghost" data-unhide="${esc(it.id)}">${t('Show again')}</button></span></div>`
    : itemRow(it)).join('');
  list.innerHTML = html || SH.emptyState({ art: appsFilter === 'hidden' || appsFilter === 'sel' ? 'first' : appsQuery ? 'none' : S.errs.apps || S.noWinget ? 'error' : 'ok', title: appsFilter === 'hidden' ? t("You aren't ignoring any version") : appsFilter === 'sel' ? t('Nothing selected yet') : appsQuery ? t('No app with that name') : S.errs.apps || S.noWinget ? t('No results') : t('Your apps are up to date'), text: appsFilter === 'sel' ? t('Check the box next to the apps you want to update.') : '', action: !appsFilter || appsFilter === 'pending' || appsFilter === 'all' ? { label: t('Check for updates'), click: '#v-updater [data-check]' } : null }) + errBox('apps');
  if (animate) $$('.u-row, .empty', list).slice(0, 14).forEach((r, i) => anim(r, [{ opacity: 0, transform: 'translate3d(0,10px,0)' }, { opacity: 1, transform: 'none' }], { d: 380, delay: i * 28, e: EASE.spring }));
  const pend = pendingIn('apps'); const cnt = $('.u-apend', el);
  if (cnt && +(cnt.dataset.v || 0) !== pend.length) SH.countUp(cnt, pend.length, 600);
  const sz = $('.u-asz', el); if (sz) sz.textContent = pend.length ? t('They install silently, one after another. Windows may ask for permission on some.') : t('Everything winget knows about is up to date.');
  const ac = $('.u-acount', el); if (ac) { const nOpt = apps.filter(i => i.optional).length; ac.textContent = nOpt && appsFilter === 'all' ? (apps.length === 1 ? t('{n} app, {m} optional', { n: 1, m: nOpt }) : t('{n} apps, {m} optional', { n: apps.length, m: nOpt })) : apps.length === 1 ? t('{n} app', { n: 1 }) : t('{n} apps', { n: apps.length }); }
  updateSelBars();
}

/* ---------------- Windows ---------------- */
let pauseWeeks = 1;
function renderWindows(el) {
  el.classList.add('fill'); el.dataset.ready = '1';
  el.innerHTML = `<div class="u-win">
    <div class="pan u-wstat" data-asm>
      <span class="u-wlogo">${ic('windows')}</span>
      <div><b class="u-wprod">${esc(SH.PC.os || 'Windows')}</b><span class="muted u-wbuild">${t('Searching Windows Update…')}</span></div>
      <span class="sp"></span><span class="chip u-rb">${t('No restart needed')}</span>
      <button class="btn sec" data-wcheck>${ic('refresh')}${t('Check now')}</button>
    </div>
    <div class="u-wwait"><span></span><div class="bar"><span></span></div></div>
    <div class="u-wcols">
      <div class="u-wmain u-scroll">
        <div class="pan" data-asm><h4>${groupCheck('w:security', t('Security'))}${t('Security')} <em>${t('installed even when paused')}</em></h4><div class="u-wl" data-wl="security"></div></div>
        <div class="pan" data-asm><h4>${groupCheck('w:windows', t('Quality and servicing'))}${t('Quality and servicing')}</h4><div class="u-wl" data-wl="windows"></div></div>
        <div class="pan" data-asm><h4>${groupCheck('w:optional', t('Optional'))}${t('Optional')} <em>${t('only if you want them')}</em></h4><div class="u-wl" data-wl="optional"></div></div>
      </div>
      <div class="u-wside">
        <div class="pan u-pause" data-asm><h4>${t('Pause updates')}</h4><div class="u-pbody"></div></div>
        <div class="pan u-fp" data-asm><h4>${t('History')} <em>${t('latest installs')}</em></h4><div class="u-scroll"><div class="rows u-hist"></div></div></div>
      </div>
    </div></div>`;
  renderPause($('.u-pbody', el));
  const sk = '<div class="sk-row" style="border:0;padding:8px 4px"><div class="sk a"></div><div class="sk b" style="--w:52%"></div><div class="sk c"></div></div>';
  $$('.u-wl', el).forEach(b => { b.innerHTML = sk; });
  hydrate(); autoScan('win'); updateWinWait();
  if (S.winScanned) fillWindows(el);
  paintNotChecked();
}
function fillWindows(el) {
  const w = S.win; updateWinWait();
  if (!w) { $$('.u-wl', el).forEach(b => { b.innerHTML = errBox('win') || `<div class="faint u-none">${t('No data.')}</div>`; }); return; }
  $('.u-wprod', el).textContent = `${w.product || 'Windows'} ${w.version || ''}`.trim();
  $('.u-wbuild', el).textContent = t('Build {build}.', { build: w.build || '—' }) + ' ' + t('Last checked {when}.', { when: ago((w.ts || 0) * 1000) });
  const fill = (k, list) => { const box = $(`[data-wl="${k}"]`, el); box.innerHTML = list.length ? list.map(it => itemRow(it, { menu: false })).join('') : `<div class="faint u-none">${k === 'security' ? t("Nothing pending. You're protected.") : t('Nothing pending.')}</div>`; $$('.u-row', box).forEach((r, i) => anim(r, [{ opacity: 0, transform: 'translate3d(0,8px,0)' }, { opacity: 1, transform: 'none' }], { d: 360, delay: i * 40, e: EASE.spring })); };
  fill('security', S.items.filter(i => i.cat === 'security' && i.kind !== 'defender'));
  fill('windows', S.items.filter(i => i.cat === 'windows' && !i.optional));
  fill('optional', S.items.filter(i => i.optional));
  setReboot(el); renderPause($('.u-pbody', el)); syncGroupChecks();
  const h = $('.u-hist', el);
  h.innerHTML = (w.history || []).length ? w.history.map(x => `<div class="row"><span class="ri ${x.ok ? 'ok' : 'bad'}">${ic(x.ok ? 'check' : 'x')}</span><div class="rt"><b>${esc(x.t)}</b><span>${x.ok ? fdate(x.d) : t('{date}, failed with error {code}', { date: fdate(x.d), code: esc(x.hr || '') })}</span></div></div>`).join('') : `<div class="faint u-none">${t('Windows has no update history.')}</div>`;
}
function setReboot(el) { const c = $('.u-rb', el); if (!c) return; const txt = S.reboot ? t('Restart pending') : t('No restart needed'); if (c.textContent !== txt) { c.textContent = txt; c.classList.toggle('warn', S.reboot); anim(c, [{ transform: 'scale(.85)' }, { transform: 'scale(1)' }], { d: 360, e: EASE.spring }); } }
function renderPause(box) {
  if (!box) return;
  if (S.paused && S.paused > Date.now()) {
    const d = new Date(S.paused).toLocaleDateString(SH.i18n.locale, { day: 'numeric', month: 'long' });
    box.innerHTML = `<p class="u-pnow"><b>${t('Paused until {date}', { date: d })}</b>${t('Antivirus signatures and critical patches still install.')}</p><button class="btn sec" data-resume>${ic('play')}${t('Resume now')}</button>`;
  } else {
    box.innerHTML = `<p class="muted">${t("Windows won't install quality updates during this time. It's the same as pausing in Settings.")}</p>
      <div class="seg u-pw"><span class="ind"></span>${[1, 2, 3, 4, 5].map(n => `<button data-w="${n}"${n === pauseWeeks ? ' class="on"' : ''}>${t('{n} wk', { n })}</button>`).join('')}</div>
      <button class="btn sec" data-pause>${ic('pause')}${pauseLabel()}</button>`;
    requestAnimationFrame(() => { const s = $('.u-pw', box); if (s) SH.placeSeg(s, true); });
  }
  $$(':scope > *', box).forEach((x, i) => anim(x, [{ opacity: 0, transform: 'translate3d(0,6px,0)' }, { opacity: 1, transform: 'none' }], { d: 340, delay: i * 40, e: EASE.spring }));
}
function pauseLabel() { return pauseWeeks === 1 ? t('Pause for 1 week') : t('Pause for {n} weeks', { n: pauseWeeks }); }
async function doPause(weeks, el) {
  if (!REAL) { S.paused = weeks ? Date.now() + weeks * 7 * 864e5 : null; renderPause($('.u-pbody', el)); return true; }
  if (!SH.requireAdmin(t('to pause Windows Update.'))) return false;
  let r; try { r = await SH.engine(ID, 'set_pause', weeks); } catch (e) { SH.toast(t("Couldn't do it: {error}", { error: e.message }), { kind: 'error' }); return false; }
  if (r && r.needAdmin) { SH.requireAdmin(t('to pause Windows Update.')); return false; }
  S.paused = r && r.pause ? Date.parse(r.pause) : null; renderPause($('.u-pbody', el)); return true;
}

/* ---------------- Store ---------------- */
function renderStore(el) {
  el.classList.add('fill'); el.dataset.ready = '1';
  el.innerHTML = `<div class="u-apps">
    <div class="pan u-list u-fp" data-asm>
      <div class="u-ph">${groupCheck('store', t('Store'))}<div class="u-pht"><b>${t('Pending')}</b><span class="muted">${t('The Store updates on its own, but sometimes falls behind. Force it here.')}</span></div>
        <span class="sp"></span><button class="btn pri" data-grp="store">${ic('download')}${t('Update all')}</button></div>
      <div class="u-scroll"><div class="u-storelist rows"></div></div>
    </div>
    <aside class="u-aside">
      <div class="pan u-asum" data-asm><h4>${t('Store automatic updates')}</h4>
        <div class="u-sopt"><span class="u-si">${ic('store')}</span><div><b class="u-sab">${t('On in Windows')}</b><span>${t('The Store installs new versions on its own when the PC is idle.')}</span></div><button class="toggle on" data-storeauto aria-label="${esc(t('Store automatic updates'))}"><i></i></button></div></div>
      <div class="pan u-fp" data-asm><h4>${t('Up to date')} <em class="u-sokn"></em></h4>
        <div class="u-scroll"><div class="rows u-sok"></div></div></div>
    </aside></div>`;
  if (REAL) SH.engine(ID, 'store_auto').then(r => { if (!r) return; const tg = $('[data-storeauto]', el); tg.classList.toggle('on', !!r.on); $('.u-sab', el).textContent = r.on ? t('On in Windows') : t('Off in Windows'); }).catch(() => {});
  hydrate(); autoScan('apps'); fillStore(el); paintNotChecked();
  el.addEventListener('click', async e => {
    const tg = e.target.closest('[data-storeauto]'); if (!tg) return; const on = !tg.classList.contains('on');
    SH.sound(on ? 'toggle_on' : 'toggle_off');  /* the switch flips only after the engine answers */
    if (REAL) { if (!SH.requireAdmin(t('to change Store automatic updates.'))) return;
      let r; try { r = await SH.engine(ID, 'set_store_auto', on); } catch (er) { SH.toast(t("Couldn't do it: {error}", { error: er.message }), { kind: 'error' }); return; } if (r && r.needAdmin) return; }
    tg.classList.toggle('on', on); $('.u-sab', el).textContent = on ? t('On in Windows') : t('Off in Windows');
    SH.toast(on ? t('The Store updates on its own again.') : t('The Store no longer updates on its own.'), { action: { label: t('Undo'), sound: 'undo', run: () => tg.click() } });
  });
}
function fillStore(el) {
  const box = $('.u-storelist', el); if (!box || !S.scanned) return;
  const list = S.items.filter(i => i.cat === 'store');
  box.innerHTML = list.length ? list.map(it => itemRow(it, { menu: false })).join('') : SH.emptyState({ art: 'ok', title: t('The Store is up to date'), text: t('No Store apps have a new version.') });
  $$('.u-row', box).forEach((r, i) => anim(r, [{ opacity: 0, transform: 'translate3d(0,10px,0)' }, { opacity: 1, transform: 'none' }], { d: 380, delay: Math.min(i, 10) * 40, e: EASE.spring }));
  syncGroupChecks();
  const ok = (S.apps && S.apps.storeOk) || [];
  $('.u-sokn', el).textContent = t('{n} apps', { n: ok.length });
  $('.u-sok', el).innerHTML = ok.map(x => `<div class="row">${x.icon ? smallTile(x) : `<span class="ri ok">${ic('check')}</span>`}<div class="rt"><b>${esc(dn(x.name))}</b><span>${t('version {v}', { v: esc(cv(x.ver) || '—') })}</span></div></div>`).join('');
}

/* ---------------- Components ---------------- */
function renderRuntimes(el) {
  el.classList.add('fill'); el.dataset.ready = '1';
  el.innerHTML = `<div class="u-rt"><div class="u-cards u-scroll"></div>
    <aside class="u-aside">
      <div class="pan u-fp" data-asm><h4>${t('Up to date')} <em class="u-rtn"></em></h4><div class="u-scroll"><div class="rows u-rtok"></div></div></div>
      <div class="pan u-rtnote" data-asm><h4>${t('What these are')}</h4><p class="muted">${t("Shared pieces that games and apps need to run. Updating them doesn't change your apps, it just makes them safer.")}</p></div>
    </aside></div>`;
  hydrate(); autoScan('apps', 'win');
  fillRuntimes(el);
}
function fillRuntimes(el) {
  const box = $('.u-cards', el); if (!box) return;
  if (!S.scanned && !S.appsScanning) { box.innerHTML = SH.emptyState({ art: 'first', title: t('Not checked yet'), text: t('Check for updates to see which shared components (.NET, Visual C++, WebView2…) have a new version.'), action: CHECK_BTN(), cls: 'pan u-idle' });
    const ok = $('.u-rtok', el); if (ok) ok.innerHTML = `<div class="faint u-none">${t('Not checked yet.')}</div>`; return; }
  if (!S.scanned) { box.innerHTML = [0, 1, 2].map(() => '<div class="pan u-card"><div class="sk" style="height:14px;width:60%"></div><div class="sk" style="height:10px;width:40%;margin-top:10px"></div></div>').join(''); return; }
  const card = (it, extra = '') => `<div class="pan u-card" data-item="${esc(it.id)}">
      <div class="u-ch">${tile(it)}<div class="u-cht"><b>${esc(dn(it.name))}</b><span class="muted">${esc(it.pub || '')}</span></div>${it.cat === 'security' ? `<span class="chip warn">${t('Security')}</span>` : ''}</div>
      ${it.notes && it.notes[0] ? `<p class="u-cnote muted">${esc(it.notes[0])}</p>` : ''}${extra}
      <div class="u-cfoot">${vers(it)}<span class="u-act">${it.done ? `<span class="chip ok">${ic('check')}${t('Updated')}</span>` : `<button class="btn sm sec" data-one="${esc(it.id)}">${t('Update')}</button>`}</span></div></div>`;
  const cards = S.items.filter(i => i.cat === 'runtimes').map(it => card(it));
  const def = S.byId.defender || (!REAL && S.byId.def);
  if (def) cards.push(card(def));
  else if (S.win && S.win.defender) { const o = (S.win.defender.others || [])[0];
    cards.push(`<div class="pan u-card"><div class="u-ch"><span class="u-tile" style="--c:var(--ok)">${ic('shield')}</span><div class="u-cht"><b>${t('Antivirus')}</b><span class="muted">${esc(o || 'Microsoft Defender')}</span></div></div>
      <p class="u-cnote muted">${o ? t("{name} protects this PC and updates its own signatures. Defender is on standby, so its signatures don't need updating.", { name: esc(o) }) : t("Defender isn't active right now.")}</p></div>`); }
  const maker = (SH.PC.maker || '').toLowerCase(); const biosUrl = maker.includes('asus') ? 'https://www.asus.com/support/' : maker.includes('lenovo') ? 'https://pcsupport.lenovo.com/' : maker.includes('dell') ? 'https://www.dell.com/support/' : maker.includes('hp') ? 'https://support.hp.com/' : maker.includes('msi') ? 'https://www.msi.com/support' : '';
  cards.push(`<div class="pan u-card is-bios"><div class="u-ch"><span class="u-tile" style="--c:var(--accent)">${ic('cpu')}</span><div class="u-cht"><b>${t('System BIOS')}</b><span class="muted">${[esc(SH.PC.maker || ''), SH.PC.bios ? t('version {v}', { v: esc(SH.PC.bios) }) : ''].filter(Boolean).join(', ')}</span></div></div>
    <p class="u-cnote muted">${t("The manufacturer publishes the BIOS on its website or in its app (MyASUS, Lenovo Vantage…). StellarHub won't install it on its own: a power cut halfway could leave the PC unable to boot.")}</p>
    <p class="u-warnp">${ic('plug')}${t("If you update it, plug in the charger and don't turn the PC off while it installs.")}</p>
    ${biosUrl ? `<div class="u-cfoot"><span class="sp"></span><button class="btn sm sec" data-url="${biosUrl}">${ic('external')}${t('Open the support website')}</button></div>` : ''}</div>`);
  box.innerHTML = cards.join('') + errBox('apps'); SH.assemble(box, 0, 40, '.u-card');
  const ok = (S.apps && S.apps.runtimesOk) || [];
  $('.u-rtn', el).textContent = t('{n} components', { n: ok.length });
  $('.u-rtok', el).innerHTML = ok.length ? ok.map(u => `<div class="row">${u.icon ? smallTile(u) : `<span class="u-tile sm" style="--c:var(--ok)">${ic('layers')}</span>`}<div class="rt"><b>${esc(dn(u.name))}</b><span>${t('version {v}', { v: esc(cv(u.ver) || '—') })}</span></div></div>`).join('') : `<div class="faint u-none">${t('Nothing else to show.')}</div>`;
}

/* ---------------- Development ---------------- */
function renderDev(el) {
  el.dataset.ready = '1';
  el.innerHTML = `<div class="u-dev">${[0, 1, 2].map(() => '<div class="pan u-dcol"><div class="sk" style="height:16px;width:50%"></div><div class="sk" style="height:10px;width:70%;margin-top:12px"></div><div class="sk" style="height:10px;width:60%;margin-top:8px"></div></div>').join('')}</div>`;
  hydrate(); autoScan('apps', 'dev');
  if (S.devScanned) fillDev(el); else paintNotChecked();
  el.addEventListener('click', e => {
    if (queueClicks(e)) return;
    const one = e.target.closest('[data-one]'); if (one) { if (enqueue([one.dataset.one])) { one.disabled = true; one.innerHTML = `<span class="u-spin"></span>${t('Queued')}`; SH.toast(t('{name} added to the queue.', { name: S.byId[one.dataset.one].name }), { action: { label: t('See the queue'), run: goOverview } }); } return; }
    const url = e.target.closest('[data-url]'); if (url) { SH.call('open_url', url.dataset.url); return; }
    const c = e.target.closest('[data-pkc]'); if (c) { c.classList.toggle('on'); anim(c, [{ transform: 'scale(.82)' }, { transform: 'scale(1)' }], { d: 300, e: EASE.spring }); updCmd(c.closest('.u-dsub')); return; }
    const all = e.target.closest('[data-pkall]'); if (all) { const col = all.closest('.u-dsub'); const ks = $$('.u-pkr .check', col); const on = ks.some(k => !k.classList.contains('on')); ks.forEach(k => k.classList.toggle('on', on)); anim(all, [{ transform: 'scale(.82)' }, { transform: 'scale(1)' }], { d: 300, e: EASE.spring }); updCmd(col); return; }
    const g = e.target.closest('[data-pkgo]'); if (g) {
      const col = g.closest('.u-dsub'); const kind = g.dataset.pkgo;
      const names = $$('.u-pkr', col).filter(r => { const k = $('.check', r); return k && k.classList.contains('on'); }).map(r => r.dataset.pk);
      if (!names.length) { SH.toast(t('Pick at least one package.')); return; }
      const item = { id: `${kind}:${Date.now()}`, kind, pkgs: names, name: names.length === 1 ? t('{n} {kind} package', { n: 1, kind }) : t('{n} {kind} packages', { n: names.length, kind }), cat: 'dev', to: '', from: '', pub: kind === 'pip' ? 'Python' : 'Node.js', mb: null, notes: [] };
      confirmRun([item], t('Update {kind} packages', { kind }), () => { enqueue([item]); g.disabled = true; g.innerHTML = `<span class="u-spin"></span>${t('Queued')}`; SH.toast(t('{name} added to the queue.', { name: item.name }), { action: { label: t('See the queue'), run: goOverview } }); });
    }
  });
}
function updCmd(col) {
  const kind = col.dataset.kind;
  const ks = $$('.u-pkr .check', col), all = $('[data-pkall]', col); if (all) setTri(all, ks.filter(k => k.classList.contains('on')).length, ks.length);
  const names = $$('.u-pkr', col).filter(r => { const k = $('.check', r); return k && k.classList.contains('on'); }).map(r => r.dataset.pk + (kind === 'npm' ? '@latest' : ''));
  const l = $('.u-cmdl', col); if (l) { l.textContent = names.join(' ') || t('(nothing selected)'); anim(l, [{ opacity: .3 }, { opacity: 1 }], { d: 260 }); }
}
function fillDev(el) {
  const d = S.dev || {}; const witems = S.items.filter(i => i.cat === 'dev');
  const pkgTable = (list, kind) => `<div class="u-pk">${list.map(([n, a, b]) => `<div class="u-pkr" data-pk="${esc(n)}"><button class="check on" data-pkc aria-label="${t('Select {name}', { name: esc(n) })}">${ic('check')}</button><span class="u-pkn">${esc(n)}</span><span class="u-ver"><span>${esc(a)}</span>${ic('arrow')}<b>${esc(b)}</b></span></div>`).join('')}</div>`;
  const pkgBlock = (list, kind, title, err) => err ? `<div class="u-err">${ic('alert')}<span>${esc(err)}</span></div>` : list.length
    ? `<div class="u-dsub" data-kind="${kind}"><div class="u-dsh"><h5><button class="check u-gall on" role="checkbox" aria-checked="true" data-pkall aria-label="${esc(t('Select all: {group}', { group: title }))}" title="${esc(t('Select all'))}">${ic('check')}</button>${title} <em>${list.length}</em></h5></div><div class="u-pkwrap u-scroll">${pkgTable(list, kind)}</div>
       <div class="u-cmd faint">${kind === 'pip' ? 'python -m pip install -U ' : 'npm install -g '}<span class="u-cmdl">${list.map(x => x[0] + (kind === 'npm' ? '@latest' : '')).join(' ')}</span></div>
       <button class="btn sm pri" data-pkgo="${kind}">${ic('download')}${t('Update packages')}</button></div>`
    : `<p class="muted u-dnote">${ic('check')}${kind === 'pip' ? t('All your pip packages are up to date.') : t('No global npm package is out of date.')}</p>`;
  const wrow = it => `<div class="u-row u-drow" data-item="${esc(it.id)}">${tile(it)}<span class="u-name"><b>${esc(dn(it.name))}</b><span>${esc(it.pub || '')}</span></span>${vers(it)}<span class="u-act">${it.done ? `<span class="chip ok">${ic('check')}${t('Updated')}</span>` : `<button class="btn sm sec" data-one="${esc(it.id)}">${t('Update')}</button>`}</span></div>`;
  const node = witems.filter(i => /node/i.test(i.wid || i.id || i.name)), other = witems.filter(i => !node.includes(i));
  const okTools = [...(d.git ? [['Git', d.git]] : []), ...((S.apps && S.apps.devOk) || []).filter(x => !/^git$/i.test(x.name)).map(x => [x.name, x.ver]), ...(d.tools || [])];
  const seen = new Set();
  /* the same tool under two names (winget's "Windows Subsystem for Linux" and "WSL"): one row; Node.js has its own column */
  const alias = n => /^(wsl|.*\b(subsystem|subsistema|sous-syst).*)$/i.test(n) ? 'wsl' : /^node(\.?js)?$/i.test(n) ? 'node' : n.toLowerCase();
  const tools = okTools.filter(([n]) => !seen.has(alias(n)) && seen.add(alias(n)) && alias(n) !== 'node' && !other.some(o => alias(o.name) === alias(n)));
  const when = S.fromCache.dev || (d.ts ? d.ts * 1000 : 0);
  const again = S.devScanned && !S.devScanning && when ? SH.lastRun({ when, title: t('Last check: {when}'), text: S.fromCache.dev ? t('These results are from then. Check again to see what is new.') : '', action: { label: t('Check again'), data: 'data-devcheck', icon: 'refresh' }, cls: 'u-devlast' }) : '';
  el.innerHTML = `${again}<div class="u-dev">
    <div class="pan u-dcol" data-asm><div class="u-dh"><span class="u-tile" style="--c:var(--ok)">${ic('code')}</span><div><b>Python</b><span class="muted">${d.python ? t('version {v}', { v: esc(d.python) }) : S.devScanned ? t('not found') : t('checking…')}</span></div></div>
      ${S.devScanned ? pkgBlock(d.pip || [], 'pip', t('Outdated pip packages'), d.pipError) : `<p class="muted u-dnote"><span class="u-spin"></span>${t('Asking pip (takes a few seconds)…')}</p>`}</div>
    <div class="pan u-dcol" data-asm><div class="u-dh"><span class="u-tile" style="--c:var(--ok)">${ic('code')}</span><div><b>Node.js</b><span class="muted">${d.node ? t('version {v}', { v: esc(d.node) }) : S.devScanned ? t('not installed') : t('checking…')}</span></div></div>
      ${node.map(wrow).join('')}${S.devScanned ? (d.node ? pkgBlock(d.npm || [], 'npm', t('Global npm packages'), d.npmError) : '') : `<p class="muted u-dnote"><span class="u-spin"></span>${t('Asking npm…')}</p>`}</div>
    <div class="pan u-dcol" data-asm><div class="u-dh"><span class="u-tile" style="--c:var(--ok)">${ic('code')}</span><div><b>${t('Git and other tools')}</b><span class="muted">${t('Updated with winget')}</span></div></div>
      ${other.map(wrow).join('')}
      <div class="u-dsub"><h5>${t('Up to date')}</h5><div class="u-pk">${tools.length ? tools.map(([n, v]) => `<div class="u-pkr is-done"><span class="u-pkn">${esc(dn(n))}</span><span class="u-ver"><b>${esc(cv(v))}</b></span><span class="chip ok">${t('Up to date')}</span></div>`).join('') : `<span class="faint">${t('Nothing else installed.')}</span>`}</div></div>
    </div></div>`;
  SH.assemble(el, 0, 60);
}

/* ---------------- Schedule ---------------- */
const SCHED_DEF = { on: false, freq: 'week', day: 6, from: 3, to: 5, plugged: true, noGame: true, restore: true, idleReboot: true, inc: { apps: true, windows: true, store: true, runtimes: false, dev: false }, exclude: [] };
function sched() { const cur = state.settings.updSchedule || {}; if (!sched.c) sched.c = { ...SCHED_DEF, ...cur, inc: { ...SCHED_DEF.inc, ...(cur.inc || {}) }, exclude: [...(cur.exclude || SCHED_DEF.exclude)] }; return sched.c; }
const saveSched = () => SH.setSetting('updSchedule', JSON.parse(JSON.stringify(sched())));
/* weekday names (Monday first) in the interface language; 5 Jan 2026 is a Monday */
const DAYS = [0, 1, 2, 3, 4, 5, 6].map(i => new Date(2026, 0, 5 + i).toLocaleDateString(SH.i18n.locale, { weekday: 'long' }));
const DAYS2 = SH.i18n.lang === 'en' ? DAYS.map(d => d.slice(0, 2))
  : [0, 1, 2, 3, 4, 5, 6].map(i => new Date(2026, 0, 5 + i).toLocaleDateString(SH.i18n.locale, { weekday: 'short' }).replace(/\.$/, ''));
const hh = h => String(h).padStart(2, '0') + ':00';
function renderSchedule(el) {
  const s = sched(); el.dataset.ready = '1';
  const tg = (k, label, sub, icn, inc) => `<div class="u-sopt"><span class="u-si">${ic(icn)}</span><div><b>${label}</b>${sub ? `<span>${sub}</span>` : ''}</div><button class="toggle${(inc ? s.inc[k] : s[k]) ? ' on' : ''}" ${inc ? 'data-sinc' : 'data-s'}="${k}" aria-label="${esc(label)}"><i></i></button></div>`;
  const auto = (state.settings.activity || []).filter(a => a.go === ID && a.auto).slice(0, 8);
  el.classList.add('fill');
  el.innerHTML = `<div class="u-sch">
    <div class="u-scol u-scroll">
      <div class="pan u-master" data-asm>${tg('on', t('Update automatically'), t("A scheduled task installs what's pending so you don't have to remember."), 'autopilot')}</div>
      <div class="u-dep">
      <div class="pan" data-asm><h4>${t('When')}</h4>
        <div class="u-field"><span>${t('Frequency')}</span><div class="seg" data-sseg="freq"><span class="ind"></span>${[['day', t('Every day')], ['week', t('Every week')], ['month', t('Every month')]].map(([v, l]) => `<button data-v="${v}"${s.freq === v ? ' class="on"' : ''}>${l}</button>`).join('')}</div></div>
        <div class="u-days${s.freq === 'week' ? ' on' : ''}"><div><div class="u-field"><span>${t('Day')}</span><div class="seg" data-sseg="day"><span class="ind"></span>${DAYS.map((d, i) => `<button data-v="${i}"${s.day === i ? ' class="on"' : ''} title="${esc(d)}">${esc(DAYS2[i])}</button>`).join('')}</div></div></div></div>
        <div class="u-field u-win24"><span>${t('Time window')}</span><div class="u-range">
          <div class="u-24"><span class="u-band"></span>${[0, 6, 12, 18, 24].map(h => `<i style="left:${h / 24 * 100}%">${String(h).padStart(2, '0')} h</i>`).join('')}</div>
          <div class="u-rr"><label>${t('From')}<input type="range" min="0" max="23" value="${s.from}" data-r="from"><b data-rv="from">${hh(s.from)}</b></label><label>${t('To')}<input type="range" min="1" max="24" value="${s.to}" data-r="to"><b data-rv="to">${hh(s.to)}</b></label></div>
        </div></div>
      </div>
      <div class="pan" data-asm><h4>${t('What gets updated')}</h4>
        ${tg('apps', t('Apps'), t('The ones winget knows.'), 'package', 1)}${tg('windows', 'Windows', t('Quality and security. Never the optional ones.'), 'windows', 1)}${tg('store', t('Store'), null, 'store', 1)}${tg('runtimes', t('Components'), t('.NET, Visual C++ and Java. Never the BIOS.'), 'layers', 1)}${tg('dev', t('Development'), t('Node, Git and packages.'), 'code', 1)}
      </div>
      <div class="pan" data-asm><h4>${t('Conditions')}</h4>
        ${tg('plugged', t('Only when the charger is plugged in'), null, 'plug')}${tg('noGame', t("Never while you're gaming or in full screen"), null, 'gamepad')}${tg('restore', t('Create a restore point first'), null, 'restore')}${tg('idleReboot', t("Restart only if you're not using the PC"), null, 'power')}
      </div>
      <div class="pan" data-asm><h4>${t('Never touch')}</h4><div class="u-excl"></div>
        <div class="u-addx"><button class="btn sm ghost" data-addx>${ic('plus')}${t('Add an app')}</button></div></div>
      </div>
    </div>
    <div class="u-scol2"><div class="pan u-next" data-asm><h4>${t('Next automatic update')}</h4><div class="u-nexttxt"></div><div class="u-week"></div>
      <p class="faint u-nfoot">${t('If the PC is off at that time, it runs the next time you turn it on within the window.')}</p></div>
      <div class="pan u-fp" data-asm><h4>${t('Latest')} <em>${t('automatic runs')}</em></h4><div class="u-scroll"><div class="rows">${auto.length ? auto.map(a => { const x = SH.activityText ? SH.activityText(a) : a; return `<div class="row"><span class="ri ok">${ic('check')}</span><div class="rt"><b>${esc(x.t)}</b><span>${esc(x.sub || '')}</span></div></div>`; }).join('') : `<div class="faint u-none">${t("None yet. They'll show up here when a scheduled task runs them.")}</div>`}</div></div></div></div>
  </div>`;
  renderExcl(el); applyMaster(el, false); renderNext(el, false); bandSpring.from.set(s.from); bandSpring.to.set(s.to); bandDirty = true;
  requestAnimationFrame(() => $$('.seg', el).forEach(x => SH.placeSeg(x, true)));
  el.addEventListener('click', e => {
    const tog = e.target.closest('.toggle[data-s], .toggle[data-sinc]'); if (tog) { tog.classList.toggle('on'); const on = tog.classList.contains('on');
      if (tog.dataset.s) sched()[tog.dataset.s] = on; else sched().inc[tog.dataset.sinc] = on; saveSched(); if (tog.dataset.s === 'on') applyMaster(el, true); renderNext(el, true); return; }
    const sb = e.target.closest('[data-sseg] button'); if (sb && !sb.classList.contains('on')) { const sg = sb.parentElement; $$('button', sg).forEach(x => x.classList.toggle('on', x === sb)); SH.placeSeg(sg);
      const k = sg.dataset.sseg; sched()[k] = k === 'day' ? +sb.dataset.v : sb.dataset.v; saveSched();
      if (k === 'freq') { const d = $('.u-days', el); d.classList.toggle('on', sb.dataset.v === 'week'); if (sb.dataset.v === 'week') requestAnimationFrame(() => SH.placeSeg($('[data-sseg="day"]', el), true)); }
      renderNext(el, true); return; }
    const rx = e.target.closest('[data-rmx]'); if (rx) { const n = rx.dataset.rmx; const chip = rx.closest('.chip'); sched().exclude = sched().exclude.filter(x => x !== n); saveSched();
      anim(chip, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.7)' }], { d: 200 }).finished.then(() => renderExcl(el)).catch(() => renderExcl(el)); return; }
    if (e.target.closest('[data-addx]')) { openAddx(el); return; }
    const ax = e.target.closest('[data-ax]'); if (ax) { sched().exclude.push(ax.dataset.ax); saveSched(); closeAddx(el); renderExcl(el, ax.dataset.ax); }
  });
  el.addEventListener('input', e => { const r = e.target.closest('[data-r]'); if (!r) return; const s2 = sched(); const v = +r.value;
    if (r.dataset.r === 'from') { if (v >= s2.to) { s2.to = Math.min(24, v + 1); $('[data-r="to"]', el).value = s2.to; } s2.from = v; } else { if (v <= s2.from) { s2.from = Math.max(0, v - 1); $('[data-r="from"]', el).value = s2.from; } s2.to = v; }
    $('[data-rv="from"]', el).textContent = hh(s2.from); $('[data-rv="to"]', el).textContent = hh(s2.to);
    renderNext(el, true); });
  el.addEventListener('change', e => { if (e.target.closest('[data-r]')) saveSched(); });
}
function renderExcl(el, fresh) {
  const box = $('.u-excl', el); const list = sched().exclude;
  box.innerHTML = list.length ? list.map(n => `<span class="chip u-xchip">${esc(n)}<button data-rmx="${esc(n)}" aria-label="${t('Remove {name}', { name: esc(n) })}">${ic('x')}</button></span>`).join('') : `<span class="faint">${t("You aren't excluding any app.")}</span>`;
  if (fresh) { const c = $$('.u-xchip', box).find(x => x.textContent.trim() === fresh); if (c) anim(c, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }], { d: 380, e: EASE.spring }); }
}
function openAddx(el) {
  const host = $('.u-addx', el); if ($('.u-menu', host)) { closeAddx(el); return; }
  const names = [...new Set([...S.items.filter(i => ['apps', 'store', 'dev'].includes(i.cat)).map(i => i.name), ...(((S.apps && S.apps.unknown) || []).map(u => u.name))])];
  const opts = names.filter(n => !sched().exclude.includes(n)).sort((a, b) => a.localeCompare(b));
  const m = document.createElement('div'); m.className = 'u-menu u-addmenu'; m.innerHTML = opts.length ? opts.map(n => `<button data-ax="${esc(n)}">${ic('package')}${esc(n)}</button>`).join('') : `<button disabled>${ic('info')}${t('Check for updates first')}</button>`;
  host.appendChild(m); anim(m, [{ opacity: 0, transform: 'translate3d(0,-6px,0) scale(.95)' }, { opacity: 1, transform: 'none' }], { d: 260, e: EASE.spring });
}
function closeAddx(el) { const m = $('.u-addx .u-menu', el); if (m) anim(m, [{ opacity: 1 }, { opacity: 0 }], { d: 140 }).finished.then(() => m.remove()).catch(() => m.remove()); }
function applyMaster(el, animate) {
  const on = sched().on; const dep = $('.u-dep', el); dep.classList.toggle('off', !on);
  if (animate) anim(dep, [{ opacity: on ? .4 : 1, filter: on ? 'saturate(.3)' : 'none' }, { opacity: on ? 1 : .4, filter: on ? 'none' : 'saturate(.3)' }], { d: 300, fill: 'none' });
}
function nextRun() {
  const s = sched(); const now = new Date(); const d = new Date(now); d.setMinutes(0, 0, 0); d.setHours(s.from);
  if (s.freq === 'day') { if (d <= now) d.setDate(d.getDate() + 1); }
  else if (s.freq === 'week') { const want = (s.day + 1) % 7; d.setDate(d.getDate() + (want - d.getDay() + 7) % 7); if (d <= now) d.setDate(d.getDate() + 7); }
  else { d.setDate(1); if (d <= now) d.setMonth(d.getMonth() + 1); }
  return d;
}
/* "apps, Windows and store" in the interface language */
function listFmt(arr) {
  try { return new Intl.ListFormat(SH.i18n.locale, { style: 'long', type: 'conjunction' }).format(arr); }
  catch { return arr.join(', '); }
}
const bandSpring = { from: new Spring(3, 160, 22), to: new Spring(5, 160, 22) };
let bandDirty = false, bandW = 0;
function renderNext(el, animate) {
  const s = sched(); const box = $('.u-nexttxt', el); if (!box) return;
  const inc = Object.entries(s.inc).filter(([, v]) => v).map(([k]) => CATS[k].l);
  const list = listFmt(inc);
  const html = s.on ? `<b>${nextRun().toLocaleDateString(SH.i18n.locale, { weekday: 'long', day: 'numeric', month: 'long' })}</b><span>${t('between {from} and {to}', { from: hh(s.from), to: hh(s.to) })}</span><p class="muted">${inc.length ? t('Includes {list}.', { list: esc(list) }) : t("You haven't picked anything to update.")}${s.plugged ? ' ' + t('Only when plugged in.') : ''}</p>`
    : `<b>${t('Off')}</b><p class="muted">${t('You start updates yourself from the Overview. Turn it on above so a scheduled task does it for you.')}</p>`;
  if (box.innerHTML !== html) { box.innerHTML = html; if (animate) anim(box, [{ opacity: 0, filter: 'blur(6px)', transform: 'translate3d(0,6px,0)' }, { opacity: 1, filter: 'blur(0px)', transform: 'none' }], { d: 360, e: EASE.spring }); }
  const wk = $('.u-week', el); const nd = (nextRun().getDay() + 6) % 7;
  const days = s.freq === 'day' ? [0, 1, 2, 3, 4, 5, 6] : s.freq === 'week' ? [s.day] : [];
  const prevOn = $$('.u-wd.on', wk).map(x => +x.dataset.d).join();
  wk.innerHTML = DAYS.map((d, i) => `<div class="u-wd${days.includes(i) && s.on ? ' on' : ''}${i === nd && s.on ? ' next' : ''}" data-d="${i}"><span>${esc(DAYS2[i])}</span><i></i></div>`).join('');
  if (animate && prevOn !== days.join()) $$('.u-wd.on i', wk).forEach((x, i) => anim(x, [{ transform: 'scale(.2)' }, { transform: 'scale(1)' }], { d: 420, delay: i * 30, e: EASE.spring }));
  bandSpring.from.t = s.from; bandSpring.to.t = s.to; bandDirty = true;
}
addEventListener('resize', () => { bandW = 0; bandDirty = true; });
/* time band: the width is measured once (not every frame) and it only animates while moving */
tickers.add(dt => {
  if (state.view !== ID || !bandDirty) return; const band = $(`#v-${ID} .u-band`); if (!band || !band.offsetParent) return;
  bandSpring.from.step(dt); bandSpring.to.step(dt);
  if (!bandW) bandW = band.parentElement.clientWidth;
  band.style.transform = `translateX(${(bandSpring.from.v / 24 * bandW).toFixed(2)}px) scaleX(${Math.max(.002, (bandSpring.to.v - bandSpring.from.v) / 24).toFixed(4)})`;
  if (bandSpring.from.idle && bandSpring.to.idle) bandDirty = false;
});

/* ---------------- registration ---------------- */
function rerenderAll() {
  const v = $(`#v-${ID}`); if (!v) return;
  const ov = $('.tab[data-tab="overview"]', v); if (ov && $('.u-groups', ov) && S.scanned) { fillGroups(ov, true); updateOverviewCounts(); renderQueue(false); }
  refreshAppsFilter(true); refreshBadge(); updateOverviewCounts();
}
function bindCommon(el) {
  el.addEventListener('click', async e => {
    if (queueClicks(e)) return;
    if (e.target.closest('[data-all]')) { updateAll(); return; }
    const one = e.target.closest('[data-one]'); if (one) { if (enqueue([one.dataset.one])) { one.disabled = true; one.innerHTML = `<span class="u-spin"></span>${t('Queued')}`; SH.toast(t('{name} added to the queue.', { name: S.byId[one.dataset.one].name }), { action: { label: t('See the queue'), run: goOverview }, group: 'upd-add' }); } return; }
    const grp = e.target.closest('[data-grp]'); if (grp) { const ids = pendingIn(grp.dataset.grp).map(i => i.id); if (!ids.length) { SH.toast(t('That group is already up to date.')); return; } confirmRun(ids, CATS[grp.dataset.grp].u, () => { enqueue(ids); goOverview(); }); return; }
    const ga = e.target.closest('[data-gall]'); if (ga) { toggleGroup(ga); return; }
    const sel = e.target.closest('[data-sel]'); if (sel) { toggleSel(sel.dataset.sel, sel); return; }
    if (e.target.closest('[data-selclear]')) { [...S.sel].forEach(id => toggleSel(id)); return; }
    if (e.target.closest('[data-selgo]')) { const ids = [...S.sel]; confirmRun(ids, t('Update selected'), () => { [...S.sel].forEach(id => toggleSel(id)); enqueue(ids); goOverview(); }); return; }
    const nt = e.target.closest('[data-notes]'); if (nt) { toggleNotes(nt.dataset.notes, el); return; }
    const mn = e.target.closest('[data-menu]'); if (mn) { if (menuEl && menuEl.dataset.id === mn.dataset.menu) closeMenu(); else openMenu(mn, mn.dataset.menu); return; }
    const gt = e.target.closest('[data-gotab]'); if (gt) { ctxRef.setTab(gt.dataset.gotab); return; }
    const un = e.target.closest('[data-unhide]'); if (un) { const row = un.closest('.u-row'); await unhide(un.dataset.unhide); if (row && row.isConnected) collapseRow(row); return; }
    const url = e.target.closest('[data-url]'); if (url) { const r = await SH.call('open_url', url.dataset.url); if (r === undefined) SH.toast(t("The publisher's website would open here.")); return; }
    const rs = e.target.closest('[data-rescan]'); if (rs) { SH.sound('refresh'); const k = rs.dataset.rescan; if (k === 'apps') scanApps(true, 'user'); else if (k === 'win') scanWindows(true, 'user'); else scanDev(true, 'user'); return; }
    const pw = e.target.closest('.u-pw button'); if (pw && !pw.classList.contains('on')) { $$('.u-pw button', el).forEach(x => x.classList.toggle('on', x === pw)); SH.placeSeg($('.u-pw', el)); pauseWeeks = +pw.dataset.w;
      const b = $('[data-pause]', el); b.innerHTML = `${ic('pause')}${pauseLabel()}`; return; }
    if (e.target.closest('[data-pause]')) { if (await doPause(pauseWeeks, el)) SH.toast(t('Windows updates paused.'), { action: { label: t('Undo'), sound: 'undo', run: () => doPause(0, el) } }); return; }
    if (e.target.closest('[data-resume]')) { if (await doPause(0, el)) SH.toast(t('Updates resumed.')); return; }
    const wc = e.target.closest('[data-wcheck]'); if (wc) { if (wc.disabled || S.winScanning) return; SH.sound('scan_start'); scanWindows(true, 'user').then(() => { if (!S.winTold) SH.toast(S.errs.win ? ERR_MSG.win(S.errs.win) : S.items.some(i => i.kind === 'wu' || i.id === 'kb-cu') ? t('There are pending Windows updates.') : t('Windows is up to date.'), { kind: S.errs.win ? 'error' : 'scan_complete' }); }); }
  });
}
SH.module({
  id: ID, real: true,
  actions(el, ctx) {
    ctxRef = ctx;
    el.innerHTML = `<button class="btn sec" data-check>${ic('refresh')}${t('Check for updates')}</button><button class="btn pri" data-allh>${ic('download')}${t('Update all')}</button>`;
    el.addEventListener('click', async e => {
      const all = e.target.closest('[data-allh]');
      if (all) {
        if (all.disabled) return;
        if (!S.scanned || S.appsScanning) {        // never checked, or a search still running: (look and) wait for it, visibly
          const html = all.innerHTML; all.disabled = true; all.innerHTML = `<span class="u-spin"></span>${t('Looking for updates…')}`;
          try { await scanApps(false, 'user'); } finally { all.disabled = false; all.innerHTML = html; }
        }
        if (S.noWinget || S.errs.apps) { SH.toast(S.noWinget ? t("winget isn't available on this PC.") : ERR_MSG.apps(S.errs.apps), { kind: 'error' }); return; }
        updateAll(); return;
      }
      const c = e.target.closest('[data-check]');
      if (c) {
        if (c.disabled) return;
        const html = c.innerHTML; c.disabled = true; c.classList.add('u-busy'); c.innerHTML = `${ic('refresh')}${t('Checking…')}`;
        SH.sound('scan_start');  /* one start and one end for the programs and Windows checks together (the toast below) */
        const act = S.checkAct = SH.activity.start(ID, { key: 'check', label: t('Looking for updates…'), go: { tab: 'overview' } });
        for (const k of Object.keys(S.acts)) { S.acts[k].end({ quiet: true }); delete S.acts[k]; }  /* searches already running are now part of this check */
        try { await Promise.all([scanApps(true), scanWindows(true)]); } finally { c.disabled = false; c.classList.remove('u-busy'); c.innerHTML = html; S.checkAct = null; }
        const err = S.noWinget ? t("winget isn't available on this PC.") : S.errs.apps ? ERR_MSG.apps(S.errs.apps) : S.errs.win ? ERR_MSG.win(S.errs.win) : '';
        const msg = err || t('{n} pending updates.', { n: pending().filter(i => !i.optional).length });
        if (!act.end(err ? { ok: false, error: err } : { ok: true, summary: msg, kind: 'scan_complete' })) SH.toast(msg, { group: 'upd-check', kind: err ? 'error' : 'scan_complete' });
      }
    });
  },
  renderTab(tab, el) {
    const R = { overview: renderOverview, apps: renderApps, windows: renderWindows, store: renderStore, runtimes: renderRuntimes, dev: renderDev, schedule: renderSchedule }[tab];
    if (R) R(el);
    if (tab !== 'dev' && tab !== 'schedule') bindCommon(el);
  },
  enterTab(tab, el) {
    if (tab === 'windows' && el) setReboot(el);
    if (tab === 'overview') { renderQueue(false); updateOverviewCounts(); }
    if (tab === 'apps') refreshAppsFilter(false);
  },
  enter() { hydrate(); autoScan('apps'); },
  leave() { closeMenu(); },
});
/* light background check (winget only, read-only) so Home knows how many there are */
SH.on('boot', () => setTimeout(() => {
  if (!REAL) return; const p = (state.settings.pending || {}).apps;
  if (!p || Date.now() - p.at > 6 * 3600e3) scanApps(false, 'quiet');
}, 9000));
SH.actions.add([
  { t: t('See the update queue'), go: ID, tab: 'overview', ic: 'download' },
  { t: t('Update Python packages'), go: ID, tab: 'dev', ic: 'code' },
  { t: t('Pause Windows updates'), go: ID, tab: 'windows', ic: 'pause' },
  { t: t('Schedule automatic updates'), go: ID, tab: 'schedule', ic: 'calendar' },
  { t: t("See apps winget can't update"), go: ID, tab: 'apps', ic: 'package' },
]);
})();
