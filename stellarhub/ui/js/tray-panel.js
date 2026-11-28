/* StellarHub · the panel that opens with a left click on the tray icon (a right click shows Windows' menu).
   Live numbers, every module one click away, quick actions, open and quit. It hides when it loses focus. */
'use strict';
(() => {
const { $, $$, anim, EASE, ic, state } = SH;
const t = SH.t;
const ok = x => x !== null && x !== undefined && !Number.isNaN(x);

const VITALS = [
  ['cpu', t('Processor'), v => [ok(v.cpu) ? Math.round(v.cpu) : '—', '%'], v => (v.cpu || 0) / 100, v => v.cpu > 90],
  ['gpu', t('Graphics'), v => [ok(v.gpu) ? Math.round(v.gpu) : '—', '%'], v => (v.gpu || 0) / 100, v => v.gpu > 95],
  ['ram', t('Memory'), v => [ok(v.ram) ? SH.fmt1(v.ram) : '—', SH.unit('GB')], v => ok(v.ram) && v.ramTotal ? v.ram / v.ramTotal : 0, v => v.ramTotal && v.ram / v.ramTotal > .9],
  ['battery', t('Battery'), v => [ok(v.battery) ? Math.round(v.battery) : '—', '%'], v => (v.battery || 0) / 100, v => !v.charging && v.battery < 15],
];

function build() {
  $('#vit').innerHTML = VITALS.map(([k, n]) => `<div class="vt" data-k="${k}"><span>${n}</span><b>—</b><div class="bar"><u></u></div></div>`).join('');
  const mods = SH.MODS.filter(m => m.id !== 'home');
  $('#capL').textContent = t('Modules');
  $('#mods').innerHTML = mods.map(m => `<button data-m="${m.id}" title="${m.name}" aria-label="${m.name}">${ic(m.icon)}</button>`).join('');
  $('#qa').innerHTML = [
    ['widget', 'monitor', t('Always-on-top widget'), '<span class="toggle" id="wTog"><i></i></span>'],
    ['optimize', 'sparkle', t('Optimize everything'), ''],
    ['updates', 'download', t('Check for updates'), ''],
    ['disk', 'storage', t('Analyze the disk'), ''],
  ].map(([a, i, n, extra]) => `<button data-a="${a}">${ic(i)}<span>${n}</span>${extra}</button>`).join('');
  $('#open').innerHTML = `${ic('home')}${t('Open StellarHub')}`;
  $('#settings').innerHTML = ic('gear'); $('#settings').title = t('Settings');
  $('#quit').innerHTML = ic('power'); $('#quit').title = t('Quit StellarHub');
}

/* no battery (desktop): its tile goes away once real telemetry says so, and the other three share the row */
const noBattery = v => !SH.tele.simulated && !ok(v.battery) && !(SH.PC && SH.PC.real && SH.PC.components.some(c => c.id === 'battery'));
function paint(v) {
  const nb = noBattery(v), vit = $('#vit');
  if (vit && vit.dataset.nb !== String(nb)) { vit.dataset.nb = String(nb); const b = $('.vt[data-k="battery"]', vit); if (b) b.hidden = nb; vit.style.gridTemplateColumns = nb ? 'repeat(3,1fr)' : ''; }
  VITALS.forEach(([k, , val, frac, hot]) => {
    const el = $(`.vt[data-k="${k}"]`); if (!el) return;
    const [a, u] = val(v); el.querySelector('b').innerHTML = a === '—' ? '—' : `${a}<small>${u}</small>`;
    el.querySelector('u').style.setProperty('--v', Math.max(0, Math.min(1, frac(v))).toFixed(4));
    el.classList.toggle('hot', !!hot(v));
  });
}
SH.tele.on(paint);

async function refreshState() {
  const info = await SH.call('info'); const admin = !!(info && info.admin);
  $('#mode').classList.toggle('admin', admin);
  $('#modeTxt').textContent = admin ? t('Administrator mode') : t('Normal mode');
  const w = await SH.call('widget_is_open'); const tog = $('#wTog'); if (tog) tog.classList.toggle('on', !!w);
}

/* called by Python every time the panel is shown */
SH.panelShown = () => {
  /* its sound once the settings are read again (they may have changed in the main window); visible: the window is being shown */
  SH.lookChanged().then(() => SH.sound('panel_open', { visible: true })); refreshState(); paint(SH.tele.v);
  const p = $('#p');
  anim(p, [{ opacity: 0, transform: 'translate3d(0,14px,0) scale(.97)' }, { opacity: 1, transform: 'none' }], { d: 380, e: EASE.spring });
  $$('.vt, .mods button, .qa button, .ft > *', p).forEach((el, i) =>
    anim(el, [{ opacity: 0, transform: 'translate3d(0,6px,0)' }, { opacity: 1, transform: 'none' }], { d: 320, delay: 40 + i * 14, e: EASE.spring }));
};

const go = (mod, tab) => SH.call('panel_go', mod, tab || null);
document.addEventListener('mouseover', e => {
  const b = e.target.closest('.mods button'); const cap = $('#capM');
  cap.textContent = b ? b.getAttribute('aria-label') : '';
});
/* sounds (js/sounds.js is not loaded here): the main window's rules in small. hover on the module buttons, the quick
   actions and Open; hover_soft on the small icons (Settings, Quit); only when the pointer comes in from outside with a
   real mouse movement. A click on a module, a quick action, Open or Settings plays click before the panel hides (the
   main window can't: the press was not in it); the widget switch has its own widget_on/off and Quit the exit sound. */
let movedAt = -1e9;
addEventListener('pointermove', e => { if (e.isTrusted && (e.movementX || e.movementY)) movedAt = performance.now(); }, { capture: true, passive: true });
document.addEventListener('pointerover', e => {
  if (e.pointerType !== 'mouse' || e.buttons || !e.isTrusted) return;
  const b = e.target.closest && e.target.closest('button'); if (!b || b.disabled) return;
  if (e.relatedTarget && b.contains(e.relatedTarget)) return;
  if (performance.now() - movedAt > 60) return;
  SH.sound(b.matches('.ft .ico') ? 'hover_soft' : 'hover', { visible: true });
}, { passive: true });
document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b && !b.disabled && e.isTrusted && e.detail > 0 && b.id !== 'quit' && b.dataset.a !== 'widget') SH.sound('click', { visible: true });
}, true);
document.addEventListener('click', e => {
  const m = e.target.closest('.mods button'); if (m) { go(m.dataset.m); return; }
  const a = e.target.closest('.qa button');
  if (a) {
    const act = a.dataset.a;
    if (act === 'widget') {
      if (a.dataset.busy) return;                 // the window is still being created or closed: ignore the extra click
      a.dataset.busy = '1'; a.setAttribute('aria-busy', 'true');
      SH.call('widget_toggle').then(open => { const tog = $('#wTog'); if (tog) tog.classList.toggle('on', !!open); if (open !== undefined) SH.sound(open ? 'widget_on' : 'widget_off', { visible: true }); })
        .catch(() => {}).finally(() => { delete a.dataset.busy; a.removeAttribute('aria-busy'); });
      return;
    }
    if (act === 'optimize') go('optimizer', 'overview');
    if (act === 'updates') go('updater', 'overview');
    if (act === 'disk') go('storage', 'map');
    return;
  }
  if (e.target.closest('#open')) { SH.call('panel_go', null, null); return; }
  if (e.target.closest('#settings')) { SH.call('panel_go', 'settings', null); return; }
  if (e.target.closest('#quit')) SH.call('quit');
});
addEventListener('keydown', e => { if (e.key === 'Escape') SH.call('panel_hide'); });

/* the panel is built once: it re-reads the settings and re-applies the look whenever it is told (Python calls
   SH.lookChanged on a theme/accent/animation change) and every time it is shown. A language change reloads it. */
function applyLook() {
  const st = state.settings, root = document.documentElement;
  if (st.accent) root.style.setProperty('--accent', st.accent);
  if (st.accent2) root.style.setProperty('--accent2', st.accent2);
  if (st.theme) root.dataset.theme = st.theme;
  if (st.intensity) root.style.setProperty('--f', SH.FACT[st.intensity] / (st.animSpeed || 1));
}
SH.lookChanged = async () => { await SH.loadSettings(); applyLook(); };

(async () => {
  await SH.loadSettings();
  applyLook();
  build(); paint(SH.tele.v); refreshState();
  const st = state.settings; if (st.sounds !== false && +st.soundVolume > 0) SH.sound.preload(['hover', 'hover_soft', 'click']);
})();
})();
