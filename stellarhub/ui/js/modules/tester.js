/* StellarHub · Device Tester: keyboard, screen, speakers, microphone, camera, mouse and game controller. Everything really works in the browser. */
'use strict';
(() => {
const { $, $$, anim, EASE, ic, esc, fmt1, state, tickers } = SH;
const t = SH.t;
let curTab = null;
const active = t => state.view === 'tester' && curTab === t;
const isMin = () => SH.effInt() === 'min';
SH.icons.add({
  wave: '<path d="M3 12h2l2-6 3 12 3-9 2 6 2-3h4"/>',
  rec: '<circle cx="12" cy="12" r="6.5"/>',
  shot: '<path d="M8 4.5 6.5 7H4a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 4 19h16a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 20 7h-2.5L16 4.5z"/><circle cx="12" cy="13" r="3.5"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.3-5.6L4 8.5"/><path d="M4 4v4.5h4.5"/>',
});

/* ========================= Keyboard ========================= */
/* Real layouts in key units (1 u = one letter). Each key: physical code (KeyboardEvent.code), legend, x, y, width, height. */
const KB_NAMES = {
  es: { Escape: 'Esc', Backspace: 'Retroceso', Tab: 'Tab', CapsLock: 'Bloq Mayús', Enter: 'Intro', ShiftLeft: 'Mayús', ShiftRight: 'Mayús', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', MetaLeft: 'Win', MetaRight: 'Win', AltLeft: 'Alt', AltRight: 'Alt Gr', ContextMenu: 'Menú', Space: '', Fn: 'Fn', PrintScreen: 'Impr', ScrollLock: 'Bl Despl', Pause: 'Pausa', Insert: 'Insert', Delete: 'Supr', Home: 'Inicio', End: 'Fin', PageUp: 'Re Pág', PageDown: 'Av Pág', NumLock: 'Bloq Num', NumpadEnter: 'Intro' },
  en: { Escape: 'Esc', Backspace: 'Backspace', Tab: 'Tab', CapsLock: 'Caps Lock', Enter: 'Enter', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', MetaLeft: 'Win', MetaRight: 'Win', AltLeft: 'Alt', AltRight: 'AltGr', ContextMenu: 'Menu', Space: '', Fn: 'Fn', PrintScreen: 'PrtSc', ScrollLock: 'ScrLk', Pause: 'Pause', Insert: 'Ins', Delete: 'Del', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn', NumLock: 'Num', NumpadEnter: 'Enter' },
};
const KB_COMMON = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', NumpadDivide: '/', NumpadMultiply: '*', NumpadSubtract: '−', NumpadAdd: '+', NumpadDecimal: ',', Numpad0: '0', Numpad1: '1', Numpad2: '2', Numpad3: '3', Numpad4: '4', Numpad5: '5', Numpad6: '6', Numpad7: '7', Numpad8: '8', Numpad9: '9' };
const KB_LANGS = {
  'es-ES': { n: t('Spanish (Spain)'), iso: true, names: 'es', map: { Backquote: 'º', Minus: "'", Equal: '¡', BracketLeft: '`', BracketRight: '+', Semicolon: 'Ñ', Quote: '´', Backslash: 'Ç', IntlBackslash: '<', Comma: ',', Period: '.', Slash: '-' } },
  'es-419': { n: t('Spanish (Latin America)'), iso: true, names: 'es', map: { Backquote: '|', Minus: "'", Equal: '¿', BracketLeft: '´', BracketRight: '+', Semicolon: 'Ñ', Quote: '{', Backslash: '}', IntlBackslash: '<', Comma: ',', Period: '.', Slash: '-' } },
  'en-US': { n: t('English (US)'), iso: false, names: 'en', map: { Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', AltRight: 'Alt' } },
  'en-GB': { n: t('English (UK)'), iso: true, names: 'en', map: { Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backslash: '#', IntlBackslash: '\\', Comma: ',', Period: '.', Slash: '/' } },
  'fr-FR': { n: t('French'), iso: true, names: 'en', map: { Backquote: '²', Digit1: '&', Digit2: 'é', Digit3: '"', Digit4: "'", Digit5: '(', Digit6: '-', Digit7: 'è', Digit8: '_', Digit9: 'ç', Digit0: 'à', Minus: ')', Equal: '=', KeyQ: 'A', KeyW: 'Z', KeyA: 'Q', KeyZ: 'W', Semicolon: 'M', KeyM: ',', Comma: ';', Period: ':', Slash: '!', BracketLeft: '^', BracketRight: '$', Quote: 'ù', Backslash: '*', IntlBackslash: '<' } },
  'de-DE': { n: t('German'), iso: true, names: 'en', map: { Backquote: '^', Minus: 'ß', Equal: '´', KeyY: 'Z', KeyZ: 'Y', BracketLeft: 'Ü', BracketRight: '+', Semicolon: 'Ö', Quote: 'Ä', Backslash: '#', IntlBackslash: '<', Comma: ',', Period: '.', Slash: '-' } },
  'pt-BR': { n: t('Portuguese (Brazil)'), iso: true, abnt: true, names: 'en', map: { Backquote: "'", Minus: '-', Equal: '=', BracketLeft: '´', BracketRight: '[', Semicolon: 'Ç', Quote: '~', Backslash: ']', IntlBackslash: '\\', Comma: ',', Period: '.', Slash: ';', IntlRo: '/' } },
};
const KB_FORMATS = { laptop: t('Laptop'), laptopnum: t('Laptop + numpad'), full: t('Full 100%'), tkl: 'TKL 80%', p75: '75%', p65: '65%' };
function kbLabel(L, c) { return L.map[c] ?? KB_COMMON[c] ?? KB_NAMES[L.names][c] ?? (c.startsWith('Key') ? c.slice(3) : c.startsWith('Digit') ? c.slice(5) : /^F\d+$/.test(c) ? c : c); }
function kbLayout(fmt, lang) {
  const L = KB_LANGS[lang] || KB_LANGS['es-ES']; const K = [];
  const add = (code, x, y, w = 1, h = 1, cls = '') => K.push({ code, label: kbLabel(L, code), x, y, w, h, cls });
  const main = (y0, shiftEnd) => {
    add('Backquote', 0, y0); '1234567890'.split('').forEach((d, i) => add('Digit' + d, 1 + i, y0)); add('Minus', 11, y0); add('Equal', 12, y0); add('Backspace', 13, y0, 2);
    let y = y0 + 1; add('Tab', 0, y, 1.5); 'QWERTYUIOP'.split('').forEach((c, i) => add('Key' + c, 1.5 + i, y)); add('BracketLeft', 11.5, y); add('BracketRight', 12.5, y);
    if (L.iso) add('Enter', 13.5, y, 1.5, 1, 'iso-a'); else add('Backslash', 13.5, y, 1.5);
    y = y0 + 2; add('CapsLock', 0, y, 1.75); 'ASDFGHJKL'.split('').forEach((c, i) => add('Key' + c, 1.75 + i, y)); add('Semicolon', 10.75, y); add('Quote', 11.75, y);
    if (L.iso) { add('Backslash', 12.75, y); add('Enter', 13.75, y, 1.25, 1, 'iso-b'); } else add('Enter', 12.75, y, 2.25);
    y = y0 + 3; let x;
    if (L.iso) { add('ShiftLeft', 0, y, 1.25); add('IntlBackslash', 1.25, y); x = 2.25; } else { add('ShiftLeft', 0, y, 2.25); x = 2.25; }
    'ZXCVBNM'.split('').forEach((c, i) => add('Key' + c, x + i, y)); add('Comma', x + 7, y); add('Period', x + 8, y); add('Slash', x + 9, y); x += 10;
    if (L.abnt) { add('IntlRo', x, y); x += 1; }
    add('ShiftRight', x, y, shiftEnd - x);
    return y0 + 4;
  };
  const fnRow = (y, h, keys) => keys.forEach(([c, x, w = 1]) => add(c, x, y, w, h, 'fn'));
  let W = 15, H = 6;
  if (fmt === 'laptop' || fmt === 'laptopnum') {
    /* only the keys every laptop has: no right Win, Menu, Scroll Lock, Pause or navigation block */
    fnRow(0, .7, [['Escape', 0], ...Array.from({ length: 12 }, (_, i) => ['F' + (i + 1), 1 + i]), ['PrintScreen', 13], ['Delete', 14]]);
    const y = main(.9, 15);
    add('ControlLeft', 0, y, 1.25); add('Fn', 1.25, y); add('MetaLeft', 2.25, y); add('AltLeft', 3.25, y, 1.25); add('Space', 4.5, y, 5.5); add('AltRight', 10, y); add('ControlRight', 11, y);
    add('ArrowLeft', 12, y + .5, 1, .5, 'half'); add('ArrowUp', 13, y, 1, .5, 'half'); add('ArrowDown', 13, y + .5, 1, .5, 'half'); add('ArrowRight', 14, y + .5, 1, .5, 'half');
    W = 15; H = y + 1;
    if (fmt === 'laptopnum') { /* the compact keypad of 15-17" laptops, next to the main block */
      const nx = 15.3, y0 = .9;
      add('NumLock', nx, y0); add('NumpadDivide', nx + 1, y0); add('NumpadMultiply', nx + 2, y0); add('NumpadSubtract', nx + 3, y0);
      add('Numpad7', nx, y0 + 1); add('Numpad8', nx + 1, y0 + 1); add('Numpad9', nx + 2, y0 + 1); add('NumpadAdd', nx + 3, y0 + 1, 1, 2);
      add('Numpad4', nx, y0 + 2); add('Numpad5', nx + 1, y0 + 2); add('Numpad6', nx + 2, y0 + 2);
      add('Numpad1', nx, y0 + 3); add('Numpad2', nx + 1, y0 + 3); add('Numpad3', nx + 2, y0 + 3); add('NumpadEnter', nx + 3, y0 + 3, 1, 2);
      add('Numpad0', nx, y0 + 4, 2); add('NumpadDecimal', nx + 2, y0 + 4);
      W = nx + 4;
    }
  } else if (fmt === 'full' || fmt === 'tkl') {
    fnRow(0, 1, [['Escape', 0], ...[1, 2, 3, 4].map(i => ['F' + i, 1 + i]), ...[5, 6, 7, 8].map(i => ['F' + i, 1.5 + i]), ...[9, 10, 11, 12].map(i => ['F' + i, 2 + i]), ['PrintScreen', 15.25], ['ScrollLock', 16.25], ['Pause', 17.25]]);
    const y = main(1.5, 15);
    [['ControlLeft', 1.25], ['MetaLeft', 1.25], ['AltLeft', 1.25], ['Space', 6.25], ['AltRight', 1.25], ['MetaRight', 1.25], ['ContextMenu', 1.25], ['ControlRight', 1.25]].reduce((x, [c, w]) => { add(c, x, y, w); return x + w; }, 0);
    add('Insert', 15.25, 1.5); add('Home', 16.25, 1.5); add('PageUp', 17.25, 1.5); add('Delete', 15.25, 2.5); add('End', 16.25, 2.5); add('PageDown', 17.25, 2.5);
    add('ArrowUp', 16.25, y - 1); add('ArrowLeft', 15.25, y); add('ArrowDown', 16.25, y); add('ArrowRight', 17.25, y);
    W = 18.25; H = y + 1;
    if (fmt === 'full') {
      const nx = 18.5;
      add('NumLock', nx, 1.5); add('NumpadDivide', nx + 1, 1.5); add('NumpadMultiply', nx + 2, 1.5); add('NumpadSubtract', nx + 3, 1.5);
      add('Numpad7', nx, 2.5); add('Numpad8', nx + 1, 2.5); add('Numpad9', nx + 2, 2.5); add('NumpadAdd', nx + 3, 2.5, 1, 2);
      add('Numpad4', nx, 3.5); add('Numpad5', nx + 1, 3.5); add('Numpad6', nx + 2, 3.5);
      add('Numpad1', nx, 4.5); add('Numpad2', nx + 1, 4.5); add('Numpad3', nx + 2, 4.5); add('NumpadEnter', nx + 3, 4.5, 1, 2);
      add('Numpad0', nx, 5.5, 2); add('NumpadDecimal', nx + 2, 5.5);
      W = 22.5;
    }
  } else {
    const has75 = fmt === 'p75'; let y0 = 0;
    if (has75) { fnRow(0, 1, [['Escape', 0], ...Array.from({ length: 12 }, (_, i) => ['F' + (i + 1), 1 + i]), ['PrintScreen', 13], ['Insert', 14], ['Delete', 15]]); y0 = 1.15; }
    const y = main(y0, 14);
    if (!has75) { K.splice(K.findIndex(k => k.code === 'Backquote'), 1); add('Escape', 0, y0); }
    add(has75 ? 'Home' : 'Delete', 15, y0); add('PageUp', 15, y0 + 1); add('PageDown', 15, y0 + 2); add('ArrowUp', 14, y0 + 3); add('End', 15, y0 + 3);
    [['ControlLeft', 1.25], ['MetaLeft', 1.25], ['AltLeft', 1.25], ['Space', 6.25], ['AltRight', 1], ['Fn', 1], ['ControlRight', 1]].reduce((x, [c, w]) => { add(c, x, y, w); return x + w; }, 0);
    add('ArrowLeft', 13, y); add('ArrowDown', 14, y); add('ArrowRight', 15, y);
    W = 16; H = y + 1;
  }
  return { keys: K, W, H, lang, count: new Set(K.map(k => k.code).filter(c => c !== 'Fn')).size };
}
const kb = { capturing: false, tested: new Set(), down: new Map(), lastUp: {}, ev: {}, chatN: {}, maxRoll: 0, chatter: new Set(), stuck: new Set(), escT: 0, presses: 0, layout: null, detected: null, sugNum: false,
  missing: new Set(), marking: false, autoT: {} };
const kbFmt = () => state.settings.testerKbFormat || 'laptop';
/* Keys this keyboard doesn't have: they don't count toward the total. Remembered per layout (setting
   testerKbMissing = { format: [codes] }). Laptops rarely have right Win, Menu, Scroll Lock or Pause, so when the PC
   is a laptop the 100% and TKL layouts start with those marked. */
const KB_LAPTOP_MISSING = ['MetaRight', 'ContextMenu', 'ScrollLock', 'Pause'];
const kbMissDefault = fmt => SH.PC && SH.PC.type === 'laptop' && (fmt === 'full' || fmt === 'tkl') ? KB_LAPTOP_MISSING : [];
function kbLoadMissing() { const m = (state.settings.testerKbMissing || {})[kbFmt()]; kb.missing = new Set(Array.isArray(m) ? m : kbMissDefault(kbFmt())); }
function kbSaveMissing() { SH.setSetting('testerKbMissing', { ...(state.settings.testerKbMissing || {}), [kbFmt()]: [...kb.missing] }); }
const kbCodes = () => kb.layout ? new Set(kb.layout.keys.map(k => k.code).filter(c => c !== 'Fn')) : new Set();
const kbTotal = () => [...kbCodes()].filter(c => !kb.missing.has(c)).length;
const kbDoneN = () => { const codes = kbCodes(); return [...kb.tested].filter(c => codes.has(c) && !kb.missing.has(c)).length; };
/* the layout Windows uses is the default. A layout picked by hand is remembered with the one it replaced
   (testerKbPick = { lang, over }), so if Windows changes keyboards the detected one comes back. The old
   testerKbLang setting is ignored: it kept a pick forever, even when it didn't match Windows. */
const kbPick = () => { const p = state.settings.testerKbPick; return p && typeof p === 'object' && typeof p.lang === 'string' && p.over === kb.detected ? p.lang : ''; };
const kbLang = () => kbPick() || kb.detected || 'es-ES';
function kbKeysHTML() {
  const lay = kb.layout = kbLayout(kbFmt(), kbLang());
  kbLoadMissing();
  return lay.keys.map(k => `<div class="k${k.code === 'Fn' ? ' nd' : ''}${kb.missing.has(k.code) ? ' miss' : ''}${k.label && k.label.length > 3 ? ' sm' : ''}${k.cls ? ' ' + k.cls : ''}${kb.tested.has(k.code) ? ' done' : ''}" data-code="${k.code}" style="--x:${k.x};--y:${k.y};--w:${k.w};--h:${k.h}"><span>${esc(k.label)}</span>${k.code === 'Escape' ? '<i class="esc-ring"></i>' : ''}</div>`).join('');
}
function kbFit(el) {
  const st = $('#kbStage', el), box = $('#kbKeys', el); if (!st || !box || !kb.layout) return;
  const u = Math.max(18, Math.min(st.clientWidth / kb.layout.W, st.clientHeight / kb.layout.H, 78));
  box.style.setProperty('--u', u + 'px'); box.style.width = (u * kb.layout.W) + 'px'; box.style.height = (u * kb.layout.H) + 'px';
}
function kbRebuild(el, animate) {
  const box = $('#kbKeys', el); box.innerHTML = kbKeysHTML(); kbFit(el);
  updKb(el);
  if (animate) $$('.k', box).forEach((k, i) => anim(k, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], { d: 380, delay: Math.min(i * 4, 260), e: EASE.spring }));
}
/* what Windows uses: a green check when it is the layout drawn here, a neutral warning when the chosen one differs */
function kbDetChip(el) {
  const chip = $('#kbDet', el); if (!chip || !kb.detected || !KB_LANGS[kb.detected]) return;
  const same = kbLang() === kb.detected;
  chip.hidden = false; chip.classList.toggle('ok', same); chip.classList.toggle('warn', !same);
  chip.innerHTML = `${ic(same ? 'check' : 'alert')}${same ? t('Windows uses {layout}', { layout: esc(KB_LANGS[kb.detected].n) }) : t('Windows uses {layout}, not this one', { layout: esc(KB_LANGS[kb.detected].n) })}`
    + (same ? '' : `<button class="btn ghost sm" id="kbUseWin">${t('Use it')}</button>`);
  const use = $('#kbUseWin', chip);
  if (use) use.onclick = () => { SH.setSetting('testerKbPick', null); $('#kbLang', el).value = kb.detected; kbRebuild(el, true); kbDetChip(el); };
}
async function kbDetect(el) {
  try {
    if (!navigator.keyboard || !navigator.keyboard.getLayoutMap) return;
    const m = await navigator.keyboard.getLayoutMap(); const g = c => (m.get(c) || '').toLowerCase();
    const d = g('KeyQ') === 'a' ? 'fr-FR' : g('KeyY') === 'z' ? 'de-DE' : g('Semicolon') === 'ñ' ? (g('Backquote') === 'º' ? 'es-ES' : 'es-419') : g('Semicolon') === 'ç' ? 'pt-BR' : g('Backslash') === '#' ? 'en-GB' : 'en-US';
    const drawn = kb.layout && kb.layout.lang;
    kb.detected = d;
    const want = kbLang(); $('#kbLang', el).value = want;
    if (want !== drawn) kbRebuild(el, true);
    kbDetChip(el);
  } catch {}
}
function renderKeyboard(el) {
  el.classList.add('fill');
  el.innerHTML = `<div class="kb">
    <div class="pan kb-board" data-asm>
      <div class="kb-top"><div class="seg" id="kbFmt"><span class="ind"></span>${Object.entries(KB_FORMATS).map(([k, n]) => `<button data-v="${k}"${kbFmt() === k ? ' class="on"' : ''}>${n}</button>`).join('')}</div>
        <label class="field kb-lang">${ic('globe')}<select id="kbLang">${Object.entries(KB_LANGS).map(([k, l]) => `<option value="${k}"${kbLang() === k ? ' selected' : ''}>${l.n}</option>`).join('')}</select></label>
        <span class="chip ok kb-det" id="kbDet" hidden></span>
        <button class="btn ghost sm kb-missb" id="kbMiss" title="${t("Mark the keys your keyboard doesn't have")}">${ic('keyboard')}${t('Missing keys')}</button></div>
      <div class="kb-sug kb-mark" id="kbMark" hidden>${ic('info')}<span>${t("Click the keys your keyboard doesn't have. They won't count toward the progress. During the test, right-click a key to do the same.")}</span><button class="btn ghost sm" id="kbMissDef">${t('Restore defaults')}</button><button class="btn pri sm" id="kbMissDone">${t('Done')}</button></div>
      <div class="kb-sug" id="kbSug" hidden>${ic('info')}<span id="kbSugT">${t('You pressed a numeric keypad key. Switch to the full layout?')}</span><button class="btn sec sm" id="kbSugYes">${t('Switch to 100%')}</button><button class="btn ghost sm" id="kbSugNo">${t('No')}</button></div>
      <div class="kb-stage" id="kbStage"><div class="kb-keys" id="kbKeys"></div></div>
      <div class="kb-cover" id="kbCover"><div><b>${t('Click “Start”, then press every key')}</b><span>${t('While the test runs, StellarHub ignores its own shortcuts. Hold Esc for a second to exit. Windows keeps Win + any key, Alt + Tab and Fn for itself.')}<br>${t('Is a key missing from your keyboard? Right-click it during the test, or use “Missing keys”.')}</span><button class="btn pri lg" id="kbStart">${ic('keyboard')}${t('Start')}</button></div></div></div>
    <div class="kb-side">
      <div class="pan" data-asm><h4>${t('Progress')}</h4><div class="kb-n"><b class="big" id="kbN">0</b><span class="muted" id="kbTot">${t('of {n} keys', { n: 0 })}</span></div><div class="bar" style="margin-top:12px"><span id="kbBar" style="transform:scaleX(0)"></span></div><div class="kb-missn faint" id="kbMissN" hidden></div></div>
      <div class="pan kb-stats" data-asm>
        <div><span class="muted">${t('Keys at once (max)')}</span><b id="kbRoll">0</b></div>
        <div><span class="muted">${t('Keystrokes')}</span><b id="kbPress">0</b></div>
        <div><span class="muted">${t('Last key')}</span><b id="kbLast">–</b></div></div>
      <div class="pan kb-wp" data-asm><h4>${t('Warnings')}</h4><div id="kbWarn" class="kb-warn"><span class="faint">${t('Nothing odd so far.')}</span></div></div>
      <div class="kb-acts" data-asm><button class="btn sec" id="kbReset">${ic('reset')}${t('Reset')}</button><button class="btn ghost" id="kbStop" hidden>${t('End the test')}</button></div>
    </div></div>`;
  kb.el = el;
  { const st = $('#kbStage', el), cv = $('#kbCover', el); if (st && cv) st.appendChild(cv); }  /* the cover lives on the keyboard area, whatever height the toolbar takes */
  kbRebuild(el, false);
  new ResizeObserver(() => kbFit(el)).observe($('#kbStage', el));
  requestAnimationFrame(() => SH.placeSeg($('#kbFmt', el), true));
  $('#kbFmt', el).addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.classList.contains('on')) return; $$('#kbFmt button', el).forEach(x => x.classList.toggle('on', x === b)); SH.placeSeg($('#kbFmt', el)); SH.setSetting('testerKbFormat', b.dataset.v); kbRebuild(el, true); });
  $('#kbLang', el).addEventListener('change', e => { const v = e.target.value; SH.setSetting('testerKbPick', v === kb.detected ? null : { lang: v, over: kb.detected }); kbRebuild(el, true); kbDetChip(el); });
  $('#kbSugYes', el).addEventListener('click', e => { const b = $(`#kbFmt [data-v="${e.currentTarget.dataset.to || 'full'}"]`, el); b && b.click(); hideSug(el); });
  $('#kbMiss', el).addEventListener('click', () => setMarking(el, !kb.marking));
  $('#kbMissDone', el).addEventListener('click', () => setMarking(el, false));
  $('#kbMissDef', el).addEventListener('click', () => { kb.missing = new Set(kbMissDefault(kbFmt())); kbSaveMissing(); $$('.k', el).forEach(k => k.classList.toggle('miss', kb.missing.has(k.dataset.code))); updKb(el); });
  const box = $('#kbKeys', el);
  box.addEventListener('click', e => { if (!kb.marking) return; const k = e.target.closest('.k'); if (k) toggleMissing(k.dataset.code); });
  box.addEventListener('contextmenu', e => { const k = e.target.closest('.k'); if (!k) return; e.preventDefault(); if (kb.capturing || kb.marking) toggleMissing(k.dataset.code); });
  $('#kbSugNo', el).addEventListener('click', () => { kb.sugNum = true; hideSug(el); });
  $('#kbStart', el).addEventListener('click', () => setCapture(el, true));
  $('#kbStop', el).addEventListener('click', () => setCapture(el, false));
  $('#kbReset', el).addEventListener('click', () => { kb.tested.clear(); kb.down.clear(); kb.chatter.clear(); kb.chatN = {}; kb.ev = {}; kb.stuck.clear(); kb.maxRoll = 0; kb.presses = 0; $$('.k', el).forEach(k => k.classList.remove('done', 'down', 'warn')); updKb(el); SH.toast(t('Keyboard test reset.')); });
  kbDetect(el);
}
function toggleMissing(code) {
  if (!code || code === 'Fn') return; const on = !kb.missing.has(code);
  if (on) kb.missing.add(code); else kb.missing.delete(code); kbSaveMissing();
  keyEls(code).forEach(k => { k.classList.toggle('miss', on); anim(k, [{ transform: 'scale(.9)' }, { transform: 'none' }], { d: 260, e: EASE.spring }); });
  updKb(kb.el);
}
function setMarking(el, on) {
  if (on && kb.capturing) setCapture(el, false);
  kb.marking = on; const bar = $('#kbMark', el), cov = $('#kbCover', el);
  bar.hidden = !on; $('#kbMiss', el).classList.toggle('on', on); $('#kbStage', el).classList.toggle('marking', on); cov.hidden = on;
  if (on) anim(bar, [{ opacity: 0, transform: 'translate3d(0,-6px,0)' }, { opacity: 1, transform: 'none' }], { d: 320, e: EASE.spring });
  else anim(cov, [{ opacity: 0 }, { opacity: 1 }], { d: 260 });
  kbFit(el);
}
function showSug(el) { const s = $('#kbSug', el); if (!s || !s.hidden) return;
  const to = kbFmt() === 'laptop' ? 'laptopnum' : 'full'; $('#kbSugYes', el).dataset.to = to;
  $('#kbSugT', el).textContent = to === 'full' ? t('You pressed a numeric keypad key. Switch to the full layout?') : t('You pressed a numeric keypad key. Switch to the laptop layout with a numeric keypad?');
  $('#kbSugYes', el).textContent = to === 'full' ? t('Switch to 100%') : t('Switch to {layout}', { layout: KB_FORMATS.laptopnum });
  s.hidden = false; anim(s, [{ opacity: 0, transform: 'translate3d(0,-6px,0)' }, { opacity: 1, transform: 'none' }], { d: 320, e: EASE.spring }); kbFit(el); }
function hideSug(el) { const s = $('#kbSug', el); if (s) s.hidden = true; kbFit(el); }
function setCapture(el, on) {
  if (on && kb.marking) setMarking(el, false);
  if (!on) releaseAll();
  kb.capturing = on; const cov = $('#kbCover', el);
  if (on) { anim(cov, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.04)' }], { d: 260 }).finished.then(() => { if (kb.capturing) cov.hidden = true; }).catch(() => {}); }
  else { cov.hidden = false; anim(cov, [{ opacity: 0 }, { opacity: 1 }], { d: 260 }); $('#kbCover b', el).textContent = kb.layout && kbDoneN() >= kbTotal() ? t('Every key works') : t('Test paused'); $('#kbStart', el).innerHTML = `${ic('keyboard')}${t('Keep testing')}`; }
  $('#kbStop', el).hidden = !on;
}
const keyEls = code => kb.el ? $$(`.k[data-code="${code}"]`, kb.el) : [];
const keyName = c => { const k = keyEls(c)[0]; const l = k && k.textContent.trim(); return l && l.length <= 12 ? l : String(c).replace(/^(Key|Digit)/, ''); };
function updKb(el) {
  if (!el || !kb.layout) return; const n = kbDoneN(), tot = kbTotal(), nEl = $('#kbN', el);
  if (+nEl.textContent !== n) { nEl.textContent = n; anim(nEl, [{ transform: 'translateY(-4px)', opacity: .5 }, { transform: 'none', opacity: 1 }], { d: 220 }); }
  $('#kbTot', el).textContent = t('of {n} keys', { n: tot });
  const miss = [...kbCodes()].filter(c => kb.missing.has(c)).length, mEl = $('#kbMissN', el);
  mEl.hidden = !miss; mEl.textContent = miss === 1 ? t('{n} key marked as missing', { n: miss }) : t('{n} keys marked as missing', { n: miss });
  $('#kbBar', el).style.transform = `scaleX(${(tot ? Math.min(1, n / tot) : 0).toFixed(3)})`; $('#kbRoll', el).textContent = kb.maxRoll; $('#kbPress', el).textContent = SH.fmtInt(kb.presses);
  const w = [...[...kb.stuck].map(c => `<div class="chip warn">${ic('alert')}${t('{key} has been held for over 5 s', { key: esc(keyName(c)) })}</div>`)];
  if (kb.chatter.size) w.push(`<div class="chip bad" title="${esc(t('The key sent a second press a few milliseconds after a very short one, more than once, without you pressing it again. Usually a worn or dirty switch.'))}">${ic('alert')}<span>${kb.chatter.size === 1 ? t('{key}: possible chatter', { key: `<kbd>${esc(keyName([...kb.chatter][0]))}</kbd>` }) : t('Possible chatter: {keys}', { keys: [...kb.chatter].map(c => `<kbd>${esc(keyName(c))}</kbd>`).join(' ') })}</span></div>`);
  $('#kbWarn', el).innerHTML = w.length ? w.join('') : `<span class="faint">${t('Nothing odd so far.')}</span>`;
}
/* Keys whose keyup may never arrive: Win opens Start (the page loses focus), Print Screen is taken by Windows.
   Their keydown counts as a complete press and they release by themselves; on focus loss every key is released. */
const META = ['MetaLeft', 'MetaRight', 'OSLeft', 'OSRight'];
const AUTO = new Set([...META, 'PrintScreen']);
function keyUpVisual(code) {
  keyEls(code).forEach(k => { k.classList.remove('down', 'warn'); k.getAnimations().forEach(x => { if (!(window.CSSTransition && x instanceof CSSTransition)) x.cancel(); }); anim(k, [{ transform: 'translateY(2px) scale(.95)' }, { transform: 'translateY(0) scale(1)' }], { d: 260, e: EASE.spring, keep: true }); });
}
function releaseKey(code) {
  clearTimeout(kb.autoT[code]); delete kb.autoT[code];
  const was = kb.down.delete(code); kb.stuck.delete(code); if (was) kb.lastUp[code] = performance.now();
  keyUpVisual(code);
}
function releaseAll() {
  [...kb.down.keys()].forEach(releaseKey); Object.keys(kb.autoT).forEach(releaseKey);
  if (kb.el) $$('.k.down, .k.warn', kb.el).forEach(k => releaseKey(k.dataset.code));
  kb.stuck.clear(); kb.escT = 0; const r = kb.el && $('.esc-ring', kb.el); if (r) r.style.transform = 'scaleX(0)';
  if (kb.el) updKb(kb.el);
}
/* Print Screen or Win seen only on keyup: it counts as a full press */
function virtualPress(code, e) {
  kb.presses++; const fresh = !kb.tested.has(code); kb.tested.add(code); if (kb.missing.has(code)) toggleMissing(code);
  keyEls(code).forEach(k => { k.classList.add('done'); anim(k, [{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(2px) scale(.95)' }, { transform: 'translateY(0) scale(1)' }], { d: 320, e: EASE.out, keep: true });
    if (fresh && !isMin()) { const r = document.createElement('i'); r.className = 'rip'; k.appendChild(r); anim(r, [{ transform: 'scale(.2)', opacity: .8 }, { transform: 'scale(2.6)', opacity: 0 }], { d: 520 }).finished.then(() => r.remove()).catch(() => r.remove()); } });
  $('#kbLast', kb.el).textContent = `${e.key || code}  (${code})`;
}
addEventListener('keydown', e => {
  if (!kb.capturing || !active('keyboard')) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const code = e.code || e.key; if (e.repeat) return;
  if (!au.voices.size && !au.sweep) SH.sound('key_press');  /* a soft tick per press, never over the Speakers test's own tones */
  const now = performance.now(), ts = e.timeStamp || now, pv = kb.ev[code];
  if (pv && pv.up && ts - pv.up < 30 && pv.up - pv.down < 40 && kb.down.size < 2 && !kb.chatter.has(code)) {
    kb.chatN[code] = (kb.chatN[code] || 0) + 1; if (kb.chatN[code] >= 2) kb.chatter.add(code);
  }
  kb.ev[code] = { down: ts, up: 0 };
  kb.down.set(code, now); kb.presses++; kb.maxRoll = Math.max(kb.maxRoll, kb.down.size);
  if (code.startsWith('Numpad') && kbFmt() !== 'full' && kbFmt() !== 'laptopnum' && !kb.sugNum) showSug(kb.el);
  if (kb.missing.has(code)) toggleMissing(code);    // pressed, so the keyboard does have it
  const ks = keyEls(code); const fresh = !kb.tested.has(code); kb.tested.add(code);
  ks.forEach(k => { k.classList.add('down', 'done'); anim(k, [{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(2px) scale(.95)' }], { d: 70, e: EASE.out, keep: true });
    if (fresh && !isMin()) { const r = document.createElement('i'); r.className = 'rip'; k.appendChild(r); anim(r, [{ transform: 'scale(.2)', opacity: .8 }, { transform: 'scale(2.6)', opacity: 0 }], { d: 520 }).finished.then(() => r.remove()).catch(() => r.remove()); } });
  $('#kbLast', kb.el).textContent = (e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key) + (code !== e.key ? `  (${code})` : '');
  if (code === 'Escape') kb.escT = now;
  if (AUTO.has(code)) { clearTimeout(kb.autoT[code]); kb.autoT[code] = setTimeout(() => { releaseKey(code); updKb(kb.el); }, 260); }
  updKb(kb.el);
}, true);
addEventListener('keyup', e => {
  if (!kb.capturing || !active('keyboard')) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const code = e.code || e.key;
  if (kb.ev[code]) kb.ev[code].up = e.timeStamp || performance.now();
  if (AUTO.has(code) && !kb.down.has(code) && !kb.autoT[code]) { virtualPress(code, e); updKb(kb.el); return; }
  releaseKey(code);
  if (code === 'Escape') { kb.escT = 0; const r = $('.esc-ring', kb.el); if (r) r.style.transform = 'scaleX(0)'; }
  updKb(kb.el);
}, true);
/* Start menu, Alt + Tab, Win + D, another window…: the page never gets those keyups */
addEventListener('blur', releaseAll);
addEventListener('focus', releaseAll);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
tickers.add(() => {
  if (!kb.capturing || !active('keyboard')) return; const now = performance.now();
  if (kb.escT) { const p = Math.min(1, (now - kb.escT) / 1000); const r = $('.esc-ring', kb.el); if (r) r.style.transform = `scaleX(${p})`; if (p >= 1) { kb.escT = 0; setCapture(kb.el, false); } }
  let ch = false;
  kb.down.forEach((t, c) => { if (c !== 'Escape' && !AUTO.has(c) && now - t > 5000 && !kb.stuck.has(c)) { kb.stuck.add(c); ch = true; keyEls(c).forEach(k => k.classList.add('warn')); } }); if (ch) updKb(kb.el);
});

/* ========================= Screen ========================= */
const SCREENS = [
  { n: t('Black'), bg: '#000', why: t('Look for bright dots: stuck pixels that never turn off.') },
  { n: t('White'), bg: '#fff', dark: true, why: t('Look for dark dots: dead pixels.') },
  { n: t('Red'), bg: '#f00', why: t('A broken red subpixel shows up as a black dot.') },
  { n: t('Green'), bg: '#0f0', dark: true, why: t('A broken green subpixel shows up as a black dot.') },
  { n: t('Blue'), bg: '#00f', why: t('A broken blue subpixel shows up as a black dot.') },
  { n: t('Mid gray'), bg: '#808080', dark: true, why: t('Look for blotches or lighter areas: panel uniformity.') },
  { n: t('Gradient'), bg: 'linear-gradient(90deg,#000,#fff)', why: t('It should look smooth, with no visible steps.') },
  { n: t('Colors'), bg: 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)', why: t('Smooth transitions between all colors.') },
  { n: t('Grid'), bg: 'repeating-linear-gradient(0deg,#fff 0 1px,#000 1px 40px),repeating-linear-gradient(90deg,#fff 0 1px,transparent 1px 40px)', why: t('Lines should be straight and sharp all the way to the edges.') },
];
const scr = { seen: new Set(), i: 0, ov: null, hz: 0, frames: [] };
function renderScreen(el) {
  el.classList.add('fill');
  el.innerHTML = `<div class="sc">
    <div class="pan sc-main" data-asm><div class="sc-hd"><div><h4>${t('Dead pixels and uniformity')}</h4><p class="muted">${t('Opens full screen. Click, Space or the arrow keys to change color. Esc to exit.')}</p></div>
      <button class="btn pri lg" id="scGo">${ic('fullscreen')}${t('Start full screen')}</button></div>
      <div class="sc-tiles">${SCREENS.map((s, i) => `<button class="sc-t" data-i="${i}" style="--bg:${s.bg}"><span class="sw"></span><b>${s.n}</b><i class="sc-ok">${ic('check')}</i></button>`).join('')}</div>
      <div class="sc-n faint" id="scN">${t('Seen {n} of {total}', { n: 0, total: SCREENS.length })}</div></div>
    <div class="sc-side">
      <div class="pan" data-asm><h4>${t('Refresh rate')}</h4><div class="kb-n"><b class="big" id="scHz">–</b><span class="muted">${t('Hz measured')}</span></div><p class="faint sc-p" id="scHzP">${t('Measured from how often this window repaints. It should match the refresh rate set in Display settings.')}</p></div>
      <div class="pan sc-mp" data-asm><h4>${t('Motion clarity')}</h4><div class="sc-motion"><span id="scBall"></span></div><p class="faint sc-p">${t('The block should move with no trail or stutter.')}</p></div>
    </div></div>`;
  SH.engine('system', 'displays').then(ds => {     // what Windows has each screen set to (inside the app only)
    const p = $('#scHzP', el); if (!p || !Array.isArray(ds) || !ds.length) return;
    const one = d => ds.length > 1 ? t(d.primary ? '{hz} Hz on the main screen ({w}×{h})' : '{hz} Hz on the other screen ({w}×{h})', d) : t('{hz} Hz ({w}×{h})', d);
    const list = ds.map(one); let txt;
    try { txt = new Intl.ListFormat(SH.i18n.locale, { type: 'conjunction' }).format(list); } catch { txt = list.join(', '); }
    p.textContent = t(ds.length > 1 ? "Windows has these screens set to {list}. The measured number should match the screen this window is on; if it's much lower, a game, a power plan or a cable may be limiting it." : "Windows has this screen set to {list}. The measured number should match the screen this window is on; if it's much lower, a game, a power plan or a cable may be limiting it.", { list: txt });
  }).catch(() => {});
  $('#scGo', el).addEventListener('click', () => openScreen(el, 0));
  $('.sc-tiles', el).addEventListener('click', e => { const t = e.target.closest('.sc-t'); if (t) openScreen(el, +t.dataset.i); });
  scr.el = el;
}
function markSeen(i) { scr.seen.add(i); if (!scr.el) return; const tile = $(`.sc-t[data-i="${i}"]`, scr.el); if (tile && !tile.classList.contains('seen')) { tile.classList.add('seen'); } $('#scN', scr.el).textContent = t('Seen {n} of {total}', { n: scr.seen.size, total: SCREENS.length }); }
function openScreen(el, i) {
  if (scr.ov) return;
  const ov = document.createElement('div'); ov.className = 'sc-ov'; ov.innerHTML = `<div class="sc-hint"><b></b><span></span><em>${t('Click or arrow keys to change, Esc to exit')}</em></div>`;
  document.body.appendChild(ov); scr.ov = ov; scr.i = i;
  const show = (j, dir = 1) => { scr.i = (j + SCREENS.length) % SCREENS.length; const s = SCREENS[scr.i]; ov.style.background = s.bg; markSeen(scr.i);
    const h = $('.sc-hint', ov); $('b', h).textContent = s.n; $('span', h).textContent = s.why; h.classList.toggle('dark', !!s.dark);
    anim(h, [{ opacity: 0, transform: `translate3d(${dir * 20}px,0,0)` }, { opacity: 1, transform: 'none', offset: .15 }, { opacity: 1, offset: .75 }, { opacity: 0 }], { d: 2600 }); };
  const close = () => { if (!scr.ov) return; removeEventListener('keydown', onKey, true); document.removeEventListener('fullscreenchange', onFs);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    anim(ov, [{ opacity: 1 }, { opacity: 0 }], { d: 200 }).finished.then(() => ov.remove()).catch(() => ov.remove()); scr.ov = null; };
  const onKey = e => { e.preventDefault(); e.stopImmediatePropagation(); if (e.type !== 'keydown') return;
    if (e.key === 'Escape') close(); else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') show(scr.i - 1, -1); else if (['ArrowRight', 'ArrowDown', ' ', 'Enter'].includes(e.key)) show(scr.i + 1, 1); };
  const onFs = () => { if (!document.fullscreenElement) close(); };
  addEventListener('keydown', onKey, true);
  ov.addEventListener('click', () => show(scr.i + 1, 1)); ov.addEventListener('contextmenu', e => { e.preventDefault(); show(scr.i - 1, -1); });
  anim(ov, [{ opacity: 0 }, { opacity: 1 }], { d: 220 });
  const req = ov.requestFullscreen ? ov.requestFullscreen() : null;
  if (req && req.then) req.then(() => document.addEventListener('fullscreenchange', onFs)).catch(() => {});
  show(i);
}
tickers.add((dt, t) => {
  if (!active('screen')) { scr.frames.length = 0; return; }
  scr.frames.push(t); while (scr.frames.length && t - scr.frames[0] > 1000) scr.frames.shift();
  if (scr.frames.length > 10) { const hz = Math.round((scr.frames.length - 1) / ((scr.frames[scr.frames.length - 1] - scr.frames[0]) / 1000)); if (Math.abs(hz - scr.hz) > 1) { scr.hz = hz; const e = $('#scHz', scr.el); if (e) e.textContent = hz; } }
  const b = scr.el && $('#scBall', scr.el); if (b && !isMin()) { const w = b.parentElement.clientWidth - 40; const x = (Math.sin(t / 700) * .5 + .5) * w; b.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`; }
});

/* ========================= Speakers ========================= */
const au = { ctx: null, vol: .5, sweep: null, voices: new Set() };
function audioCtx() { if (!au.ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; au.ctx = new C(); } if (au.ctx.state === 'suspended') au.ctx.resume(); return au.ctx; }
function renderSpeakers(el) {
  el.classList.add('fill');
  el.innerHTML = `<div class="sp">
    <div class="pan sp-stage" data-asm>
      <div class="sp-spk" data-side="L"><div class="sp-cone"><i></i><i></i><i></i><span></span></div><b>${t('Left')}</b></div>
      <div class="sp-mid"><div class="sp-btns">
        <button class="btn sec lg" data-play="L">${ic('speaker')}${t('Left')}</button><button class="btn pri lg" data-play="C">${ic('speaker')}${t('Both')}</button><button class="btn sec lg" data-play="R">${ic('speaker')}${t('Right')}</button></div>
        <p class="faint">${t('Each button plays three notes. If they play on the wrong side, the cables or the settings are swapped.')}</p>
        <label class="sp-vol"><span class="muted">${t('Test volume')}</span><input type="range" min="0" max="100" value="50" id="spVol"><b id="spVolV">50%</b></label></div>
      <div class="sp-spk" data-side="R"><div class="sp-cone"><i></i><i></i><i></i><span></span></div><b>${t('Right')}</b></div>
    </div>
    <div class="pan sp-sweep" data-asm><div class="sp-sh"><div><h4>${t('Frequency sweep')}</h4><p class="muted">${t('From 20 Hz to 20 kHz in 12 seconds. Notice where you start and stop hearing it, and whether anything rattles or buzzes.')}</p></div>
      <button class="btn sec" id="spSweep">${ic('wave')}${t('Start the sweep')}</button></div>
      <div class="sp-scale"><div class="sp-track"><span id="spProg"></span><i id="spHead"></i></div><div class="sp-ticks">${['20 Hz', '100 Hz', '1 kHz', '5 kHz', '20 kHz'].map(x => `<span>${x}</span>`).join('')}</div></div>
      <div class="sp-now"><b class="big" id="spHz">20 Hz</b><span class="muted" id="spHzL">${t('ready to start')}</span><span class="chip warn sp-tip">${ic('alert')}${t('Turn the volume down first: high tones can be unpleasant')}</span></div></div></div>`;
  au.el = el;
  $('#spVol', el).addEventListener('input', e => { au.vol = e.target.value / 100; $('#spVolV', el).textContent = e.target.value + '%'; if (au.sweep) au.sweep.g.gain.value = au.vol * .25; });
  $('.sp-btns', el).addEventListener('click', e => { const b = e.target.closest('[data-play]'); if (b) playSide(b.dataset.play); });
  $('#spSweep', el).addEventListener('click', () => au.sweep ? stopSweep() : startSweep());
}
function cone(side, on) { const s = au.el && $(`.sp-spk[data-side="${side}"]`, au.el); if (s) s.classList.toggle('play', on); }
/* The rings follow the sound that is really playing: each button press is a "voice" that ends with its last note
   (onended), with a timer as a fallback. Before, one shared timer was replaced on every click, so Left then Right
   cancelled the timer that had to turn the left speaker off and it kept animating. */
function coneSync() {
  const on = { L: !!au.sweep, R: !!au.sweep };
  au.voices.forEach(v => v.sides.forEach(s => { on[s] = true; }));
  cone('L', on.L); cone('R', on.R);
}
function stopVoice(v, fade) {
  if (!au.voices.delete(v)) return; clearTimeout(v.timer);
  const c = au.ctx, now = c ? c.currentTime : 0;
  v.oscs.forEach(o => { o.onended = null; try { o.stop(fade && c ? now + .06 : 0); } catch {} });
  if (fade && c) { try { v.out.gain.cancelScheduledValues(now); v.out.gain.setTargetAtTime(0, now, .015); } catch {} }
  setTimeout(() => { try { v.out.disconnect(); } catch {} }, fade ? 120 : 0);
}
function stopNotes() { [...au.voices].forEach(v => stopVoice(v, true)); coneSync(); }
function playSide(side) {
  const c = audioCtx(); if (!c) { SH.toast(t("This PC can't play audio here."), { kind: 'error' }); return; }
  stopNotes();    // a new click replaces the notes still playing
  const pan = c.createStereoPanner ? c.createStereoPanner() : null; if (pan) pan.pan.value = side === 'L' ? -1 : side === 'R' ? 1 : 0;
  const out = c.createGain(); out.gain.value = au.vol * .35; (pan ? (out.connect(pan), pan) : out).connect(c.destination);
  const v = { sides: side === 'C' ? ['L', 'R'] : [side], oscs: [], out, timer: 0 };
  const end = () => { stopVoice(v); coneSync(); };
  [523.25, 659.25, 783.99].forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = f; const t0 = c.currentTime + i * .22;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(1, t0 + .02); g.gain.exponentialRampToValueAtTime(.001, t0 + .5); o.connect(g).connect(out); o.start(t0); o.stop(t0 + .55); v.oscs.push(o); });
  v.oscs[v.oscs.length - 1].onended = end;
  v.timer = setTimeout(end, 1400);    // if the audio device stalls, onended may never come
  au.voices.add(v); coneSync();
}
function startSweep() {
  const c = audioCtx(); if (!c) return; const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; g.gain.value = au.vol * .25;
  const T = 12, t0 = c.currentTime; o.frequency.setValueAtTime(20, t0); o.frequency.exponentialRampToValueAtTime(20000, t0 + T); o.connect(g).connect(c.destination); o.start(); o.stop(t0 + T);
  au.sweep = { o, g, t0, T }; $('#spHzL', au.el).textContent = t('playing now'); o.onended = () => stopSweep(true); $('#spSweep', au.el).innerHTML = `${ic('stop')}${t('Stop')}`;
  clearTimeout(au.sweepT); au.sweepT = setTimeout(() => stopSweep(true), (T + 1) * 1000); coneSync();
}
function stopSweep(ended) {
  clearTimeout(au.sweepT); if (!au.sweep) return; try { au.sweep.o.onended = null; au.sweep.o.stop(); } catch {} au.sweep = null; coneSync();
  if (au.el) { $('#spSweep', au.el).innerHTML = `${ic('wave')}${t('Start the sweep')}`; $('#spHzL', au.el).textContent = ended ? t('sweep finished') : t('stopped'); }
}
tickers.add(() => {
  if (!au.sweep || !au.el) return; const k = Math.min(1, (au.ctx.currentTime - au.sweep.t0) / au.sweep.T); const f = 20 * Math.pow(1000, k);
  $('#spHz', au.el).textContent = f >= 1000 ? fmt1(f / 1000) + ' kHz' : Math.round(f) + ' Hz';
  $('#spProg', au.el).style.transform = `scaleX(${k.toFixed(4)})`; $('#spHead', au.el).style.left = (k * 100).toFixed(2) + '%';
});
function closeAudio() { stopSweep(); [...au.voices].forEach(v => stopVoice(v)); coneSync(); if (au.ctx) { au.ctx.close().catch(() => {}); au.ctx = null; } }
/* the window hidden or minimized: the notes are cut and the rings stop with them */
document.addEventListener('visibilitychange', () => { if (document.hidden && au.voices.size) stopNotes(); });

/* ========================= Microphone ========================= */
const mic = { stream: null, an: null, ctx: null, buf: null, peak: 0, lvl: 0, rec: null };
/* camera and microphone errors: title, explanation and whether a trip to Windows Settings is needed */
const denied = e => !!e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
const MEDIA_ERR = (e, what) => {
  const m = what === 'microphone';
  if (denied(e)) return { t: t('Permission missing'), m: m
    ? t("Access to the microphone was denied and Windows won't ask again. Open Settings > Privacy & security > Microphone, turn on access and also “Let desktop apps access your microphone”. Then try again.")
    : t("Access to the camera was denied and Windows won't ask again. Open Settings > Privacy & security > Camera, turn on access and also “Let desktop apps access your camera”. Then try again.") };
  if (e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError')) return m
    ? { t: t('No microphone found'), m: t("Windows can't find a connected microphone. If it's USB, plug it in and try again.") }
    : { t: t('No camera found'), m: t("Windows can't find a connected camera. If it's USB, plug it in and try again.") };
  if (e && e.name === 'NotReadableError') return m
    ? { t: t('The microphone is busy'), m: t('Another program is using the microphone (Discord, OBS, Teams…). Close it and try again.') }
    : { t: t('The camera is busy'), m: t('Another program is using the camera (Discord, OBS, Teams…). Close it and try again.') };
  return { t: m ? t("Couldn't open the microphone") : t("Couldn't open the camera"), m: e && e.message ? e.message : t('Unknown error.') };
};
const PRIV = { mic: 'ms-settings:privacy-microphone', cam: 'ms-settings:privacy-webcam' };
const openPriv = k => SH.call('open_url', PRIV[k]).then(r => { if (r === undefined) SH.toast(t('This opens Windows Settings from inside the app.')); });
function renderMic(el) {
  el.classList.add('fill');
  el.innerHTML = `<div class="mc">
    <div class="pan mc-main" data-asm>
      <div class="mc-state" id="mcState"><div class="mc-ico">${SH.emptyArt('first')}</div><b>${t('Test your microphone')}</b><span class="muted">${t("You'll see the level and the waveform live. Nothing is recorded or sent anywhere.")}</span><div class="mc-btns"><button class="btn pri lg" id="mcGo">${ic('mic')}${t('Allow the microphone')}</button><button class="btn sec lg" id="mcPerm" hidden>${ic('external')}${t('Open Windows permissions')}</button></div></div>
      <div class="mc-live" id="mcLive" hidden><canvas id="mcWave"></canvas>
        <div class="mc-meter"><div class="mc-bar"><span id="mcLvl"></span><i id="mcPeak"></i></div><div class="mc-db"><b id="mcDb">–</b><span class="muted">dB</span></div></div></div></div>
    <div class="mc-side">
      <div class="pan" data-asm><h4>${t('Device')}</h4><select class="field mc-sel" id="mcDev" disabled><option>${t('No permission yet')}</option></select><div class="mc-info faint" id="mcInfo"></div></div>
      <div class="pan mc-recp" data-asm><h4>${t('Hear yourself')}</h4><p class="muted mc-p">${t("Record 5 seconds and they play back on their own. That's how others hear you.")}</p>
        <button class="btn sec" id="mcRec" disabled>${ic('rec')}${t('Record 5 s')}</button><div class="bar acc mc-recbar"><span id="mcRecP" style="transform:scaleX(0)"></span></div></div>
      <button class="btn ghost" id="mcStop" hidden data-asm>${t('Turn off the microphone')}</button></div></div>`;
  mic.el = el;
  $('#mcGo', el).addEventListener('click', () => startMic());
  $('#mcPerm', el).addEventListener('click', () => openPriv('mic'));
  $('#mcDev', el).addEventListener('change', e => startMic(e.target.value));
  $('#mcStop', el).addEventListener('click', () => { stopMic(); showMicState(); });
  $('#mcRec', el).addEventListener('click', recordMic);
}
function showMicState(err, bad, e) {
  const el = mic.el; if (!el) return; $('#mcLive', el).hidden = true; const st = $('#mcState', el); st.hidden = false; st.classList.toggle('bad', !!bad);
  $('#mcPerm', el).hidden = !denied(e);
  if (err) { $('b', st).textContent = err.t; $(':scope > span', st).textContent = err.m; $('#mcGo', st).innerHTML = `${ic('restore')}${t('Try again')}`; }
  $('#mcStop', el).hidden = true; $('#mcRec', el).disabled = true;
  anim(st, [{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { d: 320, e: EASE.spring });
}
async function startMic(deviceId) {
  stopMic(); const el = mic.el;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { showMicState({ t: t('No microphone access'), m: t("This environment doesn't give access to the microphone.") }, true); return; }
  const go = $('#mcGo', el); go.disabled = true; go.textContent = t('Waiting for permission…');
  try {
    mic.stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
    if (!active('mic')) { stopMic(); return; }
    const C = window.AudioContext || window.webkitAudioContext; mic.ctx = new C(); const src = mic.ctx.createMediaStreamSource(mic.stream);
    mic.an = mic.ctx.createAnalyser(); mic.an.fftSize = 2048; src.connect(mic.an); mic.buf = new Float32Array(mic.an.fftSize);
    const tr = mic.stream.getAudioTracks()[0]; const s = tr.getSettings ? tr.getSettings() : {};
    $('#mcInfo', el).textContent = [s.sampleRate ? `${SH.fmtInt(s.sampleRate)} Hz` : '', s.channelCount ? `${s.channelCount === 1 ? t('mono') : t('{n} channels', { n: s.channelCount })}` : '', s.echoCancellation ? t('with echo cancellation') : ''].filter(Boolean).join(', ');
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
    const sel = $('#mcDev', el); sel.disabled = false; sel.innerHTML = devs.map((d, i) => `<option value="${esc(d.deviceId)}"${d.deviceId === s.deviceId ? ' selected' : ''}>${esc(d.label || t('Microphone {n}', { n: i + 1 }))}</option>`).join('');
    $('#mcState', el).hidden = true; const live = $('#mcLive', el); live.hidden = false; $('#mcStop', el).hidden = false; $('#mcRec', el).disabled = !window.MediaRecorder;
    anim(live, [{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { d: 360, e: EASE.spring });
  } catch (e) { stopMic(); showMicState(MEDIA_ERR(e, 'microphone'), true, e); }
  finally { go.disabled = false; }
}
function stopMic() {
  if (mic.rec && mic.rec.state === 'recording') try { mic.rec.stop(); } catch {}
  if (mic.stream) mic.stream.getTracks().forEach(t => t.stop()); mic.stream = null;
  if (mic.ctx) mic.ctx.close().catch(() => {}); mic.ctx = null; mic.an = null;
}
function recordMic() {
  if (!mic.stream || !window.MediaRecorder) return; const el = mic.el; const b = $('#mcRec', el); const chunks = [];
  const r = new MediaRecorder(mic.stream); mic.rec = r; r.ondataavailable = e => chunks.push(e.data);
  r.onstop = () => { const url = URL.createObjectURL(new Blob(chunks, { type: r.mimeType })); const a = new Audio(url); b.innerHTML = `${ic('speaker')}${t('Playing…')}`;
    a.onended = () => { b.disabled = false; b.innerHTML = `${ic('rec')}${t('Record 5 s')}`; URL.revokeObjectURL(url); }; a.play().catch(() => { b.disabled = false; b.innerHTML = `${ic('rec')}${t('Record 5 s')}`; }); };
  r.start(); b.disabled = true; b.innerHTML = `${ic('rec')}${t('Recording…')}`; const p = $('#mcRecP', el); p.style.transition = 'none'; p.style.transform = 'scaleX(0)';
  requestAnimationFrame(() => { p.style.transition = 'transform 5s linear'; p.style.transform = 'scaleX(1)'; });
  setTimeout(() => { if (r.state === 'recording') r.stop(); }, 5000);
}
tickers.add(dt => {
  if (!mic.an || !mic.el || !active('mic')) return; mic.an.getFloatTimeDomainData(mic.buf);
  let sum = 0, pk = 0; for (let i = 0; i < mic.buf.length; i++) { const v = mic.buf[i]; sum += v * v; pk = Math.max(pk, Math.abs(v)); }
  const rms = Math.sqrt(sum / mic.buf.length); const db = 20 * Math.log10(Math.max(rms, 1e-5)); const lv = Math.max(0, Math.min(1, (db + 60) / 60));
  mic.lvl += (lv - mic.lvl) * Math.min(1, dt * 18); mic.peak = Math.max(mic.peak - dt * .35, lv);
  $('#mcLvl', mic.el).style.transform = `scaleX(${mic.lvl.toFixed(3)})`; $('#mcPeak', mic.el).style.left = (mic.peak * 100).toFixed(1) + '%'; $('#mcDb', mic.el).textContent = db < -59 ? '−∞' : Math.round(db);
  const c = $('#mcWave', mic.el); const w = c.clientWidth, h = c.clientHeight; const d = Math.min(2, devicePixelRatio || 1); if (c.width !== Math.round(w * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
  const x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, w, h);
  const col = getComputedStyle(SH.ROOT).getPropertyValue('--accent2').trim() || '#9ED6FF';
  x.strokeStyle = 'rgba(170,200,245,.12)'; x.beginPath(); x.moveTo(0, h / 2); x.lineTo(w, h / 2); x.stroke();
  x.strokeStyle = col; x.lineWidth = 2; x.beginPath(); const step = mic.buf.length / w;
  for (let i = 0; i < w; i++) { const v = mic.buf[Math.floor(i * step)] || 0; const y = h / 2 - v * h * .45 * 2.2; i ? x.lineTo(i, y) : x.moveTo(i, y); } x.stroke();
});

/* ========================= Camera ========================= */
const cam = { stream: null, mirror: true };
function renderCamera(el) {
  el.classList.add('fill');
  el.innerHTML = `<div class="cm">
    <div class="pan cm-main" data-asm><div class="cm-frame" id="cmFrame"><video id="cmVid" playsinline muted></video><div class="cm-flash"></div>
      <div class="mc-state" id="cmState"><div class="mc-ico">${SH.emptyArt('first')}</div><b>${t('Test your camera')}</b><span class="muted">${t("You'll see the live image, its resolution and frames per second. Nothing leaves your PC.")}</span><div class="mc-btns"><button class="btn pri lg" id="cmGo">${ic('camera')}${t('Turn on the camera')}</button><button class="btn sec lg" id="cmPerm" hidden>${ic('external')}${t('Open Windows permissions')}</button></div></div></div></div>
    <div class="mc-side">
      <div class="pan" data-asm><h4>${t('Camera')}</h4><select class="field mc-sel" id="cmDev" disabled><option>${t('No permission yet')}</option></select>
        <div class="cm-specs"><div><span class="faint">${t('Resolution')}</span><b id="cmRes">–</b></div><div><span class="faint">${t('Frame rate')}</span><b id="cmFps">–</b></div></div>
        <div class="cm-row"><span>${t('Mirror image')}</span><button class="toggle on" id="cmMir" aria-label="${esc(t('Mirror image'))}"><i></i></button></div></div>
      <div class="pan cm-shotp" data-asm><h4>${t('Snapshots')}</h4><button class="btn sec" id="cmShot" disabled>${ic('shot')}${t('Take a snapshot')}</button><div class="cm-shots" id="cmShots"><span class="faint">${t("They'll show up here. They aren't saved.")}</span></div></div>
      <button class="btn ghost" id="cmStop" hidden>${t('Turn off the camera')}</button></div></div>`;
  cam.el = el;
  $('#cmGo', el).addEventListener('click', () => startCam());
  $('#cmPerm', el).addEventListener('click', () => openPriv('cam'));
  $('#cmDev', el).addEventListener('change', e => startCam(e.target.value));
  $('#cmStop', el).addEventListener('click', () => { stopCam(); camState(); });
  $('#cmMir', el).addEventListener('click', e => { cam.mirror = !cam.mirror; e.currentTarget.classList.toggle('on', cam.mirror); $('#cmFrame', el).classList.toggle('mirror', cam.mirror); });
  $('#cmShot', el).addEventListener('click', shot);
}
function camState(err, e) {
  const el = cam.el; if (!el) return; const st = $('#cmState', el); st.hidden = false; st.classList.toggle('bad', !!err);
  $('#cmPerm', el).hidden = !denied(e);
  if (err) { $('b', st).textContent = err.t; $(':scope > span', st).textContent = err.m; $('#cmGo', st).innerHTML = `${ic('restore')}${t('Try again')}`; }
  $('#cmStop', el).hidden = true; $('#cmShot', el).disabled = true; $('#cmRes', el).textContent = '–'; $('#cmFps', el).textContent = '–';
  anim(st, [{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { d: 320, e: EASE.spring });
}
async function startCam(deviceId) {
  stopCam(); const el = cam.el;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { camState({ t: t('No camera access'), m: t("This environment doesn't give access to the camera.") }); return; }
  const go = $('#cmGo', el); go.disabled = true; go.textContent = t('Waiting for permission…');
  try {
    cam.stream = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 1920 }, height: { ideal: 1080 } } });
    if (!active('camera')) { stopCam(); return; }
    const v = $('#cmVid', el); v.srcObject = cam.stream; await v.play().catch(() => {});
    const s = cam.stream.getVideoTracks()[0].getSettings(); $('#cmRes', el).textContent = s.width ? `${s.width} × ${s.height}` : '–'; $('#cmFps', el).textContent = s.frameRate ? t('{n} per second', { n: Math.round(s.frameRate) }) : '–';
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); const sel = $('#cmDev', el); sel.disabled = false;
    sel.innerHTML = devs.map((d, i) => `<option value="${esc(d.deviceId)}"${d.deviceId === s.deviceId ? ' selected' : ''}>${esc(d.label || t('Camera {n}', { n: i + 1 }))}</option>`).join('');
    const st = $('#cmState', el); anim(st, [{ opacity: 1 }, { opacity: 0, transform: 'scale(1.03)' }], { d: 240 }).finished.then(() => { if (cam.stream) st.hidden = true; }).catch(() => {});
    $('#cmFrame', el).classList.add('on'); $('#cmFrame', el).classList.toggle('mirror', cam.mirror); $('#cmStop', el).hidden = false; $('#cmShot', el).disabled = false;
  } catch (e) { stopCam(); camState(MEDIA_ERR(e, 'camera'), e); }
  finally { go.disabled = false; }
}
function stopCam() { if (cam.stream) cam.stream.getTracks().forEach(t => t.stop()); cam.stream = null; if (cam.el) { const v = $('#cmVid', cam.el); v.srcObject = null; $('#cmFrame', cam.el).classList.remove('on'); } }
function shot() {
  const el = cam.el, v = $('#cmVid', el); if (!v.videoWidth) return; const c = document.createElement('canvas'); c.width = 320; c.height = Math.round(320 * v.videoHeight / v.videoWidth);
  const x = c.getContext('2d'); if (cam.mirror) { x.translate(c.width, 0); x.scale(-1, 1); } x.drawImage(v, 0, 0, c.width, c.height);
  const box = $('#cmShots', el); const ph = $('.faint', box); if (ph) ph.remove(); const img = document.createElement('img'); img.src = c.toDataURL('image/jpeg', .85); box.prepend(img);
  while (box.children.length > 6) box.lastChild.remove();
  anim($('.cm-flash', el), [{ opacity: .85 }, { opacity: 0 }], { d: 380 }); anim(img, [{ opacity: 0, transform: 'scale(.6) rotate(-6deg)' }, { opacity: 1, transform: 'none' }], { d: 480, e: EASE.spring });
}

/* ========================= Mouse ========================= */
const ms = { count: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }, wheelUp: 0, wheelDown: 0, dbl: 0, last: {}, bounce: new Set(), pts: [], evs: [], hz: 0, dirty: false };
const BTN = { 0: t('Left'), 1: t('Wheel (click)'), 2: t('Right'), 3: t('Side back'), 4: t('Side forward') };
function mouseSVG() {
  return `<svg viewBox="0 0 120 190" class="ms-svg">
    <path class="ms-body" d="M60 6c30 0 50 22 50 58v62c0 32-22 58-50 58S10 158 10 126V64C10 28 30 6 60 6z"/>
    <path class="ms-b" data-b="0" d="M58 8C32 9 12 30 12 64v12h46z"/><path class="ms-b" data-b="2" d="M62 8c26 1 46 22 46 56v12H62z"/>
    <rect class="ms-b ms-wheel" data-b="1" x="53" y="26" width="14" height="30" rx="7"/>
    <path class="ms-arrow" data-w="up" d="M60 14l-5 6h10z"/><path class="ms-arrow" data-w="down" d="M60 68l-5-6h10z"/>
    <rect class="ms-b" data-b="4" x="4" y="84" width="8" height="18" rx="3"/><rect class="ms-b" data-b="3" x="4" y="106" width="8" height="18" rx="3"/></svg>`;
}
function renderMouse(el) {
  el.classList.add('fill');
  el.innerHTML = `<div class="ms">
    <div class="pan ms-cps" data-asm id="msCps"><h4>${t('CPS test')} <em>${t('clicks per second')}</em></h4>
      <div class="cps-pad" id="cpsPad"><svg class="cps-ring" viewBox="0 0 120 120"><circle class="bg" cx="60" cy="60" r="52"/><circle class="fg" id="cpsArc" cx="60" cy="60" r="52"/></svg>
        <div class="cps-num"><b id="cpsNow">${fmtCps(0)}</b><span id="cpsMsg">${t('Hover here and click as fast as you can')}</span></div></div>
      <canvas id="cpsCv"></canvas>
      <div class="cps-stats"><div><span class="muted">${t('Last')}</span><b id="cpsLast">–</b></div><div><span class="muted">${t('Best')}</span><b id="cpsBest">${cps.best ? fmtCps(cps.best) : '–'}</b></div><div><span class="muted">${t('Clicks')}</span><b id="cpsN">0</b></div></div></div>
    <div class="pan ms-area" data-asm id="msArea"><canvas id="msCv"></canvas><div class="ms-hint" id="msHint"><b>${t('Click every button, spin the wheel and move the mouse here')}</b><span class="muted">${t("Inside this box the side buttons don't go back or forward.")}</span></div></div>
    <div class="ms-side">
      <div class="pan ms-dia" data-asm>${mouseSVG()}<div class="ms-cnt">${[0, 2, 1, 3, 4].map(b => `<div data-c="${b}"><span class="muted">${BTN[b]}</span><b>0</b></div>`).join('')}<div data-c="wu"><span class="muted">${t('Wheel up')}</span><b>0</b></div><div data-c="wd"><span class="muted">${t('Wheel down')}</span><b>0</b></div></div></div>
      <div class="pan ms-stats" data-asm><div title="${esc(t("Measured from the time between the mouse's reports while it moves. Move it fast and in circles for the real number."))}"><span class="muted">${t('Polling rate')}</span><b id="msHz">–</b><em class="faint" id="msHzMax"></em></div><div><span class="muted">${t('Double clicks')}</span><b id="msDbl">0</b></div><div class="ms-w" id="msWarn"><span class="faint">${t('No chatter detected.')}</span></div></div>
      <button class="btn sec" id="msReset" data-asm>${ic('reset')}${t('Reset')}</button></div></div>`;
  ms.el = el; const area = $('#msArea', el);
  const hideHint = () => { const h = $('#msHint', el); if (h && !h.classList.contains('gone')) { h.classList.add('gone'); anim(h, [{ opacity: 1 }, { opacity: 0, transform: 'scale(.96)' }], { d: 240 }); } };
  area.addEventListener('pointerdown', e => { e.preventDefault(); hideHint(); const b = e.button; const now = performance.now();
    if (ms.last[b] && now - ms.last[b] < 60) { ms.bounce.add(b); } ms.last[b] = now; ms.count[b] = (ms.count[b] || 0) + 1; flash(b); ripple(e); updMouse(); });
  area.addEventListener('pointerup', e => { if (e.button === 3 || e.button === 4) e.preventDefault(); });
  area.addEventListener('mouseup', e => { if (e.button === 3 || e.button === 4) e.preventDefault(); });
  area.addEventListener('auxclick', e => e.preventDefault()); area.addEventListener('contextmenu', e => e.preventDefault());
  area.addEventListener('dblclick', () => { ms.dbl++; updMouse(); });
  area.addEventListener('wheel', e => { e.preventDefault(); hideHint(); if (e.deltaY < 0) { ms.wheelUp++; flashW('up'); } else if (e.deltaY > 0) { ms.wheelDown++; flashW('down'); } updMouse(); }, { passive: false });
  area.addEventListener('pointermove', e => { const r = area.getBoundingClientRect(); const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; const now = performance.now();
    evs.forEach(ev => { ms.pts.push({ x: ev.clientX - r.left, y: ev.clientY - r.top, t: now }); ms.evs.push(ev.timeStamp || now); }); ms.dirty = true; });
  $('#msReset', el).addEventListener('click', () => { Object.keys(ms.count).forEach(k => ms.count[k] = 0); ms.wheelUp = ms.wheelDown = ms.dbl = 0; ms.hzMax = 0; $('#msHzMax', el).textContent = ''; ms.bounce.clear(); ms.last = {}; updMouse(); });
  /* CPS test: the first click opens a 5 s window; it's measured live and the result stays when it ends */
  const pad = $('#cpsPad', el); cps.el = el;
  pad.addEventListener('pointerenter', () => pad.classList.add('hot'));
  pad.addEventListener('pointerleave', () => pad.classList.remove('hot'));
  pad.addEventListener('contextmenu', e => e.preventDefault());
  pad.addEventListener('pointerdown', e => {
    if (e.button !== 0) return; e.preventDefault();
    const now = performance.now();
    if (!cps.running) { if (now < cps.cool) return; cps.running = true; cps.t0 = now; cps.clicks = []; $('#cpsMsg', el).textContent = t('Keep going…'); pad.classList.remove('done'); }
    cps.clicks.push(now - cps.t0); $('#cpsN', el).textContent = cps.clicks.length;
    const b = $('#cpsNow', el); anim(b, [{ transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { d: 160, keep: true });
    if (!isMin()) { const r = pad.getBoundingClientRect(); const d = document.createElement('i'); d.className = 'cps-rip'; d.style.left = (e.clientX - r.left) + 'px'; d.style.top = (e.clientY - r.top) + 'px'; pad.appendChild(d);
      anim(d, [{ transform: 'translate(-50%,-50%) scale(.3)', opacity: .8 }, { transform: 'translate(-50%,-50%) scale(1.6)', opacity: 0 }], { d: 420 }).finished.then(() => d.remove()).catch(() => d.remove()); }
    drawCps();
  });
  drawCps();
}
const CPS_WIN = 5000;
const cps = { running: false, t0: 0, clicks: [], cool: 0, best: 0, el: null, shown: 0 };
const fmtCps = v => fmt1(v);
SH.on('boot', () => { cps.best = +(state.settings.cpsBest || 0); const b = cps.el && $('#cpsBest', cps.el); if (b && cps.best) b.textContent = fmtCps(cps.best); });
/* click bars per half second; only redrawn on a new click or when the test ends */
function drawCps() {
  const c = cps.el && $('#cpsCv', cps.el); if (!c) return;
  const w = c.clientWidth, h = c.clientHeight, d = Math.min(2, devicePixelRatio || 1); if (!w) return;
  if (c.width !== Math.round(w * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
  const x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, w, h);
  const N = 10, bins = Array(N).fill(0); cps.clicks.forEach(t => { const i = Math.min(N - 1, Math.floor(t / (CPS_WIN / N))); bins[i]++; });
  const max = Math.max(4, ...bins), bw = w / N, col = getComputedStyle(SH.ROOT).getPropertyValue('--accent').trim() || '#FF7A66';
  x.fillStyle = col;
  bins.forEach((v, i) => { const bh = v / max * (h - 4); x.globalAlpha = v ? .9 : .15; const y = h - Math.max(2, bh); x.beginPath(); x.roundRect ? x.roundRect(i * bw + 2, y, bw - 4, Math.max(2, bh), 3) : x.rect(i * bw + 2, y, bw - 4, Math.max(2, bh)); x.fill(); });
  x.globalAlpha = 1;
}
tickers.add(() => {
  if (!cps.running || !active('mouse') || !cps.el) return;
  const el = cps.el, now = performance.now(), dt0 = now - cps.t0, p = Math.min(1, dt0 / CPS_WIN);
  const arc = $('#cpsArc', el); if (arc) arc.style.strokeDashoffset = (326.7 * (1 - p)).toFixed(1);
  const v = cps.clicks.length / Math.max(.25, dt0 / 1000); if (Math.abs(v - cps.shown) > .04) { cps.shown = v; $('#cpsNow', el).textContent = fmtCps(v); }
  if (p >= 1) {
    cps.running = false; cps.cool = now + 700; const res = cps.clicks.length / (CPS_WIN / 1000); cps.shown = res;
    $('#cpsNow', el).textContent = fmtCps(res); $('#cpsLast', el).textContent = fmtCps(res);
    const rec = res > cps.best; if (rec) { cps.best = res; $('#cpsBest', el).textContent = fmtCps(res); SH.setSetting('cpsBest', res); }
    $('#cpsMsg', el).textContent = rec ? t('New best! Click to go again.') : t('Click to go again.');
    $('#cpsPad', el).classList.add('done'); anim($('#cpsNow', el), [{ transform: 'scale(1)' }, { transform: 'scale(1.18)', offset: .4 }, { transform: 'scale(1)' }], { d: 480, e: EASE.spring, keep: true });
    drawCps();
  }
});
function flash(b) { const p = ms.el && $(`.ms-b[data-b="${b}"]`, ms.el); if (!p) return; p.classList.add('hit'); anim(p, [{ opacity: 1 }, { opacity: .55 }], { d: 600 }); }
function flashW(dir) { const a = $(`.ms-arrow[data-w="${dir}"]`, ms.el); if (!a) return; a.classList.add('hit'); anim(a, [{ opacity: 1, transform: `translateY(${dir === 'up' ? -3 : 3}px)` }, { opacity: .35, transform: 'none' }], { d: 420 }); }
function ripple(e) { if (isMin()) return; const area = $('#msArea', ms.el); const r = area.getBoundingClientRect(); const d = document.createElement('i'); d.className = 'ms-rip b' + e.button; d.style.left = (e.clientX - r.left) + 'px'; d.style.top = (e.clientY - r.top) + 'px'; area.appendChild(d);
  anim(d, [{ transform: 'translate(-50%,-50%) scale(.2)', opacity: .9 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 0 }], { d: 600 }).finished.then(() => d.remove()).catch(() => d.remove()); }
/* polling rate = 1000 / median time between reports, only while the mouse keeps moving (pauses > 40 ms are ignored,
   otherwise slowing down would look like a slower mouse). Snapped to the usual rates when it's close to one. */
const RATES = [125, 250, 500, 1000, 2000, 4000, 8000];
function pollRate(ts) {
  const iv = []; for (let i = 1; i < ts.length; i++) { const d = ts[i] - ts[i - 1]; if (d > 0 && d < 40) iv.push(d); }
  if (iv.length < 30) return 0;
  iv.sort((a, b) => a - b); const hz = 1000 / iv[iv.length >> 1];
  const near = RATES.find(r => Math.abs(hz - r) / r < .12); return near || Math.round(hz);
}
function updMouse() {
  const el = ms.el; if (!el) return;
  const set = (k, v) => { const b = $(`[data-c="${k}"] b`, el); if (b && b.textContent !== String(v)) { b.textContent = v; anim(b, [{ transform: 'scale(1.3)', color: 'var(--accent)' }, { transform: 'none', color: 'var(--ink)' }], { d: 380 }); } };
  [0, 1, 2, 3, 4].forEach(b => set(b, ms.count[b] || 0)); set('wu', ms.wheelUp); set('wd', ms.wheelDown); $('#msDbl', el).textContent = ms.dbl;
  $('#msWarn', el).innerHTML = ms.bounce.size ? [...ms.bounce].map(b => `<div class="chip bad">${ic('alert')}${t('{button}: two presses in under 60 ms. The button may be chattering.', { button: BTN[b] })}</div>`).join('') : `<span class="faint">${t('No chatter detected.')}</span>`;
}
tickers.add(() => {
  if (!active('mouse') || !ms.el) return; const now = performance.now();
  while (ms.evs.length && now - ms.evs[0] > 1000) ms.evs.shift();
  const hz = pollRate(ms.evs); if (hz !== ms.hz) { ms.hz = hz; $('#msHz', ms.el).textContent = hz ? `~${SH.fmtInt(hz)} Hz` : t('move the mouse');
    if (hz > (ms.hzMax || 0)) { ms.hzMax = hz; $('#msHzMax', ms.el).textContent = t('best {n} Hz', { n: SH.fmtInt(hz) }); } }
  const life = isMin() ? 150 : 700; while (ms.pts.length && now - ms.pts[0].t > life) { ms.pts.shift(); ms.dirty = true; }
  if (!ms.dirty) return; ms.dirty = ms.pts.length > 0;
  const c = $('#msCv', ms.el); const w = c.clientWidth, h = c.clientHeight, d = Math.min(2, devicePixelRatio || 1); if (c.width !== Math.round(w * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
  const x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, w, h);
  const col = getComputedStyle(SH.ROOT).getPropertyValue('--accent2').trim() || '#9ED6FF'; x.lineCap = 'round';
  for (let i = 1; i < ms.pts.length; i++) { const a = ms.pts[i - 1], b = ms.pts[i]; const k = 1 - (now - b.t) / life; x.strokeStyle = col; x.globalAlpha = Math.max(0, k); x.lineWidth = 1 + k * 4; x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); }
  x.globalAlpha = 1;
});

/* ========================= Controller ========================= */
/* Standard Gamepad API: every button, both sticks with their dead zone and drift, the analog triggers, the polling
   rate and the rumble motors. Reads navigator.getGamepads() once per frame, only while this tab is open. */
SH.icons.add({ bluetooth: '<path d="m7 7 10 10-5 5V2l5 5L7 17"/>', usb: '<circle cx="12" cy="19" r="2"/><path d="M12 17V4M12 4 9.5 6.5M12 4l2.5 2.5M12 12l5-3V7M7 14l5-2"/><path d="M16 6h2v2h-2z"/>', gamepad: '<path d="M7 7h10a4.5 4.5 0 0 1 4.4 5.4l-.9 4.2a2.6 2.6 0 0 1-4.3 1.4L14 16h-4l-2.2 2.9a2.6 2.6 0 0 1-4.3-1.4l-.9-4.2A4.5 4.5 0 0 1 7 7z"/><path d="M8 10v3M6.5 11.5h3M15.5 10.5h.01M17.5 12.5h.01"/>' });
const PD_BTN = [[0, 'A'], [1, 'B'], [2, 'X'], [3, 'Y'], [4, 'LB'], [5, 'RB'], [6, 'LT'], [7, 'RT'], [8, SH.tc('tester', 'View')], [9, SH.tc('tester', 'Menu')], [10, t('Left stick click')], [11, t('Right stick click')],
  [12, t('D-pad up')], [13, t('D-pad down')], [14, t('D-pad left')], [15, t('D-pad right')]];
const PD_DIRS = [['ls', 'up', t('Left stick up')], ['ls', 'down', t('Left stick down')], ['ls', 'left', t('Left stick left')], ['ls', 'right', t('Left stick right')],
  ['rs', 'up', t('Right stick up')], ['rs', 'down', t('Right stick down')], ['rs', 'left', t('Right stick left')], ['rs', 'right', t('Right stick right')]];
const pd = { el: null, sel: -1, tested: new Set(), hist: [[], []], rest: [{ win: [] }, { win: [] }], sig: '', cnt: 0, t0: 0, ts: -1, frames: 0, hz: 0, hzMax: 0, lastMove: 0, lastAx: [0, 0, 0, 0], noStd: false,
  dz: +(state.settings.testerPadDz ?? 10), weak: 50, strong: 60, shown: {}, free: false, chordP: 0, refs: null, mode: null, statT: 0 };
const pdPads = () => [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(g => g && g.connected);
const pdName = id => String(id || t('Controller')).replace(/\s*\(.*$/, '').replace(/\s+/g, ' ').trim() || t('Controller');
const pdSigned = v => (v < 0 ? '−' : '+') + fmt1(Math.abs(v) * 100) + '%';
const pdOn = (el, k, v) => { if (el && pd.shown[k] !== v) { pd.shown[k] = v; return true; } return false; };
function padSVG() {
  const face = (b, x, y, l) => `<g class="pd-b pd-face" data-b="${b}"><circle cx="${x}" cy="${y}" r="14"/><text x="${x}" y="${y + 4.6}" text-anchor="middle">${l}</text></g>`;
  const well = (id, cx, cy) => `<g id="${id}w"><circle class="pd-well" cx="${cx}" cy="${cy}" r="42"/><circle class="pd-dz" id="${id}dz" cx="${cx}" cy="${cy}" r="3"/><circle class="pd-ring" cx="${cx}" cy="${cy}" r="34"/>
    <polyline class="pd-trail" id="${id}tr" points=""/><circle class="pd-head" id="${id}h" cx="${cx}" cy="${cy}" r="14" data-b="${id === 'ls' ? 10 : 11}"/></g>`;
  const trig = (b, x, l) => `<g class="pd-t" data-b="${b}"><rect class="pd-tb" x="${x}" y="14" width="58" height="30" rx="9"/><rect class="pd-tf" x="${x}" y="14" width="58" height="30" rx="9"/><text x="${x + 29}" y="34" text-anchor="middle">${l}</text></g>`;
  return `<svg viewBox="0 0 520 340" class="pd-svg" role="img" aria-label="${esc(t('Controller'))}">
    ${trig(6, 108, 'LT')}${trig(7, 354, 'RT')}
    <rect class="pd-b pd-bump" data-b="4" x="100" y="52" width="80" height="16" rx="8"/><rect class="pd-b pd-bump" data-b="5" x="340" y="52" width="80" height="16" rx="8"/>
    <path class="pd-body" d="M130 62C150 50 190 54 260 54S370 50 390 62C440 72 470 150 485 230C495 290 470 322 440 320C410 318 395 292 380 264C372 250 360 246 345 246L175 246C160 246 148 250 140 264C125 292 110 318 80 320C50 322 25 290 35 230C50 150 80 72 130 62Z"/>
    ${well('ls', 150, 130)}${well('rs', 330, 218)}
    <g class="pd-dpad"><rect class="pd-b" data-b="12" x="195" y="186" width="20" height="24" rx="5"/><rect class="pd-b" data-b="13" x="195" y="226" width="20" height="24" rx="5"/>
      <rect class="pd-b" data-b="14" x="173" y="208" width="24" height="20" rx="5"/><rect class="pd-b" data-b="15" x="213" y="208" width="24" height="20" rx="5"/><rect class="pd-dpc" x="195" y="208" width="20" height="20"/></g>
    ${face(0, 385, 158, 'A')}${face(1, 413, 130, 'B')}${face(2, 357, 130, 'X')}${face(3, 385, 102, 'Y')}
    <circle class="pd-b pd-small" data-b="8" cx="228" cy="130" r="8"/><circle class="pd-b pd-small" data-b="9" cx="292" cy="130" r="8"/><circle class="pd-b pd-guide" data-b="16" cx="260" cy="100" r="10"/>
  </svg>`;
}
function pdHowTo() {
  const li = a => a.map(x => `<li>${x}</li>`).join('');
  return `<div class="pd-howto"><div><h5>${ic('bluetooth')}Bluetooth</h5><ol>${li([t('Put the controller in pairing mode: hold its pairing or sync button until the light flashes.'), t('On Windows, open Settings > Bluetooth & devices > Add device > Bluetooth.'), t('Choose your controller, then press any button here.')])}</ol></div>
    <div><h5>${ic('usb')}USB</h5><ol>${li([t('Plug the controller into a USB port with its cable, or plug in its wireless adapter.'), t('Wait a few seconds while Windows sets it up.'), t('Press any button here.')])}</ol></div></div>`;
}
function renderController(el) {
  el.classList.add('fill'); pd.el = el;
  el.innerHTML = `<div class="pd empty" id="pdRoot">
    <div class="pan pd-stage" data-asm>
      <div class="pd-nav" id="pdNav" hidden></div>
      <div class="pd-live" id="pdLive" hidden>
        <div class="pd-draw">${padSVG()}</div>
        <div class="pd-trigs">${['LT', 'RT'].map((n, i) => `<div class="pd-tg" data-t="${i}"><span class="muted">${n}</span><div class="bar"><span style="transform:scaleX(0)"></span></div><b>0%</b></div>`).join('')}</div>
        <div class="pd-axes">${['LX', 'LY', 'RX', 'RY'].map((n, i) => `<div data-a="${i}"><span class="muted">${n}</span><b>0,00</b></div>`).join('')}</div>
      </div>
      <div class="pd-empty" id="pdEmpty"><div class="pd-eh"><div class="pd-ic">${ic('gamepad')}</div><b>${t('Connect a controller and press any button')}</b>
        <span class="muted">${t('StellarHub only sees a controller after you press a button on it.')}</span>
        <span class="faint pd-note">${t('Xbox, PlayStation, Switch and most generic controllers work. On a handheld like the ROG Ally, press a button on its built-in controller.')}</span></div>${pdHowTo()}</div>
    </div>
    <div class="pd-side">
      <div class="pan" data-asm><h4>${t('Controllers')}</h4><div class="pd-list" id="pdList"></div></div>
      <div class="pan" data-asm><h4>${t('Progress')}</h4><div class="kb-n"><b class="big" id="pdN">0</b><span class="muted" id="pdTot"></span></div><div class="bar" style="margin-top:12px"><span id="pdBar" style="transform:scaleX(0)"></span></div>
        <div class="pd-stats"><div title="${esc(t('Counted from the reports the controller sends while you move a stick or hold a button. Your screen can only show as many as its refresh rate.'))}"><span class="muted">${t('Polling rate')}</span><b id="pdHz">–</b></div>
        <div><span class="muted">${t('Buttons')}</span><b id="pdBc">–</b></div></div>
        <button class="btn sec pd-reset" id="pdReset">${ic('reset')}${t('Reset')}</button></div>
      <div class="pan" data-asm><h4>${t('Sticks')}</h4>
        <div class="pd-drift" id="pdDrift">${[0, 1].map(i => `<div data-s="${i}"><div class="pd-dh"><span>${i ? t('Right stick') : t('Left stick')}</span><span class="chip" id="pdDc${i}"></span></div><p class="faint" id="pdDp${i}"></p></div>`).join('')}</div>
        <div class="pd-dzr"><span class="muted">${t('Dead zone')}</span><input type="range" id="pdDz" min="0" max="30" step="1" value="${pd.dz}" aria-label="${esc(t('Dead zone'))}"><b id="pdDzv">${pd.dz}%</b></div></div>
      <div class="pan" data-asm><h4>${t('Vibration')}</h4><div id="pdVib"></div></div>
      <div class="pan" data-asm><h4>${t('Controls to test')}</h4><div class="pd-chk" id="pdChk"></div></div>
    </div></div>`;
  const R = pd.refs = { root: $('#pdRoot', el), live: $('#pdLive', el), empty: $('#pdEmpty', el), list: $('#pdList', el), n: $('#pdN', el), tot: $('#pdTot', el), bar: $('#pdBar', el), hz: $('#pdHz', el), bc: $('#pdBc', el), vib: $('#pdVib', el), chk: $('#pdChk', el), nav: $('#pdNav', el), dzv: $('#pdDzv', el),
    svg: $('.pd-svg', el), tg: $$('.pd-tg', el), ax: $$('.pd-axes [data-a]', el), bEls: new Map(), tf: $$('.pd-tf', el) };
  $$('[data-b]', R.svg).forEach(n => { const b = +n.dataset.b; if (!R.bEls.has(b)) R.bEls.set(b, []); R.bEls.get(b).push(n); });
  R.stick = [{ h: $('#lsh', el), dz: $('#lsdz', el), tr: $('#lstr', el), c: [150, 130] }, { h: $('#rsh', el), dz: $('#rsdz', el), tr: $('#rstr', el), c: [330, 218] }];
  $('#pdReset', el).addEventListener('click', () => { pd.tested.clear(); pd.rest.forEach(r => { r.win = []; r.has = false; }); pd.hzMax = 0; pdChecklist(); pdUpdate(true); SH.toast(t('Controller test reset.')); });
  $('#pdDz', el).addEventListener('input', e => { pd.dz = +e.target.value; R.dzv.textContent = pd.dz + '%'; pdDz(); });
  $('#pdDz', el).addEventListener('change', () => SH.setSetting('testerPadDz', pd.dz));
  R.list.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) { pd.sel = +b.dataset.i; pd.sig = ''; pd.shown = {}; } });
  R.vib.addEventListener('input', e => { const r = e.target.closest('input[data-m]'); if (r) { pd[r.dataset.m] = +r.value; $(`[data-mv="${r.dataset.m}"]`, R.vib).textContent = r.value + '%'; } });
  R.vib.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; const gp = pdPad(); const a = gp && gp.vibrationActuator; if (!a) return;
    if (b.dataset.v === 'stop') { try { a.reset && a.reset(); } catch {} return; }
    try { a.playEffect('dual-rumble', { startDelay: 0, duration: 700, weakMagnitude: pd.weak / 100, strongMagnitude: pd.strong / 100 }); } catch (err) { SH.toast(t('This controller did not accept the vibration.'), { kind: 'error' }); } });
  pdChecklist(); pdDz(); pdNavUI();
}
const pdPad = () => { const l = pdPads(); return l.find(g => g.index === pd.sel) || l[0] || null; };
const pdKeys = gp => (gp && gp.mapping !== 'standard' ? gp.buttons.map((_, i) => [i, t('Button {n}', { n: i })]) : PD_BTN).map(([i, l]) => ['b' + i, l]).concat(PD_DIRS.map(([s, d, l]) => [s + ':' + d, l]));
function pdChecklist() {
  const R = pd.refs; if (!R) return; const keys = pdKeys(pdPad());
  R.chk.innerHTML = keys.map(([k, l]) => `<span class="pd-k${pd.tested.has(k) ? ' done' : ''}" data-k="${k}">${ic('check')}${esc(l)}</span>`).join('');
  R.keys = keys.map(k => k[0]); pdProgress();
}
function pdProgress() {
  const R = pd.refs; if (!R || !R.keys) return; const n = R.keys.filter(k => pd.tested.has(k)).length, tot = R.keys.length;
  if (+R.n.textContent !== n) { R.n.textContent = n; anim(R.n, [{ transform: 'translateY(-4px)', opacity: .5 }, { transform: 'none', opacity: 1 }], { d: 220 }); }
  R.tot.textContent = t('of {n} controls', { n: tot }); R.bar.style.transform = `scaleX(${tot ? (n / tot).toFixed(3) : 0})`;
}
function pdMark(k) {
  if (pd.tested.has(k)) return; pd.tested.add(k);
  const c = pd.refs && $(`[data-k="${k}"]`, pd.refs.chk); if (c) { c.classList.add('done'); if (!isMin()) anim(c, [{ transform: 'scale(.88)' }, { transform: 'none' }], { d: 380, e: EASE.spring }); }
  pdProgress();
}
function pdDz() { const R = pd.refs; if (!R) return; R.stick.forEach(s => s.dz.setAttribute('r', Math.max(1.5, pd.dz / 100 * 34))); }
function pdNavUI() {
  const R = pd.refs; if (!R) return; const G = SH.gamepad, can = !!G && G.enabled();
  R.nav.hidden = !can || !pdPads().length;
  if (R.nav.hidden) return;
  R.nav.innerHTML = pd.free
    ? `${ic('gamepad')}<span>${t('The controller is moving around StellarHub right now.')}</span><button class="btn sec sm" id="pdNavBtn">${t('Test the buttons')}</button>`
    : `${ic('info')}<span>${t('Controller navigation is paused so you can test every button. Hold View + Menu for a second to use it again.')}</span><i class="pd-nb"><u id="pdNavBar"></u></i>`;
  const b = $('#pdNavBtn', R.nav); if (b) b.addEventListener('click', () => pdCapture(true));
}
function pdCapture(on) {
  const G = SH.gamepad; if (!G) return;
  if (!on) { G.release(); return; }
  pd.free = false; G.capture({ onExit: () => { pd.free = true; pdNavUI(); }, onProgress: p => { const u = pd.el && $('#pdNavBar', pd.el); if (u) u.style.transform = `scaleX(${p.toFixed(3)})`; } }); pdNavUI();
}
function pdVibUI(gp) {
  const R = pd.refs, ok = !!(gp && gp.vibrationActuator && gp.vibrationActuator.playEffect); const k = ok ? 'y' : 'n';
  if (pd.shown.vib === k) return; pd.shown.vib = k;
  R.vib.innerHTML = ok
    ? `<div class="pd-mot"><span class="muted">${t('Strong motor')}</span><input type="range" data-m="strong" min="0" max="100" step="5" value="${pd.strong}" aria-label="${esc(t('Strong motor'))}"><b data-mv="strong">${pd.strong}%</b></div>
       <div class="pd-mot"><span class="muted">${t('Weak motor')}</span><input type="range" data-m="weak" min="0" max="100" step="5" value="${pd.weak}" aria-label="${esc(t('Weak motor'))}"><b data-mv="weak">${pd.weak}%</b></div>
       <div class="pd-vb"><button class="btn sec" data-v="play">${ic('wave')}${t('Vibrate')}</button><button class="btn ghost" data-v="stop">${t('Stop')}</button></div>
       <p class="faint pd-vn">${t('The strong motor is usually in the left grip and the weak one in the right grip.')}</p>`
    : `<span class="chip">${ic('info')}${t('Vibration is not available for this controller or connection.')}</span>`;
}
function pdList(pads, sel) {
  const R = pd.refs; const sig = pads.map(g => g.index + g.id + g.mapping).join('|') + '#' + sel; if (sig === pd.sig) return; pd.sig = sig;
  R.list.innerHTML = pads.length ? pads.map(g => `<button class="pd-c${g.index === sel ? ' on' : ''}" data-i="${g.index}" title="${esc(g.id)}"><b>${esc(pdName(g.id))}</b>
    <span class="faint">${t('Controller {n}', { n: g.index + 1 })} · ${g.mapping === 'standard' ? t('standard layout') : t('non-standard layout')} · ${t('{b} buttons, {a} axes', { b: g.buttons.length, a: g.axes.length })}</span></button>`).join('')
    : `<span class="faint">${t('No controllers detected.')}</span>`;
  if (pads.length && pads.some(g => g.mapping !== 'standard')) R.list.insertAdjacentHTML('beforeend', `<div class="chip warn pd-ns">${ic('alert')}<span>${t('This controller does not report the standard layout, so the drawing may not match its buttons. The list below uses raw button numbers.')}</span></div>`);
}
function pdUpdate(force) {
  const R = pd.refs; if (!R) return; const pads = pdPads(); const gp = pdPad(); if (gp && pd.sel < 0) pd.sel = gp.index;
  const has = !!gp, was = R.root.classList.contains('empty');
  if (has === was) {
    R.root.classList.toggle('empty', !has); R.live.hidden = !has; R.empty.hidden = has; pdNavUI();
    if (!isMin()) anim(has ? R.live : R.empty, [{ opacity: 0, transform: 'translate3d(0,8px,0) scale(.98)' }, { opacity: 1, transform: 'none' }], { d: 460, e: EASE.spring });
    if (has) { pdChecklist(); pdDz(); }
  }
  pdList(pads, gp ? gp.index : -1);
  if (!has) { pd.ts = -1; return; }
  if (pdOn(R, 'map', gp.mapping + gp.index)) { pdChecklist(); pdNavUI(); }
  pdVibUI(gp);
  const now = performance.now();
  /* buttons */
  const btn = i => { const b = gp.buttons[i]; return b ? (b.pressed || b.value > .5) : false; };
  let down = 0;
  R.bEls.forEach((els, i) => { const on = btn(i); if (on) down++; if (pdOn(els, 'b' + i, on) || force) els.forEach(n => { n.classList.toggle('down', on); if (on && !isMin() && i !== 6 && i !== 7) anim(n, [{ transform: 'scale(.94)' }, { transform: 'none' }], { d: 240, e: EASE.spring, keep: true }); }); if (on) pdMark('b' + i); });
  const std = gp.mapping === 'standard'; if (!std) gp.buttons.forEach((_, i) => { if (btn(i)) pdMark('b' + i); });
  let tot = 0; for (let i = 0; i < gp.buttons.length; i++) if (btn(i)) tot++;
  if (pdOn(R.bc, 'bc', tot)) R.bc.textContent = tot ? tot : '–';
  /* triggers */
  [6, 7].forEach((bi, k) => {
    const b = gp.buttons[bi]; const v = b ? (b.value || (b.pressed ? 1 : 0)) : 0; const p = Math.round(v * 100);
    if (pdOn(R.tg[k], 'tg' + k, p)) { R.tg[k].querySelector('.bar span').style.transform = `scaleX(${v.toFixed(3)})`; R.tg[k].querySelector('b').textContent = p + '%'; R.tf[k].style.opacity = (.05 + .95 * v).toFixed(2); }
  });
  /* sticks */
  const ax = [0, 1, 2, 3].map(i => gp.axes[i] || 0); let moved = false;
  ax.forEach((v, i) => { if (Math.abs(v - pd.lastAx[i]) > .004) moved = true; if (pdOn(R.ax[i], 'ax' + i, Math.round(v * 100))) R.ax[i].querySelector('b').textContent = (v < 0 ? '−' : '') + Math.abs(v).toLocaleString(SH.i18n && SH.i18n.lang || undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); });
  pd.lastAx = ax; if (moved || tot) pd.lastMove = now;
  [0, 1].forEach(i => {
    const x = ax[i * 2], y = ax[i * 2 + 1], s = R.stick[i], key = i ? 'rs' : 'ls', mag = Math.hypot(x, y), k = mag > 1 ? 1 / mag : 1;
    const px = x * k * 34, py = y * k * 34;
    if (pdOn(s.h, 'h' + i, Math.round(px * 4) + ',' + Math.round(py * 4))) s.h.setAttribute('transform', `translate(${px.toFixed(2)} ${py.toFixed(2)})`);
    s.h.classList.toggle('act', mag > pd.dz / 100); s.h.classList.toggle('down', btn(10 + i));
    if (mag > .9) pdMark(key + ':' + (Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up')));
    const hs = pd.hist[i]; hs.push({ t: now, x: px, y: py }); while (hs.length && now - hs[0].t > 1100) hs.shift();
    const pts = hs.length > 1 && mag > .02 ? hs.map(p => `${(s.c[0] + p.x).toFixed(1)},${(s.c[1] + p.y).toFixed(1)}`).join(' ') : '';
    if (pts !== pd.shown['tr' + i]) { pd.shown['tr' + i] = pts; s.tr.setAttribute('points', pts); }
    pdDrift(i, x, y, now);
  });
  /* polling rate: distinct reports per second while something moves */
  pd.frames++;
  if (gp.timestamp !== pd.ts) { pd.ts = gp.timestamp; pd.cnt++; }
  if (now - pd.t0 >= 600) {
    const el = (now - pd.t0) / 1000, hz = pd.cnt / el, fps = pd.frames / el, live = now - pd.lastMove < 700;
    pd.t0 = now; pd.cnt = 0; pd.frames = 0;
    if (live && hz > 5) { pd.hz = hz; const capped = hz >= fps * .9; pd.hzMax = Math.max(pd.hzMax, hz); R.hz.textContent = (capped ? '≥ ' : '~') + SH.fmtInt(Math.round(hz)) + ' Hz'; R.hz.title = capped ? t('Your screen refreshes at about {n} Hz, so the real rate may be higher.', { n: SH.fmtInt(Math.round(fps)) }) : ''; }
    else if (!live && pd.hz === 0) R.hz.textContent = t('move a stick');
  }
}
/* drift: where the stick sits when it is left alone. Still for 1.2 s and near the middle = its resting position */
function pdDrift(i, x, y, now) {
  const r = pd.rest[i]; r.win.push({ t: now, x, y }); while (r.win.length && now - r.win[0].t > 1500) r.win.shift();
  if (r.win.length > 20 && now - r.win[0].t > 1200) {
    let a = 1e9, b = -1e9, c = 1e9, d = -1e9, sx = 0, sy = 0; for (const p of r.win) { a = Math.min(a, p.x); b = Math.max(b, p.x); c = Math.min(c, p.y); d = Math.max(d, p.y); sx += p.x; sy += p.y; }
    const mx = sx / r.win.length, my = sy / r.win.length;
    if (b - a < .03 && d - c < .03 && Math.hypot(mx, my) < .5) { r.has = true; r.x = mx; r.y = my; }
  }
  const R = pd.refs, chip = $('#pdDc' + i, R.root), p = $('#pdDp' + i, R.root); if (!chip) return;
  let st, txt, cls, ico;
  if (!r.has) { st = 'wait'; cls = ''; ico = 'info'; txt = t('Waiting'); }
  else { const mag = Math.hypot(r.x, r.y) * 100; st = mag < 3 ? 'ok' : mag < pd.dz ? 'warn' : 'bad'; cls = st; ico = st === 'ok' ? 'check' : 'alert'; txt = st === 'ok' ? t('Centered') : st === 'warn' ? t('Slight drift') : t('Drift'); }
  const detail = !r.has ? t('Let go of the stick and keep it still to check it.')
    : st === 'ok' ? t('Resting at the middle: {x}, {y}.', { x: pdSigned(r.x), y: pdSigned(r.y) })
    : st === 'warn' ? t('Rests off center ({x}, {y}) but inside the dead zone, so games should not notice.', { x: pdSigned(r.x), y: pdSigned(r.y) })
    : t('Rests off center ({x}, {y}), beyond the dead zone. Games will see input you are not making.', { x: pdSigned(r.x), y: pdSigned(r.y) });
  const sig = st + detail; if (pd.shown['dr' + i] === sig) return; pd.shown['dr' + i] = sig;
  chip.className = 'chip ' + cls; chip.innerHTML = `${ic(ico)}${txt}`; p.textContent = detail;
}
tickers.add(() => { if (!active('controller') || !pd.refs) return; pdUpdate(false); });
addEventListener('gamepadconnected', () => { if (active('controller') && pd.refs) { pd.sig = ''; pdUpdate(true); } });
addEventListener('gamepaddisconnected', () => { if (pd.refs) { pd.sig = ''; pd.shown = {}; if (pd.el) setTimeout(() => active('controller') && pdUpdate(true), 0); } });

/* ========================= registration ========================= */
const RENDER = { keyboard: renderKeyboard, screen: renderScreen, speakers: renderSpeakers, mic: renderMic, camera: renderCamera, mouse: renderMouse, controller: renderController };
function release(tab) {
  if (tab === 'keyboard' && kb.capturing && kb.el) setCapture(kb.el, false);
  if (tab === 'speakers') closeAudio();
  if (tab === 'mic') { stopMic(); if (mic.el) showMicState(); }
  if (tab === 'controller') pdCapture(false);
  if (tab === 'camera') { stopCam(); if (cam.el && !$('#cmState', cam.el).classList.contains('bad')) camState(); }
}
SH.module({
  id: 'tester',
  actions(el) { el.innerHTML = `<span class="chip">${ic('info')}${t("These tests don't change anything on your PC")}</span>`; },
  renderTab(tab, el) { RENDER[tab](el); },
  enterTab(tab) { curTab = tab; if (tab === 'controller') pdCapture(true); },
  leaveTab(tab) { release(tab); if (curTab === tab) curTab = null; },
  leave() { if (curTab) release(curTab); curTab = null; },
  enter() {},
});
SH.on('view', ({ to }) => { if (to === 'tester') { const t = $('#v-tester .subnav .on'); curTab = t ? t.dataset.tab : 'keyboard'; } });
SH.actions.add([
  { t: t('Test the left and right speakers'), go: 'tester', tab: 'speakers', ic: 'speaker' },
  { t: t('Test the microphone'), go: 'tester', tab: 'mic', ic: 'mic' },
  { t: t('Test the camera'), go: 'tester', tab: 'camera', ic: 'camera' },
  { t: t('Test the mouse buttons'), go: 'tester', tab: 'mouse', ic: 'mouse' },
  { t: t('Test the game controller'), go: 'tester', tab: 'controller', ic: 'gamepad' },
  { t: t('Measure the screen refresh rate'), go: 'tester', tab: 'screen', ic: 'display' },
]);
})();
