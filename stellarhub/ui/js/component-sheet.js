/* StellarHub · component pop-up card, with real data (SH.PC + telemetry + engine).
   It grows out of the clicked tile (FLIP) and shrinks back into it on close. SH.openComponent(id, optionalOrigin) */
'use strict';
(() => {
const { $, $$, anim, EASE, ic, esc, fmt1, fmtInt, tickers, state } = SH;
const T = SH.tele, v = () => T.v, dash = '—';
const f = (k, fn = x => Math.round(x), suf = '') => T.has(k) ? fn(T.v[k]) + suf : dash;
const comp = id => SH.PC.components.find(x => x.id === id) || { name: id, title: '', rows: [] };
const upt = s => SH.fmtUptime(s);
const t = SH.t, u = SH.unit;
const CFG = {
  cpu: { big: () => [f('cpu'), t('% usage')], chart: { key: 'cpu', max: 100, label: t('Usage over the last minute') },
    stats: () => [[t('Frequency'), f('cpuFreq', fmt1, ' ' + u('GHz'))], [t('Temperature'), T.has('cpuTemp') ? f('cpuTemp', undefined, ' °C') : t('not reported'),
      T.has('cpuTemp') ? (T.v.cpuTempSrc && T.v.cpuTempSrc !== 'acpi' ? t('from {app}', { app: T.v.cpuTempSrc }) : '') : t('Windows does not report the processor temperature on this PC. Open LibreHardwareMonitor, HWiNFO (with shared memory on) or Core Temp and StellarHub will read it from there.')],
      [t('Processes'), f('procs', fmtInt)], [t('Busy threads'), t('{n} of {total}', { n: (v().threads || []).filter(x => x > .5).length, total: (v().threads || []).length })]],
    actions: [[t('View in Live Monitor'), 'monitor', 'cpu', 'monitor'], [t('What is using it'), 'monitor', 'processes', 'list']] },
  gpu: { big: () => [f('gpu'), t('% usage')], chart: { key: 'gpu', max: 100, label: t('Usage over the last minute') },
    stats: () => [[t('Temperature'), f('gpuTemp', undefined, ' °C')], [t('Power draw'), f('gpuPower', undefined, ' ' + u('W'))], [t('Video memory'), T.has('vram') ? t('{used} of {total} GB', { used: fmt1(v().vram), total: v().vramTotal || '–' }) : dash], [t('Clock'), f('gpuClock', fmt1, ' ' + u('GHz'))]],
    actions: [[t('Check for a new driver'), 'drivers', 'updates', 'drivers'], [t('View in Live Monitor'), 'monitor', 'gpu', 'monitor']] },
  ram: { big: () => [f('ram', fmt1), t('of {n} GB in use', { n: Math.round(v().ramTotal || 0) })], chart: { key: 'ram', max: () => v().ramTotal || 16, label: t('Usage over the last minute') },
    stats: () => [[t('In use'), T.has('ram') ? Math.round(v().ram / (v().ramTotal || 1) * 100) + '%' : dash], [t('Committed'), f('ramCommit', fmt1, ' ' + u('GB'))], [t('Cached'), f('ramCache', fmt1, ' ' + u('GB'))],
      [t('Slots'), comp('ram').slots ? t('{n} of {total} used', { n: comp('ram').modules, total: comp('ram').slots }) : dash]],
    actions: [[t('What is using the memory'), 'monitor', 'processes', 'list'], [t('View in Live Monitor'), 'monitor', 'memory', 'monitor']] },
  ssd: { big: () => [T.has('diskTotal') ? Math.round(v().diskTotal - v().diskUsed) : dash, t('GB free of {n} on C:', { n: v().diskTotal || '–' })], chart: { key: 'diskRead', label: t('Reads over the last minute (MB/s)') },
    stats: () => [[t('Used'), T.has('diskUsed') ? Math.round(v().diskUsed / v().diskTotal * 100) + '%' : dash], [t('Read'), f('diskRead', fmtInt, ' ' + u('MB/s'))], [t('Write'), f('diskWrite', fmtInt, ' ' + u('MB/s'))], [t('Activity'), T.has('diskRead') ? (v().diskRead + v().diskWrite > 50 ? t('high') : t('low')) : dash]],
    actions: [[t('See what takes up space'), 'storage', 'map', 'storage'], [t('Free up space'), 'optimizer', 'clean', 'broom']] },
  display: { wide: true, actions: [[t('Test the screen'), 'tester', 'screen', 'display'], [t('View graphics'), 'monitor', 'gpu', 'monitor']] },
  /* the battery changes all the time: title and status come from live telemetry, not from the cached PC info */
  battery: { title: () => T.has('battery') ? (v().charging ? t('{pct}%, charging', { pct: Math.round(v().battery) }) : `${Math.round(v().battery)}%`) : null,
    liveRows: () => [['Status', v().charging ? SH.tc('battery', 'Plugged in') : SH.tc('battery', 'On battery')]],
    big: () => [f('battery'), v().charging ? t('% and charging') : t('% charge')],
    stats: () => [[t('Health'), f('batteryHealth', undefined, '%')], [t('Power'), T.has('batteryPower') ? (v().batteryPower > 0 ? '+' : '') + fmt1(v().batteryPower) + ' ' + u('W') : dash],
      [t('Time left'), T.has('batterySecs') ? upt(v().batterySecs) : (v().charging ? t('plugged in') : dash)], [t('Status'), v().charging ? SH.tc('battery', 'Plugged in') : SH.tc('battery', 'On battery')]],
    meter: () => ({ label: t('Capacity it keeps'), v: (v().batteryHealth || 0) / 100 }),
    actions: [[t('View the battery'), 'monitor', 'battery', 'battery']] },
  wifi: { big: () => [f('down', fmt1), t('Mb/s down')], chart: { key: 'down', label: t('Download over the last minute') },
    stats: () => [[t('Upload'), f('up', fmt1, ' ' + u('Mb/s'))], [t('Latency'), f('ping', undefined, ' ' + u('ms'))], [t('Wi-Fi signal'), f('wifiSignal', undefined, '%')], [t('Link'), SH.localizeUnits((comp('wifi').rows.find(r => r[0] === 'Link') || [, dash])[1])]],
    actions: [[t('View the network'), 'monitor', 'network', 'monitor']] },
  audio: { big: () => [String(1 + ((comp('audio').rows[0] || [, ''])[1].split(',').filter(x => x.trim() && x.trim() !== '–').length)), t('audio devices')],
    list: () => [comp('audio').title, ...((comp('audio').rows[0] || [, ''])[1].split(',').map(s => s.trim()).filter(s => s && s !== '–'))].map(n => ['speaker', n, '']),
    actions: [[t('Test the speakers'), 'tester', 'speakers', 'speaker'], [t('Test the microphone'), 'tester', 'mic', 'mic']] },
  sys: { big: () => [(SH.PC.os || '').replace(/^Windows \d+ \w+ ?/, '') || SH.PC.os, SH.PC.os],
    stats: () => [[t('Build'), (comp('sys').rows.find(r => r[0] === 'Build') || [, dash])[1]], ['BIOS', SH.PC.bios || dash], [t('Uptime'), T.has('uptime') ? upt(v().uptime) : dash], [t('Type'), SH.PC.typeName || dash]],
    actions: [[t('Check for updates'), 'updater', 'windows', 'windows'], [t('Repair Windows'), 'optimizer', 'repair', 'wrench']] },
};
const ICON = { sys: 'windows', wifi: 'wifi', ssd: 'ssd' };

const root = document.createElement('div'); root.className = 'cs-o'; root.innerHTML = '<div class="cs-scrim"></div><div class="cs" role="dialog" aria-modal="true"></div>';
document.body.appendChild(root);
const sheet = $('.cs', root), scrim = $('.cs-scrim', root);
let open = null, origin = null, chart = null, lastTick = performance.now(), thumbTimer = null;
let lastPointer = null; addEventListener('pointerdown', e => { lastPointer = e.target; }, true);

/* ---------- displays: a drawing of each one showing what it displays right now ---------- */
async function displaysHTML() {
  const mons = (comp('display').monitors || []);
  let disp = []; try { disp = await SH.engine('system', 'displays') || []; } catch { disp = []; }
  if (!disp.length) disp = mons.map((m, i) => ({ w: i ? 1920 : 2560, h: i ? 1080 : 1600, hz: 0, primary: !i }));
  /* matching: the internal one is usually the 16:10 or the non-primary one; otherwise, by order */
  const internalIdx = disp.findIndex(d => Math.abs(d.w / d.h - 1.6) < .02);
  const named = disp.map((d, i) => { const m = (i === internalIdx ? mons.find(x => x.internal) : mons.filter(x => !x.internal)[i > internalIdx && internalIdx >= 0 ? i - 1 : i]) || mons[i] || {}; return { ...d, ...m, idx: i }; });
  const maxW = Math.max(...named.map(d => d.w));
  return `<div class="cs-screens">${named.map(d => {
    const scale = .55 + .45 * d.w / maxW; const name = [d.vendor, d.name || d.code].filter(Boolean).join(' ') || (d.internal ? t('Laptop screen') : t('Monitor'));
    return `<figure class="cs-scr${d.internal ? ' internal' : ''}" style="--s:${scale};--ar:${d.w}/${d.h}" data-idx="${d.idx}">
      <div class="frame"><img alt="" data-thumb="${d.idx}"><span class="live">${t('live')}</span></div>${d.internal ? '<div class="base"></div>' : '<div class="stand"></div>'}
      <figcaption><b>${esc(d.internal ? t('Laptop screen') : t('External monitor'))}</b><span>${esc(name)}${d.inches ? `, ${d.inches}"` : ''}</span>
      <span>${[`${d.w} × ${d.h}`, d.hz ? `${d.hz} ${u('Hz')}` : '', d.primary ? t('primary') : ''].filter(Boolean).join(', ')}</span></figcaption></figure>`;
  }).join('')}</div>`;
}
async function refreshThumbs() {
  if (open !== 'display') return;
  const imgs = $$('img[data-thumb]', sheet);
  for (const img of imgs) { const u = await SH.call('screen_thumb', +img.dataset.thumb, 520); if (u && open === 'display') { img.src = u; img.classList.add('on'); } }
  if (open === 'display') thumbTimer = setTimeout(refreshThumbs, 700);
}

async function html(id) {
  const c = comp(id), k = CFG[id] || {};
  const [bv, bl] = k.big ? k.big() : ['', ''];
  const rows = c.rows || [];
  const left = k.wide ? await displaysHTML() : `
        <div class="cs-big"><b id="csBig">${bv}</b><span>${esc(bl)}</span></div>
        ${k.stats ? `<div class="cs-stats">${k.stats().map(([a, b, hint]) => `<div><span>${a}</span><b${hint ? ` title="${esc(hint)}"` : ''}>${b}</b></div>`).join('')}</div>` : ''}
        ${k.chart ? `<div class="cs-chart"><span>${k.chart.label}</span><canvas></canvas></div>` : ''}
        ${k.meter ? `<div class="cs-meter"><div><span>${k.meter().label}</span><b>${T.has('batteryHealth') ? Math.round(k.meter().v * 100) + ' %' : dash}</b></div><div class="bar ok"><span style="transform:scaleX(0)"></span></div></div>` : ''}
        ${k.list ? `<div class="cs-list">${k.list().map(([i, a, b]) => `<div><span class="ri">${ic(i)}</span><span><b>${esc(a)}</b>${b ? `<small>${esc(b)}</small>` : ''}</span></div>`).join('')}</div>` : ''}`;
  return `<header class="cs-h"><span class="cs-ic">${ic(ICON[id] || id)}</span><div class="cs-t"><span>${esc(c.name)}</span><h2 id="csTitle">${esc((k.title && k.title()) || c.title)}</h2></div>
      <button class="iconbtn cs-x" aria-label="${t('Close')}">${ic('x')}</button></header>
    <div class="cs-b${k.wide ? ' wide' : ''}">
      <div class="cs-l">${left}</div>
      <div class="cs-r"><h4>${t('Specs')}</h4><dl>${rows.map(([a, b]) => { const live = k.liveRows && k.liveRows().find(r => r[0] === a); return `<dt data-k="${esc(a)}">${esc(t(a))}</dt><dd>${esc(live ? live[1] : b)}</dd>`; }).join('')}</dl>
        <div class="cs-acts">${(k.actions || []).map(([label, m, tab, i], n) => `<button class="btn ${n ? 'sec' : 'pri'}" data-m="${m}" data-tab="${tab}">${ic(i)}${esc(label)}</button>`).join('')}</div></div>
    </div>`;
}
function update() {
  if (!open) return; const k = CFG[open];
  if (k.big) { const [bv] = k.big(); const b = $('#csBig'); if (b && b.textContent !== String(bv)) b.textContent = bv; }
  if (k.title) { const tt = k.title(), h = $('#csTitle'); if (tt && h && h.textContent !== tt) h.textContent = tt; }
  if (k.liveRows) { const dds = $$('.cs-r dl dd', sheet), dts = $$('.cs-r dl dt', sheet);
    k.liveRows().forEach(([lab, val]) => { const i = dts.findIndex(d => d.dataset.k === lab); if (i >= 0 && dds[i].textContent !== val) dds[i].textContent = val; }); }
  if (k.stats) { const st = k.stats(); $$('.cs-stats b', sheet).forEach((b, i) => { const s = st[i]; if (s && b.textContent !== s[1]) b.textContent = s[1]; if (s && (s[2] || '') !== b.title) b.title = s[2] || ''; }); }
  lastTick = performance.now();
}
SH.tele.on(update);
function drawChart(t) {
  if (!open || !chart) return; const k = CFG[open].chart; const c = chart, r = c.getBoundingClientRect(); if (!r.width) return;
  const d = Math.min(2, devicePixelRatio || 1); if (c.width !== Math.round(r.width * d)) { c.width = Math.round(r.width * d); c.height = Math.round(r.height * d); }
  const ctx = c.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, r.width, r.height);
  const data = T.hist[k.key].slice(-86); const mx = typeof k.max === 'function' ? k.max() : k.max; const max = mx || Math.max(1, ...data) * 1.15;
  const frac = state.settings.intensity === 'min' ? 0 : Math.min(1, (t - lastTick) / ((+state.settings.teleRate || 1000))); const step = r.width / (data.length - 3);
  const col = getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim() || '#9ED6FF';
  ctx.strokeStyle = 'rgba(170,200,245,.07)'; for (let i = 1; i < 4; i++) { const y = Math.round(r.height * i / 4) + .5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(r.width, y); ctx.stroke(); }
  ctx.beginPath(); data.forEach((val, i) => { const px = (i - 1 - frac) * step, py = r.height - 3 - Math.min(1, val / max) * (r.height - 10); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.lineTo(r.width + step, r.height); ctx.lineTo(-step, r.height); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, r.height); g.addColorStop(0, col + '44'); g.addColorStop(1, col + '00'); ctx.fillStyle = g; ctx.fill();
}
tickers.add((dt, t) => drawChart(t));

function findOrigin(id, given) {
  const ok = el => el && el.isConnected && el.getBoundingClientRect().width > 0;
  if (ok(given)) return given;
  const fromPointer = lastPointer && lastPointer.closest && lastPointer.closest(`[data-comp="${id}"]`);
  if (ok(fromPointer)) return fromPointer;
  return [...document.querySelectorAll(`#v-home [data-comp="${id}"]`)].find(ok) || null;
}
async function openComponent(id, given) {
  if (!CFG[id]) { SH.go('monitor'); return; }
  if (open) close(true);
  open = id; origin = findOrigin(id, given);
  sheet.innerHTML = await html(id); if (open !== id) return;
  chart = $('.cs-chart canvas', sheet); root.classList.add('on'); sheet.classList.toggle('wide', !!CFG[id].wide);
  const to = sheet.getBoundingClientRect();
  anim(scrim, [{ opacity: 0 }, { opacity: 1 }], { d: 260 });
  if (origin) {
    const from = origin.getBoundingClientRect();
    const dx = (from.left + from.width / 2) - (to.left + to.width / 2), dy = (from.top + from.height / 2) - (to.top + to.height / 2);
    anim(sheet, [{ transform: `translate3d(${dx}px,${dy}px,0) scale(${from.width / to.width},${from.height / to.height})`, opacity: .4, borderRadius: '30px' },
      { transform: 'none', opacity: 1, borderRadius: '24px' }], { d: 560, e: EASE.spring });
  } else anim(sheet, [{ transform: 'scale(.9)', opacity: 0, filter: 'blur(8px)' }, { transform: 'none', opacity: 1, filter: 'blur(0px)' }], { d: 420, e: EASE.spring });
  $$('.cs-h > *, .cs-l > *, .cs-r > *, .cs-scr', sheet).forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translate3d(0,10px,0)' }, { opacity: 1, transform: 'none' }], { d: 440, delay: 150 + i * 35, e: EASE.spring }));
  const m = $('.cs-meter .bar>span', sheet); if (m) anim(m, [{ transform: 'scaleX(0)' }, { transform: `scaleX(${CFG[id].meter().v})` }], { d: 900, delay: 300 });
  if (origin) origin.style.visibility = 'hidden';
  if (id === 'display') refreshThumbs();
  setTimeout(() => { const x = $('.cs-x', sheet); x && x.focus({ preventScroll: true }); }, 50);
}
function close(instant) {
  if (!open) return; const was = origin; open = null; chart = null; clearTimeout(thumbTimer);
  if (instant) { root.classList.remove('on'); if (was) was.style.visibility = ''; return; }
  anim(scrim, [{ opacity: 1 }, { opacity: 0 }], { d: 220 });
  $$('.cs-h, .cs-b', sheet).forEach(el => anim(el, [{ opacity: 1 }, { opacity: 0 }], { d: 120 }));
  let a;
  if (was && was.isConnected) {
    const to = sheet.getBoundingClientRect(), from = was.getBoundingClientRect();
    const dx = (from.left + from.width / 2) - (to.left + to.width / 2), dy = (from.top + from.height / 2) - (to.top + to.height / 2);
    a = anim(sheet, [{ transform: 'none', opacity: 1, borderRadius: '24px' }, { transform: `translate3d(${dx}px,${dy}px,0) scale(${from.width / to.width},${from.height / to.height})`, opacity: .3, borderRadius: '30px' }], { d: 380, e: EASE.out });
  } else a = anim(sheet, [{ transform: 'none', opacity: 1 }, { transform: 'scale(.94)', opacity: 0 }], { d: 220 });
  a.finished.then(() => { if (!open) { root.classList.remove('on'); $$('.cs-h, .cs-b', sheet).forEach(el => el.getAnimations().forEach(x => x.cancel())); } if (was) was.style.visibility = ''; }).catch(() => { if (was) was.style.visibility = ''; });
}
root.addEventListener('click', e => {
  if (e.target === scrim || e.target.closest('.cs-x')) { close(); return; }
  /* the module it opens makes the sound (navigate), not the sheet closing on the way */
  const b = e.target.closest('[data-m]'); if (b) { SH.sound.claim(); close(); setTimeout(() => SH.go(b.dataset.m, { tab: b.dataset.tab }), 160 * SH.motion()); }
});
addEventListener('keydown', e => { if (open && e.key === 'Escape') { e.stopImmediatePropagation(); close(); } }, true);
SH.on('view', () => { if (open) close(true); });
SH.openComponent = openComponent;
SH.closeComponent = close;
})();
