/* StellarHub · shell: stars, dock, navigation between views and tabs, palette, settings, admin mode and toasts. */
'use strict';
(() => {
const { $, $$, ROOT, state, Spring, EASE, anim, assemble, tickers, ic, MODS, modById, registry, motion, esc } = SH;
const S = () => state.settings;

/* ================= stars ================= */
const cv = $('#stars'), cx = cv.getContext('2d'); let SW = 0, SH_ = 0, DPR = 1;
let stars = [];
const star = () => ({ x: Math.random(), y: Math.random(), z: .15 + Math.random() * .85, r: Math.random() * 1.1 + .25, p: Math.random() * 6.28, tw: .4 + Math.random() * 1.4 });
function makeStars(n) { n = Math.max(0, Math.round(n || 0)); if (n > stars.length) stars = stars.concat(Array.from({ length: n - stars.length }, star)); else stars = stars.slice(0, n); }
makeStars(240);
const shooters = []; let nextShot = performance.now() + 4000;
const warp = new Spring(0, 70, 13);
const mouse = { x: new Spring(0, 40, 12), y: new Spring(0, 40, 12) };
function sizeStars() { DPR = Math.min(state.lite ? 1 : 1.5, devicePixelRatio || 1); SW = innerWidth; SH_ = innerHeight; cv.width = Math.round(SW * DPR); cv.height = Math.round(SH_ * DPR); starDirty = true; }
let starDirty = true, starAcc = 0, starCleared = false;
sizeStars(); addEventListener('resize', sizeStars); SH.on('power', sizeStars);
addEventListener('pointermove', e => { if (!(innerWidth > 0 && innerHeight > 0)) return; mouse.x.t = (e.clientX / innerWidth - .5) * 2; mouse.y.t = (e.clientY / innerHeight - .5) * 2; });
/* The window coming back (shown from the tray, restored, un-occluded, focused) can leave the canvas empty or at the wrong size
   (innerWidth is 0 while it is minimized, and a hidden WebView can drop the canvas): measure again and redraw at once. */
const starWake = () => { starDirty = true; starAcc = 1; };
document.addEventListener('visibilitychange', () => { if (!document.hidden) starWake(); });
addEventListener('focus', starWake); addEventListener('pageshow', starWake);
/* Nothing touched for a few seconds: decoration that only moves for show (the stars, the GPU fans) drops to a few frames a
   second, and goes back to full the moment the mouse, keyboard, wheel or controller is used. Every redraw of a full-window canvas
   is a composite for the GPU, so a calm screen should cost it almost nothing. */
let lastInput = performance.now();
const poke = () => { lastInput = performance.now(); };
['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => addEventListener(ev, poke, { passive: true, capture: true }));
SH.poke = poke; SH.idleFor = () => performance.now() - lastInput; SH.isIdle = () => SH.idleFor() > 8000;
/* html[data-idle] lets CSS drop its own decorative transitions too */
setInterval(() => { const v = SH.isIdle() ? '1' : '0'; if (ROOT.dataset.idle !== v) ROOT.dataset.idle = v; }, 1000);
const starAlpha = new Spring(0, 40, 12); starAlpha.t = 1;
SH.on('look', () => { starDirty = true; }); SH.on('setting', () => { starDirty = true; });
tickers.add((dt, t) => { try { drawStars(dt, t); } catch (e) { console.error(e); starDirty = true; } }); /* a throw would make the loop drop the ticker for good: the sky would stay empty */
function drawStars(dt, t) {
  if (!(innerWidth > 0 && innerHeight > 0)) { starDirty = true; return; } /* minimized or not laid out yet: nothing to draw on */
  if (innerWidth !== SW || innerHeight !== SH_ || cv.width !== Math.round(SW * DPR)) sizeStars(); /* a resize event can be missed while hidden */
  for (const k of ['x', 'y']) if (!Number.isFinite(mouse[k].v) || !Number.isFinite(mouse[k].t)) { mouse[k].set(0); }
  if (!Number.isFinite(warp.v)) warp.set(0);
  mouse.x.step(dt); mouse.y.step(dt); warp.step(dt); starAlpha.t = S().stars ? 1 : 0; starAlpha.step(dt);
  if (starAlpha.v < .01) { if (!starCleared) { cx.setTransform(DPR, 0, 0, DPR, 0, 0); cx.clearRect(0, 0, SW, SH_); starCleared = true; } return; }
  /* The stars drift less than 10 px per second and twinkle slowly: redrawing the whole canvas every frame buys
     nothing. They are redrawn at 25 fps (10 fps on battery) unless something quick happens (camera flight, mouse
     depth, a shooting star), and a still canvas costs the compositor nothing. */
  const st = S(), lite = state.lite, inten = SH.effInt(), moving = inten !== 'min';
  const par = st.parallax && moving && !lite ? 1 : 0;
  const fast = Math.abs(warp.v) > .02 || (par && (!mouse.x.idle || !mouse.y.idle)) || shooters.length > 0 || starAlpha.v < .99;
  starAcc += dt; t > nextShot && st.shooting && moving && (starDirty = true);
  if (!starDirty && starAcc < (fast ? (lite ? .033 : 0) : SH.isIdle() ? (lite ? .25 : .125) : (lite ? .1 : .04))) return;
  const d = Math.min(starAcc, .25); starAcc = 0; starDirty = false; starCleared = false;
  cx.setTransform(DPR, 0, 0, DPR, 0, 0); cx.clearRect(0, 0, SW, SH_);
  const drift = moving ? d * .004 * SH.ORBIT[inten] * (+st.starSpeed || 0) : 0, bright = st.starBright || 1;
  const cxs = SW / 2, cys = SH_ * .52; const w = warp.v;
  /* shooting stars */
  if (st.shooting && moving && t > nextShot) {
    nextShot = t + 7000 + Math.random() * 11000;
    const a = .35 + Math.random() * .35, sp = 900 + Math.random() * 500;
    shooters.push({ x: Math.random() * SW * .8 + SW * .1, y: Math.random() * SH_ * .35, vx: Math.cos(a) * sp * (Math.random() < .5 ? -1 : 1), vy: Math.sin(a) * sp, life: 0, max: .7 + Math.random() * .4 });
  }
  for (let i = shooters.length - 1; i >= 0; i--) {
    const sh = shooters[i]; sh.life += d; sh.x += sh.vx * d; sh.y += sh.vy * d;
    const k = sh.life / sh.max; if (k >= 1) { shooters.splice(i, 1); continue; }
    const fade = Math.sin(k * Math.PI), tail = .12;
    const g = cx.createLinearGradient(sh.x, sh.y, sh.x - sh.vx * tail, sh.y - sh.vy * tail);
    g.addColorStop(0, `rgba(230,242,255,${.9 * fade * starAlpha.v})`); g.addColorStop(1, 'rgba(230,242,255,0)');
    cx.globalAlpha = 1; cx.strokeStyle = g; cx.lineWidth = 1.4; cx.beginPath(); cx.moveTo(sh.x, sh.y); cx.lineTo(sh.x - sh.vx * tail, sh.y - sh.vy * tail); cx.stroke();
  }
  const warping = Math.abs(w) > .02, tw0 = t / 1000, twk = moving && st.twinkle && !lite;
  const bk = warping ? null : {};
  for (const s of stars) {
    s.x -= drift * s.z; if (!(s.x >= 0)) s.x = Number.isFinite(s.x) ? s.x + 1 : Math.random(); /* NaN would hide the star for good */
    const x = s.x * SW - mouse.x.v * 22 * s.z * par, y = s.y * SH_ - mouse.y.v * 16 * s.z * par;
    const tw = twk ? (.65 + .35 * Math.sin(tw0 * s.tw + s.p)) : .8;
    const al = Math.min(1, (.25 + .6 * s.z) * tw * starAlpha.v * bright);
    if (warping) {
      cx.globalAlpha = al;
      const dx = x - cxs, dy = y - cys, len = w * s.z * .22;
      cx.strokeStyle = s.z > .7 ? '#cfe6ff' : '#9fb6d8'; cx.lineWidth = s.r; cx.beginPath(); cx.moveTo(x, y); cx.lineTo(x + dx * len, y + dy * len); cx.stroke();
    } else {
      /* grouped by (colour, opacity level): the colour and alpha are set ~30 times, not once per star */
      const key = (s.z > .75 ? 16 : 0) + Math.round(al * 15), r = s.r * s.z + .2;
      (bk[key] || (bk[key] = [])).push(x, y, r);
    }
  }
  /* Each star is its own small shape: a square for the ones under 1 px (the same dot as a circle, far cheaper) and a circle
     for the rest. One path holding a whole group was not a shape the GPU draws directly: it was rasterized into a mask of
     the whole window, some 30 of them per redraw, which cost the GPU process ~40 % of a core with Home idle. */
  if (bk) for (const k in bk) {
    cx.globalAlpha = (k & 15) / 15; cx.fillStyle = k >= 16 ? '#e6f2ff' : '#a9bddc'; const a = bk[k];
    for (let i = 0; i < a.length; i += 3) { const x = a[i], y = a[i + 1], r = a[i + 2];
      if (r < 1.05) cx.fillRect(x - r, y - r, r * 2, r * 2); else { cx.beginPath(); cx.arc(x, y, r, 0, 6.283); cx.fill(); } }
  }
  cx.globalAlpha = 1;
}
SH.mouse = mouse; SH.warp = warp;

/* ================= dock ================= */
const DOCK = ['home', '|', 'monitor', 'drivers', 'remover', 'updater', 'hangar', '|', 'storage', 'optimizer', 'privacy', '|', 'benchmark', 'tester', '|', 'autopilot'];
const dock = $('#dock');
dock.innerHTML = DOCK.map(id => id === '|' ? '<span class="sep"></span>' : (m => `<button class="dk${id === 'home' ? ' on' : ''}" data-go="${id}" aria-label="${m.name}">${ic(m.icon)}<span class="tip">${m.name}</span></button>`)(modById(id))).join('') + '<span class="dot" id="dockDot"></span>';
const BASE = 52, GROW = .3;
/* Magnification without layout: every button keeps its 52 px box. Each frame only two custom properties change per
   button (--dv the size factor, --dx the shift caused by the neighbours growing, see .dk in base.css), so the frame
   costs a style update and a composite instead of a flex layout and a rect read per button. */
const dks = $$('.dk', dock).map(el => ({ el, s: new Spring(1, 320, 24), cx: 0, dx: 0, pv: '', px: '' }));
/* the separators move with the buttons: each one shifts by the growth of every button before it (else a grown icon
   slides over its separator) */
const dseps = $$('.sep', dock).map(el => ({ el, before: dks.filter(d => d.el.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).length, px: '' }));
const dotX = new Spring(0, 260, 24); let dockMouse = null, dockCx = false, dockBusy = false, dockHot = false, dockPx = '';
dock.addEventListener('pointermove', e => dockMouse = e.clientX);
dock.addEventListener('pointerleave', () => { dockMouse = null; dockCx = false; });
const dotEl = $('#dockDot');
tickers.add(dt => {
  const hover = dockMouse !== null && S().intensity !== 'min';
  if (hover || dockBusy || dockHot) {  /* dockHot: the first frame after the pointer left still has to start the springs back */
    if (hover && !dockCx) { for (const d of dks) { const r = d.el.getBoundingClientRect(); d.cx = r.left + r.width / 2 - d.dx; } dockCx = true; } /* the resting centres, read once per visit */
    let busy = false, extra = 0, top = 1;
    for (const d of dks) {
      const t = hover ? 1 + GROW * Math.max(0, 1 - Math.abs(dockMouse - (d.cx + d.dx)) / 140) : 1;
      d.s.t = t; d.s.step(dt); if (!d.s.idle) busy = true;
      extra += BASE * (d.s.v - 1); if (d.s.v > top) top = d.s.v;
    }
    dockBusy = busy; dockHot = hover;
    const pw = extra.toFixed(2), ph = (BASE * (top - 1)).toFixed(2);  /* the pill grows with them: wider by the sum, taller by the tallest */
    if (pw + ph !== dockPx) { dockPx = pw + ph; dock.style.setProperty('--dkw', pw); dock.style.setProperty('--dkh', ph); }
    let run = 0; const runs = [0];
    for (const d of dks) {
      const e = BASE * (d.s.v - 1); d.dx = run + e / 2 - extra / 2; run += e; runs.push(run);  /* the row stays centred as it widens */
      const pv = d.s.v.toFixed(4), px = d.dx.toFixed(2);
      if (pv !== d.pv) { d.pv = pv; d.el.style.setProperty('--dv', pv); }
      if (px !== d.px) { d.px = px; d.el.style.setProperty('--dx', px); }
    }
    for (const sp of dseps) { const px = (runs[sp.before] - extra / 2).toFixed(2); if (px !== sp.px) { sp.px = px; sp.el.style.setProperty('--dx', px); } }
  }
  /* the dock dot: measured only while the dock moves or the module changes (measuring every frame
     forces a full-page layout and drops the frame rate while scrolling) */
  const dockMoving = dockMouse !== null || dockBusy;
  if (dockMoving || dotDirty) { const on = dks.find(d => d.el.classList.contains('on')); if (on) dotX.t = on.el.offsetLeft + on.el.offsetWidth / 2 - 9 + on.dx; dotDirty = false; }
  if (!dotX.idle || dockMoving) { dotX.step(dt); dotEl.style.transform = `translateX(${dotX.v.toFixed(2)}px)`; }
});
let dotDirty = true;
SH.on('view', () => { dotDirty = true; });
addEventListener('resize', () => { dotDirty = true; });
dock.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });

/* a module busy with something the user started shows it on its dock icon while the user is elsewhere: a thin ring
   around the icon (filled to the progress, or a short arc in a slow orbit while it cannot be measured) and the status
   in the tooltip. When it ends there the ring closes and gives way to a small badge (a check, or ! when it failed)
   that stays until the module is visited. It sits in .dka, which takes the same transform as the icon, so the
   magnification (--dv) carries it along; everything in it moves by transform, opacity and stroke-dashoffset. */
SH.icons.add({ bang: '<path d="M12 6.5v6.5M12 17.5h.01"/>' });
const ACT_RING = '<span class="dka" aria-hidden="true"><svg viewBox="0 0 44 44"><circle class="tr" cx="22" cy="22" r="20"/><circle class="arc" cx="22" cy="22" r="20" pathLength="100" transform="rotate(-90 22 22)"/></svg><i class="dkb"></i></span>';
const dkAct = new Map(); /* module -> what its icon shows: '', 'run', 'fin' (the ring closing), 'ok', 'err' */
function dockStatus(run, done) {
  if (run) return [run.text || run.label, SH.activity.pct(run)].filter(Boolean).join(' ');
  if (done) return done.ok ? (done.summary || SH.t('Finished')) : SH.t('Needs a look');
  return '';
}
function paintDockActs() {
  for (const d of dks) {
    const id = d.el.dataset.go; if (id === 'home') continue;
    const run = SH.activity.of(id), done = !run && SH.activity.done(id), was = dkAct.get(id) || '';
    let want = run ? 'run' : done ? (done.ok ? 'ok' : 'err') : '';
    if (!want && !was) continue;
    if (!d.ring) { d.el.insertAdjacentHTML('beforeend', ACT_RING); d.ring = $('.dka', d.el); }
    const ring = d.ring, fin = want === 'ok' || want === 'err';
    if (run) { ring.style.setProperty('--p', run.pct == null ? 0 : run.pct.toFixed(3)); d.el.classList.toggle('ind', run.pct == null); }
    /* finished while away: the ring closes first, the badge follows a moment later */
    if (fin && d.finT) want = 'fin';
    else if (fin && was === 'run') {
      d.el.classList.remove('ind'); d.el.dataset.res = want; ring.style.setProperty('--p', 1); want = 'fin';
      d.finT = setTimeout(() => { d.finT = 0; paintDockActs(); }, 440 * motion());
    } else if (d.finT) { clearTimeout(d.finT); d.finT = 0; }
    if (fin && want !== 'fin' && want !== was) {
      const b = $('.dkb', ring); b.innerHTML = ic(want === 'ok' ? 'check' : 'bang');
      anim(b, [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'scale(1)' }], { d: 460, e: EASE.spring, fill: 'none' }); /* CSS holds the end state, so the badge can leave by itself */
    }
    if ((d.el.dataset.act || '') !== want) { if (want) d.el.dataset.act = want; else delete d.el.dataset.act; }
    dkAct.set(id, want);
    const name = modById(id).name, st = dockStatus(run, done), full = st ? `${name} · ${st}` : name, tip = $('.tip', d.el);
    if (tip.textContent !== full) { tip.textContent = full; d.el.setAttribute('aria-label', full); }
  }
}
SH.on('activity', paintDockActs);

/* ================= modules: views and tabs ================= */
const views = $('#views');
const modState = {}; // id -> {tab, rendered:Set, ix, iw}
/* a tab may carry a condition (a third item in SH.MODS, or `when` on a module's own tab object): while it is false the tab is
   hidden (no button, no palette entry, not reachable by #mod/tab) but its panel stays built, so nothing else changes */
function allTabsOf(m) { const def = registry.modules[m.id] || {}; return (def.tabs || m.tabs || []).map(t => Array.isArray(t) ? { id: t[0], name: t[1], when: t[2] } : t); }
const tabShown = t => { try { return !t.when || !!t.when(); } catch { return true; } };
function tabsOf(m) { return allTabsOf(m).filter(tabShown); }
/* shows or hides the tab buttons of a module according to their conditions; moves off a tab that just went away */
function syncTabs(mid) {
  const m = modById(mid), ms = modState[mid], s = $('#v-' + mid); if (!m || !ms || !s) return;
  const all = allTabsOf(m); if (!all.some(t => t.when)) return;
  const shown = all.filter(tabShown);
  all.forEach(t => { const b = $(`.subnav [data-tab="${t.id}"]`, s); if (b) b.hidden = !shown.includes(t); });
  const nav = $('.subnav', s); if (nav) nav.hidden = shown.length < 2;
  if (!shown.some(t => t.id === ms.tab) && shown[0]) setTab(mid, shown[0].id, true);
  tabDirty = true;
}
const syncAllTabs = () => Object.keys(modState).forEach(syncTabs);
SH.on('setting', () => syncAllTabs());
function skeletonFor(i) {
  const r = k => `<div class="sk-row" data-asm><div class="sk a" style="--dl:${k * .08}s"></div><div class="sk b" style="--w:${[38, 52, 30, 46, 41, 27, 49][k % 7]}%;--dl:${k * .08 + .04}s"></div><div class="sk c" style="--dl:${k * .08 + .08}s"></div></div>`;
  return `<div class="sk-rows">${Array.from({ length: 6 + (i % 3) }, (_, k) => r(k)).join('')}</div>`;
}
function buildModule(m) {
  let s = $('#v-' + m.id);
  if (!s) { s = document.createElement('section'); s.className = 'view'; s.id = 'v-' + m.id; s.dataset.view = m.id; views.appendChild(s); }
  const def = registry.modules[m.id] || {}; const tabs = allTabsOf(m);
  const sample = !(m.real || def.real) ? `<span class="chip warn" title="${SH.t('Not connected to the real engine yet: what you see is sample data and does not reflect your PC')}">${SH.t('Sample data')}</span>` : '';
  s.innerHTML = `<div class="mod"><header class="mhead" data-asm><div class="ttl"><h1>${esc(def.name || m.name)}${sample}</h1><p>${esc(def.desc || m.desc || '')}</p></div><div class="acts"></div></header>
    ${tabs.length > 1 ? `<nav class="subnav" data-asm role="tablist"><span class="ind"></span>${tabs.map((t, i) => `<button role="tab" data-tab="${t.id}"${i === 0 ? ' class="on"' : ''}${tabShown(t) ? '' : ' hidden'}>${esc(t.name)}<span class="bd" hidden></span></button>`).join('')}</nav>` : ''}
    <div class="tabs">${tabs.map((t, i) => `<div class="tab${i === 0 ? ' on' : ''}" data-tab="${t.id}" role="tabpanel"></div>`).join('')}</div></div>`;
  modState[m.id] = { tab: (tabs.find(tabShown) || tabs[0] || {}).id, rendered: new Set(), ix: new Spring(0, 300, 28), iw: new Spring(0, 300, 28), placed: false };
  const ctx = ctxFor(m);
  if (def.actions) { try { def.actions($('.acts', s), ctx); } catch (e) { console.error(e); } }
  const nav = $('.subnav', s);
  if (nav) nav.addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setTab(m.id, b.dataset.tab); });
}
function ctxFor(m) {
  return {
    mod: m, go, el: () => $('#v-' + m.id),
    tabEl: id => $(`#v-${m.id} .tab[data-tab="${id}"]`),
    setTab: id => setTab(m.id, id),
    setBadge(tabId, n) { const b = $(`#v-${m.id} .subnav [data-tab="${tabId}"] .bd`); if (!b) return; b.hidden = !n; tabDirty = true; if (n) { b.textContent = n; anim(b, [{ transform: 'scale(.4)' }, { transform: 'scale(1)' }], { d: 380, e: EASE.spring }); } },
  };
}
function renderTab(mid, tabId) {
  const ms = modState[mid]; const el = $(`#v-${mid} .tab[data-tab="${tabId}"]`); if (!el || ms.rendered.has(tabId)) return el;
  ms.rendered.add(tabId);
  const def = registry.modules[mid];
  if (def && def.renderTab) { try { def.renderTab(tabId, el, ctxFor(modById(mid))); } catch (e) { console.error(e); el.innerHTML = SH.emptyState({ art: 'error', title: SH.t('This tab failed to load'), text: esc(e.message) }); } }
  else el.innerHTML = skeletonFor(tabId.length);
  return el;
}
function placeTabInd(mid, snap) {
  const ms = modState[mid]; const s = $('#v-' + mid); const b = s && $(`.subnav [data-tab="${ms.tab}"]`, s); if (!b) return;
  ms.ix.t = b.offsetLeft; ms.iw.t = b.offsetWidth; if (snap || !ms.placed) { ms.ix.set(ms.ix.t); ms.iw.set(ms.iw.t); ms.placed = true; }
}
/* the tab indicator only measures when the tab/view/size changes and only writes while it moves */
let tabDirty = true;
SH.on('view', () => { tabDirty = true; }); SH.on('tab', () => { tabDirty = true; }); SH.on('look', () => { tabDirty = true; });
addEventListener('resize', () => { tabDirty = true; });
tickers.add(dt => {
  const ms = modState[state.view]; if (!ms) return;
  if (tabDirty) { placeTabInd(state.view); tabDirty = false; ms.moving = true; }
  if (!ms.moving) return;
  const ind = $(`#v-${state.view} .subnav .ind`); if (!ind) return;
  ms.ix.step(dt); ms.iw.step(dt);
  const stretch = Math.min(28, Math.abs(ms.ix.vel) * .035);
  ind.style.width = (ms.iw.v + stretch).toFixed(2) + 'px'; ind.style.transform = `translateX(${(ms.ix.v - (ms.ix.vel > 0 ? 0 : stretch)).toFixed(2)}px)`;
  if (ms.ix.idle && ms.iw.idle) ms.moving = false;
});
function setTab(mid, tabId, quiet) {
  const ms = modState[mid]; if (!ms || ms.tab === tabId) return;
  const s = $('#v-' + mid); const tabs = tabsOf(modById(mid)); const oldI = tabs.findIndex(t => t.id === ms.tab), newI = tabs.findIndex(t => t.id === tabId);
  if (newI < 0) return;
  const def = registry.modules[mid] || {};
  const from = $(`.tab[data-tab="${ms.tab}"]`, s); const fresh = !ms.rendered.has(tabId); const to = renderTab(mid, tabId);
  if (def.leaveTab) try { def.leaveTab(ms.tab, from); } catch (e) { console.error(e); }
  const prev = ms.tab; ms.tab = tabId;
  $$('.subnav [data-tab]', s).forEach(b => b.classList.toggle('on', b.dataset.tab === tabId));
  const dir = newI > oldI ? 1 : -1;
  to.getAnimations().forEach(a => a.cancel()); to.style.transform = to.style.filter = to.style.opacity = '';
  to.classList.add('on');
  if (!quiet) {
    const a = anim(from, [{ opacity: 1, transform: 'translate3d(0,0,0) scale(1)' }, { opacity: 0, transform: `translate3d(${-dir * 22}px,0,0) scale(.985)` }], { d: 180, e: EASE.out });
    a && a.finished.then(() => { if (ms.tab !== prev) from.classList.remove('on'); }).catch(() => {});
    anim(to, [{ opacity: 0, transform: `translate3d(${dir * 34}px,0,0) scale(.985)` }, { opacity: 1, transform: 'translate3d(0,0,0) scale(1)' }], { d: 460, delay: 30, e: EASE.glide });
    if (fresh) assemble(to, 80, 32);
  } else { from.classList.remove('on'); }
  if (def.enterTab) try { def.enterTab(tabId, to, ctxFor(modById(mid))); } catch (e) { console.error(e); }
  SH.emit('tab', { mod: mid, tab: tabId });
  if (!quiet) { pushHist(); SH.sound('tab_switch'); }
}

/* ================= history: back and forward (mouse side buttons, Alt+arrows) ================= */
const hist = [{ view: 'home', tab: null }]; let hIdx = 0, fromHist = false;
function pushHist() {
  if (fromHist) return;
  const e = { view: state.view, tab: modState[state.view] ? modState[state.view].tab : null }, cur = hist[hIdx];
  if (cur && cur.view === e.view && cur.tab === e.tab) return;
  hist.splice(hIdx + 1); hist.push(e); if (hist.length > 80) hist.shift(); hIdx = hist.length - 1;
}
function travel(d) {
  if (state.palOpen) { closePal(); return; } if (state.setOpen) { closeSettings(); return; }
  const i = hIdx + d; if (i < 0 || i >= hist.length) { const dk = $('.dk.on', dock); dk && anim(dk, [{ transform: 'translateX(0)' }, { transform: `translateX(${d * -4}px)` }, { transform: 'translateX(0)' }], { d: 260, keep: true }); return; }
  hIdx = i; const e = hist[i]; fromHist = true;
  try { if (e.view === state.view) { if (e.tab) setTab(e.view, e.tab); } else go(e.view, { tab: e.tab }); } finally { fromHist = false; }
}
SH.back = () => travel(-1); SH.forward = () => travel(1);
const ownsMouse = e => e.target.closest && e.target.closest('#v-tester .tab[data-tab="mouse"]');
addEventListener('mousedown', e => { if ((e.button === 3 || e.button === 4) && !ownsMouse(e)) e.preventDefault(); });
addEventListener('mouseup', e => {
  if (e.button !== 3 && e.button !== 4) return; if (ownsMouse(e)) return; e.preventDefault();
  if (document.querySelector('.cs-o.on')) { SH.closeComponent && SH.closeComponent(); return; }
  travel(e.button === 3 ? -1 : 1);
});
addEventListener('keydown', e => { if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); travel(e.key === 'ArrowLeft' ? -1 : 1); } });

/* ================= camera navigation ================= */
let navToken = 0; SH.homeAnimating = false;
let pendingGo = null; SH.on('boot', () => { const g = pendingGo; pendingGo = null; if (g) setTimeout(() => go(g[0], g[1]), 0); });
const viewEl = n => $('#v-' + n);
function go(name, opts = {}) {
  if (name === 'settings') { openSettings(opts.section); return; }
  if (name === 'admin') { askAdmin(); return; }
  const m = modById(name); if (!m) return;
  if (name === state.view) { if (opts.tab) setTab(name, opts.tab); return; }
  /* before the boot has built the module views there is nothing to show yet (it used to throw half way, leaving state.view on a view that was never shown):
     remember the last request and take it when the boot is done */
  if (!viewEl(name)) { if (!SH.booted) pendingGo = [name, opts]; return; }
  const token = ++navToken; const fromName = state.view, from = viewEl(fromName), to = viewEl(name);
  if (!opts.silent) SH.sound('navigate');  /* opts.silent: the start route, which is not the user's doing */
  const fromDef = registry.modules[fromName]; if (fromDef) { try { fromDef.leave && fromDef.leave(); fromDef.leaveTab && fromDef.leaveTab(modState[fromName].tab); } catch (e) { console.error(e); } }
  state.view = name; SH.emit('view', { from: fromName, to: name });
  $$('.dk', dock).forEach(b => b.classList.toggle('on', b.dataset.go === name));
  if (modState[name]) {
    /* returning to a module opens its main tab (unless another one is requested or we come from history) */
    const want = opts.tab || (fromHist ? null : (tabsOf(m)[0] || {}).id);
    if (want && want !== modState[name].tab) setTab(name, want, true);
    renderTab(name, modState[name].tab);
  }
  /* the incoming view starts clean: no leftovers from a previous exit (blur, scale, opacity) */
  to.getAnimations().forEach(a => a.cancel()); to.style.transform = to.style.filter = to.style.opacity = '';
  to.classList.add('is-on');
  const cam = S().camera && SH.effInt() !== 'min' && !state.lite;
  let outA;
  if (fromName === 'home') {
    SH.homeAnimating = true;
    if (cam) { warp.t = 1; setTimeout(() => { warp.t = 0; }, 260 * motion()); }
    outA = anim(from, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: `scale(${cam ? 1.9 : 1.05})` }], { d: cam ? 480 : 240, e: EASE.io });
    anim(to, [{ opacity: 1 }, { opacity: 1 }], { d: 1 }); assemble(to, cam ? 200 : 60);
  } else if (name === 'home') {
    SH.homeAnimating = true;
    if (cam) { warp.t = -.8; setTimeout(() => { warp.t = 0; }, 240 * motion()); }
    outA = anim(from, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.9)' }], { d: 260, e: EASE.out });
    anim(to, [{ opacity: 0, transform: `scale(${cam ? 1.9 : 1.04})` }, { opacity: 1, transform: 'scale(1)' }], { d: cam ? 560 : 300, delay: 40, e: EASE.glide });
    SH.emit('home:return');
  } else {
    if (cam) { warp.t = .45; setTimeout(() => { warp.t = 0; }, 180 * motion()); }
    outA = anim(from, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: `scale(${cam ? 1.18 : 1.03})` }], { d: 320, e: EASE.io });
    anim(to, [{ opacity: 1 }, { opacity: 1 }], { d: 1 }); assemble(to, 120);
  }
  const def = registry.modules[name];
  if (def) { try { def.enter && def.enter(); def.enterTab && def.enterTab(modState[name].tab, $(`#v-${name} .tab[data-tab="${modState[name].tab}"]`), ctxFor(m)); } catch (e) { console.error(e); } }
  if (outA) outA.finished.then(() => { if (token === navToken && state.view !== fromName) from.classList.remove('is-on'); if (token === navToken) SH.homeAnimating = false; }).catch(() => {});
  $$('.view.is-on').forEach(v => { if (v !== to && v !== from) v.classList.remove('is-on'); });
  pushHist();
}
SH.go = go;
const COMP_TAB = { cpu: 'cpu', gpu: 'gpu', ram: 'memory', ssd: 'disks', wifi: 'network', battery: 'battery', display: 'overview', audio: 'overview', sys: 'health' };
SH.openComponent = id => go('monitor', { tab: COMP_TAB[id] || 'overview' });
$('#brand').addEventListener('click', () => go('home')); $('#brand').title = SH.t('Go Home');

/* ================= command palette ================= */
const BUILTIN = [
  { t: SH.t('Check for new drivers'), go: 'drivers', tab: 'updates', ic: 'drivers' },
  { t: SH.t('Back up your drivers'), go: 'drivers', tab: 'backup', ic: 'download' },
  { t: SH.t('Uninstall a program'), go: 'remover', tab: 'programs', ic: 'remover' },
  { t: SH.t('Restore something from quarantine'), go: 'remover', tab: 'quarantine', ic: 'restore' },
  { t: SH.t('Update all programs'), go: 'updater', tab: 'overview', ic: 'updater' },
  { t: SH.t('Check for Windows updates'), go: 'updater', tab: 'windows', ic: 'windows' },
  { t: SH.t('What is taking up drive C:'), go: 'storage', tab: 'map', ic: 'storage' },
  { t: SH.t('Find duplicate files'), go: 'storage', tab: 'duplicates', ic: 'copy' },
  { t: SH.t('Clean temporary files'), go: 'optimizer', tab: 'clean', ic: 'broom' },
  { t: SH.t('Speed up Windows startup'), go: 'optimizer', tab: 'startup', ic: 'bolt' },
  { t: SH.t('Repair Windows'), go: 'optimizer', tab: 'repair', ic: 'wrench' },
  { t: SH.t('Check the GPU temperature'), go: 'monitor', tab: 'gpu', ic: 'temp' },
  { t: SH.t('See which programs use the most memory'), go: 'monitor', tab: 'processes', ic: 'ram' },
  { t: SH.t('Battery health'), go: 'monitor', tab: 'battery', ic: 'battery' },
  { t: SH.t('Test the keyboard'), go: 'tester', tab: 'keyboard', ic: 'keyboard' },
  { t: SH.t('Look for dead pixels'), go: 'tester', tab: 'screen', ic: 'display' },
  { t: SH.t('Create an automatic routine'), go: 'autopilot', tab: 'routines', ic: 'autopilot' },
  { t: SH.t('Turn on administrator mode'), go: 'admin', ic: 'shield' },
  { t: SH.t('Change the theme and colors'), go: 'settings', section: 'look', ic: 'palette' },
  { t: SH.t('Change the interface size'), go: 'settings', section: 'look', ic: 'sliders' },
  { t: SH.t('Change the animation intensity'), go: 'settings', section: 'motion', ic: 'sparkle' },
  { t: SH.t('Change the sound volume'), go: 'settings', section: 'sound', ic: 'speaker' },
  { t: SH.t('Change the Home view'), go: 'settings', section: 'home', ic: 'layers' },
  { t: SH.t('Check for StellarHub updates'), go: 'settings', section: 'updates', ic: 'download' },
];
/* g is the group id (compared below); its name is translated when shown */
const GROUP = { Modules: SH.t('Modules'), Sections: SH.t('Sections'), Actions: SH.t('Actions') };
function paletteItems() {
  const list = [];
  MODS.forEach(m => list.push({ t: m.name, go: m.id, ic: m.icon, g: 'Modules' }));
  MODS.forEach(m => tabsOf(m).forEach(t => list.push({ t: t.name, path: m.name, go: m.id, tab: t.id, ic: m.icon, g: 'Sections' })));
  [...BUILTIN, ...registry.actions].forEach(a => { if (!a.when || a.when()) list.push({ ...a, g: 'Actions' }); }); /* an action may carry `when`: hidden while it is false */
  return list;
}
/* a module that is busy (or finished while the user was elsewhere) says so in its palette row, as on the dock */
function palAct(id) {
  const run = SH.activity.of(id), done = !run && SH.activity.done(id);
  if (run) return `<small class="pa${run.pct == null ? ' ind' : ''}" style="--p:${run.pct == null ? 0 : run.pct.toFixed(3)}"><svg viewBox="0 0 16 16"><circle class="tr" cx="8" cy="8" r="6"/><circle class="arc" cx="8" cy="8" r="6" pathLength="100" transform="rotate(-90 8 8)"/></svg>${esc(SH.activity.pct(run) || run.text || run.label)}</small>`;
  if (done) return `<small class="pa ${done.ok ? 'ok' : 'err'}"><i></i>${esc(done.ok ? SH.t('Finished') : SH.t('Needs a look'))}</small>`;
  return '';
}
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let palList = [], palIdx = 0; const hlY = new Spring(0, 420, 30);
function renderPal(q) {
  const n = norm(q.trim()); const all = paletteItems();
  palList = n ? all.filter(i => n.split(/\s+/).every(w => norm(i.t + ' ' + (i.path || '')).includes(w))) : all.filter(i => i.g !== 'Sections');
  palList = palList.slice(0, 40); palIdx = 0; const res = $('#palRes');
  if (!palList.length) { res.innerHTML = SH.emptyState({ art: 'none', small: true, title: SH.t('Nothing matches “{q}”. Try “drivers”, “disk” or “clean”.', { q: esc(q) }) }); return; }
  let html = '<div class="hl" id="palHl"></div>', g = '';
  palList.forEach((it, i) => { if (it.g !== g) { g = it.g; html += `<div class="grp">${GROUP[g] || g}</div>`; }
    html += `<button class="it" data-i="${i}"><span class="ic">${ic(it.ic)}</span>${it.path ? `<span class="path">${esc(it.path)}</span>` : ''}${esc(it.t)}${(it.g === 'Modules' && palAct(it.go)) || `<small>${it.g === 'Actions' ? SH.t('Run') : SH.t('Open')}</small>`}</button>`; });
  res.innerHTML = html;
  $$('.it', res).forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translate3d(0,6px,0)' }, { opacity: 1, transform: 'translate3d(0,0,0)' }], { d: 260, delay: Math.min(i, 8) * 22 }));
  setPalIdx(0, true);
}
function setPalIdx(i, snap) {
  if (!palList.length) return; palIdx = (i + palList.length) % palList.length;
  const items = $$('#palRes .it'); items.forEach((el, k) => el.classList.toggle('on', k === palIdx));
  const el = items[palIdx]; hlY.t = el.offsetTop; if (snap) hlY.set(hlY.t);
  el.scrollIntoView({ block: 'nearest' });
}
tickers.add(dt => { if (!state.palOpen) return; const h = $('#palHl'); if (!h) return; hlY.step(dt); h.style.transform = `translateY(${hlY.v.toFixed(2)}px)`; });
function openPal() {
  if (state.setOpen) closeSettings(true);
  state.palOpen = true; const o = $('#palO'); o.classList.add('on'); SH.sound('palette_open');
  anim($('.scrim', o), [{ opacity: 0 }, { opacity: 1 }], { d: 220 });
  anim($('#pal'), [{ opacity: 0, transform: 'translate3d(0,-14px,0) scale(.95)', filter: 'blur(8px)' }, { opacity: 1, transform: 'translate3d(0,0,0) scale(1)', filter: 'blur(0px)' }], { d: 380, e: EASE.spring });
  const inp = $('#palIn'); inp.value = ''; renderPal(''); setTimeout(() => inp.focus(), 10);
}
/* quiet: what comes next makes its own sound (the item run from it, the settings sheet opening) */
function closePal(quiet) {
  if (!state.palOpen) return; state.palOpen = false; const o = $('#palO');
  if (quiet !== true) SH.sound('panel_close');
  anim($('.scrim', o), [{ opacity: 1 }, { opacity: 0 }], { d: 160 });
  const a = anim($('#pal'), [{ opacity: 1, transform: 'translate3d(0,0,0) scale(1)', filter: 'blur(0px)' }, { opacity: 0, transform: 'translate3d(0,-8px,0) scale(.97)', filter: 'blur(4px)' }], { d: 160 });
  a.finished.then(() => { if (!state.palOpen) o.classList.remove('on'); }).catch(() => {});
}
$('#searchBtn').addEventListener('click', openPal);
$('#palIn').addEventListener('input', e => renderPal(e.target.value));
$('#palRes').addEventListener('click', e => { const b = e.target.closest('.it'); if (b) runItem(palList[+b.dataset.i]); });
$('#palRes').addEventListener('pointermove', e => { const b = e.target.closest('.it'); if (b && +b.dataset.i !== palIdx) setPalIdx(+b.dataset.i); });
/* the item's own sound follows (the view it opens, the settings sheet...): the click on it stays silent */
function runItem(it) { if (!it) return; SH.sound.claim(); closePal(true); setTimeout(() => { if (it.run) it.run(); else go(it.go, { tab: it.tab, section: it.section }); }, 90 * motion()); }
SH.openPalette = openPal;

/* ================= settings ================= */
const ACCENTS = [['#FF7A66', '#9ED6FF', SH.t('Coral and ice')], ['#9ED6FF', '#FF9E7A', SH.t('Ice and coral')], ['#F4C26B', '#8FD3E8', SH.t('Amber')], ['#7FE0B4', '#FFB08A', SH.t('Mint')], ['#FF8FB1', '#A6E3FF', SH.t('Pink')], ['#C9D4E8', '#FF7A66', SH.t('Silver')]];
const ZOOMS = [['0.8', '80 %'], ['0.9', '90 %'], ['1', '100 %'], ['1.1', '110 %'], ['1.15', '115 %'], ['1.25', '125 %'], ['1.4', '140 %']];
/* language picker: flags drawn as small SVGs (no emoji, which Windows shows as letters) */
const STAR = (cx, cy, r, rot = 0) => { let d = ''; for (let i = 0; i < 10; i++) { const a = rot - Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .4 : r; d += (i ? 'L' : 'M') + (cx + rr * Math.cos(a)).toFixed(2) + ' ' + (cy + rr * Math.sin(a)).toFixed(2); } return d + 'Z'; };
const FLAGS = {
  en: () => { let s = ''; for (let i = 0; i < 7; i++) s += `<rect y="${(i * 20 / 7).toFixed(2)}" width="30" height="${(20 / 7).toFixed(2)}" fill="${i % 2 ? '#fff' : '#B22234'}"/>`;
    s += '<rect width="13" height="11.43" fill="#3C3B6E"/>'; for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) s += `<circle cx="${1.6 + c * 2.45}" cy="${1.6 + r * 2.7}" r=".55" fill="#fff"/>`; return s; },
  es: () => '<rect width="30" height="20" fill="#AA151B"/><rect y="5" width="30" height="10" fill="#F1BF00"/>',
  pt: () => '<rect width="30" height="20" fill="#009C3B"/><path d="M3 10 15 2.6 27 10 15 17.4Z" fill="#FFDF00"/><circle cx="15" cy="10" r="4.6" fill="#002776"/><path d="M10.6 8.9c3-.9 6.2-.6 8.9.8" stroke="#fff" stroke-width=".9" fill="none"/>',
  it: () => '<rect width="10" height="20" fill="#009246"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#CE2B37"/>',
  fr: () => '<rect width="10" height="20" fill="#0055A4"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#EF4135"/>',
  zh: () => `<rect width="30" height="20" fill="#EE1C25"/><path d="${STAR(5.5, 5.5, 3.2)}" fill="#FFDE00"/>${[[11, 2.2, .6], [13, 4.4, 1.2], [13, 7.4, .2], [11, 9.4, .9]].map(([x, y, r]) => `<path d="${STAR(x, y, 1.05, r)}" fill="#FFDE00"/>`).join('')}`,
  ja: () => '<rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="6" fill="#BC002D"/>',
  ru: () => '<rect width="30" height="20" fill="#fff"/><rect y="6.667" width="30" height="6.667" fill="#0039A6"/><rect y="13.333" width="30" height="6.667" fill="#D52B1E"/>',
};
const flag = code => code === 'auto' ? `<span class="flag auto">${ic('globe')}</span>` : `<span class="flag"><svg viewBox="0 0 30 20" aria-hidden="true">${FLAGS[code]()}</svg></span>`;
function langPicker() {
  const L = SH.i18n, cur = S().language || 'auto';
  const sys = L.LANGS.find(l => l[0] === L.systemLang()) || L.LANGS[0];
  const tiles = [['auto', SH.t('Automatic'), SH.t('Same as Windows: {lang}', { lang: sys[1] })], ...L.LANGS.map(([c, own, eng]) => [c, own, SH.t(eng)])];
  return `<div class="langs">${tiles.map(([c, a, b]) => `<button class="lang${c === cur ? ' on' : ''}" data-lang="${c}">${flag(c)}<span><b>${a}</b><small>${b}</small></span>${ic('check')}</button>`).join('')}</div>`;
}
const SECTIONS = [['look', SH.t('Appearance'), 'palette'], ['language', SH.t('Language'), 'globe'], ['background', SH.t('Background'), 'sparkle'], ['motion', SH.t('Animation'), 'play'], ['sound', SH.t('Sound'), 'speaker'], ['home', SH.t('Home'), 'home'], ['widget', SH.t('Widget'), 'monitor'], ['general', SH.t('General'), 'sliders'], ['tools', SH.t('Tools'), 'wrench'], ['data', SH.t('Data'), 'folder'], ['backups', SH.t('Backups and restore'), 'restore'], ['keys', SH.t('Shortcuts'), 'keyboard'], ['admin', SH.t('Administrator'), 'shield'], ['updates', SH.t('Updates'), 'download'], ['about', SH.t('About'), 'info']];
const seg = (key, opts) => `<div class="seg" data-key="${key}"><span class="ind"></span>${opts.map(([v, l]) => `<button data-v="${v}"${String(S()[key]) === v ? ' class="on"' : ''}>${l}</button>`).join('')}</div>`;
const tog = (key, label, sub) => `<div class="set inline"><div class="lbl"><div>${label}${sub ? `<span>${sub}</span>` : ''}</div></div><button class="toggle${S()[key] ? ' on' : ''}" data-key="${key}" aria-label="${label}"><i></i></button></div>`;
/* slider: live value, saved on release */
const rng = (key, label, sub, min, max, step, fmt) => `<div class="set"><div class="lbl"><div>${label}${sub ? `<span>${sub}</span>` : ''}</div><b class="rv" data-rv="${key}">${fmt(S()[key])}</b></div>
  <input type="range" class="rng" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${S()[key]}" style="--p:${(S()[key] - min) / (max - min) * 100}%"></div>`;
const RNG_FMT = { starCount: v => v == 0 ? SH.t('none') : SH.fmtInt(v), starSpeed: v => SH.fmt1(v) + '×', starBright: v => Math.round(v * 100) + '%', nebula: v => Math.round(v * 100) + '%', animSpeed: v => SH.fmt1(v) + '×', panelAlpha: v => Math.round(v * 100) + '%', soundVolume: v => Math.round(v * 100) + '%' };
const TOOLS = [['devmgmt', SH.t('Device Manager'), 'drivers'], ['services', SH.t('Services'), 'sliders'], ['eventvwr', SH.t('Event Viewer'), 'list'], ['taskschd', SH.t('Task Scheduler'), 'calendar'],
  ['diskmgmt', SH.t('Disk Management'), 'ssd'], ['taskmgr', SH.t('Task Manager'), 'monitor'], ['resmon', SH.t('Resource Monitor'), 'monitor'], ['msinfo32', SH.t('System Information'), 'info'],
  ['msconfig', SH.t('System Configuration'), 'gear'], ['regedit', SH.t('Registry Editor'), 'code'], ['sysdm', SH.t('System Properties'), 'windows'], ['perf', SH.t('Visual effects'), 'sparkle'],
  ['powercfg', SH.t('Power Options'), 'power'], ['ncpa', SH.t('Network Connections'), 'wifi'], ['appwiz', SH.t('Programs and Features'), 'package'], ['control', SH.t('Control Panel'), 'grid'],
  ['cleanmgr', SH.t('Disk Cleanup'), 'broom'], ['dfrgui', SH.t('Optimize Drives'), 'storage'], ['rstrui', SH.t('System Restore'), 'restore'], ['cmd', SH.t('Command Prompt'), 'code'], ['powershell', 'PowerShell', 'code']];
const INT_HINT = { max: SH.t('Everything moves: stars, camera flights and full transitions.'), normal: SH.t('Shorter animations and slower stars.'), min: SH.t('Brief transitions. The stars stand still.') };
/* sections that live in their own file register here: SH.settingsSections[id] = { html(), mount(el) } */
SH.settingsSections = SH.settingsSections || {};
function sectionHTML(id) {
  if (SH.settingsSections[id]) return SH.settingsSections[id].html();
  const st = S(), t = SH.t;
  switch (id) {
    case 'look': return `<h3>${t('Appearance')}</h3><p>${t('How StellarHub looks.')}</p>
      <div class="set"><div class="lbl">${t('Theme')}</div>${seg('theme', [['deep', t('Deep space')], ['dusk', t('Dusk')], ['eclipse', t('Eclipse')]])}</div>
      <div class="set"><div class="lbl">${t('Colors')}</div><div class="sw-row" id="swatches">${ACCENTS.map(([a, b, n]) => `<button class="swatch${st.accent === a && st.accent2 === b ? ' on' : ''}" style="--s:${a};--s2:${b}" data-a="${a}" data-b="${b}" aria-label="${n}" title="${n}"></button>`).join('')}
        <button class="swatch custom${ACCENTS.some(([a, b]) => st.accent === a && st.accent2 === b) ? '' : ' on'}" id="swCustom" style="--s:${st.accent};--s2:${st.accent2}" aria-label="${t('Custom colors')}" title="${t('Custom colors')}"><span>${ic('plus')}</span></button></div>
        <div class="cpick-row" id="cpickRow"${ACCENTS.some(([a, b]) => st.accent === a && st.accent2 === b) ? ' hidden' : ''}><span>${t('Primary')}</span><input type="color" data-color="accent" value="${st.accent}" aria-label="${t('Primary color')}"><span>${t('Secondary')}</span><input type="color" data-color="accent2" value="${st.accent2}" aria-label="${t('Secondary color')}"></div></div>
      <div class="set"><div class="lbl"><div>${t('Interface size')}<span>${t('Automatic picks the one that best fits your screen ({pct}%).', { pct: Math.round(autoZoom * 100) })}</span><span class="zn" id="zoomNote">${zoomNote()}</span></div><button class="btn sm sec" data-act="autozoom">${ic('sparkle')}${t('Automatic')}</button></div>${seg('zoom', ZOOMS)}</div>
      <div class="set"><div class="lbl">${t('Density')}</div>${seg('density', [['comfortable', t('Comfortable')], ['compact', t('Compact')]])}</div>
      <div class="set"><div class="lbl">${t('Corners')}</div>${seg('corners', [['soft', t('Very round')], ['mid', t('Round')], ['sharp', t('Square')]])}</div>
      ${rng('panelAlpha', t('Solid panels'), t('Raise it so the stars show less behind the panels.'), 1, 2, .05, RNG_FMT.panelAlpha)}`;
    case 'background': return `<h3>${t('Background')}</h3><p>${t('The space behind everything.')}</p>
      ${tog('stars', t('Stardust'), t('The animated background.'))}
      ${rng('starCount', t('Number of stars'), '', 0, 900, 10, RNG_FMT.starCount)}
      ${rng('starSpeed', t('Drift speed'), t('How fast they move.'), 0, 4, .1, RNG_FMT.starSpeed)}
      ${rng('starBright', t('Brightness'), '', .2, 2, .05, RNG_FMT.starBright)}
      ${tog('twinkle', t('Twinkle'), t('The stars twinkle softly.'))}
      ${tog('shooting', t('Shooting stars'), t('Every now and then one goes by.'))}
      ${rng('nebula', t('Nebula'), t('The colored glow in the corners.'), 0, 2, .05, RNG_FMT.nebula)}`;
    case 'motion': return `<h3>${t('Animation')}</h3><p>${t('How much the interface moves.')}</p>
      <div class="set"><div class="lbl">${t('Intensity')}</div>${seg('intensity', [['max', t('Maximum')], ['normal', t('Normal')], ['min', t('Minimum')]])}<div class="hint" id="intHint">${INT_HINT[st.intensity]}</div></div>
      ${rng('animSpeed', t('Speed'), t('Lower means slower, more cinematic animations.'), .5, 2, .1, RNG_FMT.animSpeed)}
      ${tog('camera', t('Camera flights'), t('The zoom that flies through the scene when you switch modules.'))}
      ${tog('parallax', t('Mouse depth'), t('The layers shift slightly as you move the mouse.'))}
      ${tog('countUp', t('Counting numbers'), t('Figures count up to their value when they appear.'))}
      <div class="set"><div class="lbl"><div>${t('Lighter effects')}<span>${t('Simpler effects and a calmer starfield, so it stays smooth and uses less of the graphics chip. On battery, live data is also slower. Automatic turns it on when the PC runs on battery or has only integrated graphics.')}</span></div></div>${seg('lightMode', [['auto', t('Automatic')], ['always', t('Always')], ['never', t('Never')]])}</div>`;
    case 'sound': return `<h3>${t('Sound')}</h3><p>${t('Short, quiet sounds that confirm what you do.')}</p>
      ${tog('sounds', t('Sounds'), t('Turn every sound on or off.'))}
      ${rng('soundVolume', t('Volume'), '', 0, 1, .05, RNG_FMT.soundVolume)}
      ${tog('soundUi', t('Interface'), t('Clicks, tabs, menus, panels, switches and controller moves.'))}
      ${tog('soundAlerts', t('Notifications'), t('Messages, warnings, errors and achievements.'))}
      ${tog('soundTasks', t('Tasks'), t('Scans, loading, refreshing, deleting, undoing and copying.'))}
      ${tog('soundSystem', t('System'), t('Opening and quitting, administrator mode, updates, controllers, the widget and the keyboard test.'))}
      <div class="set inline"><div class="lbl"><div>${t('Play a sample')}<span>${t('Hear how loud they are.')}</span></div></div><button class="btn sec" data-act="soundsample">${ic('speaker')}${t('Play a sample')}</button></div>`;
    case 'home': return `<h3>${t('Home')}</h3><p>${t('What you see when you open StellarHub.')}</p>
      <div class="set"><div class="lbl">${t('PC view')}</div><div class="vcards" id="vcards">${variantCards()}</div></div>
      <div class="set"><div class="lbl"><div>${t('When the app opens')}<span>${t('Where you start each time.')}</span></div></div>${seg('startView', [['home', t('Home')], ['monitor', t('Live Monitor')], ['last', t('Where I left off')]])}</div>
      ${tog('quickActions', t('Quick actions'), t('The buttons in the Home header.'))}`;
    case 'widget': {
      const W = [['cpu', t('CPU usage')], ['cpuTemp', t('CPU temperature')], ['gpu', t('GPU usage')], ['gpuTemp', t('GPU temperature')], ['gpuPower', t('GPU power draw')], ['ram', t('Memory')], ['vram', t('Video memory')], ['down', t('Download')], ['up', t('Upload')], ['ping', t('Latency')], ['disk', t('Disk activity')]];
      const on = st.widgetStats;
      return `<h3>${t('Widget')}</h3><p>${t('A small always-on-top window with the stats you choose. Drag it wherever you like. Changes apply instantly.')}</p>
      <div class="set inline"><div class="lbl"><div>${t('Widget')}<span>${t('Also from Home, the top bar and the tray.')}</span></div></div><button class="toggle${SH.widgetOn ? ' on' : ''}" data-act="widget" aria-label="${t('Widget')}"><i></i></button></div>
      <div class="set"><div class="lbl"><div>${t('Size')}<span>${t('Small is a thin bar with the numbers; large adds charts. You can also switch it from the widget itself.')}</span></div></div>${seg('widgetMode', [['mini', t('Small')], ['full', t('Large')]])}</div>
      <div class="set"><div class="lbl">${t('Large layout')}</div>${seg('widgetLayout', [['grid', t('Grid')], ['row', t('Row')], ['list', t('List')]])}</div>
      <div class="set"><div class="lbl">${t('What it shows')}</div>
        ${W.map(([k, n]) => `<div class="set inline" style="padding:8px 0;border:0"><div class="lbl">${n}</div><button class="toggle${on.includes(k) ? ' on' : ''}" data-wstat="${k}" aria-label="${n}"><i></i></button></div>`).join('')}</div>
      <p class="set-note">${t('It opens with StellarHub if you left it open last time, and stays closed if you closed it.')}</p>`;
    }
    case 'language': return `<h3>${t('Language')}</h3><p>${t('The whole app, the widget and the tray menu.')}</p>
      <div class="set">${langPicker()}</div>`;
    case 'general': return `<h3>${t('General')}</h3><p>${t('How the app behaves.')}</p>
      ${state.portable ? `<div class="set-note">${t('This is the portable version: it does not add itself to Windows startup, so it leaves nothing behind on the PC.')}</div>` : tog('startWithWindows', t('Open when Windows starts'), t('Starts hidden in the tray, with no window.'))}
      ${tog('trayOnClose', t('Close to the tray'), t('The X hides the window; StellarHub keeps running in the tray. To quit: right-click the icon > Quit.'))}
      <div class="set inline"><div class="lbl"><div>${t('Controller navigation')}<span>${t('Use a game controller to move around StellarHub. Turn it off if it gets in the way.')}</span></div></div><button class="toggle${S().gamepadNav !== false ? ' on' : ''}" data-key="gamepadNav" aria-label="${t('Controller navigation')}"><i></i></button></div>
      ${tog('autoAnalyze', t('Analyze automatically when opening a module'), t('Storage Checker, Super Optimizer, Privacy & Security and Program Updater check the PC as soon as you open them. Off: they show the last results and wait for you to press Analyze.'))}
      ${tog('registryCleaner', t('Registry cleaner'), t("Microsoft doesn't usually recommend registry cleaners: Windows doesn't need one to stay fast. You can turn it on if you'd like to use it; everything it changes is backed up and can be undone."))}
      ${tog('confirmDanger', t('Confirm anything that cannot be undone'), t('Everything else always has an undo button.'))}
      <div class="set"><div class="lbl"><div>${t('Live data refresh rate')}<span>${t('Faster is smoother; slower uses less power.')}</span></div></div>${seg('teleRate', [['500', t('Fast')], ['1000', t('Normal')], ['2000', t('Saver')]])}</div>
      ${tog('measurePing', t('Measure the connection latency'), t('Every 2 seconds while StellarHub is open, it opens a connection to 1.1.1.1 (Cloudflare) and times it. Nothing is sent. Turn it off and latency shows as —.'))}`;
    case 'tools': return `<h3>${t('Windows tools')}</h3><p>${t('The system tools that are usually hidden away, one click away.')}</p>
      <div class="tools">${TOOLS.map(([k, n, i]) => `<button class="tool" data-tool="${k}"><span class="ti">${ic(i)}</span>${n}</button>`).join('')}</div>`;
    case 'data': return `<h3>${t('Data')}</h3><p>${t('Your settings and the data StellarHub keeps on this PC.')}</p>
      <div class="set inline"><div class="lbl"><div>${t('Export settings')}<span>${t('A .json file to take them to another PC.')}</span></div></div><button class="btn sec" data-act="export">${ic('upload')}${t('Export')}</button></div>
      <div class="set inline"><div class="lbl"><div>${t('Import settings')}<span>${t('From a file you exported before.')}</span></div></div><button class="btn sec" data-act="import">${ic('download')}${t('Import')}</button></div>
      <div class="set inline"><div class="lbl"><div>${t('Data folder')}<span>${t('Settings, logs and quarantine.')}</span></div></div><button class="btn sec" data-act="datadir">${ic('folder')}${t('Open')}</button></div>
      <div class="set inline"><div class="lbl"><div>${t('Reset settings')}<span>${t('Puts the settings back the way they came. Your scheduled tasks, history and kits are kept. You can undo it.')}</span></div></div><button class="btn danger" data-act="reset">${t('Reset')}</button></div>`;
    case 'keys': return `<h3>${t('Shortcuts')}</h3><p>${t('To get around without the mouse.')}</p>
      <div class="keys">${[['Ctrl K', t('Search for a tool or action')], ['Ctrl ,', t('Open settings')], [t('Ctrl 1 to 9'), t('Go to a module')], ['Alt ← / Alt →', t('Back and forward')], [t('Mouse side buttons'), t('Back and forward')], ['Esc', t('Close or go back Home')], [t('Double-click the top bar'), t('Maximize or restore')]].map(([k, d]) => `<div><kbd>${k}</kbd><span>${d}</span></div>`).join('')}</div>`;
    case 'admin': return `<h3>${t('Administrator')}</h3><p>${t('Installing drivers, cleaning system files and repairing Windows need administrator rights. Without them, StellarHub runs in limited mode.')}</p>
      <div class="set inline"><div class="lbl"><div>${t('Status')}<span>${state.admin ? t('StellarHub is running as administrator.') : t('You are in normal mode right now.')}</span></div></div>${state.admin ? `<span class="chip ok">${t('Administrator')}</span>` : `<button class="btn pri" data-act="admin">${t('Turn on')}</button>`}</div>
      ${tog('alwaysAdmin', t('Always open as administrator'), state.portable ? t('The portable version asks Windows each time it opens, because it leaves no scheduled task on the PC.')
        /* a per-user install: its folder is the user's, so no task may open it elevated (elevation.uses_admin_task) */
        : state.adminTask === false ? t('Windows asks each time. To open without asking, install StellarHub for all users.')
        : t('Windows asks once when you turn it on; after that StellarHub opens as administrator without asking (like other tools, it uses a scheduled task).'))}
      ${tog('adminHints', t('Suggest administrator mode'), t('A subtle hint when a feature needs it.'))}`;
    case 'updates': return `<h3>${t('Updates')}</h3><p>${t('StellarHub updates itself from its GitHub repository.')}</p>
      <div class="set inline"><div class="lbl"><div>${t('Installed version')}<span>StellarHub ${state.version}${state.portable ? ' · ' + t('portable') : ''}</span></div></div><button class="btn sec" data-act="checkupd">${ic('updater')}${t('Check now')}</button></div>
      <div class="upd-state" id="updState"></div>
      ${tog('autoUpdate', t('Check for updates automatically'), t('When the app opens and every few hours. Big versions (like 2.0.0) are announced with a window, and small fixes (like 1.2.3) wait here.'))}
      ${tog('autoUpdateFeatures', t('Install new features automatically'), t('Versions with new features (like 1.2.0) download in the background and install the next time you open StellarHub. Turn it off to choose each time.'))}`;
    case 'about': return `<div class="about-h"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3.2" style="fill:var(--accent)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-24 12 12)" style="stroke:var(--accent2)" stroke-width="1.4"/><circle cx="20.2" cy="8.3" r="1.5" style="fill:var(--accent2)"/></svg>
        <div><h3>StellarHub</h3><p>${t('Version {v}. The control center for your PC.', { v: state.version + (state.portable ? ' ' + t('(portable)') : '') })}</p></div></div>
      <div class="set inline"><div class="lbl"><div>${t('Created by')}<span>${t('Esteban Arosemena and Claude')}</span></div></div></div>
      <div class="set inline"><div class="lbl"><div>${t('Source code')}<span>${t('Free software under the GNU GPLv3 license.')} github.com/estebanarosemena/StellarHub</span></div></div><button class="btn sec" data-act="github">${ic('external')}${t('Open in GitHub')}</button></div>
      <div class="set"><div class="lbl"><div>${t('Languages')}<span>${t('How much code there is in each.')}</span></div></div><div id="langs" class="langs"><div class="sk" style="height:10px"></div></div></div>
      <div class="set inline"><div class="lbl"><div>${t('Built with')}<span>${t('Python, pywebview and WebView2; three.js for the 3D model; Unbounded and Onest fonts.')}</span></div></div></div>
      <div class="set inline"><div class="lbl"><div>${t('Sounds')}<span>${t('Orbital, an original set made for StellarHub (CC0). The soft hover sound is based on “UI hover” by unfa on Freesound (CC0).')}</span></div></div><button class="btn sec" data-act="freesound">${ic('external')}Freesound</button></div>
      <div class="set inline"><div class="lbl"><div>${t('Notification sound')}<span>${t('The notification sound is “UI_Single_Set 2_01” from “UI Utility Pack Vol 1” by JC Sounds on OpenGameArt, licensed under CC BY 4.0; trimmed, faded and loudness-normalized.')}</span></div></div><button class="btn sec" data-act="jcsounds">${ic('external')}OpenGameArt</button></div>
      <div class="set inline"><div class="lbl"><div>${t('This PC')}<span>${esc(SH.PC.model)}, ${esc(SH.PC.os)}</span></div></div></div>`;
  }
  return '';
}
function variantCards() {
  const vs = Object.values(registry.variants);
  if (!vs.length) return `<div class="muted">${SH.t('No views installed yet.')}</div>`;
  return vs.map(v => `<button class="vcard${S().homeVariant === v.id ? ' on' : ''}" data-variant="${v.id}"><b>${esc(v.name)}</b><span>${esc(v.desc || '')}</span></button>`).join('');
}
SH.on('variant:registered', () => { const c = $('#vcards'); if (c) c.innerHTML = variantCards(); });
let secOn = 'look'; const secInd = new Spring(0, 380, 30);
const sheet = $('#sheet');
sheet.innerHTML = `<nav><h2>${SH.t('Settings')}</h2><span class="ind" id="secInd"></span>${SECTIONS.map(([id, n, i]) => `<button data-sec="${id}" title="${n}"${id === secOn ? ' class="on"' : ''}>${ic(i)}<span>${n}</span></button>`).join('')}<div class="ver">StellarHub ${state.version}</div></nav>
  <div class="body" id="setBody"></div><button class="iconbtn x" data-close aria-label="${SH.t('Close')}">${ic('x')}</button>`;
function showSection(id, first) {
  secOn = id; $$('nav [data-sec]', sheet).forEach(b => b.classList.toggle('on', b.dataset.sec === id));
  const b = $(`nav [data-sec="${id}"]`, sheet); b.scrollIntoView({ block: 'nearest' }); secInd.t = b.offsetTop; if (first) secInd.set(secInd.t);
  const body = $('#setBody'); body.innerHTML = `<div class="sec">${sectionHTML(id)}</div>`;
  $$('.sec > *', body).forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translate3d(14px,0,0)' }, { opacity: 1, transform: 'translate3d(0,0,0)' }], { d: 380, delay: 30 + i * 35, e: EASE.spring }));
  requestAnimationFrame(() => $$('.seg', body).forEach(s => placeSeg(s, true)));
  if (id === 'about') renderLangs();
  if (id === 'updates' && SH.selfUpdate) SH.selfUpdate.paintSettings($('#updState', body));
  const ext = SH.settingsSections[id]; if (ext && ext.mount) ext.mount($('.sec', body));
}
tickers.add(dt => { if (!state.setOpen) return; secInd.step(dt); $('#secInd').style.transform = `translateY(${secInd.v.toFixed(2)}px)`; });
sheet.addEventListener('click', e => {
  const sec = e.target.closest('[data-sec]'); if (sec) { if (sec.dataset.sec !== secOn) { showSection(sec.dataset.sec); SH.sound('tab_switch'); } return; }
  const sb = e.target.closest('.seg button'); if (sb) { const s = sb.parentElement; if (sb.classList.contains('on')) return; $$('button', s).forEach(x => x.classList.toggle('on', x === sb)); placeSeg(s); applySetting(s.dataset.key, sb.dataset.v); return; }
  const ws = e.target.closest('.toggle[data-wstat]'); if (ws) {
    ws.classList.toggle('on'); const list = $$('.toggle[data-wstat]', sheet).filter(x => x.classList.contains('on')).map(x => x.dataset.wstat);
    if (!list.length) { ws.classList.add('on'); toast(SH.t('The widget needs at least one stat.')); return; }
    SH.setSetting('widgetStats', list); return;
  }
  const t = e.target.closest('.toggle[data-key]'); if (t) { t.classList.toggle('on'); applySetting(t.dataset.key, t.classList.contains('on')); return; }
  const swc = e.target.closest('#swCustom'); if (swc) {
    $$('.swatch', sheet).forEach(x => x.classList.toggle('on', x === swc)); const row = $('#cpickRow');
    if (row.hidden) { row.hidden = false; anim(row, [{ opacity: 0, transform: 'translate3d(0,-6px,0)' }, { opacity: 1, transform: 'none' }], { d: 320, e: EASE.spring }); }
    return;
  }
  const sw = e.target.closest('.swatch'); if (sw) { $$('.swatch', sheet).forEach(x => x.classList.toggle('on', x === sw)); SH.setSetting('accent', sw.dataset.a); SH.setSetting('accent2', sw.dataset.b); applyLook(); return; }
  const vc = e.target.closest('[data-variant]'); if (vc) { $$('[data-variant]', sheet).forEach(x => x.classList.toggle('on', x === vc)); applySetting('homeVariant', vc.dataset.variant); return; }
  const lb = e.target.closest('[data-lang]'); if (lb) { setLanguage(lb.dataset.lang, lb); return; }
  const tool = e.target.closest('[data-tool]'); if (tool) { SH.call('run_tool', tool.dataset.tool).then(r => r === undefined ? toast(SH.t('This only works inside the app.')) : !r && toast(SH.t('Windows could not open that tool.'))); return; }
  const act = e.target.closest('[data-act]'); if (act) runAct(act.dataset.act);
});
async function runAct(a) {
  if (a === 'admin') askAdmin(true);
  else if (a === 'checkupd') {
    const b = $('[data-act="checkupd"]'); if (!SH.selfUpdate || (b && b.disabled)) return;
    const html = b && b.innerHTML; if (b) { b.disabled = true; b.classList.add('su-busy'); b.innerHTML = `<span class="su-spin"></span>${SH.t('Checking GitHub…')}`; }
    try { await SH.selfUpdate.check(true); } finally { if (b && b.isConnected) { b.disabled = false; b.classList.remove('su-busy'); b.innerHTML = html; } }
  }
  else if (a === 'github') { if (await SH.call('open_url', 'https://github.com/estebanarosemena/StellarHub') === undefined) window.open('https://github.com/estebanarosemena/StellarHub'); }
  else if (a === 'freesound') { const u = 'https://freesound.org/people/unfa/sounds/565131/'; if (await SH.call('open_url', u) === undefined) window.open(u); }
  else if (a === 'jcsounds') { const u = 'https://opengameart.org/content/jc-sounds-ui-utility-pack-vol-1'; if (await SH.call('open_url', u) === undefined) window.open(u); }
  else if (a === 'soundsample') SH.sound('success', { preview: true });
  else if (a === 'autozoom') {
    const v = String(autoZoom); const s = $('.seg[data-key="zoom"]', sheet);
    if (s) { $$('button', s).forEach(x => x.classList.toggle('on', x.dataset.v === v)); placeSeg(s); }
    SH.setSetting('zoom', 'auto'); computeAutoZoom(); applyZoom(); toast(SH.t('Automatic size: {pct}%.', { pct: Math.round(autoZoom * 100) })); /* 'auto' keeps adapting to the window */
  }
  else if (a === 'widget' && SH.toggleWidget) SH.toggleWidget();
  else if (a === 'datadir') { if (await SH.call('open_data_dir') === undefined) toast(SH.t('This only works inside the app.')); }
  else if (a === 'export') { const p = await SH.call('export_settings'); if (p) toast(SH.t('Settings exported.')); }
  else if (a === 'import') {
    const d = await SH.call('import_settings'); if (d === false) toast(SH.t('That file has no valid settings.'));
    else if (d) { Object.assign(state.settings, d); applyAll(); showSection(secOn); toast(SH.t('Settings imported.')); }
  } else if (a === 'reset') {
    const old = { ...state.settings }; await SH.call('reset_settings'); try { localStorage.removeItem('sh.settings'); } catch {}
    /* the engine keeps the user's data (and turns off the startup entry and the always-admin task itself): same here */
    const kept = {}; RESET_KEEP.forEach(k => { if (old[k] !== undefined) kept[k] = old[k]; });
    Object.keys(state.settings).forEach(k => delete state.settings[k]); Object.assign(state.settings, SH.DEFAULTS, kept); SH.call('settings_set', { registryCleaner: !!state.settings.registryCleaner }); applyAll(); showSection(secOn);
    toast(SH.t('Settings reset. Your routines, history and kits were kept.'), { action: { label: SH.t('Undo'), sound: 'undo', run: async () => {
      await SH.call('settings_set', old); Object.assign(state.settings, old); applyAll(); showSection(secOn);
      if (old.startWithWindows) SH.call('set_autostart', true).then(r => { if (r === false) toast(SH.t('Windows did not allow changing automatic startup.')); });
      if (old.alwaysAdmin) alwaysAdminOn();
    } }, ms: 7000 });
  }
}
sheet.addEventListener('input', e => {
  const r = e.target.closest('.rng'); if (r) { const k = r.dataset.key, v = +r.value; r.style.setProperty('--p', (v - r.min) / (r.max - r.min) * 100 + '%');
    const lab = $(`[data-rv="${k}"]`, sheet); if (lab) lab.textContent = RNG_FMT[k](v); state.settings[k] = v; if (k === 'soundVolume') SH.sound.volume(); else applyLook(); return; }
  const c = e.target.closest('input[data-color]'); if (c) { state.settings[c.dataset.color] = c.value; applyLook(); }
});
sheet.addEventListener('change', e => {
  const r = e.target.closest('.rng'); if (r) { state.settings[r.dataset.key] = undefined; SH.setSetting(r.dataset.key, +r.value); if (r.dataset.key === 'soundVolume') SH.sound('click', { preview: true }); return; }
  const c = e.target.closest('input[data-color]'); if (c) { state.settings[c.dataset.color] = undefined; SH.setSetting(c.dataset.color, c.value); $$('.swatch', sheet).forEach(x => x.classList.remove('on')); }
});
function placeSeg(s, snap) {
  const on = $('button.on', s), ind = $('.ind', s); if (!on) return;
  ind.style.width = on.offsetWidth + 'px'; const x = on.offsetLeft - 3;
  if (snap || !ind.dataset.x) { ind.getAnimations().forEach(a => a.cancel()); ind.style.transform = `translateX(${x}px)`; ind.dataset.x = x; return; }
  anim(ind, [{ transform: `translateX(${ind.dataset.x}px) scaleX(1)` }, { transform: `translateX(${(+ind.dataset.x + x) / 2}px) scaleX(1.12)`, offset: .45 }, { transform: `translateX(${x}px) scaleX(1)` }], { d: 380 });
  ind.dataset.x = x;
}
SH.placeSeg = placeSeg;
/* a new language: save it, then reload the interface in it with a soft fade (the widget and the tray follow) */
async function setLanguage(code, btn) {
  const L = SH.i18n; if ((S().language || 'auto') === code) return;
  $$('.lang', sheet).forEach(x => x.classList.toggle('on', x === btn));
  state.settings.language = code; L.remember(code);
  await SH.call('settings_set', { language: code });
  if (L.resolve(code) === L.lang) return;
  try { sessionStorage.setItem('sh.reopenSettings', 'language'); } catch {}
  anim(document.body, [{ opacity: 1 }, { opacity: 0 }], { d: 220 }).finished.then(() => location.reload(), () => location.reload());
}
function applySetting(key, val) {
  if (key === 'zoom' || key === 'theme' || key === 'density' || key === 'language' || key === 'intensity') { SH.setSetting(key, val); }
  else SH.setSetting(key, val);
  if (key === 'intensity') { applyLook(); const h = $('#intHint'); if (h) { h.textContent = INT_HINT[val]; anim(h, [{ opacity: 0, transform: 'translate3d(0,4px,0)' }, { opacity: 1, transform: 'none' }], { d: 260 }); } }
  if (['theme', 'density', 'corners', 'twinkle', 'shooting', 'quickActions', 'countUp'].includes(key)) applyLook();
  if (key === 'zoom') applyZoom();
  if (key === 'startWithWindows') SH.call('set_autostart', !!val).then(r => { if (r === false) toast(SH.t('Windows did not allow changing automatic startup.')); });
  if (key === 'teleRate' && SH.tele.setRate) SH.tele.setRate(+val);
  if (key === 'registryCleaner' && val) toast(SH.t('The Registry tab is now in Super Optimizer. Every fix is backed up; you can restore it from Settings > Backups and restore.'));
  if (key === 'lightMode') SH.setSetting('batterySaver', val !== 'never');  /* the old yes/no stays in step */
  /* turning it on in normal mode asks Windows once, right now (the elevated copy then sets up the task, and
     from then on it opens as administrator without asking); turning it off removes the task */
  if (key === 'alwaysAdmin') { if (val) alwaysAdminOn(); else SH.call('set_always_admin', false).then(r => { if (r === false) toast(SH.t('Could not set up starting as administrator.')); }); }
}
function alwaysAdminOn() {
  if (!state.admin) askAdmin(true, true);
  else SH.call('set_always_admin', true).then(r => { if (r === false) toast(SH.t('Could not set up starting as administrator.')); });
}
/* what Reset settings keeps: the user's data, not preferences (engine side: app.py reset_settings, same list) */
const RESET_KEEP = ['autopilotRoutines', 'autopilotLog', 'autopilotSchema', 'autopilotNotify', 'activity', 'pending', 'hangarKits', 'updIgnored', 'updSchedule', 'cleanExclusions', 'testerKbMissing', 'cpsBest', 'uiPort', 'language'];
/* Interface size: the rules are in js/zoom.js (SH.zoomRule, tested in tests/test_zoom.py). Automatic never leaves the
   layouts less room than they are designed for when a smaller zoom can give it to them (a handheld's 1080p screen at
   150 % gets 90 %), and grows only where there is room to spare. Measured on the window itself (not the screen), so it
   adapts when the window is resized or moved to another monitor. A size the user picked is capped while the window is
   too small for it: the choice is kept and applies again in a bigger window. */
let autoZoom = 1, curZoom = 1, zoomCapped = 0;
function effectiveZoom() {
  zoomCapped = 0;
  if (isAutoZoom()) return autoZoom;
  const want = +S().zoom, z = SH.zoomRule.capped(want, innerWidth * curZoom, innerHeight * curZoom); // the window's size at 100 %
  if (z < want) zoomCapped = z;
  return z;
}
function zoomNote() { return zoomCapped ? SH.t('Reduced to {pct}% while the window is this small, so everything fits.', { pct: Math.round(zoomCapped * 100) }) : ''; }
function paintZoomNote() { const n = $('#zoomNote'); if (n) n.textContent = zoomNote(); }
function computeAutoZoom() { autoZoom = SH.zoomRule.auto(innerWidth * curZoom, innerHeight * curZoom); }
/* compact layout (base.css, html[data-layout=scroll]): below the size the layouts are designed for, the views scroll as
   one page instead of squeezing their panels. Switched on every resize, before anything re-fits ('layout' event). */
function applyLayout() {
  const v = SH.zoomRule.compact(innerWidth, innerHeight) ? 'scroll' : 'fit';
  if (ROOT.dataset.layout === v) return;
  ROOT.dataset.layout = v; SH.layout = v; SH.emit('layout', v);
}
applyLayout(); addEventListener('resize', applyLayout);
/* In the compact layout a fit-to-height tab whose content still needs more room than a 760 px window gives it (a
   narrow window stacks its columns) makes its module that much taller (--grow), so the page scrolls to it instead of
   clipping it. Measured after the tab is shown and when the window changes; never in the normal layout. */
function growCompact(reset) {
  const v = $('#v-' + state.view), mod = v && $('.mod', v); if (!mod) return;
  if (reset) mod.style.removeProperty('--grow');
  if (ROOT.dataset.layout !== 'scroll') { mod.style.removeProperty('--grow'); return; }
  const tab = $('.tab.on', mod); if (!tab || !tab.classList.contains('fill')) { mod.style.removeProperty('--grow'); return; }
  const over = tab.scrollHeight - tab.clientHeight, g = parseFloat(mod.style.getPropertyValue('--grow')) || 0;
  if (over > 2) mod.style.setProperty('--grow', Math.ceil(g + over + 8) + 'px');
}
let growT = 0; const growSoon = () => { clearTimeout(growT); growT = setTimeout(() => { growCompact(true); setTimeout(growCompact, 600); }, 120); };
SH.on('view', growSoon); SH.on('tab', growSoon); SH.on('layout', growSoon); addEventListener('resize', growSoon);
let zoomTimer = 0;
addEventListener('resize', () => {
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => {
    computeAutoZoom(); applyZoom();
  }, 350);
});
const isAutoZoom = () => S().zoom === 'auto' || !ZOOMS.some(z => z[0] === String(S().zoom));
function applyZoom() {
  const z = effectiveZoom(); paintZoomNote(); SH.zoom = { wanted: isAutoZoom() ? 'auto' : +S().zoom, effective: z, capped: !!zoomCapped };
  if (z === curZoom && SH.booted) return;
  curZoom = z; SH.call('set_zoom', z);
}
function applyLook() {
  const st = S(); ROOT.dataset.theme = st.theme; ROOT.dataset.density = st.density; ROOT.dataset.int = SH.effInt(); ROOT.dataset.corners = st.corners;
  ROOT.dataset.quick = st.quickActions ? 'on' : 'off';
  ROOT.style.setProperty('--f', SH.FACT[SH.effInt()] / (st.animSpeed || 1)); ROOT.style.setProperty('--accent', st.accent); ROOT.style.setProperty('--accent2', st.accent2);
  ROOT.style.setProperty('--pa', st.panelAlpha); ROOT.style.setProperty('--neb', st.nebula); ROOT.dataset.neb = st.nebula > 1 ? 'hi' : 'lo';
  if (stars.length !== st.starCount) makeStars(st.starCount);
  SH.emit('look');
}
function applyAll() { applyLook(); applyZoom(); syncAllTabs(); SH.power && SH.power.set(SH.power.forced); }
SH.on('power', () => applyLook());
function openSettings(section) {
  if (state.palOpen) closePal(true);
  if (!state.setOpen) SH.sound('panel_open');
  state.setOpen = true; const o = $('#setO'); o.classList.add('on');
  anim($('.scrim', o), [{ opacity: 0 }, { opacity: 1 }], { d: 240 });
  anim(sheet, [{ opacity: 0, transform: 'translate3d(48px,0,0) scale(.97)', filter: 'blur(8px)' }, { opacity: 1, transform: 'translate3d(0,0,0) scale(1)', filter: 'blur(0px)' }], { d: 460, e: EASE.spring });
  requestAnimationFrame(() => showSection(section || secOn, true));
}
function closeSettings(quiet) {
  if (!state.setOpen) return; state.setOpen = false; const o = $('#setO');
  if (quiet !== true) SH.sound('panel_close');
  anim($('.scrim', o), [{ opacity: 1 }, { opacity: 0 }], { d: 200 });
  const a = anim(sheet, [{ opacity: 1, transform: 'translate3d(0,0,0)' }, { opacity: 0, transform: 'translate3d(36px,0,0)' }], { d: 220, e: EASE.io });
  a.finished.then(() => { if (!state.setOpen) o.classList.remove('on'); }).catch(() => {});
}
$('#gearBtn').addEventListener('click', () => state.setOpen ? closeSettings() : openSettings());
$$('.overlay').forEach(o => o.addEventListener('click', e => { if (e.target.closest('[data-close]')) o.id === 'palO' ? closePal() : closeSettings(); }));

/* ================= administrator mode ================= */
/* The suggestion is a small card under the mode pill. It never stays: it goes away by itself after a few seconds
   (not while the pointer is on it), on a click anywhere else, with Esc, and when you move to another module or tab,
   so it cannot sit over the buttons of whatever you open. Started by the app, it shows once per session. */
const note = $('#adminNote'); let noteShown = false, lastHint = 0, noteTimer = 0;
const armNote = ms => { clearTimeout(noteTimer); noteTimer = setTimeout(hideNote, ms * (S().intensity === 'min' ? 1.4 : 1)); };
function showNote(reason, auto) {
  if (state.admin || noteShown) return; noteShown = true; lastHint = Date.now();
  armNote(auto ? 6000 : 10000);
  $('#noteReason').textContent = SH.t(reason || 'to install drivers, clean system files and repair Windows. Without it, StellarHub runs in limited mode.');
  note.classList.add('on');
  anim(note, [{ opacity: 0, transform: 'translate3d(0,-8px,0) scale(.94)', filter: 'blur(6px)' }, { opacity: 1, transform: 'translate3d(0,0,0) scale(1)', filter: 'blur(0px)' }], { d: 420, e: EASE.spring });
}
function hideNote() {
  clearTimeout(noteTimer);
  if (!noteShown) return; noteShown = false; note.classList.remove('on');
  anim(note, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'translate3d(0,-6px,0) scale(.96)' }], { d: 180 });
  if ($('#noteNever').classList.contains('on')) SH.setSetting('adminHints', false);
}
/* Modules call SH.requireAdmin before anything that needs elevation: it opens the administrator prompt in the middle of
   the window, and the elevated copy comes back to the same place (and action). It lives in js/admin-resume.js. */
/* Reopens StellarHub elevated (Api.relaunch_admin) for this session only: the next start is in normal mode again, unless
   o.always (the prompt's "Always open as administrator" box, or that switch in Settings > Administrator) turns the
   setting on. adminAsked: the administrator copy plays admin_granted when it opens (js/sounds.js). ticket: where the
   user is and what they asked for (SH.resume.ticket). Answers true (this copy closes), false (Windows said no: nothing
   changed, the setting is put back as it was), 'busy' (a task still runs: nothing was asked) or undefined (sample). */
SH.relaunchAdmin = async (ticket, o = {}) => {
  const was = !!state.settings.alwaysAdmin, ch = { adminAsked: Date.now() };
  if (o.always) ch.alwaysAdmin = true;
  Object.assign(state.settings, ch); await SH.call('settings_set', ch);
  const r = await SH.call('relaunch_admin', ticket || null);
  if (r !== true && r !== undefined) { state.settings.adminAsked = 0; state.settings.alwaysAdmin = was; SH.call('settings_set', { adminAsked: 0, alwaysAdmin: was }); }
  return r;
};
/* the mode pill's note, the palette and the Turn on buttons open this session as administrator; always: the Settings
   switch "Always open as administrator" was just turned on */
async function askAdmin(direct, always = false) {
  if (state.admin) return; if (!direct && !noteShown) { showNote(); return; }
  hideNote();
  const r = await SH.relaunchAdmin(SH.resume ? SH.resume.ticket() : null, { always });
  if (r === true) toast(SH.t('Opening StellarHub as administrator…'));
  else if (r === false) toast(SH.t("Windows didn't give permission. You're still in normal mode."), { kind: 'warning' });
  else if (r === 'busy') toast(SH.t('Something you started is still running. Open as administrator when it finishes.'), { kind: 'warning' });
  else { state.settings.adminAsked = 0; setAdmin(true); SH.sound('admin_granted'); toast(SH.t('Administrator mode (simulated outside the app).')); }
}
/* the pill carries an icon, not a dot: a shield with a check for administrator mode, a plain shield outline for normal mode */
SH.icons.add({ shieldplain: '<path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6z"/>' });
function paintMode() { const e = $('#modeIc'); if (e) e.innerHTML = ic(state.admin ? 'shield' : 'shieldplain'); }
paintMode();
function setAdmin(on) {
  state.admin = on; const pill = $('#modePill'); pill.classList.toggle('admin', on); const txt = $('#modeTxt'); paintMode();
  anim(txt, [{ opacity: 1, transform: 'none', filter: 'blur(0px)' }, { opacity: 0, transform: 'translate3d(0,-8px,0)', filter: 'blur(4px)' }], { d: 160 }).finished.then(() => {
    txt.textContent = on ? SH.t('Administrator mode') : SH.t('Normal mode');
    anim(txt, [{ opacity: 0, transform: 'translate3d(0,8px,0)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 300, e: EASE.spring });
  }).catch(() => {});
  anim(pill, [{ transform: 'scale(1)' }, { transform: 'scale(1.08)', offset: .35 }, { transform: 'scale(1)' }], { d: 460 });
}
$('#modePill').addEventListener('click', () => { if (state.admin) { openSettings('admin'); return; } noteShown ? hideNote() : showNote(); });
note.addEventListener('pointerenter', () => clearTimeout(noteTimer));
note.addEventListener('pointerleave', () => { if (noteShown) armNote(4000); });
addEventListener('pointerdown', e => { if (noteShown && !note.contains(e.target) && !e.target.closest('#modePill')) hideNote(); }, true);
SH.on('view', () => { if (noteShown) hideNote(); }); SH.on('tab', () => { if (noteShown) hideNote(); });
$('#adminYes').addEventListener('click', () => askAdmin(true));
$('#adminNo').addEventListener('click', hideNote);
/* "Don't suggest this again": the whole line is one checkbox button (its text too; Enter, Space and the controller's A) */
$('#noteNeverBtn').addEventListener('click', e => { const on = $('#noteNever').classList.toggle('on'); e.currentTarget.setAttribute('aria-checked', String(on)); });

/* ================= toasts ================= */
/* At most 3 at a time; a repeated toast refreshes instead of stacking. Opening/closing the same thing (e.g. the widget)
   replaces the previous toast of the same group.
   Toasts have a lane of their own, bottom right, and never cover the content, the dock, its magnified icons or their
   tooltips, the controller's hint bar or the version tag:
   - beside the dock, to its right, in the dock's band: the newest is centred on the dock bar (never lower than its
     bottom edge), older ones stack upward only as far as the strip the page keeps free for the dock (--dockspace), so
     the oldest go early. A narrow window gives them the width there is (at least TOAST_MIN) and the text wraps.
   - only when even that is missing (a compact handheld layout): one at a time, a slim bar centred directly above the
     dock (and above the hint bar). html[data-toasts=above] then reserves that strip in --dockspace for good, so it
     never covers a panel and the layout doesn't jump when a toast comes.
   placeToasts() measures the dock at rest and the hint bar (a few layout reads) when a toast appears and when the
   window resizes (the zoom, the controller's hint bar). */
const MAX_TOASTS = 3, TOAST_EDGE = 16, TOAST_GAP = 14, TOAST_MIN = 200, TOAST_W = 420;
let toastRoom = { at: 'side', max: 999, n: MAX_TOASTS, dh: 0 };
function placeToasts() {
  const box = $('#toasts'); if (!box) return;
  const r = dock.getBoundingClientRect(); if (!r.width) return;
  const last = dks[dks.length - 1].el, tip = $('.tip', last), lr = last.getBoundingClientRect();
  /* the widest the magnification can make the dock on each side (the pill grows by half the extra width) and how far
     the last icon's tooltip (above the dock) reaches past its own centre */
  const grow = BASE * GROW * 1.6, tipHalf = tip ? tip.offsetWidth / 2 : 0;
  const hb = ROOT.classList.contains('pad-hints') ? $('#padHints') : null, hr = hb && hb.getBoundingClientRect();
  const hints = hr && hr.width ? hr : null;
  const band = Math.max(r.right + grow, hints ? hints.right : 0);
  const room = innerWidth - TOAST_EDGE - band - TOAST_GAP;
  const bottom = innerHeight - r.bottom;
  let at;
  if (room >= TOAST_MIN) {
    at = 'side';
    /* above the dock's top only where the last icon's tooltip can't be: else they stay in the dock's band */
    const clear = innerWidth - TOAST_EDGE - Math.max(band, lr.left + lr.width / 2 + grow + tipHalf) - TOAST_GAP >= Math.min(TOAST_W, room);
    const ds = parseFloat(getComputedStyle(ROOT).getPropertyValue('--dockspace')) || 118;
    box.style.setProperty('--tb', `${Math.round(bottom)}px`); box.style.setProperty('--tw', `${Math.floor(Math.min(TOAST_W, room))}px`);
    box.style.removeProperty('--tl');
    toastRoom = { at, max: clear ? Math.max(r.height, ds - bottom - 4) : r.height + 4, n: MAX_TOASTS, dh: r.height };
  } else {
    at = 'above';
    const top = Math.min(r.top, hints ? hints.top : Infinity);
    box.style.setProperty('--tb', `${Math.round(innerHeight - top + 8)}px`); box.style.setProperty('--tl', `${Math.round(r.left + r.width / 2)}px`);
    box.style.setProperty('--tw', `${Math.floor(Math.min(560, innerWidth - 2 * TOAST_EDGE))}px`);
    toastRoom = { at, max: 999, n: 1, dh: 0 };
  }
  box.dataset.at = at;
  /* the strip above the dock is kept free (--dockspace) while toasts use it; the views re-fit on 'resize' */
  if (ROOT.dataset.toasts !== at) { ROOT.dataset.toasts = at; dispatchEvent(new Event('resize')); }
  fitToasts();
}
/* only what fits in the lane stays up: the oldest leave first (the newest is always shown); beside the dock the newest
   is centred on the dock bar */
function fitToasts() {
  const box = $('#toasts'); if (!box) return;
  const live = [...box.children].filter(x => !x.dataset.dead);
  let h = 0; const keep = [];
  const newest = live[live.length - 1], pad = newest && toastRoom.dh ? Math.max(0, (toastRoom.dh - newest.offsetHeight) / 2) : 0;
  for (let i = live.length - 1; i >= 0; i--) {
    const th = live[i].offsetHeight + (keep.length ? 8 : 0);
    if (keep.length && (keep.length >= toastRoom.n || pad + h + th > toastRoom.max)) break;
    h += th; keep.push(live[i]);
  }
  box.style.paddingBottom = pad ? `${Math.round(pad)}px` : '';
  live.filter(x => !keep.includes(x)).forEach(x => x._kill && x._kill());
}
let toastPlaceRaf = 0;
addEventListener('resize', () => { cancelAnimationFrame(toastPlaceRaf); toastPlaceRaf = requestAnimationFrame(placeToasts); });
/* the lane is chosen from the start, so a strip reserved above the dock is there before the first toast */
SH.on('boot', () => requestAnimationFrame(placeToasts));
/* The text of a toast: at most three lines (then "…"; the whole text is its tooltip). A raw "access denied" from
   Windows ([WinError 5], in any language) reads as a plain sentence, with the technical part (a path, a registry key)
   as a small second line. */
const ACCESS_DENIED = /\[WinError 5\]|Access is denied|Acceso denegado|Acesso negado|Accesso negato|Accès refusé|Acc[eè]s refus[ée]|拒绝访问|アクセスが拒否/i;
function toastText(span, text) {
  text = String(text == null ? '' : text);
  let main = text, tech = '';
  if (ACCESS_DENIED.test(text)) {
    /* "Nothing was fixed: HKLM\…\x.exe: [WinError 5] Access is denied" -> "Nothing was fixed. Windows denied access." */
    const i = text.indexOf(':'), lead = i > 0 && i < 90 && !/[\\/[]/.test(text.slice(0, i)) ? text.slice(0, i).trim() : '';
    main = lead ? `${lead.replace(/[.。]$/, '')}. ${SH.t('Windows denied access.')}` : SH.t('Windows denied access.');
    tech = (lead ? text.slice(i + 1) : text).trim();
  }
  span.title = text;
  span.innerHTML = `<span class="tm">${esc(main)}</span>${tech ? `<small class="tt">${esc(tech)}</small>` : ''}`;
}
SH.toastText = toastText;
function toast(text, o = {}) {
  const box = $('#toasts'); const group = o.group || text;
  placeToasts();
  const same = [...box.children].find(x => x.dataset.group === group && !x.dataset.dead);
  /* o.kind: 'success', 'warning', 'error', 'unavailable' (or another SH.sound event, e.g. 'update_installed'); none is a
     plain toast, whose sound keeps quiet right after another one */
  if (!o.silent) SH.sound(o.kind || 'toast');  /* o.silent: the moment already had its sound */
  toast.lastAt = performance.now();
  /* action.sound: 'undo' for an Undo button; anything else clicks. The button runs the toast's CURRENT action (t._act):
     a refreshed toast speaks for the latest event, so its Undo undoes that one, not the first (two results deleted, two
     devices disabled in a row) */
  const setAction = (t, a) => {
    let b = $('button', t); t._act = a || null;
    if (!a) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('button'); b.className = 'btn sm'; t.appendChild(b); b.addEventListener('click', () => { const x = t._act; if (!x) return; if (x.sound) SH.sound(x.sound); x.run(); t._kill(); }); }
    b.textContent = a.label;
  };
  if (same) {
    toastText(same.firstElementChild, text); setAction(same, o.action); fitToasts(); clearTimeout(same._timer); same._timer = setTimeout(same._kill, o.ms || 3600);
    anim(same, [{ transform: 'scale(1)' }, { transform: 'scale(1.04)', offset: .4 }, { transform: 'scale(1)' }], { d: 320, keep: true });
    return;
  }
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.dataset.group = group;
  const sp = document.createElement('span'); t.appendChild(sp); toastText(sp, text);
  t._kill = kill; setAction(t, o.action);
  box.appendChild(t);
  const fromTop = toastRoom.at === 'above';  /* above the dock it rises a little, beside the dock it slides in from the side */
  anim(t, [{ opacity: 0, transform: fromTop ? 'translate3d(0,10px,0) scale(.96)' : 'translate3d(24px,0,0) scale(.94)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 440, e: EASE.spring });
  function kill() { if (t.dataset.dead) return; t.dataset.dead = '1'; clearTimeout(t._timer);
    anim(t, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: fromTop ? 'translate3d(0,8px,0) scale(.97)' : 'translate3d(24px,0,0) scale(.96)' }], { d: 220 }).finished.then(() => flip(() => t.remove())).catch(() => t.remove()); }
  /* the toasts left in the stack glide into the gap instead of jumping */
  function flip(fn) { const before = new Map([...box.children].map(x => [x, x.getBoundingClientRect().top])); fn(); [...box.children].forEach(x => { const b = before.get(x); if (b == null) return; const d = b - x.getBoundingClientRect().top; if (Math.abs(d) > 1) anim(x, [{ transform: `translate3d(0,${d}px,0)` }, { transform: 'none' }], { d: 320, keep: true }); }); }
  t._kill = kill; t._timer = setTimeout(kill, o.ms || 3600);
  fitToasts();
}
async function renderLangs() {
  const el = $('#langs'); if (!el) return;
  const COL = { Python: '#3572A5', JavaScript: '#F1E05A', CSS: '#663399', HTML: '#E34C26' };
  const d = await SH.call('project_stats') || { JavaScript: 520000, CSS: 140000, Python: 60000, HTML: 14000 };
  const tot = Object.values(d).reduce((a, b) => a + b, 0) || 1; const rows = Object.entries(d).sort((a, b) => b[1] - a[1]);
  el.innerHTML = `<div class="lbar">${rows.map(([k, v]) => `<span style="flex:${v};background:${COL[k] || 'var(--mute)'}"></span>`).join('')}</div>
    <div class="llist">${rows.map(([k, v]) => `<span><i style="background:${COL[k] || 'var(--mute)'}"></i>${k} <b>${SH.fmt1(v / tot * 100)} %</b></span>`).join('')}</div>`;
  $$('.lbar span', el).forEach((s, i) => anim(s, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { d: 700, delay: i * 90, e: EASE.out }));
}
SH.toast = toast;

/* ================= report a bug: the small icon to the left of the version (bottom left) ================= */
/* A popover above it says how, and "Report on GitHub" opens a new issue in the browser. It is a dialog like the
   others (gamepad.js OVERLAYS / MODALS, sounds.js MODALS): focus trap, B or Esc or a click outside closes it. */
SH.icons.add({ bugreport: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><path d="M12 8v5M12 16.25v.01"/>' });
const BUG_URL = 'https://github.com/estebanarosemena/StellarHub/issues/new';
const bugBtn = $('#bugBtn');
let bugPop = null;
function bugClose() {
  const p = bugPop; if (!p) return; bugPop = null;
  removeEventListener('keydown', bugKey, true); removeEventListener('pointerdown', bugOut, true);
  bugBtn.setAttribute('aria-expanded', 'false');
  anim(p, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate3d(0,6px,0) scale(.98)' }], { d: 160 }).finished.then(() => p.remove()).catch(() => p.remove());
}
function bugKey(e) { if (e.key === 'Escape' && bugPop && !state.palOpen && !state.setOpen) { e.preventDefault(); e.stopImmediatePropagation(); bugClose(); } }
function bugOut(e) { if (bugPop && !bugPop.contains(e.target) && !bugBtn.contains(e.target)) bugClose(); }
function bugOpen() {
  if (bugPop) { bugClose(); return; }
  const p = document.createElement('div'); p.className = 'bug-pop pan';
  p.setAttribute('role', 'dialog'); p.setAttribute('aria-modal', 'true'); p.setAttribute('aria-labelledby', 'bugT');
  p.innerHTML = `<h3 id="bugT">${esc(SH.t('Found a bug?'))}</h3><p>${esc(SH.t('Report it on GitHub: say what you were doing and, if you can, add a screenshot.'))}</p>
    <div class="bug-acts"><button class="btn ghost sm" data-close>${esc(SH.t('Not now'))}</button><button class="btn pri sm" data-bug-go>${ic('external')}${esc(SH.t('Report on GitHub'))}</button></div>`;
  document.body.appendChild(p); bugPop = p; bugBtn.setAttribute('aria-expanded', 'true');
  /* above the button, and above the dock and the controller's hint bar where they reach this far left */
  const pr = p.getBoundingClientRect(); let top = pr.top;
  for (const o of [$('#dock'), $('#padHints'), ...$$('#toasts .toast:not([data-dead])')]) { const r = o && o.getBoundingClientRect(); if (r && r.width && r.height && r.left < pr.right + 8 && r.top < pr.bottom + 8) top = Math.min(top, r.top - 10 - pr.height); }
  if (top < pr.top) p.style.bottom = `${Math.max(44, Math.round(innerHeight - top - pr.height))}px`;
  anim(p, [{ opacity: 0, transform: 'translate3d(0,8px,0) scale(.97)' }, { opacity: 1, transform: 'none' }], { d: 260, e: EASE.spring });
  addEventListener('keydown', bugKey, true); addEventListener('pointerdown', bugOut, true);
  p.addEventListener('click', async e => {
    if (e.target.closest('[data-close]')) { bugClose(); return; }
    if (e.target.closest('[data-bug-go]')) { bugClose(); if (await SH.call('open_url', BUG_URL) === undefined) window.open(BUG_URL); }
  });
  setTimeout(() => { const b = $('[data-bug-go]', p); if (b && bugPop === p) b.focus({ preventScroll: true }); }, 40);
}
if (bugBtn) { bugBtn.innerHTML = ic('bugreport'); bugBtn.addEventListener('click', bugOpen); SH.on('view', bugClose); }

/* ================= keyboard ================= */
const ORDER = DOCK.filter(x => x !== '|');
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  /* a dialog on top (the component sheet, the update or administrator dialog, a confirmation, the bug popover) keeps the
     palette and the settings from opening behind it: the focus trap would make the dialog on screen inert */
  const dlg = SH.modal && SH.modal.open, held = !!dlg && dlg.id !== 'palO' && dlg.id !== 'setO';
  if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); if (state.palOpen) closePal(); else if (!held) openPal(); return; }
  if ((e.ctrlKey || e.metaKey) && k === ',') { e.preventDefault(); if (state.setOpen) closeSettings(); else if (!held) openSettings(); return; }
  if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(k)) { e.preventDefault(); const id = ORDER[+k - 1]; if (id) go(id); return; }
  if (e.key === 'Escape') { if (state.palOpen) closePal(); else if (state.setOpen) closeSettings(); else if (noteShown) hideNote(); else if (state.view !== 'home' && !e.defaultPrevented && !(e.target && e.target.closest && e.target.closest('input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button]),textarea,select,[contenteditable=""],[contenteditable="true"]'))) go('home'); return; }
  if (state.palOpen) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setPalIdx(palIdx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setPalIdx(palIdx - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); runItem(palList[palIdx]); }
  }
});

/* ================= startup ================= */
/* the loading screen (index.html): says what is happening while it waits, and leaves once the app is ready.
   The first start waits for Windows to describe the hardware (it is saved for the next starts). */
const bootEl = document.getElementById('boot');
const bootMsg = text => { const m = document.getElementById('bootMsg'); if (m && m.textContent !== text) m.textContent = text; };
const bootTimers = [setTimeout(() => bootMsg(SH.t('Starting…')), 1500),
  setTimeout(() => bootMsg(SH.t('Getting to know your PC. The first start takes a little longer.')), 6000),
  setTimeout(() => bootMsg(SH.t('Almost there…')), 25000)];
function bootDone() {
  bootTimers.forEach(clearTimeout);
  if (!bootEl || !bootEl.isConnected) return;
  bootEl.classList.add('out'); bootEl.removeAttribute('aria-busy');
  setTimeout(() => bootEl.remove(), 500);
}
setTimeout(bootDone, 120000);  /* never leave it up for good, whatever happens */
SH.boot = async () => {
  computeAutoZoom();
  SH.call('phase', 'boot begins');
  /* the three answers are independent: ask for all of them at once instead of one round trip after another */
  const infoP = SH.call('info'), pcP = SH.call('pc_info');
  await SH.loadSettings();
  SH.call('phase', 'settings loaded');
  const [info, pc] = await Promise.all([infoP, pcP]);
  SH.call('phase', 'info + pc_info loaded');
  if (pc && pc.components) { Object.assign(SH.PC, pc); SH.PC.real = true; }
  if (info) { state.version = info.version; state.codename = info.codename || ''; state.portable = !!info.portable; state.adminTask = info.adminTask !== false; const ver = $('#sheet nav .ver'); if (ver) ver.textContent = `StellarHub ${info.version}${state.codename ? ' · ' + state.codename : ''}`;
    /* the version in a corner of every view, small: support screenshots always say which one it is */
    const vt = $('#verTag'); if (vt) vt.textContent = `v${info.version}${state.codename ? ' · ' + state.codename : ''}${state.portable ? ' · ' + SH.t('portable') : ''}`; if (info.admin) { state.admin = true; paintMode(); $('#modePill').classList.add('admin'); $('#modeTxt').textContent = SH.t('Administrator mode'); } }
  /* sample mode: the pretend administrator copy js/admin-resume.js reloads into */
  if (!info) { let fake = false; try { fake = !!sessionStorage.getItem('sh.sampleAdmin'); } catch {} if (fake) { state.admin = true; paintMode(); $('#modePill').classList.add('admin'); $('#modeTxt').textContent = SH.t('Administrator mode'); } }
  /* opened as administrator from the prompt: back to where the user was (and what they asked for) */
  const resumeT = SH.resume && state.admin ? await SH.resume.take() : null;
  applyLook(); applyZoom();
  MODS.filter(m => m.id !== 'home').forEach(buildModule);
  SH.on('module:registered', def => { if (def.id !== 'home' && modById(def.id)) buildModule(modById(def.id)); });
  anim($('.top'), [{ opacity: 0, transform: 'translate3d(0,-10px,0)' }, { opacity: 1, transform: 'none' }], { d: 600, delay: 300 });
  anim(dock, [{ opacity: 0, transform: 'translateX(-50%) translate3d(0,30px,0) scale(.9)' }, { opacity: 1, transform: 'translateX(-50%) translate3d(0,0,0) scale(1)' }], { d: 800, delay: 900, e: EASE.spring });
  /* once per session: reloading for a language change does not bring it back */
  let seen = false; try { seen = !!sessionStorage.getItem('sh.noteAuto'); } catch {}
  if (!state.admin && S().adminHints && !seen) setTimeout(() => { try { sessionStorage.setItem('sh.noteAuto', '1'); } catch {} if (!state.setOpen && !state.palOpen) showNote(undefined, true); }, 4200);
  SH.emit('boot');
  /* startup time goes to the log; ui_ready reveals the window and answers whether it is on screen ('shown': the start sound) */
  SH.booted = true; requestAnimationFrame(() => SH.call('ui_ready').then(v => SH.emit('shown', { shown: v !== false })));
  bootDone();
  /* the page can reload (language change) while a task keeps running in Python: its waiters are gone, so say it is
     still running and report how it ended */
  SH.call('jobs_running').then(list => {
    if (!Array.isArray(list) || !list.length) return;
    const nm = j => { const m = modById(String(j.name).split('.')[0]); return m ? m.name : String(j.name); };
    const names = new Map(list.map(j => [j.id, nm(j)]));
    toast(SH.t('A task is still running: {name}.', { name: [...new Set(names.values())].join(', ') }));
    SH.on('job', m => {
      if (m.kind !== 'end' || !names.has(m.id)) return;
      const n = names.get(m.id); names.delete(m.id);
      toast(m.state === 'done' ? SH.t('{name} finished.', { name: n }) : SH.t('{name} did not finish.', { name: n }));
    });
  }).catch(() => {});
  /* after switching language the page reloads: come back to where the user was */
  try { const sec = sessionStorage.getItem('sh.reopenSettings'); if (sec) { sessionStorage.removeItem('sh.reopenSettings'); setTimeout(() => openSettings(sec), 350); } } catch {}
  SH.on('view', d => SH.setSetting('lastView', d.to));
  /* reopened as administrator from the prompt: its place comes before the start view and the test routes */
  if (resumeT) { setTimeout(() => SH.resume.restore(resumeT), 350); return; }
  /* test routes: #drivers/all opens that tab, #drivers/* walks through all of them, #home=bento forces a Home view */
  const h = decodeURIComponent(location.hash.slice(1));
  const hv = h.match(/^home=(\w+)$/); if (hv) setTimeout(() => SH.setSetting('homeVariant', hv[1]), 50);
  const sv = S().startView === 'last' ? S().lastView : S().startView;
  if (!h && sv && sv !== 'home' && modById(sv)) setTimeout(() => go(sv, { silent: true }), 700);
  const hm = h.match(/^(\w+)(?:\/([\w*]+))?$/);
  if (hm && modById(hm[1]) && hm[1] !== 'home') setTimeout(() => {
    if (hm[2] === '*') { go(hm[1], { silent: true }); tabsOf(modById(hm[1])).forEach((t, i) => setTimeout(() => setTab(hm[1], t.id), 300 * i)); }
    else go(hm[1], { tab: hm[2], silent: true });
  }, 100);
};
})();
