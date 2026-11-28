/* StellarHub · "Mosaic" Home view: one tile per component, in different sizes, each with its own
   illustration and a live stat. Tiles tilt with the mouse and the illustration comes alive on hover. */
'use strict';
(() => {
const { $, $$, Spring, EASE, anim, tickers, esc, fmt1 } = SH;

/* ---------- illustrations ---------- */
/* The blades are NOT inside the card's SVG: an SVG group cannot be composited, so each frame of its turn repaints the whole card.
   Each fan is its own small <svg> laid over the drawing (same place, same scale, see fitGpuArt) with will-change:transform, and a
   Web Animations rotate runs it on the compositor at the display's refresh rate with nothing on the main thread. */
const GPU_FANS = [[100, 68, 40], [222, 68, 40]], GPU_VB = [320, 150];
function fanBlades(r) {
  let b = ''; for (let i = 0; i < 9; i++) b += `<path d="M0 ${-r * .28} C ${r * .3} ${-r * .45} ${r * .5} ${-r * .75} ${r * .25} ${-r * .95} C ${r * .1} ${-r * .7} ${-r * .05} ${-r * .5} 0 ${-r * .28} Z" transform="rotate(${i * 40})"/>`;
  return `${b}<circle class="hub" r="${r * .26}"/>`;
}
const fanRing = (cx, cy, r) => `<circle class="ring" cx="${cx}" cy="${cy}" r="${r + 4}"/>`;
const fanOverlay = ([cx, cy, r]) => { const R = r + 4; /* the box is the ring's, so the 40-radius blades have a little room */
  return `<svg class="gfan" viewBox="${-R} ${-R} ${R * 2} ${R * 2}" aria-hidden="true" style="left:${((cx - R) / GPU_VB[0] * 100).toFixed(3)}%;top:${((cy - R) / GPU_VB[1] * 100).toFixed(3)}%;width:${(R * 2 / GPU_VB[0] * 100).toFixed(3)}%;height:${(R * 2 / GPU_VB[1] * 100).toFixed(3)}%">${fanBlades(r)}</svg>`; };
const ART = {
  gpu: () => `<svg viewBox="0 0 320 150" class="art-gpu">
    <rect class="bracket" x="2" y="16" width="12" height="112" rx="3"/>
    <rect class="body" x="14" y="12" width="296" height="104" rx="14"/>
    <path class="strip" d="M30 14 H294"/>
    ${Array.from({ length: 30 }, (_, i) => `<line class="fin" x1="${40 + i * 8.6}" y1="20" x2="${40 + i * 8.6}" y2="30"/>`).join('')}
    ${GPU_FANS.map(f => fanRing(...f)).join('')}
    <rect class="gold" x="66" y="116" width="150" height="12" rx="2"/>
    ${Array.from({ length: 18 }, (_, i) => `<rect class="pin" x="${70 + i * 8}" y="119" width="4" height="7" rx="1"/>`).join('')}
  </svg>`,
  cpu: () => {
    let pads = ''; for (let i = 0; i < 14; i++) { const p = 30 + i * 10; pads += `<rect class="pad" x="${p}" y="22" width="5" height="5"/><rect class="pad" x="${p}" y="173" width="5" height="5"/><rect class="pad" x="22" y="${p}" width="5" height="5"/><rect class="pad" x="173" y="${p}" width="5" height="5"/>`; }
    let th = ''; for (let i = 0; i < 24; i++) { const big = i < 8; const c = big ? i % 4 : (i - 8) % 4, r = big ? Math.floor(i / 4) : 2 + Math.floor((i - 8) / 4);
      th += `<rect class="th${big ? ' p' : ''}" data-th="${i}" x="${62 + c * 19.5}" y="${big ? 58 + r * 19 : 98 + (r - 2) * 11.5}" width="16" height="${big ? 16 : 9}" rx="2"/>`; }
    return `<svg viewBox="0 0 200 200" class="art-cpu">
      <rect class="sub" x="14" y="14" width="172" height="172" rx="12"/>${pads}
      <rect class="cap" x="36" y="40" width="10" height="5" rx="1"/><rect class="cap" x="154" y="150" width="10" height="5" rx="1"/><rect class="cap" x="36" y="154" width="10" height="5" rx="1"/>
      <rect class="die" x="54" y="50" width="92" height="104" rx="5"/>${th}
      <defs><clipPath id="cpuClip"><rect x="54" y="50" width="92" height="104" rx="5"/></clipPath>
        <linearGradient id="cpuScan" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="var(--accent2)" stop-opacity="0"/><stop offset=".55" stop-color="var(--accent2)" stop-opacity=".34"/><stop offset="1" stop-color="var(--accent2)" stop-opacity="0"/></linearGradient></defs>
      <g clip-path="url(#cpuClip)"><rect class="scan" x="14" y="50" width="40" height="104" fill="url(#cpuScan)"/></g>
    </svg>`;
  },
  ram: () => `<svg viewBox="0 0 200 84" class="art-ram">
    <path class="pcb" d="M6 14 H194 V60 H112 V66 H104 V60 H6 Z"/>
    ${[0, 1, 2, 3].map(i => `<rect class="mchip" x="${16 + i * 44}" y="22" width="34" height="26" rx="2"/><rect class="mglow" style="--d:${i * 110}ms" x="${16 + i * 44}" y="22" width="34" height="26" rx="2"/>`).join('')}
    ${Array.from({ length: 30 }, (_, i) => `<rect class="pin" x="${10 + i * 6.1 + (i > 15 ? 6 : 0)}" y="62" width="3.4" height="10" rx=".8"/>`).join('')}
    <circle class="hole" cx="10" cy="22" r="2.6"/>
  </svg>`,
  ssd: () => `<svg viewBox="0 0 200 60" class="art-ssd">
    <path class="pcb" d="M4 16 H182 A12 12 0 0 1 182 44 H4 V34 H8 V26 H4 Z"/>
    ${[[18, 21, 30, 18], [56, 20, 44, 20], [108, 20, 44, 20]].map(([x, y, w, h], i) => `<rect class="mchip" x="${x}" y="${y}" width="${w}" height="${h}" rx="2"/><rect class="mglow" style="--d:${i * 130}ms" x="${x}" y="${y}" width="${w}" height="${h}" rx="2"/>`).join('')}
    <circle class="led" cx="164" cy="30" r="3"/><circle class="hole" cx="186" cy="30" r="4"/>
  </svg>`,
  dsp: () => `<svg viewBox="0 0 280 120" class="art-dsp">
    <rect class="frame" x="8" y="6" width="164" height="104" rx="8"/><rect class="screen" x="15" y="13" width="150" height="90" rx="4"/><rect class="scrglow" x="15" y="13" width="150" height="90" rx="4"/>
    <rect class="sweep" x="15" y="13" width="40" height="90"/>
    <text x="90" y="62" text-anchor="middle">2560 × 1600</text>
    <rect class="frame" x="186" y="24" width="88" height="56" rx="5"/><rect class="screen" x="191" y="29" width="78" height="46" rx="3"/><rect class="scrglow s2" x="191" y="29" width="78" height="46" rx="3"/>
    <path class="stand" d="M230 80 V94 M214 96 H246"/>
    <text x="230" y="56" text-anchor="middle" class="sm">1920 × 1080</text>
  </svg>`,
  /* a handheld: the screen between two grips, with its sticks and buttons (same classes as the display drawing) */
  dspHandheld: () => `<svg viewBox="0 0 280 120" class="art-dsp art-dsp-hh">
    <path class="frame" d="M62 16 H218 C236 16 244 22 246 36 C250 58 252 80 246 96 C241 108 226 110 216 102 C208 95 202 90 190 90 H90 C78 90 72 95 64 102 C54 110 39 108 34 96 C28 80 30 58 34 36 C36 22 44 16 62 16 Z"/>
    <rect class="screen" x="88" y="22" width="104" height="62" rx="4"/><rect class="scrglow" x="88" y="22" width="104" height="62" rx="4"/>
    <rect class="sweep" x="88" y="22" width="30" height="62"/>
    <text x="140" y="57" text-anchor="middle" class="sm">1920 × 1080</text>
    <g style="fill:none;stroke:var(--accent2);stroke-opacity:.55;stroke-width:1.5">
      <circle cx="62" cy="42" r="10"/><circle cx="216" cy="70" r="10"/>
      <path d="M58 64 h7 v-7 h6 v7 h7 v6 h-7 v7 h-6 v-7 h-7 Z"/>
    </g>
    <g style="fill:var(--accent2);fill-opacity:.5"><circle cx="216" cy="33" r="3.2"/><circle cx="216" cy="51" r="3.2"/><circle cx="207" cy="42" r="3.2"/><circle cx="225" cy="42" r="3.2" style="fill:var(--accent);fill-opacity:.85"/></g>
  </svg>`,
  bat: () => `<svg viewBox="0 0 130 64" class="art-bat">
    <rect class="body" x="4" y="8" width="108" height="48" rx="10"/><rect class="term" x="114" y="22" width="9" height="20" rx="3"/>
    <rect class="fill" x="11" y="15" width="94" height="34" rx="5"/>
    <path class="bolt" d="M62 18 L50 34 H60 L56 47 L70 29 H60 Z"/>
  </svg>`,
  wif: () => `<svg viewBox="0 0 100 74" class="art-wif">
    <path class="arc a3" d="M8 30 A58 58 0 0 1 92 30"/><path class="arc a2" d="M22 44 A38 38 0 0 1 78 44"/><path class="arc a1" d="M36 57 A19 19 0 0 1 64 57"/><circle class="dotw" cx="50" cy="66" r="4.5"/>
  </svg>`,
  /* a wired connection (Ethernet): an RJ45 port with its pins, in the same strokes as the Wi-Fi arcs */
  eth: () => `<svg viewBox="0 0 100 74" class="art-wif art-eth">
    <path class="arc a3" d="M14 8 H86 V48 H70 V62 H30 V48 H14 Z"/><path class="arc a2" d="M26 20 H74 V40 H26 Z" style="opacity:.2"/>
    ${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<rect class="dotw" x="${30 + i * 5.6}" y="20" width="3" height="14" rx="1.2"/>`).join('')}
  </svg>`,
  aud: () => `<svg viewBox="0 0 110 70" class="art-aud">
    ${[18, 34, 46, 28, 40, 22, 30].map((h, i) => `<rect class="eq" style="--d:${i * 70}ms" x="${8 + i * 14}" y="${62 - h}" width="8" height="${h}" rx="3"/>`).join('')}
  </svg>`,
  sys: () => `<svg viewBox="0 0 100 80" class="art-sys">
    <path class="lay l3" d="M50 46 L90 60 L50 74 L10 60 Z"/><path class="lay l2" d="M50 30 L90 44 L50 58 L10 44 Z"/><path class="lay l1" d="M50 14 L90 28 L50 42 L10 28 Z"/>
  </svg>`,
};

/* ---------- tiles ---------- */
/* order and size: GPU and CPU large (2×2); displays wide (2×1); the rest 1×1. Only the ones this PC has. */
const TILES = [
  { area: 'gpu', comp: 'gpu', kind: 'hero', big: true },
  { area: 'cpu', comp: 'cpu', kind: 'chip', big: true },
  { area: 'ram', comp: 'ram', kind: 'plain' },
  { area: 'ssd', comp: 'ssd', kind: 'plain' },
  { area: 'dsp', comp: 'display', kind: 'open', wide: true },
  { area: 'bat', comp: 'battery', kind: 'plain' },
  { area: 'wif', comp: 'wifi', kind: 'deep' },
  { area: 'aud', comp: 'audio', kind: 'deep' },
  { area: 'sys', comp: 'sys', kind: 'plain' },
];
const dash = '<span class="na">—</span>';
const nil = x => x == null || Number.isNaN(x);
const comp = id => SH.PC.components.find(x => x.id === id);
/* "a and b" / "a, b and c" in the interface language */
const andList = a => a.length < 2 ? a.join('') : SH.t('{a} and {b}', { a: a.slice(0, -1).join(', '), b: a[a.length - 1] });
const rowv = (id, label) => ((comp(id) || {}).rows || []).find(r => r[0] === label)?.[1] || '';
/* short titles built from the real data (the full one stays in the tooltip) */
function shortTitle(t, c) {
  const title = c.title || '';
  switch (t.area) {
    case 'ram': return title;
    case 'ssd': { const tb = SH.unit('TB'); const w = title.split(/\s+/).filter(x => !/[-_]/.test(x) && !/^\d+(?:[.,]\d+)?$/.test(x) && x !== tb && x.toUpperCase() !== 'PC'); const cap = (title.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${tb}`)) || [])[0]; return [w.slice(0, 2).join(' '), cap].filter(Boolean).join(', '); }
    case 'dsp': { const m = c.monitors || []; if (m.length > 1) return SH.t('{n} displays', { n: m.length }); if (!m[0]) return title;
      const lap = SH.PC.type === 'laptop'; /* a handheld, tablet or all-in-one has a built-in screen, not a laptop's */
      return m[0].inches ? (m[0].internal ? (lap ? SH.t('{n}" laptop screen', { n: m[0].inches }) : SH.t('{n}" built-in screen', { n: m[0].inches })) : SH.t('{n}" external', { n: m[0].inches })) : (m[0].internal ? (lap ? SH.t('laptop screen') : SH.t('built-in screen')) : SH.t('external')); }
    case 'bat': return SH.PC.real ? title : title.split(/[,，]/)[0]; // the sample title adds the health after a comma
    case 'wif': return /6E/i.test(title) ? 'Wi-Fi 6E' : /wi-?fi ?7|BE\d/i.test(title) ? 'Wi-Fi 7' : /wi-?fi ?6|AX\d/i.test(title) ? 'Wi-Fi 6' : /wi-?fi|wireless|802\.11/i.test(title) ? 'Wi-Fi' : /ethernet|gbe|lan/i.test(title) ? 'Ethernet' : title.split(/\s+/).slice(0, 2).join(' ');
    case 'aud': return title.replace(/\(R\)|\(TM\)/g, '').replace(/High Definition Audio/i, 'HD Audio').replace(/Dispositivo de audio|USB Audio Device/i, 'Audio').trim();
    case 'sys': return (SH.PC.os || title).replace(/\s+\d{2}H\d$/, '');
    case 'gpu': return title.replace(/\s+GPU$/i, '').replace(/^NVIDIA GeForce /i, 'GeForce ').replace(/\(R\)|\(TM\)/g, '');
    default: return title.replace(/\(R\)|\(TM\)/g, '');
  }
}
/* 4-column grid with no gaps: large tiles on top (2 rows), the rest in rows of 4 cells;
   if the last row comes up short, its last tile stretches to the end */
function layout(list) {
  const big = list.filter(t => t.big), small = list.filter(t => !t.big);
  const rows = [], rowH = [];
  if (big.length === 2) { rows.push(['gpu', 'gpu', 'cpu', 'cpu'], ['gpu', 'gpu', 'cpu', 'cpu']); rowH.push('1fr', '1fr'); }
  else if (big.length === 1) {
    const B = big[0].area, side = small.filter(t => !t.wide).splice(0, 4);
    side.forEach(t => small.splice(small.indexOf(t), 1));
    const sa = side.map(t => t.area); while (sa.length < 4) sa.push(sa[sa.length - 1] || B);
    rows.push([B, B, sa[0], sa[1]], [B, B, sa[2], sa[3]]); rowH.push('1fr', '1fr');
  }
  let cur = [];
  const flush = () => { if (!cur.length) return; while (cur.length < 4) cur.push(cur[cur.length - 1]); rows.push(cur); rowH.push('.82fr'); cur = []; };
  small.forEach(t => {
    const need = t.wide ? 2 : 1;
    if (cur.length + need > 4) flush();
    for (let i = 0; i < need; i++) cur.push(t.area);
  });
  flush();
  return { areas: rows.map(r => `"${r.join(' ')}"`).join(' '), rows: rowH.join(' ') };
}
function liveHTML(area) {
  switch (area) {
    case 'gpu': return `<div class="nums"><div><b class="n" data-l="gpu">–</b><small>${SH.t('% usage')}</small></div><div><b data-l="gtemp">–</b><small>°C</small></div><div><b data-l="gpow">–</b><small>${SH.unit('W')}</small></div></div>
      <div class="lbar"><span>${SH.t('Video memory')}</span><em data-l="vram">–</em></div><div class="bar"><span data-b="vram"></span></div>`;
    case 'cpu': return `<div class="nums"><div><b class="n" data-l="cpu">–</b><small>${SH.t('% usage')}</small></div><div><b data-l="freq">–</b><small>${SH.unit('GHz')}</small></div><div><b data-l="ctemp">–</b><small>°C</small></div></div>`;
    case 'ram': return `<div class="lbar"><span>${SH.t('{used} of {total} GB', { used: '<b data-l="ram">–</b>', total: '<span data-l="ramt">–</span>' })}</span></div><div class="bar"><span data-b="ram"></span></div>`;
    case 'ssd': return `<div class="lbar"><span>${SH.t('{n} GB free', { n: '<b data-l="free">–</b>' })}</span></div><div class="bar acc"><span data-b="disk"></span></div>`;
    case 'dsp': if (SH.PC.type === 'handheld') return `<div class="lbar"><span>${SH.t('Controller built in')}</span></div>`;
      return `<div class="lbar"><span data-l="dsp">${esc(andList(((comp('display') || {}).rows || []).map(r => r[1])) || '—')}</span></div>`;
    case 'bat': return `<div class="lbar"><span>${SH.t('Health {n}', { n: '<b data-l="bath">–</b>' })}</span></div>`;
    case 'wif': return `<div class="lbar"><span><b data-l="down">–</b> ${SH.unit('Mb/s')}</span></div>`;
    case 'aud': { const n = 1 + (rowv('audio', 'Others').split(',').filter(x => x.trim() && x.trim() !== '–').length); return `<div class="lbar"><span>${n > 1 ? SH.t('{n} devices', { n }) : SH.t('{n} device', { n })}</span></div>`; }
    case 'sys': return `<div class="lbar"><span>${SH.t('Up {time}', { time: '<b data-l="up">–</b>' })}</span></div>`;
  }
  return '';
}
const uptime = s => SH.fmtUptime(s);  /* the same "8 days 11 h" as Home and Live Monitor, in the interface language */

let root = null, tick = null, offs = [], tiles = [], barEl = {};
const gfan = { sp: new Spring(0, 30, 10), boost: new Spring(0, 60, 14), els: [], on: false, rate: 0, ang: 0, ro: null };
/* Fits the wrapper around the GPU drawing to the exact box the SVG's viewBox takes inside the tile (the art is "contain"-fitted
   and centred), so the fan overlays, positioned in percent of it, stay on the fan positions at any window size. */
function fitGpuArt() {
  const box = root && $('.artbox', root); if (!box) return; const a = box.parentElement; const w = a.clientWidth, h = a.clientHeight; if (!w || !h) return;
  const k = Math.min(w / GPU_VB[0], h / GPU_VB[1]); box.style.width = (GPU_VB[0] * k).toFixed(2) + 'px'; box.style.height = (GPU_VB[1] * k).toFixed(2) + 'px';
}
/* the fans turn at `rate` turns per second. The loop turns them (each on its own layer: will-change), at the loop's pace: an
   infinite animation ran at the screen's refresh rate (134 Hz) and repainted the drawing every frame, Home idle or not */
function fansRun(on, rate) { gfan.on = on && gfan.els.length > 0; gfan.rate = on ? rate : 0; }
function fansTurn(dt) {
  if (!gfan.on) return;
  gfan.ang = (gfan.ang + gfan.rate * 360 * dt) % 360; const tr = `rotate(${gfan.ang.toFixed(2)}deg)`;
  for (const f of gfan.els) f.style.transform = tr;
}
const fansOn = () => !!root && !document.hidden && (SH.state.view === 'home' || SH.homeAnimating);
const bars = { vram: new Spring(0, 60, 14), ram: new Spring(0, 60, 14), disk: new Spring(0, 60, 14) };

function mount(el, ctx) {
  root = document.createElement('div'); root.className = 'hv-bento'; el.appendChild(root);
  const list = TILES.filter(t => comp(t.comp));
  const L = layout(list); root.style.gridTemplateAreas = L.areas; root.style.gridTemplateRows = L.rows;
  root.innerHTML = list.map(t => {
    const c = comp(t.comp);
    return `<div class="bt k-${t.kind} a-${t.area}" style="grid-area:${t.area}" data-comp="${t.comp}" tabindex="0" role="button" aria-label="${esc(c.name)}: ${esc(c.title)}">
      <div class="tilt"><div class="glow"></div><div class="art">${t.area === 'gpu' ? `<div class="artbox">${ART.gpu()}${GPU_FANS.map(fanOverlay).join('')}</div>` : (t.area === 'wif' && /ethernet|gbe|lan/i.test(c.title + ' ' + rowv('wifi', 'Type')) && !/wi-?fi|wireless|802\.11/i.test(c.title) ? ART.eth : t.area === 'dsp' && SH.PC.type === 'handheld' ? ART.dspHandheld : ART[t.area])()}</div>
      <div class="meta"><span class="k">${esc(c.name)}</span><b class="t" title="${esc(c.title)}">${esc(shortTitle(t, c))}</b><div class="live">${liveHTML(t.area)}</div></div></div></div>`;
  }).join('');
  /* the display drawing with the real resolutions */
  if (SH.engine) SH.engine('system', 'displays').then(ds => {
    if (!ds || !root) return; const tx = $$('.art-dsp text', root); const sorted = ds.slice().sort((x, y) => y.w * y.h - x.w * x.h);
    tx.forEach((e, i) => { e.textContent = sorted[i] ? `${sorted[i].w} × ${sorted[i].h}` : ''; });
    if (ds.length < 2) $$('.art-dsp .frame, .art-dsp .screen, .art-dsp .stand', root).slice(2).concat($$('.art-dsp .s2', root)).forEach(e => { e.style.display = 'none'; });
  }).catch(() => {});
  tiles = $$('.bt', root).map(b => ({ b, tilt: $('.tilt', b), rx: new Spring(0, 170, 18), ry: new Spring(0, 170, 18), lift: new Spring(0, 200, 20) }));
  tiles.forEach(t => {
    t.b.addEventListener('pointermove', e => {
      if (SH.effInt() === 'min') return;
      const r = t.b.getBoundingClientRect(); const nx = (e.clientX - r.left) / r.width * 2 - 1, ny = (e.clientY - r.top) / r.height * 2 - 1;
      const big = r.width > 260 ? .6 : 1;
      t.rx.t = -ny * 7 * big; t.ry.t = nx * 9 * big; t.lift.t = 1;
      t.b.style.setProperty('--mx', ((nx + 1) * 50).toFixed(1) + '%'); t.b.style.setProperty('--my', ((ny + 1) * 50).toFixed(1) + '%');
    });
    t.b.addEventListener('pointerenter', () => { t.b.classList.add('hot'); if (t.b.dataset.comp === 'gpu') gfan.boost.t = 1; });
    t.b.addEventListener('pointerleave', () => { t.b.classList.remove('hot'); t.rx.t = 0; t.ry.t = 0; t.lift.t = 0; if (t.b.dataset.comp === 'gpu') gfan.boost.t = 0; });
    t.b.addEventListener('click', () => ctx.openComponent(t.b.dataset.comp, t.b));
    t.b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.openComponent(t.b.dataset.comp); } });
    t.b.addEventListener('pointerdown', () => anim(t.b, [{ transform: 'scale(1)' }, { transform: 'scale(.97)', offset: .4 }, { transform: 'scale(1)' }], { d: 320, e: EASE.out }));
  });
  offs.push(SH.tele.on(read)); read();
  barEl = {};
  gfan.els = $$('.gfan', root); gfan.on = false; gfan.rate = 0;
  /* the observer reports the first size after the first layout and every change after it, so the fit never forces a layout of its own
     (the window resize listener did: 45 ms inside the resize event at start); without ResizeObserver the old way */
  const art = $('.a-gpu .art', root);
  if (art && window.ResizeObserver) { gfan.ro = new ResizeObserver(fitGpuArt); gfan.ro.observe(art); }
  else { fitGpuArt(); addEventListener('resize', fitGpuArt); }
  document.addEventListener('visibilitychange', onVis);
  tick = dt => {
    if (!fansOn()) { fansRun(false); if (!root || (SH.state.view !== 'home' && !SH.homeAnimating)) return; }
    else {
      /* turns per second, from the fan telemetry (or the GPU load) plus the hover boost. The compositor does the rotating; this
         only nudges the playback rate while the speed is changing. Lighter effects: slower, still smooth, and parked after 45 s idle. */
      const still = SH.effInt() === 'min', lite = SH.state.lite;
      const fv = SH.tele.v.fanGpu, gu = SH.tele.v.gpu; gfan.sp.t = still ? 0 : !nil(fv) ? fv / 100 * 1.1 : .15 + (gu || 0) / 100 * .9; gfan.sp.step(dt); gfan.boost.step(dt);
      const rps = (gfan.sp.v + gfan.boost.v * 1.6) * (lite ? .5 : 1);
      fansRun(!still && rps > .01 && !(lite && SH.idleFor() >= 45000), rps); fansTurn(dt);
    }
    for (const k in bars) { const b = bars[k]; if (b.idle && b.drawn) continue; b.step(dt); if (Math.abs(b.v - b.t) < .002 && Math.abs(b.vel) < .06) b.set(b.t); const e = barEl[k] || (barEl[k] = $(`[data-b="${k}"]`, root)); if (e) e.style.transform = `scaleX(${Math.max(0, b.v).toFixed(4)})`; b.drawn = true; }
    for (const t of tiles) {
      t.rx.step(dt); t.ry.step(dt); t.lift.step(dt);
      if (Math.abs(t.rx.v) + Math.abs(t.ry.v) + t.lift.v > .002 || !t.rest) {
        t.tilt.style.transform = `rotateX(${t.rx.v.toFixed(3)}deg) rotateY(${t.ry.v.toFixed(3)}deg) translateZ(${(t.lift.v * 14).toFixed(2)}px)`;
        t.rest = Math.abs(t.rx.v) + Math.abs(t.ry.v) + t.lift.v <= .002;
      }
    }
  };
  tickers.add(tick);
  if (ctx.intro) intro(false);
}
function read() {
  if (!root || (SH.state.view !== 'home' && !SH.homeAnimating)) return; const v = SH.tele.v;
  /* null = Windows does not provide this stat: "—", never 0 */
  const set = (k, x, f = Math.round) => { const e = $(`[data-l="${k}"]`, root); if (!e) return; const t = nil(x) ? '—' : f(x); if (e.textContent !== String(t)) e.textContent = t; e.classList.toggle('na', nil(x)); };
  set('gpu', v.gpu); set('gtemp', v.gpuTemp); set('gpow', v.gpuPower);
  const ve = $('[data-l="vram"]', root); if (ve) ve.textContent = nil(v.vram) ? '—' : SH.t('{used} of {total} GB', { used: fmt1(v.vram), total: v.vramTotal || '–' });
  set('cpu', v.cpu); set('freq', v.cpuFreq, fmt1); set('ctemp', v.cpuTemp);
  const ct = $('[data-l="ctemp"]', root); if (ct) ct.parentElement.title = nil(v.cpuTemp) ? SH.t('Windows does not report the processor temperature on this PC. Open LibreHardwareMonitor, HWiNFO (with shared memory on) or Core Temp and StellarHub will read it from there.') : v.cpuTempSrc && v.cpuTempSrc !== 'acpi' ? SH.t('from {app}', { app: v.cpuTempSrc }) : '';
  set('ram', v.ram, fmt1); set('ramt', v.ramTotal, x => Math.round(x)); set('free', nil(v.diskTotal) ? null : v.diskTotal - v.diskUsed);
  set('down', v.down, fmt1); set('up', v.uptime, uptime); set('bat', v.battery); set('bath', nil(v.batteryHealth) ? null : v.batteryHealth, x => x + ' %');
  /* a move under 1 % of the bar is invisible and would keep its spring (and a repaint every frame) running for a second */
  const aim = (b, x) => { if (Math.abs(b.t - x) > .01) b.t = x; };
  aim(bars.vram, (v.vram || 0) / (v.vramTotal || 8)); aim(bars.ram, (v.ram || 0) / (v.ramTotal || 1)); aim(bars.disk, (v.diskUsed || 0) / (v.diskTotal || 1));
  /* The thread cells are a quiet heat map of the real load per thread: ice when idle, warming to coral when busy, easing between
     samples (CSS transition). They are SVG, so a cell is only written when its load, rounded to 10 steps, changes: a calm CPU leaves
     Home with nothing to repaint between samples. Nothing pulses. */
  const th = v.threads || [];
  $$('.th', root).forEach((e, i) => { const q = Math.round(Math.min(1, Math.max(0, th[i] || 0)) * 10); if (e._q === q) return; e._q = q;
    e.style.opacity = (.28 + .66 * q / 10).toFixed(3); e.style.fill = `color-mix(in oklab, var(--accent) ${q * 10}%, var(--accent2))`; });
}
function intro(quick) {
  if (!root) return;
  tiles.forEach((t, i) => anim(t.b, [
    { opacity: 0, transform: `perspective(1000px) translate3d(0,${quick ? 10 : 26}px,${quick ? -60 : -220}px) rotateX(${quick ? 4 : 16}deg)`, filter: 'blur(10px)' },
    { opacity: 1, transform: 'perspective(1000px) translate3d(0,0,0) rotateX(0deg)', filter: 'blur(0px)' }
  ], { d: quick ? 520 : 820, delay: (quick ? 40 : 260) + i * (quick ? 30 : 70), e: EASE.spring }));
  if (!quick) {
    for (const k in bars) { bars[k].set(0); bars[k].drawn = false; }
    const fill = $('.art-bat .fill', root); if (fill) anim(fill, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(.97)' }], { d: 1400, delay: 900, e: EASE.out });
    gfan.sp.set(0);
  }
}
function onVis() { if (document.hidden) fansRun(false); }
function unmount() {
  if (tick) tickers.delete(tick); tick = null; offs.forEach(f => f()); offs = []; tiles = [];
  gfan.els = []; gfan.on = false; if (gfan.ro) gfan.ro.disconnect(); gfan.ro = null;
  removeEventListener('resize', fitGpuArt); document.removeEventListener('visibilitychange', onVis); root = null; barEl = {};
}

SH.homeVariant({
  id: 'bento', name: SH.t('Mosaic'), short: SH.t('Mosaic'),
  desc: SH.t('One tile per component, with its live stat.'),
  mount, unmount, resize() {}, onReturn() { intro(true); read(); },
});
})();
