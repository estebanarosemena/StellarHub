/* StellarHub · Settings > Backups and restore. See docs/UI_CONTRACT.md.
   Windows restore points and System Protection (stellarhub/engine/backups.py), and StellarHub's own backups in one
   place: Super Optimizer (registry and services), Driver Updater and the Program Remover quarantine (read only here:
   restoring it happens in the Program Remover). Registered through SH.settingsSections, rendered by shell.js.
   It draws at once with skeletons and fills in when the engine jobs answer; outside the app it shows sample data. */
'use strict';
(() => {
const { $, $$, anim, EASE, ic, esc, fmtBytes } = SH;
const t = SH.t;
const LOCALE = (SH.i18n && SH.i18n.locale) || 'en-US';
let REAL = false; SH.apiReady.then(a => { REAL = !!a; });
const DAY = 86400;
const OLD_DAYS = 30;

/* ---------- sample data (browser and design tests) ---------- */
const NOW = Date.now() / 1000;
const SAMPLE = {
  status: { admin: true, systemDrive: 'C:', services: { VSS: 'manual', swprv: 'manual' }, policy: false, error: null,
    drives: [{ drive: 'C:', system: true, total: 1023e9, enabled: true, used: 3.4e9, max: 51.2e9, maxPct: 5 }, { drive: 'D:', system: false, total: 2000e9, enabled: false, used: null, max: null, maxPct: null }],
    points: [
      { seq: 31, desc: t('StellarHub: before installing drivers'), type: 10, t: NOW - 3600 * 5 },
      { seq: 30, desc: 'Windows Update', type: 7, t: NOW - DAY * 2.2 },
      { seq: 29, desc: t('StellarHub: Adobe Reader'), type: 1, t: NOW - DAY * 6 },
      { seq: 28, desc: t('Installed Microsoft Visual C++ 2015-2022 Redistributable (x64)'), type: 0, t: NOW - DAY * 13 },
      { seq: 27, desc: t('Automatic Restore Point'), type: 7, t: NOW - DAY * 21 },
    ] },
  own: {
    optimizer: [
      { id: 'opt-services|1', kind: 'opt-services', ts: NOW - DAY * 1, size: 109, count: 3, sample: ['DiagTrack', 'RetailDemo', 'WerSvc'], path: 'C:\\ProgramData\\StellarHub\\optimizer\\services\\1.json' },
      { id: 'opt-registry|1', kind: 'opt-registry', ts: NOW - DAY * 9, size: 6810, count: 14, sample: [], path: 'C:\\ProgramData\\StellarHub\\optimizer\\registry\\1' },
      { id: 'opt-registry|2', kind: 'opt-registry', ts: NOW - DAY * 44, size: 2210, count: 5, sample: [], path: 'C:\\ProgramData\\StellarHub\\optimizer\\registry\\2' },
    ],
    drivers: [{ id: 'driver|1', kind: 'driver', ts: NOW - DAY * 3, size: 1.9e9, count: 86, path: 'C:\\Users\\you\\Documents\\StellarHub\\Driver backups\\2026-11-15 1032' },
      { id: 'driver|2', kind: 'driver', ts: NOW - DAY * 70, size: 1.7e9, count: 81, path: 'C:\\Users\\you\\Documents\\StellarHub\\Driver backups\\2026-09-09 1810' }],
    quarantine: [{ id: 'quarantine|1', kind: 'quarantine', program: 'Adobe Acrobat Reader', ts: NOW - DAY * 6, size: 412e6, count: 37, restorable: true },
      { id: 'quarantine|2', kind: 'quarantine', program: 'CCleaner', ts: NOW - DAY * 12, size: 18e6, count: 9, restorable: false, restored: true }],
  },
};

/* ---------- state ---------- */
const cache = { status: null, own: null };
let root = null, busy = false, protectOpen = false, createOpen = false, pct = 10;
const showAll = {};
const live = () => root && root.isConnected;

/* ---------- formatting ---------- */
const fmtDate = ts => ts ? new Date(ts * 1000).toLocaleString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
const size = b => b == null ? '–' : fmtBytes(b);
const TYPE = { 0: [t('Program installed'), 'package'], 1: [t('Program removed'), 'trash'], 6: [t('Restore operation'), 'restore'], 7: [t('Automatic'), 'clock'],
  10: [t('Driver installed'), 'drivers'], 12: [t('Settings changed'), 'gear'], 13: [t('Cancelled operation'), 'x'] };
const typeOf = n => TYPE[n] || [t('Restore point'), 'restore'];
const REASON = {
  needs_admin: t('Creating a restore point needs administrator rights.'),
  protection_off: t('System Protection is turned off for the system drive, so Windows cannot create restore points.'),
  service_disabled: t('The Volume Shadow Copy service is disabled, and restore points depend on it.'),
  policy: t('Restore points are turned off by a policy on this PC.'),
  failed: t('Windows did not create a new restore point and gave no reason.'),
};
/* the little orbit that carries the state of System Protection */
const orb = st => {
  const moving = st === 'on' && (SH.state.settings.intensity || 'normal') !== 'min'; /* at minimum, nothing loops */
  return `<svg class="bk-orb ${st}" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22" class="o-ring"/><g transform="translate(24 24) rotate(-24)"><ellipse rx="20" ry="8" class="o-path"/><circle r="6.5" class="o-core"/>`
    + `<circle r="3" class="o-moon"${moving ? '><animateMotion dur="12s" repeatCount="indefinite" path="M20 0A20 8 0 1 1-20 0A20 8 0 1 1 20 0"/></circle>' : ' cx="20"/>'}</g></svg>`;
};
const skRows = n => `<div class="sk-rows">${Array.from({ length: n }, (_, i) => `<div class="sk-row" style="--dl:${i * 90}ms"><div class="sk a"></div><div class="sk b" style="--w:${46 - i * 6}%"></div><div class="sk c"></div></div>`).join('')}</div>`;

/* ---------- engine (sample data outside the app) ---------- */
const wait = ms => new Promise(r => setTimeout(r, ms));
/* sound: 'task' for what the user started here (runOp); the status reads stay silent */
function job(fn, args, onProgress, sound) {
  return SH.job('backups', fn, args || [], { sound, onProgress: m => { if (m.kind === 'progress' && onProgress) onProgress(m); } });
}
async function loadStatus() {
  await SH.apiReady;
  /* reading System Protection can take a while: followed from anywhere once it runs for a moment */
  const r = REAL ? await SH.activity.follow('backups', job('status'), { key: 'status', label: t('Reading the restore points') }).catch(e => ({ error: e.message, admin: SH.state.admin, drives: [], points: [] }))
    : (await wait(650), JSON.parse(JSON.stringify(SAMPLE.status)));
  cache.status = r || { error: t('the engine failed'), admin: SH.state.admin, drives: [], points: [] };
  if (live()) { paintHero(); paintPoints(); }
}
async function loadOwn() {
  await SH.apiReady;
  const r = REAL ? await job('own_backups').catch(() => null) : (await wait(900), JSON.parse(JSON.stringify(SAMPLE.own)));
  cache.own = r || { optimizer: [], drivers: [], quarantine: [] };
  if (live()) paintOwn();
}

/* ---------- confirmation inside the settings sheet (no confirm()) ---------- */
function ask(title, body, ok, danger = true) {
  return new Promise(res => {
    const host = $('#sheet'); const o = document.createElement('div'); o.className = 'bk-dq-o';
    o.innerHTML = `<div class="bk-dq-s"></div><div class="bk-dq" role="alertdialog" aria-modal="true"><h3>${esc(title)}</h3><p>${body}</p><div class="bk-dq-a"><button class="btn ghost" data-n>${t('Cancel')}</button><button class="btn ${danger ? 'danger' : 'pri'}" data-y>${esc(ok)}</button></div></div>`;
    host.appendChild(o);
    anim($('.bk-dq-s', o), [{ opacity: 0 }, { opacity: 1 }], { d: 200 });
    anim($('.bk-dq', o), [{ opacity: 0, transform: 'translate3d(0,12px,0) scale(.96)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 380, e: EASE.spring });
    const done = v => { document.removeEventListener('keydown', key, true); anim(o, [{ opacity: 1 }, { opacity: 0 }], { d: 160 }).finished.then(() => o.remove()).catch(() => o.remove()); res(v); };
    /* Esc cancels. The focus starts on Cancel, so Enter never deletes by accident. */
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); done(false); } };
    document.addEventListener('keydown', key, true);
    o.addEventListener('click', e => { if (e.target.closest('[data-y]')) done(true); else if (e.target.closest('[data-n]') || e.target.classList.contains('bk-dq-s')) done(false); });
    setTimeout(() => $('[data-n]', o).focus(), 30);
  });
}

/* ---------- System Protection (the card on top) ---------- */
function sysDrive() { const s = cache.status; return (s && (s.drives || []).find(d => d.system)) || null; }
function rangeHTML(d) {
  const tot = d && d.total;
  return `<div class="bk-space"><div class="bk-space-l"><span>${t('Space for restore points')}</span><b id="bkPctV">${t('{pct}% of the drive', { pct })}${tot ? ` · ${size(tot * pct / 100)}` : ''}</b></div>
    <input type="range" class="bk-rng" id="bkPct" min="2" max="30" step="1" value="${pct}" style="--p:${(pct - 2) / 28 * 100}%" aria-label="${t('Space for restore points')}">
    <div class="bk-space-h">${t('Windows deletes the oldest restore points when this space fills up. Between 5% and 10% is usually enough.')}</div></div>`;
}
function heroHTML() {
  const s = cache.status;
  if (!s) return `<div class="bk-hero-h">${orb('wait')}<div class="bk-hero-t"><div class="sk" style="height:14px;width:52%"></div><div class="sk" style="height:10px;width:78%;margin-top:9px;--dl:120ms"></div></div></div><div class="sk" style="height:6px;margin-top:16px;--dl:200ms"></div>`;
  const d = sysDrive() || { drive: s.systemDrive || 'C:' }; const L = d.drive;
  const off = Object.entries(s.services || {}).filter(([, v]) => v === 'disabled').map(([k]) => k);
  const rstrui = `<button class="btn ghost" data-tool="rstrui">${ic('external')}${t('Open System Restore')}</button>`;
  let st, title, text, body = '', acts;
  if (!s.admin) {
    st = 'wait'; title = t('Restore points need administrator mode');
    text = t('Windows only lets administrators see, create and delete restore points. The StellarHub backups below are available anyway.');
    acts = `<button class="btn pri" data-act="admin">${ic('shield')}${t('Turn on administrator mode')}</button>${rstrui}`;
  } else if (s.policy) {
    st = 'off'; title = t('Turned off by a policy'); text = REASON.policy + ' ' + t('Whoever manages this PC can turn it back on.'); acts = rstrui;
  } else if (off.length) {
    st = 'off'; title = t('The Volume Shadow Copy service is disabled');
    text = t('Restore points depend on it. In Services, set {names} to Manual and come back.', { names: off.join(', ') });
    acts = `<button class="btn sec" data-tool="services">${ic('sliders')}${t('Open Services')}</button><button class="btn ghost" data-bk="refresh">${ic('restore')}${t('Check again')}</button>`;
  } else if (d.enabled === false) {
    st = 'off'; title = t('System Protection is off for {drive}', { drive: L });
    text = t('Without it, Windows cannot create restore points, and StellarHub cannot make one before risky changes.');
    body = rangeHTML(d);
    acts = `<button class="btn pri" data-bk="protect">${ic('shield')}${t('Turn on protection for {drive}', { drive: L })}</button>${rstrui}`;
  } else {
    st = 'on'; title = t('System Protection is on for {drive}', { drive: L });
    const n = (s.points || []).length; const newest = n ? fmtDate(s.points[0].t) : '';
    text = n ? (n === 1 ? t('{n} restore point saved. The newest is from {date}.', { n, date: newest }) : t('{n} restore points saved. The newest is from {date}.', { n, date: newest }))
      : t('There are no restore points yet. Create one before a big change.');
    if (d.max) {
      const u = Math.min(1, (d.used || 0) / d.max);
      body = `<div class="bk-meter"><div class="bar"><span style="transform:scaleX(${Math.max(.01, u).toFixed(4)})"></span></div><div class="bk-meter-l"><span>${t('{used} used of {max}', { used: size(d.used || 0), max: size(d.max) })}</span><span>${d.maxPct != null ? t('{pct}% of the drive', { pct: SH.fmtInt(d.maxPct) }) : ''}</span></div></div>`;
    } else if (d.enabled) body = `<div class="bk-meter-l faint">${t('No space limit set.')}</div>`;
    if (protectOpen) body += rangeHTML(d);
    acts = `<button class="btn pri" data-bk="create">${ic('plus')}${t('Create a restore point')}</button>${rstrui}`
      + (protectOpen ? `<button class="btn sec" data-bk="resize">${ic('check')}${t('Save space')}</button>` : `<button class="btn ghost" data-bk="space">${ic('sliders')}${t('Change space')}</button>`);
  }
  const others = (s.drives || []).filter(x => !x.system);
  const drives = others.length && s.admin ? `<div class="bk-drives">${others.map(x => `<span><b>${esc(x.drive)}</b>${x.enabled ? `<i class="ok">${t('Protected')}</i>` : `<i>${t('Not protected')}</i>`}${x.enabled && x.max ? `<em>${t('{used} used of {max}', { used: size(x.used || 0), max: size(x.max) })}</em>` : ''}</span>`).join('')}</div>` : '';
  const create = createOpen && st === 'on' ? `<div class="bk-create"><label class="field">${ic('restore')}<input id="bkName" maxlength="100" placeholder="${esc(t('Name, for example: Before installing a game'))}" aria-label="${esc(t('Restore point name'))}"></label><button class="btn pri" data-bk="create-go">${t('Create')}</button><button class="btn ghost" data-bk="create-x">${t('Cancel')}</button></div>` : '';
  return `<div class="bk-hero-h">${orb(st)}<div class="bk-hero-t"><b>${esc(title)}</b><span>${esc(text)}</span></div></div>${body}${create}
    <div class="bk-prog" id="bkProg" hidden><div class="bar acc"><span style="transform:scaleX(0)"></span></div><span class="bk-prog-t"></span></div>
    <div class="bk-msg" id="bkMsg" hidden></div>
    <div class="bk-acts">${acts}</div>${drives}`;
}
function paintHero(flash) {
  const h = $('#bkHero', root); if (!h) return;
  h.innerHTML = heroHTML(); h.classList.toggle('loaded', !!cache.status);
  if (flash) anim(h, [{ opacity: .6, transform: 'scale(.99)' }, { opacity: 1, transform: 'none' }], { d: 320, e: EASE.spring });
  const n = $('#bkName', h); if (n) setTimeout(() => n.focus(), 40);
}
function progress(on, p, text) {
  const g = $('#bkProg', root); if (!g) return; g.hidden = !on; if (!on) return;
  if (p != null) $('.bar>span', g).style.transform = `scaleX(${Math.max(.04, Math.min(1, p)).toFixed(3)})`;
  if (text != null) $('.bk-prog-t', g).textContent = text;
}
function message(text, kind) {
  const m = $('#bkMsg', root); if (!m) return; m.hidden = !text; m.className = 'bk-msg' + (kind ? ' ' + kind : ''); m.textContent = text || '';
  if (text) anim(m, [{ opacity: 0, transform: 'translate3d(0,-4px,0)' }, { opacity: 1, transform: 'none' }], { d: 260, e: EASE.spring });
}
const lock = on => $$('[data-bk],[data-del],[data-own]', root).forEach(b => { b.disabled = on; });
/* elapsed time as m:ss */
const clock = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/* the bar sweeps instead of filling: for a step that gives no progress of its own (a restore point) */
function indet(on) { const g = $('#bkProg', root); if (!g) return; g.classList.toggle('indet', on); if (on) $('.bar>span', g).style.transform = ''; }
/* the button that started an operation: a small spinner (and a text, if the button has one) until it ends */
function btnBusy(b, txt) {
  if (!b || b.dataset.html != null) return;
  b.dataset.html = b.innerHTML; b.classList.add('bk-wait');
  b.innerHTML = `<span class="bk-spin" aria-hidden="true"></span>${txt ? esc(txt) : ''}`;
}
function btnFree(b) { if (!b || b.dataset.html == null || !b.isConnected) return; b.innerHTML = b.dataset.html; delete b.dataset.html; b.classList.remove('bk-wait'); }
/* one operation at a time, with the bar in the card; sample mode pretends.
   fn: a backups job name, or a function (onProgress) => promise for a job of another module.
   o.slow(seconds) → text: the long step is shown with the time so far and the bar sweeping, until the engine
   reports its last step (pct ≥ .9). o.btn: the button that started it. */
async function runOp(fn, args, sample, o = {}) {
  if (busy) return null; busy = true; lock(true); message('');
  /* followed from anywhere (SH.activity): a restore point can take minutes and the sheet may be closed meanwhile */
  const act = SH.activity.start('backups', { key: 'op', label: o.label || o.btnText || t('Working…') });
  btnBusy(o.btn, o.btnText);
  progress(true, .04, o.start || t('Starting…'));
  const t0 = Date.now(); let lastPct = 0, iv = null;
  if (o.slow) { indet(true); const tick = () => { if (lastPct < .9) progress(true, null, o.slow((Date.now() - t0) / 1000)); }; tick(); iv = setInterval(tick, 1000); }
  const onP = m => { lastPct = m.pct || 0; act.progress(m.pct > 0 ? m.pct : null, m.text || null); if (o.slow) { if (lastPct >= .9) { indet(false); progress(true, m.pct, m.text); } } else progress(true, m.pct, m.text); };
  let r;
  try {
    r = !REAL ? await (async () => { const n = o.slow ? 12 : 5; for (let i = 1; i <= n; i++) { await wait(260); act.progress(i / n); if (!o.slow) progress(true, i / n, o.start || t('Working…')); } return sample; })()
      : typeof fn === 'function' ? await fn(onP) : await job(fn, args, onP, 'task');
  } catch (e) { r = { ok: false, reason: 'failed', msg: e.message }; }
  finally {
    clearInterval(iv); busy = false;
    if (live()) { indet(false); progress(false); lock(false); btnFree(o.btn); }
  }
  /* success: each caller says it in its own toast; a failure is told here when the sheet is not in front */
  act.end(r && r.ok ? { ok: true, toast: false } : { ok: false, error: (r && (r.msg || REASON[r.reason])) || REASON.failed });
  return r || { ok: false, reason: 'failed' };
}

async function createPoint() {
  const name = (($('#bkName', root) || {}).value || '').trim();
  const r = await runOp('create_point', [name], { ok: true, reason: 'created', seq: 32 },
    { btn: $('[data-bk="create-go"]', root), btnText: t('Creating…'), label: t('Creating a restore point'), slow: s => t('Creating the restore point ({time}). This can take a few minutes.', { time: clock(s) }) });
  if (!r) return;
  if (r.ok) {
    createOpen = false; SH.toast(t('Restore point created.'), { kind: 'success' });
    SH.logActivity(t('Restore point created'), { sub: name || t('StellarHub, manual restore point'), ic: 'restore' });
    if (!REAL) SAMPLE.status.points.unshift({ seq: 32, desc: name || t('StellarHub, manual restore point'), type: 12, t: Date.now() / 1000 });
    if (live()) paintHero();
    await loadStatus();
  } else if (live()) { SH.sound('warning'); message(r.msg || REASON[r.reason] || REASON.failed, 'warn'); }
}
async function protect(resizeOnly, btn) {
  const d = sysDrive() || { drive: 'C:' };
  if ((REAL || SH.sampleNormal) && !SH.requireAdmin(t('to change System Protection.'), { resume: { action: 'backups.protection', args: { resize: !!resizeOnly, pct } } })) return;
  const r = await runOp('protect', [d.drive, pct], { ok: true, msg: t('System Protection is on for {drive}.', { drive: d.drive }) }, { btn });
  if (!r) return;
  if (r.ok) {
    protectOpen = false; SH.toast(r.msg || t('System Protection is on for {drive}.', { drive: d.drive }), { kind: 'success' });
    if (!resizeOnly) SH.logActivity(t('System Protection turned on'), { sub: d.drive, ic: 'shield' });
    if (!REAL) Object.assign(SAMPLE.status.drives[0], { enabled: true, max: (d.total || 0) * pct / 100, maxPct: pct, used: d.used || 0 });
    await loadStatus();
  } else if (live()) { SH.sound('warning'); message(r.msg || REASON[r.reason] || REASON.failed, 'warn'); }
}

/* ---------- restore points list ---------- */
function pointsHTML() {
  const s = cache.status;
  if (!s) return skRows(3);
  if (!s.admin) return `<div class="bk-empty">${ic('lock')}<span>${t('Turn on administrator mode to see them.')}</span></div>`;
  if (s.error) return `<div class="bk-empty warn">${ic('alert')}<span>${t('Windows did not list them: {msg}', { msg: esc(s.error) })}</span></div>`;
  const pts = s.points || [];
  if (!pts.length) return `<div class="bk-empty">${ic('restore')}<span>${t('No restore points yet.')}</span></div>`;
  return `<div class="bk-list">${pts.map(p => { const [lab, i] = typeOf(p.type); const ours = /^StellarHub\b/.test(p.desc || '');
    return `<div class="bk-row" data-seq="${p.seq}"><span class="ri">${ic(i)}</span><div class="rt"><b title="${esc(p.desc)}">${esc(p.desc || lab)}</b><span>${esc(fmtDate(p.t))} · ${esc(lab)}${ours ? ' · <i class="bk-ours">StellarHub</i>' : ''}</span></div>
      <button class="btn sm ghost bk-ib" data-del="${p.seq}" title="${t('Delete this restore point')}" aria-label="${t('Delete this restore point')}">${ic('trash')}</button></div>`; }).join('')}</div>`;
}
function paintPoints() {
  const el = $('#bkPoints', root); if (el) el.innerHTML = pointsHTML();
  const s = cache.status, c = $('#bkPtCount', root); if (c) c.textContent = s && s.admin && s.points && s.points.length ? SH.fmtInt(s.points.length) : '';
}
async function deletePoint(seq, btn) {
  const p = ((cache.status || {}).points || []).find(x => String(x.seq) === String(seq)); if (!p) return;
  if ((REAL || SH.sampleNormal) && !SH.requireAdmin(t('to delete restore points.'), { resume: { action: 'backups.deletePoint', args: { seq: String(p.seq) } } })) return;
  const ok = await ask(t('Delete this restore point?'), t('<b>{name}</b>, from {date}. Only this restore point is deleted; the others stay as they are. This cannot be undone.', { name: esc(p.desc || typeOf(p.type)[0]), date: esc(fmtDate(p.t)) }), t('Delete restore point'));
  if (!ok) return;
  SH.sound('delete');
  const r = await runOp('delete_point', [p.seq, p.shadow || null], { ok: true }, { btn });
  if (r && r.ok) {
    SH.toast(t('Restore point deleted.')); if (!REAL) SAMPLE.status.points = SAMPLE.status.points.filter(x => x.seq !== p.seq);
    const row = live() && $(`.bk-row[data-seq="${p.seq}"]`, root);
    if (row) await anim(row, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate3d(16px,0,0)' }], { d: 220, e: EASE.io }).finished.catch(() => {});
    await loadStatus();
  } else if (r && live()) { SH.sound('error'); message(r.msg || REASON.failed, 'warn'); }
}

/* ---------- StellarHub's own backups ---------- */
const GROUPS = [
  ['optimizer', t('Super Optimizer'), 'optimizer', t('Registry entries and service settings saved before each change.')],
  ['drivers', t('Driver Updater'), 'drivers', t('Copies of your manufacturer drivers.')],
  ['quarantine', t('Program Remover quarantine'), 'remover', t('Leftovers removed with programs, kept so you can put them back.')],
];
function itemText(b) {
  const n = b.count || 0;
  if (b.kind === 'opt-registry') return [t('Registry cleanup'), n === 1 ? t('{n} registry entry', { n }) : t('{n} registry entries', { n })];
  if (b.kind === 'opt-services') {
    const names = (b.sample || []).join(', ') + (n > (b.sample || []).length ? '…' : '');
    return [t('Service changes'), !names ? (n === 1 ? t('{n} service', { n }) : t('{n} services', { n })) : n === 1 ? t('{n} service: {names}', { n, names }) : t('{n} services: {names}', { n, names })];
  }
  if (b.kind === 'opt-other') return [t('Super Optimizer backup'), b.group || ''];
  if (b.kind === 'driver') return [t('Driver backup'), n === 1 ? t('{n} driver', { n }) : t('{n} drivers', { n })];
  return [b.program || t('Program'), (n === 1 ? t('{n} item', { n }) : t('{n} items', { n })) + (b.restored ? ' · ' + t('restored') : '')];
}
function itemHTML(b) {
  const [ttl, sub] = itemText(b); const q = b.kind === 'quarantine'; const undo = b.kind === 'opt-registry' || b.kind === 'opt-services';
  const btn = (k, i, tip) => `<button class="btn sm ghost bk-ib" data-own="${k}" title="${tip}" aria-label="${tip}">${ic(i)}</button>`;
  return `<div class="bk-row" data-id="${esc(b.id)}"><div class="rt"><b>${esc(ttl)}</b><span title="${esc(sub)}">${esc(fmtDate(b.ts))} · ${esc(sub)}</span></div><span class="bk-sz">${size(b.size)}</span>
    <span class="bk-ra">${undo ? btn('undo', 'restore', t('Undo these changes')) : ''}${btn('open', 'folder', t('Open folder'))}${q ? '' : btn('del', 'trash', t('Send to the Recycle Bin'))}</span></div>`;
}
const isOld = b => b.ts && b.ts < Date.now() / 1000 - OLD_DAYS * DAY;
function ownHTML() {
  const o = cache.own;
  if (!o) return skRows(4);
  const all = GROUPS.map(([k]) => o[k] || []).flat();
  const total = all.reduce((a, b) => a + (b.size || 0), 0);
  const head = `<div class="bk-sum">${all.length ? (all.length === 1 ? t('{n} backup, {size} in total.', { n: 1, size: size(total) }) : t('{n} backups, {size} in total.', { n: SH.fmtInt(all.length), size: size(total) })) : t('StellarHub has not saved any backups yet.')}</div>`;
  return head + GROUPS.map(([k, name, i, desc]) => {
    const items = o[k] || []; const old = k === 'quarantine' ? [] : items.filter(isOld);
    const shown = showAll[k] ? items : items.slice(0, 3);
    const gsize = items.reduce((a, b) => a + (b.size || 0), 0);
    const side = k === 'quarantine' ? `<button class="btn sm sec" data-bk="remover">${ic('restore')}${t('Restore in Program Remover')}</button>`
      : old.length ? `<button class="btn sm ghost" data-bk="old" data-g="${k}">${ic('trash')}${t('Delete old ones ({n})', { n: old.length })}</button>` : '';
    return `<div class="bk-grp" data-g="${k}"><div class="bk-gh"><span class="bk-gi">${ic(i)}</span><div class="rt"><b>${esc(name)}</b><span>${items.length ? `${items.length === 1 ? t('{n} backup', { n: 1 }) : t('{n} backups', { n: items.length })} · ${size(gsize)}` : esc(desc)}</span></div>${side}</div>
      ${items.length ? `<div class="bk-list">${shown.map(itemHTML).join('')}</div>${items.length > shown.length ? `<button class="bk-more" data-bk="more" data-g="${k}">${t('Show {n} more', { n: items.length - shown.length })}</button>` : ''}` : ''}</div>`;
  }).join('');
}
function paintOwn() { const el = $('#bkOwn', root); if (el) el.innerHTML = ownHTML(); }
function findOwn(id) { const o = cache.own || {}; return [...(o.optimizer || []), ...(o.drivers || []), ...(o.quarantine || [])].find(b => b.id === id); }
async function deleteOwn(list, title, btn) {
  if (!list.length || busy) return;
  const tot = list.reduce((a, b) => a + (b.size || 0), 0);
  const body = list.length === 1 ? t('<b>{name}</b>, from {date} ({size}), goes to the Recycle Bin. You can recover it from there.', { name: esc(itemText(list[0])[0]), date: esc(fmtDate(list[0].ts)), size: size(tot) })
    : t('{n} backups older than {days} days ({size} in total) go to the Recycle Bin. You can recover them from there.', { n: list.length, days: OLD_DAYS, size: size(tot) });
  if (!await ask(title, body, t('Move to the Recycle Bin'))) return;
  SH.sound('delete');
  const ids = list.map(b => b.id);
  /* a driver backup can take a while (it is large): the bar in the card follows each folder, the button spins */
  const r = await runOp('delete_own', [ids], { ok: true, deleted: ids, failed: [] },
    { btn, btnText: btn && btn.dataset.bk === 'old' ? t('Moving to the Recycle Bin…') : '', start: t('Moving to the Recycle Bin…') });
  if (!r) return;
  const n = (r.deleted || []).length;
  if (!REAL) ['optimizer', 'drivers'].forEach(k => { SAMPLE.own[k] = SAMPLE.own[k].filter(b => !ids.includes(b.id)); });
  SH.toast(r.ok ? (n === 1 ? t('Backup moved to the Recycle Bin.') : t('{n} backups moved to the Recycle Bin.', { n })) : t('Some backups could not be deleted.'), r.ok ? {} : { kind: 'warning' });
  await loadOwn();
}
async function undoOptimizer(b, btn) {
  if (busy) return;
  const svc = b.kind === 'opt-services';
  const again = svc ? { action: 'backups.undo', args: { id: b.id } } : undefined;
  if ((REAL || SH.sampleNormal) && svc && !SH.requireAdmin(t('to change services.'), { resume: again })) return;
  const ok = await ask(svc ? t('Put these services back?') : t('Put these registry entries back?'),
    svc ? t('The services saved on {date} go back to how they were before Super Optimizer changed them.', { date: esc(fmtDate(b.ts)) })
      : t('The registry entries Super Optimizer removed on {date} are imported again from their copy.', { date: esc(fmtDate(b.ts)) }), t('Put them back'), false);
  if (!ok) return;
  SH.sound('undo');
  const bid = b.id.split('|')[1];
  /* about a second per service: the bar in the card says which one is being put back */
  const r = await runOp(onP => SH.job('optimizer', svc ? 'services_undo_job' : 'registry_undo_job', [bid], { onProgress: m => { if (m.kind === 'progress') onP(m); } }), [], { ok: true },
    { btn, start: svc ? t('Putting the services back…') : t('Putting the registry entries back…') });
  if (!r) return;
  if (r.needAdmin) { SH.requireAdmin(svc ? t('to change services.') : t('to make this change in Windows.'), { resume: again }); return; }
  SH.toast(r && r.ok ? t('Changes undone.') : t('It did not work: {msg}', { msg: (r && r.msg) || t('Windows did not accept some of them.') }), r && r.ok ? {} : { kind: 'error' });
}

/* ---------- after the administrator relaunch (js/admin-resume.js) ----------
   Settings > Backups and restore opens again (the ticket's place); each action waits for the section to read the PC,
   finds what it acts on as it is now and clicks the same button, so its confirmation comes up again. */
const settled = () => live() && cache.status && !busy;
SH.resume.register('backups.protection', async (a, r) => {
  const n = r.num(a.pct, 2, 30); if (n == null || typeof a.resize !== 'boolean') return false;
  if (!await r.until(settled, 20000)) return false;
  const d = sysDrive(); if (!d || !cache.status.admin || !!d.enabled !== a.resize) return false;
  pct = Math.round(n);
  if (a.resize) { protectOpen = true; createOpen = false; }
  paintHero(true);
  const b = await r.until(() => $(`[data-bk="${a.resize ? 'resize' : 'protect'}"]`, root), 3000); if (!b) return false;
  b.click(); return true;
});
SH.resume.register('backups.deletePoint', async (a, r) => {
  const seq = r.str(a.seq, 12); if (!/^\d{1,12}$/.test(seq)) return false;
  if (!await r.until(() => settled() && cache.status.admin && $('#bkPoints .bk-list', root), 20000)) return false;
  const b = $$('#bkPoints [data-del]', root).find(x => x.dataset.del === seq); if (!b) return false;
  b.scrollIntoView({ block: 'center' }); b.click(); return true;
});
SH.resume.register('backups.undo', async (a, r) => {
  const id = r.str(a.id, 300); if (!id) return false;
  if (!await r.until(() => settled() && cache.own, 20000)) return false;
  const bk = findOwn(id); if (!bk || bk.kind !== 'opt-services') return false;
  const row = $$('[data-id]', root).find(x => x.dataset.id === id), b = row && $('[data-own="undo"]', row); if (!b) return false;
  b.scrollIntoView({ block: 'center' }); b.click(); return true;
});

/* ---------- the section ---------- */
SH.settingsSections.backups = {
  html() {
    return `<h3>${t('Backups and restore')}</h3><p>${t('Restore points take Windows back to an earlier moment. StellarHub also keeps its own copies before it changes anything.')}</p>
      <div class="pan bk-hero${cache.status ? ' loaded' : ''}" id="bkHero">${heroHTML()}</div>
      <div class="set"><div class="lbl"><div>${t('Restore points')}<em class="bk-count" id="bkPtCount"></em><span>${t('Newest first. Deleting one leaves the others as they are.')}</span></div><button class="btn sm ghost" data-bk="refresh">${ic('restore')}${t('Refresh')}</button></div>
        <div id="bkPoints">${pointsHTML()}</div></div>
      <div class="set"><div class="lbl"><div>${t('StellarHub backups')}<span>${t('What Super Optimizer, Driver Updater and Program Remover save before they change something.')}</span></div></div>
        <div id="bkOwn">${ownHTML()}</div></div>
      <div class="set inline"><div class="lbl"><div>${t('Settings backup')}<span>${t('Export your StellarHub settings to a file, or import them, from Data.')}</span></div></div><div class="bk-acts tight"><button class="btn sec" data-act="export">${ic('upload')}${t('Export')}</button><button class="btn ghost" data-sec="data">${ic('folder')}${t('Open Data')}</button></div></div>`;
  },
  mount(el) {
    root = el; createOpen = false; busy = false;
    const d = sysDrive(); if (d && d.maxPct) pct = Math.max(2, Math.min(30, Math.round(d.maxPct)));
    paintPoints();
    loadStatus(); loadOwn();
    el.addEventListener('input', e => {
      const r = e.target.closest('#bkPct'); if (!r) return;
      pct = +r.value; r.style.setProperty('--p', (pct - 2) / 28 * 100 + '%');
      const dd = sysDrive(); const v = $('#bkPctV', el); if (v) v.textContent = t('{pct}% of the drive', { pct }) + (dd && dd.total ? ` · ${size(dd.total * pct / 100)}` : '');
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'bkName') { e.preventDefault(); createPoint(); } });
    el.addEventListener('click', async e => {
      const del = e.target.closest('[data-del]'); if (del) { if (!busy) deletePoint(del.dataset.del, del); return; }
      const own = e.target.closest('[data-own]');
      if (own) {
        const b = findOwn(own.closest('[data-id]').dataset.id); if (!b || busy) return;
        if (own.dataset.own === 'open') {
          const ok = REAL ? await SH.engine('backups', 'open_path', b.path).catch(() => false) : undefined;
          if (ok === undefined) SH.toast(t('This only works inside the app.'), { kind: 'unavailable' }); else if (!ok) SH.toast(t('That folder no longer exists.'), { kind: 'error' });
        } else if (own.dataset.own === 'del') deleteOwn([b], t('Delete this backup?'), own);
        else if (own.dataset.own === 'undo') undoOptimizer(b, own);
        return;
      }
      const a = e.target.closest('[data-bk]'); if (!a || busy) return;
      const k = a.dataset.bk;
      if (k === 'refresh') { SH.sound('refresh'); cache.status = null; cache.own = null; paintHero(); paintPoints(); paintOwn(); loadStatus(); loadOwn(); }
      else if (k === 'create') { createOpen = true; protectOpen = false; paintHero(); }
      else if (k === 'create-x') { createOpen = false; paintHero(); }
      else if (k === 'create-go') createPoint();
      else if (k === 'space') { protectOpen = true; createOpen = false; paintHero(true); }
      else if (k === 'resize') protect(true, a);
      else if (k === 'protect') protect(false, a);
      else if (k === 'more') { showAll[a.dataset.g] = true; paintOwn(); }
      else if (k === 'old') deleteOwn(((cache.own || {})[a.dataset.g] || []).filter(isOld), t('Delete old backups?'), a);
      else if (k === 'remover') { const x = $('#sheet [data-close]'); if (x) x.click(); SH.go('remover', { tab: 'quarantine' }); }
    });
  },
};

/* design tests change the sample data here (e.g. sample.status.admin = false) before opening the section */
SH.settingsSections.backups.sample = SAMPLE;

SH.actions.add([
  { t: t('Create a restore point'), go: 'settings', section: 'backups', ic: 'restore' },
  { t: t('See StellarHub backups'), go: 'settings', section: 'backups', ic: 'folder' },
]);
})();
