/* StellarHub · translations. Loaded BEFORE every other script, because modules build some of their text as soon as
   they load. Strings are written in English in the code and wrapped: SH.t('Scan the disk'), SH.t('{n} files', {n}).
   Each language has one JSON file per area in ui/i18n/<lang>/<area>.json, { "English text": "translation" };
   the Python engine reads the same files (stellarhub/i18n.py), so a sentence is translated once for both.

   Which language: the "language" setting ('auto' or missing = the Windows display language). The choice is
   mirrored in localStorage so it is known synchronously at the next start; core.js reloads the page once if the
   saved setting turns out to differ (e.g. the installer chose another language). */
'use strict';
(() => {
const SH = window.SH = window.SH || {};
const LANGS = [
  // code, name in its own language, name in English, locale for numbers and dates
  ['en', 'English', 'English', 'en-US'],
  ['es', 'Español', 'Spanish', 'es-ES'],
  ['pt', 'Português (Brasil)', 'Portuguese (Brazil)', 'pt-BR'],
  ['it', 'Italiano', 'Italian', 'it-IT'],
  ['fr', 'Français', 'French', 'fr-FR'],
  ['zh', '简体中文', 'Chinese (Simplified)', 'zh-CN'],
  ['ja', '日本語', 'Japanese', 'ja-JP'],
  ['ru', 'Русский', 'Russian', 'ru-RU'],
];
/* the dictionary files every language may have (missing ones are simply skipped) */
const AREAS = ['common', 'shell', 'home', 'sheet', 'widget', 'monitor', 'drivers', 'remover', 'updater', 'storage',
  'optimizer', 'tester', 'autopilot', 'model3d', 'engine', 'hangar', 'privacy', 'benchmark', 'backups', 'tray'];
const CODES = LANGS.map(l => l[0]);

function systemLang() {
  for (const l of (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'])) {
    const c = String(l).toLowerCase().split('-')[0];
    if (CODES.includes(c)) return c;
  }
  return 'en';
}
function stored() { try { return localStorage.getItem('sh.lang'); } catch { return null; } }
/* 'auto' (or nothing saved) follows Windows; anything else must be a known code */
function resolve(pref) { return pref && pref !== 'auto' && CODES.includes(pref) ? pref : systemLang(); }

const pref = stored() || 'auto';
const lang = resolve(pref);
const dict = Object.create(null);
/* one synchronous GET: the whole language in one file (ui/i18n/_bundle/<lang>.json, made by stellarhub/i18n.py
   build_bundles), or null when there is none */
function readJSON(url) {
  try {
    const x = new XMLHttpRequest();
    x.open('GET', url, false); // synchronous on purpose: see the note at the top
    x.overrideMimeType('application/json');
    x.send();
    if (x.status === 200 || (x.status === 0 && x.responseText)) return JSON.parse(x.responseText);
  } catch { /* a missing or broken file */ }
  return null;
}
if (lang !== 'en') {
  const all = readJSON(`i18n/_bundle/${lang}.json`);
  if (all) Object.assign(dict, all);
  else for (const area of AREAS) { // no bundle: the area files one by one (a missing one stays in English)
    const part = readJSON(`i18n/${lang}/${area}.json`);
    if (part) Object.assign(dict, part);
  }
}

const fill = (s, vars) => vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars && vars[k] !== undefined && vars[k] !== null) ? vars[k] : m) : s;
/* t('Text') or t('{n} of {total} keys', { n, total }). Unknown text comes back in English, never empty. */
function t(s, vars) {
  if (s === undefined || s === null) return '';
  const k = String(s);
  /* "125 %": a number never ends a line apart from its % (a no-break space where the language puts a space before
     the sign, as Spanish and French do) */
  return fill(dict[k] !== undefined && dict[k] !== '' ? dict[k] : k, vars).replace(/(\d) %/g, '$1 %');
}

/* static text in the HTML files: <b data-t>Settings</b> translates its text; data-t-attr="title aria-label"
   translates those attributes (their English value is the key) */
function translateStatic(root = document) {
  if (lang === 'en') return;
  root.querySelectorAll('[data-t]').forEach(el => {
    if (!el.children.length && el.textContent.trim()) el.textContent = t(el.textContent.trim());
  });
  root.querySelectorAll('[data-t-attr]').forEach(el => {
    for (const a of el.dataset.tAttr.split(/\s+/)) if (el.hasAttribute(a)) el.setAttribute(a, t(el.getAttribute(a)));
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => translateStatic(), { once: true });
else translateStatic();

/* the same English word can mean different things (Home the screen / home the place): tc('autopilot', 'Home')
   looks up the key "autopilot|Home" first, then plain "Home" */
function tc(ctx, s, vars) {
  const k = ctx + '|' + s;
  return dict[k] !== undefined && dict[k] !== '' ? fill(dict[k], vars) : t(s, vars);
}

document.documentElement.lang = lang;
SH.t = t;
SH.tc = tc;
SH.i18n = {
  lang, pref, LANGS, CODES, systemLang, resolve,
  locale: (LANGS.find(l => l[0] === lang) || LANGS[0])[3],
  has: s => dict[s] !== undefined,
  translateStatic,
  /* remember the choice for the next start (synchronously readable) */
  remember(p) { try { localStorage.setItem('sh.lang', p || 'auto'); } catch {} },
};
})();
