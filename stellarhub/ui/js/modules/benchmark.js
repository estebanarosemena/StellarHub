/* StellarHub · Benchmark: measures every component (processor, graphics, memory, disks, network), a full run that
   gives the PC a StellarHub Score, a stress test with live charts and throttling detection, and the run history.
   Inside the app the processor, memory, disk and network tests run in the engine (stellarhub/engine/benchmark.py);
   the graphics tests render here with WebGL2. Outside the app (browser, design reviews) it shows sample results
   and simulates the engine tests. See docs/UI_CONTRACT.md. */
'use strict';
(() => {
const { $, $$, anim, EASE, Spring, tickers, ic, esc, fmt1, fmtInt, state } = SH;
const t = SH.t, U = SH.unit;
const LOCALE = (SH.i18n && SH.i18n.locale) || 'en-US';
const wait = ms => new Promise(r => setTimeout(r, ms));
const isMin = () => SH.effInt() === 'min';
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const nil = x => x == null || Number.isNaN(x);
let REAL = false; SH.apiReady.then(a => { REAL = !!a; });

SH.icons.add({
  flame: '<path d="M12 21c-3.6 0-6-2.5-6-5.7 0-3.3 2.4-4.9 3.5-8.3 1.7 1.2 2.6 2.9 2.6 4.6 1-.7 1.8-1.9 2-3.2 1.8 1.7 3.9 4 3.9 6.9 0 3.2-2.4 5.7-6 5.7z"/>',
  trend: '<path d="M3.5 17.5 9 12l3.5 3.5L20.5 7.5"/><path d="M15 7.5h5.5V13"/>',
  up: '<path d="m6.5 14.5 5.5-5.5 5.5 5.5"/>', down: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
  orbit: '<circle cx="12" cy="12" r="2.6"/><path d="M4.2 15.6C2.6 12.4 5.4 7.4 10.4 5.2c5-2.2 9.6-1.4 10.6 1.5"/><path d="M19.8 8.4c1.6 3.2-1.2 8.2-6.2 10.4-5 2.2-9.6 1.4-10.6-1.5"/>',
  gauge: '<path d="M4 17a8.5 8.5 0 1 1 16 0"/><path d="m12 14 3.5-4.5"/><path d="M8 17h8"/>',
  chartl: '<path d="M4 4v16h16"/><path d="m7.5 14 3.5-4 3 2.5 4.5-6"/>',
});

/* ============================================================ data */
const comp = id => (SH.PC.components || []).find(c => c.id === id) || { title: '', rows: [] };
const row = (id, re) => ((comp(id).rows || []).find(r => re.test(r[0])) || [, ''])[1];
const COMPS = [
  { id: 'cpu', pc: 'cpu', n: t('Processor'), ic: 'cpu' },
  { id: 'gpu', pc: 'gpu', n: t('Graphics'), ic: 'gpu' },
  { id: 'memory', pc: 'ram', n: t('Memory'), ic: 'ram' },
  { id: 'disk', pc: 'ssd', n: t('Disk'), ic: 'ssd' },
];
const cName = id => (COMPS.find(c => c.id === id) || { n: id }).n;
const KIND = {
  full: [t('Full benchmark'), 'benchmark'], cpu: [t('Processor'), 'cpu'], gpu: [t('Graphics'), 'gpu'], memory: [t('Memory'), 'ram'],
  disk: [t('Disk'), 'ssd'], network: [t('Network'), 'globe'], stress: [t('Stress test'), 'flame'],
};
const pcSnap = () => ({ cpu: comp('cpu').title, gpu: comp('gpu').title, ram: comp('ram').title, disk: comp('ssd').title, model: SH.PC.model });

/* scores: the engine computes them (stellarhub/engine/benchmark.py); this mirror is only for sample mode */
const REF = { gpu: { fill: 143, geo: 383 } };
const W = { cpu: .30, gpu: .30, disk: .25, memory: .15 };
const geo = pairs => { let n = 0, d = 0; pairs.forEach(([r, w]) => { if (r > 0 && w) { n += w * Math.log(r); d += w; } }); return d ? Math.exp(n / d) : null; };
const pts = x => x ? Math.round(x * 1000) : null;
async function scoreGpu(fill, geoFps) {
  if (REAL) { try { return await SH.engine('benchmark', 'score_gpu', fill, geoFps); } catch (e) { console.error(e); } }
  return pts(geo([[fill / REF.gpu.fill, 1], [geoFps / REF.gpu.geo, 1]]));
}
async function overallScore(scores) {
  if (REAL) { try { return await SH.engine('benchmark', 'overall', scores); } catch (e) { console.error(e); } }
  return pts(geo(Object.entries(W).map(([k, w]) => [(scores[k] || 0) / 1000, w])));
}
const TIERS = [[1700, t('Enthusiast')], [1200, t('High end')], [800, t('Strong')], [450, t('Everyday')], [0, t('Entry level')]];
const tier = s => nil(s) ? '' : TIERS.find(([m]) => s >= m)[1];
const SCALE = 2400;  /* points that fill a bar or the ring */

/* ---------- sample data (browser only) ---------- */
function sampleRuns() {
  const day = 864e5, now = Date.now();
  const j = (v, k = .03, s = 1) => +(v * (1 + (Math.sin(s * 12.9898) * 43758.5453 % 1) * k)).toFixed(v < 100 ? 1 : 0);
  const cpu = s => ({ single: { sha256: j(1402, .03, s), blake2b: j(534, .03, s + 1), zlib_c: j(11.8, .03, s + 2), zlib_d: j(262, .03, s + 3) },
    multi: { sha256: j(14120, .04, s + 4), blake2b: j(3080, .04, s + 5), zlib_c: j(101, .04, s + 6), zlib_d: j(1510, .04, s + 7) },
    scoreSingle: Math.round(1063 * (1 + Math.sin(s) * .015)), scoreMulti: Math.round(1695 * (1 + Math.sin(s * 2) * .02)), score: Math.round(1439 * (1 + Math.sin(s * 3) * .018)),
    threads: 24, cores: 16, scaling: 9.1,
    perCore: [...Array(8)].map((_, i) => ({ eff: 1, rel: +(.66 + Math.sin(i * 1.7 + s) * .05).toFixed(3), threads: [.33, .33] }))
      .concat([...Array(8)].map((_, i) => ({ eff: 0, rel: +(.43 + Math.sin(i * 2.3 + s) * .03).toFixed(3), threads: [.43] }))),
    tele: { freqMax: 5.1, freqAvg: 4.3, tempMax: null, loadAvg: 92 } });
  const mem = s => ({ copy: j(14.4, .04, s), read: j(30.7, .04, s + 1), write: j(18.9, .04, s + 2), latency: j(119, .05, s + 3), sizeMb: 256, threads: 8, score: Math.round(610 * (1 + Math.sin(s) * .02)) });
  const dsk = s => ({ drive: 'C:', sizeMb: 256, score: Math.round(1012 * (1 + Math.sin(s) * .03)), tests: {
    seq_q8: { read: j(6180, .03, s), write: j(5120, .04, s + 1) }, seq_q1: { read: j(1720, .05, s + 2), readLat: 581, write: j(3480, .05, s + 3), writeLat: 287 },
    rnd_q32: { read: j(312, .05, s + 4), readIops: 76170, write: j(214, .05, s + 5), writeIops: 52250 },
    rnd_q1: { read: j(41.8, .05, s + 6), readIops: 10205, readLat: 93.4, write: j(78.5, .05, s + 7), writeIops: 19160, writeLat: 47.1 } } });
  const gpu = s => ({ fill: j(165, .03, s), geo: j(440, .03, s + 1), score: Math.round(1150 * (1 + Math.sin(s) * .02)), renderer: 'NVIDIA GeForce RTX 5070 Laptop GPU', res: '1920 × 1080',
    tele: { clockMax: 2.31, clockAvg: 2.18, tempMax: 71, powerMax: 98, loadAvg: 97 } });
  const runs = [];
  [58, 41, 27, 13, 2].forEach((d, i) => {
    const s = i + 1, r = { kind: 'full', at: now - d * day - 3.6e6 * (9 - i), cpu: cpu(s), memory: mem(s), disk: dsk(s), gpu: gpu(s), pc: pcSnap() };
    if (i === 0) { r.disk = { ...r.disk, score: 905 }; r.cpu = { ...r.cpu, score: 1392 }; }
    r.scores = { cpu: r.cpu.score, gpu: r.gpu.score, memory: r.memory.score, disk: r.disk.score };
    r.score = pts(geo(Object.entries(W).map(([k, w]) => [r.scores[k] / 1000, w])));
    runs.push(r);
  });
  runs.push({ kind: 'cpu', at: now - 20 * day, cpu: cpu(9), pc: pcSnap() }, { kind: 'cpu', at: now - 6 * day, cpu: cpu(11), pc: pcSnap() });
  runs.push({ kind: 'network', at: now - 9 * day, network: { host: 'speed.cloudflare.com', server: { colo: 'MAD', city: 'Madrid' }, latency: 4.2, jitter: 1.3, down: 874.6, up: 612.3, downMb: 590, upMb: 420 } });
  runs.push({ kind: 'stress', at: now - 4 * day, stress: { target: 'both', minutes: 5, elapsed: 300, stopped: false, reason: null, errors: 0, cpuTemp: null, gpuTempMax: 78, gpuTempAvg: 74,
    cpuClockStart: 4.6, cpuClockEnd: 4.1, gpuClockStart: 2.28, gpuClockEnd: 2.19, gpuPowerAvg: 96, throttle: [{ part: 'cpu', why: 'clock', at: 94, drop: 11 }], perfStart: 13450, perfEnd: 12160, fpsStart: 298, fpsEnd: 289,
    series: [...Array(150)].map((_, i) => { const tt = i * 2, w = Math.sin(i * .41) * .5 + Math.sin(i * .13 + 1) * .5;
      return { t: tt, cpu: 98 + w, cpuFreq: +(tt < 90 ? 4.6 + w * .05 : 4.1 + w * .06).toFixed(2), cpuTemp: null, gpu: 97 + w, gpuClock: +(2.28 - Math.min(1, tt / 200) * .09 + w * .01).toFixed(2),
        gpuTemp: Math.round(58 + 20 * (1 - Math.exp(-tt / 70)) + w), gpuPower: Math.round(96 + w * 3) }; }) } });
  runs.forEach(r => { r.score = r.score || (r[r.kind] && r[r.kind].score) || null; r.id = 's' + r.at; });
  return runs.sort((a, b) => b.at - a.at);
}

/* ---------- history ---------- */
const H = { runs: null, p: null, subs: new Set() };
function loadHistory(fresh) {
  if (H.runs && !fresh) return Promise.resolve(H.runs);
  return H.p ||= (async () => {
    let runs = null;
    if (REAL) { try { runs = await SH.engine('benchmark', 'history'); } catch (e) { console.error(e); } }
    H.runs = Array.isArray(runs) ? runs : (REAL ? [] : sampleRuns()); H.p = null; return H.runs;
  })();
}
const onHistory = fn => { H.subs.add(fn); return fn; };
const histChanged = () => H.subs.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
async function saveRun(run) {
  run = { ...run, at: Date.now(), pc: run.pc || pcSnap() };
  if (REAL) { try { run = await SH.engine('benchmark', 'save_run', run) || run; } catch (e) { console.error(e); SH.toast(t('The result could not be saved: {msg}', { msg: e.message }), { kind: 'error' }); } }
  if (!run.id) run.id = 's' + run.at;
  await loadHistory(); H.runs.unshift(run); histChanged(); return run;
}
async function deleteRun(id) {
  if (REAL) { try { await SH.engine('benchmark', 'delete_run', id); } catch (e) { console.error(e); return false; } }
  H.runs = (H.runs || []).filter(r => r.id !== id); histChanged(); return true;
}
/* latest result of a component: its own runs and full runs both count */
const latest = (k, skip) => (H.runs || []).find(r => r[k] && r !== skip && r.kind !== 'stress' && (r.kind === k || r.kind === 'full')) || null;
const runsOf = k => (H.runs || []).filter(r => r[k] && (r.kind === k || r.kind === 'full'));
const lastFull = (skip) => (H.runs || []).find(r => r.kind === 'full' && r !== skip) || null;

/* ---------- formatting ---------- */
const DASH = '—';
const fmtN = v => nil(v) ? DASH : fmtInt(v);
const fmtV = v => nil(v) ? DASH : v >= 100 ? fmtInt(v) : fmt1(v);
const fmtDate = at => { const d = new Date(at), now = new Date(); const days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5);
  const hm = d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
  return days === 0 ? t('Today, {time}', { time: hm }) : days === 1 ? t('Yesterday, {time}', { time: hm }) : d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }); };
const fmtShort = at => new Date(at).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
const fmtDur = s => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60), r = s % 60; return `${m}:${String(r).padStart(2, '0')}`; };
const delta = (a, b) => (nil(a) || nil(b) || !b) ? null : (a - b) / b * 100;
function deltaChip(d, quiet) {
  if (nil(d)) return '';
  if (Math.abs(d) < 3) return quiet ? '' : `<span class="chip bm-dc">${t('Same as before')}</span>`;
  return `<span class="chip bm-dc ${d > 0 ? 'ok' : 'warn'}">${ic(d > 0 ? 'up' : 'down')}${fmtInt(Math.abs(d))}%</span>`;
}
const skLine = (w, h = 10) => `<span class="sk" style="display:block;height:${h}px;width:${w}"></span>`;

/* ============================================================ telemetry during a test */
/* records SH.tele while a test runs; null = Windows does not provide it (never shown as 0) */
function teleRec() {
  const s = [];
  const off = SH.tele.on(v => s.push({ at: performance.now(), cpu: v.cpu, cpuFreq: v.cpuFreq, cpuTemp: v.cpuTemp, gpu: v.gpu, gpuClock: v.gpuClock, gpuTemp: v.gpuTemp, gpuPower: v.gpuPower }));
  const vals = k => s.map(x => x[k]).filter(x => !nil(x));
  const max = k => { const a = vals(k); return a.length ? Math.max(...a) : null; };
  const avg = k => { const a = vals(k); return a.length ? a.reduce((p, c) => p + c, 0) / a.length : null; };
  return { s, stop: off, max, avg, vals,
    cpu: () => ({ freqMax: max('cpuFreq'), freqAvg: avg('cpuFreq'), tempMax: max('cpuTemp'), loadAvg: avg('cpu') }),
    gpu: () => ({ clockMax: max('gpuClock'), clockAvg: avg('gpuClock'), tempMax: max('gpuTemp'), powerMax: max('gpuPower'), loadAvg: avg('gpu') }) };
}
const teleFmt = {
  ghz: v => nil(v) ? DASH : `${fmt1(v)}<small>${U('GHz')}</small>`, c: v => nil(v) ? DASH : `${fmtInt(v)}<small>°C</small>`,
  w: v => nil(v) ? DASH : `${fmtInt(v)}<small>${U('W')}</small>`, pct: v => nil(v) ? DASH : `${fmtInt(v)}<small>%</small>`,
};
/* "while testing" panel for the processor and the graphics card: live during a run, the summary afterwards */
function telePanel(kind) {
  const L = kind === 'cpu' ? [['f', t('Clock'), 'ghz'], ['t', t('Temperature'), 'c'], ['l', t('Load'), 'pct']] : [['f', t('Clock'), 'ghz'], ['t', t('Temperature'), 'c'], ['p', t('Power'), 'w'], ['l', t('Load'), 'pct']];
  return `<div class="pan bm-tele" data-asm><h4>${t('While testing')}<em data-tm>${t('live')}</em></h4><div class="bm-tg">${L.map(([k, n]) => `<div data-k="${k}" data-f="${L.find(x => x[0] === k)[2]}"><span>${n}</span><b>${DASH}</b></div>`).join('')}</div></div>`;
}
function teleShow(el, kind, d, live) {
  const p = $('.bm-tele', el); if (!p) return;
  const v = kind === 'cpu' ? { f: d.freqMax ?? d.cpuFreq, t: d.tempMax ?? d.cpuTemp, l: d.loadAvg ?? d.cpu } : { f: d.clockMax ?? d.gpuClock, t: d.tempMax ?? d.gpuTemp, p: d.powerMax ?? d.gpuPower, l: d.loadAvg ?? d.gpu };
  $$('[data-k]', p).forEach(x => { $('b', x).innerHTML = teleFmt[x.dataset.f](v[x.dataset.k]); });
  $('[data-tm]', p).textContent = live ? t('live') : t('peak during the last run');
}
function teleIdle(el, kind) {
  const r = latest(kind); const d = r && r[kind] && r[kind].tele;
  if (d) teleShow(el, kind, d, false);
  else { const p = $('.bm-tele', el); if (p) { $('[data-tm]', p).textContent = t('after a run'); } }
}

/* ============================================================ small charts */
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const rgba = (hex, a) => { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.replace(/./g, c => c + c) : h, 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
function fitCanvas(c) {
  const r = c.getBoundingClientRect(); if (!r.width || !r.height) return null;
  const d = Math.min(2, devicePixelRatio || 1); const w = Math.round(r.width * d), h = Math.round(r.height * d);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); return { x, w: r.width, h: r.height };
}
/* a live line that glides: push() values, it draws itself while visible */
class Live {
  constructor(canvas, col = '--accent2') { this.c = canvas; this.v = []; this.col = col; this.mx = new Spring(1, 60, 14); this.dirty = true;
    this.tick = (dt) => { if (!this.c.isConnected) { tickers.delete(this.tick); return; } if (!this.c.offsetParent) return; this.mx.step(dt); if (this.dirty || !this.mx.idle) this.draw(); };
    tickers.add(this.tick); }
  push(x) { if (nil(x)) return; this.v.push(x); if (this.v.length > 90) this.v.shift(); this.mx.t = Math.max(...this.v) * 1.2 || 1; this.dirty = true; }
  reset() { this.v = []; this.mx.set(1); this.dirty = true; }
  draw() {
    const f = fitCanvas(this.c); if (!f) return; const { x, w, h } = f; this.dirty = false;
    x.clearRect(0, 0, w, h); const v = this.v; if (v.length < 2) return;
    const col = css(this.col) || '#9ED6FF', n = 90, step = w / (n - 1), off = (n - v.length) * step;
    const P = v.map((y, i) => [off + i * step, h - 3 - (y / this.mx.v) * (h - 8)]);
    x.beginPath(); x.moveTo(P[0][0], P[0][1]);
    for (let i = 1; i < P.length - 1; i++) x.quadraticCurveTo(P[i][0], P[i][1], (P[i][0] + P[i + 1][0]) / 2, (P[i][1] + P[i + 1][1]) / 2);
    x.lineTo(P[P.length - 1][0], P[P.length - 1][1]);
    x.strokeStyle = col; x.lineWidth = 2; x.lineJoin = 'round'; x.stroke();
    x.lineTo(P[P.length - 1][0], h); x.lineTo(P[0][0], h); x.closePath();
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, rgba(col, .25)); g.addColorStop(1, rgba(col, 0)); x.fillStyle = g; x.fill();
    const L = P[P.length - 1]; x.fillStyle = col; x.beginPath(); x.arc(L[0] - 1, L[1], 3, 0, 6.3); x.fill();
  }
}
/* points over time (history): series [{ pts: [[at, v]], col }] */
function drawTimeChart(c, series, o = {}) {
  const f = fitCanvas(c); if (!f) return; const { x, w, h } = f; x.clearRect(0, 0, w, h);
  const all = series.flatMap(s => s.pts); if (!all.length) return;
  const t0 = Math.min(...all.map(p => p[0])), t1 = Math.max(...all.map(p => p[0])), span = Math.max(1, t1 - t0);
  const vmax = Math.max(...all.map(p => p[1])) * 1.12, vmin = o.zero ? 0 : Math.min(...all.map(p => p[1])) * .85;
  const L = o.pad ?? 10, R = w - (o.pad ?? 10), T = 10, B = h - (o.axis ? 22 : 8);
  const px = at => all.length === 1 ? (L + R) / 2 : L + (at - t0) / span * (R - L), py = v => B - (v - vmin) / Math.max(1e-9, vmax - vmin) * (B - T);
  const K = SH.chartKit; K.grid(x, L, R, T, B, 4); K.ticks(x, L, T, B, 4, vmax, vmin, v => (o.fmt || fmtN)(v));
  if (o.axis) K.xlabels(x, L, R, h, fmtShort(t0), t1 !== t0 ? fmtShort(t1) : '');
  const prog = o.prog ?? 1;
  series.forEach(s => {
    const col = css(s.col) || s.col; const P = s.pts.slice().sort((a, b) => a[0] - b[0]).map(p => [px(p[0]), py(p[1]), p]);
    if (!P.length) return;
    x.save(); x.beginPath(); x.rect(0, 0, L + (R - L) * prog + 6, h); x.clip();
    if (P.length > 1) {
      x.beginPath(); x.moveTo(P[0][0], P[0][1]); P.slice(1).forEach(p => x.lineTo(p[0], p[1]));
      x.strokeStyle = col; x.lineWidth = 2; x.lineJoin = 'round'; x.stroke();
      if (s.fill) { x.lineTo(P[P.length - 1][0], B); x.lineTo(P[0][0], B); x.closePath(); const g = x.createLinearGradient(0, T, 0, B); g.addColorStop(0, rgba(col, .2)); g.addColorStop(1, rgba(col, 0)); x.fillStyle = g; x.fill(); }
    }
    P.forEach((p, i) => { x.fillStyle = i === P.length - 1 ? col : css('--deep') || '#0B1222'; x.strokeStyle = col; x.lineWidth = 1.6; x.beginPath(); x.arc(p[0], p[1], i === P.length - 1 ? 4 : 3, 0, 6.3); x.fill(); x.stroke(); });
    x.restore(); s._P = P;
  });
  if (o.hover != null) {
    let best = null; series.forEach(s => (s._P || []).forEach(p => { const d = Math.abs(p[0] - o.hover); if (!best || d < best.d) best = { d, p, s }; }));
    if (best && best.d < 30) {
      const [hx, hy, raw] = best.p; const col = css(best.s.col) || best.s.col;
      K.cursor(x, hx, T, B);
      x.fillStyle = col; x.beginPath(); x.arc(hx, hy, 4, 0, 6.3); x.fill();
      K.tip(x, hx, w, T, [[col, (o.fmt || fmtN)(raw[1])], [css('--mute'), fmtShort(raw[0])]]);
    }
  }
}
function timeChart(c, get, o = {}) {
  let hover = null; const reveal = new Spring(0, 40, 12); reveal.t = 1;
  const draw = () => drawTimeChart(c, get(), { ...o, hover, prog: reveal.v });
  const tick = dt => { if (!c.isConnected) { tickers.delete(tick); return; } if (!c.offsetParent) return; if (!reveal.idle) { reveal.step(dt); draw(); } };
  tickers.add(tick);
  c.addEventListener('pointermove', e => { hover = e.clientX - c.getBoundingClientRect().left; draw(); });
  c.addEventListener('pointerleave', () => { hover = null; draw(); });
  new ResizeObserver(draw).observe(c);
  return { draw, replay() { reveal.set(isMin() ? 1 : 0); reveal.t = 1; draw(); } };
}

/* ============================================================ WebGL2 graphics tests */
const RES = [1920, 1080];
const GLSL_NOISE = `
float h1(vec3 p){ p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h1(i), h1(i + vec3(1,0,0)), f.x), mix(h1(i + vec3(0,1,0)), h1(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h1(i + vec3(0,0,1)), h1(i + vec3(1,0,1)), f.x), mix(h1(i + vec3(0,1,1)), h1(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float a = .5, s = 0.; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= .5; } return s; }`;
const SCENES = {
  /* fill rate and shading: a volumetric nebula, raymarched for every pixel */
  nebula: {
    vs: `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2. - 1., 0., 1.); }`,
    fs: `#version 300 es
precision highp float; uniform float uT; uniform vec2 uR; uniform int uSteps; out vec4 o;${GLSL_NOISE}
void main(){
  vec2 uv = (gl_FragCoord.xy * 2. - uR) / uR.y;
  float a = uT * .05; uv *= mat2(cos(a), -sin(a), sin(a), cos(a));
  vec3 ro = vec3(0., 0., uT * .35), rd = normalize(vec3(uv, 1.5));
  vec3 col = vec3(0.); float T = 1.;
  for (int i = 0; i < uSteps; i++) {
    vec3 p = ro + rd * (float(i) * .18 + .3);
    float d = fbm(p * 1.15 + vec3(0., 0., uT * .04));
    d = smoothstep(.48, .9, d);
    if (d > 0.) { float k = float(i) / float(uSteps);
      vec3 c = mix(vec3(1., .48, .40), vec3(.62, .84, 1.), smoothstep(.25, .75, vn(p * .55 + 4.)));
      c = mix(c, vec3(1., .85, .7), k * .3);
      col += T * d * c * .24; T *= 1. - d * .2; }
  }
  float st = h1(floor(vec3(gl_FragCoord.xy * .5, 3.)));
  col += vec3(smoothstep(.996, 1., st)) * T * .9;
  o = vec4(col + vec3(.012, .02, .05) * T, 1.);
}`,
    steps: 24,
  },
  /* geometry: thousands of instanced asteroids, displaced per vertex */
  asteroids: {
    vs: `#version 300 es
precision highp float; in vec3 aP; uniform mat4 uVP; uniform float uT; out vec3 vN; out float vD; out float vK;
vec3 hash3(float n){ return fract(sin(vec3(n, n + 1.3, n + 2.7)) * vec3(43758.5453, 22578.1459, 19642.3490)); }
mat3 rot(vec3 ax, float a){ ax = normalize(ax); float s = sin(a), c = cos(a), oc = 1. - c;
  return mat3(oc*ax.x*ax.x+c, oc*ax.x*ax.y+ax.z*s, oc*ax.z*ax.x-ax.y*s, oc*ax.x*ax.y-ax.z*s, oc*ax.y*ax.y+c, oc*ax.y*ax.z+ax.x*s, oc*ax.z*ax.x+ax.y*s, oc*ax.y*ax.z-ax.x*s, oc*ax.z*ax.z+c); }
void main(){
  float id = float(gl_InstanceID); vec3 r = hash3(id * 1.17);
  float ang = r.x * 6.2832 + uT * (.03 + r.y * .04), rad = 16. + r.z * r.z * 40. + r.y * 4.;
  vec3 c = vec3(cos(ang) * rad, (r.y - .5) * (2. + r.z * 7.), sin(ang) * rad);
  float disp = 1. + .22 * sin(aP.x * 5.3 + id) * sin(aP.y * 4.7 + id * .7) + .12 * sin(aP.z * 9.1 + id * 1.9);
  mat3 R = rot(r - .5 + .01, uT * (.3 + r.x) + id);
  vec3 p = R * (aP * disp) * (.14 + r.x * r.x * .62);
  vN = R * normalize(aP); vK = r.y;
  if (gl_InstanceID == 0) { c = vec3(0.); p = aP * 9.; vN = normalize(aP); vK = 2.; }  /* the planet the ring orbits */
  vec4 w = vec4(c + p, 1.); gl_Position = uVP * w; vD = gl_Position.w;
}`,
    fs: `#version 300 es
precision highp float; in vec3 vN; in float vD; in float vK; out vec4 o;
void main(){
  vec3 n = normalize(cross(dFdx(vN), dFdy(vN)) * 0. + vN);
  vec3 L = normalize(vec3(-.6, .5, -.4));
  float d = max(dot(n, L), 0.), rim = pow(1. - abs(n.z), 3.);
  vec3 base = mix(vec3(.34, .36, .42), vec3(.5, .45, .44), vK);
  vec3 c = base * (.1 + d * 1.05) * vec3(1., .72, .62) + rim * vec3(.62, .84, 1.) * .55;
  if (vK > 1.5) c = mix(vec3(.5, .16, .12), vec3(1., .55, .45), d) * (.25 + d * .9) + rim * vec3(.62, .84, 1.) * .9;
  c = mix(c, vec3(.02, .035, .08), smoothstep(40., 120., vD));
  o = vec4(c, 1.);
}`,
    instances: 9000,
  },
};
function icosphere(sub) {
  const t0 = (1 + Math.sqrt(5)) / 2; let V = [[-1, t0, 0], [1, t0, 0], [-1, -t0, 0], [1, -t0, 0], [0, -1, t0], [0, 1, t0], [0, -1, -t0], [0, 1, -t0], [t0, 0, -1], [t0, 0, 1], [-t0, 0, -1], [-t0, 0, 1]];
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); }; V = V.map(norm);
  for (let s = 0; s < sub; s++) {
    const cache = new Map(), NF = [];
    const mid = (a, b) => { const k = a < b ? a + '_' + b : b + '_' + a; if (cache.has(k)) return cache.get(k); V.push(norm(V[a].map((x, i) => (x + V[b][i]) / 2))); cache.set(k, V.length - 1); return V.length - 1; };
    F.forEach(([a, b, c]) => { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); NF.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); });
    F = NF;
  }
  return { pos: new Float32Array(V.flat()), idx: new Uint16Array(F.flat()) };
}
function persp(fov, asp, n, f) { const k = 1 / Math.tan(fov / 2), r = 1 / (n - f); return [k / asp, 0, 0, 0, 0, k, 0, 0, 0, 0, (n + f) * r, -1, 0, 0, 2 * n * f * r, 0]; }
function lookAt(e, c, u) {
  const sub = (a, b) => a.map((x, i) => x - b[i]), nrm = a => { const l = Math.hypot(...a); return a.map(x => x / l); };
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = nrm(sub(e, c)), x = nrm(cr(u, z)), y = cr(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
}
function mul4(a, b) { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return o; }

/* One WebGL2 context per test, rendering at a fixed internal resolution (1920×1080) into an offscreen framebuffer
   and showing it scaled in the canvas. The GPU is kept saturated without blocking the main thread: each frame
   queues a batch of scenes followed by a fence; when two batches are still pending, the frame waits. Throughput =
   scenes completed per second (fences signalled), over a measurement window after a warm-up. */
function glBench(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  if (!gl) throw new Error(t('WebGL2 is not available, so the graphics card cannot be measured here.'));
  let lost = false; const onLost = e => { e.preventDefault(); lost = true; };
  canvas.addEventListener('webglcontextlost', onLost);
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const rawR = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const renderer = String(rawR || '').replace(/^ANGLE \((?:[^,]+,\s*)?([^,(]+?)(?:\s*\(0x[0-9a-f]+\))?\s*(?:Direct3D|D3D|vs_|OpenGL|Vulkan).*$/i, '$1').trim() || String(rawR || '');
  const software = /swiftshader|llvmpipe|basic render|microsoft basic/i.test(String(rawR));
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = sc => { const p = gl.createProgram(); const a = sh(gl.VERTEX_SHADER, sc.vs), b = sh(gl.FRAGMENT_SHADER, sc.fs); gl.attachShader(p, a); gl.attachShader(p, b); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); gl.deleteShader(a); gl.deleteShader(b); return p; };
  const fbo = gl.createFramebuffer(), rbC = gl.createRenderbuffer(), rbD = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, rbC); gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, RES[0], RES[1]);
  gl.bindRenderbuffer(gl.RENDERBUFFER, rbD); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, RES[0], RES[1]);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rbC); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rbD);
  const P = {}, vao = gl.createVertexArray(); let geoBuf = null, idxBuf = null, nIdx = 0;
  function setup(name) {
    if (P[name]) return P[name];
    const p = prog(SCENES[name]); const u = n => gl.getUniformLocation(p, n);
    P[name] = { p, uT: u('uT'), uR: u('uR'), uSteps: u('uSteps'), uVP: u('uVP') };
    if (name === 'asteroids') {
      const g = icosphere(3); nIdx = g.idx.length; gl.bindVertexArray(vao);
      geoBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, geoBuf); gl.bufferData(gl.ARRAY_BUFFER, g.pos, gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(p, 'aP'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
      idxBuf = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.idx, gl.STATIC_DRAW); gl.bindVertexArray(null);
    }
    return P[name];
  }
  const VP = (tm) => { const a = tm * .06; return mul4(persp(1.0, RES[0] / RES[1], .5, 200), lookAt([Math.sin(a) * 18, 21, -64 + Math.cos(a) * 8], [0, -4, 0], [0, 1, 0])); };
  function scene(name, tm) {
    const s = P[name]; gl.useProgram(s.p); gl.uniform1f(s.uT, tm);
    if (name === 'nebula') { gl.disable(gl.DEPTH_TEST); gl.uniform2f(s.uR, RES[0], RES[1]); gl.uniform1i(s.uSteps, SCENES.nebula.steps); gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLES, 0, 3); }
    else { gl.enable(gl.DEPTH_TEST); gl.clearColor(.012, .02, .05, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(s.uVP, false, VP(tm)); gl.bindVertexArray(vao); gl.drawElementsInstanced(gl.TRIANGLES, nIdx, gl.UNSIGNED_SHORT, 0, SCENES.asteroids.instances); gl.bindVertexArray(null); }
  }
  function blit() {
    const d = Math.min(2, devicePixelRatio || 1), cw = Math.max(2, Math.round(canvas.clientWidth * d)), ch = Math.max(2, Math.round(canvas.clientHeight * d));
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const s = Math.max(cw / RES[0], ch / RES[1]), w = RES[0] * s, h = RES[1] * s, x0 = (cw - w) / 2, y0 = (ch - h) / 2;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, RES[0], RES[1], Math.round(x0), Math.round(y0), Math.round(x0 + w), Math.round(y0 + h), gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  }
  let raf = 0, stopFlag = false;
  /* run(name, { warm, secs, endless, onTick(fps, frac) }) -> Promise<fps> */
  function run(name, o) {
    setup(name); stopFlag = false;
    return new Promise((res, rej) => {
      let n = 1, pend = [], last = performance.now(), t0 = last, tm = 0, mStart = null, counted = 0, winDone = 0, winT = last, rate = 0, stall = 0;
      const warm = (o.warm ?? 1.5) * 1000, secs = (o.secs ?? 5) * 1000;
      let over = false;
      const finish = (v, err) => { if (over) return; over = true; clearInterval(dog); cancelAnimationFrame(raf); raf = 0; pend.forEach(p => gl.deleteSync(p.s)); pend = []; err ? rej(err) : res(v); };
      /* a minimized or hidden window gets no frames at all: a measured test gives up instead of waiting forever
         (the endless stress load just pauses until the window is back) */
      const dog = setInterval(() => { if (stopFlag && !over) finish(rate); else if (!o.endless && performance.now() - last > 8000) finish(null, new Error(t('Keep StellarHub visible while the graphics test runs.'))); }, 1000);
      const frame = now => {
        if (lost) return finish(null, new Error(t('The graphics driver reset the test. Try again.')));
        if (stopFlag) return finish(mStart ? counted / Math.max(.001, (now - mStart) / 1000) : rate);
        const gap = now - last; last = now;
        if (gap > 400) { stall++; mStart = mStart && now; counted = 0; if (stall > 6) return finish(null, new Error(t('Keep StellarHub visible while the graphics test runs.'))); }
        while (pend.length && gl.getSyncParameter(pend[0].s, gl.SYNC_STATUS) === gl.SIGNALED) { const p = pend.shift(); gl.deleteSync(p.s); winDone += p.n; if (mStart && p.at >= mStart) counted += p.n; }
        if (now - winT >= 500) { rate = winDone / ((now - winT) / 1000); winDone = 0; winT = now; }
        const el = now - t0;
        if (!mStart && el >= warm) { mStart = now; counted = 0; }
        if (o.onTick) o.onTick(mStart ? counted / Math.max(.05, (now - mStart) / 1000) : rate, o.endless ? 0 : clamp(el / (warm + secs), 0, 1), rate);
        if (!o.endless && mStart && now - mStart >= secs) return finish(counted / ((now - mStart) / 1000));
        /* fence status is seen a frame or two late, so up to 3 batches stay queued (the GPU never runs dry); the batch
           only grows while the queue drains, capped at ~40 ms of GPU work so the interface keeps compositing smoothly */
        if (pend.length >= 3) { raf = requestAnimationFrame(frame); return; }
        if (pend.length <= 1) n = n * 1.25 + .5;
        if (rate > 0) n = Math.min(n, Math.max(1, rate * .04));
        n = Math.min(n, 400);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, RES[0], RES[1]);
        const k = Math.max(1, Math.round(n));
        for (let i = 0; i < k; i++) { tm += 1 / 60; scene(name, tm); }
        blit();
        pend.push({ s: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), n: k, at: now }); gl.flush();
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    });
  }
  /* one still frame (preview before running) */
  function still(name, tm = 3) { setup(name); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, RES[0], RES[1]); scene(name, tm); blit(); }
  function destroy() {
    stopFlag = true; cancelAnimationFrame(raf); canvas.removeEventListener('webglcontextlost', onLost);
    try { Object.values(P).forEach(s => gl.deleteProgram(s.p)); [geoBuf, idxBuf].forEach(b => b && gl.deleteBuffer(b)); gl.deleteVertexArray(vao);
      gl.deleteFramebuffer(fbo); gl.deleteRenderbuffer(rbC); gl.deleteRenderbuffer(rbD); const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch {}
  }
  return { run, still, stop() { stopFlag = true; }, destroy, renderer, software };
}

/* ============================================================ running tests */
let RUN = null;     /* the test in progress: { kind, cancel(), label } (one at a time) */
const busyFns = new Set();
function setRun(r) {
  /* every test the user starts is followed from anywhere (SH.activity); it is ended where its result is told */
  if (r && !RUN) { if (benchAct) benchAct.end({ cancelled: true }); benchAct = SH.activity.start('benchmark', { key: 'run', label: r.label, go: { tab: r.kind === 'full' ? 'overview' : r.kind }, cancel: r.cancel }); }
  RUN = r; busyFns.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); actChip();
}
let benchAct = null;
const benchProg = (p, text) => { if (benchAct) benchAct.progress(p, text); };
/* the test's activity ends; true when the user was elsewhere and has been told (the module's own toast is then not needed) */
const benchEnd = res => { const a = benchAct; benchAct = null; return a ? a.end(res) : false; };
const KN = { sha256: 'SHA-256', blake2b: 'BLAKE2b', zlib_c: t('Compression (zlib)'), zlib_d: t('Decompression (zlib)') };
const DT = [['seq_q8', 'SEQ1M Q8T1', t('Sequential, 8 requests in flight')], ['seq_q1', 'SEQ1M Q1T1', t('Sequential, one at a time')],
  ['rnd_q32', 'RND4K Q32T1', t('Random 4 KB, 32 in flight')], ['rnd_q1', 'RND4K Q1T1', t('Random 4 KB, one at a time')]];

/* simulated engine jobs for sample mode: same progress messages, plausible numbers */
function simJob(kind, args, onProgress) {
  let stop = false; const p = (async () => {
    const base = sampleRuns().find(r => r[kind])[kind]; const tick = async (ms) => { await wait(ms); if (stop) throw Object.assign(new Error('cancelled'), { cancelled: true }); };
    const jit = x => x * (1 + (Math.random() - .5) * .06);
    if (kind === 'cpu') {
      const K = Object.keys(KN); for (let s = 0; s < 8; s++) { const k = K[s % 4], ph = s < 4 ? 'single' : 'multi', v = base[ph][k];
        for (let i = 0; i < 6; i++) { onProgress({ pct: (s + i / 6) / 8, data: { phase: ph, kernel: k, rate: jit(v), step: s, steps: 8, perThread: ph === 'multi' ? [...Array(24)].map((_, j) => jit(v / 24 * (j < 16 ? 1.12 : .78))) : null } }); await tick(130); } }
    } else if (kind === 'memory') {
      for (const [s, k] of ['copy', 'read', 'write', 'latency'].entries()) { for (let i = 0; i < 5; i++) { onProgress({ pct: (s + i / 5) / 4, data: { phase: k, step: s, steps: 4, value: i === 4 ? base[k] : null } }); await tick(220); } }
    } else if (kind === 'disk') {
      for (let i = 0; i < 8; i++) { onProgress({ pct: i / 8 / 9, data: { phase: 'prepare', step: 0, steps: 9, rate: jit(2400) } }); await tick(90); }
      let st = 1; for (const [k] of DT) for (const kd of ['read', 'write']) { for (let i = 0; i < 7; i++) { onProgress({ pct: (st + i / 7) / 9, data: { phase: k, kind: kd, rate: jit(base.tests[k][kd]), step: st, steps: 9 } }); await tick(120); }
        onProgress({ pct: (st + 1) / 9, data: { phase: k, kind: kd, rate: base.tests[k][kd], value: base.tests[k][kd], step: st, steps: 9 } }); st++; }
    } else if (kind === 'network') {
      for (let i = 0; i < 12; i++) { onProgress({ pct: i / 36, data: { phase: 'latency', step: 0, steps: 3, value: jit(base.latency) } }); await tick(70); }
      for (const [s, d] of [[1, 'down'], [2, 'up']]) for (let i = 0; i < 18; i++) { onProgress({ pct: (s + i / 18) / 3, data: { phase: d, rate: jit(base[d]) * Math.min(1, (i + 2) / 6), step: s, steps: 3 } }); await tick(140); }
    }
    const out = JSON.parse(JSON.stringify(base)); if (out.score) out.score = Math.round(jit(out.score));
    return kind === 'disk' ? { ...out, drive: args[0] || 'C:', sizeMb: args[1] || 256 } : out;
  })();
  p.cancel = () => { stop = true; }; return p;
}
function engineJob(kind, args, onProgress) {
  if (!REAL) return simJob(kind, args, onProgress);
  /* a single test the user started ticks at 25/50/75 %; the steps of a full run stay quiet (it has four of them) */
  return SH.job('benchmark', kind, args, { sound: RUN && RUN.kind !== 'full' ? 'task' : undefined, onProgress: m => { if (m.kind === 'progress') onProgress(m); } });
}

/* ============================================================ plain-language reading */
function ramInfo() {
  const c = comp('ram'); let mods = c.modules, slots = c.slots;
  if (nil(mods)) { const m = /(\d+)\D+(\d+)/.exec(row('ram', /^modules$/i) || ''); if (m) { mods = +m[1]; slots = +m[2]; } }
  if (nil(mods) && !REAL) { mods = 1; slots = 2; }
  return { mods, slots };
}
function reading(run, prev) {
  const out = []; const s = run.scores || {}, o = run.score;
  out.push({ ic: 'orbit', tone: 'acc', txt: o >= 1700 ? t('A top-tier PC: it handles anything you throw at it.') : o >= 1200 ? t('A high-end PC, great for gaming and creative work.')
    : o >= 800 ? t('A solid PC for everyday use and most games.') : o >= 450 ? t('A modest PC: fine for browsing, office work and light games.') : t('An entry-level PC: heavy apps and games will feel slow.') });
  if (!nil(s.gpu)) out.push({ ic: 'gpu', tone: s.gpu >= 900 ? 'ok' : s.gpu >= 500 ? '' : 'warn', txt: s.gpu >= 1400 ? t('Great for gaming at high settings, even at 1440p.') : s.gpu >= 900 ? t('Good for gaming at 1080p with high settings.')
    : s.gpu >= 500 ? t('Handles esports and lighter games at 1080p.') : t('Gaming is limited: expect low settings or older games.') });
  const ks = Object.keys(W).filter(k => !nil(s[k]));
  if (ks.length >= 3) {
    const low = ks.reduce((a, b) => s[a] <= s[b] ? a : b);
    if (s[low] < o * .72) {
      const r = ramInfo();
      const txt = low === 'memory' ? (r.mods === 1 && r.slots > 1 ? t('Memory is the bottleneck: a single module works in single channel. A second, identical module would roughly double its speed.') : t('Memory is the bottleneck: it is slower than the rest of the PC.'))
        : low === 'disk' ? t('The disk is the bottleneck: apps and games load slower than the rest of the PC allows.')
        : low === 'cpu' ? t('The processor is the bottleneck: heavy apps and games are limited by it.') : t('The graphics card is the bottleneck for games and 3D work.');
      out.push({ ic: 'alert', tone: 'warn', txt });
    } else out.push({ ic: 'check', tone: 'ok', txt: t('Well balanced: no component holds the others back.') });
  }
  if (prev && prev.score) {
    const d = delta(o, prev.score), when = fmtShort(prev.at);
    out.push({ ic: 'trend', tone: '', txt: Math.abs(d) < 3 ? t('Same result as the previous run ({date}), within normal variation.', { date: when })
      : d > 0 ? t('{n}% faster than the previous run ({date}).', { n: fmtInt(d), date: when }) : t('{n}% slower than the previous run ({date}). Heat, background apps or the power mode can explain it.', { n: fmtInt(-d), date: when }) });
  }
  return out;
}

/* ============================================================ the score ring */
const RING_R = 92, RING_L = 2 * Math.PI * RING_R * .8;  /* an 80 % arc, open at the bottom */
function ringHTML() {
  return `<div class="bm-ring" id="bmRing"><svg viewBox="0 0 220 220" aria-hidden="true">
    <defs><linearGradient id="bmRg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent2)"/></linearGradient></defs>
    <circle class="orb" cx="110" cy="110" r="104"/>
    <circle class="trk" cx="110" cy="110" r="${RING_R}" stroke-dasharray="${RING_L} 999" transform="rotate(126 110 110)"/>
    <circle class="val" id="bmArc" cx="110" cy="110" r="${RING_R}" stroke-dasharray="${RING_L} 999" stroke-dashoffset="${RING_L}" transform="rotate(126 110 110)"/>
    <g class="sat" id="bmSat"><circle cx="110" cy="6" r="3.4"/></g>
  </svg><div class="bm-rc"><span class="bm-rl">${t('StellarHub Score')}</span><b id="bmScore">${DASH}</b><span class="bm-rt" id="bmTier"></span></div></div>`;
}
const ring = { v: new Spring(0, 60, 14), sat: 0, el: null };
function ringSet(frac, snap) { ring.v.t = clamp(frac, 0, 1); ring.dirty = true; if (snap) ring.v.set(ring.v.t); }
tickers.add((dt) => {
  if (state.view !== 'benchmark' || !ring.el || !ring.el.isConnected) return;
  if (!ring.v.idle || ring.dirty) { ring.v.step(dt); ring.dirty = false; const arc = $('#bmArc', ring.el); if (arc) arc.style.strokeDashoffset = RING_L * (1 - ring.v.v); }
  /* the satellite turns by a CSS-transform animation (compositor); only its speed changes, without a jump (updatePlaybackRate) */
  const sat = $('#bmSat', ring.el);
  if (sat) {
    if (!sat._a) { sat._a = sat.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 5140, iterations: Infinity }); sat._a.pause(); sat._r = -1; }
    const rate = isMin() ? 0 : RUN ? 1 : .13;
    if (sat._r !== rate) { sat._r = rate; if (rate) { sat._a.updatePlaybackRate(rate); sat._a.play(); } else sat._a.pause(); }
  }
});

/* ============================================================ Overview */
const OV = { el: null, ctx: null };
function renderOverview(el, ctx) {
  OV.el = el; OV.ctx = ctx; el.classList.add('fill');
  el.innerHTML = `<div class="bm-ov">
    <div class="pan bm-hero" data-asm>${ringHTML()}
      <div class="bm-hm" id="bmHm">${skLine('70%', 9)}</div>
      <div class="bm-cta"><button class="btn pri lg" id="bmFull">${ic('play')}${t('Run full benchmark')}</button><span class="faint" id="bmFullHint">${t('About a minute. Close heavy apps first.')}</span></div>
    </div>
    <div class="bm-mid" id="bmMid">
      <div class="pan bm-subs" data-asm><h4>${t('Components')}<em id="bmSubsW"></em></h4><div class="rows" id="bmSubs">${COMPS.map(c => `<div class="row bm-sr" data-c="${c.id}"><span class="ri">${ic(c.ic)}</span><span class="rt"><b>${c.n}</b>${skLine(40 + c.id.length * 6 + '%', 9)}</span><span class="bm-sb"><i></i></span><span class="bm-sv"><span class="sk" style="display:inline-block;width:46px;height:16px"></span></span><button class="btn sm ghost" data-test="${c.id}">${t('Test')}</button></div>`).join('')}</div></div>
      <div class="pan bm-read" data-asm><h4>${t('What it means')}</h4><div id="bmRead">${[80, 64, 72].map(w => `<div class="bm-rl2">${skLine(w + '%', 10)}</div>`).join('')}</div></div>
    </div>
    <div class="pan bm-pc" data-asm><h4>${t('This PC')}</h4><div class="bm-pcl">${pcListHTML()}</div>
      <div class="bm-more"><button class="btn sm ghost" data-tab="network">${ic('globe')}${t('Internet speed')}</button><button class="btn sm ghost" data-tab="stress">${ic('flame')}${t('Stress test')}</button></div></div>
  </div>`;
  ring.el = $('#bmRing', el);
  $('#bmFull', el).addEventListener('click', () => RUN && RUN.kind === 'full' ? RUN.cancel() : runFull());
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-test]'); if (b) { if (RUN) { SH.toast(t('Another test is running. Wait for it to finish or cancel it.'), { kind: 'unavailable' }); return; } ctx.setTab(b.dataset.test); setTimeout(() => runComp(b.dataset.test), 380); return; }
    const tb = e.target.closest('button[data-tab]'); if (tb) ctx.setTab(tb.dataset.tab);
  });
  busyFns.add(() => ovBusy());
  onHistory(() => { if (!(RUN && RUN.kind === 'full')) ovPaint(); });
  loadHistory().then(() => ovPaint(true));
}
function pcListHTML() {
  const L = [['cpu', 'cpu'], ['gpu', 'gpu'], ['ram', 'ram'], ['ssd', 'ssd'], ['display', 'display'], ['sys', 'sys']];
  return L.filter(([id]) => comp(id).title).map(([id, i]) => `<div class="bm-pci"><span class="ri">${ic(i)}</span><span class="rt"><span>${esc(comp(id).name || '')}</span><b title="${esc(comp(id).title)}">${esc(comp(id).title)}</b></span></div>`).join('');
}
function ovBusy() {
  const el = OV.el; if (!el) return; const b = $('#bmFull', el); const full = RUN && RUN.kind === 'full';
  b.innerHTML = full ? `${ic('stop')}${t('Cancel')}` : `${ic('play')}${t('Run full benchmark')}`; b.className = full ? 'btn sec lg' : 'btn pri lg';
  b.disabled = !!RUN && !full; $$('[data-test]', el).forEach(x => { x.disabled = !!RUN; });
}
function ovPaint(first) {
  const el = OV.el; if (!el || !H.runs) return;
  const run = lastFull(); const prev = run && lastFull(run);
  const sc = $('#bmScore', el), hm = $('#bmHm', el);
  if (run) {
    SH.countUp(sc, run.score || 0, first ? 1100 : 700); ringSet((run.score || 0) / SCALE, false);
    $('#bmTier', el).textContent = tier(run.score);
    hm.innerHTML = `<span class="muted">${esc(fmtDate(run.at))}</span>${deltaChip(delta(run.score, prev && prev.score))}`;
  } else {
    sc.textContent = DASH; sc.dataset.v = 0; ringSet(0); $('#bmTier', el).textContent = t('Not measured yet');
    hm.innerHTML = `<span class="muted">${t('Get a score for your PC in about a minute.')}</span>`;
  }
  $('#bmSubsW', el).textContent = run ? t('points, 1,000 = a mid-range PC') : '';
  COMPS.forEach((c, i) => {
    const r = $(`.bm-sr[data-c="${c.id}"]`, el); const res = latest(c.id); const v = res && res[c.id].score;
    const sub = (res && c.id === 'gpu' && res.gpu.renderer) || comp(c.pc).title;
    $('.rt', r).innerHTML = `<b>${c.n}</b><span>${esc(sub || t('Not measured yet'))}</span>`;
    const bar = $('.bm-sb i', r); const fr = nil(v) ? 0 : clamp(v / SCALE, 0, 1);
    bar.className = nil(v) ? '' : v < (run ? run.score * .72 : 0) ? 'warn' : '';
    anim(bar, [{ transform: `scaleX(${bar.dataset.f || 0})` }, { transform: `scaleX(${fr})` }], { d: 900, delay: first ? 120 + i * 70 : 0, e: EASE.out }); bar.dataset.f = fr;
    $('.bm-sv', r).innerHTML = nil(v) ? `<span class="faint">${DASH}</span>` : `<b>${fmtInt(v)}</b><em>${esc(tier(v))}</em>`;
  });
  const rd = $('#bmRead', el);
  rd.innerHTML = run ? reading(run, prev).map(x => `<div class="bm-rl2 ${x.tone}">${ic(x.ic)}<span>${esc(x.txt)}</span></div>`).join('')
    : `<div class="bm-rl2">${ic('info')}<span>${t('The full benchmark measures the processor, memory, disk and graphics card one after another, then gives your PC a score and explains it in plain words.')}</span></div><div class="bm-rl2">${ic('shield')}<span>${t('Nothing changes on your PC. The disk test writes a temporary file and deletes it.')}</span></div>`;
  if (!first) $$('.bm-rl2', rd).forEach((x, i) => anim(x, [{ opacity: 0, transform: 'translate3d(0,6px,0)' }, { opacity: 1, transform: 'none' }], { d: 420, delay: i * 60, e: EASE.spring }));
}

/* ---------- full run ---------- */
const FULL_STEPS = [
  { k: 'cpu', n: t('Processor'), ic: 'cpu' }, { k: 'memory', n: t('Memory'), ic: 'ram' },
  { k: 'disk', n: t('Disk'), ic: 'ssd' }, { k: 'gpu', n: t('Graphics'), ic: 'gpu' },
];
function liveStageHTML(steps) {
  return `<div class="pan bm-live" data-asm>
    <div class="bm-lh"><div><span class="bm-k" id="lvK">${t('Starting…')}</span><b id="lvT">${t('Getting ready')}</b></div><span class="chip" id="lvTime">0:00</span></div>
    <div class="bm-stage" id="lvStage"><div class="bm-lv"><b id="lvV">${DASH}</b><span id="lvU"></span></div><canvas class="bm-spark" id="lvSp"></canvas></div>
    <div class="bm-steps">${steps.map((s, i) => `<div class="bm-st" data-i="${i}"><span class="bm-sd">${ic(s.ic)}</span><span class="bm-sn">${s.n}</span><span class="bm-sx"></span><i class="bm-sp"><u></u></i></div>`).join('')}</div>
  </div>`;
}
async function runFull() {
  if (RUN) return;
  const el = OV.el; const mid = $('#bmMid', el); const saved = mid.innerHTML;
  let cur = null, cancelled = false;
  setRun({ kind: 'full', label: t('Full benchmark'), cancel: () => { cancelled = true; if (cur && cur.cancel) cur.cancel(); } });
  mid.innerHTML = liveStageHTML(FULL_STEPS); SH.assemble(mid, 0, 50);
  const sp = new Live($('#lvSp', mid)); const t0 = performance.now();
  const timer = setInterval(() => { const x = $('#lvTime', mid); if (x) x.textContent = fmtDur((performance.now() - t0) / 1000); }, 500);
  $('#bmTier', el).textContent = t('Measuring…'); $('#bmHm', el).innerHTML = `<span class="muted">${t('Keep the PC idle until it finishes.')}</span>`;
  const sc = $('#bmScore', el); sc.textContent = '0%'; sc.dataset.v = 0; ringSet(0, false);
  const W8 = [.28, .08, .34, .30]; let rec = null;
  const stepEl = i => $(`.bm-st[data-i="${i}"]`, mid);
  const setStep = (i, frac) => { const before = W8.slice(0, i).reduce((a, b) => a + b, 0); const p = before + W8[i] * clamp(frac, 0, 1); ringSet(p); SH.rollNumber(sc, fmtInt(p * 100) + '%', { percent: p * 100 }); benchProg(p, FULL_STEPS[i].n);
    const u = $('.bm-sp u', stepEl(i)); if (u) u.style.transform = `scaleX(${clamp(frac, 0, 1)})`; };
  const live = (k, title, v, unit) => { $('#lvK', mid).textContent = k; if ($('#lvT', mid).textContent !== title) { $('#lvT', mid).textContent = title; sp.reset(); } if (!nil(v)) { $('#lvV', mid).textContent = fmtV(v); $('#lvU', mid).textContent = unit; sp.push(v); } };
  const res = {};
  try {
    for (let i = 0; i < FULL_STEPS.length; i++) {
      if (cancelled) throw Object.assign(new Error('cancelled'), { cancelled: true });
      const s = FULL_STEPS[i]; const st = stepEl(i); st.classList.add('on'); rec = teleRec(); sp.reset(); $('#lvV', mid).textContent = DASH; $('#lvU', mid).textContent = '';
      if (s.k === 'gpu') {
        res.gpu = await gpuTest($('#lvStage', mid), (scene, fps, frac) => { setStep(i, frac); live(s.n, scene === 'nebula' ? t('Nebula: shaders and fill rate') : t('Asteroid field: geometry'), fps, U('fps')); }, c => { cur = c; }, true);
      } else {
        const args = s.k === 'cpu' ? [.6] : s.k === 'memory' ? [.7] : [null, 256, .45];
        cur = engineJob(s.k, args, m => { const d = m.data || {}; setStep(i, m.pct || 0);
          if (s.k === 'cpu') live(s.n, (d.phase === 'single' ? t('One thread: {test}', { test: KN[d.kernel] || '' }) : t('All {n} threads: {test}', { n: (d.perThread || []).length || '', test: KN[d.kernel] || '' })), d.rate, U('MB/s'));
          else if (s.k === 'memory') live(s.n, MEMN[d.phase] || t('Preparing'), d.value, d.phase === 'latency' ? U('ns') : U('GB/s'));
          else live(s.n, d.phase === 'prepare' ? t('Writing the test file') : `${(DT.find(x => x[0] === d.phase) || [, ''])[1]} ${d.kind === 'write' ? t('write') : t('read')}`, d.rate, U('MB/s')); });
        res[s.k] = await cur;
      }
      if (cancelled || !res[s.k]) throw Object.assign(new Error('cancelled'), { cancelled: true });
      if (s.k === 'cpu' || s.k === 'gpu') res[s.k].tele = rec[s.k](); rec.stop(); rec = null; setStep(i, 1); st.classList.remove('on'); st.classList.add('done');
      $('.bm-sx', st).innerHTML = `<b>${fmtN(res[s.k].score)}</b>`; anim(st, [{ transform: 'scale(.96)' }, { transform: 'scale(1)' }], { d: 420, e: EASE.spring });
    }
    const scores = { cpu: res.cpu.score, gpu: res.gpu.score, memory: res.memory.score, disk: res.disk.score };
    const score = await overallScore(scores);
    await loadHistory();
    const best = Math.max(-Infinity, ...(H.runs || []).filter(r => r.kind === 'full' && !nil(r.score)).map(r => r.score));
    const run = await saveRun({ kind: 'full', score, scores, ...res });
    SH.logActivity(t('Benchmark finished: {n} points', { n: fmtInt(score) }), { sub: tier(score), ic: 'benchmark', go: 'benchmark', tab: 'overview' });
    setRun(null); mid.innerHTML = saved; ovPaint(true); SH.assemble(mid, 0, 50);
    anim($('#bmRing', el), [{ transform: 'scale(.94)' }, { transform: 'scale(1.03)', offset: .5 }, { transform: 'scale(1)' }], { d: 700, e: EASE.spring });
    /* beating the best full run so far (not the first one) is an achievement; the sound rides on the toast */
    const kind = isFinite(best) && !nil(run.score) && run.score > best ? 'achievement' : 'success';
    if (!benchEnd({ ok: true, summary: t('{n} points', { n: fmtInt(run.score) }), kind })) SH.toast(t('Your PC scored {n} points.', { n: fmtInt(run.score) }), { kind });
  } catch (e) {
    setRun(null); mid.innerHTML = saved; ovPaint(true);
    if (benchEnd(e && e.cancelled ? { cancelled: true } : { ok: false, error: (e && e.message) || '' })) { /* told */ }
    else if (e && e.cancelled) SH.toast(t('Benchmark cancelled. Nothing was saved.')); else { console.error(e); SH.toast(t('The benchmark stopped: {msg}', { msg: (e && e.message) || '' }), { ms: 7000, kind: 'error' }); }
  } finally { clearInterval(timer); if (rec) rec.stop(); setRun(null); benchEnd({ cancelled: true }); }
}
const MEMN = { copy: SH.tc('benchmark', 'Copy'), read: t('Read'), write: t('Write'), latency: t('Latency'), prepare: t('Preparing') };

/* the two graphics scenes, rendered in `host` (a canvas is created there and removed afterwards) */
async function gpuTest(host, onTick, setCur, quick) {
  const cv = document.createElement('canvas'); cv.className = 'bm-gl'; host.appendChild(cv); host.classList.add('gl');
  anim(cv, [{ opacity: 0 }, { opacity: 1 }], { d: 400 });
  let b = null, stopped = false; setCur({ cancel: () => { stopped = true; if (b) b.stop(); } });
  try {
    b = glBench(cv);
    if (b.software && REAL) throw new Error(t('The graphics card is not being used (software rendering). Update the graphics driver and try again.'));
    const o = {}; const secs = quick ? 4 : 6;
    for (const [i, name] of ['nebula', 'asteroids'].entries()) {
      /* the first warm-up is longer: an idle graphics card needs a few seconds to reach its boost clock */
      o[name] = await b.run(name, { warm: i ? 1.5 : 3, secs, onTick: (fps, frac) => onTick(name, fps, (i + frac) / 2) });
      if (stopped) return null;
    }
    const fill = +o.nebula.toFixed(1), geoF = +o.asteroids.toFixed(1);
    return { fill, geo: geoF, score: await scoreGpu(fill, geoF), renderer: b.renderer, res: `${RES[0]} × ${RES[1]}` };
  } finally { if (b) b.destroy(); cv.remove(); host.classList.remove('gl'); }
}

/* ============================================================ component tabs (shared frame) */
const CT = {};   /* per tab: { el, ctx, cfg } */
function ctHTML(c) {
  return `<div class="bm-ct${c.wide ? ' wide' : ''}">
    <div class="pan bm-main" data-asm>
      <div class="bm-head"><span class="bm-hi">${ic(c.icon)}</span><div class="bm-ht"><b>${c.title}</b><span data-hw>${esc(c.hw ? c.hw() : '')}</span></div>
        <div class="bm-opts">${c.opts || ''}</div><button class="btn pri" data-run>${ic('play')}${c.runLabel || t('Run test')}</button></div>
      <div class="bm-body" data-body>${c.skeleton ? c.skeleton() : bodySkeleton()}</div>
    </div>
    <div class="bm-side">${c.side || ''}
      <div class="pan bm-hist" data-asm><h4>${t('Your results')}<em data-hn></em></h4><canvas class="bm-hc" data-hc></canvas><div class="bm-hl" data-hl>${[1, 2, 3].map(() => `<div class="bm-hr">${skLine('55%', 9)}${skLine('34px', 12)}</div>`).join('')}</div></div>
    </div></div>`;
}
const bodySkeleton = () => `<div class="bm-tiles">${[0, 1, 2, 3].map(() => `<div class="bm-tile">${skLine('50%', 9)}<span class="sk" style="display:block;height:26px;width:70%;margin-top:12px"></span></div>`).join('')}</div><div class="bm-skb sk"></div>`;
function renderComp(id, el, ctx, cfg) {
  el.classList.add('fill'); CT[id] = { el, ctx, cfg }; el.innerHTML = ctHTML(cfg);
  $('[data-run]', el).addEventListener('click', () => RUN && RUN.kind === id ? RUN.cancel() : runComp(id));
  if (cfg.init) cfg.init(el);
  const metric = cfg.metric || (r => r.score), mfmt = cfg.metricFmt || (v => t('{n} points', { n: fmtInt(v) }));
  const chart = timeChart($('[data-hc]', el), () => [{ col: '--accent2', fill: true, pts: runsOf(id).map(r => [r.at, metric(r[id])]).filter(p => !nil(p[1])) }], { pad: 8, fmt: mfmt });
  CT[id].chart = chart;
  const paint = () => { if (RUN && RUN.kind === id) return; histSide(id); const r = latest(id); const body = $('[data-body]', el);
    body.innerHTML = r ? cfg.result(r[id], r) : cfg.idle(); if (cfg.after) cfg.after(el, r && r[id]); };
  CT[id].paint = paint;
  busyFns.add(() => ctBusy(id));
  onHistory(paint);
  loadHistory().then(() => { paint(); chart.replay(); ctBusy(id); });
}
function ctBusy(id) {
  const c = CT[id]; if (!c) return; const b = $('[data-run]', c.el); const mine = RUN && RUN.kind === id;
  b.innerHTML = mine ? `${ic('stop')}${t('Cancel')}` : `${ic('play')}${c.cfg.runLabel || t('Run test')}`; b.className = mine ? 'btn sec' : 'btn pri'; b.disabled = !!RUN && !mine;
  $$('.bm-opts button, .bm-opts select', c.el).forEach(x => { x.disabled = !!RUN; });
}
function histSide(id) {
  const c = CT[id]; const L = runsOf(id); const box = $('[data-hl]', c.el);
  $('[data-hn]', c.el).textContent = L.length ? (L.length === 1 ? t('{n} run', { n: 1 }) : t('{n} runs', { n: L.length })) : '';
  const metric = c.cfg.metric || (r => r.score);
  box.innerHTML = L.length ? L.slice(0, 12).map((r, i) => { const p = L[i + 1]; const v = metric(r[id]);
    return `<div class="bm-hr${i === 0 ? ' last' : ''}"><span><b>${esc(fmtDate(r.at))}</b><em>${r.kind === 'full' ? t('in a full benchmark') : esc(c.cfg.histSub ? c.cfg.histSub(r[id]) : '')}</em></span><span class="bm-hv">${deltaChip(delta(v, p && metric(p[id])), true)}<b>${c.cfg.metric ? fmtV(v) : fmtN(v)}</b>${c.cfg.metricUnit ? `<small>${c.cfg.metricUnit}</small>` : ''}</span></div>`; }).join('')
    : SH.emptyState({ art: 'first', small: true, text: t('Your results will show up here, so you can compare them over time.') });
  c.chart.draw();
}
async function runComp(id) {
  if (RUN) { if (RUN.kind !== id) SH.toast(t('Another test is running. Wait for it to finish or cancel it.'), { kind: 'unavailable' }); return; }
  const c = CT[id]; if (!c) return; const cfg = c.cfg; const body = $('[data-body]', c.el);
  let cur = null, cancelled = false;
  setRun({ kind: id, label: cName(id) || cfg.title, cancel: () => { cancelled = true; if (cur && cur.cancel) cur.cancel(); } });
  body.innerHTML = cfg.live(); const L = cfg.liveInit ? cfg.liveInit(body) : {};
  SH.assemble(body, 0, 40);
  try {
    const res = await cfg.exec(body, L, x => { cur = x; });
    if (cancelled || !res) throw Object.assign(new Error('cancelled'), { cancelled: true });
    await loadHistory();
    const best = Math.max(-Infinity, ...runsOf(id).map(r => r[id] && r[id].score).filter(v => !nil(v)));
    const run = await saveRun({ kind: id, score: res.score ?? null, [id]: res });
    setRun(null); c.paint(); c.chart.replay();
    const b = $('[data-body]', c.el); $$('.bm-tile, .bm-big', b).forEach((x, i) => anim(x, [{ opacity: 0, transform: 'translate3d(0,10px,0) scale(.97)' }, { opacity: 1, transform: 'none' }], { d: 480, delay: i * 50, e: EASE.spring }));
    const kind = !nil(run.score) && isFinite(best) && run.score > best ? 'achievement' : 'success';
    const msg = !nil(run.score) ? t('{name}: {n} points.', { name: cName(id), n: fmtInt(run.score) }) : t('Test finished.');
    if (!benchEnd({ ok: true, summary: msg, kind })) SH.toast(msg, { kind });
    SH.logActivity(t('{name} benchmark finished', { name: cName(id) }), { sub: nil(run.score) ? '' : t('{n} points', { n: fmtInt(run.score) }), ic: 'benchmark', go: 'benchmark', tab: id });
  } catch (e) {
    setRun(null); c.paint();
    if (benchEnd(e && e.cancelled ? { cancelled: true } : { ok: false, error: (e && e.message) || '' })) { /* told */ }
    else if (e && e.cancelled) SH.toast(t('Test cancelled.')); else { console.error(e); SH.toast(t('The test stopped: {msg}', { msg: (e && e.message) || '' }), { ms: 7000, kind: 'error' }); }
  } finally { setRun(null); benchEnd({ cancelled: true }); }
}
const tile = (lbl, v, unit, o = {}) => `<div class="bm-tile${o.cls ? ' ' + o.cls : ''}"${o.title ? ` title="${esc(o.title)}"` : ''}><span>${lbl}</span><b>${v}${unit ? `<small>${unit}</small>` : ''}</b>${o.sub ? `<em>${o.sub}</em>` : ''}</div>`;
const bigScore = (v, sub) => `<div class="bm-big"><span>${t('Score')}</span><b>${fmtN(v)}</b><em>${esc(tier(v))}</em>${sub || ''}</div>`;
const lastLine = r => `<div class="bm-last faint">${ic('clock')}${t('Last run: {date}', { date: esc(fmtDate(r.at)) })}${r.kind === 'full' ? ` <span>${t('(part of a full benchmark)')}</span>` : ''}</div>`;
const idleHTML = (icn, title, txt, dur) => `<div class="bm-idle"><div class="bm-ii">${ic(icn)}</div><b>${title}</b><p>${txt}</p><span class="chip">${ic('clock')}${dur}</span></div>`;
const liveHead = () => `<div class="bm-lvh"><div class="bm-lv"><b data-lv>${DASH}</b><span data-lu></span></div><div class="bm-lvk"><span data-lk>${t('Starting…')}</span><div class="bar"><span data-lp style="--v:0"></span></div></div></div>`;
function liveSet(body, o) {
  if (o.p != null) benchProg(clamp(o.p, 0, 1), o.k != null ? String(o.k) : null);
  if (o.k != null) $('[data-lk]', body).textContent = o.k;
  if (!nil(o.v)) { $('[data-lv]', body).textContent = fmtV(o.v); $('[data-lu]', body).textContent = o.u || ''; }
  if (o.p != null) $('[data-lp]', body).style.setProperty('--v', clamp(o.p, 0, 1));
}

/* ---------- processor ---------- */
const coreLabels = pc => { let P = 0, E = 0; const top = Math.max(...pc.map(c => c.eff)); const hybrid = pc.some(c => c.eff !== top);
  return pc.map(c => hybrid ? (c.eff === top ? 'P' + (++P) : 'E' + (++E)) : String(++P)); };
function coresHTML(pc, cls = '') {
  if (!pc || !pc.length) return '';
  const lb = coreLabels(pc), mx = Math.max(...pc.map(c => c.rel)) || 1; const hybrid = lb[0] && /^[PE]/.test(lb[0]);
  return `<div class="bm-cores ${cls}">${pc.map((c, i) => `<div class="bm-core${hybrid && lb[i][0] === 'E' ? ' e' : ''}" title="${esc(t('{core}: {x}× a single thread', { core: lb[i], x: fmt1(c.rel) }))}"><i style="--h:${(c.rel / mx).toFixed(3)}"></i><span>${lb[i]}</span></div>`).join('')}</div>`;
}
const CPU = {
  icon: 'cpu', title: t('Processor'), hw: () => comp('cpu').title, side: telePanel('cpu'),
  histSub: r => t('{a} single, {b} multi', { a: fmtN(r.scoreSingle), b: fmtN(r.scoreMulti) }),
  idle: () => idleHTML('cpu', t('Single-thread and multi-thread speed'), t('Hashing (SHA-256, BLAKE2b) and compression (zlib) run first on one thread, then on every thread at once, each pinned to its own core. You also see how much each core delivers.'), t('About 15 seconds')),
  result: (r, run) => `<div class="bm-r2">${bigScore(r.score)}<div class="bm-tiles">
      ${tile(t('Single-thread'), fmtN(r.scoreSingle), '', { sub: t('points') })}${tile(t('Multi-thread'), fmtN(r.scoreMulti), '', { sub: t('points') })}
      ${tile(t('Scaling'), nil(r.scaling) ? DASH : fmt1(r.scaling) + '×', '', { sub: t('{n} threads vs one', { n: r.threads }) })}</div></div>
    <div class="bm-r3"><div class="bm-kt"><div class="bm-kh"><span>${t('Test')}</span><span>${t('One thread')}</span><span>${t('All threads')}</span></div>
      ${Object.keys(KN).map(k => `<div class="bm-kr"><span>${KN[k]}</span><b>${fmtV(r.single[k])}<small>${U('MB/s')}</small></b><b>${fmtV(r.multi[k])}<small>${U('MB/s')}</small></b></div>`).join('')}</div>
      <div class="bm-cw"><div class="bm-kh"><span>${t('What each core delivered')}</span></div>${coresHTML(r.perCore)}</div></div>${lastLine(run)}`,
  live: () => `${liveHead()}<div class="bm-lsteps">${[t('One thread'), t('All threads')].map((n, i) => `<div class="bm-ls" data-ph="${i ? 'multi' : 'single'}"><b>${n}</b><div>${Object.keys(KN).map(k => `<span data-k="${k}">${KN[k]}<em>${DASH}</em></span>`).join('')}</div></div>`).join('')}</div>
    <div class="bm-lcores" data-cores><span class="faint">${t('Each thread shows up here once all of them run at once.')}</span></div>`,
  async exec(body, L, setCur) {
    const rec = teleRec(); const off = SH.tele.on(v => teleShow(CT.cpu.el, 'cpu', v, true));
    let lastK = null;
    try {
      const j = engineJob('cpu', [1], m => { const d = m.data || {};
        liveSet(body, { k: d.phase === 'single' ? t('One thread: {test}', { test: KN[d.kernel] || '' }) : t('All {n} threads: {test}', { n: (d.perThread || []).length, test: KN[d.kernel] || '' }), v: d.rate, u: U('MB/s'), p: m.pct });
        const key = d.phase + d.kernel; const cell = $(`.bm-ls[data-ph="${d.phase}"] [data-k="${d.kernel}"]`, body);
        if (lastK && lastK !== key) { const prev = $('.bm-ls span.on', body); if (prev) { prev.classList.remove('on'); prev.classList.add('done'); } }
        if (cell) { cell.classList.add('on'); if (!nil(d.rate)) $('em', cell).textContent = fmtV(d.rate); } lastK = key;
        if (d.perThread) { const box = $('[data-cores]', body); const mx = Math.max(...d.perThread) || 1;
          if (!$('.bm-thr', box)) box.innerHTML = `<div class="bm-thr">${d.perThread.map(() => '<i><u></u></i>').join('')}</div>`;
          $$('.bm-thr u', box).forEach((u, i) => { u.style.transform = `scaleY(${(d.perThread[i] / mx).toFixed(3)})`; }); } });
      setCur(j); const r = await j; if (!r) return null; r.tele = rec.cpu(); return r;
    } finally { rec.stop(); off(); }
  },
  after(el) { teleIdle(el, 'cpu'); },
};

/* ---------- graphics ---------- */
const GPU = {
  icon: 'gpu', title: t('Graphics'), hw: () => comp('gpu').title || t('Graphics card'), side: telePanel('gpu'), wide: true,
  histSub: r => t('{a} and {b} fps', { a: fmtV(r.fill), b: fmtV(r.geo) }),
  skeleton: () => `<div class="bm-gw"><div class="bm-gs sk"></div><div class="bm-gr">${[0, 1, 2].map(() => `<div class="bm-tile">${skLine('50%', 9)}<span class="sk" style="display:block;height:24px;width:60%;margin-top:12px"></span></div>`).join('')}</div></div>`,
  frame: (inner, right) => `<div class="bm-gw"><div class="bm-gs" data-stage>${inner}</div><div class="bm-gr">${right}</div></div>`,
  idle() { return this.frame(`<div class="bm-gph">${ic('gpu')}<b>${t('Two scenes rendered at 1920 × 1080')}</b><span>${t('A raymarched nebula stresses shaders and fill rate; an asteroid field with millions of triangles stresses geometry. The score comes from the sustained frame rate.')}</span><span class="chip">${ic('clock')}${t('About 20 seconds')}</span></div>`,
    `${tile(t('Nebula'), DASH, U('fps'), { sub: t('shaders and fill rate') })}${tile(t('Asteroid field'), DASH, U('fps'), { sub: t('geometry') })}`); },
  result(r, run) { return this.frame(`<div class="bm-gph done">${bigScore(r.score)}<span class="faint bm-gren">${ic('gpu')}${esc(r.renderer || '')}</span></div>`,
    `${tile(t('Nebula'), fmtV(r.fill), U('fps'), { sub: t('shaders and fill rate') })}${tile(t('Asteroid field'), fmtV(r.geo), U('fps'), { sub: t('geometry') })}${tile(t('Resolution'), esc(r.res || '1920 × 1080'), '', { sub: t('rendered offscreen, shown scaled') })}`) + lastLine(run); },
  live() { return this.frame('', `<div class="bm-gl2">${liveHead()}</div>${tile(t('Nebula'), DASH, U('fps'), { cls: 'gn' })}${tile(t('Asteroid field'), DASH, U('fps'), { cls: 'ga' })}`); },
  async exec(body, L, setCur) {
    const rec = teleRec(); const off = SH.tele.on(v => teleShow(CT.gpu.el, 'gpu', v, true));
    try {
      const r = await gpuTest($('[data-stage]', body), (scene, fps, frac) => {
        liveSet(body, { k: scene === 'nebula' ? t('Nebula: shaders and fill rate') : t('Asteroid field: geometry'), v: fps, u: U('fps'), p: frac });
        const tl = $(scene === 'nebula' ? '.gn b' : '.ga b', body); if (tl && !nil(fps)) tl.innerHTML = `${fmtV(fps)}<small>${U('fps')}</small>`;
      }, setCur, false);
      if (r) r.tele = rec.gpu(); return r;
    } finally { rec.stop(); off(); }
  },
  after(el) { teleIdle(el, 'gpu'); },
};

/* ---------- memory ---------- */
const MEM = {
  icon: 'ram', title: t('Memory'), hw: () => comp('ram').title,
  side: `<div class="pan bm-note" data-asm><h4>${t('How it is measured')}</h4><p>${t('Copy, read and write use buffers far larger than the processor caches, on several threads. Latency follows a random chain of addresses, so every step waits for the memory.')}</p></div>`,
  histSub: r => t('{a} GB/s read, {b} ns', { a: fmtV(r.read), b: fmtV(r.latency) }),
  idle: () => idleHTML('ram', t('Bandwidth and latency'), t('How fast data moves between the processor and memory, and how long a single random access takes.'), t('A few seconds')),
  result(r, run) {
    const ri = ramInfo(); const R = { copy: 24, read: 52, write: 31 };
    const bars = ['copy', 'read', 'write'].map(k => `<div class="bm-mb"><span>${MEMN[k]}</span><i><u style="--v:${clamp(r[k] / (R[k] * 2), 0, 1).toFixed(3)}"></u><s style="left:50%" title="${esc(t('A mid-range PC'))}"></s></i><b>${fmtV(r[k])}<small>${U('GB/s')}</small></b></div>`).join('');
    return `<div class="bm-r2">${bigScore(r.score)}<div class="bm-tiles">${tile(t('Read'), fmtV(r.read), U('GB/s'))}${tile(t('Write'), fmtV(r.write), U('GB/s'))}${tile(MEMN.copy, fmtV(r.copy), U('GB/s'))}${tile(t('Latency'), fmtV(r.latency), U('ns'), { sub: t('lower is better') })}</div></div>
      <div class="bm-mbars"><div class="bm-kh"><span>${t('Compared with a mid-range PC')}</span><span class="faint">${t('the mark is a mid-range PC')}</span></div>${bars}</div>
      ${ri.mods === 1 && ri.slots > 1 ? `<div class="bm-tip">${ic('info')}<span>${t('Your PC has one memory module and a free slot. A second, identical module enables dual channel and roughly doubles the bandwidth.')}</span></div>` : ''}${lastLine(run)}`;
  },
  live: () => `${liveHead()}<div class="bm-lsteps one"><div class="bm-ls"><div>${['copy', 'read', 'write', 'latency'].map(k => `<span data-k="${k}">${MEMN[k]}<em>${DASH}</em></span>`).join('')}</div></div></div>`,
  async exec(body, L, setCur) {
    const j = engineJob('memory', [1], m => { const d = m.data || {}; const u = d.phase === 'latency' ? U('ns') : U('GB/s');
      liveSet(body, { k: MEMN[d.phase] || '', v: d.value, u, p: m.pct });
      $$('.bm-ls span', body).forEach(s => { const on = s.dataset.k === d.phase; if (on) s.classList.add('on'); else if (s.classList.contains('on')) { s.classList.remove('on'); s.classList.add('done'); } });
      if (!nil(d.value)) { const c = $(`[data-k="${d.phase}"] em`, body); if (c) c.textContent = fmtV(d.value) + ' ' + u; } });
    setCur(j); return await j;
  },
};

/* ---------- disk ---------- */
const DK = { drives: null, drive: null, size: 1024 };
const DISK = {
  icon: 'ssd', title: t('Disk'), hw: () => comp('ssd').title,
  opts: `<label class="field bm-sel">${ic('ssd')}<select data-drive><option>…</option></select></label><div class="seg bm-size" data-size><span class="ind"></span>${[[256, `256 ${U('MB')}`], [1024, `1 ${U('GB')}`], [4096, `4 ${U('GB')}`]].map(([v, n]) => `<button data-v="${v}"${v === 1024 ? ' class="on"' : ''}>${n}</button>`).join('')}</div>`,
  side: `<div class="pan bm-note" data-asm><h4>${t('How it is measured')}</h4><p>${t('Like CrystalDiskMark: a temporary file on the chosen drive, read and written without the Windows cache. It is deleted when the test ends, also if you cancel.')}</p></div>`,
  histSub: r => t('{drive} drive, {a} MB/s read', { drive: r.drive || '', a: fmtV(r.tests && r.tests.seq_q8 && r.tests.seq_q8.read) }),
  idle: () => DISK.grid(null) + `<div class="bm-last faint">${ic('info')}${t('Pick a drive and a file size, then run the test. Bigger files are less flattered by the drive cache.')}</div>`,
  grid(r, live) {
    const T = (r && r.tests) || {}; const mx = 7000;
    return `<div class="bm-dg${live ? ' live' : ''}"><div class="bm-dh"><span></span><span>${t('Read')}</span><span>${t('Write')}</span></div>${DT.map(([k, code, desc]) => `<div class="bm-dr" data-t="${k}"><div class="bm-dn"><b>${code}</b><span>${desc}</span></div>${['read', 'write'].map(kd => { const v = T[k] && T[k][kd]; const ex = T[k] && (T[k][kd + 'Iops'] ? t('{n} IOPS', { n: fmtInt(T[k][kd + 'Iops']) }) : T[k][kd + 'Lat'] ? t('{n} µs', { n: fmtV(T[k][kd + 'Lat']) }) : '');
      return `<div class="bm-dc2 ${kd}" data-kd="${kd}"><i style="--v:${nil(v) ? 0 : clamp(Math.log10(1 + v) / Math.log10(1 + mx), 0, 1).toFixed(3)}"></i><b>${nil(v) ? DASH : fmtV(v)}<small>${U('MB/s')}</small></b><em>${ex || ''}</em></div>`; }).join('')}</div>`).join('')}</div>`;
  },
  result(r, run) { const q1 = (r.tests || {}).rnd_q1 || {};
    return `<div class="bm-dtop">${bigScore(r.score)}<div class="bm-dmeta">${tile(t('Drive'), esc(r.drive || ''), '', { sub: t('{size} test file', { size: r.sizeMb >= 1024 ? `${fmtInt(r.sizeMb / 1024)} ${U('GB')}` : `${fmtInt(r.sizeMb)} ${U('MB')}` }) })}${tile(t('Access time'), fmtV(q1.readLat), U('µs'), { sub: t('one random read, lower is better') })}</div></div>${DISK.grid(r)}${lastLine(run)}`; },
  live: () => `${liveHead()}${DISK.grid(null, true)}`,
  init(el) {
    const seg = $('[data-size]', el); requestAnimationFrame(() => SH.placeSeg(seg, true));
    seg.addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.classList.contains('on') || RUN) return; $$('button', seg).forEach(x => x.classList.toggle('on', x === b)); SH.placeSeg(seg); DK.size = +b.dataset.v; });
    const sel = $('[data-drive]', el); sel.addEventListener('change', () => { DK.drive = sel.value; });
    (async () => {
      let L = null; if (REAL) { try { L = await SH.engine('benchmark', 'drives'); } catch (e) { console.error(e); } }
      DK.drives = L || [{ letter: 'C:', label: 'Windows', free: 361e9, total: 953e9, system: true }, { letter: 'D:', label: t('Games'), free: 412e9, total: 1000e9, system: false }];
      DK.drive = DK.drive || (DK.drives[0] || {}).letter || 'C:';
      sel.innerHTML = DK.drives.map(d => `<option value="${esc(d.letter)}"${d.letter === DK.drive ? ' selected' : ''}>${esc(d.label ? t('{drive} {label}, {free} free', { drive: d.letter, label: d.label, free: SH.fmtBytes(d.free) }) : t('{drive}, {free} free', { drive: d.letter, free: SH.fmtBytes(d.free) }))}</option>`).join('');
      sel.dispatchEvent(new Event('change'));
    })();
  },
  async exec(body, L, setCur) {
    const drive = DK.drive || 'C:';
    const j = engineJob('disk', [drive, DK.size, 1], m => { const d = m.data || {};
      if (d.phase === 'prepare') liveSet(body, { k: t('Writing a {size} test file on {drive}', { size: DK.size >= 1024 ? `${DK.size / 1024} ${U('GB')}` : `${DK.size} ${U('MB')}`, drive }), v: d.rate, u: U('MB/s'), p: m.pct });
      else { const code = (DT.find(x => x[0] === d.phase) || [, ''])[1]; liveSet(body, { k: `${code} ${d.kind === 'write' ? t('write') : t('read')}`, v: d.rate ?? d.value, u: U('MB/s'), p: m.pct });
        $$('.bm-dc2.on', body).forEach(x => { if (!(x.closest(`[data-t="${d.phase}"]`) && x.dataset.kd === d.kind)) { x.classList.remove('on'); x.classList.add('done'); } });
        const cell = $(`[data-t="${d.phase}"] [data-kd="${d.kind}"]`, body);
        if (cell) { cell.classList.add('on'); const v = d.value ?? d.rate; if (!nil(v)) { $('b', cell).innerHTML = `${fmtV(v)}<small>${U('MB/s')}</small>`; $('i', cell).style.setProperty('--v', clamp(Math.log10(1 + v) / Math.log10(7001), 0, 1).toFixed(3)); } if (!nil(d.value)) cell.classList.add('done'); } } });
    setCur(j); return await j;
  },
};

/* ---------- network ---------- */
const NET = {
  icon: 'globe', title: t('Internet speed'), hw: () => comp('wifi').title, runLabel: t('Start the test'),
  side: `<div class="pan bm-note" data-asm><h4>${t('Who measures it')}</h4><p>${t('The test uses speed.cloudflare.com, Cloudflare’s public speed test. It only starts when you press the button, and uses up to about 600 MB of data on very fast connections.')}</p></div>`,
  histSub: r => t('{a} ms latency, {b} Mbps up', { a: fmtV(r.latency), b: fmtV(r.up) }), metric: r => r.down, metricUnit: U('Mbps'), metricFmt: v => `${fmtV(v)} ${U('Mbps')}`,
  scale(r) {
    const pos = v => clamp(Math.log10(Math.max(1, v || 0)) / Math.log10(2000), 0, 1).toFixed(3);
    return `<div class="bm-nsc"><div class="bm-kh"><span>${t('Speed')}</span><span class="faint">${t('logarithmic scale')}</span></div>${[['down', t('Download'), 'download'], ['up', t('Upload'), 'upload']].map(([k, n, i]) =>
      `<div class="bm-ns ${k}" data-k="${k}"><span>${ic(i)}${n}</span><i><u style="--v:${r ? pos(r[k]) : 0}"></u></i><b>${r && !nil(r[k]) ? fmtV(r[k]) : DASH}<small>${U('Mbps')}</small></b></div>`).join('')}
      <div class="bm-nticks">${[[1, '1'], [10, '10'], [100, '100'], [1000, '1,000']].map(([v, l]) => `<span style="left:${(pos(v) * 100).toFixed(1)}%">${l}</span>`).join('')}</div></div>`;
  },
  tiles(r, live) {
    return `<div class="bm-nt${live ? ' live' : ''}">${[['latency', t('Latency'), U('ms'), 'clock'], ['jitter', t('Jitter'), U('ms'), 'wave2'], ['down', t('Download'), U('Mbps'), 'download'], ['up', t('Upload'), U('Mbps'), 'upload']].map(([k, n, u, i]) =>
      `<div class="bm-tile" data-k="${k}"><span>${ic(i)}${n}</span><b>${r && !nil(r[k]) ? fmtV(r[k]) : DASH}<small>${u}</small></b></div>`).join('')}</div>`;
  },
  idle: () => `${idleHTML('globe', t('Latency, download and upload'), t('Nothing runs until you press “Start the test”. It measures your connection to the nearest Cloudflare server.'), t('About 20 seconds'))}`,
  result(r, run) {
    const where = r.server && (r.server.city || r.server.colo) ? t('Cloudflare server in {city}', { city: esc([r.server.city, r.server.colo && `(${r.server.colo})`].filter(Boolean).join(' ')) }) : 'speed.cloudflare.com';
    const v = r.down >= 500 ? t('Very fast: 4K streaming, big downloads and video calls at once.') : r.down >= 100 ? t('Fast: comfortable for streaming, gaming and video calls.') : r.down >= 25 ? t('Enough for HD streaming and video calls, slower with big downloads.') : t('Slow: streaming and downloads will struggle.');
    const lv = r.latency < 20 ? t('Low latency: great for online gaming and calls.') : r.latency < 50 ? t('Normal latency: fine for online gaming.') : t('High latency: online games and calls may feel delayed.');
    return `${NET.tiles(r)}${NET.scale(r)}<div class="bm-nv"><div class="bm-rl2 ${r.down >= 100 ? 'ok' : r.down >= 25 ? '' : 'warn'}">${ic('download')}<span>${v}</span></div><div class="bm-rl2 ${r.latency < 50 ? 'ok' : 'warn'}">${ic('clock')}<span>${lv}</span></div><div class="bm-rl2">${ic('info')}<span>${where}. ${t('Data used: {n} MB.', { n: fmtInt((r.downMb || 0) + (r.upMb || 0)) })}</span></div></div>${lastLine(run)}`;
  },
  live: () => `${liveHead()}${NET.tiles(null, true)}${NET.scale(null)}`,
  async exec(body, L, setCur) {
    const j = engineJob('network', [1], m => { const d = m.data || {};
      const k = d.phase === 'latency' ? t('Latency') : d.phase === 'down' ? t('Download') : d.phase === 'up' ? t('Upload') : t('Connecting to speed.cloudflare.com');
      liveSet(body, { k, v: d.rate ?? d.value, u: d.phase === 'latency' ? U('ms') : U('Mbps'), p: m.pct });
      $$('.bm-nt .bm-tile', body).forEach(x => x.classList.toggle('on', x.dataset.k === d.phase));
      const tl = $(`.bm-nt [data-k="${d.phase}"] b`, body); const v = d.rate ?? d.value; if (tl && !nil(v)) tl.innerHTML = `${fmtV(v)}<small>${d.phase === 'latency' ? U('ms') : U('Mbps')}</small>`;
      const sb = $(`.bm-ns[data-k="${d.phase}"]`, body); if (sb && !nil(v)) { $('u', sb).style.setProperty('--v', clamp(Math.log10(Math.max(1, v)) / Math.log10(2000), 0, 1).toFixed(3)); $('b', sb).innerHTML = `${fmtV(v)}<small>${U('Mbps')}</small>`; } });
    setCur(j); return await j;
  },
};
SH.icons.add({ wave2: '<path d="M3 12c2-5 4-5 6 0s4 5 6 0 4-5 6 0"/>' });

/* ============================================================ Stress test */
const ST = { el: null, target: 'cpu', min: 5, data: null };
const LIM = { gpu: 90, cpu: 100 };
const thin = (a, n = 240) => { const k = Math.max(1, Math.ceil(a.length / n)); const r1 = v => nil(v) ? null : Math.round(v * 100) / 100;
  return a.filter((_, i) => i % k === 0).map(q => ({ t: Math.round(q.t * 10) / 10, cpu: r1(q.cpu), cpuFreq: r1(q.cpuFreq), cpuTemp: r1(q.cpuTemp), gpu: r1(q.gpu), gpuClock: r1(q.gpuClock), gpuTemp: r1(q.gpuTemp), gpuPower: r1(q.gpuPower) })); };
const SERIES = [
  { k: 'temp', n: t('Temperature'), u: '°C', cpu: 'cpuTemp', gpu: 'gpuTemp' },
  { k: 'clock', n: t('Clock'), u: U('GHz'), cpu: 'cpuFreq', gpu: 'gpuClock', dec: true },
  { k: 'load', n: t('Load'), u: '%', cpu: 'cpu', gpu: 'gpu' },
  { k: 'power', n: t('Graphics card power'), u: U('W'), gpu: 'gpuPower' },
];
function renderStress(el, ctx) {
  ST.el = el; el.classList.add('fill');
  el.innerHTML = `<div class="bm-ct stress">
    <div class="pan bm-main" data-asm>
      <div class="bm-head"><span class="bm-hi">${ic('flame')}</span><div class="bm-ht"><b>${t('Stress test')}</b><span>${t('Full load for a set time, watching heat and clocks')}</span></div>
        <div class="bm-opts"><div class="seg" data-tg><span class="ind"></span>${[['cpu', t('Processor')], ['gpu', t('Graphics')], ['both', SH.tc('benchmark', 'Both')]].map(([v, n]) => `<button data-v="${v}"${v === ST.target ? ' class="on"' : ''}>${n}</button>`).join('')}</div>
        <div class="seg" data-mn><span class="ind"></span>${[1, 5, 15, 30].map(v => `<button data-v="${v}"${v === ST.min ? ' class="on"' : ''}>${t('{n} min', { n: v })}</button>`).join('')}</div></div>
        <button class="btn pri" data-run>${ic('play')}${t('Start')}</button></div>
      <div class="bm-charts">${SERIES.map(s => `<div class="bm-chw" data-s="${s.k}"><div class="bm-chh"><span>${s.n}</span><b data-cv>${DASH}</b></div><canvas data-cc></canvas></div>`).join('')}</div>
      <div class="bm-leg"><span><i class="c"></i>${t('Processor')}</span><span><i class="g"></i>${t('Graphics card')}</span><em data-elap></em></div>
    </div>
    <div class="bm-side">
      <div class="pan bm-sst" data-asm><h4>${t('Status')}<em data-sst></em></h4><div data-sbody></div></div>
      <div class="pan bm-glp" data-asm hidden><h4>${t('Graphics load')}<em data-fps></em></h4><div class="bm-glh" data-glh></div></div>
    </div></div>`;
  const sel = (q, key) => { const seg = $(q, el); requestAnimationFrame(() => SH.placeSeg(seg, true));
    seg.addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.classList.contains('on') || RUN) return; $$('button', seg).forEach(x => x.classList.toggle('on', x === b)); SH.placeSeg(seg); ST[key] = key === 'min' ? +b.dataset.v : b.dataset.v; stIdle(); }); };
  sel('[data-tg]', 'target'); sel('[data-mn]', 'min');
  $('[data-run]', el).addEventListener('click', () => RUN && RUN.kind === 'stress' ? RUN.cancel() : runStress());
  busyFns.add(() => { const b = $('[data-run]', el); const mine = RUN && RUN.kind === 'stress'; b.innerHTML = mine ? `${ic('stop')}${t('Stop')}` : `${ic('play')}${t('Start')}`; b.className = mine ? 'btn sec' : 'btn pri'; b.disabled = !!RUN && !mine; $$('.seg button', el).forEach(x => { x.disabled = !!RUN; }); });
  ST.charts = SERIES.map(s => ({ s, c: $(`[data-s="${s.k}"] canvas`, el) }));
  ST.charts.forEach(o => { o.c.addEventListener('pointermove', e => { o.hx = e.clientX - o.c.getBoundingClientRect().left; stDraw(); }); o.c.addEventListener('pointerleave', () => { o.hx = null; stDraw(); }); });
  new ResizeObserver(() => stDraw()).observe($('.bm-charts', el));
  onHistory(() => { if (!RUN || RUN.kind !== 'stress') stIdle(); });
  loadHistory().then(stIdle);
}
function stIdle() {
  const el = ST.el; if (!el || (RUN && RUN.kind === 'stress')) return;
  const last = (H.runs || []).find(r => r.kind === 'stress');
  const box = $('[data-sbody]', el);
  if (ST.data && ST.data.summary) { box.innerHTML = stSummaryHTML(ST.data.summary); $('[data-sst]', el).textContent = t('just finished'); stHeads(ST.data); stDraw(); return; }
  $('[data-sst]', el).textContent = last ? t('last: {date}', { date: fmtDate(last.at) }) : '';
  const ls = last && last.stress;
  ST.data = ls && ls.series && ls.series.length ? { target: ls.target, min: ls.minutes, s: ls.series, thr: ls.throttle || [], past: true } : null;
  stHeads(ST.data);
  box.innerHTML = last ? stSummaryHTML(last.stress) : `<div class="bm-sl">${ic('info')}<span>${t('Runs the chosen parts at full load and draws temperature, clocks, load and power live. It detects throttling and stops by itself at a safe limit.')}</span></div>
    <div class="bm-lims"><div><span>${t('Stops at')}</span><b>${t('Graphics card {n} °C', { n: LIM.gpu })}</b><b>${t('Processor {n} °C', { n: LIM.cpu })}</b></div></div>
    <div class="bm-sl faint">${ic('alert')}<span>${t('Plug in the charger and keep the vents clear. You can stop it at any moment.')}</span></div>`;
  $$('.bm-chw', el).forEach(x => x.classList.toggle('na', !stUses(x.dataset.s, ST.data ? ST.data.target : ST.target)));
  stDraw();
}
/* chart headers after a run: the peak of each line */
function stHeads(D) {
  const el = ST.el; if (!el) return;
  SERIES.forEach(s => { const cell = $(`[data-s="${s.k}"] [data-cv]`, el); if (!cell) return;
    if (!D) { cell.textContent = DASH; return; }
    const parts = [['cpu', D.target !== 'gpu'], ['gpu', D.target !== 'cpu']].filter(([p, on]) => on && s[p]).map(([p]) => { const v = D.s.map(q => q[s[p]]).filter(x => !nil(x)); return [p, v.length ? Math.max(...v) : null]; });
    cell.innerHTML = parts.length ? parts.map(([p, v]) => `<span class="${p === 'cpu' ? 'c' : 'g'}">${nil(v) ? DASH : s.dec ? fmt1(v) : fmtInt(v)}</span>`).join('') + `<small>${s.u}, ${t('peak')}</small>` : DASH; });
}
const stUses = (k, tg = ST.target) => { const s = SERIES.find(x => x.k === k); return !!((tg !== 'gpu' && s.cpu) || (tg !== 'cpu' && s.gpu)); };
function stDraw() {
  const el = ST.el; if (!el || !el.offsetParent) return;
  const D = ST.data; const total = (D ? D.min : ST.min) * 60;
  ST.charts.forEach(o => {
    const { s, c } = o; const f = fitCanvas(c); if (!f) return; const { x, w, h } = f; x.clearRect(0, 0, w, h);
    const K = SH.chartKit, L = 2, R = w - 2, T = 6, B = h - K.xpad;
    K.grid(x, L, R, T, B, 4);
    if (!D || !D.s.length) return;
    const lines = [['cpu', '--accent'], ['gpu', '--accent2']].filter(([p]) => s[p] && (p === 'cpu' ? D.target !== 'gpu' : D.target !== 'cpu'));
    const vals = lines.flatMap(([p]) => D.s.map(q => q[s[p]]).filter(v => !nil(v)));
    let lo = s.k === 'load' ? 0 : Math.min(...vals), hi = s.k === 'load' ? 100 : Math.max(...vals);
    if (!vals.length) { lo = 0; hi = 1; } if (s.k !== 'load') { const pad = Math.max((hi - lo) * .2, s.k === 'clock' ? .2 : 3); lo = Math.max(0, lo - pad); hi += pad; }
    if (s.k === 'temp') { const lim = Math.max(...lines.map(([p]) => LIM[p])); if (hi >= lim - 12) { hi = Math.max(hi, lim + 2); const y = B - (lim - lo) / (hi - lo) * (B - T); x.setLineDash([3, 4]); x.strokeStyle = rgba(css('--bad') || '#FF6B7A', .7); x.beginPath(); x.moveTo(L, y); x.lineTo(R, y); x.stroke(); x.setLineDash([]); } }
    K.ticks(x, L, T, B, 4, hi, lo, v => s.k === 'clock' ? fmt1(v) : Math.round(v)); K.xlabels(x, L, R, h, '0:00', fmtDur(total));
    lines.forEach(([p, cv]) => {
      const col = css(cv); x.strokeStyle = col; x.lineWidth = 1.8; x.lineJoin = 'round'; x.beginPath(); let on = false;
      D.s.forEach(q => { const v = q[s[p]]; if (nil(v)) { on = false; return; } const px = L + (q.t / total) * (R - L), py = B - (v - lo) / Math.max(1e-6, hi - lo) * (B - T); if (on) x.lineTo(px, py); else { x.moveTo(px, py); on = true; } });
      x.stroke();
    });
    if (s.k === 'clock') (D.thr || []).forEach(ev => { const px = Math.round(L + ev.at / total * (R - L)) + .5; const wc = css('--warn') || '#F4C26B';
      x.strokeStyle = rgba(wc, .55); x.setLineDash([2, 4]); x.beginPath(); x.moveTo(px, T); x.lineTo(px, B); x.stroke(); x.setLineDash([]);
      x.fillStyle = wc; x.beginPath(); x.arc(px, T + 2, 3, 0, 6.3); x.fill(); });
    if (o.hx != null && o.hx >= L && o.hx <= R) {
      const at = (o.hx - L) / (R - L) * total; let q = D.s[0]; D.s.forEach(r => { if (Math.abs(r.t - at) < Math.abs(q.t - at)) q = r; });
      const hx = L + q.t / total * (R - L); K.cursor(x, hx, T, B);
      const tl = []; lines.forEach(([p, cv]) => { const v = q[s[p]]; if (nil(v)) return; const col = css(cv); x.fillStyle = col; x.beginPath(); x.arc(hx, B - (v - lo) / Math.max(1e-6, hi - lo) * (B - T), 3.5, 0, 6.3); x.fill(); tl.push([col, `${p === 'cpu' ? t('Processor') : t('Graphics card')}: ${s.dec ? fmt1(v) : fmtInt(v)} ${s.u}`]); });
      if (tl.length) { tl.push([css('--mute'), fmtDur(q.t)]); K.tip(x, hx, w, T, tl); }
    }
  });
}
function stSummaryHTML(S) {
  const thr = S.throttle || [];
  const verdict = S.reason ? { tone: 'bad', txt: t('Stopped for safety: {part} reached {n} °C.', { part: S.reason.part === 'gpu' ? t('the graphics card') : t('the processor'), n: fmtInt(S.reason.temp) }) }
    : S.errors > 0 ? { tone: 'bad', txt: t('Unstable: {n} calculation errors. Check overclocking, undervolting or cooling.', { n: fmtInt(S.errors) }) }
    : thr.length ? { tone: 'warn', txt: thr.map(e => (e.why === 'thermal' ? t('{part} throttled from heat: its clock dropped {n}%.', { part: e.part === 'gpu' ? t('The graphics card') : t('The processor'), n: fmtInt(e.drop) })
        : e.why === 'power' ? t('{part} hit its power limit: its clock dropped {n}%.', { part: e.part === 'gpu' ? t('The graphics card') : t('The processor'), n: fmtInt(e.drop) })
        : t('{part} lowered its clock by {n}% under load.', { part: e.part === 'gpu' ? t('The graphics card') : t('The processor'), n: fmtInt(e.drop) }))).join(' ') }
    : { tone: 'ok', txt: S.stopped ? t('No problems while it ran, but it was stopped early.') : t('Stable: no errors and no throttling.') };
  const perf = (a, b) => nil(a) || nil(b) || !a ? DASH : `${b >= a ? '' : '−'}${fmtInt(Math.abs((b - a) / a * 100))}%`;
  const rows = [
    [t('Duration'), `${fmtDur(S.elapsed)} / ${t('{n} min', { n: S.minutes })}`],
    S.target !== 'gpu' && [t('Processor temperature'), nil(S.cpuTempMax) ? `<small>${t('not reported')}</small> ${DASH}` : `${fmtInt(S.cpuTempMax)} °C`],
    S.target !== 'cpu' && [t('Graphics card temperature'), nil(S.gpuTempMax) ? DASH : `${fmtInt(S.gpuTempMax)} °C`],
    S.target !== 'gpu' && [t('Processor clock, start to end'), nil(S.cpuClockStart) ? DASH : `${fmt1(S.cpuClockStart)} → ${fmt1(S.cpuClockEnd)} ${U('GHz')}`],
    S.target !== 'cpu' && [t('Graphics clock, start to end'), nil(S.gpuClockStart) ? DASH : `${fmt1(S.gpuClockStart)} → ${fmt1(S.gpuClockEnd)} ${U('GHz')}`],
    S.target !== 'cpu' && !nil(S.gpuPowerAvg) && [t('Graphics card power'), `${fmtInt(S.gpuPowerAvg)} ${U('W')}`],
    S.target !== 'gpu' && [t('Processor performance change'), perf(S.perfStart, S.perfEnd)],
    S.target !== 'cpu' && [t('Graphics performance change'), perf(S.fpsStart, S.fpsEnd)],
    S.target !== 'gpu' && [t('Calculation errors'), fmtN(S.errors)],
  ].filter(Boolean);
  return `<div class="bm-sv2 ${verdict.tone}">${ic(verdict.tone === 'ok' ? 'check' : 'alert')}<span>${esc(verdict.txt)}</span></div><div class="bm-sr2">${rows.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('')}</div>`;
}
/* throttling: a clock that falls >10 % below its level at the start of the run while under load */
function throttleCheck(D) {
  const out = [];
  [['cpu', 'cpuFreq', 'cpuTemp', null, 'cpu'], ['gpu', 'gpuClock', 'gpuTemp', 'gpuPower', 'gpu']].forEach(([p, ck, tk, pk, lk]) => {
    if (p === 'cpu' ? D.target === 'gpu' : D.target === 'cpu') return;
    const S = D.s.filter(q => !nil(q[ck]) && (q[lk] ?? 100) > 60); if (S.length < 16) return;
    const base = S.slice(0, Math.max(8, Math.min(40, Math.floor(S.length / 4)))).map(q => q[ck]).sort((a, b) => a - b);
    const b0 = base[Math.floor(base.length * .75)]; const tail = S.slice(-8).map(q => q[ck]).sort((a, b) => a - b); const now = tail[Math.floor(tail.length / 2)];
    const drop = (b0 - now) / b0 * 100; const ev = D.thr.find(e => e.part === p);
    if (drop >= 10) {
      const temp = Math.max(...S.slice(-8).map(q => q[tk] ?? -1)); const pw = pk ? S.slice(-8).map(q => q[pk]).filter(v => !nil(v)) : [];
      const pmax = pk ? Math.max(...S.map(q => q[pk] ?? 0)) : 0;
      const why = temp >= (p === 'gpu' ? 83 : 92) ? 'thermal' : pw.length && pmax && Math.min(...pw) >= pmax * .9 ? 'power' : 'clock';
      if (!ev) { const e = { part: p, why, at: D.s[D.s.length - 1].t, drop: Math.round(drop) }; D.thr.push(e); out.push(e); } else { ev.drop = Math.max(ev.drop, Math.round(drop)); ev.why = why; }
    }
  });
  return out;
}
async function runStress() {
  if (RUN) { SH.toast(t('Another test is running. Wait for it to finish or cancel it.'), { kind: 'unavailable' }); return; }
  const el = ST.el; const target = ST.target, min = ST.min, total = min * 60;
  const useC = target !== 'gpu', useG = target !== 'cpu';
  const D = ST.data = { target, min, s: [], thr: [], fps: [], perf: [], t0: performance.now() };
  let job = null, gl = null, glCv = null, stopped = false, reason = null, errors = 0;
  const stop = why => { if (stopped) return; stopped = true; if (why) reason = why; if (job) job.cancel(); if (gl) gl.stop(); };
  setRun({ kind: 'stress', label: t('Stress test'), cancel: () => stop() });
  $$('.bm-chw', el).forEach(x => x.classList.toggle('na', !stUses(x.dataset.s)));
  const box = $('[data-sbody]', el); $('[data-sst]', el).textContent = t('running');
  box.innerHTML = `<div class="bm-sbig"><b data-rem>${fmtDur(total)}</b><span>${t('left')}</span></div><div class="bar acc"><span data-sp style="--v:0"></span></div>
    <div class="bm-sr2"><div><span>${t('Throttling')}</span><b data-thr>${t('none so far')}</b></div>${useC ? `<div><span>${t('Calculation errors')}</span><b data-err>0</b></div>` : ''}<div><span>${t('Safety limit')}</span><b>${[useG && t('Graphics card {n} °C', { n: LIM.gpu }), useC && t('Processor {n} °C', { n: LIM.cpu })].filter(Boolean).join(', ')}</b></div></div>
    ${useC && REAL && !SH.tele.has('cpuTemp') ? `<div class="bm-sl faint">${ic('info')}<span>${t('Windows does not report this processor’s temperature, so its limit cannot be watched. Keep an eye on it and stop the test if the PC gets too hot.')}</span></div>` : ''}`;
  const glp = $('.bm-glp', el); glp.hidden = !useG;
  const off = SH.tele.on(v => {
    const q = { t: (performance.now() - D.t0) / 1000, cpu: v.cpu, cpuFreq: v.cpuFreq, cpuTemp: v.cpuTemp, gpu: v.gpu, gpuClock: v.gpuClock, gpuTemp: v.gpuTemp, gpuPower: v.gpuPower };
    D.s.push(q);
    SERIES.forEach(s => { const cell = $(`[data-s="${s.k}"] [data-cv]`, el); const parts = [useC && s.cpu && v[s.cpu], useG && s.gpu && v[s.gpu]].filter(x => x !== false && x !== undefined);
      cell.innerHTML = parts.length ? parts.map((x, i) => `<span class="${(useC && s.cpu && i === 0) ? 'c' : 'g'}">${nil(x) ? DASH : (s.dec ? fmt1(x) : fmtInt(x))}</span>`).join('') + `<small>${s.u}</small>` : DASH; });
    if (useG && !nil(v.gpuTemp) && v.gpuTemp >= LIM.gpu) stop({ part: 'gpu', temp: v.gpuTemp });
    if (useC && !nil(v.cpuTemp) && v.cpuTemp >= LIM.cpu) stop({ part: 'cpu', temp: v.cpuTemp });
    const nw = throttleCheck(D); if (nw.length || D.thr.length) { const x = $('[data-thr]', el); if (x) { x.textContent = D.thr.map(e => `${e.part === 'gpu' ? t('Graphics') : t('Processor')} −${e.drop}%`).join(', '); x.className = 'warn'; } }
    stDraw();
  });
  const tick = setInterval(() => { const el2 = (performance.now() - D.t0) / 1000; const r = $('[data-rem]', el); if (r) r.textContent = fmtDur(total - el2); benchProg(clamp(el2 / total, 0, 1)); const p = $('[data-sp]', el); if (p) p.style.setProperty('--v', clamp(el2 / total, 0, 1));
    $('[data-elap]', el).textContent = `${fmtDur(el2)} / ${fmtDur(total)}`;
    if (el2 >= total + 1) stop(); }, 500);
  try {
    const tasks = [];
    if (useC) {
      job = REAL ? SH.job('benchmark', 'stress_cpu', [total], { sound: 'task', onProgress: m => { const d = m.data || {}; if (m.kind !== 'progress') return; errors = d.errors || 0; const x = $('[data-err]', el); if (x) { x.textContent = fmtInt(errors); x.className = errors ? 'bad' : ''; } if (!nil(d.rate)) D.perf.push(d.rate); } })
        : (() => { let s = false; const p = (async () => { const t1 = performance.now(); while (!s && performance.now() - t1 < total * 1000) { D.perf.push(13400 - (performance.now() - t1) / 1000 * 2); await wait(500); } return { elapsed: (performance.now() - t1) / 1000, errors: 0 }; })(); p.cancel = () => { s = true; }; return p; })();
      tasks.push(job.then(r => { if (r && r.reason && r.reason.part === 'cpu') stop(r.reason); return r; }).catch(e => { if (!e.cancelled) throw e; return null; }));
    }
    if (useG) {
      glCv = document.createElement('canvas'); glCv.className = 'bm-gl'; $('[data-glh]', el).appendChild(glCv);
      gl = glBench(glCv);
      tasks.push(gl.run('nebula', { warm: 0, endless: true, onTick: (fps, frac, rate) => { const now = (performance.now() - D.t0) / 1000; if (rate > 0 && (!D.fps.length || now - D.fps[D.fps.length - 1][0] >= 1)) { D.fps.push([now, rate]); $('[data-fps]', el).textContent = `${fmtInt(rate)} ${U('fps')}`; } if (now >= total) gl.stop(); } }));
    }
    const res = await Promise.all(tasks);
    stop();
    const cj = useC ? res[0] : null;
    const avgOf = a => a.length ? a.reduce((p, c) => p + c, 0) / a.length : null;
    const seg = (key, from) => { const v = D.s.filter(q => !nil(q[key]) && (from ? q.t <= Math.max(20, D.s[D.s.length - 1].t * .2) : q.t >= D.s[D.s.length - 1].t * .8)).map(q => q[key]); return avgOf(v); };
    const mx = k => { const v = D.s.map(q => q[k]).filter(x => !nil(x)); return v.length ? Math.max(...v) : null; };
    const k6 = a => Math.max(1, Math.floor(a.length / 6));
    const fp = D.fps.map(x => x[1]);
    const S = { target, minutes: min, elapsed: (performance.now() - D.t0) / 1000, stopped: !!(stopped && (performance.now() - D.t0) / 1000 < total - 2) || !!reason, reason, errors: (cj && cj.errors) || errors,
      cpuTempMax: useC ? mx('cpuTemp') : null, gpuTempMax: useG ? mx('gpuTemp') : null,
      cpuClockStart: useC ? seg('cpuFreq', true) : null, cpuClockEnd: useC ? seg('cpuFreq', false) : null,
      gpuClockStart: useG ? seg('gpuClock', true) : null, gpuClockEnd: useG ? seg('gpuClock', false) : null,
      gpuPowerAvg: useG ? avgOf(D.s.map(q => q.gpuPower).filter(x => !nil(x))) : null,
      perfStart: useC && D.perf.length ? avgOf(D.perf.slice(0, k6(D.perf))) : null, perfEnd: useC && D.perf.length ? avgOf(D.perf.slice(-k6(D.perf))) : null,
      fpsStart: useG && fp.length ? avgOf(fp.slice(0, k6(fp))) : null, fpsEnd: useG && fp.length ? avgOf(fp.slice(-k6(fp))) : null,
      throttle: D.thr, series: thin(D.s) };
    D.summary = S;
    if (S.elapsed >= 10) await saveRun({ kind: 'stress', score: null, stress: S });
    setRun(null); stIdle();
    const msg = reason ? t('Stress test stopped for safety.') : t('Stress test finished.');
    if (!benchEnd({ ok: true, summary: msg, kind: reason ? 'warning' : 'success' })) SH.toast(msg, { kind: reason ? 'warning' : 'success' });
    SH.logActivity(t('Stress test finished'), { sub: fmtDur(S.elapsed), ic: 'flame', go: 'benchmark', tab: 'stress' });
  } catch (e) {
    console.error(e); stop(); setRun(null); stIdle();
    if (!benchEnd({ ok: false, error: (e && e.message) || '' })) SH.toast(t('The stress test stopped: {msg}', { msg: (e && e.message) || '' }), { ms: 7000, kind: 'error' });
  } finally { off(); clearInterval(tick); if (gl) gl.destroy(); if (glCv) glCv.remove(); glp.hidden = true; setRun(null); benchEnd({ cancelled: true }); }
}

/* ============================================================ History */
const HI = { el: null, metric: 'score' };
function renderHistory(el, ctx) {
  HI.el = el; el.classList.add('fill');
  const M = [['score', t('Score')], ['cpu', t('Processor')], ['gpu', t('Graphics')], ['memory', t('Memory')], ['disk', t('Disk')]];
  el.innerHTML = `<div class="bm-hi2">
    <div class="pan bm-hch" data-asm><div class="bm-hch-h"><h4 class="pan-h">${t('Over time')}</h4><div class="seg" data-m><span class="ind"></span>${M.map(([v, n]) => `<button data-v="${v}"${v === HI.metric ? ' class="on"' : ''}>${n}</button>`).join('')}</div></div><canvas data-hc></canvas><div class="bm-hce faint" hidden data-hce>${t('No results for this yet.')}</div><div class="bm-hone" hidden data-hone></div></div>
    <div class="pan bm-hls" data-asm><h4>${t('All runs')}<em data-n></em></h4><div class="bm-hlist" data-list>${[0, 1, 2, 3, 4].map(k => `<div class="sk-row"><div class="sk a" style="--dl:${k * .1}s"></div><div class="sk b" style="--w:${[44, 36, 52, 30, 41][k]}%;--dl:${k * .1}s"></div><div class="sk c"></div></div>`).join('')}</div></div>
  </div>`;
  const seg = $('[data-m]', el); requestAnimationFrame(() => SH.placeSeg(seg, true));
  const chart = timeChart($('[data-hc]', el), () => { const k = HI.metric; const L = k === 'score' ? (H.runs || []).filter(r => r.kind === 'full' && r.score) : runsOf(k);
    const pts2 = L.map(r => [r.at, k === 'score' ? r.score : r[k].score]).filter(p => !nil(p[1])); $('[data-hce]', el).hidden = !!pts2.length || !H.runs;
    /* one single result is not a chart: show it as a number, with a hint, and let the panel be as small as its content */
    const one = pts2.length === 1, ho = $('[data-hone]', el), hp = $('.bm-hch', el); hp.classList.toggle('one', one); ho.hidden = !one;
    if (one) { const sig = `${pts2[0][0]}|${pts2[0][1]}`; if (ho.dataset.sig !== sig) { ho.dataset.sig = sig; ho.innerHTML = `<b>${fmtN(pts2[0][1])}</b><span>${esc(fmtDate(pts2[0][0]))}</span><p class="muted">${t('This is your only result so far. Run the test again to see how it changes over time.')}</p>`; } }
    return [{ col: k === 'score' ? '--accent' : '--accent2', fill: true, pts: pts2 }]; }, { axis: true, pad: 16, fmt: v => t('{n} points', { n: fmtInt(v) }) });
  seg.addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.classList.contains('on')) return; $$('button', seg).forEach(x => x.classList.toggle('on', x === b)); SH.placeSeg(seg); HI.metric = b.dataset.v; chart.replay(); });
  $('[data-list]', el).addEventListener('click', async e => {
    const d = e.target.closest('[data-del]'); if (!d) return; const id = d.dataset.del; const r = (H.runs || []).find(x => x.id === id); if (!r) return;
    SH.sound('delete');
    const row2 = d.closest('.bm-hrow'); await anim(row2, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate3d(16px,0,0)' }], { d: 220 }).finished.catch(() => {});
    if (await deleteRun(id)) SH.toast(t('Result deleted.'), { action: { label: t('Undo'), sound: 'undo', run: async () => { const { id: _x, ...rest } = r; if (REAL) { try { const s = await SH.engine('benchmark', 'save_run', rest); H.runs.push(s); } catch (er) { console.error(er); } } else H.runs.push(r); H.runs.sort((a, b) => b.at - a.at); histChanged(); } } });
  });
  HI.chart = chart;
  onHistory(() => { hiPaint(); chart.draw(); });
  loadHistory().then(() => { hiPaint(); chart.replay(); });
}
function runSummary(r) {
  const k = r.kind, d = r[k] || {};
  if (k === 'full') return COMPS.map(c => `${c.n} ${fmtN(r.scores && r.scores[c.id])}`).join(', ');
  if (k === 'cpu') return CPU.histSub(d); if (k === 'gpu') return GPU.histSub(d); if (k === 'memory') return MEM.histSub(d); if (k === 'disk') return DISK.histSub(d);
  if (k === 'network') return NET.histSub(d);
  if (k === 'stress') { const tg = d.target === 'both' ? t('Processor and graphics') : d.target === 'gpu' ? t('Graphics') : t('Processor'); return `${tg}, ${fmtDur(d.elapsed || 0)}${d.reason ? ', ' + t('stopped for safety') : (d.throttle || []).length ? ', ' + t('throttled') : d.errors ? ', ' + t('errors') : ''}`; }
  return '';
}
function hiPaint() {
  const el = HI.el; if (!el || !H.runs) return; const L = H.runs; const box = $('[data-list]', el);
  $('.bm-hi2', el).classList.toggle('few', L.length <= 6);
  $('[data-n]', el).textContent = L.length ? (L.length === 1 ? t('{n} run', { n: 1 }) : t('{n} runs', { n: L.length })) : '';
  box.innerHTML = L.length ? L.map(r => { const [n, i] = KIND[r.kind] || [r.kind, 'benchmark'];
    const val = r.kind === 'network' ? `${fmtV(r.network.down)}<small>${U('Mbps')}</small>` : r.kind === 'stress' ? `<span class="chip ${r.stress.reason || r.stress.errors ? 'bad' : (r.stress.throttle || []).length ? 'warn' : 'ok'}">${r.stress.reason ? t('Stopped') : r.stress.errors ? t('Unstable') : (r.stress.throttle || []).length ? t('Throttled') : t('Stable')}</span>` : fmtN(r.score);
    return `<div class="row bm-hrow"><span class="ri${r.kind === 'full' ? ' acc' : ''}">${ic(i)}</span><span class="rt"><b>${n}</b><span>${esc(fmtDate(r.at))}, ${esc(runSummary(r))}</span></span><span class="bm-hval">${val}</span><button class="btn sm ghost bm-del" data-del="${esc(r.id)}" title="${esc(t('Delete this result'))}" aria-label="${esc(t('Delete this result'))}">${ic('trash')}</button></div>`; }).join('')
    : SH.emptyState({ art: 'first', title: t('No results yet'), text: t('Every test you run is saved here, so you can see how your PC changes over time.'), action: { label: t('Run full benchmark'), go: 'benchmark/overview', pri: true } });
}

/* ============================================================ module */
function actChip() {
  const a = $('#v-benchmark .mhead .acts'); if (!a) return;
  a.innerHTML = RUN ? `<span class="chip acc bm-run">${ic('benchmark')}${esc(t('Running: {name}', { name: RUN.label }))}</span>` : `<span class="chip">${ic('info')}${t('Results are saved on this PC')}</span>`;
}
const RENDER = {
  overview: renderOverview, cpu: (el, ctx) => renderComp('cpu', el, ctx, CPU), gpu: (el, ctx) => renderComp('gpu', el, ctx, GPU), memory: (el, ctx) => renderComp('memory', el, ctx, MEM),
  disk: (el, ctx) => renderComp('disk', el, ctx, DISK), network: (el, ctx) => renderComp('network', el, ctx, NET), stress: renderStress, history: renderHistory,
};
SH.module({
  id: 'benchmark',
  actions(el) { el.innerHTML = `<span class="chip">${ic('info')}${t('Results are saved on this PC')}</span>`; },
  renderTab(tab, el, ctx) { RENDER[tab](el, ctx); },
  enterTab(tab, el) {
    if (tab === 'stress') requestAnimationFrame(stDraw);
    if (CT[tab] && CT[tab].chart) requestAnimationFrame(() => CT[tab].chart.draw());
    if (tab === 'history' && HI.chart) requestAnimationFrame(() => HI.chart.draw());
    $$('.seg', el).forEach(s => requestAnimationFrame(() => SH.placeSeg(s, true)));
  },
  leaveTab() {}, enter() { actChip(); }, leave() {},
});
SH.actions.add([
  { t: t('Run the full benchmark'), go: 'benchmark', tab: 'overview', ic: 'benchmark' },
  { t: t('Measure the processor speed'), go: 'benchmark', tab: 'cpu', ic: 'cpu' },
  { t: t('Measure the graphics card'), go: 'benchmark', tab: 'gpu', ic: 'gpu' },
  { t: t('Measure the disk speed'), go: 'benchmark', tab: 'disk', ic: 'ssd' },
  { t: t('Measure the internet speed'), go: 'benchmark', tab: 'network', ic: 'globe' },
  { t: t('Stress test the PC'), go: 'benchmark', tab: 'stress', ic: 'flame' },
  { t: t('Benchmark history'), go: 'benchmark', tab: 'history', ic: 'clock' },
]);
})();
