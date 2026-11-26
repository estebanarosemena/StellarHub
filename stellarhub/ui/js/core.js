/* StellarHub · core: utilities, animation engine, icons, PC data and module registry.
   Everything hangs off window.SH. See docs/UI_CONTRACT.md for how modules and Home views are written. */
'use strict';
(() => {
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ROOT = document.documentElement;
/* SH.t remembers its last results (text -> English key + vars) so SH.logActivity can store what a line says
   in English and translate it when it is shown, whatever language it was written in. Cheap: 64 entries. */
const _recent = new Map();
if (window.SH && SH.t && !SH.t._rec) {
  const _t0 = SH.t;
  SH.t = (s, v) => { const r = _t0(s, v); if (typeof s === 'string' && r) { _recent.delete(r); _recent.set(r, [s, v && typeof v === 'object' ? { ...v } : v]); if (_recent.size > 64) _recent.delete(_recent.keys().next().value); } return r; };
  SH.t._rec = true;
}
const t = (window.SH && SH.t) || (s => s); // i18n.js ran first
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');

/* ---------- state and settings ---------- */
const DEFAULTS = {
  theme: 'deep', accent: '#FF7A66', accent2: '#9ED6FF', zoom: 'auto', intensity: reduceMQ.matches ? 'min' : 'max',
  stars: true, camera: true, parallax: true, homeVariant: 'bento', adminHints: true, trayOnClose: true,
  startWithWindows: false, autoUpdate: true, autoUpdateFeatures: true, skipVersion: '', language: 'auto', density: 'comfortable',
  sounds: true, soundVolume: .4, soundUi: true, soundAlerts: true, soundTasks: true, soundSystem: true,
  widgetStats: ['cpu', 'gpu', 'gpuTemp', 'ram', 'down', 'ping'], widgetLayout: 'grid',
  starCount: 400, starSpeed: 1.5, starBright: 1.2, widgetMode: 'full', widgetWasOpen: false, alwaysAdmin: false, twinkle: true, shooting: true, nebula: 1, animSpeed: 1, panelAlpha: 1.75, corners: 'mid',
  countUp: true, startView: 'home', quickActions: true, confirmDanger: true, teleRate: '1000', measurePing: true, lastView: 'home', batterySaver: true, lightMode: 'auto', registryCleaner: false,
  /* analyses (Storage's scan, Super Optimizer's analysis, Privacy's check, Program Updater's searches) run only when the
     user presses their button; true brings back the old behaviour of running them as soon as the module opens */
  autoAnalyze: false,
};
const state = { view: 'home', admin: false, palOpen: false, setOpen: false, version: '0.2.0', settings: { ...DEFAULTS }, lite: false };
const FACT = { max: 1, normal: .72, min: .3 };
const ORBIT = { max: 1, normal: .55, min: 0 };
/* state.lite: lighter effects are on (setting lightMode: automatic = on battery or integrated graphics only, always, never; telemetry.js sets it). The intensity the
   user chose stays as it is in the settings; effInt() is the one the animations use: one step lower while lite. */
const effInt = () => { const i = state.settings.intensity; return state.lite && i === 'max' ? 'normal' : i; };
const motion = () => FACT[effInt()] ?? 1;

/* simple events between parts of the UI */
const bus = {};
const on = (ev, fn) => { (bus[ev] ||= new Set()).add(fn); return () => bus[ev].delete(fn); };
const emit = (ev, data) => (bus[ev] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });

/* bridge to Python (window.pywebview.api); outside the app it falls back to localStorage */
const api = () => (window.pywebview && window.pywebview.api) || null;
/* Inside the app (WebView2 always exposes window.chrome.webview) the bridge to Python can take several seconds on
   a slow start (elevated relaunch, first launch while Defender scans the files): wait for it, polling as a fallback
   in case the ready event fired before this script ran. In a normal browser there is no bridge: sample mode. */
const IN_APP = !!(window.chrome && window.chrome.webview);
const apiReady = new Promise(res => {
  if (api()) return res(api());
  addEventListener('pywebviewready', () => res(api()), { once: true });
  if (!IN_APP) { setTimeout(() => res(api()), 1200); return; }
  const t0 = Date.now(), poll = setInterval(() => {
    if (api() || Date.now() - t0 > 60000) { clearInterval(poll); res(api()); }
  }, 100);
});
async function call(name, ...args) {
  const a = await apiReady;
  if (!a) return undefined;
  /* pywebview can announce the API before all its methods are attached (seen right after relaunching as
     administrator): wait for the method instead of answering "nothing" to whoever asked first */
  const api = () => (window.pywebview && window.pywebview.api) || a;
  for (let i = 0; typeof api()[name] !== 'function' && i < 60; i++) await new Promise(r => setTimeout(r, 100));
  const target = api();
  if (typeof target[name] !== 'function') { console.error(`API method missing: ${name}`); return undefined; }
  try { return await target[name](...args); } catch (e) { console.error(name, e); return undefined; }
}
/* UI errors -> app log */
const reportErr = m => { try { if (window.pywebview && window.pywebview.api && window.pywebview.api.log_js_error) window.pywebview.api.log_js_error(String(m)); } catch {} };
addEventListener('error', e => reportErr(`${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`));
addEventListener('unhandledrejection', e => reportErr(`promise: ${e.reason && (e.reason.stack || e.reason.message) || e.reason}`));
const _cerr = console.error.bind(console); console.error = (...a) => { _cerr(...a); reportErr(a.map(x => x && x.stack || x).join(' ')); };

/* real engine (stellarhub/engine/<mod>.py). Outside the app these return undefined: the module uses its sample mode.
   SH.engine('drivers', 'list') -> data (throws Error if the engine fails)
   SH.job('drivers', 'search', [args], { onProgress(msg), onLog(lines) }) -> promise with the result; .cancel() */
async function engine(mod, fn, ...args) {
  const r = await call('engine', mod, fn, args);
  if (r === undefined) return undefined;
  if (!r.ok) throw new Error(r.error || t('the engine failed'));
  return r.data;
}
const jobWaiters = new Map();
/* A job can send its updates (even its end) before the answer to "start it" reaches the page and the waiter exists:
   a fast or cached job would otherwise never resolve. Updates for ids nobody waits for yet are kept for a moment. */
const jobEarly = new Map();
function jobDeliver(w, m) {
  if (m.kind === 'progress' || m.kind === 'end') { try { w.o.onProgress && w.o.onProgress(m); } catch (e) { console.error(e); } }
  if (m.log && w.o.onLog) { try { w.o.onLog(m.log); } catch (e) { console.error(e); } }
  if (m.kind === 'end') {
    if (m.state === 'done') w.res(m.result); else if (m.state === 'cancelled') w.rej(Object.assign(new Error('cancelled'), { cancelled: true }));
    else w.rej(new Error((m.result && m.result.error) || t('the task failed')));
  }
}
on('job', m => {
  const w = jobWaiters.get(m.id);
  if (!w) {
    let e = jobEarly.get(m.id);
    if (!e) { e = []; jobEarly.set(m.id, e); setTimeout(() => jobEarly.delete(m.id), 20000); }
    if (e.length < 200 || m.kind === 'end') e.push(m);
    return;
  }
  if (m.kind === 'end') jobWaiters.delete(m.id);
  jobDeliver(w, m);
});
/* o.sound: 'scan' for a scan the user started (scan_start now, scan_complete when it ends well, a soft tick at 25, 50
   and 75 % if it runs long), 'task' for another long task the user started (only the ticks). Background refreshes
   leave it out and stay silent. o.bg: long work the module started by itself (silent, followed as a bg activity once
   it runs past the grace period, see SH.activity). */
function job(mod, fn, args = [], o = {}) {
  let id = null, cancelWanted = false;
  /* the activity this job's progress goes to (SH.activity): the caller's own, or one of its own for a user-started job */
  let act = o.activity && typeof o.activity === 'object' ? o.activity : null, own = null;
  if (o.sound || act || o.bg) {
    const t0 = performance.now(), op = o.onProgress; let mark = 0;
    if (o.sound === 'scan') sound('scan_start');
    o = { ...o, onProgress(m) {
      const q = m && m.kind === 'progress' && typeof m.pct === 'number' ? Math.floor(m.pct * 4) : 0;
      if (o.sound && q > mark && q < 4) { mark = q; if (performance.now() - t0 > 4000) sound('progress_tick'); }
      if (act && m && m.kind === 'progress') act.progress(typeof m.pct === 'number' && m.pct > 0 ? m.pct : null, m.text || null);
      if (op) op(m);
    } };
  }
  const finish = (v, e) => {
    if (!own) return;
    if (e) own.end(e.cancelled ? { cancelled: true } : { ok: false, error: e.message });
    else if (v && typeof v === 'object' && v.needAdmin) own.end({ cancelled: true });  /* the module asks for administrator mode itself */
    else if (v && typeof v === 'object' && v.ok === false) own.end({ ok: false, error: v.error || v.msg || '' });
    else own.end({ ok: true });
  };
  const p = new Promise(async (res, rej) => {
    const r = await call('engine_job', mod, fn, args);
    if (r === undefined) { res(undefined); return; }
    if (!r.ok) { rej(new Error(r.error)); return; }
    id = r.id;
    if (!act && (o.sound || o.bg) && o.activity !== false && !activity.busy(mod)) act = own = actStart(mod, { key: 'job:' + fn, label: o.label, auto: true, bg: !o.sound, cancel: () => p.cancel() });
    const w = { res: v => { if (o.sound === 'scan') sound('scan_complete'); finish(v); res(v); }, rej: e => { finish(undefined, e); rej(e); }, o }; jobWaiters.set(id, w); if (cancelWanted) call('job_cancel', id);
    const early = jobEarly.get(id);
    if (early) { jobEarly.delete(id); for (const m of early) { if (m.kind === 'end') jobWaiters.delete(id); jobDeliver(w, m); } }
  });
  p.cancel = () => { cancelWanted = true; if (id) call('job_cancel', id); };
  return p;
}
/* Saved settings come from disk (an older build, a hand-edited file): never trust their types. Keys that have a
   default must have the same type (numbers also inside their range); keys without one (the lists and maps the
   modules keep) must have the shape below. Anything else falls back to the default, or is dropped, key by key. */
const RANGE = { starCount: [0, 3000], starSpeed: [0, 5], starBright: [0, 3], nebula: [0, 3], animSpeed: [.25, 3], panelAlpha: [0, 3], soundVolume: [0, 1] };
const ENUM = { intensity: ['max', 'normal', 'min'], lightMode: ['auto', 'always', 'never'], widgetLayout: ['grid', 'list', 'row'] };
const SHAPE = { activity: 'a', hangarKits: 'a', cleanExclusions: 'a', autopilotRoutines: 'a', autopilotLog: 'a',
  pending: 'o', updIgnored: 'o', updSchedule: 'o', testerKbMissing: 'o', autopilotNotify: 'o', cpsBest: 'n', autopilotSchema: 'n', adminAsked: 'n' };
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
function sanitizeSettings(saved) {
  const out = {};
  if (!isObj(saved)) return out;
  for (const [k, v] of Object.entries(saved)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (k in DEFAULTS) {
      const d = DEFAULTS[k];
      if (Array.isArray(d)) { if (Array.isArray(v)) out[k] = typeof d[0] === 'string' ? v.filter(x => typeof x === 'string') : v; }
      else if (typeof d === 'number') { if (typeof v === 'number' && isFinite(v)) { const r = RANGE[k]; out[k] = r ? Math.min(r[1], Math.max(r[0], v)) : v; } }
      else if (typeof d === 'boolean') { if (typeof v === 'boolean') out[k] = v; }
      else if (typeof d === 'string') { if (typeof v === 'string' && (!ENUM[k] || ENUM[k].includes(v))) out[k] = v; }
      else out[k] = v;
    } else if (SHAPE[k]) {
      const sh = SHAPE[k];
      if (sh === 'a' ? Array.isArray(v) : sh === 'o' ? isObj(v) : typeof v === 'number' && isFinite(v)) out[k] = v;
    } else out[k] = v;
  }
  return out;
}
async function loadSettings() {
  let saved = await call('settings_get');
  const inApp = saved !== undefined;
  if (saved === undefined) { try { saved = JSON.parse(localStorage.getItem('sh.settings') || '{}'); } catch { saved = {}; } }
  Object.assign(state.settings, sanitizeSettings(saved));
  /* before the three-way "Lighter effects" choice there was a yes/no (batterySaver): no becomes Never, yes is Automatic */
  if (saved && typeof saved === 'object' && saved.lightMode === undefined && saved.batterySaver === false) state.settings.lightMode = 'never';
  /* before 2.0.0 "sounds" was one off-by-default chime for finished tasks, and its false was saved in nearly every
     settings file. The 2.0.0 interface sounds are on by default: settings from before them (no soundVolume yet) start
     with sounds on once; the volume is saved with it so this runs a single time and a later "off" is kept. */
  if (inApp && isObj(saved) && saved.soundVolume === undefined) {
    state.settings.sounds = true; state.settings.soundVolume = DEFAULTS.soundVolume;
    call('settings_set', { sounds: true, soundVolume: DEFAULTS.soundVolume });
  }
  /* the registry cleaner is opt-in (setting registryCleaner, default off). Someone upgrading, with no such key saved yet,
     keeps it on only if they already have registry-fix backups; the answer is saved so this runs once. */
  if (inApp && isObj(saved) && typeof saved.registryCleaner !== 'boolean') {
    let had = false; try { had = (await engine('optimizer', 'registry_backups_exist')) === true; } catch {}
    state.settings.registryCleaner = had; call('settings_set', { registryCleaner: had });
  }
  /* the language lives in the settings; i18n.js read a local copy to translate before this point. If they differ
     (first start after installing in another language, or changed elsewhere), switch once. */
  const L = window.SH && SH.i18n;
  if (L) {
    const pref = state.settings.language || 'auto';
    if (pref !== L.pref) {
      L.remember(pref);
      let ok = false; try { ok = localStorage.getItem('sh.lang') === pref; } catch {}
      if (ok && L.resolve(pref) !== L.lang) location.reload(); // only if it really changes, and never in a loop
    }
  }
}
function setSetting(key, val) {
  if (state.settings[key] === val) return;
  state.settings[key] = val;
  call('settings_set', { [key]: val }).then(r => {
    if (r === undefined) { try { localStorage.setItem('sh.settings', JSON.stringify(state.settings)); } catch {} }
  });
  emit('setting', { key, val });
}

/* ---------- springs ---------- */
class Spring {
  constructor(v = 0, k = 170, c = 24) { this.v = v; this.t = v; this.vel = 0; this.k = k; this.c = c; }
  set(v) { this.v = this.t = v; this.vel = 0; return this; }
  step(dt) {
    const it = effInt();
    if (it === 'min') { this.v = this.t; this.vel = 0; return this.v; }
    const k = it === 'normal' ? this.k * 1.5 : this.k, c = it === 'normal' ? this.c * 1.22 : this.c;
    const n = Math.ceil(dt / 0.008), h = dt / n;
    for (let i = 0; i < n; i++) { const a = -k * (this.v - this.t) - c * this.vel; this.vel += a * h; this.v += this.vel * h; }
    return this.v;
  }
  get idle() { return Math.abs(this.v - this.t) < 1e-3 && Math.abs(this.vel) < 1e-3; }
}
function springEase(k = 180, c = 19) {
  let x = 0, v = 0; const pts = []; const h = 1 / 60;
  for (let i = 0; i <= 60; i++) { pts.push(+x.toFixed(4)); for (let j = 0; j < 4; j++) { const a = -k * (x - 1) - c * v; v += a * h / 4; x += v * h / 4; } }
  pts[pts.length - 1] = 1; return `linear(${pts.join(',')})`;
}
/* springs keep the orbital, living feel but are damped (about 0.85) so they settle instead of wobbling */
const EASE = { out: 'cubic-bezier(.16,1,.3,1)', io: 'cubic-bezier(.62,0,.18,1)', spring: springEase(180, 22.5), soft: springEase(120, 19), snappy: springEase(300, 30),
  glide: springEase(150, 22) /* settles without overshoot: smooth view and tab changes */ };

/* WAAPI with the motion intensity applied. Cancels whatever the element was animating (interruptible). */
/* The animations anim() made are remembered per element (el.getAnimations() would flush the page's styles on every call:
   assemble() runs it for dozens of elements in a row, each right after the previous one's animate() dirtied them, which
   cost 10-40 ms on the first visit of a tab). Another module's own el.animate() is its own business. */
const liveAnims = new WeakMap(), bigBox = new WeakMap();
function anim(el, kf, o = {}) {
  if (!el) return null;
  /* only animations made with anim() are interrupted; CSS transitions carry on */
  let mine = liveAnims.get(el);
  if (!o.keep && mine) { for (const a of mine) { if (a.playState === 'idle') continue; try { a.commitStyles(); } catch {} a.cancel(); } mine.length = 0; }
  const d = Math.max(1, (o.d ?? 400) * motion());
  /* blur() on a big animated layer costs a full-size shader pass every frame: on battery the same entrance runs without it */
  if (Array.isArray(kf) && kf.some(k => k.filter)) {
    /* and on a big surface (a view, the settings sheet: more than about 280,000 px) the blur is never worth it, lite or not.
       The size is read once per element and window size: a rect read right after another animate() forces a layout. */
    let big = state.lite;
    if (!big) {
      const m = bigBox.get(el);
      if (m && m.w === innerWidth && m.h === innerHeight) big = m.big;
      else { const r = el.getBoundingClientRect(); big = r.width * r.height > 280000; bigBox.set(el, { w: innerWidth, h: innerHeight, big }); }
    }
    if (big) kf = kf.map(({ filter, ...k }) => k);
  }
  const a = el.animate(kf, { duration: d, delay: (o.delay || 0) * motion(), easing: o.e || EASE.out, fill: o.fill || 'both' });
  if (!mine) liveAnims.set(el, mine = []);
  else if (mine.length > 6) { mine = mine.filter(x => x.playState !== 'idle'); liveAnims.set(el, mine); }
  mine.push(a);
  return a;
}
/* staggered entrance of everything marked [data-asm] inside a container */
function assemble(root, base = 0, step = 40, sel = '[data-asm]') {
  $$(sel, root).forEach((el, i) => anim(el, [
    { opacity: 0, transform: 'translate3d(0,14px,0) scale(.97)' },
    { opacity: 1, transform: 'translate3d(0,0,0) scale(1)' }
  ], { d: 520, delay: base + Math.min(i, 14) * step, e: EASE.spring }));
}

/* single per-frame animation loop */
const tickers = new Set(); let last = performance.now();
/* The tickers (springs, charts, the 3D scene) do not need the display's refresh rate: on a 144 or 165 Hz laptop screen
   every extra frame is a full-window composite for the GPU. They run at most ~70 times a second, ~30 on battery. */
/* Home left alone (nothing touched for 8 s, no sheet or palette open): only ambient motion is left there (the stars, the
   fans, the floating 3D model, the live bars), and ~20 a second is plenty for it (every frame there is a composite of the whole
   window: ~1 % of a core each second it runs at 1 fps more). Modules keep their rate: a benchmark or a
   test runs without input. */
const calm = () => state.view === 'home' && !state.palOpen && !state.setOpen && !SH.homeAnimating && !!SH.isIdle && SH.isIdle();
/* At that pace (and ~30 a second in lighter effects) the loop sleeps on a timer between two ticks instead of asking for every frame (on a 134 Hz screen an empty
   frame every 7 ms still woke the page and the compositor for nothing). At full rate it asks for every frame as before: a
   timer that short may wait 15 ms on Windows. */
let slept = false;
const later = (ms, gap) => { if (gap > 12 && ms > 8) { slept = true; setTimeout(() => requestAnimationFrame(loop), ms - 2); } else requestAnimationFrame(loop); };
function loop(t) {
  const gap = calm() ? 48 : state.lite ? 28 : 12;
  /* the frame right after a timer sleep ticks (the timer already waited: asking for one more frame made two frames a tick) */
  const need = slept ? gap - 8 : gap; slept = false;
  if (t - last < need) { later(gap - (t - last), gap); return; }
  const dt = Math.min(gap > 12 ? .1 : .05, (t - last) / 1000); last = t; for (const fn of tickers) { try { fn(dt, t); } catch (e) { console.error(e); tickers.delete(fn); } }
  /* window in the tray or minimized (WebView2 may still deliver frames then): nobody sees the springs, charts or 3D scene, so
     the loop only checks back a few times a second instead of every frame, and goes back to full speed when it is shown again */
  if (pageHidden()) setTimeout(() => requestAnimationFrame(loop), 250); else later(gap, gap); }
requestAnimationFrame(loop);

/* ---------- formatting ---------- */
/* numbers follow the interface language (1,234.5 in English, 1.234,5 in Spanish...) */
const LOCALE = (window.SH && SH.i18n && SH.i18n.locale) || 'en-US';
const fmt1 = v => (+v).toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtInt = v => Math.round(+v).toLocaleString(LOCALE);
function fmtBytes(b) { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return (i ? fmt1(b) : Math.round(b)) + ' ' + u[i]; }
function countUp(el, to, d = 900, dec = 0) {
  if (state.settings.countUp === false) { el.textContent = dec ? fmt1(to) : fmtInt(to); el.dataset.v = to; return; }
  const t0 = performance.now(), dur = Math.max(1, d * motion()); const from = +(el.dataset.v || 0);
  const f = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 4), v = from + (to - from) * e;
    el.textContent = dec ? fmt1(v) : fmtInt(v); if (k < 1) requestAnimationFrame(f); else el.dataset.v = to; };
  requestAnimationFrame(f);
}
/* rolling number (odometer): when the text changes, each character that differs slides to its next value (the old one
   up and out, the new one in from below; the other way when the number goes down). Compositor only (transform and
   opacity through WAAPI). Every character sits in a clipped, fixed-width cell, so only the outgoing and the incoming
   glyph can ever be seen and nothing shifts sideways. A counter that is fed many times a second is coalesced: the
   element shows the latest value at most every ~200 ms, and any roll still under way is cancelled first, so animations
   never stack and no stale glyph is left behind. Plain text while the lighter mode is on, at intensity "minimum" or when
   the count-up setting is off.   SH.rollNumber(el, 77390, { format: SH.fmtInt }); a string is shown as it is. */
const ROLL_GAP = 240;
/* a counter fed many times a second (files read during a scan) does not roll: every digit changes on every update,
   so a roll would only ever show half-moved glyphs. It counts up instead, frame by frame, easing toward the latest
   value: it never jumps and only one value is ever on screen.   SH.rollNumber(el, n, { tick: true }) */
function tickTo(el, value, o) {
  const f = o.format || fmtInt;
  if (el._rn) { if (el._rn.timer) clearTimeout(el._rn.timer); el._rn = null; el.textContent = f(+(el.dataset.v || 0)); }
  let tk = el._tk;
  if (!tk) { tk = el._tk = { cur: value, to: value, raf: 0 }; el.textContent = f(value); return; }
  tk.to = value; tk.f = f;
  if (tk.raf) return;
  let prev = performance.now();
  const step = now => {
    const dt = Math.min(.1, (now - prev) / 1000); prev = now;
    const gap = tk.to - tk.cur;
    tk.cur = Math.abs(gap) < 1 ? tk.to : tk.cur + gap * (1 - Math.exp(-dt * 9));   /* ~90% of the way in a quarter second */
    const txt = tk.f(Math.round(tk.cur));
    if (txt !== el.textContent) { el.textContent = txt; if (o.sound !== false) countTick(el); }  /* count_tick (see the sounds) */
    tk.raf = tk.cur === tk.to || el._tk !== tk ? 0 : requestAnimationFrame(step);
  };
  tk.raf = requestAnimationFrame(step);
}
function rollNumber(el, value, o = {}) {
  if (!el) return;
  const num = typeof value === 'number' && isFinite(value);
  const fast = num && o.tick && !(state.lite || effInt() === 'min' || state.settings.countUp === false || o.plain || document.hidden);
  if (fast) { el.dataset.v = value; tickTo(el, value, o); return; }
  if (el._tk) { if (el._tk.raf) cancelAnimationFrame(el._tk.raf); el._tk = null; }
  const txt = num ? (o.format || fmtInt)(value) : String(value);
  if (num) el.dataset.v = value;
  let rn = el._rn;
  if (rn && rn.cols && (!rn.cols.length || rn.cols[0].el.parentNode !== el)) rn = el._rn = null; /* something else rewrote the element */
  const plain = state.lite || effInt() === 'min' || state.settings.countUp === false || o.plain || document.hidden;
  if (rn && rn.timer) { rn.next = { txt, num: num ? value : null, o }; return; } /* a newer value replaces the waiting one */
  if (rn && rn.txt === txt && (rn.cols || el.textContent === txt)) return;
  if (!rn || plain || !rn.cols) {
    if (plain) { const was = el.textContent; el.textContent = txt; el._rn = { txt, num: num ? value : null, cols: null, t: performance.now() }; if (o.tick && num && was !== txt && o.sound !== false) countTick(el); painted(el, o); }
    else { build(el, txt); el._rn.num = num ? value : null; painted(el, o); }
    return;
  }
  const wait = rn.t + ROLL_GAP - performance.now();
  if (wait > 4) {
    rn.next = { txt, num: num ? value : null, o };
    rn.timer = setTimeout(() => { const n = rn.next; rn.timer = 0; rn.next = null; if (el._rn === rn && n) rollNumber(el, n.num != null ? n.num : n.txt, { ...n.o, format: n.num != null ? () => n.txt : undefined }); }, wait);
    return;
  }
  const cols = rn.cols, old = rn.txt, nw = Array.from(txt), od = Array.from(old);
  const dir = num && rn.num != null && value < rn.num ? -1 : 1, dur = (o.d ?? 230) * motion(), dy = dir * (effInt() === 'normal' ? 60 : 85);
  const mk = ch => { const e = document.createElement('rn-c'), cur = document.createElement('rn-n'); setCh(e, ch); cur.textContent = ch; e.appendChild(cur); return { el: e, cur, anim: null, ghost: null }; };
  const out = [];
  for (let k = 1; k <= Math.max(nw.length, od.length); k++) {
    const a = od[od.length - k], b = nw[nw.length - k], c = cols[od.length - k];
    if (b === undefined) { if (c) { c.anim && c.anim.cancel(); c.el.remove(); } continue; }
    if (a === b && c) { out.unshift(c); continue; }
    if (a === undefined || !c) {
      const col = mk(b); el.insertBefore(col.el, el.firstChild); out.unshift(col);
      col.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur * .7, easing: 'ease-out' });
      continue;
    }
    /* clean state first: whatever was still moving in this cell is dropped */
    if (c.anim) { try { c.anim.cancel(); } catch {} c.anim = null; }
    c.el.querySelectorAll('rn-g').forEach(g => g.remove());
    const g = document.createElement('rn-g'); g.textContent = a; c.el.appendChild(g);
    c.cur.textContent = b; setCh(c.el, b);
    const ease = { duration: dur, easing: EASE.out, fill: 'both' };
    const ga = g.animate([{ opacity: 1, transform: 'translate3d(0,0,0)', offset: 0 }, { opacity: 0, transform: `translate3d(0,${-dy * .6}%,0)`, offset: .42 }, { opacity: 0, transform: `translate3d(0,${-dy}%,0)`, offset: 1 }], ease);
    ga.onfinish = () => g.remove();
    c.anim = c.cur.animate([{ opacity: 0, transform: `translate3d(0,${dy}%,0)`, offset: 0 }, { opacity: 0, transform: `translate3d(0,${dy * .6}%,0)`, offset: .38 }, { opacity: 1, transform: 'translate3d(0,0,0)', offset: 1 }], ease);
    c.anim.onfinish = () => { if (c.anim) { try { c.anim.cancel(); } catch {} c.anim = null; } };
    out.unshift(c);
  }
  el.setAttribute('aria-label', txt);
  rn.cols = out; rn.txt = txt; rn.num = num ? value : null; rn.t = performance.now();
  painted(el, o);
}
/* the number on screen has just changed: a percentage plays its step now, with the paint (o.percent: the value shown) */
function painted(el, o) { if (o.percent != null) sndPercent(el, o.percent); }
const setCh = (e, ch) => { e.dataset.c = ch; if (/\d/.test(ch)) e.dataset.d = ''; else delete e.dataset.d; };
function build(el, txt) {
  el.textContent = ''; el.setAttribute('aria-label', txt); el.style.whiteSpace = 'nowrap'; /* columns are atomic: never wrap between them */
  const cols = Array.from(txt).map(ch => {
    const e = document.createElement('rn-c'), cur = document.createElement('rn-n'); setCh(e, ch); e.setAttribute('aria-hidden', 'true');
    cur.textContent = ch; e.appendChild(cur); el.appendChild(e);
    return { el: e, cur, anim: null, ghost: null };
  });
  el._rn = { txt, num: null, cols, t: performance.now(), timer: 0, next: null };
}
/* shrinks the font size until the text fits on one line */
function fitText(el, max, min = 14) {
  if (!el || !el.parentElement) return;
  el.style.whiteSpace = 'nowrap'; let s = max; el.style.fontSize = s + 'px';
  const w = el.parentElement.clientWidth;
  while (el.scrollWidth > w && s > min) { s -= 1; el.style.fontSize = s + 'px'; }
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- icons (24×24 stroke) ---------- */
const P = {
  home: '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="9.5" ry="4" transform="rotate(-22 12 12)"/>',
  monitor: '<path d="M3 12h3.5l2.5-6 4 12 2.5-6H21"/>',
  drivers: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/><path d="M12 9v6m-2.5-2.5L12 15l2.5-2.5"/>',
  remover: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/><path d="M10 11v5M14 11v5"/>',
  updater: '<path d="M20 11a8 8 0 0 0-14.7-4.4L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.7 4.4L20 16"/><path d="M20 20v-4h-4"/>',
  storage: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M12 3v18M12 12h9M16.5 12v9"/>',
  optimizer: '<path d="M5 18a8 8 0 1 1 14 0"/><path d="m12 13 4-5"/><circle cx="12" cy="13" r="1.4"/>',
  tester: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7 14h10"/>',
  hangar: '<path d="M2.5 20.5h19"/><path d="M4 20.5v-9a8 6.5 0 0 1 16 0v9"/><path d="M8.5 20.5V14h7v6.5"/><path d="M12 14v6.5M8 8.5h8"/>',
  privacy: '<path d="M12 2.8 19.5 6v5.6c0 4.4-3.1 8.2-7.5 9.6-4.4-1.4-7.5-5.2-7.5-9.6V6Z"/><rect x="9.2" y="11" width="5.6" height="4.6" rx="1"/><path d="M10.4 11V9.6a1.6 1.6 0 0 1 3.2 0V11"/>',
  benchmark: '<circle cx="12" cy="13.5" r="7.5"/><path d="M10 2.5h4M12 2.5V6M18.2 6.8l1.6-1.6"/><path d="m12 13.5 3.2-3.2"/><circle cx="12" cy="13.5" r=".6"/>',
  autopilot: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3"/><path d="m9.5 14.5 1.6-4.2 4.2-1.6-1.6 4.2z"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx=".8"/><path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5"/>',
  gpu: '<rect x="2.5" y="6" width="19" height="11" rx="2"/><circle cx="9" cy="11.5" r="3"/><path d="M15 9.5h3.5M15 13h3.5M5 17v2.5M9 17v2.5"/>',
  ram: '<rect x="2.5" y="7" width="19" height="9" rx="1.5"/><path d="M6 10v3M10 10v3M14 10v3M18 10v3M2.5 19h19M7 16v3M17 16v3"/>',
  ssd: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 15h6"/><circle cx="16.5" cy="15" r="1"/><path d="M7 9h10"/>',
  display: '<rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
  battery: '<rect x="2.5" y="7" width="17" height="10" rx="2.2"/><path d="M21.5 10.5v3"/><path d="M6 10.5v3M9.5 10.5v3M13 10.5v3"/>',
  ethernet: '<path d="M4.5 5.5h15v10h-3.5v3h-8v-3H4.5z"/><path d="M9 9.5v2M12 9.5v2M15 9.5v2"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.5 12.5a9.5 9.5 0 0 1 13 0"/><path d="M8.7 16a5 5 0 0 1 6.6 0"/><circle cx="12" cy="19.2" r=".9"/>',
  sys: '<path d="m12 3 9 4.5-9 4.5-9-4.5z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>',
  audio: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  temp: '<path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 10v6.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  speaker: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  camera: '<rect x="3" y="6.5" width="13" height="11" rx="2"/><path d="m16 10.5 5-3v9l-5-3"/>',
  mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v3"/>',
  broom: '<path d="m14 4 6 6M12.5 8.5 4 17l3 3 8.5-8.5"/><path d="M15.5 8.5 11 4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  chev: '<path d="m9 6 6 6-6 6"/>', chevd: '<path d="m6 9 6 6 6-6"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  dots: '<circle cx="5.5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18.5" cy="12" r="1"/>',
  alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5h.01"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>',
  play: '<path d="M7 5v14l12-7z"/>', pause: '<path d="M8 5v14M16 5v14"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  restore: '<path d="M4 12a8 8 0 1 0 2.3-5.6L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M12 8v4l3 2"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  download: '<path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>', upload: '<path d="M12 20V9m-4.5 4.5L12 9l4.5 4.5"/><path d="M4.5 4.5h15"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  bolt: '<path d="M13 2.5 4.5 13.5H12L11 21.5l8.5-11H12z"/>', wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3z"/><path d="M14.5 6.5 17 4l3 3-2.5 2.5"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>', grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  store: '<path d="M4 8h16l-1 12H5z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>', windows: '<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1"/><rect x="13" y="13" width="7.5" height="7.5" rx="1"/>',
  code: '<path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5"/>', package: '<path d="m12 3 8.5 4.5v9L12 21l-8.5-4.5v-9z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
  power: '<path d="M12 3v8"/><path d="M6.5 6.5a7.5 7.5 0 1 0 11 0"/>', sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  sparkle: '<path d="M12 3.5 13.8 10.2 20.5 12 13.8 13.8 12 20.5 10.2 13.8 3.5 12 10.2 10.2z"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
  filter: '<path d="M3.5 5h17l-6.5 8v6l-4-2v-4z"/>', sort: '<path d="M7 4v16m-3.5-3.5L7 20l3.5-3.5M17 20V4m-3.5 3.5L17 4l3.5 3.5"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>', tray: '<path d="M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5"/><path d="M5.5 5h13l2 8.5V19H3.5v-5.5z"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7 14h10"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 20.5a8 8 0 0 1 16 0"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.3 0 1.8-1 1.3-2-.6-1.2.2-2.5 1.6-2.5H17a3.5 3.5 0 0 0 3.5-3.5c0-5-3.8-9-8.5-9z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7.5" r="1"/><circle cx="14.5" cy="7.5" r="1"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z"/>',
  layers: '<path d="m12 3 9 4.5-9 4.5-9-4.5z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>',
  cube: '<path d="m12 2.8 8.5 4.7v9L12 21.2l-8.5-4.7v-9z"/><path d="m3.5 7.5 8.5 4.7 8.5-4.7M12 12.2v9"/>',
};
const ic = (n, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || P.dots}</svg>`;
const icons = { add(o) { Object.assign(P, o); }, has: n => n in P };

/* ---------- empty states: one component for "all done", "nothing found", "nothing yet" and "could not read" ----------
   SH.emptyState({ art, title, text, action, small }) returns the HTML (title and text are ready-made HTML: escape what is not yours).
   art: 'ok' (all done / clean: a planet with a check), 'none' (nothing matches: an orbit with its moon missing),
        'first' (first use / nothing yet: a lone star in its orbit), 'error' (could not read: a planet off its orbit).
   action: { label, id?, data? ('data-retry="x"'), go? ('module/tab': opens it by itself), click? (a selector: clicks that element, e.g. the header button), icon?, pri? } renders a button; listen to it yourself unless it has go.
   cls: an extra class for the module's own sizing.
   small: tighter version for lists and side panels. */
const ES_ART = {
  ok: '<path class="o" d="M16 44a44 12 0 0 1 88 0" transform="rotate(-16 60 44)"/><circle class="p" cx="60" cy="40" r="17"/><path class="c" d="m52.5 40.5 5.5 5.5 10-11"/><path class="o" d="M16 44a44 12 0 0 0 88 0" transform="rotate(-16 60 44)"/><circle class="m" cx="101" cy="33" r="3"/>',
  none: '<path class="o d" d="M16 44a44 12 0 0 1 88 0" transform="rotate(-16 60 44)"/><circle class="p" cx="60" cy="40" r="17"/><path class="o d" d="M16 44a44 12 0 0 0 88 0" transform="rotate(-16 60 44)"/><path class="c" d="M55.4 36.2a4.8 4.8 0 1 1 6.7 4.4c-1.4.7-2.1 1.5-2.1 3M60 47.8v.01"/><circle class="m e" cx="101" cy="33" r="3"/>',
  first: '<ellipse class="o d" cx="60" cy="40" rx="44" ry="13" transform="rotate(-16 60 40)"/><path class="p s" d="M60 22.5 63.6 36.4 77.5 40 63.6 43.6 60 57.5 56.4 43.6 42.5 40 56.4 36.4z"/><circle class="m" cx="96" cy="49" r="3"/>',
  error: '<path class="o d" d="M16 44a44 12 0 0 1 88 0" transform="rotate(-16 60 44)"/><circle class="p" cx="52" cy="44" r="16"/><path class="c" d="m46 36 4 5.5-4 4 5 5"/><path class="o d" d="M18 58a44 12 0 0 0 70 5" transform="rotate(-16 60 44)"/><circle class="m e" cx="100" cy="23" r="3"/>',
};
const ES_STARS = '<path class="t" d="M14 14v6M11 17h6M104 58v5M101.5 60.5h5"/><circle class="t f" cx="27" cy="62" r="1.2"/><circle class="t f" cx="94" cy="12" r="1.2"/><circle class="t f" cx="8" cy="40" r="1"/><circle class="t f" cx="113" cy="38" r="1"/>';
const emptyArt = (art = 'none') => `<svg class="es-art" viewBox="0 0 120 76" aria-hidden="true">${ES_STARS}${ES_ART[art] || ES_ART.none}</svg>`;
const emptyState = ({ art = 'none', title = '', text = '', action, small = false, cls = '' } = {}) => {
  const a = action && action.label ? `<div class="es-act"><button class="btn ${action.pri ? 'pri' : 'sec'}${action.big ? '' : ' sm'}"${action.id ? ` id="${action.id}"` : ''}${action.go ? ` data-es-go="${action.go}"` : ''}${action.click ? ` data-es-click="${action.click}"` : ''}${action.data ? ' ' + action.data : ''}>${action.icon ? ic(action.icon) : ''}${esc(action.label)}</button></div>` : '';
  return `<div class="empty es es-${art}${small ? ' es-sm' : ''}${cls ? ' ' + cls : ''}">${emptyArt(art)}${title ? `<b>${title}</b>` : ''}${text ? `<p>${text}</p>` : ''}${a}</div>`;
};

/* ---------- analyses on demand: a module never analyzes by itself when it opens (unless autoAnalyze is on) ----------
   SH.ago(ms): "just now", "5 min ago", "2 h ago", "yesterday", "3 days ago".
   SH.lastRun({ when, title?, text?, action, cls }) returns the strip that sits above results kept from an earlier
   analysis: a clock, "Last analysis: 2 h ago" (title is the sentence with {when}; text is an optional second line) and
   the primary button (action: { label, id?, data?, icon? }; listen to it yourself). when is in ms (0/null: no date).
   SH.autoAnalyze(): the user asked for the old behaviour (Settings > General). */
const ago = ms => {
  if (!ms) return t('never');
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return t('just now'); if (s < 3600) return t('{n} min ago', { n: Math.round(s / 60) }); if (s < 86400) return t('{n} h ago', { n: Math.round(s / 3600) });
  const d = Math.round(s / 86400); return d === 1 ? t('yesterday') : t('{n} days ago', { n: d });
};
const lastRun = ({ when, title, text = '', action, cls = '' } = {}) => {
  const head = (title || t('Last analysis: {when}')).replace('{when}', `<span class="lr-when" data-when="${+when || 0}">${esc(ago(when))}</span>`);
  const b = action && action.label ? `<button class="btn pri sm"${action.id ? ` id="${action.id}"` : ''}${action.data ? ' ' + action.data : ''}>${action.icon ? ic(action.icon) : ''}${esc(action.label)}</button>` : '';
  return `<div class="lastrun${cls ? ' ' + cls : ''}" role="status"><span class="lr-i">${ic('clock')}</span><div class="lr-t"><b>${head}</b>${text ? `<span>${text}</span>` : ''}</div>${b}</div>`;
};
/* the ages shown keep up while the app stays open */
setInterval(() => { if (document.hidden) return; document.querySelectorAll('.lr-when[data-when]').forEach(e => { const v = +e.dataset.when; if (v) { const s = ago(v); if (e.textContent !== s) e.textContent = s; } }); }, 60000);
const autoAnalyze = () => !!state.settings.autoAnalyze;

/* ---------- the PC (sample data; inside the app it is replaced by the real data from Python) ----------
   Component names, titles, values and typeName arrive translated; the row LABELS (rows[i][0]) stay in English because
   code looks rows up by them: translate them where they are shown, SH.t(label). */
const PC = {
  model: 'ASUS TUF Gaming F16', code: 'FX608JPR', type: 'laptop', typeName: t('Laptop'), maker: 'ASUSTeK',
  os: 'Windows 11 Pro 25H2', build: '26200', bios: 'FX608JPR.312',
  facts: { drivers: 303, programs: 116, freeC: 361 },
  components: [
    { id: 'cpu', name: t('Processor'), title: 'Intel Core i7-14650HX', rows: [['Cores', t('{n} ({p} performance, {e} efficient)', { n: 16, p: 8, e: 8 })], ['Threads', '24'], ['Max frequency', '5.2 GHz'], ['Cache', '30 MB']] },
    { id: 'gpu', name: t('Graphics'), title: 'NVIDIA GeForce RTX 5070 Laptop', rows: [['Memory', '8 GB GDDR7'], ['Integrated', 'Intel UHD Graphics'], ['Driver', '32.0.16.1742']] },
    { id: 'ram', name: t('Memory'), title: '16 GB DDR5', rows: [['Speed', '5600 MT/s'], ['Manufacturer', 'Samsung'], ['Modules', t('{n} × {size} GB, {free} free slot', { n: 1, size: 16, free: 1 })]] },
    { id: 'ssd', name: t('Storage'), title: 'WD PC SN5000S 1 TB', rows: [['Type', 'NVMe SSD'], ['Used', '592 GB'], ['Free', '361 GB']], bar: .62 },
    { id: 'display', name: t('Displays'), title: t('{n} inch, {res}', { n: 16, res: '2560 × 1600' }), rows: [['Refresh rate', '165 Hz'], ['External', '1920 × 1080, 144 Hz']] },
    { id: 'battery', name: t('Battery'), title: t('{wh} Wh, {pct}% health', { wh: 90, pct: 97 }), rows: [['Current capacity', '87.2 Wh'], ['Status', t('Good')]], bar: .97 },
    { id: 'wifi', name: t('Network'), title: 'Wi-Fi 6E', rows: [['Adapter', 'Realtek 8852CE'], ['Link', '1.2 Gb/s']] },
    { id: 'audio', name: t('Audio'), title: 'Realtek High Definition Audio', rows: [['Others', 'NVIDIA HD Audio, USB Audio']] },
    { id: 'sys', name: t('System'), title: 'Windows 11 Pro 25H2', rows: [['Build', '26200'], ['BIOS', 'FX608JPR.312']] },
  ],
};

/* ---------- modules: master list (the dock, the palette and the views come from here) ---------- */
const MODS0 = [
  { id: 'home', name: 'Home', icon: 'home' },
  { id: 'monitor', name: 'Live Monitor', icon: 'monitor', desc: 'Your PC in real time: usage, temperatures, network, battery and health.',
    tabs: [['overview', 'Overview'], ['cpu', 'Processor'], ['gpu', 'Graphics'], ['memory', 'Memory'], ['disks', 'Disks'], ['network', 'Network'], ['battery', 'Battery'], ['processes', 'Processes'], ['health', 'Health']] },
  { id: 'drivers', name: 'Driver Updater', icon: 'drivers', desc: 'Your drivers, new versions from Windows Update and backups.',
    tabs: [['updates', 'Updates'], ['all', 'All drivers'], ['problems', 'Problems'], ['backup', 'Backup'], ['history', 'History']] },
  { id: 'remover', name: 'Program Remover', icon: 'remover', desc: 'Uninstall programs and clear everything they leave behind, with a quarantine to undo.',
    tabs: [['programs', 'Programs'], ['batch', 'Batch'], ['watch', 'Watched install'], ['quarantine', 'Quarantine'], ['history', 'History']] },
  { id: 'updater', name: 'Program Updater', icon: 'updater', desc: 'Programs, Windows, Store and components up to date, in a single queue.',
    tabs: [['overview', 'Overview'], ['apps', 'Programs'], ['windows', 'Windows'], ['store', 'Store'], ['runtimes', 'Components'], ['dev', 'Development'], ['schedule', 'Schedule']] },
  { id: 'hangar', name: 'App Hangar', icon: 'hangar', real: true, desc: 'Pick the apps you want and install them all at once.',
    tabs: [['catalog', 'Catalog'], ['kits', 'Kits'], ['queue', 'Queue'], ['history', 'History']] },
  { id: 'storage', name: 'Storage Checker', icon: 'storage', desc: 'What every folder on your drives takes up, on a map you can explore.',
    tabs: [['map', 'Map'], ['tree', 'Folders'], ['types', 'File types'], ['largest', 'Largest'], ['duplicates', 'Duplicates'], ['compare', 'Compare']] },
  { id: 'optimizer', name: 'Super Optimizer', icon: 'optimizer', desc: 'Clean, repair and speed up Windows. Always with a restore point and undo.',
    tabs: [['overview', 'Overview'], ['clean', 'Cleanup'], ['startup', 'Startup'], ['services', 'Services'], ['registry', 'Registry', () => !!state.settings.registryCleaner], ['repair', 'Repair'], ['performance', 'Performance'], ['debloat', 'Debloat']] },
  { id: 'privacy', name: 'Privacy & Security', icon: 'privacy', real: true, desc: 'What can see you, what is open and how well Windows protects you.',
    tabs: [['overview', 'Overview'], ['permissions', 'App permissions'], ['protection', 'Protection'], ['network', 'Network'], ['tracking', 'Tracking'], ['persistence', 'Auto-starts']] },
  { id: 'benchmark', name: 'Benchmark Testing', icon: 'benchmark', real: true, desc: 'Measure every component, stress-test it and get a score for your PC.',
    tabs: [['overview', 'Overview'], ['cpu', 'Processor'], ['gpu', 'Graphics'], ['memory', 'Memory'], ['disk', 'Disks'], ['network', 'Network'], ['stress', 'Stress test'], ['history', 'History']] },
  { id: 'tester', name: 'Device Tester', icon: 'tester', real: true, desc: 'Test your keyboard, screen, speakers, microphone, camera, mouse and game controller.',
    tabs: [['keyboard', 'Keyboard'], ['screen', 'Screen'], ['speakers', 'Speakers'], ['mic', 'Microphone'], ['camera', 'Camera'], ['mouse', 'Mouse'], ['controller', 'Controller']] },
  { id: 'autopilot', name: 'Scheduled Tasks', icon: 'autopilot', real: true, desc: 'Automatic maintenance: you set the rules, StellarHub follows them.',
    tabs: [['routines', 'Routines'], ['calendar', 'Calendar'], ['notify', 'Notifications'], ['log', 'Log']] },
];
/* names, descriptions and tab names in the interface language (ids stay as they are) */
const MODS = MODS0.map(m => ({ ...m, name: t(m.name), desc: m.desc && t(m.desc), tabs: m.tabs && m.tabs.map(([id, n, when]) => when ? [id, t(n), when] : [id, t(n)]) }));
const modById = id => MODS.find(m => m.id === id);

/* registry of modules and Home views (filled in by the files in js/modules and js/home) */
const registry = { modules: {}, variants: {}, actions: [] };
function module(def) { registry.modules[def.id] = def; emit('module:registered', def); }
function homeVariant(def) { registry.variants[def.id] = def; emit('variant:registered', def); }
const actions = { add(list) { registry.actions.push(...list); }, all: () => registry.actions };

/* ---------- activity and pending items (modules feed them; Home shows them) ----------
   SH.logActivity('Brave updated', { sub: 'to version 1.85', ic: 'updater', go: 'updater', tab: 'apps' })
   SH.setPending('drivers', 4)   // keys: drivers, apps, junk (in GB) */
function logActivity(text, o = {}) {
  const list = (state.settings.activity || []).slice(0, 39);
  const src = x => { const r = x && _recent.get(x); return r ? (r[1] ? [r[0], r[1]] : [r[0]]) : undefined; };
  /* t / sub: the text as it was written (kept for old readers); k / sk: English key + vars, translated when shown */
  const e = { t: text, sub: o.sub || '', ic: o.ic || 'check', go: o.go || '', tab: o.tab || '', at: Date.now() };
  const k = src(text), sk = src(o.sub); if (k) e.k = k; if (sk) e.sk = sk;
  list.unshift(e);
  state.settings.activity = undefined; setSetting('activity', list);
}
/* an activity entry as {t, sub} in the interface language. Old entries (plain strings) show as they are. */
function activityText(e) {
  const tr = (p, plain) => p ? t(p[0], p[1]) : (plain ? t(plain) : '');
  return { t: tr(e.k, e.t), sub: tr(e.sk, e.sub) };
}
/* "8 days 11 h" / "5 h 20 min" / "12 min", the same everywhere (Home, Live Monitor) and in the interface language */
function fmtUptime(s) {
  s = +s; if (!isFinite(s) || s < 0) return '—';
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return h >= 48 ? t('{d} days {h} h', { d: Math.floor(h / 24), h: h % 24 }) : h ? t('{h} h {m} min', { h, m }) : t('{n} min', { n: m });
}
function setPending(key, n) {
  const p = { ...(state.settings.pending || {}) }; p[key] = { n, at: Date.now() };
  state.settings.pending = undefined; setSetting('pending', p); emit('pending', p);
}

/* ---------- activities: long work of a module, followed from anywhere ----------
   const h = SH.activity.start('storage', { key: 'scan', label: SH.t('Scanning'), go: { tab: 'map' } });
   h.progress(.38, SH.t('Reading C:\\Users'));   // 0..1, or null while it cannot be measured (the ring then orbits)
   h.end({ ok: true, summary: SH.t('{size} can be freed', { size }) })   // or { ok: false, error } or { cancelled: true }
   While the user is elsewhere the dock ring, Home's rows and the taskbar button follow it; when it ends there, end() says
   so (a toast with View, or a tray notification while the window is hidden), leaves a badge on the dock icon until the
   module is visited, and answers true. A module whose own result toast would say the same skips it then:
   if (!h.end({ ok: true, summary })) SH.toast(...).
   Work a module starts by itself (the scan on opening Storage, the check on opening Program Updater) passes bg: true:
   it is followed the same way, but only once it has run for ACT_GRACE ms, so a quick refresh never flashes a ring and
   ends without a word. A bg one the user then starts again (the same key) becomes user-started. user: false is never
   shown at all. SH.job feeds it by itself for user-started jobs (sound: 'scan' | 'task') and for bg: true jobs when the
   module has no activity of its own open; o.activity: a handle the job's progress goes to, or false for none. */
const ACT_ALIAS = { debloat: 'optimizer' };
const ACT_EXTRA = { backups: { name: 'Backups and restore', icon: 'restore' } };
const acts = new Map(), actDone = new Map();
let actSeq = 0, actTimer = 0;
const ACT_GRACE = 1500;  /* ms a bg activity runs before it shows anywhere */
const actMod = m => ACT_ALIAS[m] || m;
const actInfo = mod => { const m = MODS.find(x => x.id === mod), x = ACT_EXTRA[mod]; return m ? { name: m.name, icon: m.icon } : x ? { name: t(x.name), icon: x.icon } : { name: String(mod), icon: 'dots' }; };
/* the window is out of sight (in the tray or minimized). Python says so ('window', from Api._tele_refresh) because
   WebView2 can keep document.visibilityState "visible" for a hidden window; document.hidden counts too. */
let winHidden = false;
const pageHidden = () => document.hidden || winHidden;
/* SH.onScreen(el): the user can see el now. In the view in front (or outside the views: the header, a dialog),
   rendered and not transparent, inside the window and the scroll boxes around it, and not covered at the middle of
   what shows of it (the palette, a dialog, the Settings sheet). The window hidden: never. */
function onScreen(el) {
  if (!el || !el.getBoundingClientRect || pageHidden()) return false;
  const v = el.closest && el.closest('.view'); if (v && v.id !== 'v-' + state.view) return false;
  if (el.checkVisibility ? !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : !el.offsetParent) return false;
  const r = el.getBoundingClientRect();
  let l = Math.max(r.left, 0), t = Math.max(r.top, 0), rt = Math.min(r.right, innerWidth), b = Math.min(r.bottom, innerHeight);
  for (let p = el.parentElement; p && p !== document.body && l < rt && t < b; p = p.parentElement) {
    const cs = getComputedStyle(p); if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    const q = p.getBoundingClientRect(); l = Math.max(l, q.left); t = Math.max(t, q.top); rt = Math.min(rt, q.right); b = Math.min(b, q.bottom);
  }
  if (!(l < rt && t < b)) return false;
  const hit = document.elementFromPoint((l + rt) / 2, (t + b) / 2);
  return !!hit && (el.contains(hit) || hit.contains(el));
}
/* the user is looking at that module (its own result UI answers): no toast, no badge */
const actHere = mod => { mod = actMod(mod); if (pageHidden()) return false; return mod === 'backups' ? !!state.setOpen : state.view === mod; };
/* user: it is shown (started by the user, or by the module and running past the grace period); bg: the module started it */
const actView = a => ({ id: a.id, mod: a.mod, key: a.key, label: a.label, text: a.text, pct: a.pct, at: a.at, user: a.shown, bg: a.bg, cancel: !!a.cancel });
/* many progress updates a second become one 'activity' event every ~90 ms (also while hidden, when frames stop) */
function actFlush(now) {
  if (now) { clearTimeout(actTimer); actTimer = 0; emit('activity'); actTaskbar(); return; }
  if (!actTimer) actTimer = setTimeout(() => { actTimer = 0; emit('activity'); actTaskbar(); }, 90);
}
function actStart(mod, o = {}) {
  mod = actMod(mod); const key = o.key || 'main';
  for (const a of acts.values()) if (a.mod === mod && a.key === key) {
    if (o.label) a.label = o.label; if (o.go) a.go = o.go; if (o.cancel) a.cancel = o.cancel;
    if (a.bg && !o.bg && o.user !== false) { a.bg = false; actShow(a); }  /* the user asked for what was already running */
    actFlush(); return a.h;
  }
  const user = o.user !== false, bg = user && !!o.bg;
  const a = { id: ++actSeq, mod, key, label: o.label || t('Working…'), text: '', pct: null, at: Date.now(), user, bg, shown: false, timer: 0, go: o.go || null, cancel: o.cancel || null, auto: !!o.auto };
  a.h = {
    id: a.id, mod,
    get open() { return acts.has(a.id); },
    progress(pct, text) {
      if (!acts.has(a.id)) return a.h;
      const p = typeof pct === 'number' && isFinite(pct) ? Math.max(0, Math.min(1, pct)) : null;
      a.pct = p; if (text != null) a.text = String(text); actFlush(); return a.h;
    },
    label(l) { if (l) { a.label = String(l); actFlush(); } return a.h; },
    end: r => actEnd(a, r || {}),
  };
  acts.set(a.id, a);
  if (bg) a.timer = setTimeout(() => { a.timer = 0; if (acts.has(a.id)) actShow(a); }, o.grace ?? ACT_GRACE);
  else if (user) actShow(a);
  else { emit('activity:start', actView(a)); actFlush(true); }
  return a.h;
}
/* from now on the dock, Home, the palette and the taskbar follow it */
function actShow(a) {
  if (a.shown) return; a.shown = true; clearTimeout(a.timer); a.timer = 0;
  actDone.delete(a.mod); emit('activity:start', actView(a)); actFlush(true);
}
function actEnd(a, r) {
  if (!acts.has(a.id)) return false; acts.delete(a.id); clearTimeout(a.timer); a.timer = 0;
  const cancelled = !!r.cancelled, ok = !cancelled && r.ok !== false && !r.error;
  /* a bg one that ended inside its grace period was never shown: it ends without a word */
  const tell = a.shown && !cancelled && r.quiet !== true && !actHere(a.mod);
  const go = { ...(a.go || {}), ...(r.go || {}) };
  const error = r.error ? String(r.error.message || r.error) : '';
  if (tell && state.view !== a.mod) actDone.set(a.mod, { mod: a.mod, ok, summary: r.summary ? String(r.summary) : '', error, go, at: Date.now() });
  if (a.shown && !ok && !cancelled) actTbErr = Date.now() + 2600;
  emit('activity:end', { ...actView(a), ok, cancelled, told: tell });
  actFlush(true);
  if (tell && !(r.toast === false && !pageHidden())) {  /* toast: false: the module says it itself (the badge and the tray notification stay) */
    /* a job followed on its own: the module may still say how it went in its own toast, which then is enough */
    if (a.auto) { const t0 = performance.now(); setTimeout(() => { if (!((SH.toast.lastAt || 0) > t0)) actTell(a, ok, r, error, go); }, 350); }
    else actTell(a, ok, r, error, go);
  }
  return tell;
}
function actOpen(mod, go = {}) {
  actDone.delete(mod); actFlush(true);
  if (mod === 'backups') SH.go('settings', { section: 'backups' }); else SH.go(mod, go.tab ? { tab: go.tab } : {});
}
function actTell(a, ok, r, error, go) {
  const name = actInfo(a.mod).name, sum = r.summary ? String(r.summary) : '';
  const text = ok ? (sum ? t('{name} finished: {summary}', { name, summary: sum }) : t('{name} finished.', { name }))
    : error ? t('{name} could not finish: {error}', { name, error }) : t('{name} did not finish.', { name });
  /* the window is in the tray or minimized: a Windows notification, whose click opens the window on the module */
  if (pageHidden()) { call('notify_activity', text, a.mod, go.tab || ''); return; }
  /* exactly one sound for the moment: the job's own scan_complete, if it just played, else this toast's */
  const quiet = performance.now() - sound.last < 700;
  SH.toast(text, { kind: ok ? (r.kind || 'success') : 'error', silent: quiet, ms: 9000, group: 'act:' + a.mod, action: { label: t('View'), run: () => actOpen(a.mod, go) } });
}
/* StellarHub's taskbar button follows every shown activity at once: indeterminate while any of them cannot be
   measured, red for a moment when one fails, nothing when all are done. Sent only when it changes. */
let actTbSent = '', actTbErr = 0, actTbTimer = 0;
function actTaskbar() {
  const run = [...acts.values()].filter(a => a.shown);
  let st = 'none', v = 0;
  if (Date.now() < actTbErr) { st = 'error'; v = 1; clearTimeout(actTbTimer); actTbTimer = setTimeout(actTaskbar, actTbErr - Date.now() + 20); }
  else if (run.length) { if (run.some(a => a.pct == null)) st = 'indeterminate'; else { st = 'normal'; v = run.reduce((s, a) => s + a.pct, 0) / run.length; } }
  v = Math.round(v * 100) / 100;
  const sig = st + v; if (sig === actTbSent) return; actTbSent = sig;
  call('taskbar_progress', st, v);
}
/* coming to the module clears its badge; the window coming back shows the taskbar progress again */
on('view', d => { if (d && actDone.delete(d.to)) actFlush(true); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { actTbSent = ''; actTaskbar(); } });
on('window', d => { winHidden = !(d && d.shown); if (!winHidden) { actTbSent = ''; actTaskbar(); } });
on('shown', d => { winHidden = !(d && d.shown); });  /* the start: opened hidden in the tray, or on screen */
/* a promise of long work the module started by itself (a list read on opening a tab), followed as a bg activity:
   SH.activity.follow('drivers', DATA.drivers(), { key: 'list', label, go: { tab: 'all' }, summary: v => '' }) returns
   the same promise. Rejected: the activity says it failed ({ cancelled: true } errors say nothing). */
function actFollow(mod, p, o = {}) {
  const h = actStart(mod, { ...o, bg: o.bg !== false });
  Promise.resolve(p).then(v => { let sum = ''; try { sum = o.summary ? o.summary(v) || '' : ''; } catch {} h.end({ ok: true, summary: sum }); },
    e => h.end(e && e.cancelled ? { cancelled: true } : { ok: false, error: (e && e.message) || String(e || '') }));
  return p;
}
const activity = {
  start: actStart, follow: actFollow,
  /* running activities, the newest first; of(mod): the one to show for a module (the newest), with how many run there */
  list: () => [...acts.values()].map(actView).reverse(),
  of(mod) { mod = actMod(mod); let best = null, n = 0; for (const a of acts.values()) if (a.mod === mod && a.shown) { n++; best = a; } return best ? { ...actView(best), count: n } : null; },
  busy: mod => { mod = actMod(mod); for (const a of acts.values()) if (a.mod === mod) return true; return false; },
  /* finished while the user was elsewhere and not looked at yet */
  done: mod => actDone.get(actMod(mod)) || null,
  doneAll: () => [...actDone.values()].sort((x, y) => y.at - x.at),
  clear(mod) { if (actDone.delete(actMod(mod))) actFlush(true); },
  here: actHere, open: actOpen, info: actInfo,
  /* "62 %", or '' while it cannot be measured */
  pct: a => a && a.pct != null ? fmtInt(a.pct * 100) + ' %' : '',
};

/* ---------- automatic fade on scrollable areas ---------- */
const sfSet = new Set();
function sfUpdate(el) { sfApply(el, el.scrollHeight - el.clientHeight, el.scrollTop); }
/* All the reads first, then all the writes: a class written inside the loop made the next read force a new layout
   (hundreds of layouts per scan on a big list). */
function sfScan(root) {
  if (!root) return;
  const found = [], stack = [root];
  /* The walk prunes whole subtrees that are not rendered (display:none tabs, rows skipped by content-visibility:auto):
     reading a size inside a skipped row forces that row to lay out, one by one. */
  const vis = Element.prototype.checkVisibility ? el => el.checkVisibility({ contentVisibilityAuto: true }) : () => true;
  for (let el; (el = stack.pop());) {
    if (!vis(el)) continue;
    for (let c = el.lastElementChild; c; c = c.previousElementSibling) stack.push(c);
    /* cheapest tests first: only an element that really overflows gets its style read */
    /* a view that scrolls as one page (compact layout) gets no fade: it would mask the whole page */
    if (sfSet.has(el) || el.classList.contains('view') || !el.clientHeight || el.scrollHeight - el.clientHeight <= 2 || el.closest('[data-nofade]')) continue;
    const cs = getComputedStyle(el);
    if (!/(auto|scroll)/.test(cs.overflowY)) continue;
    const plain = cs.backgroundColor === 'rgba(0, 0, 0, 0)' && parseFloat(cs.borderBottomWidth) === 0;
    if (!plain || el.dataset.nofade !== undefined) continue;
    found.push(el);
  }
  for (const el of found) { el.classList.add('sf'); sfSet.add(el); }
  const live = [];
  sfSet.forEach(el => { if (!el.isConnected) sfSet.delete(el); else live.push(el); });
  const m = live.map(el => [el.scrollHeight - el.clientHeight, el.scrollTop]);
  live.forEach((el, i) => sfApply(el, m[i][0], m[i][1]));
}
function sfApply(el, max, top) {
  if (max <= 2) { el.classList.remove('sf-t', 'sf-b'); return; }
  el.classList.toggle('sf-t', top > 2); el.classList.toggle('sf-b', top < max - 2);
}
addEventListener('scroll', e => { const el = e.target; if (el.nodeType === 1 && sfSet.has(el)) sfUpdate(el); }, true);
addEventListener('resize', () => { const l = [...sfSet], m = l.map(el => [el.scrollHeight - el.clientHeight, el.scrollTop]); l.forEach((el, i) => sfApply(el, m[i][0], m[i][1])); });
/* the scan reads the style of every element: it only runs when something was added to the page (or the view or tab changed) */
let sfDirty = 2;
new MutationObserver(ms => { if (!sfDirty && ms.some(m => [...m.addedNodes].some(n => n.nodeType === 1))) sfDirty = 2; }).observe(document.documentElement, { childList: true, subtree: true });
on('view', () => { sfDirty = 2; }); on('tab', () => { sfDirty = 2; });
setInterval(() => {
  if (!sfDirty || document.hidden) return; sfDirty--;
  const v = document.querySelector('.view.is-on'); if (v) sfScan(v); const s = document.querySelector('.overlay.on .sheet .body'); if (s) sfScan(s);
}, 1200);

/* the next-step button of an empty state can open a module tab by itself: data-es-go="module/tab" */
addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-es-go],[data-es-click]'); if (!b) return;
  if (b.dataset.esGo) { const [m, tab] = b.dataset.esGo.split('/'); SH.go(m, tab ? { tab } : {}); } else { const t = document.querySelector(b.dataset.esClick); if (t) t.click(); }
});

/* ---------- charts: one look for every canvas chart (Live Monitor, Benchmark) ----------
   Gridlines: n-1 inner hairlines (--line). Y labels: 11.5 px --faint, sitting on their gridline at the left edge (only when
   the plot is at least 96 px tall). X labels: the same style in the bottom corners. Tooltip: a deep glass box with a
   hairline, 8 px corners, 11.5 px text, one line per series and the time last, placed beside the cursor line.
   Charts reserve CHART.xpad px under the plot for the x labels. */
const chartKit = (() => {
  let cc = null;
  const col = () => cc || (cc = (() => { const cs = getComputedStyle(document.documentElement), o = {}; ['line', 'faint', 'mute', 'ink', 'deep'].forEach(k => { o[k] = cs.getPropertyValue('--' + k).trim(); }); return o; })());
  on('look', () => { cc = null; setTimeout(() => { cc = null; }, 60); });
  const FONT = '11.5px ' + (SH.i18n && SH.i18n.lang === 'ru' ? 'Onest, "Segoe UI", system-ui, sans-serif' : 'Onest, "Microsoft YaHei UI", system-ui, sans-serif');
  const alpha = (c, a) => `color-mix(in srgb, ${c} ${Math.round(a * 100)}%, transparent)`;
  return {
    FONT, xpad: 17,
    grid(x, L, R, T, B, n = 4) { x.strokeStyle = col().line; x.lineWidth = 1; for (let i = 1; i < n; i++) { const y = Math.round(T + (B - T) * i / n) + .5; x.beginPath(); x.moveTo(L, y); x.lineTo(R, y); x.stroke(); } },
    /* y labels from hi (top) to lo (bottom), one per gridline plus the top one */
    ticks(x, L, T, B, n, hi, lo, fmt) {
      if (B - T < 96) return; x.save(); x.font = FONT; x.fillStyle = col().faint; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
      x.lineJoin = 'round'; x.lineWidth = 3; x.strokeStyle = col().deep;
      for (let i = 0; i < n; i++) { const tx = fmt(hi - (hi - lo) * i / n), ty = i ? Math.round(T + (B - T) * i / n) - 4 : T + 12; x.globalAlpha = .85; x.strokeText(tx, L + 3, ty); x.globalAlpha = 1; x.fillText(tx, L + 3, ty); }
      x.restore();
    },
    xlabels(x, L, R, h, a, b) { x.save(); x.font = FONT; x.fillStyle = col().faint; x.textBaseline = 'alphabetic'; x.textAlign = 'left'; if (a) x.fillText(a, L + 3, h - 4); x.textAlign = 'right'; if (b) x.fillText(b, R - 3, h - 4); x.restore(); },
    /* lines: [[color, text], ...]; px: the cursor x; returns nothing */
    tip(x, px, W, T, lines) {
      x.save(); x.font = '500 ' + FONT; const c = col();
      const tw = Math.max(...lines.map(l => x.measureText(l[1]).width)) + 20, bh = lines.length * 17 + 10, bx = px + 14 + tw > W ? px - 14 - tw : px + 14;
      x.fillStyle = c.deep; x.globalAlpha = .95; x.beginPath(); x.roundRect(bx, T, tw, bh, 8); x.fill(); x.globalAlpha = .16; x.strokeStyle = c.ink; x.lineWidth = 1; x.stroke(); x.globalAlpha = 1;
      x.textAlign = 'left'; x.textBaseline = 'alphabetic'; lines.forEach((l, i) => { x.fillStyle = l[0]; x.fillText(l[1], bx + 10, T + 18 + i * 17); });
      x.restore();
    },
    cursor(x, px, T, B) { x.save(); x.strokeStyle = col().ink; x.globalAlpha = .22; x.lineWidth = 1; x.beginPath(); x.moveTo(Math.round(px) + .5, T); x.lineTo(Math.round(px) + .5, B); x.stroke(); x.restore(); },
  };
})();

/* ---------- sounds ----------
   SH.sound('click') plays one of the short interface sounds, ui/sounds/<event>.ogg, through the Web Audio API: one
   AudioContext, one master gain (the Volume setting), each file fetched and decoded the first time it is needed
   (js/sounds.js preloads the common ones in idle time and wires the interface to them). What keeps it calm:
   - settings: `sounds` (all of them), `soundVolume` (0-1) and one switch per group (soundUi, soundAlerts, soundTasks,
     soundSystem). Lighter effects and intensity "minimum" mute nothing.
   - nothing plays while the page is hidden (the window in the tray or minimized), except app_exit.
   - every event has a minimum gap between two plays (hover 70 ms, hover_soft 90 ms, click 40 ms, most others 120 ms
     or more).
   - one sound per gesture. Interface sounds (`user`) need a click, a key or a controller press in the last 1.5 s, so
     code that changes a tab or a view by itself stays quiet. Within 100 ms the first interface sound wins; a more
     important one (a notification, a finished scan) cuts whatever less important one began in those 100 ms, and a
     less important one right after a more important one is dropped. A plain toast keeps quiet when anything played
     in the last 350 ms: the action already made its sound. At most 4 sounds at once.
   opts: gain (an extra trim), visible (the caller knows its window is on screen: the tray panel), preview (Settings >
   Sound "Play a sample": plays even with its group off).
   Returns true when the sound plays (or will, once its file is decoded).
   g: a trim per sound, set from the loudest 100 ms of each file so that the interface sits about 6 dB under the
   notifications and the quiet ones (hover, focus moves, ticks, keys) about 6 dB under the interface (the typing tick,
   key_type, a little above them; the map tick, map_hover, a little under hover; hover_soft, the tick of the secondary
   elements, about 8 dB under hover).
   f: the file when it is not named after the event (navigate plays navigate_click.ogg). */
const SOUND_EV = {
  /* interface */
  click: { c: 'ui', g: .5, gap: 40, tier: 1, user: 1 }, hover: { c: 'ui', g: .165, gap: 70, tier: 0 },
  hover_soft: { c: 'ui', g: .21, gap: 90, tier: 0 },
  tab_switch: { c: 'ui', g: .45, gap: 80, tier: 1, user: 1 }, navigate: { c: 'ui', g: .5, gap: 120, tier: 1, user: 1, f: 'navigate_click' },
  dropdown: { c: 'ui', g: .45, gap: 80, tier: 1, user: 1 }, palette_open: { c: 'ui', g: .45, gap: 150, tier: 1, user: 1 },
  focus_move: { c: 'ui', g: .2, gap: 45, tier: 0 }, panel_open: { c: 'ui', g: .45, gap: 150, tier: 1, user: 1 },
  panel_close: { c: 'ui', g: .4, gap: 150, tier: 1, user: 1 }, toggle_on: { c: 'ui', g: .45, gap: 60, tier: 1, user: 1 },
  toggle_off: { c: 'ui', g: .34, gap: 60, tier: 1, user: 1 },
  key_type: { c: 'ui', g: .21, gap: 30, tier: 0, user: 1 }, map_hover: { c: 'ui', g: .24, gap: 35, tier: 0 },
  /* notifications */
  toast: { c: 'alerts', g: .47, gap: 400, tier: 1 }, success: { c: 'alerts', g: .5, gap: 300, tier: 2 },
  warning: { c: 'alerts', g: .5, gap: 300, tier: 2 }, error: { c: 'alerts', g: .45, gap: 300, tier: 2 },
  unavailable: { c: 'alerts', g: .45, gap: 400, tier: 2 }, achievement: { c: 'alerts', g: .55, gap: 1500, tier: 3 },
  /* tasks */
  scan_start: { c: 'tasks', g: .5, gap: 500, tier: 1 }, scan_complete: { c: 'tasks', g: .92, gap: 300, tier: 2 },
  progress_tick: { c: 'tasks', g: .25, gap: 400, tier: 0 },
  count_tick: { c: 'tasks', g: .5, gap: 83, tier: 0, n: 4 }, percent_step: { c: 'tasks', g: .37, gap: 85, tier: 0, steps: 9 }, refresh: { c: 'tasks', g: .45, gap: 300, tier: 1, user: 1 },
  delete: { c: 'tasks', g: .5, gap: 200, tier: 1, user: 1 }, undo: { c: 'tasks', g: .5, gap: 200, tier: 1, user: 1 },
  copy: { c: 'tasks', g: .45, gap: 200, tier: 1, user: 1 }, screenshot: { c: 'tasks', g: .5, gap: 300, tier: 2 },
  /* system */
  app_start: { c: 'system', g: .5, gap: 3000, tier: 3 }, app_exit: { c: 'system', g: .5, gap: 3000, tier: 3 },
  admin_granted: { c: 'system', g: .47, gap: 3000, tier: 3 }, update_available: { c: 'system', g: .5, gap: 2000, tier: 2 },
  update_installed: { c: 'system', g: .55, gap: 2000, tier: 3 }, device_connected: { c: 'system', g: .5, gap: 1000, tier: 2 },
  device_disconnected: { c: 'system', g: .46, gap: 1000, tier: 2 }, widget_on: { c: 'system', g: .45, gap: 150, tier: 1 },
  widget_off: { c: 'system', g: .38, gap: 150, tier: 1 }, key_press: { c: 'system', g: .16, gap: 25, tier: 0 },
};
/* A module change (navigate) is two sounds: the trackpad click at once and, 20 ms later, a soft swoosh that goes with
   the view's transition. The seven swooshes take turns, so two changes in a row never sound the same. Each has its own
   trim from its loudest 100 ms: they sit about 7 dB under the click (-36 against -29 dB). At intensity 'min' the
   transition is shorter but still there, so the swoosh stays. It follows the click: nothing of its own decides it. */
const SWOOSH = { delay: .02, n: -1, files: [['navigate_swoosh_1', .53], ['navigate_swoosh_2', .55], ['navigate_swoosh_3', .58],
  ['navigate_swoosh_4', .57], ['navigate_swoosh_5', .59], ['navigate_swoosh_6', .46], ['navigate_swoosh_7', .54]] };
/* The loading loop (SH.sound.loop): loading.ogg is one seamless 2.1 s cycle (a sonar ping and two echoes, one turn of
   Driver Updater's radar) played with loop = true, gapless, while a loading indicator is on screen (js/sounds.js
   decides when). Group Tasks (soundTasks). Its trim puts it about 2 dB under navigate's swooshes and 7 above hover: a
   background, not an event. It is a voice of its own (it never counts in the 4 at once and never cuts anything); it
   fades out in about 150 ms. A notification or a finished task (tier 2 or more: scan_complete, success, error...)
   ducks it for `duck` ms: it may be another module's work that ended in the background, so the loop comes back if an
   indicator is still asking for it then, and ends if none is (the end of the visible one stops it). Never while the
   page is hidden. */
const LOOP = { file: 'loading', g: .25, fade: .05, duck: 700 };
/* count_tick ("blip"): a muted dry blip for each visible change of a big number counting up on screen
   (SH.rollNumber(el, n, { tick: true }): the files a scan has read), at most ~12 a second; one of `n` micro-variants
   (count_tick_1..4), never the same twice in a row; about 5 dB under hover. percent_step ("glass pluck"): one soft
   pluck each time a percentage on screen shows a higher whole number (SH.rollNumber(el, text, { percent }): the
   Benchmark score), from the same code that paints it, so the pitch always matches the number shown; `steps`
   pre-rendered pitches at equal loudness, E major pentatonic E5..B6 (percent_step_0..8, step = min(8, floor(pct * 9 /
   101))). A step that comes inside the gap is dropped, never queued: no sound is ever late. Both in the Tasks group,
   only for an element on screen (onScreen). */
const sndFile = ev => SOUND_EV[ev].f || ev;
/* the file to play now: an event with steps takes the one asked for (o.step); one with variants (n) one at random,
   never the one it played last */
function sndPick(ev, o = {}) {
  const d = SOUND_EV[ev];
  if (d.steps) return `${ev}_${Math.max(0, Math.min(d.steps - 1, o.step | 0))}`;
  const n = d.n; if (!n) return sndFile(ev);
  let k; do k = 1 + Math.floor(Math.random() * n); while (n > 1 && k === snd.lastVar[ev]);
  snd.lastVar[ev] = k; return `${ev}_${k}`;
}
const sndFiles = ev => { const d = SOUND_EV[ev];
  return d.steps ? Array.from({ length: d.steps }, (_, i) => `${ev}_${i}`) : d.n ? Array.from({ length: d.n }, (_, i) => `${ev}_${i + 1}`) : [sndFile(ev)]; };
const SOUND_CAT = { ui: 'soundUi', alerts: 'soundAlerts', tasks: 'soundTasks', system: 'soundSystem' };
const snd = { ctx: null, master: null, buf: new Map(), failed: new Map(), last: {}, lastAny: -1e9, hist: [], voices: [], gestureAt: -1e9, act: null, loop: null, loopAsk: -1e9, loopT: 0, lastVar: {} };
function sndCtx() {
  if (snd.ctx) return snd.ctx;
  const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
  try { snd.ctx = new C({ latencyHint: 'interactive' }); } catch { return null; }
  snd.master = snd.ctx.createGain(); snd.master.connect(snd.ctx.destination); sndVolume();
  return snd.ctx;
}
/* the slider is linear for the eye, the ear wants a curve: half way is about a quarter of the power */
function sndVolume() { if (!snd.master) return; const v = Math.max(0, Math.min(1, +state.settings.soundVolume || 0)); snd.master.gain.cancelScheduledValues(0); snd.master.gain.value = v * v * 1.6; }
/* file: the name of an .ogg in ui/sounds (sndFile(ev) for an event) */
function sndLoad(file) {
  const have = snd.buf.get(file); if (have) return have;
  if (performance.now() - (snd.failed.get(file) ?? -1e9) < 30000) return null;  /* a missing file is not asked for again at every click */
  const ctx = sndCtx(); if (!ctx) return null;
  const p = fetch(`sounds/${file}.ogg`).then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.arrayBuffer(); })
    .then(a => ctx.decodeAudioData(a))
    .then(b => { snd.buf.set(file, b); return b; }, () => { snd.buf.delete(file); snd.failed.set(file, performance.now()); return null; });
  snd.buf.set(file, p);
  return p;
}
/* plays a file on voice v once it is decoded (at once if it already is); one decoded too late is dropped: a sound must
   land with what it belongs to. false: the file can't be had. */
function sndPlay(v, file, o) {
  const b = snd.buf.get(file);
  if (b instanceof AudioBuffer) { sndStart(v, b, o); return true; }
  const p = sndLoad(file);
  if (!p) { v.ended = true; return false; }
  p.then(ab => { if (!ab || performance.now() - v.at > 300) { v.ended = true; return; } sndStart(v, ab, o); });
  return true;
}
function sndStart(v, b, o) {
  const ctx = snd.ctx; if (!ctx || v.cancelled) { v.ended = true; return; }
  if (ctx.state !== 'running') {  /* not allowed to play yet (no gesture in a plain browser): late is worse than never */
    const t0 = performance.now();
    ctx.resume().then(() => { if (performance.now() - t0 < 150 && !v.cancelled && ctx.state === 'running') sndStart(v, b, o); else v.ended = true; }, () => { v.ended = true; });
    return;
  }
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = b; src.loop = !!v.loop;
  g.gain.value = v.duck ? 0 : v.trim * (o.gain ?? 1);
  src.connect(g); g.connect(snd.master);
  src.onended = () => { v.ended = true; try { g.disconnect(); } catch {} };
  v.src = src; v.g = g; src.start(v.delay ? ctx.currentTime + v.delay : 0);
}
function sndStop(v, fade = .01) {
  v.cancelled = true; v.ended = true;
  if (v.src && snd.ctx) { const t = snd.ctx.currentTime; try { v.g.gain.setTargetAtTime(0, t, fade); v.src.stop(t + fade * 5); } catch {} }
}
function sound(ev, o = {}) {
  const d = SOUND_EV[ev]; if (!d) return false;
  const st = state.settings, now = performance.now();
  if (!o.preview && (st.sounds === false || st[SOUND_CAT[d.c]] === false)) return false;
  /* a plain toast inside a click on a control js/sounds.js will sound (a switch: toggle_on / toggle_off) stays quiet:
     the control's own sound says it, and an on and an off no longer sound the same */
  if (ev === 'toast' && snd.act && snd.act.own && !snd.act.claimed && now - snd.act.at < 40) return false;
  /* this gesture has its sound: js/sounds.js adds no click to it */
  if (snd.act && now - snd.act.at < 40) snd.act.claimed = true;
  if (!(+st.soundVolume > 0)) return false;
  if (pageHidden() && ev !== 'app_exit' && !o.visible) return false;  /* also hidden in the tray, which WebView2 may not report */
  if (d.user && now - snd.gestureAt > 1500 && !o.preview && !o.visible) return false;
  if (now - (snd.last[ev] ?? -1e9) < d.gap) return false;
  snd.hist = snd.hist.filter(h => now - h.at < 100);
  if (snd.hist.some(h => h.tier > d.tier)) return false;
  if (d.tier === 1 && snd.hist.some(h => h.tier === 1)) return false;
  if (ev === 'toast' && now - snd.lastAny < 350) return false;
  snd.voices = snd.voices.filter(v => !v.ended);
  if (d.tier >= 2) snd.voices.forEach(v => { if (v.tier < d.tier && now - v.at < 100) sndStop(v); });
  if (d.tier >= 2) loopDuck();  /* a task is over (maybe elsewhere): the loop steps aside for its sound */
  /* two long system sounds never overlap (the start sound, then "updated to x.y.z"): the newer one takes over */
  if (d.tier === 3) snd.voices.forEach(v => { if (v.tier === 3) sndStop(v, .04); });
  snd.voices = snd.voices.filter(v => !v.ended);
  if (snd.voices.length >= 4) { const low = snd.voices.filter(v => v.tier < d.tier).sort((a, b) => a.at - b.at)[0]; if (!low) return false; sndStop(low); }
  const ctx = sndCtx(); if (!ctx) return false;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  snd.last[ev] = now; snd.lastAny = now; snd.hist.push({ tier: d.tier, at: now });
  const v = { ev, tier: d.tier, at: now, trim: d.g, src: null, g: null, ended: false, cancelled: false };
  snd.voices.push(v);
  if (!sndPlay(v, sndPick(ev, o), o)) return false;
  if (ev === 'navigate') {
    /* the swoosh under the click: the next one in turn, as a quiet voice of its own (tier 0: it never cuts anything) */
    SWOOSH.n = (SWOOSH.n + 1) % SWOOSH.files.length;
    const [file, trim] = SWOOSH.files[SWOOSH.n];
    const w = { ev, tier: 0, at: now, trim, delay: SWOOSH.delay, src: null, g: null, ended: false, cancelled: false };
    snd.voices.push(w); sndPlay(w, file, o);
  }
  return true;
}
/* the loading loop (see LOOP). loop(true) while an indicator is on screen: starts it, or keeps the one playing (never
   from the beginning again); loop(false) when none is: fades it and lets the next indicator start it again. Returns
   whether it plays. */
function loopOn() { return !!(snd.loop && !snd.loop.ended); }
function loopStop() { if (snd.loop) { sndStop(snd.loop, LOOP.fade); snd.loop = null; } clearTimeout(snd.loopT); }
function loopDuck() {
  const v = snd.loop; if (!v || v.ended) return;
  v.duck = true; if (v.g && snd.ctx) v.g.gain.setTargetAtTime(0, snd.ctx.currentTime, .03);
  clearTimeout(snd.loopT);
  snd.loopT = setTimeout(() => {
    if (snd.loop !== v || v.ended) return;
    v.duck = false;
    /* an indicator still on screen asked for it a moment ago (sounds.js asks every 200 ms): back; otherwise it ends */
    if (performance.now() - snd.loopAsk > 450 || pageHidden()) { loopStop(); return; }
    if (v.g && snd.ctx) v.g.gain.setTargetAtTime(v.trim, snd.ctx.currentTime, .08);
  }, LOOP.duck);
}
function sndLoop(on) {
  if (!on) { loopStop(); return false; }
  const st = state.settings;
  if (st.sounds === false || st.soundTasks === false || !(+st.soundVolume > 0) || pageHidden()) { loopStop(); return false; }
  snd.loopAsk = performance.now();
  if (loopOn()) return true;
  const ctx = sndCtx(); if (!ctx) return false;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const v = snd.loop = { ev: 'loading', tier: 0, at: performance.now(), trim: LOOP.g, loop: true, src: null, g: null, ended: false, cancelled: false };
  if (!sndPlay(v, LOOP.file, {})) { snd.loop = null; return false; }
  return true;
}
/* hidden (the tray, minimized), or its group turned off: it stops at once */
on('window', d => { if (!(d && d.shown)) loopStop(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) loopStop(); });
on('setting', ({ key, val }) => { if ((key === 'sounds' || key === 'soundTasks') && val === false) loopStop(); if (key === 'soundVolume' && !(+val > 0)) loopStop(); });
/* count_tick for a counter that changed on screen (the gap is checked first: the on-screen test is the costly part) */
function countTick(el) {
  if (performance.now() - (snd.last.count_tick ?? -1e9) < SOUND_EV.count_tick.gap || !onScreen(el)) return false;
  return sound('count_tick');
}
/* percent_step for el, which shows pct (0-100) from this very moment: called by rollNumber where it paints the
   number, so the pitch is the one of the number on screen. One pluck per higher whole number shown (going down or
   starting again says nothing); inside the gap it is dropped. */
function sndPercent(el, pct) {
  const n = Math.max(0, Math.min(100, Math.round(+pct || 0)));
  if (!el || el._pct === n) return false;
  const up = el._pct != null && n > el._pct; el._pct = n;
  if (!up || !onScreen(el)) return false;
  return sound('percent_step', { step: Math.min(8, Math.floor(n * 9 / 101)) });
}
/* a gesture: interface sounds may follow it (the controller calls SH.sound.gesture() on every button) */
const sndGesture = () => { snd.gestureAt = performance.now(); if (snd.ctx && snd.ctx.state === 'suspended') snd.ctx.resume().catch(() => {}); };
addEventListener('pointerdown', sndGesture, { capture: true, passive: true });
addEventListener('keydown', e => { if (e.isTrusted) sndGesture(); }, { capture: true, passive: true });
on('setting', ({ key }) => { if (key === 'soundVolume') sndVolume(); });
Object.assign(sound, {
  EVENTS: Object.keys(SOUND_EV),
  info: ev => SOUND_EV[ev] && { ...SOUND_EV[ev] },
  gesture: sndGesture,
  loop: sndLoop,
  /* js/sounds.js marks the start of a click (begin) and checks at its end whether something already sounded (claimed).
     claim(): this gesture is handled and stays silent (the widget, whose sound comes when its window does). */
  begin() { const n = performance.now(); if (!snd.act || n - snd.act.at > 40) snd.act = { at: n, claimed: false }; return snd.act; },
  claim() { if (snd.act && performance.now() - snd.act.at < 40) snd.act.claimed = true; },
  preload(list) { if (!sndCtx()) return; (list || Object.keys(SOUND_EV)).forEach(ev => { if (ev === 'loading') sndLoad(LOOP.file); if (!SOUND_EV[ev]) return; sndFiles(ev).forEach(sndLoad); if (ev === 'navigate') SWOOSH.files.forEach(f => sndLoad(f[0])); }); },
  /* the files an event plays (navigate: the click and its seven swooshes) */
  files: ev => !SOUND_EV[ev] ? [] : ev === 'navigate' ? [sndFile(ev), ...SWOOSH.files.map(f => f[0])] : sndFiles(ev),
  volume: sndVolume,
  /* fades everything out, starting `at` seconds from now (the window closing) */
  fadeOut(at = 0, len = .12) { if (snd.master && snd.ctx) snd.master.gain.setTargetAtTime(0, snd.ctx.currentTime + at, len / 3); },
});
/* when the last sound started (performance.now()) */
Object.defineProperty(sound, 'last', { get: () => snd.lastAny });
/* whether the loading loop plays */
Object.defineProperty(sound, 'looping', { get: loopOn });
/* whether it is ducked under a notification right now */
Object.defineProperty(sound, 'ducked', { get: () => !!(snd.loop && snd.loop.duck) });

/* i18n.js ran first and already put SH.t and SH.i18n here: keep them */
/* the icon of a PC component: the network adapter is drawn as a cable port when it is wired (Ethernet), Windows for
   the system */
const compIcon = c => !c ? 'cpu' : c.id === 'sys' ? 'windows'
  : c.id === 'wifi' && /ethernet|gbe\b|gigabit|\blan\b|2\.5 ?g|10 ?g/i.test(`${c.title || ''} ${(c.rows || []).flat().join(' ')}`) && !/wi-?fi|wireless|802\.11/i.test(c.title || '') ? 'ethernet' : c.id;
window.SH = Object.assign(window.SH || {}, {
  $, $$, ROOT, state, DEFAULTS, FACT, ORBIT, motion, effInt, on, emit, call, apiReady, loadSettings, setSetting, compIcon,
  engine, job, activity, logActivity, activityText, fmtUptime, setPending, Spring, springEase, EASE, anim, assemble, tickers, fmt1, fmtInt, fmtBytes, countUp, rollNumber, fitText, esc,
  ic, icons, emptyState, emptyArt, ago, lastRun, onScreen, autoAnalyze, chartKit, PC, MODS, modById, registry, module, homeVariant, actions,
  go: () => {}, toast: () => {}, openComponent: () => {}, sfScan, sound,
  /* the window coming in after the start screen, and going away when StellarHub closes, updates or reopens as
     administrator (app.py calls these): a short fade instead of a cut */
  enter() {
    if (state.settings.intensity === 'min') return;
    document.documentElement.animate([{ opacity: 0, transform: 'scale(1.012)' }, { opacity: 1, transform: 'none' }],
      { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
  },
  /* quitting (withSound: the user quit with the window on screen): the exit sound, which Api.quit waits for (at most
     ~0.7 s), fades out with the window */
  leave(withSound) {
    if (withSound && sound('app_exit')) sound.fadeOut(.5, .15);
    const a = document.documentElement.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.985)' }],
      { duration: state.settings.intensity === 'min' ? 80 : 240, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
    return a.finished;
  },
});
})();
