/* StellarHub · Home. A full-width header and three columns: live status, components (Mosaic or 3D) and
   what is pending. It renders at startup, once the real PC data (SH.PC) is loaded. */
'use strict';
(() => {
const { $, $$, state, Spring, EASE, anim, tickers, ic, PC, registry, motion, esc } = SH;
const home = $('#v-home');
const chev = ic('chev');
const T = SH.tele, t = SH.t;
const dash = '—';
const VITALS = [
  { id: 'cpu', ic: 'cpu', n: t('Processor'), val: v => [T.fmt('cpu'), '%'], frac: v => (v.cpu ?? 0) / 100, hot: v => (v.cpuTemp ?? 0) > 90, comp: 'cpu' },
  { id: 'gpu', ic: 'gpu', n: t('Graphics'), val: v => [T.fmt('gpu'), '%'], frac: v => (v.gpu ?? 0) / 100, hot: v => (v.gpuTemp ?? 0) > 85, comp: 'gpu', need: 'gpu' },
  { id: 'gtemp', ic: 'temp', n: t('GPU temperature'), val: v => [T.fmt('gpuTemp'), '°C'], frac: v => ((v.gpuTemp ?? 25) - 25) / 75, hot: v => (v.gpuTemp ?? 0) > 85, comp: 'gpu', need: 'gpu' },
  { id: 'ram', ic: 'ram', n: t('Memory'), val: v => [T.fmt('ram', SH.fmt1), t('of {n} GB', { n: Math.round(v.ramTotal || 0) })], frac: v => (v.ram ?? 0) / (v.ramTotal || 1), hot: v => (v.ram ?? 0) / (v.ramTotal || 1) > .92, comp: 'ram' },
  { id: 'vram', ic: 'layers', n: t('Video memory'), val: v => [T.fmt('vram', SH.fmt1), t('of {n} GB', { n: v.vramTotal || '–' })], frac: v => (v.vram ?? 0) / (v.vramTotal || 8), hot: () => false, comp: 'gpu', need: 'gpu' },
  { id: 'disk', ic: 'ssd', n: t('Drive C:'), val: v => [T.fmt('diskUsed'), t('of {n} GB', { n: v.diskTotal || '–' })], frac: v => (v.diskUsed ?? 0) / (v.diskTotal || 1), hot: v => (v.diskUsed ?? 0) / (v.diskTotal || 1) > .92, comp: 'ssd' },
  { id: 'net', ic: 'wifi', n: t('Network'), val: v => [T.fmt('down', SH.fmt1), t('Mb/s down')], frac: v => Math.min(1, (v.down ?? 0) / 200), hot: () => false, comp: 'wifi' },
  { id: 'bat', ic: 'battery', n: t('Battery'), val: v => [T.fmt('battery'), v.charging ? t('% charging') : '%'], frac: v => (v.battery ?? 0) / 100, hot: v => v.battery !== null && v.battery < 15 && !v.charging, comp: 'battery', need: 'battery' },
];
const VARIANT_IC = { bento: 'grid', model3d: 'cube' };
const ago = ts => { const s = (Date.now() - ts) / 1000; if (s < 90) return t('just now'); if (s < 3600) return t('{n} min ago', { n: Math.round(s / 60) }); if (s < 86400) return t('{n} h ago', { n: Math.round(s / 3600) }); const d = Math.round(s / 86400); return d === 1 ? t('yesterday') : t('{n} days ago', { n: d }); };

const subLine = () => PC.code ? t('{type}, model {code}. {os}.', { type: esc(PC.typeName), code: esc(PC.code), os: esc(PC.os) }) : `${esc(PC.typeName)}. ${esc(PC.os)}.`;

let rows = [], built = false;
function render() {
  const hasGpu = PC.components.some(c => c.id === 'gpu'), hasBat = PC.components.some(c => c.id === 'battery');
  const vit = VITALS.filter(x => (x.need !== 'gpu' || hasGpu) && (x.need !== 'battery' || hasBat));
  home.innerHTML = `<div class="home-grid">
  <header class="h-head" data-intro>
    <div class="h-id"><div class="model" id="hModel">${esc(PC.model)}</div><div class="sub">${subLine()}</div></div>
    <div class="facts">
      <div><b data-count="${PC.facts.drivers ?? ''}">${PC.facts.drivers == null ? dash : 0}</b><span>${t('drivers')}</span></div>
      <div><b data-count="${PC.facts.programs ?? ''}">${PC.facts.programs == null ? dash : 0}</b><span>${t('programs')}</span></div>
      <div><b data-count="${PC.facts.freeC ?? ''}">0</b><span>${t('GB free on C:')}</span></div>
    </div>
    <div class="h-quick"><button class="btn sec wbtn" data-widget-btn title="${t('Always-on-top widget')}"><span class="wdot"></span><span class="lbl">${t('Widget')}</span></button></div>
  </header>

  <aside class="h-col">
    <div class="pan vitals" data-intro><h4>${t('Right now')} <em>${T.simulated ? t('sample data') : t('live')}</em></h4>
      <div class="vit-list">${vit.map(x => `<button class="vit" data-comp="${x.comp}" data-vit="${x.id}"><span class="vi">${ic(x.id === 'net' ? (SH.compIcon(PC.components.find(c => c.id === 'wifi')) === 'ethernet' ? 'ethernet' : 'wifi') : x.ic)}</span><span class="vn">${x.n}</span><span class="vv">${dash}</span><span class="bar"><span></span></span></button>`).join('')}</div>
    </div>
  </aside>

  <section class="h-center">
    <div class="stage-head" data-intro><h4>${t('Components')}</h4><span class="chip">${PC.components.length}</span><div class="vtoggle" id="vswitch"></div></div>
    <div class="stage" id="stage" data-nofade></div>
  </section>

  <aside class="h-col">
    <div class="pan pending" data-intro><h4>${t('To review')}</h4><div id="actRows" class="act-rows"></div><div id="pendList"></div></div>
    <div class="pan healthp" data-intro data-go="monitor" data-tab="health" role="button" tabindex="0" aria-label="${t('System health')}">
      <div class="hh">
        <svg class="g" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="none" style="stroke:var(--raise2)" stroke-width="4"/><circle id="healthArc" cx="20" cy="20" r="16" fill="none" style="stroke:var(--accent2)" stroke-width="4" stroke-linecap="round" stroke-dasharray="100.5" stroke-dashoffset="100.5"/></svg>
        <div><b id="hTitle">${t('Checking the system…')}</b><span id="hSub">${t('One moment')}</span></div>
      </div>
      <div class="hs">
        <div>${t('Temperatures')}<b id="hTemp">${dash}</b></div>
        <div>${t('Uptime')}<b id="hUp">${dash}</b></div>
        <div>${t('Antivirus')}<b id="hAv">${dash}</b></div>
        <div>${t('Restore point')}<b id="hRp">${dash}</b></div>
      </div>
    </div>
    <div class="pan nextp" data-intro>
      <div class="nx-head"><div class="seg" id="nxSeg"><span class="ind"></span><button data-v="next" class="on">${t('Coming up')}</button><button data-v="recent">${t('Recently')}</button></div></div>
      <div class="nx-pages"><div class="nx-page on" data-p="next" id="nxNext"></div><div class="nx-page" data-p="recent" id="nxRecent"></div></div>
    </div>
  </aside>
</div>`;
  rows = vit.map(x => { const el = $(`.vit[data-vit="${x.id}"]`); return { x, el, s: new Spring(0, 90, 16), vv: $('.vv', el), bar: $('.bar>span', el) }; });
  renderPending(); renderActs(); renderNext(); renderRecent(); bindNx();
  if (SH.syncWidgetButtons) SH.syncWidgetButtons();
  built = true;
}

/* the model name always on one line */
/* measured once at 34 px and scaled (the text width is linear in the size), then checked once more: the old
   one-pixel-at-a-time loop forced a layout of the whole page on every step (up to 14 of them, 30-50 ms) */
const fit = () => {
  const el = $('#hModel'); if (!el) return;
  const room = innerWidth * .34; el.style.fontSize = '34px'; const w = el.scrollWidth; let s = 34;
  if (w > room) { s = Math.max(20, Math.floor(34 * room / w)); el.style.fontSize = s + 'px'; if (s > 20 && el.scrollWidth > room) el.style.fontSize = (s - 1) + 'px'; }
};
let fitRaf = 0;
addEventListener('resize', () => { if (!fitRaf) fitRaf = requestAnimationFrame(() => { fitRaf = 0; if (state.view === 'home') fit(); }); }); /* once per frame while the window is dragged, and only when Home is shown (it fits again when it returns) */

/* ---------- live status ---------- */
const fmtUp = SH.fmtUptime;
function readVitals() {
  if (!built) return; const v = T.v;
  /* a move under 1 % of the bar is invisible but would keep its spring, and a repaint every frame, running for a second;
     the number is only rewritten when it changed */
  rows.forEach(r => {
    const f = Math.max(0, Math.min(1, r.x.frac(v) || 0)); if (Math.abs(f - r.s.t) > .01) r.s.t = f;
    const [a, b] = r.x.val(v), h = a === dash ? dash : `${a}<small>${b}</small>`; if (h !== r.h) { r.h = h; r.vv.innerHTML = h; }
    r.el.classList.toggle('hot', !!r.x.hot(v));
  });
  if (T.has('uptime')) $('#hUp').textContent = fmtUp(v.uptime);
  const temps = [T.has('cpuTemp') ? `CPU ${Math.round(v.cpuTemp)} °C` : null, T.has('gpuTemp') ? `GPU ${Math.round(v.gpuTemp)} °C` : null].filter(Boolean);
  const hot = (v.cpuTemp ?? 0) > 90 || (v.gpuTemp ?? 0) > 85;
  $('#hTemp').textContent = temps.length ? (hot ? t('high, {temp}', { temp: temps[0] }) : t('normal, {temp}', { temp: temps[0] })) : dash;
}
SH.tele.on(() => { if (state.view === 'home') readVitals(); });
tickers.add(dt => {
  if (!built || (state.view !== 'home' && !SH.homeAnimating)) return;
  rows.forEach(r => { if (r.s.idle && r.drawn) return; r.s.step(dt); if (Math.abs(r.s.v - r.s.t) < .002 && Math.abs(r.s.vel) < .06) r.s.set(r.s.t); /* the last half pixel of the tail is not worth a repaint per frame */ const tf = `scaleX(${r.s.v.toFixed(3)})`; if (tf !== r.tf) { r.tf = tf; r.bar.style.transform = tf; } r.drawn = true; });
});
/* the health card is a link to Live Monitor > Health: Enter or Space opens it like a click */
home.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.healthp[data-go]')) { e.preventDefault(); e.target.click(); } });
home.addEventListener('click', e => {
  const v = e.target.closest('.vit[data-comp]'); if (v) { SH.openComponent(v.dataset.comp, v); return; }
  const a = e.target.closest('[data-act-go]'); if (a) { SH.activity.open(a.dataset.actGo, { tab: a.dataset.tab || '' }); return; }
  const p = e.target.closest('[data-go]'); if (p) SH.go(p.dataset.go, { tab: p.dataset.tab });
});

/* ---------- to review: modules publish these when they check (SH.setPending) ---------- */
const PEND = [
  { k: 'drivers', go: 'drivers', tab: 'updates', one: t('driver update available'), many: t('driver updates available'), none: t('Drivers up to date'), unk: t('Check for new drivers') },
  { k: 'apps', go: 'updater', tab: 'overview', one: t('program to update'), many: t('programs to update'), none: t('Programs up to date'), unk: t('Check for updates'), alt: true },
  { k: 'junk', go: 'optimizer', tab: 'clean', unit: SH.unit('GB'), one: t('that can be freed'), many: t('that can be freed'), none: t('Nothing important to clean'), unk: t('Scan what can be cleaned') },
];
function renderPending() {
  const box = $('#pendList'); if (!box) return; const p = state.settings.pending || {};
  box.innerHTML = PEND.map(x => {
    const e = p[x.k]; const n = e ? e.n : null;
    if (n == null) return `<button class="pend unk" data-go="${x.go}" data-tab="${x.tab}"><b>${ic('search')}</b><span>${x.unk}<small>${t('not checked yet')}</small></span>${chev}</button>`;
    if (!n) return `<button class="pend ok" data-go="${x.go}" data-tab="${x.tab}"><b>${ic('check')}</b><span>${x.none}<small>${ago(e.at)}</small></span>${chev}</button>`;
    const num = x.unit ? `${Math.round(n * 10) % 10 ? SH.fmt1(n) : SH.fmtInt(n)}<small> ${x.unit}</small>` : n;
    return `<button class="pend${x.alt ? ' alt' : ''}" data-go="${x.go}" data-tab="${x.tab}"><b>${num}</b><span>${n === 1 ? x.one : x.many}<small>${t('checked {ago}', { ago: ago(e.at) })}</small></span>${chev}</button>`;
  }).join('');
}
SH.on('pending', () => { renderPending(); if (state.view === 'home') $$('#pendList .pend').forEach((el, i) => anim(el, [{ opacity: .4 }, { opacity: 1 }], { d: 400, delay: i * 40, keep: true })); });

/* ---------- running now: what the modules are doing for the user (SH.activity), live, and what finished while the
   user was elsewhere, until it is looked at. The rows are rebuilt only when the set changes; progress only patches
   the text and the ring (stroke-dashoffset). At most three, the newest first. ---------- */
const ACT_MAX = 3, ACT_RING = '<svg class="ring" viewBox="0 0 36 36"><circle class="tr" cx="18" cy="18" r="16"/><circle class="arc" cx="18" cy="18" r="16" pathLength="100" transform="rotate(-90 18 18)"/></svg>';
function actItems() {
  const run = SH.activity.list().filter(a => a.user);
  const fin = SH.activity.doneAll().filter(d => !run.some(a => a.mod === d.mod));
  return [...run.map(a => ({ k: 'r' + a.id, a })), ...fin.map(d => ({ k: `d${d.mod}${d.at}`, d }))].slice(0, ACT_MAX);
}
function actRow(x) {
  if (x.a) {
    const a = x.a, inf = SH.activity.info(a.mod), p = SH.activity.pct(a);
    return `<button class="pend act run${a.pct == null ? ' ind' : ''}" data-k="${x.k}" data-act-go="${a.mod}" style="--p:${a.pct == null ? 0 : a.pct.toFixed(3)}"><b class="ar">${ACT_RING}${ic(inf.icon)}</b>`
      + `<span><em>${esc(inf.name)}</em><small><i class="at">${esc(a.text || a.label)}</i><i class="ap">${p}</i></small></span>${chev}</button>`;
  }
  const d = x.d, inf = SH.activity.info(d.mod);
  const sub = d.ok ? (d.summary || t('Finished')) : (d.error || t('Needs a look'));
  return `<button class="pend act ${d.ok ? 'ok' : 'err'}" data-k="${x.k}" data-act-go="${d.mod}" data-tab="${esc(d.go && d.go.tab || '')}"><b class="ar">${ic(inf.icon)}<i class="ab">${ic(d.ok ? 'check' : 'bang')}</i></b>`
    + `<span><em>${esc(d.ok ? t('{name} finished', { name: inf.name }) : t('{name} did not finish', { name: inf.name }))}</em><small><i class="at">${esc(sub)}</i><i class="ap">${ago(d.at)}</i></small></span>${chev}</button>`;
}
function renderActs() {
  const box = $('#actRows'); if (!box) return;
  if (state.view !== 'home' && !SH.homeAnimating) return;   /* drawn again when Home comes back */
  const items = actItems(), sig = items.map(x => x.k).join();
  if (sig !== box.dataset.sig) {
    const had = new Set((box.dataset.sig || '').split(','));
    box.dataset.sig = sig; box.innerHTML = items.map(actRow).join('');
    $$('.pend', box).forEach((el, i) => { if (!had.has(el.dataset.k)) anim(el, [{ opacity: 0, transform: 'translate3d(0,-6px,0)' }, { opacity: 1, transform: 'none' }], { d: 420, delay: i * 40, e: EASE.spring }); });
    return;
  }
  for (const x of items) {
    if (!x.a) continue;
    const el = box.querySelector(`[data-k="${x.k}"]`); if (!el) continue;
    const a = x.a, txt = a.text || a.label, p = SH.activity.pct(a), at = $('.at', el), ap = $('.ap', el);
    if (at.textContent !== txt) at.textContent = txt;
    if (ap.textContent !== p) ap.textContent = p;
    el.classList.toggle('ind', a.pct == null); el.style.setProperty('--p', a.pct == null ? 0 : a.pct.toFixed(3));
  }
}
SH.on('activity', renderActs);

/* ---------- real health ---------- */
async function loadHealth() {
  let h; try { h = await SH.engine('system', 'health'); } catch { h = null; }
  if (!h) { $('#hTitle').textContent = t('System health'); $('#hSub').textContent = t('Only checked inside the app'); return; }
  const errs = h.deviceErrors || 0; const av = (h.antivirus || []).find(a => !/defender/i.test(a)) || (h.defender ? t('Defender on') : (h.antivirus || [])[0]);
  const ok = errs === 0 && (av || h.defender);
  $('#hTitle').textContent = ok ? t('System health: good') : errs ? t('System health: needs a look') : t('System health: no antivirus');
  $('#hSub').textContent = errs ? (errs > 1 ? t('{n} devices with errors', { n: errs }) : t('{n} device with errors', { n: errs })) : t('No device errors');
  $('#hSub').title = (h.errorNames || []).join('\n');
  $('#hAv').textContent = av || t('None active');
  $('#hRp').textContent = h.restore ? ago(Date.parse(h.restore)) : (h.restoreAccess ? t('none') : t('needs administrator'));
  const pct = ok ? .92 : errs ? .62 : .4; anim($('#healthArc'), [{ strokeDashoffset: 100.5 }, { strokeDashoffset: 100.5 * (1 - pct) }], { d: 1200 });
  $('#healthArc').style.stroke = ok ? 'var(--accent2)' : 'var(--warn)';
}

/* ---------- coming up (Autopilot routines) and recently (real activity) ---------- */
function renderNext() {
  const box = $('#nxNext'); if (!box) return;
  const rs = (state.settings.autopilotRoutines || []).filter(r => r.enabled !== false && !r.paused).slice(0, 3);
  box.innerHTML = rs.length ? rs.map(r => `<button class="nx" data-go="autopilot" data-tab="calendar"><span class="ni">${ic('autopilot')}</span><span class="nt"><b>${esc(r.name || t('Routine'))}</b><span>${esc(r.summary || t('Scheduled task'))}</span></span></button>`).join('')
    : `<div class="nx-empty"><span>${t('No routines yet.')}</span><button class="btn sm sec" data-go="autopilot" data-tab="routines">${ic('plus')}${t('Create one')}</button></div>`;
}
function renderRecent() {
  const box = $('#nxRecent'); if (!box) return; const a = (state.settings.activity || []).slice(0, 3);
  box.innerHTML = a.length ? a.map(x => `<button class="nx"${x.go ? ` data-go="${x.go}" data-tab="${x.tab || ''}"` : ''}><span class="ni">${ic(x.ic || 'check')}</span><span class="nt"><b>${esc(SH.activityText(x).t)}</b><span>${esc(SH.activityText(x).sub)}</span></span><span class="nw">${ago(x.at)}</span></button>`).join('')
    : `<div class="nx-empty"><span>${t('What you do with StellarHub will show up here.')}</span></div>`;
}
SH.on('setting', ({ key }) => { if (key === 'activity') renderRecent(); if (key === 'autopilotRoutines') renderNext(); });
function bindNx() {
  $('#nxSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.classList.contains('on')) return;
    $$('#nxSeg button').forEach(x => x.classList.toggle('on', x === b)); SH.placeSeg($('#nxSeg'));
    const dir = b.dataset.v === 'recent' ? 1 : -1;
    const from = $('.nx-page.on', home), to = $(`.nx-page[data-p="${b.dataset.v}"]`, home);
    from.classList.remove('on'); to.classList.add('on');
    anim(from, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translate3d(${-dir * 30}px,0,0)` }], { d: 200 });
    anim(to, [{ opacity: 0, transform: `translate3d(${dir * 40}px,0,0)` }, { opacity: 1, transform: 'none' }], { d: 460, delay: 40, e: EASE.spring });
  });
  $('#vswitch').addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b || b.classList.contains('on')) return;
    $$('#vswitch button').forEach(x => x.classList.toggle('on', x === b)); SH.placeSeg($('#vswitch .seg'));
    SH.setSetting('homeVariant', b.dataset.v);
  });
}

/* ---------- stage views (Mosaic / 3D) ---------- */
let current = null, currentWrap = null;
const variantList = () => Object.values(registry.variants);
function renderSwitch() {
  const vs = variantList(); const sw = $('#vswitch'); if (!sw) return;
  if (vs.length < 2) { sw.innerHTML = ''; return; }
  sw.innerHTML = `<div class="seg"><span class="ind"></span>${vs.map(v => `<button data-v="${v.id}"${v.id === (current && current.id) ? ' class="on"' : ''}>${ic(VARIANT_IC[v.id] || 'layers')}${esc(v.short || v.name)}</button>`).join('')}</div>`;
  requestAnimationFrame(() => SH.placeSeg($('.seg', sw), true));
}
/* the ctx a view keeps while it is mounted is made out here: a closure made inside mountVariant shares its scope, oldWrap
   included, so each view kept the one before it alive (its whole DOM, listeners and 3D canvas), a chain that grew with every switch */
const variantCtx = (stage, intro) => ({ PC, tele: SH.tele, openComponent: (cid, el) => SH.openComponent(cid, el), motion, stage, intro });
function mountVariant(id, intro) {
  const stage = $('#stage'); if (!stage) return;
  const def = registry.variants[id] || variantList()[0]; if (!def || def === current) return;
  const old = current, oldWrap = currentWrap;
  current = def; const wrap = document.createElement('div'); wrap.className = 'vwrap'; wrap.dataset.nofade = ''; stage.appendChild(wrap); currentWrap = wrap;
  if (old) {
    try { old.unmount && old.unmount(); } catch (e) { console.error(e); }
    anim(oldWrap, [{ opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' }, { opacity: 0, transform: 'scale(.94)', filter: 'blur(14px)' }], { d: 300, e: EASE.io })
      .finished.then(() => oldWrap.remove()).catch(() => oldWrap.remove());
    anim(wrap, [{ opacity: 0, transform: 'scale(1.05)', filter: 'blur(14px)' }, { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' }], { d: 520, delay: 100, e: EASE.out });
  }
  const ctx = variantCtx(stage, !!intro || !!old);
  try { def.mount(wrap, ctx); } catch (e) { console.error(e); wrap.innerHTML = `<div class="empty"><b>${t('This view failed')}</b>${esc(e.message)}</div>`; }
  $$('#vswitch button').forEach(x => x.classList.toggle('on', x.dataset.v === def.id)); const sg = $('#vswitch .seg'); if (sg) SH.placeSeg(sg);
}
SH.on('setting', ({ key, val }) => { if (key === 'homeVariant') mountVariant(val); });
SH.on('variant:registered', () => { renderSwitch(); if (!current && built) mountVariant(state.settings.homeVariant, true); });
addEventListener('resize', () => { if (current && current.resize) try { current.resize(); } catch (e) { console.error(e); } });

/* ---------- the PC facts go stale when the app stays open for days (drivers, disks, GPU): measure again in the
   background (the engine does it in its own thread; the interface never waits) once they are older than 30
   minutes, when Home is shown again, and on a slow timer while Home is open. Home updates only if something changed. */
const PC_STALE = 30 * 60e3;
let pcAt = Date.now(), pcBusy = false;
const pcSig = o => JSON.stringify([o.model, o.code, o.typeName, o.os, o.facts, o.components]);
async function refreshPC(force) {
  if (pcBusy || !SH.PC.real) return;                       /* sample mode has nothing to measure */
  if (!force && (Date.now() - pcAt < PC_STALE || document.hidden)) return;
  pcBusy = true;
  try {
    const pc = await SH.engine('system', 'pc_info_fresh');
    if (!pc || !Array.isArray(pc.components) || !pc.components.length) return;
    pcAt = Date.now();
    if (pcSig(pc) === pcSig(PC)) return;
    const comps = JSON.stringify(pc.components) !== JSON.stringify(PC.components);
    Object.assign(PC, pc);
    if (!built) return;
    const m = $('#hModel'); if (m) m.textContent = PC.model;
    const sub = $('.h-id .sub', home); if (sub) sub.innerHTML = subLine();
    $$('.facts > div', home).forEach((el, i) => {
      const v = [PC.facts.drivers, PC.facts.programs, PC.facts.freeC][i];
      const b = $('b', el);
      if (v == null) { b.dataset.count = ''; b.textContent = dash; }
      else {
        if (i < 2) $('span', el).textContent = t(['drivers', 'programs'][i], { n: v });
        b.dataset.count = v; SH.countUp(b, +v);
      }
    });
    if (comps) {
      const chip = $('.stage-head .chip', home); if (chip) chip.textContent = PC.components.length;
      const id = current && current.id;
      if (id && state.view === 'home') { try { current.unmount && current.unmount(); } catch (e) { console.error(e); } if (currentWrap) currentWrap.remove(); current = null; currentWrap = null; mountVariant(id, false); }
    }
  } catch (e) { /* the old data stays; try again later */ }
  finally { pcBusy = false; }
}
setInterval(() => { if (state.view === 'home') refreshPC(); }, 10 * 60e3);
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.view === 'home') refreshPC(); });

/* ---------- entrance ---------- */
function intro(back) {
  const base = back ? 140 : 0;
  $$('[data-intro]', home).forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translate3d(0,14px,0)', filter: 'blur(8px)' }, { opacity: 1, transform: 'translate3d(0,0,0)', filter: 'blur(0px)' }], { d: 620, delay: base + (back ? 0 : 420) + i * 60, e: EASE.spring }));
  $$('.vit', home).forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translate3d(-12px,0,0)' }, { opacity: 1, transform: 'translate3d(0,0,0)' }], { d: 480, delay: base + (back ? 60 : 700) + i * 40, e: EASE.spring, keep: true }));
  $$('.pend, .nx', home).forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translate3d(12px,0,0)' }, { opacity: 1, transform: 'translate3d(0,0,0)' }], { d: 480, delay: base + (back ? 60 : 760) + i * 45, e: EASE.spring, keep: true }));
  if (!back) $$('[data-count]', home).forEach(el => { if (el.dataset.count !== '') setTimeout(() => SH.countUp(el, +el.dataset.count), 700 * motion()); });
  if (!back) rows.forEach(r => { r.s.set(0); r.drawn = false; });
  setTimeout(readVitals, (back ? 100 : 850) * motion());
}
SH.on('home:return', () => { fit(); refreshPC(); renderPending(); renderActs(); renderRecent(); renderNext(); intro(true); if (current && current.onReturn) try { current.onReturn(); } catch (e) { console.error(e); } });
SH.on('boot', () => {
  if (SH.PC.ts) pcAt = SH.PC.ts * 1000;                    /* what Python hands over may come from the saved copy */
  setTimeout(refreshPC, 20000);                            /* a saved copy older than 30 minutes: update it once started */
  render();
  if (!registry.variants[state.settings.homeVariant]) SH.setSetting('homeVariant', 'bento');
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => { fit(); renderSwitch(); SH.placeSeg($('#nxSeg'), true); mountVariant(state.settings.homeVariant, true); intro(false); loadHealth(); });
});
})();
