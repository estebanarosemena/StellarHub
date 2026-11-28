/* StellarHub · always-on-top widget. Layouts: grid (2 columns), row and list.
   SH.widgetSize(conf) computes the window size (the main window also uses it when opening the widget);
   SH.widgetApply(conf) rebuilds it instantly when the settings change. */
'use strict';
(() => {
const { $, $$, anim, EASE, ic, state } = SH;
const t = SH.t, u = SH.unit;
/* what Windows does not provide (e.g. CPU temperature without admin) arrives as null: shown as "—", never 0 */
const ok = x => x !== null && x !== undefined;
const R = (x, f = Math.round) => ok(x) ? f(x) : '—';
/* names for the small version's hover: short (fits in the bar) and full (Windows tooltip) */
const NAMES = { cpu: ['CPU', t('Processor usage')], cpuTemp: ['CPU °C', t('Processor temperature')], gpu: ['GPU', t('Graphics card usage')],
  gpuTemp: ['GPU °C', t('Graphics card temperature')], gpuPower: [`GPU ${u('W')}`, t('Graphics card power draw')], ram: ['RAM', t('Memory in use')],
  vram: ['VRAM', t('Video memory in use')], down: [t('Down'), t('Download speed')], up: [t('Up'), t('Upload speed')],
  ping: ['Ping', t('Connection latency')], disk: [t('Disk'), t('Disk activity (read + write)')] };
const STATS = {
  cpu: { n: 'CPU', ic: 'cpu', h: 'cpu', max: 100, val: v => [R(v.cpu), '%'], hot: v => v.cpu > 90 },
  cpuTemp: { n: t('CPU temp.'), ic: 'temp', h: 'cpuTemp', max: 100, val: v => [R(v.cpuTemp), '°C'], hot: v => v.cpuTemp > 88 },
  gpu: { n: 'GPU', ic: 'gpu', h: 'gpu', max: 100, val: v => [R(v.gpu), '%'], hot: v => v.gpu > 95 },
  gpuTemp: { n: t('GPU temp.'), ic: 'temp', h: 'gpuTemp', max: 100, val: v => [R(v.gpuTemp), '°C'], hot: v => v.gpuTemp > 84 },
  /* scales from this PC (32-64 GB of RAM, a 450 W desktop GPU), not from a mid-range laptop */
  gpuPower: { n: SH.tc('widget', 'GPU power'), ic: 'bolt', h: 'gpuPower', max: v => v.gpuPowerLimit || 0, val: v => [R(v.gpuPower), u('W')], hot: () => false },
  ram: { n: 'RAM', ic: 'ram', h: 'ram', max: v => v.ramTotal || 0, val: v => [R(v.ram, SH.fmt1), u('GB')], hot: v => v.ram / v.ramTotal > .9 },
  vram: { n: 'VRAM', ic: 'layers', h: 'vram', max: v => v.vramTotal || 0, val: v => [R(v.vram, SH.fmt1), u('GB')], hot: () => false },
  down: { n: SH.tc('widget', 'Download'), ic: 'download', h: 'down', max: 0, val: v => [R(v.down, SH.fmt1), u('Mb/s')], hot: () => false },
  up: { n: t('Upload'), ic: 'upload', h: 'up', max: 0, val: v => [R(v.up, SH.fmt1), u('Mb/s')], hot: () => false },
  ping: { n: t('Latency'), ic: 'globe', h: 'ping', max: 0, val: v => [R(v.ping), u('ms')], hot: v => v.ping > 80 },
  disk: { n: t('Disk'), ic: 'ssd', h: 'diskRead', max: 0, val: v => [ok(v.diskRead) ? Math.round(v.diskRead + v.diskWrite) : '—', u('MB/s')], hot: () => false },
};
SH.WIDGET_STATS = STATS;
const DEF = { widgetStats: ['cpu', 'gpu', 'gpuTemp', 'ram', 'down', 'ping'], widgetLayout: 'grid', widgetMode: 'full' };
/* window size for the layout and number of stats */
SH.widgetSize = conf => {
  const n = Math.max(1, (conf.widgetStats || DEF.widgetStats).filter(k => STATS[k]).length), L = conf.widgetLayout || 'grid';
  if (conf.widgetMode === 'mini') return { w: 46 + n * 96 + 84, h: 38 };
  if (L === 'row') return { w: Math.min(900, 24 + n * 112 + (n - 1) * 6), h: 132 };
  if (L === 'list') return { w: 300, h: 60 + n * 32 };
  const rows = Math.ceil(n / 2); return { w: 400, h: 58 + rows * 64 + (rows - 1) * 6 };
};
if (!document.getElementById('rows')) return; // the main window only needs widgetSize

let rows = [];
function build(conf) {
  const st = Object.assign({}, DEF, conf);
  const root = document.documentElement;
  if (st.accent) root.style.setProperty('--accent', st.accent);
  if (st.accent2) root.style.setProperty('--accent2', st.accent2);
  if (st.theme) root.dataset.theme = st.theme;
  if (st.intensity) root.style.setProperty('--f', SH.FACT[st.intensity]);
  const keys = st.widgetStats.filter(k => STATS[k]);
  const mini = st.widgetMode === 'mini';
  const w = $('#w'); w.className = 'w pywebview-drag-region ' + (mini ? 'M-mini' : 'L-' + (st.widgetLayout || 'grid'));
  const sb = $('#sizeBtn'); sb.title = mini ? t('Large version') : t('Small version');
  sb.innerHTML = mini ? '<svg class="i" viewBox="0 0 24 24"><path d="M14 4h6v6M10 20H4v-6M20 4l-6 6M4 20l6-6"/></svg>' : '<svg class="i" viewBox="0 0 24 24"><path d="M4 14h6v6M20 10h-6V4M14 10l6-6M10 14l-6 6"/></svg>';
  let dot = $('.dot', w); if (mini && !dot) { dot = document.createElement('span'); dot.className = 'dot pywebview-drag-region'; w.prepend(dot); } else if (!mini && dot) dot.remove();
  const nm = k => NAMES[k] || [STATS[k].n, STATS[k].n];
  $('#rows').innerHTML = keys.map(k => mini
    /* small: the number and its name share a slot; on hover the number slides up and the name appears */
    ? `<div class="c pywebview-drag-region" data-k="${k}" title="${nm(k)[1]}"><span class="n">${ic(STATS[k].ic)}</span><span class="slot"><span class="v">–</span><span class="lab">${nm(k)[0]}</span></span><canvas></canvas></div>`
    : `<div class="c pywebview-drag-region" data-k="${k}" title="${nm(k)[1]}"><span class="n">${ic(STATS[k].ic)}<span>${STATS[k].n}</span></span><span class="v">–</span><canvas></canvas></div>`).join('');
  rows = keys.map(k => { const el = $(`.c[data-k="${k}"]`); const c = $('canvas', el); return { k, s: STATS[k], el, v: $('.v', el), c, ctx: c.getContext('2d') }; });
  rows.forEach((r, i) => anim(r.el, [{ opacity: 0, transform: 'translate3d(0,8px,0) scale(.97)' }, { opacity: 1, transform: 'none' }], { d: 420, delay: 60 + i * 45, e: EASE.spring }));
  paint(SH.tele.v);
  requestAnimationFrame(fit);
  return st;
}
/* fits the content to the window the user sized. Nothing is ever cut: the window has a minimum size where
   everything still fits (squeezed) and a maximum where it still looks good; Windows enforces both while dragging. */
const GAP = 6;
let limitsSent = '';
function chooseGrid(W, H, n) {
  /* the column count that gives the roomiest cells while every stat fits */
  let best = null;
  for (let c = 1; c <= n; c++) {
    const lines = Math.ceil(n / c), cw = (W - (c - 1) * GAP) / c, ch = (H - (lines - 1) * GAP) / lines;
    if (cw < 104 || ch < 34) continue;
    const score = Math.min(cw / 2.4, ch);
    if (!best || score > best.score) best = { c, ch, score };
  }
  return best || { c: Math.min(n, 2), ch: 34 };
}
function fit() {
  const w = $('#w'), box = $('#rows'); if (!rows.length || !box) return;
  rows.forEach(r => { r.el.hidden = false; });
  w.classList.remove('compact', 'tight'); box.style.gridTemplateColumns = ''; box.style.gridAutoRows = '';
  const n = rows.length;
  if (w.classList.contains('M-mini')) {
    /* small bar: the numbers share the width; when it gets narrow they squeeze (less padding and gap) */
    const natural = rows.reduce((a, r) => a + r.el.offsetWidth, 0) + GAP * (n - 1);
    if (box.clientWidth < natural) w.classList.add('tight');
    if (box.scrollWidth > box.clientWidth + 1) { // only if Windows let it get smaller than the minimum
      let used = 0; rows.forEach((r, i) => { used += r.el.offsetWidth + (i ? GAP : 0); if (i && used > box.clientWidth) r.el.hidden = true; });
    }
  } else {
    const W = box.clientWidth, H = box.clientHeight;
    if (w.classList.contains('L-grid')) {
      const g = chooseGrid(W, H, n);
      box.style.gridTemplateColumns = `repeat(${g.c},1fr)`;
      if (g.ch < 54) w.classList.add('compact');
    } else if (w.classList.contains('L-row')) {
      if (H < 96) w.classList.add('compact');
    } else box.style.gridAutoRows = Math.max(26, Math.min(40, Math.floor((H + 2) / n) - 2)) + 'px';
  }
  paint(SH.tele.v);
  sendLimits();
}
/* min and max window size for what is shown (CSS px; sent to Windows in device px) */
function limits() {
  const w = $('#w'), n = Math.max(1, rows.length);
  if (w.classList.contains('M-mini')) {
    const chrome = 12 + 7 + 10 + 12;
    const had = w.classList.contains('tight');
    w.classList.remove('tight'); const natural = rows.reduce((a, r) => a + r.el.offsetWidth, 0);
    w.classList.add('tight'); const tight = rows.reduce((a, r) => a + r.el.offsetWidth, 0);
    if (!had) w.classList.remove('tight');
    return { minW: chrome + tight + GAP * (n - 1) + 2, maxW: chrome + natural + 34 * (n - 1), minH: 38, maxH: 38,
             comfy: chrome + natural + 16 * (n - 1) };
  }
  const pad = 24, head = 58;
  if (w.classList.contains('L-grid')) {
    const c = Math.min(2, n), lines = Math.ceil(n / c);
    return { minW: pad + c * 104 + (c - 1) * GAP, minH: head + lines * 34 + (lines - 1) * GAP,
             maxW: pad + Math.min(n, 3) * 240, maxH: head + n * 110 };
  }
  if (w.classList.contains('L-row')) return { minW: pad + n * 84 + (n - 1) * GAP, minH: head + 44, maxW: pad + n * 210, maxH: head + 130 };
  return { minW: 220, minH: head + n * 28, maxW: 480, maxH: head + n * 42 };
}
SH.widgetLimits = () => limits();
function sendLimits() {
  const L = limits(), d = devicePixelRatio || 1;
  const v = [L.minW, L.minH, L.maxW, L.maxH].map(x => Math.ceil(x * d));
  const key = v.join(','); if (key === limitsSent) return; limitsSent = key;
  SH.call('widget_limits', ...v);
}
new ResizeObserver(() => requestAnimationFrame(fit)).observe(document.getElementById('w'));
function draw(r) {
  if (!r.c.offsetParent) return; // small version: no charts
  const box = r.c.getBoundingClientRect(); const w = Math.max(10, box.width), h = Math.max(10, box.height);
  const d = Math.min(2, devicePixelRatio || 1); if (r.c.width !== Math.round(w * d) || r.c.height !== Math.round(h * d)) { r.c.width = Math.round(w * d); r.c.height = Math.round(h * d); }
  const ctx = r.ctx; ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, w, h);
  const data = SH.tele.hist[r.s.h].slice(-48);
  const fixed = typeof r.s.max === 'function' ? r.s.max(SH.tele.v) : r.s.max;
  /* usage in % is drawn on its 0-100 scale. A quantity with a total (RAM, VRAM, power) sits near the top most of the
     time: drawn from 0 to the total, it was a flat line with everything under it filled, a solid block. It is drawn
     around what it did lately instead (at least 10 % of the total tall, so noise does not look like a spike). */
  let lo = 0, max = fixed || Math.max(1, ...data) * 1.15;
  if (typeof r.s.max === 'function' && fixed) {
    const mn = Math.min(...data), mx = Math.max(...data), span = Math.max(mx - mn, fixed * .1);
    lo = Math.max(0, (mn + mx) / 2 - span * .75); max = lo + span * 1.5;
  }
  const col = getComputedStyle(document.documentElement).getPropertyValue(r.el.classList.contains('hot') ? '--warn' : '--accent2').trim();
  ctx.beginPath(); data.forEach((v, i) => { const x = i / (data.length - 1) * w, y = h - 1.5 - Math.max(0, Math.min(1, (v - lo) / (max - lo))) * (h - 4); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.lineJoin = 'round'; ctx.stroke();
  /* the area fades out toward the bottom: it never reads as a solid block */
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  const gr = ctx.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, col); gr.addColorStop(1, 'transparent');
  ctx.globalAlpha = .22; ctx.fillStyle = gr; ctx.fill(); ctx.globalAlpha = 1;
}
function paint(v) { rows.forEach(r => { const [a, b] = r.s.val(v); r.v.innerHTML = a === '—' ? '—' : `${a}<small>${b}</small>`; r.el.classList.toggle('hot', !!r.s.hot(v)); draw(r); }); }
SH.tele.on(paint);
/* the window fits its content: in the small version the real width is measured (nothing gets cut off) */
function fitWindow(st) {
  requestAnimationFrame(() => {
    paint(SH.tele.v);
    /* a size the user chose by dragging the edges wins over the automatic one (per mode) */
    const saved = st['widgetSize_' + (st.widgetMode === 'mini' ? 'mini' : 'full')];
    const L = limits(), clamp = (x, a, b) => Math.max(a, Math.min(b, x));
    let sz;
    if (st.widgetMode === 'mini') sz = { w: saved ? saved[0] : L.comfy, h: 38 };
    else sz = saved ? { w: saved[0], h: saved[1] } : SH.widgetSize(st);
    limitsSent = ''; sendLimits();
    const W = Math.round(clamp(sz.w, L.minW, L.maxW)), H = Math.round(clamp(sz.h, L.minH, L.maxH));
    SH.call('widget_resize', W, H);
    /* if the window came out smaller than asked (Windows keeps part of the size for its own frame), ask again for the
       difference once: the last row must never be cut off */
    setTimeout(() => {
      const lack = H - innerHeight;
      if (st.widgetMode !== 'mini' && !saved && lack > 3 && lack < 80) SH.call('widget_resize', W, Math.min(L.maxH + lack, H + lack));
    }, 450);
  });
}
/* resize handles: Windows' own resize loop does the dragging */
document.querySelectorAll('.wrz').forEach(h => h.addEventListener('mousedown', e => {
  if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); SH.call('widget_drag_resize', h.dataset.edge);
}));
SH.widgetResized = () => { SH.loadSettings().then(() => paint(SH.tele.v)); };
/* Python calls this when the theme, accent or animation setting changes */
SH.lookChanged = async () => {
  await SH.loadSettings(); const st = state.settings, root = document.documentElement;
  if (st.accent) root.style.setProperty('--accent', st.accent);
  if (st.accent2) root.style.setProperty('--accent2', st.accent2);
  if (st.theme) root.dataset.theme = st.theme;
  if (st.intensity) root.style.setProperty('--f', SH.FACT[st.intensity] / (st.animSpeed || 1));
  paint(SH.tele.v);
};
SH.widgetApply = conf => { const st = build(Object.assign({}, state.settings, conf)); fitWindow(st); };
$('#sizeBtn').addEventListener('click', async () => {
  const next = state.settings.widgetMode === 'mini' ? 'full' : 'mini';
  state.settings.widgetMode = next; await SH.call('widget_mode', next);
  const w = $('#w'); anim(w, [{ opacity: 1 }, { opacity: 0 }], { d: 120 }).finished.then(() => {
    SH.widgetApply({ widgetMode: next }); anim(w, [{ opacity: 0 }, { opacity: 1 }], { d: 260 });
  }).catch(() => {});
});
$('#close').addEventListener('click', () => SH.call('widget_close'));
$('#openMain').addEventListener('click', () => SH.call('show_main'));
(async () => { await SH.loadSettings(); fitWindow(build(state.settings)); })();
})();
