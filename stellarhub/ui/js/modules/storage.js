/* StellarHub · Storage Checker. What WinDirStat does (treemap, tree, types, largest, duplicates,
   compare) with REAL data from the engine (stellarhub/engine/storage.py). Outside the app it uses believable sample data
   so the UI can be designed. The full tree lives in Python: aggregated levels arrive here and subtrees are requested when zooming. */
'use strict';
(() => {
const { $, $$, state, Spring, EASE, anim, tickers, ic, esc, fmt1, fmtInt } = SH;
const T = SH.t; // translations (t is used for other things in this file)
const unit = SH.unit;
const ID = 'storage';
const wp = s => esc(s).replace(/\\/g, '\\<wbr>'); // paths: only break after each backslash
const MB = 1024 ** 2, GB = 1024 ** 3;
SH.icons.add({
  up: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  drive: '<rect x="3" y="6.5" width="18" height="11" rx="2.5"/><path d="M7 12h.01M11 12h6"/>',
  zoom: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M8 11h6M11 8v6"/>',
  grow: '<path d="M4 17 10 11l4 4 6-7"/><path d="M15 8h5v5"/>',
});

/* ---------------- file types ---------------- */
const TYPES = {
  game: { n: T('Game data'), c: '#FF7A66', ext: ['vpk', 'pak', 'bin', 'bank'] },
  exe: { n: T('Programs and libraries'), c: '#6FA8FF', ext: ['exe', 'dll', 'sys', 'mui', 'pyd'] },
  video: { n: T('Video'), c: '#F4C26B', ext: ['mp4', 'mkv', 'mov'] },
  vm: { n: T('Virtual disks'), c: '#9ED6FF', ext: ['vdi', 'vhdx', 'iso'] },
  audio: { n: T('Audio and samples'), c: '#7FE0B4', ext: ['wav', 'flac', 'mp3', 'ncw', 'nki'] },
  ai: { n: T('AI models'), c: '#E0E57A', ext: ['gguf', 'safetensors'] },
  cache: { n: T('Cache and temp files'), c: '#8E9BB3', ext: ['tmp', 'cache', 'db', 'dat', 'log', 'ldb'] },
  plugin: { n: T('Audio plugins'), c: '#5FD3C6', ext: ['vst3', 'clap'] },
  inst: { n: T('Installers'), c: '#D98E73', ext: ['msi', 'cab', 'msu'] },
  archive: { n: T('Archives'), c: '#FFB27A', ext: ['zip', '7z', 'rar'] },
  image: { n: T('Images'), c: '#FF9ECF', ext: ['jpg', 'png', 'psd'] },
  doc: { n: T('Documents'), c: '#C9D4E8', ext: ['pdf', 'docx', 'xlsx', 'md'] },
  code: { n: T('Code'), c: '#A8D672', ext: ['py', 'js', 'ts', 'json', 'pyc', 'manifest'] },
  system: { n: T('System files'), c: '#7C8AA5', ext: [] },
  other: { n: T('Other'), c: '#B9A88C', ext: [] },
  free: { n: T('Free space'), c: '#1C2436', ext: [] },
};
const EXT2T = {}; for (const [k, t] of Object.entries(TYPES)) t.ext.forEach(e => EXT2T[e] = k);
const T_ = t => TYPES[t] || TYPES.other;
/* one color per type; the variation between files is minimal (there used to be too much and the map looked dirty) */
const SHADE = {}, SHEEN = {};
(function () {
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const rgb = (c, f) => `rgb(${c.map(v => Math.round(v * f)).join(',')})`;
  const lift = (c, k) => `rgb(${c.map(v => Math.round(v + (255 - v) * k)).join(',')})`;
  for (const [k, t] of Object.entries(TYPES)) {
    const c = hex(t.c);
    SHADE[k] = [1, .965, .935, 1, .86].map(f => rgb(c, f));
    /* each tile gets a soft light from its top-left corner: lighter tint, base color, a touch darker */
    SHEEN[k] = [1, .965, .935, 1, .86].map(f => { const b = c.map(v => v * f); return [lift(b, .2), rgb(b, 1), rgb(b, .84)]; });
  }
})();
const shadeOf = (t, i) => (SHADE[t] || SHADE.other)[i];
const sheenOf = (t, i) => (SHEEN[t] || SHEEN.other)[i];

/* ---------------- sample data (deterministic) ---------------- */
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
let R = rng(20261117);
const pick = a => a[Math.floor(R() * a.length)];
function pickW(pairs) { let s = 0; for (const p of pairs) s += p[1]; let r = R() * s; for (const p of pairs) { r -= p[1]; if (r <= 0) return p[0]; } return pairs[0][0]; }
function splitPow(total, n, alpha) { const w = Array.from({ length: n }, () => Math.pow(R(), alpha) + .03); const s = w.reduce((a, b) => a + b, 0); return w.map(x => total * x / s); }
const KINDS = {
  sys: { ext: [['dll', 5], ['sys', 1], ['exe', 1.5], ['mui', 1], ['dat', 1.2], ['cab', .6]], dirs: ['System32', 'drivers', 'DriverStore', 'Logs', 'Fonts', 'Microsoft.NET', 'Speech', 'Boot', 'Resources', 'servicing', 'en-US', 'es-ES'], files: ['ntoskrnl', 'kernelbase', 'd3d12', 'shell32', 'combase', 'ucrtbase', 'windows.storage', 'nvlddmkm', 'igdkmd64', 'msmpeng'] },
  game: { ext: [['vpk', 4], ['pak', 3], ['bin', 1.5], ['dll', .4], ['exe', .2], ['mp4', .5], ['bank', .6]], dirs: ['bin', 'game', 'maps', 'sound', 'textures', 'videos', 'core', 'content', 'shaders', 'panorama', 'resource'], files: ['pak01', 'textures', 'sounds', 'maps', 'core', 'shaders', 'movies', 'props', 'characters'] },
  audio: { ext: [['wav', 6], ['flac', .6], ['mp3', .6], ['ncw', 1.5], ['nki', .2]], dirs: ['Kicks', 'Snares', 'Loops', 'Vocals', 'Presets', 'Stems', 'Bounces', 'Projects', 'Samples', 'Pads', 'FX'], files: ['kick', 'snare', 'vocal_take', 'pad', 'bass_loop', 'fx_riser', 'bounce', 'stem', '808', 'hat'] },
  plugin: { ext: [['vst3', 3], ['dll', 2], ['clap', .6], ['wav', 1.4]], dirs: ['VST3', 'Presets', 'Libraries', 'Content', 'Resources'], files: ['Serum', 'Ozone 11', 'Pro-Q 4', 'Kontakt 8', 'Massive X', 'ValhallaRoom', 'Soothe2', 'Neutron 5', 'Saturn 2', 'Trash'] },
  video: { ext: [['mp4', 8], ['mkv', .8], ['mov', .6]], dirs: ['Clips', 'Captures', 'Exports', '2026-10', '2026-11', 'Raw', 'Render'], files: ['Clip', 'Capture', 'Final export', 'Render', 'Match', 'Video'] },
  docs: { ext: [['pdf', 2], ['docx', 1], ['xlsx', 1], ['zip', 1.4], ['png', 1], ['jpg', 1], ['json', .4]], dirs: ['invoices', 'backups', 'templates', 'exports', 'screenshots', 'notes', 'projects', 'contracts'], files: ['invoice', 'backup', 'template', 'report', 'minutes', 'budget', 'screenshot', 'notes'] },
  code: { ext: [['py', 1], ['js', 2], ['json', 1], ['dll', .8], ['pyd', .6], ['md', .2], ['ts', .6], ['pyc', .6], ['db', .8]], dirs: ['src', 'dist', 'build', 'node_modules', 'tests', 'tools', '__pycache__', 'assets', 'lib', 'site-packages'], files: ['main', 'index', 'app', 'bundle', 'core', 'vendor', 'utils', 'server', 'worker'] },
  cache: { ext: [['tmp', 2], ['cache', 2], ['db', 1.4], ['dat', 1], ['log', .6], ['ldb', .6]], dirs: ['Cache', 'Code Cache', 'GPUCache', 'DXCache', 'blob_storage', 'IndexedDB', 'Temp', 'Service Worker', 'ShaderCache'], files: ['data_0', 'f_000', 'index', 'cache', 'blob', 'shader', 'temp', 'log'] },
  vm: { ext: [['vdi', 10], ['log', .1]], dirs: ['Logs', 'Snapshots'], files: ['Ubuntu 24.04', 'Windows 11 test', 'Debian 13', 'disk'] },
  models: { ext: [['gguf', 10], ['json', .1]], dirs: ['blobs', 'manifests'], files: ['llama3.1-8b-q4', 'qwen2.5-14b-q5', 'mistral-nemo-12b', 'sha256-6a0746a', 'sha256-8eeb52d'] },
  installers: { ext: [['exe', 4], ['msi', 2], ['zip', 2], ['7z', 1], ['msu', 1], ['iso', .4]], dirs: ['installers', 'setups', 'drivers', 'old'], files: ['setup', 'installer', 'flstudio_win64', 'movavi_setup', 'nvidia_driver', 'vc_redist', 'update'] },
  images: { ext: [['jpg', 4], ['png', 4], ['psd', 1.5]], dirs: ['Screenshots', 'Thumbnails', 'Channel art', 'Icons', 'Wallpapers'], files: ['IMG', 'Screenshot', 'thumbnail', 'wallpaper', 'logo', 'banner'] },
  mixed: { ext: [['zip', 1], ['exe', 1], ['mp4', 1], ['png', 1], ['pdf', 1], ['tmp', 1]], dirs: ['misc', 'unsorted'], files: ['file', 'copy', 'new'] },
  sysfiles: { ext: [['dat', 1]], dirs: [], files: ['{3808876b-c176-4e48-b7ae-04046e6cc752}', 'tracking', 'Syscache'], force: 'system' },
};
let NID = 0;
const T0 = Date.parse('2026-11-17T09:12:00');
const VIDEO = new Set(['mp4', 'mkv', 'mov']);
function fileName(K, ext) {
  const b = pick(K.files);
  if (VIDEO.has(ext)) return b;
  return R() < .65 ? `${b}_${String(1 + Math.floor(R() * 98)).padStart(2, '0')}` : b;
}
function mkFile(parent, name, size, ext, type) {
  const mtime = T0 - Math.floor(Math.pow(R(), 2.2) * 420) * 864e5 - Math.floor(R() * 864e5);
  if (VIDEO.has(ext) && !/\d{4}-\d\d/.test(name)) { const d = new Date(mtime - 6e5); const p2 = v => String(v).padStart(2, '0'); name = `${name} ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}-${p2(d.getMinutes())}`; }
  return { id: ++NID, name: name + '.' + ext, size, ext, type: type || EXT2T[ext] || 'cache', parent, mtime };
}
function gen(node, bytes, depth, K) {
  const canSub = depth < 6 && bytes > 160 * MB && K.dirs.length;
  const nSub = canSub ? 1 + Math.floor(R() * Math.max(1, 4.4 - depth * .7)) : 0;
  const share = nSub ? .18 + R() * .34 : 1;
  const nFiles = Math.max(1, Math.min(14, Math.round(3 + R() * 9 - depth)));
  const fb = bytes * share;
  splitPow(fb, nFiles, 2.3).forEach(sz => { const ext = pickW(K.ext); node.kids.push(mkFile(node, fileName(K, ext), sz, ext, K.force)); });
  if (!nSub) return;
  const used = new Set(node.kids.filter(k => k.dir).map(k => k.name));
  splitPow(bytes - fb, nSub, 1.5).forEach(sz => {
    let nm = pick(K.dirs), j = 2; while (used.has(nm) && j < 30) { nm = pick(K.dirs) + (j > 6 ? ' ' + j : ''); j++; }
    used.add(nm);
    const sub = { id: ++NID, name: nm, parent: node, kids: [], dir: true, size: 0, kind: node.kind };
    gen(sub, sz, depth + 1, K); node.kids.push(sub);
  });
}
function build(spec, parent, depth, kindIn) {
  const [name, gb, kind, kids] = spec;
  const node = { id: ++NID, name, parent, kids: [], dir: true, size: 0, kind: kind || kindIn || 'mixed' };
  (kids || []).forEach(c => node.kids.push(typeof c === 'function' ? c(node) : build(c, node, depth + 1, node.kind)));
  const used = node.kids.reduce((a, k) => a + sizeOf(k), 0);
  const rest = gb * GB - used;
  if (rest > 4 * MB) gen(node, rest, depth, KINDS[node.kind] || KINDS.mixed);
  return node;
}
function sizeOf(n) { if (!n.dir) return n.size; n.size = n.kids.reduce((a, k) => a + sizeOf(k), 0); return n.size; }
const F = (name, gb, ext, type) => p => mkFile(p, name, gb * GB, ext, type);
function SPEC() {
  return ['C:', 0, 'mixed', [
    ['Users', 297, 'docs', [['user', 296, 'docs', [
      ['Documents', 72, 'docs', [
        ...Array.from({ length: 24 }, (_, i) => ['Project_v' + (833 + i), 1.3 + R() * .5, 'code']),
        ['Music production', 12, 'audio'], ['Edited videos', 6, 'video'], ['Clips', 3, 'video'], ['Scripts', 1.5, 'code'],
        ['YouTube channel', 6, 'video'], ['Image-Line', 3, 'audio'], ['Tools', .4, 'code'], ['Game in development', 1.2, 'code']]],
      ['Downloads', 46, 'installers', [['PLUGINS', 14, 'plugin'], ['Image-Line FL Studio Producer Edition 26.1.3.5570', 2.1, 'installers'], ['Movavi Video Editor 27.1.0 (x64)', 1.3, 'installers'],
        ['Music', 5, 'audio'], ['Recordings', 3.4, 'video'], ['Demos', 4.1, 'video'], F('ubuntu-24.04.3-desktop-amd64', 6.1, 'iso', 'vm')]],
      ['AppData', 62, 'cache', [['Local', 44, 'cache', [['NVIDIA', 4, 'cache'], ['Temp', 7.4, 'cache'], ['Google', 6, 'cache'], ['Packages', 9, 'cache'], ['Spotify', 5.2, 'cache'], ['Bloxstrap', 3.1, 'game'], ['Programs', 6, 'code'], ['Microsoft', 3, 'cache']]],
        ['Roaming', 14, 'cache', [['Code', 1.4, 'code'], ['npm', 1.2, 'code'], ['discord', 1.1, 'cache'], ['Image-Line', 3.8, 'audio']]], ['LocalLow', 4, 'cache']]],
      ['Videos', 30, 'video', [['Medal', 22, 'video']]],
      ['VirtualBox VMs', 38, 'vm', [['Ubuntu 24.04', 22, 'vm', [F('Ubuntu 24.04', 21.6, 'vdi')]], ['Windows 11 test', 16, 'vm', [F('Windows 11 test', 15.8, 'vdi')]]]],
      ['.ollama', 21, 'models', [['models', 21, 'models', [['blobs', 20.9, 'models', [F('sha256-6a0746a1ec1a', 4.9, 'gguf'), F('sha256-8eeb52dfb3bb', 8.4, 'gguf'), F('sha256-ff82381e2bea', 7.1, 'gguf')]]]]]],
      ['Music', 12, 'audio'], ['Pictures', 8, 'images'], ['Utilities', 1.4, 'code'], ['.cache', 3, 'cache']]],
      ['Public', .6, 'docs'], ['Default', .4, 'cache']]],
    ['Program Files (x86)', 104, 'game', [['Steam', 104, 'game', [['steamapps', 103.5, 'game', [['common', 101, 'game', [
      ['dota 2 beta', 38, 'game'], ['Counter-Strike Global Offensive', 34, 'game'], ['Hollow Knight', 9, 'game'], ['wallpaper_engine', 2.1, 'game'], ['Terraria', .9, 'game']]], ['shadercache', 2.5, 'cache']]]]]]],
    ['Program Files', 80, 'sys', [['Native Instruments', 22, 'audio'], ['WindowsApps', 18, 'code'], ['Common Files', 11, 'plugin', [['VST3', 9.5, 'plugin']]], ['Image-Line', 6.8, 'audio'],
      ['Microsoft Office', 4.2, 'sys'], ['iZotope', 3.4, 'plugin'], ['NVIDIA Corporation', 3.1, 'sys'], ['Movavi Video Editor', 1.4, 'code'], ['CapCut', 1.2, 'code']]],
    ['Windows', 38, 'sys', [['WinSxS', 11, 'sys'], ['System32', 9, 'sys'], ['Installer', 6, 'installers'], ['SoftwareDistribution', 3.2, 'installers'], ['SysWOW64', 2.4, 'sys'], ['assembly', 2, 'sys'], ['Temp', 1.1, 'cache']]],
    ['ProgramData', 22, 'cache', [['Package Cache', 6, 'installers'], ['NVIDIA Corporation', 2.2, 'cache'], ['Microsoft', 7, 'cache']]],
    ['System Volume Information', 9, 'sysfiles'], ['msys64', 7, 'code'], ['$Recycle.Bin', 3.6, 'mixed'], ['Medal', 2, 'video'], ['pixelia', 1.2, 'images'], ['tts_tests', .8, 'audio'], ['tmp', .4, 'cache'],
    F('pagefile', 19, 'sys', 'system'), F('hiberfil', 6.4, 'sys', 'system'), F('swapfile', .25, 'sys', 'system'),
  ]];
}
function finalize(root) {
  sizeOf(root);
  const all = [];
  (function walk(n) {
    all.push(n);
    if (!n.dir) return;
    n.kids.sort((a, b) => b.size - a.size);
    n.cats = {}; n.fcRaw = 0; n.mtime = 0; n.dirs = 0;
    const virt = Math.floor(R() * R() * (['code', 'cache', 'sys'].includes(n.kind) ? 2600 : 260));
    n.fcRaw += virt;
    for (const k of n.kids) {
      walk(k);
      if (k.dir) { for (const t in k.cats) n.cats[t] = (n.cats[t] || 0) + k.cats[t]; n.fcRaw += k.fcRaw; n.dirs += 1 + k.dirs; n.mtime = Math.max(n.mtime, k.mtime); }
      else { n.cats[k.type] = (n.cats[k.type] || 0) + k.size; n.fcRaw += 1; n.mtime = Math.max(n.mtime, k.mtime); }
    }
    let best = 'cache', bv = -1; for (const t in n.cats) if (n.cats[t] > bv) { bv = n.cats[t]; best = t; } n.dom = best;
  })(root);
  const f = 1284512 / root.fcRaw;
  all.forEach(n => { n.fc = n.dir ? Math.max(n.kids.length ? 1 : 0, Math.round(n.fcRaw * f)) : 1; if (n.dir) n.dirs = Math.round(n.dirs * 330 + n.fc * .02); });
  root.all = all; return root;
}
let TREE = null, MOCK = null;
/* nodes by id (in real mode they arrive in parts; in sample mode the whole simulated tree is indexed) */
const NODES = new Map();
const nodeById = id => NODES.get(+id);
function mockTree() { if (!MOCK) { R = rng(20261117); NID = 0; MOCK = finalize(build(SPEC(), null, 0)); MOCK.all.forEach(n => NODES.set(n.id, n)); } return MOCK; }
const tree = () => TREE || mockTree();
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- real engine ---------------- */
const ST = { real: null, drives: [], target: null, info: null, job: null, dups: null, dupJob: null, cmp: undefined, types: null, big: null,
  /* done: a scan finished (or the one the engine already had was taken); last: the last scan of the target ({ when, size, files }) */
  done: false, last: null };
async function isReal() {
  if (ST.real === null) {
    try { const d = await SH.engine('storage', 'drives'); ST.real = d !== undefined; ST.drives = d || []; } catch (e) { console.error(e); ST.real = false; }
    if (ST.real && !ST.target) { const sys = ST.drives.find(d => d.system) || ST.drives[0]; ST.target = sys ? sys.root : 'C:\\'; }
  }
  return ST.real;
}
/* turns what the engine sends into UI tree nodes (with their parent) */
function adopt(p, parent) {
  const n = { id: p.id, name: p.name, size: p.size, parent, mtime: p.mtime || 0 };
  if (p.dir) {
    Object.assign(n, { dir: true, cats: p.cats || {}, dom: p.dom || 'other', fc: p.fc || 0, dirs: p.dirs || 0, lazy: !!p.lazy, err: p.err });
    n.kids = (p.kids || []).map(k => adopt(k, n));
  } else Object.assign(n, { ext: p.ext || '', type: p.type || 'other', fc: p.fc || 1, group: !!p.group });
  NODES.set(n.id, n);
  return n;
}
/* children on demand: the engine sends 3 levels at a time */
const loading = new Map();
function ensureKids(n) {
  if (!n || !n.dir || !n.lazy || !ST.real) return Promise.resolve(n);
  if (loading.has(n.id)) return loading.get(n.id);
  const p = SH.engine('storage', 'view', n.id, 3).then(v => {
    n.kids = (v.kids || []).map(k => adopt(k, n)); n.lazy = false; return n;
  }).catch(e => { console.error(e); n.lazy = false; return n; }).finally(() => loading.delete(n.id));
  loading.set(n.id, p); return p;
}
const API = {
  /* scan with progress: onProgress({files, path, frac, rate}) */
  async scan(onProgress) {
    if (await isReal()) {
      const job = SH.job('storage', 'scan', [ST.target], { onProgress: m => { if (m.kind === 'progress') onProgress({ files: m.data.files || 0, path: m.text, frac: m.pct, rate: m.data.rate, exact: m.data.exact, method: m.data.method, unit: m.data.unit }); } });
      ST.job = job;
      try {
        const r = await job; ST.info = r.info; NODES.clear(); TREE = adopt(r.root, null);
        ST.types = ST.big = null; ST.cmp = undefined; ST.dups = null;
        return TREE;
      } finally { ST.job = null; }
    }
    const t = mockTree(); const dirs = t.all.filter(n => n.dir && n.size > 200 * MB);
    const dur = 2300, t0 = performance.now();
    while (true) {
      if (ST.cancelMock) { ST.cancelMock = false; throw Object.assign(new Error('cancelled'), { cancelled: true }); }
      const k = Math.min(1, (performance.now() - t0) / dur); const e = 1 - Math.pow(1 - k, 1.6);
      onProgress({ files: Math.round(t.fc * e), path: pathOf(dirs[Math.min(dirs.length - 1, Math.floor(k * dirs.length))]), frac: e });
      if (k >= 1) break; await wait(50);
    }
    return t;
  },
  cancel() { if (ST.job) ST.job.cancel(); else ST.cancelMock = true; },
  disk() {
    if (ST.real && ST.info) { const d = ST.info.disk; const whole = isWholeDrive(); return { total: d.total, used: whole ? d.used : tree().size, free: d.free, whole }; }
    return { total: 953 * GB, used: tree().size, free: 953 * GB - tree().size, whole: true };
  },
};
const isWholeDrive = () => !ST.real || !ST.info || /^[A-Za-z]:\\?$/.test(ST.info.target);
/* short name: "C:" for a whole drive, the folder's name otherwise; targetName() says "Drive C:" for a drive */
const targetShort = () => { if (!ST.real || !ST.info) return 'C:'; const t = ST.info.target; return isWholeDrive() ? t.slice(0, 2) : t.split('\\').filter(Boolean).pop(); };
const targetName = () => isWholeDrive() ? T('Drive {d}', { d: targetShort() }) : targetShort();
const pathOf = n => {
  if (n && n.path) return n.path;
  const p = []; let x = n; while (x) { p.unshift(x.name); x = x.parent; }
  if (ST.real && ST.info && !isWholeDrive()) { p[0] = ST.info.target.replace(/\\$/, ''); return p.join('\\'); }
  return p.join('\\').replace(/^([A-Za-z]:)\\?/, '$1\\');
};
const isAnc = (a, n) => { for (let x = n; x; x = x.parent) if (x === a) return true; return false; };
const typeOf = n => n.dir ? n.dom : n.type;
/* ---------------- real file icons (what Explorer shows), cached per type; programs and shortcuts get their own.
   Inside the app only: the engine answers in batches; the coloured extension badge stays as the fallback. ---------------- */
const FICON = new Map(), FTRIES = new Map();
const extOf = name => { const s = String(name || ''); const i = s.lastIndexOf('.'); return i > 0 ? s.slice(i + 1).toLowerCase() : ''; };
const iconSpec = (name, full) => { const e = extOf(name); return /^(exe|lnk|ico|msc|cpl|scr)$/.test(e) && full ? 'file:' + full : 'ext:.' + (e || 'zzunknown'); };
/* extension badge (Largest, Duplicates, Compare) */
function badge(name, full, color) {
  const e = extOf(name), spec = iconSpec(name, full), u = FICON.get(spec);
  return u ? `<span class="st-bt img" style="--c:${color}" title=".${esc(e)}"><img src="${u}" alt="" decoding="async"></span>`
    : `<span class="st-bt" style="--c:${color}" data-ics="${esc(spec)}">${esc(e || '·')}</span>`;
}
async function paintIcons(root) {
  if (!ST.real || !root) return;
  const els = $$('[data-ics]', root);
  const want = [...new Set(els.map(x => x.dataset.ics))].filter(k => !FICON.has(k) && (FTRIES.get(k) || 0) < 2).slice(0, 150);
  if (want.length) {
    let r = null; try { r = await SH.engine('monitor', 'icons', want); } catch { r = null; }
    want.forEach(k => { if (r && r[k]) FICON.set(k, r[k]); else FTRIES.set(k, (FTRIES.get(k) || 0) + 1); });
  }
  let left = false;
  $$('[data-ics]', root).forEach(x => {
    const u = FICON.get(x.dataset.ics); if (!u) { left = left || (FTRIES.get(x.dataset.ics) || 0) < 2; return; }
    const tree = x.classList.contains('st-ic'); x.removeAttribute('data-ics'); x.classList.add('img');
    if (!tree) x.title = '.' + x.textContent.trim();
    x.innerHTML = `<img src="${u}" alt="" decoding="async">`;
  });
  if (left && want.length) setTimeout(() => paintIcons(root), 200);
}
const fmtB = b => SH.fmtBytes(b);
const pct = v => (v * 100 < 0.1 ? '<' + fmt1(.1) : fmt1(v * 100)) + '%';
const fmtDate = t => new Date(t).toLocaleDateString(SH.i18n.locale, { day: 'numeric', month: 'short', year: 'numeric' });

/* ---------------- treemap ---------------- */
const TM = { cv: null, ctx: null, dpr: 1, vp: { x: 0, y: 0, w: 0, h: 0 }, root: null, cur: null, leaves: [], rects: new Map(), tops: [], hover: null, hoverTop: null, sel: null,
  A: null, hiType: null, hiLock: null, labelA: new Spring(0, 120, 20), dirty: true, ready: false, scanning: false, tipX: new Spring(0, 260, 26), tipY: new Spring(0, 260, 26), tipA: new Spring(0, 200, 24), mx: 0, my: 0 };
let curTab = null, ctxRef = null;
function squarify(items, r, cb) {
  let i = 0, { x, y, w, h } = r;
  while (i < items.length) {
    const short = Math.min(w, h); if (short <= .01) { while (i < items.length) cb(items[i++], { x, y, w: 0, h: 0 }); break; }
    const l2 = short * short; let sum = items[i].a, j = i + 1; const mx = items[i].a;
    let worst = Math.max(l2 * mx / (sum * sum), (sum * sum) / (l2 * items[i].a));
    while (j < items.length) { const s2 = sum + items[j].a; const wv = Math.max(l2 * mx / (s2 * s2), (s2 * s2) / (l2 * items[j].a)); if (wv > worst) break; sum = s2; worst = wv; j++; }
    if (w >= h) { const cw = sum / h; let yy = y; for (let k = i; k < j; k++) { const ih = items[k].a / cw; cb(items[k], { x, y: yy, w: cw, h: ih }); yy += ih; } x += cw; w -= cw; }
    else { const rh = sum / w; let xx = x; for (let k = i; k < j; k++) { const iw = items[k].a / rh; cb(items[k], { x: xx, y, w: iw, h: rh }); xx += iw; } y += rh; h -= rh; }
    i = j;
  }
}
/* the drive's free space as one more block (only at the root of a whole drive, if the switch is on) */
const FREE = { id: -999, name: T('Free space'), size: 0, type: 'free', free: true, fc: 0, mtime: 0 };
const showFree = () => state.settings.storageShowFree !== false && isWholeDrive();
function layout(root, vp) {
  const leaves = [], rects = new Map(), tops = [];
  rects.set(root.id, vp);
  const lay = (node, r, depth, ti) => {
    if (!node.dir || !node.kids.length || r.w * r.h < 42 || r.w < 4 || r.h < 4) { leaves.push({ n: node, r, ti }); return; }
    /* even spacing: 2 px between main groups, 1 px inside (if it fits) */
    const pad = depth === 0 ? 0 : (r.w > 14 && r.h > 14 ? (depth === 1 ? 1.5 : .75) : 0);
    let ir = { x: r.x + pad, y: r.y + pad, w: r.w - pad * 2, h: r.h - pad * 2 };
    /* free space gets its own strip (right or bottom) and the used space is laid out in the rest */
    if (depth === 0 && node === TM.root && showFree()) {
      FREE.size = API.disk().free; FREE.parent = node;
      if (FREE.size > 0) {
        const f = FREE.size / (node.size + FREE.size); let fr;
        if (ir.w >= ir.h) { const fw = ir.w * f; fr = { x: ir.x + ir.w - fw, y: ir.y, w: fw, h: ir.h }; ir = { ...ir, w: ir.w - fw }; }
        else { const fh = ir.h * f; fr = { x: ir.x, y: ir.y + ir.h - fh, w: ir.w, h: fh }; ir = { ...ir, h: ir.h - fh }; }
        rects.set(FREE.id, fr); tops.push({ n: FREE, r: fr }); leaves.push({ n: FREE, r: fr, ti: 999 });
      }
    }
    const area = ir.w * ir.h; const items = [];
    for (const k of node.kids) if (k.size > 0) items.push({ n: k, a: k.size / node.size * area });
    items.sort((a, b) => b.a - a.a);
    let idx = 0;
    squarify(items, ir, (it, rr) => { rects.set(it.n.id, rr); const t = depth === 0 ? idx++ : ti; if (depth === 0) tops.push({ n: it.n, r: rr }); lay(it.n, rr, depth + 1, t); });
  };
  lay(root, vp, 0, 0);
  return { leaves, rects, tops };
}
const MARGIN = 6; /* the map never touches the panel frame */
const VPR = () => ({ x: MARGIN, y: MARGIN, w: Math.max(0, TM.vp.w - MARGIN * 2), h: Math.max(0, TM.vp.h - MARGIN * 2) });
const mapR = (r, s, d) => ({ x: d.x + (r.x - s.x) * d.w / s.w, y: d.y + (r.y - s.y) * d.h / s.h, w: r.w * d.w / s.w, h: r.h * d.h / s.h });
function relayout() { if (!TM.cur || !TM.vp.w) return; const L = layout(TM.cur, VPR()); TM.leaves = L.leaves; TM.rects = L.rects; TM.tops = L.tops; TM.dirty = true; }
let hatch = null;
function fillLeaf(ctx, n, x, y, w, h, a) {
  if (w <= .2 || h <= .2 || a <= .01) return;
  const t = typeOf(n); const hi = TM.hiLock || TM.hiType;
  ctx.globalAlpha = a * (hi && t !== hi ? .12 : 1);
  if (n.free) {
    if (!hatch) { const c = document.createElement('canvas'); c.width = c.height = 10; const g = c.getContext('2d'); g.fillStyle = '#151C2B'; g.fillRect(0, 0, 10, 10); g.strokeStyle = 'rgba(158,190,240,.09)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-2, 12); g.lineTo(12, -2); g.stroke(); hatch = ctx.createPattern(c, 'repeat'); }
    ctx.fillStyle = hatch; ctx.fillRect(x + .5, y + .5, w - 1, h - 1);
    ctx.strokeStyle = 'rgba(158,190,240,.18)'; ctx.lineWidth = 1; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); return;
  }
  const si = n.dir ? 4 : (n.group ? 2 : Math.abs(n.id) % 3);
  if (w > 7 && h > 7) {
    /* gradient along the tile's diagonal (capped, so big tiles get a soft corner glow rather than a long ramp) */
    const S = sheenOf(t, si), D = Math.hypot(w, h), L = Math.min(D, 420);
    const g = ctx.createLinearGradient(x, y, x + L * w / D, y + L * h / D);
    g.addColorStop(0, S[0]); g.addColorStop(.5, S[1]); g.addColorStop(1, S[2]);
    ctx.fillStyle = g;
  } else ctx.fillStyle = shadeOf(t, si);
  /* same spacing across the whole map: half a pixel per side (1 px between neighbors) */
  if (w > 2.5 && h > 2.5) ctx.fillRect(x + .5, y + .5, w - 1, h - 1); else ctx.fillRect(x, y, w, h);
}
/* the cached picture of the map's tiles (drawn again only when the layout, the highlighted type or the size change) */
const hiKey = () => TM.hiLock || TM.hiType || '';
function baseFor() {
  const cv = TM.cv, b = TM.base || (TM.base = document.createElement('canvas'));
  if (TM.baseL === TM.leaves && TM.baseHi === hiKey() && b.width === cv.width && b.height === cv.height) return;
  b.width = cv.width; b.height = cv.height;
  const c = b.getContext('2d'), V = VPR(); c.setTransform(TM.dpr, 0, 0, TM.dpr, 0, 0);
  c.save(); roundRect(c, V.x, V.y, V.w, V.h, 10); c.clip();
  for (const l of TM.leaves) fillLeaf(c, l.n, l.r.x, l.r.y, l.r.w, l.r.h, 1);
  c.restore(); TM.baseL = TM.leaves; TM.baseHi = hiKey();
}
const easeQ = k => 1 - Math.pow(1 - k, 4);
function draw(now) {
  const { ctx, vp, dpr } = TM; if (!ctx || !vp.w) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; ctx.clearRect(0, 0, vp.w, vp.h);
  if (!TM.ready || (TM.A && TM.A.layers)) return;
  /* clean clip with the same radius as the panel: nothing spills out at the corners */
  const V = VPR(); ctx.save(); roundRect(ctx, V.x, V.y, V.w, V.h, 10); ctx.clip();
  if (TM.A) {
    const A = TM.A; const k = (now - A.t0) / A.dur;
    for (const it of A.items) {
      const kk = Math.max(0, Math.min(1, (k - it.d) / (1 - it.d))); const e = easeQ(kk);
      const f = it.f, t = it.t;
      fillLeaf(ctx, it.n, f.x + (t.x - f.x) * e, f.y + (t.y - f.y) * e, f.w + (t.w - f.w) * e, f.h + (t.h - f.h) * e, it.a0 + (it.a1 - it.a0) * e);
    }
    ctx.restore();
    if (k >= 1) { TM.A = null; TM.labelA.t = 1; }
    TM.dirty = true; return;
  }
  ctx.restore();
  /* the tiles are painted once into a cached layer and only blitted; hover, selection and labels are drawn over it */
  baseFor(); ctx.drawImage(TM.base, 0, 0, vp.w, vp.h);
  ctx.globalAlpha = 1;
  const la = TM.labelA.v;
  if (la > .01) {
    ctx.font = '500 12px Onest, system-ui'; ctx.textBaseline = 'middle';
    for (const t of TM.tops) {
      if ((!t.n.dir && !t.n.free) || t.r.w < 96 || t.r.h < 40) continue;
      const label = t.n.free ? T('Free') : t.n.name, sz = fmtB(t.n.size);
      const w1 = ctx.measureText(label).width, w2 = ctx.measureText(sz).width;
      const maxW = t.r.w - 16; if (maxW < 40) continue;
      const tw = Math.min(maxW, w1 + w2 + 26);
      ctx.globalAlpha = la * .78; ctx.fillStyle = 'rgba(6,10,20,.82)';
      roundRect(ctx, t.r.x + 6, t.r.y + 6, tw, 22, 7); ctx.fill();
      ctx.globalAlpha = la; ctx.fillStyle = '#E8EDF6';
      let lab = label;
      if (w1 + 16 > tw) { while (lab.length > 2 && ctx.measureText(lab + '…').width + 16 > tw) lab = lab.slice(0, -1); lab += '…'; }
      ctx.fillText(lab, t.r.x + 14, t.r.y + 17); ctx.fillStyle = '#9EABC3'; if (w1 + w2 + 26 <= maxW) ctx.fillText(sz, t.r.x + 22 + w1, t.r.y + 17);
    }
  }
  ctx.globalAlpha = 1;
  if (TM.hoverTop) { const r = TM.rects.get(TM.hoverTop.id); if (r) { ctx.strokeStyle = getAcc2(); ctx.lineWidth = 2; ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2); } }
  const hl = TM.hover && TM.rects.get(TM.hover.id);
  if (hl && TM.hover !== TM.hoverTop) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(hl.x + .75, hl.y + .75, Math.max(1, hl.w - 1.5), Math.max(1, hl.h - 1.5)); }
  if (TM.sel && TM.sel !== TM.hover) { const r = TM.rects.get(TM.sel.id); if (r) { ctx.setLineDash([4, 3]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(r.x + .75, r.y + .75, Math.max(1, r.w - 1.5), Math.max(1, r.h - 1.5)); ctx.setLineDash([]); } }
}
let acc2 = '#9ED6FF'; const getAcc2 = () => acc2;
SH.on('look', () => { acc2 = getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim() || '#9ED6FF'; TM.dirty = true; });
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
tickers.add((dt, now) => {
  if (state.view !== ID || curTab !== 'map' || !TM.ctx) return;
  const lb = TM.labelA.idle; TM.labelA.step(dt);
  if (TM.A || TM.dirty || !lb) { TM.dirty = false; draw(now); }
  const tip = TM.tipEl; if (tip) {
    TM.tipX.step(dt); TM.tipY.step(dt); TM.tipA.step(dt);
    tip.style.opacity = TM.tipA.v.toFixed(3);
    tip.style.transform = `translate3d(${TM.tipX.v.toFixed(1)}px,${TM.tipY.v.toFixed(1)}px,0) scale(${(.94 + .06 * TM.tipA.v).toFixed(3)})`;
  }
});

/* continuous zoom: the pivot (target folder when zooming in, current folder when zooming out) morphs from its rectangle to the viewport */
/* prefetch: what's in view and hasn't arrived from the engine yet (large folders in the next two levels) */
function prefetch(cur) {
  if (!ST.real || !cur) return;
  const want = [];
  const walk = (n, d) => { for (const k of n.kids || []) { if (!k.dir) continue; if (k.lazy && k.size > cur.size * .012) want.push(k); else if (d < 2) walk(k, d + 1); } };
  walk(cur, 0);
  if (!want.length) return;
  Promise.all(want.slice(0, 14).map(ensureKids)).then(() => { if (TM.cur === cur && !TM.A) { relayout(); renderLegend(); } });
}
function zoomTo(nr, why) {
  if (TM.A || !nr || nr === TM.cur || !nr.dir) return;
  if (nr.lazy && ST.real) { TM.cv && (TM.cv.style.cursor = 'progress'); ensureKids(nr).then(() => { if (TM.cv) TM.cv.style.cursor = ''; zoomTo(nr, why); }); return; }
  const oldLeaves = TM.leaves, oldRects = TM.rects; const zin = isAnc(TM.cur, nr);
  const L = layout(nr, VPR());
  let src, dst;
  if (zin) { src = oldRects.get(nr.id); dst = VPR(); if (!src) { let x = nr; while (x && !oldRects.get(x.id)) x = x.parent; src = x ? oldRects.get(x.id) : VPR(); } }
  else { src = VPR(); let x = TM.cur; while (x && !L.rects.get(x.id)) x = x.parent; dst = x ? L.rects.get(x.id) : VPR(); }
  if (!src.w || !src.h || !dst.w || !dst.h) { src = VPR(); dst = VPR(); }
  const M = r => mapR(r, src, dst), Mi = r => mapR(r, dst, src);
  const oldMap = new Map(oldLeaves.map(l => [l.n.id, l.r])); const newIds = new Set(L.leaves.map(l => l.n.id));
  const items = [];
  for (const l of oldLeaves) if (!newIds.has(l.n.id)) items.push({ n: l.n, f: l.r, t: M(l.r), a0: 1, a1: 0, d: 0 });
  for (const l of L.leaves) { const o = oldMap.get(l.n.id); items.push({ n: l.n, f: o || Mi(l.r), t: l.r, a0: o ? 1 : 0, a1: 1, d: 0 }); }
  TM.leaves = L.leaves; TM.rects = L.rects; TM.tops = L.tops; TM.cur = nr; TM.hover = TM.hoverTop = null; TM.tipA.t = 0;
  if (TM.sel && !isAnc(nr, TM.sel)) TM.sel = null;
  TM.A = { items, t0: performance.now(), dur: Math.max(1, 640 * SH.motion()) }; TM.labelA.set(0);
  renderCrumbs(true); renderInfo(); renderLegend(); TM.dirty = true;
  setTimeout(() => prefetch(nr), 700 * SH.motion());
}
/* map intro when the scan finishes. The map is drawn ONCE, cut into pieces (every piece a small canvas: a folder, or a
   group of folders, covering at most ~4.5% of the map); the reveal only moves those finished layers (opacity and a short
   rise, compositor only), staggered outward from the center in small batches. The pieces are painted nearest the center
   first, a few milliseconds per frame, and each starts as soon as it is ready, so a big map or a slow PC never holds a
   frame back and nothing is redrawn while it plays. At the end the pieces become the cached picture of the map (no tile
   is painted again) and the main canvas takes over with identical pixels. */
function revealStart() {
  if (!TM.cv || SH.effInt() === 'min' || !TM.leaves.length) return null;
  const V = VPR(), dpr = TM.dpr, maxA = V.w * V.h * .045, wrap = TM.cv.parentElement, mo = SH.motion();
  const groups = new Map();
  for (const l of TM.leaves) {
    let n = l.n;
    while (n.parent) { const pr = TM.rects.get(n.parent.id); if (!pr || pr.w * pr.h > maxA) break; n = n.parent; }
    let g = groups.get(n); if (!g) { g = { r: TM.rects.get(n.id) || l.r, leaves: [] }; groups.set(n, g); }
    g.leaves.push(l);
  }
  const box = document.createElement('div'); box.className = 'st-lay'; box.setAttribute('aria-hidden', 'true');
  const half = Math.hypot(V.w, V.h) / 2 || 1, pieces = [];
  for (const g of groups.values()) {
    const x0 = Math.floor(g.r.x) - 1, y0 = Math.floor(g.r.y) - 1, x1 = Math.ceil(g.r.x + g.r.w) + 1, y1 = Math.ceil(g.r.y + g.r.h) + 1;
    const px0 = Math.round(x0 * dpr), py0 = Math.round(y0 * dpr);
    const cv = document.createElement('canvas'); cv.width = Math.round((x1 - x0) * dpr); cv.height = Math.round((y1 - y0) * dpr);
    cv.style.cssText = `left:${px0 / dpr}px;top:${py0 / dpr}px;width:${cv.width / dpr}px;height:${cv.height / dpr}px;opacity:0`;
    box.appendChild(cv);
    pieces.push({ cv, g, px0, py0, d: Math.min(1, Math.hypot((g.r.x + g.r.w / 2) - (V.x + V.w / 2), (g.r.y + g.r.h / 2) - (V.y + V.h / 2)) / half) });
  }
  pieces.sort((a, b) => a.d - b.d);
  wrap.insertBefore(box, $('.st-tip', wrap));
  TM.A = { layers: true, box }; TM.dirty = true;
  const lay = { box, pieces, w: TM.vp.w, h: TM.vp.h }, t0 = performance.now() + 340 * mo, anims = [];
  let k = 0, over = false;
  const end = () => {
    if (over) return; over = true;
    if (TM.A && TM.A.layers) TM.A = null;
    if (TM.vp.w !== lay.w || TM.vp.h !== lay.h || hiKey() !== '' || pieces.some(p => p.g)) relayout();
    else if (TM.cv && TM.cv.width) {
      const b = TM.base || (TM.base = document.createElement('canvas')); b.width = TM.cv.width; b.height = TM.cv.height;
      const c = b.getContext('2d'); pieces.forEach(p => c.drawImage(p.cv, p.px0, p.py0));
      TM.baseL = TM.leaves; TM.baseHi = hiKey();
    }
    TM.labelA.set(0); TM.labelA.t = 1; draw(performance.now()); TM.dirty = true;
    box.remove();
  };
  const step = () => {
    if (over) return;
    const ts = performance.now();
    while (k < pieces.length && (performance.now() - ts < 4 || k === 0)) {
      const p = pieces[k++], c = p.cv.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, -p.px0, -p.py0);
      c.save(); roundRect(c, V.x, V.y, V.w, V.h, 10); c.clip();
      for (const l of p.g.leaves) fillLeaf(c, l.n, l.r.x, l.r.y, l.r.w, l.r.h, 1);
      c.restore(); p.g = null;
      /* its slot in the wave, or right now if painting fell behind */
      const wait = Math.max(0, t0 + p.d * 460 * mo - performance.now());
      anims.push(p.cv.animate([{ opacity: 0, transform: 'translate3d(0,12px,0)' }, { opacity: 1, transform: 'none' }], { duration: 560 * mo, delay: wait, easing: EASE.out, fill: 'both' }));
    }
    if (k < pieces.length) requestAnimationFrame(step);
    else Promise.all(anims.map(a => a.finished)).then(end).catch(end);
  };
  requestAnimationFrame(step);
  setTimeout(end, 9000);
  return lay;
}
/* from one layout to another (e.g. when showing or hiding free space): each block slides to its new place */
function morphFrom(oldLeaves) {
  const old = new Map(oldLeaves.map(l => [l.n.id, l.r])); const now = new Set(TM.leaves.map(l => l.n.id)); const items = [];
  for (const l of oldLeaves) if (!now.has(l.n.id)) items.push({ n: l.n, f: l.r, t: l.r, a0: 1, a1: 0, d: 0 });
  for (const l of TM.leaves) { const o = old.get(l.n.id); items.push({ n: l.n, f: o || l.r, t: l.r, a0: o ? 1 : 0, a1: 1, d: o ? 0 : .3 }); }
  TM.A = { items, t0: performance.now(), dur: Math.max(1, 620 * SH.motion()) }; TM.labelA.set(0); TM.dirty = true;
}

/* ---------------- Map: DOM ---------------- */
function renderMap(el) {
  el.classList.add('fill');
  el.innerHTML = `<div class="st-map">
    <div class="st-mainc">
      <div class="st-bar" data-asm><nav class="st-crumbs" aria-label="${T('Path')}"></nav><span class="sp"></span><span class="faint st-hint">${T('Click a folder to open it. Scroll back to go up.')}</span>
        <button class="st-free${state.settings.storageShowFree !== false ? ' on' : ''}" data-free title="${T("Show the drive's free space on the map")}"><span class="st-fsw"></span>${T('Free space')}</button>
        <button class="btn sm ghost" data-up>${ic('up')}${T('Up one level')}</button></div>
      <div class="st-cvw pan" data-asm data-nofade><canvas></canvas><div class="st-tip"></div>
        <div class="st-scan"><div class="st-sbox">
          <div class="st-dial"><div class="st-rg"><i class="st-tr"></i><i class="st-hv r"><i></i></i><i class="st-hv l"><i></i></i><i class="st-co"></i></div>
            <div class="st-sv"><b class="st-sn">0</b><span>${T('files read')}</span></div></div>
          <div class="st-sp faint">${T('Preparing the scan…')}</div><div class="st-ss muted">&nbsp;</div>
          <button class="btn sm ghost st-cancel" data-cancel>${ic('x')}${T('Cancel')}</button></div></div>
        <div class="st-idle"></div>
      </div>
    </div>
    <aside class="st-side">
      <div class="pan st-info" data-asm></div>
      <div class="pan st-legend" data-asm><h4>${T('File types')} <em>${T('click to highlight')}</em></h4><div class="st-leg"></div></div>
    </aside></div>`;
  const wrap = $('.st-cvw', el); TM.cv = $('canvas', wrap); TM.ctx = TM.cv.getContext('2d'); TM.tipEl = $('.st-tip', wrap);
  /* size WITHOUT transforms (clientWidth): getBoundingClientRect includes the scale of camera moves
     and, if the observer fired in the middle of one, the map was drawn in one space and the mouse looked it up in another */
  new ResizeObserver(() => {
    const w = wrap.clientWidth, h = wrap.clientHeight; const d = Math.min(2, devicePixelRatio || 1);
    TM.dpr = d; TM.cv.width = Math.round(w * d); TM.cv.height = Math.round(h * d);
    const changed = Math.round(w) !== Math.round(TM.vp.w) || Math.round(h) !== Math.round(TM.vp.h);
    TM.vp = { x: 0, y: 0, w, h };
    if (changed && TM.ready && !TM.A) relayout(); TM.dirty = true;
  }).observe(wrap);
  TM.cv.addEventListener('pointermove', e => {
    const r = TM.cv.getBoundingClientRect(); const kx = r.width ? TM.cv.clientWidth / r.width : 1, ky = r.height ? TM.cv.clientHeight / r.height : 1;
    /* only a real mouse movement may tick (map_hover), never a map moving under a still pointer */
    const moved = e.isTrusted && e.pointerType === 'mouse' && !e.buttons && !!(e.movementX || e.movementY);
    TM.mx = (e.clientX - r.left) * kx; TM.my = (e.clientY - r.top) * ky; hoverAt(TM.mx, TM.my, moved);
  });
  TM.cv.addEventListener('pointerleave', () => { TM.tickHit = null; if (TM.hover) { TM.hover = TM.hoverTop = null; TM.tipA.t = 0; TM.dirty = true; renderInfo(); } });
  TM.cv.addEventListener('click', () => {
    if (TM.A || !TM.ready) return;
    if (TM.hoverTop && TM.hoverTop.dir) zoomTo(deepen(TM.hoverTop));
    else if (TM.hover && !TM.hover.free) { TM.sel = TM.hover; TM.dirty = true; renderInfo(); }
  });
  TM.cv.addEventListener('wheel', e => { TM.wheelAt = performance.now(); if (TM.A || !TM.ready) return; e.preventDefault();
    if (e.deltaY < 0 && TM.hoverTop && TM.hoverTop.dir) zoomTo(TM.hoverTop); else if (e.deltaY > 0 && TM.cur.parent) zoomTo(TM.cur.parent); }, { passive: false });
  el.addEventListener('click', e => {
    if (e.target.closest('[data-up]')) { if (TM.cur && TM.cur.parent) zoomTo(TM.cur.parent); return; }
    const cb = e.target.closest('[data-crumb]'); if (cb) { const n = nodeById(cb.dataset.crumb); if (n) zoomTo(n); return; }
    if (e.target.closest('[data-cancel]')) { API.cancel(); return; }
    if (e.target.closest('[data-goscan]')) { if (TM.scanning) return; SH.sound('scan_start'); runScan(true).then(() => rerenderOthers()); return; }
    const fr = e.target.closest('[data-free]'); if (fr) { const on = !fr.classList.contains('on'); fr.classList.toggle('on', on); SH.setSetting('storageShowFree', on); if (TM.ready && !TM.A) { const old = TM.leaves; relayout(); morphFrom(old); } return; }
    const lg = e.target.closest('[data-leg]'); if (lg) { TM.hiLock = TM.hiLock === lg.dataset.leg ? null : lg.dataset.leg; TM.dirty = true; markLegend(); return; }
    const act = e.target.closest('[data-info]'); if (act) infoAction(act.dataset.info);
  });
  el.addEventListener('pointerover', e => { const lg = e.target.closest('[data-leg]'); TM.hiType = lg ? lg.dataset.leg : null; TM.dirty = true; });
  el.addEventListener('pointerout', e => { if (e.target.closest('[data-leg]') && !e.relatedTarget?.closest?.('[data-leg]')) { TM.hiType = null; TM.dirty = true; } });
  if (!TM.ready && !TM.scanning) idleCover(el); else if (!TM.ready) sideSkeleton();
  if (TM.ready) { $('.st-scan', el).classList.add('done'); relayout(); renderCrumbs(); renderInfo(); renderLegend(); }
}
/* Before any scan the map waits for the user (scanning a whole drive is heavy): a cover that says what the scan does,
   with the date and size of the last one if there is one, and the Scan button. The side panels come with the scan. */
function idleCover(el) {
  el = el || RENDERED.map; if (!el) return;
  const map = $('.st-map', el), box = $('.st-idle', el); if (!map || !box) return;
  map.classList.add('idle'); $('.st-scan', el).classList.add('done');
  const tgt = (ST.target || 'C:\\').replace(/\\$/, ''), L = ST.last;
  const html = (L ? SH.lastRun({ when: L.when, title: T('Last scan: {when}'), text: T('{size} in {n} files', { size: fmtB(L.size), n: fmtInt(L.files) }), cls: 'st-last' }) : '')
    + SH.emptyState({ art: 'first', title: T('See what takes up space on {target}', { target: esc(tgt) }),
      text: L ? T('The map shows the result of a new scan: it reads every folder again, so it is always current. Nothing is changed.') : T('The scan reads every folder and draws a map of the drive: the bigger the block, the more space it takes. Nothing is changed.'),
      action: { label: T('Scan {target}', { target: tgt }), data: 'data-goscan', icon: 'search', pri: true, big: true } });
  if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; }
}
/* opening the Map: the scan this process already has (the page was reloaded) is shown as it is; otherwise the last
   scan's date and size are read (a small file) and the map waits for Scan. Nothing scans by itself unless the user
   asked for that in Settings > General. */
let idleAsked = false;
async function openMap() {
  if (TM.ready || TM.scanning) return;
  const real = await isReal();
  if (real && !idleAsked) {
    idleAsked = true;
    let pub = null; try { pub = await SH.engine('storage', 'published'); } catch (e) { console.error(e); }
    if (pub && pub.root && !TM.ready && !TM.scanning) { showPublished(pub); return; }
  }
  if (real) { try { ST.last = await SH.engine('storage', 'last_scan', ST.target) || null; } catch (e) { console.error(e); ST.last = null; } }
  if (TM.ready || TM.scanning) return;
  if (SH.autoAnalyze()) { runScan().then(() => rerenderOthers()); return; }
  idleCover();
}
function showPublished(r) {
  NODES.clear(); TREE = adopt(r.root, null); ST.info = r.info; if (r.info && r.info.target) ST.target = r.info.target;
  ST.types = ST.big = null; ST.cmp = undefined; ST.dups = null; ST.done = true;
  TM.root = TM.cur = TREE; TM.ready = true; TM.sel = null; TM.hover = TM.hoverTop = null;
  const el = RENDERED.map; if (el) { const m = $('.st-map', el); if (m) m.classList.remove('idle'); $('.st-scan', el).classList.add('done'); }
  const ib = $(`#v-${ID} .st-info`); if (ib) ib.dataset.k = ''; const lb = $(`#v-${ID} .st-leg`); if (lb) lb.dataset.k = '';
  relayout(); renderCrumbs(); renderInfo(); renderLegend(); paintActions(); rerenderOthers();
}
function deepen(n) { while (n.dir && n.kids.length && n.kids[0].dir && n.kids[0].size / n.size > .985) n = n.kids[0]; return n; }
/* moved: a real mouse movement; then a different tile under the pointer plays a very short tick (not during a zoom, a
   reveal or right after the wheel; the engine keeps them at least 35 ms apart) */
function hoverAt(x, y, moved) {
  if (TM.A || !TM.ready) return;
  let hit = null; for (let i = TM.leaves.length - 1; i >= 0; i--) { const r = TM.leaves[i].r; if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) { hit = TM.leaves[i].n; break; } }
  let top = hit; while (top && top.parent !== TM.cur) top = top.parent;
  const tip = TM.tipEl; const W = TM.vp.w, H = TM.vp.h;
  if (hit) {
    const tx = Math.min(W - 280, x + 18), ty = Math.min(H - 84, y + 18);
    if (TM.tipA.v < .05) { TM.tipX.set(tx); TM.tipY.set(ty); }
    TM.tipX.t = tx; TM.tipY.t = ty; TM.tipA.t = 1;
  } else TM.tipA.t = 0;
  if (hit === TM.hover) return;
  TM.hover = hit; TM.hoverTop = top; TM.dirty = true;
  if (hit && hit !== TM.tickHit && moved && performance.now() - (TM.wheelAt || -1e9) > 250) { TM.tickHit = hit; SH.sound('map_hover'); }
  if (hit && hit.free) {
    const dk = API.disk();
    tip.innerHTML = `<b>${T('Free space')}</b><span class="faint">${T("What's still unused on the drive")}</span><span><i style="background:#3A4660"></i>${T('{size}, {pct} of the drive', { size: fmtB(hit.size), pct: pct(hit.size / dk.total) })}</span>`;
  } else if (hit) {
    const t = typeOf(hit);
    tip.innerHTML = `<b>${esc(hit.name)}</b><span class="faint">${wp(pathOf(hit.parent || hit))}</span><span><i style="background:${T_(t).c}"></i>${T('{size}, {pct} of {name}', { size: fmtB(hit.size), pct: pct(hit.size / TM.cur.size), name: esc(TM.cur === TM.root ? targetName() : TM.cur.name) })}</span>`;
  }
  renderInfo();
}
function renderCrumbs(animate) {
  const box = $(`#v-${ID} .st-crumbs`); if (!box || !TM.cur) return;
  const chain = []; for (let x = TM.cur; x; x = x.parent) chain.unshift(x);
  const prev = box.childElementCount;
  box.innerHTML = chain.map((n, i) => `${i ? `<span class="st-cs">${ic('chev')}</span>` : ''}<button data-crumb="${n.id}"${i === chain.length - 1 ? ' class="on" aria-current="true"' : ''}>${i === 0 ? ic('drive') : ''}${esc(i === 0 ? targetShort() : n.name)}</button>`).join('');
  if (animate) $$('button, .st-cs', box).forEach((b, i) => { if (i * 1 >= prev - 1) anim(b, [{ opacity: 0, transform: 'translate3d(-8px,0,0)' }, { opacity: 1, transform: 'none' }], { d: 340, delay: Math.max(0, i - prev + 1) * 40, e: EASE.spring }); });
  const up = $(`#v-${ID} [data-up]`); if (up) up.disabled = !TM.cur.parent;
}
const whenText = ms => { if (!ms) return T('today, {time}', { time: '09:12' }); const d = new Date(ms); const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(SH.i18n.locale, { hour: '2-digit', minute: '2-digit' });
  return today ? T('today, {time}', { time }) : T('{date}, {time}', { date: d.toLocaleDateString(SH.i18n.locale, { day: 'numeric', month: 'short' }), time }); };
/* while the first scan runs the side cards keep their final size, with placeholder lines (never an empty box) */
function sideSkeleton() {
  const info = $(`#v-${ID} .st-info`), leg = $(`#v-${ID} .st-leg`);
  if (info && !info.dataset.k) info.innerHTML = `<div class="st-skel" aria-hidden="true"><div class="st-skh"><i class="sk"></i><div><i class="sk"></i><i class="sk"></i></div></div><i class="sk st-skbig"></i><i class="sk st-skbar"></i>${'<i class="sk st-skln"></i>'.repeat(4)}</div>`;
  if (leg && !leg.dataset.k) leg.innerHTML = `<div class="st-skel" aria-hidden="true">${'<i class="sk st-skrow"></i>'.repeat(7)}</div>`;
}
function renderInfo() {
  const box = $(`#v-${ID} .st-info`); if (!box || !TM.ready) return;
  let n = TM.hover || TM.sel || TM.cur; if (n.free) n = TM.cur;
  const key = n.id + ':' + (n === TM.cur ? 'c' : 'n') + ':' + n.size;
  if (box.dataset.k === key) return; box.dataset.k = key;
  const disk = API.disk();
  if (n === TM.cur && !n.parent) {
    const I = ST.info;
    box.innerHTML = (disk.whole
      ? `<h4>${esc(targetName())}</h4><div class="st-ib"><div class="big">${fmt1(disk.used / GB)}<small>${T('GB used')}</small></div><span class="muted">${T('of {total} GB. {free} GB free.', { total: fmtInt(disk.total / GB), free: fmtInt(disk.free / GB) })}</span></div>
      <div class="st-used"><span style="--v:${(disk.used / disk.total).toFixed(4)}"></span></div>`
      : `<h4>${T('Scanned folder')}</h4><div class="st-ih"><span class="st-it" style="--c:${T_(n.dom).c}">${ic('folder')}</span><div><b>${esc(targetName())}</b><span class="faint">${wp(I ? I.target : '')}</span></div></div>
      <div class="st-ib"><div class="big">${fmtB(n.size).replace(/ (\S+)$/, '<small>$1</small>')}</div><span class="muted">${T('{pct} of the drive, which has {free} GB free.', { pct: pct(n.size / disk.total), free: fmtInt(disk.free / GB) })}</span></div>`)
      + `<dl class="st-dl"><dt>${T('Files')}</dt><dd>${fmtInt(n.fc)}</dd><dt>${T('Folders')}</dt><dd>${fmtInt(n.dirs)}</dd><dt>${T('Scanned')}</dt><dd>${I ? (I.secs < .1 ? T('{when}, in under 0.1 s', { when: whenText(I.when) }) : T('{when}, in {secs} s', { when: whenText(I.when), secs: fmt1(I.secs) })) : whenText()}</dd>
      ${I && I.method ? `<dt>${T('Read from')}</dt><dd title="${I.method === 'mft' ? T('The NTFS master file table was read directly (admin mode): every file in seconds. Hard links count once.') : T('Every folder was listed one by one. Admin mode on an NTFS drive reads the file table instead, which is much faster.')}">${I.method === 'mft' ? T('NTFS file table') : T('Folder scan')}</dd>` : ''}
      <dt>${T('Sizes')}</dt><dd title="${T("The map uses each file's real size, as Explorer shows it under Size. Space on disk can differ: small files fill whole clusters, compressed and sparse files take less.")}">${T('File size')}${I && I.alloc ? ` · ${T('{n} GB on disk', { n: fmt1(I.alloc / GB) })}` : ''}</dd>
      ${I && I.errors ? `<dt>${T('No access')}</dt><dd title="${I.admin ? T("Folders Windows won't let even an administrator read.") : T('Admin mode can read more system folders.')}">${T('{n} folders', { n: fmtInt(I.errors) })}</dd>` : ''}</dl>
      ${I && I.errors && !I.admin && !SH.state.admin ? `<button class="btn sm sec st-admb" data-stadm>${ic('shield')}${T('Read them as administrator')}</button>` : ''}`;
  } else {
    const t = typeOf(n); const base = n === TM.cur ? (n.parent || n) : TM.cur;
    box.innerHTML = `<h4>${n === TM.cur ? T('Current folder') : n.dir ? T('Folder') : n.group ? T('Several files') : T('File')}</h4>
      <div class="st-ih"><span class="st-it" style="--c:${T_(t).c}">${ic(n.dir ? 'folder' : 'file')}</span><div><b>${esc(n.name)}</b><span class="faint">${wp(pathOf(n.parent || n))}</span></div></div>
      <div class="st-ib"><div class="big">${fmtB(n.size).replace(/ (\S+)$/, '<small>$1</small>')}</div><span class="muted">${base !== n && !(base === TM.root && disk.whole) ? T('{pct} of {name}, {dpct} of the drive', { pct: pct(n.size / base.size), name: esc(base === TM.root ? targetName() : base.name), dpct: pct(n.size / disk.total) }) : T('{pct} of the drive', { pct: pct(n.size / disk.total) })}</span></div>
      <div class="bar" style="margin:10px 0 2px"><span style="transform:scaleX(${Math.max(.004, n.size / base.size).toFixed(4)});background:${T_(t).c}"></span></div>
      <dl class="st-dl">${n.dir || n.group ? `<dt>${T('Files')}</dt><dd>${fmtInt(n.fc)}</dd><dt>${T('Mostly')}</dt><dd>${T_(n.dir ? n.dom : t).n}</dd>` : `<dt>${T('Type')}</dt><dd>${T_(t).n}</dd>`}<dt>${T('Modified')}</dt><dd>${n.mtime ? fmtDate(n.mtime) : '—'}</dd></dl>
      <div class="st-ia">${n.dir && n !== TM.cur ? `<button class="btn sm sec" data-info="enter">${ic('zoom')}${T('Zoom in')}</button>` : ''}<button class="btn sm ghost" data-info="open">${ic('folder')}${T('Show in Explorer')}</button>${n.dir ? `<button class="btn sm ghost" data-info="tree">${ic('list')}${T('View in Folders')}</button>` : ''}</div>`;
    TM.infoNode = n;
  }
  anim(box.children[1] || box, [{ opacity: .4, transform: 'translate3d(0,3px,0)' }, { opacity: 1, transform: 'none' }], { d: 200 });
}
async function reveal(path) {
  if (ST.real) { try { if (await SH.engine('storage', 'reveal', path)) return; } catch (e) { console.error(e); } SH.toast(T('Not found: it may no longer exist.'), { kind: 'error' }); return; }
  SH.toast(T('Would show {path} in Explorer.', { path }));
}
function infoAction(a) {
  const n = TM.infoNode || TM.cur;
  if (a === 'enter') zoomTo(n);
  if (a === 'open') reveal(n.group ? pathOf(n.parent) : pathOf(n));
  if (a === 'tree' && ctxRef) { treeTarget = n; ctxRef.setTab('tree'); }
}
function renderLegend() {
  const box = $(`#v-${ID} .st-leg`); if (!box || !TM.cur) return;
  const cats = TM.cur.dir ? Object.entries(TM.cur.cats || {}).filter(c => c[1] > 0).sort((a, b) => b[1] - a[1]) : [];
  const key = cats.slice(0, 12).map(c => c[0]).join() + ':' + TM.cur.id; if (box.dataset.k === key) { markLegend(); return; } box.dataset.k = key;
  box.innerHTML = cats.slice(0, 12).map(([t, b]) => `<button class="st-lr" data-leg="${t}"><i style="background:${T_(t).c}"></i><span>${T_(t).n}</span><b>${fmtB(b)}</b></button>`).join('');
  $$('.st-lr', box).forEach((b, i) => anim(b, [{ opacity: 0, transform: 'translate3d(8px,0,0)' }, { opacity: 1, transform: 'none' }], { d: 320, delay: i * 25, e: EASE.spring }));
  markLegend();
}
function markLegend() { $$(`#v-${ID} .st-lr`).forEach(b => { b.classList.toggle('on', TM.hiLock === b.dataset.leg); b.classList.toggle('dim', !!TM.hiLock && TM.hiLock !== b.dataset.leg); }); }

/* the scanned path keeps a fixed width: long paths are cut in the middle (start and end stay readable) so
   the line never changes size and nothing around it moves */
let pathCtx = null, pathFont = '';
function setPathText(el, s) {
  if (!el || el.dataset.full === s) return;
  el.dataset.full = s;
  const W = el.clientWidth; if (!W) { el.textContent = s; return; }
  if (!pathCtx) pathCtx = document.createElement('canvas').getContext('2d');
  const cs = getComputedStyle(el), f = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; if (f !== pathFont) { pathFont = f; pathCtx.font = f; }
  if (pathCtx.measureText(s).width <= W) { el.textContent = s; return; }
  let lo = 0, hi = s.length;
  while (lo < hi) { const k = (lo + hi + 1) >> 1, a = Math.ceil(k * .4); if (pathCtx.measureText(s.slice(0, a) + '…' + s.slice(s.length - (k - a))).width <= W) lo = k; else hi = k - 1; }
  const a = Math.ceil(lo * .4); el.textContent = s.slice(0, a) + '…' + s.slice(s.length - (lo - a));
}

/* animated scan: a ring with the real progress; when it finishes, the ring shrinks into the center and the map
   opens from there with a soft wave (everything used to pop in place at once) */
let scanProg = null;
/* ring fill, 0 to 1: two half discs turned by transform behind a ring mask (see storage.css), so the arc grows on the compositor.
   The transitions are slightly longer than the gap between updates and linear, so the fill glides instead of stepping. */
function setArc(dial, p, instant) {
  if (!dial) return; p = Math.max(0, Math.min(1, p || 0));
  const hs = $$('.st-hv>i', dial); if (instant) hs.forEach(e => e.style.transition = 'none');
  hs[0].style.transform = `rotate(${(-180 + 360 * Math.min(p, .5)).toFixed(2)}deg)`; hs[1].style.transform = `rotate(${(360 * Math.max(0, p - .5)).toFixed(2)}deg)`;
  if (instant) { void dial.offsetWidth; hs.forEach(e => e.style.transition = ''); }
}
/* user: the user started it (the caller already played scan_start in the click); the scan on entering the Map stays silent */
async function runScan(user) {
  if (TM.scanning) return; TM.scanning = true; scanProg = null;
  /* followed from anywhere (dock ring, Home, taskbar): the scan the user started at once, the one on entering the Map
     (bg) once it has run for a moment */
  const what = !ST.real || !ST.target ? 'C:' : /^[A-Za-z]:\\?$/.test(ST.target) ? ST.target.slice(0, 2) : ST.target.split('\\').filter(Boolean).pop();
  const act = SH.activity.start(ID, { key: 'scan', label: T('Scanning {name}', { name: what }), go: { tab: 'map' }, cancel: () => API.cancel(), bg: !user });
  const el = $(`#v-${ID} .tab[data-tab="map"]`); const sc = el && $('.st-scan', el);
  const mapEl = el && $('.st-map', el); if (mapEl) mapEl.classList.remove('idle');
  if (sc) {
    sc.classList.remove('done'); sc.classList.add('busy');
    $$('.st-dial, .st-sp, .st-ss, .st-cancel', sc).forEach(x => { x.getAnimations().forEach(a => a.cancel()); });
    SH.rollNumber($('.st-sn', sc), 0, { plain: true }); setPathText($('.st-sp', sc), T('Preparing the scan…')); $('.st-ss', sc).innerHTML = '&nbsp;';
    anim(sc, [{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { d: 380, e: EASE.out });
  }
  const wasReady = TM.ready; if (!TM.root) sideSkeleton();
  if (TM.ready) { TM.ready = false; TM.dirty = true; }
  const dial = sc && $('.st-dial', sc); if (dial) { dial.classList.remove('fin', 'det'); setArc(dial, 0, true); }
  let last = 0, lastT = performance.now(), shown = 0, t;
  const spEl = sc && $('.st-sp', sc), unitEl = sc && $('.st-sv span', sc); if (unitEl) unitEl.textContent = T('files read');
  try {
    t = await API.scan(p => {
      scanProg = { files: p.files, frac: p.frac || 0, unit: p.unit }; paintScanWait();
      if (act) act.progress(p.frac > 0 ? p.frac : null);
      if (!sc) return;
      SH.rollNumber($('.st-sn', sc), p.files, { tick: true }); setPathText(spEl, p.path || ' ');
      if (unitEl && p.unit) { const u = p.unit === 'entries' ? T('entries read') : T('files read'); if (unitEl.textContent !== u) unitEl.textContent = u; }
      if (dial && p.frac > 0) { shown = Math.max(shown, p.frac); dial.classList.add('det'); setArc(dial, shown); }
      const now = performance.now();
      if (now - lastT > 500) {
        /* 3 significant digits, so the speed line doesn't flicker on every update */
        const r = p.rate || (p.files - last) / ((now - lastT) / 1000), m = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.max(1, r))) - 2));
        SH.rollNumber($('.st-ss', sc), p.method === 'mft' ? T('{n} entries per second · reading the NTFS file table', { n: fmtInt(Math.round(r / m) * m) }) : T('{n} files per second', { n: fmtInt(Math.round(r / m) * m) }));
        last = p.files; lastT = now;
      }
      
    });
  } catch (e) {
    TM.scanning = false; if (sc) sc.classList.remove('busy');
    const told = act ? act.end(e && e.cancelled ? { cancelled: true } : { ok: false, error: (e && e.message) || '' }) : false;
    if (e && e.cancelled) {
      if (wasReady && TM.root) { TM.ready = true; relayout(); if (sc) anim(sc, [{ opacity: 1 }, { opacity: 0 }], { d: 260 }).finished.then(() => sc.classList.add('done')).catch(() => {}); }
      else idleCover();
      SH.toast(T('Scan cancelled.')); return;
    }
    /* a new scan that failed (the folder or the USB drive is gone...) leaves the map that was there: it is still what
       the engine publishes and what the other tabs show; the next Scan goes back to that map's own target */
    if (wasReady && TM.root) {
      TM.ready = true; relayout();
      if (ST.info && ST.info.target) ST.target = ST.info.target;
      if (sc) anim(sc, [{ opacity: 1 }, { opacity: 0 }], { d: 260 }).finished.then(() => sc.classList.add('done')).catch(() => {});
      if (!told) SH.toast(`${T("Couldn't scan.")} ${(e && e.message) || ''}`.trim(), { kind: 'error' });
      console.error(e); return;
    }
    if (sc) { setPathText($('.st-sp', sc), T("Couldn't scan.")); $('.st-ss', sc).textContent = (e && e.message) || ''; }
    console.error(e); return;
  }
  if (dial) { dial.classList.add('det'); setArc(dial, 1); }
  if (user) SH.sound('scan_complete');
  ST.done = true; ST.last = null;
  if (act) act.end({ ok: true, summary: T('{size} in {n} files', { size: fmtB(t.size), n: fmtInt(t.fc) }) });
  TM.root = t; if (!TM.cur || !isAnc(t, TM.cur)) TM.cur = t;
  TM.scanning = false; TM.ready = true; TM.sel = null; TM.hover = TM.hoverTop = null; relayout();
  /* the map is drawn once, in pieces, before the ring leaves: the reveal below only moves finished layers */
  const lay = revealStart();
  const ib = $(`#v-${ID} .st-info`); if (ib) ib.dataset.k = '';
  const lb = $(`#v-${ID} .st-leg`); if (lb) lb.dataset.k = '';
  if (sc) {
    sc.classList.remove('busy');
    $('.st-ss', sc).textContent = T('{files} files in {dirs} folders', { files: fmtInt(t.fc), dirs: fmtInt(t.dirs) });
    const dial = $('.st-dial', sc), rest = $$('.st-sp, .st-ss, .st-cancel', sc);
    rest.forEach(x => anim(x, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate3d(0,6px,0)' }], { d: 260, delay: 160 }));
    dial.classList.add('fin');
    anim(dial, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.5)', opacity: 0 }], { d: 520, delay: 220, e: EASE.io });
    const finish = () => { if (TM.scanning || sc.classList.contains('done')) return; sc.classList.add('done'); [dial, ...rest, sc].forEach(x => x.getAnimations().forEach(a => a.cancel())); };
    anim(sc, [{ backgroundColor: 'rgba(6,10,20,.6)' }, { backgroundColor: 'rgba(6,10,20,0)' }], { d: 700, delay: 260 }).finished.then(finish).catch(() => {});
    setTimeout(finish, 1400); /* in case the window is hidden and the animations don't advance */
  }
  setTimeout(() => { if (!lay) { TM.A = null; TM.labelA.t = 1; TM.dirty = true; } /* the side panels in their own frames, so none of them makes the reveal skip */ renderCrumbs(true); requestAnimationFrame(() => { renderInfo(); requestAnimationFrame(() => { renderLegend(); prefetch(TM.cur); }); }); }, 340 * SH.motion());
  if (ST.real) refreshDrives();
}

/* ---------------- Folders ---------------- */
let treeTarget = null; const openSet = new Set();
/* before a scan (in real mode) the other tabs invite you to run one */
const needScan = () => !ST.done;
/* while the Map tab is scanning, the other tabs say so (with the progress) instead of offering to scan again */
function paintScanWait() {
  $$(`#v-${ID} .st-first.st-wait`).forEach(box => {
    const f = scanProg ? Math.max(0, Math.min(1, scanProg.frac)) : 0, bar = $('.bar>span', box), tx = $('.st-fp', box);
    if (bar) bar.style.setProperty('--v', f);
    /* fed on every progress update: plain text (a roll at this rate would only show half-moved digits) */
    if (tx) SH.rollNumber(tx, scanProg ? (scanProg.unit === 'entries' ? T('{n} entries read', { n: fmtInt(scanProg.files) }) : T('{n} files read', { n: fmtInt(scanProg.files) })) : T('Preparing the scan…'), { plain: true });
  });
}
function scanFirst(el, what) {
  el.classList.add('fill');
  if (TM.scanning) {
    el.innerHTML = `<div class="pan st-first st-wait" data-asm><span class="st-fi">${ic('storage')}</span><b>${T('Scanning… (see {tab})', { tab: T('Map') })}</b><span class="muted st-fp"></span><div class="bar st-fbar"><span></span></div>
      <button class="btn sec" data-gomap>${ic('storage')}${T('Go to {tab}', { tab: T('Map') })}</button></div>`;
    paintScanWait();
    if (!el.dataset.b) { el.dataset.b = 1; el.addEventListener('click', e => { if (e.target.closest('[data-goscan]') && ctxRef) { SH.sound('scan_start'); ctxRef.setTab('map'); setTimeout(() => runScan(true), 260); } else if (e.target.closest('[data-gomap]') && ctxRef) ctxRef.setTab('map'); }); }
    return;
  }
  el.innerHTML = `<div class="pan st-first" data-asm><span class="st-fi">${ic('storage')}</span><b>${T('Scan a drive first')}</b><span class="muted">${what}</span>
    <button class="btn pri" data-goscan>${ic('search')}${T('Scan {target}', { target: esc((ST.target || 'C:\\').replace(/\\$/, '')) })}</button></div>`;
  if (!el.dataset.b) { el.dataset.b = 1; el.addEventListener('click', e => { if (e.target.closest('[data-goscan]') && ctxRef) { SH.sound('scan_start'); ctxRef.setTab('map'); setTimeout(() => runScan(true), 260); } else if (e.target.closest('[data-gomap]') && ctxRef) ctxRef.setTab('map'); }); }
}
function trow(n, depth, base) {
  const t = typeOf(n); const frac = base ? n.size / base : 0;
  return `<div class="st-tr${n.dir ? '' : ' file'}${n.group ? ' grp' : ''}" data-id="${n.id}" style="--d:${depth}">
    <span class="st-nmc">${n.dir ? `<button class="st-tw" data-tw="${n.id}" aria-label="${T('Expand')}">${ic('chev')}</button>` : '<span class="st-tw"></span>'}${!n.dir && !n.group && ST.real && FICON.get(iconSpec(n.name, pathOf(n))) ? `<span class="st-ic img" style="--c:${T_(t).c}"><img src="${FICON.get(iconSpec(n.name, pathOf(n)))}" alt="" decoding="async"></span>`
      : `<span class="st-ic" style="--c:${T_(t).c}"${!n.dir && !n.group ? ` data-ics="${esc(iconSpec(n.name, pathOf(n)))}"` : ''}>${ic(n.dir ? 'folder' : n.group ? 'layers' : 'file')}</span>`}<span class="st-nm">${esc(depth === 0 ? targetName() : n.name)}</span></span>
    <span class="st-sz">${fmtB(n.size)}</span>
    <span class="st-pc"><span class="bar"><span style="--v:${Math.max(.003, frac).toFixed(4)};background:${T_(t).c}"></span></span><em>${pct(frac)}</em></span>
    <span class="st-fc">${n.dir || n.group ? fmtInt(n.fc) : ''}</span><span class="st-dt">${n.mtime ? fmtDate(n.mtime) : ''}</span></div>${n.dir ? `<div class="st-kids" data-kids="${n.id}"><div></div></div>` : ''}`;
}
function fillKids(n, depth) {
  const box = $(`#v-${ID} [data-kids="${n.id}"] > div`); if (!box || box.dataset.f) return box; box.dataset.f = 1;
  const shown = n.kids.filter(k => k.size > 0).slice(0, 80); const rest = n.kids.length - shown.length;
  box.innerHTML = shown.map(k => trow(k, depth + 1, n.size)).join('') + (rest > 0 ? `<div class="st-tr more" style="--d:${depth + 1}"><span class="st-nmc"><span class="st-tw"></span><span class="faint">${T('and {n} smaller items', { n: fmtInt(rest) })}</span></span></div>` : '');
  paintIcons(box);
  return box;
}
async function toggleTree(id, force) {
  const n = nodeById(id); if (!n || !n.dir) return;
  const row = $(`#v-${ID} .st-tr[data-id="${id}"]`), kids = $(`#v-${ID} [data-kids="${id}"]`); if (!row || !kids) return;
  const open = force !== undefined ? force : !row.classList.contains('open');
  if (open) {
    if (n.lazy) { row.classList.add('loading'); await ensureKids(n); row.classList.remove('loading'); }
    const box = fillKids(n, +row.style.getPropertyValue('--d'));
    row.classList.add('open'); kids.classList.add('open'); openSet.add(id);
    const rows = $$(':scope > .st-tr', box);
    rows.forEach((r, i) => anim(r, [{ opacity: 0, transform: 'translate3d(-10px,0,0)' }, { opacity: 1, transform: 'none' }], { d: 360, delay: Math.min(i, 14) * 22, e: EASE.spring }));
    requestAnimationFrame(() => rows.forEach(r => r.classList.add('in')));
  } else { row.classList.remove('open'); kids.classList.remove('open'); openSet.delete(id); }
}
function renderTree(el) {
  if (needScan()) return scanFirst(el, T('The folder tree comes from the scan: size, files and date of every folder.'));
  const t = tree(); openSet.clear();
  el.classList.add('fill');
  el.innerHTML = `<div class="pan st-tree st-fp" data-asm>
      <div class="st-ph"><div class="st-pht"><b>${esc(targetName())}</b><span class="muted">${T('{size} in {n} files. Sorted by size.', { size: fmtB(t.size), n: fmtInt(t.fc) })}</span></div><span class="sp"></span><button class="btn sm ghost" data-collapse>${ic('minus')}${T('Collapse all')}</button></div>
      <div class="tbl-head st-th"><span>${T('Name')}</span><span>${T('Size')}</span><span>${T('Share of its folder')}</span><span>${T('Files')}</span><span>${T('Modified')}</span></div>
      <div class="st-tbody st-scroll">${trow(t, 0, t.size)}</div></div>`;
  const root = $('.st-tr', el); root.classList.add('in');
  toggleTree(t.id, true);
  if (el.dataset.b) return; el.dataset.b = 1;
  el.addEventListener('click', e => {
    const tw = e.target.closest('[data-tw]'); if (tw) { toggleTree(+tw.dataset.tw); return; }
    const r = e.target.closest('.st-tr[data-id]'); if (r && !e.target.closest('button')) { const n = nodeById(r.dataset.id); if (n && n.dir) toggleTree(n.id); }
    if (e.target.closest('[data-collapse]')) { const rid = tree().id; [...openSet].filter(id => id !== rid).forEach(id => toggleTree(id, false)); }
  });
}
async function revealInTree(n) {
  const chain = []; for (let x = n; x; x = x.parent) chain.unshift(x);
  for (const x of chain) { if (x === n && !x.dir) break; const row = $(`#v-${ID} .st-tr[data-id="${x.id}"]`); if (row && !row.classList.contains('open') && x !== n) await toggleTree(x.id, true); }
  const row = $(`#v-${ID} .st-tr[data-id="${n.id}"]`);
  if (row) setTimeout(() => { row.scrollIntoView({ block: 'center', behavior: SH.effInt() === 'min' ? 'auto' : 'smooth' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1600); }, 380 * SH.motion());
}

/* ---------------- File types ---------------- */
async function typesData() {
  if (ST.real) {
    if (!ST.types) ST.types = await SH.engine('storage', 'types');
    return ST.types.map(b => [b.type, { size: b.size, n: b.count, ext: Object.fromEntries(b.exts) }]);
  }
  const t = tree(); const files = t.all.filter(n => !n.dir); const fFactor = t.fc / files.length;
  const by = {}; files.forEach(f => { const b = by[f.type] ||= { size: 0, n: 0, ext: {} }; b.size += f.size; b.n++; b.ext[f.ext] = (b.ext[f.ext] || 0) + f.size; });
  return Object.entries(by).map(([k, b]) => [k, { ...b, n: Math.round(b.n * (['vm', 'ai', 'system', 'inst', 'archive'].includes(k) ? 1 : ['video', 'game'].includes(k) ? fFactor * .08 : fFactor)) }]);
}
/* a view whose data didn't arrive: say so and offer to try again (instead of a skeleton forever) */
function loadErr(box, e, retry) {
  box.innerHTML = `<div class="st-lerr" role="alert">${ic('alert')}<div><b>${T("Couldn't load this view.")}</b><span class="muted">${esc((e && e.message) || T('The engine did not answer.'))}</span></div><button class="btn sec sm" data-retry>${T('Try again')}</button></div>`;
  $('[data-retry]', box).addEventListener('click', ev => { ev.stopPropagation(); SH.sound('refresh'); retry(); }, { once: true });
  console.error(e);
}
async function renderTypes(el) {
  if (needScan()) return scanFirst(el, T('See how much space each file type takes: videos, games, programs, caches…'));
  el.classList.add('fill'); el.innerHTML = '<div class="sk" style="height:60px;margin-bottom:14px"></div><div class="sk" style="height:300px"></div>';
  let data; try { data = await typesData(); } catch (e) { ST.types = undefined; el.classList.remove('fill'); loadErr(el, e, () => renderTypes(el)); return; }
  const list = data.filter(x => x[1].size > 0).sort((a, b) => b[1].size - a[1].size); const max = list[0] ? list[0][1].size : 1;
  const tot = list.reduce((a, x) => a + x[1].size, 0);
  el.innerHTML = `<div class="st-tywrap"><div class="pan st-stack" data-asm><h4>${isWholeDrive() ? T('How drive {d} is split up', { d: esc(targetShort()) }) : T('How {name} is split up', { name: esc(targetShort()) })} <em>${T('{size} in {n} types', { size: fmtB(tot), n: list.length })}</em></h4>
      <div class="st-sbar">${list.map(([k, b]) => `<button data-ty="${k}" style="flex:${b.size};background:${T_(k).c}" title="${T_(k).n}, ${fmtB(b.size)}"></button>`).join('')}</div></div>
    <div class="pan st-types st-fp" data-asm><div class="tbl-head st-tyh"><span>${T('Type')}</span><span>${T('Extensions')}</span><span>${T('Size')}</span><span>${T('Files')}</span><span></span></div>
      <div class="st-scroll">${list.map(([k, b]) => `<button class="st-ty" data-ty="${k}"><span class="st-sw" style="background:${T_(k).c}"></span><b>${T_(k).n}</b>
        <span class="faint st-ex">${Object.entries(b.ext).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([e]) => e.startsWith('(') ? e : '.' + e).join(' ')}</span>
        <span class="st-tsz">${fmtB(b.size)}</span><span class="st-tn">${fmtInt(b.n)}</span>
        <span class="bar"><span style="--v:${(b.size / max).toFixed(4)};background:${T_(k).c}"></span></span></button>`).join('')}</div></div></div>`;
  SH.assemble(el, 40);
  const sb = $('.st-sbar', el); anim(sb, [{ transform: 'scaleX(.02)', transformOrigin: '0 50%', opacity: 0 }, { transform: 'none', transformOrigin: '0 50%', opacity: 1 }], { d: 900, delay: 150 });
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  if (el.dataset.b) return; el.dataset.b = 1;
  el.addEventListener('click', e => { const b = e.target.closest('[data-ty]'); if (!b) return; TM.hiLock = b.dataset.ty; TM.dirty = true; if (ctxRef) ctxRef.setTab('map'); setTimeout(markLegend, 50); SH.toast(T('{type} highlighted on the map.', { type: T_(b.dataset.ty).n }), { action: { label: T('Clear highlight'), run: () => { TM.hiLock = null; TM.dirty = true; markLegend(); } } }); });
}

/* ---------------- Largest ---------------- */
const BIG = { sort: 'size', q: '', removed: new Set(), items: null };
const fullPath = n => n.folder ? n.folder.replace(/\\$/, '') + '\\' + n.name : pathOf(n);
const folderOf = n => n.folder || pathOf(n.parent);
async function bigItems() {
  if (ST.real) {
    if (!ST.big) ST.big = (await SH.engine('storage', 'largest', 200)).map(x => ({ id: x.id, name: x.name, size: x.size, mtime: x.mtime, ext: x.ext, type: x.type, folder: x.dir, dirId: x.dirId, dir: false }));
    return ST.big;
  }
  return tree().all.filter(n => !n.dir).sort((a, b) => b.size - a.size).slice(0, 60);
}
function bigList() {
  let l = (BIG.items || []).filter(n => !BIG.removed.has(n.id));
  if (BIG.q) l = l.filter(n => n.name.toLowerCase().includes(BIG.q) || folderOf(n).toLowerCase().includes(BIG.q));
  l = l.slice();
  if (BIG.sort === 'size') l.sort((a, b) => b.size - a.size);
  if (BIG.sort === 'name') l.sort((a, b) => a.name.localeCompare(b.name, SH.i18n.locale));
  if (BIG.sort === 'date') l.sort((a, b) => b.mtime - a.mtime);
  return l.slice(0, 200);
}
function bigRow(n) {
  const t = typeOf(n);
  return `<div class="st-br" data-big="${n.id}">${badge(n.name, fullPath(n), T_(t).c)}
    <div class="st-bn"><b>${esc(n.name)}</b><span class="faint">${wp(folderOf(n))}</span></div>
    <span class="st-bs">${fmtB(n.size)}</span><span class="st-bd faint">${n.mtime ? fmtDate(n.mtime) : ''}</span>
    <span class="st-ba"><button class="iconbtn" data-bopen="${n.id}" title="${T('Show in Explorer')}">${ic('folder')}</button><button class="iconbtn" data-btrash="${n.id}" title="${T('Send to the Recycle Bin')}">${ic('trash')}</button></span></div>`;
}
/* confirmation inside the row itself: no browser dialogs */
function askInRow(row, text, yesLabel) {
  return new Promise(res => {
    const box = $('.st-ba', row); const prev = box.innerHTML;
    box.innerHTML = `<span class="st-ask"><span>${esc(text)}</span><button class="btn sm danger" data-yes>${esc(yesLabel)}</button><button class="btn sm ghost" data-no>${T('No')}</button></span>`;
    anim($('.st-ask', box), [{ opacity: 0, transform: 'translate3d(10px,0,0)' }, { opacity: 1, transform: 'none' }], { d: 260, e: EASE.spring });
    const done = v => { box.removeEventListener('click', on, true); if (!v) box.innerHTML = prev; res(v); };
    const on = e => { if (e.target.closest('[data-yes]')) { e.stopPropagation(); SH.sound('delete'); done(true); } else if (e.target.closest('[data-no]')) { e.stopPropagation(); SH.sound('click'); done(false); } };
    box.addEventListener('click', on, true);
    setTimeout(() => { if (box.isConnected && $('.st-ask', box)) done(false); }, 7000);
  });
}
/* permanent=true only after the user answered "Delete permanently?" for something that can't go to the Recycle Bin
   (the engine answers noBin:true and deletes nothing until then) */
async function toTrash(path, permanent) {
  if (!ST.real) return { ok: true, size: 0 };
  const c = await SH.engine('storage', 'can_delete', path); if (!c.ok) return { ok: false, error: c.why };
  return SH.engine('storage', 'trash', path, permanent === true);
}
async function fromTrash(path) { if (!ST.real) return { ok: true }; return SH.engine('storage', 'restore', path); }
async function renderBig(el) {
  if (needScan()) return scanFirst(el, T("Your largest files show up here, so you can decide what you don't need."));
  el.classList.add('fill');
  el.innerHTML = `<div class="pan st-big st-fp" data-asm>
      <div class="st-ph"><label class="field st-bq">${ic('search')}<input placeholder="${T('Filter by name or folder')}" spellcheck="false"></label>
        <div class="seg st-bsort"><span class="ind"></span><button data-s="size" class="on">${T('Size')}</button><button data-s="name">${T('Name')}</button><button data-s="date">${T('Date')}</button></div>
        <span class="sp"></span><span class="muted st-btot"></span></div>
      <div class="tbl-head st-bh"><span></span><span>${T('File')}</span><span>${T('Size')}</span><span>${T('Modified')}</span><span></span></div>
      <div class="st-blist st-scroll"><div class="sk" style="height:46px;margin:6px"></div><div class="sk" style="height:46px;margin:6px"></div></div></div>`;
  BIG.sort = 'size'; BIG.q = '';
  requestAnimationFrame(() => SH.placeSeg($('.st-bsort', el), true));
  try { BIG.items = await bigItems(); } catch (e) { ST.big = undefined; const l = $('.st-blist', el); if (l) loadErr(l, e, () => renderBig(el)); return; }
  const list = $('.st-blist', el);
  const total = () => { const l = bigList(); $('.st-btot', el).textContent = T('{n} files, {size}', { n: fmtInt(l.length), size: fmtB(l.reduce((a, n) => a + n.size, 0)) }); };
  const paint = () => { const l = bigList(); list.innerHTML = l.map(bigRow).join('') || SH.emptyState({ art: 'none', small: true, title: T('Nothing matches'), text: T('Try another word.') }); total(); paintIcons(list); };
  el._paint = paint;
  paint(); $$('.st-br', list).forEach((r, i) => anim(r, [{ opacity: 0, transform: 'translate3d(0,10px,0)' }, { opacity: 1, transform: 'none' }], { d: 380, delay: Math.min(i, 14) * 25, e: EASE.spring }));
  if (el.dataset.b) return; el.dataset.b = 1;
  el.addEventListener('input', e => { if (!e.target.closest('.st-bq')) return; BIG.q = e.target.value.trim().toLowerCase(); el._paint(); });
  el.addEventListener('click', async e => {
    const sb = e.target.closest('.st-bsort button[data-s]'); if (sb) { if (sb.classList.contains('on')) return;
      $$('.st-bsort button', el).forEach(x => x.classList.toggle('on', x === sb)); SH.placeSeg($('.st-bsort', el)); BIG.sort = sb.dataset.s; flipSort($('.st-blist', el)); total2(); return; }
    const o = e.target.closest('[data-bopen]'); if (o) { const n = BIG.items.find(x => x.id === +o.dataset.bopen); if (n) reveal(fullPath(n)); return; }
    const tr = e.target.closest('[data-btrash]'); if (!tr) return;
    const id = +tr.dataset.btrash; const n = BIG.items.find(x => x.id === id); const row = tr.closest('.st-br'); if (!n || !row) return;
    if (!await askInRow(row, T('Recycle it?'), T('Recycle'))) return;
    const path = fullPath(n); let r = await toTrash(path); let perm = false;
    const resetRow = () => { const b = $('.st-ba', row); if (b) b.innerHTML = $('.st-ba', document.createRange().createContextualFragment(bigRow(n))).innerHTML; };
    if (r && r.noBin) {          // no Recycle Bin here: nothing was deleted; only an explicit yes deletes it for good
      resetRow();
      if (!await askInRow(row, T('This drive has no Recycle Bin. Delete permanently?'), T('Delete permanently'))) return;
      r = await toTrash(path, true); perm = true;
    }
    if (!r || !r.ok) { SH.toast((r && r.error) || T("Couldn't send it to the Recycle Bin."), { kind: 'error' }); resetRow(); return; }
    BIG.removed.add(id); const h = row.offsetHeight;
    anim(row, [{ opacity: 1, transform: 'none', height: h + 'px' }, { opacity: 0, transform: 'translate3d(30px,0,0)', height: h + 'px', offset: .5 }, { opacity: 0, transform: 'translate3d(30px,0,0)', height: '0px', paddingTop: '0px', paddingBottom: '0px' }], { d: 440 })
      .finished.then(() => { row.remove(); total2(); }).catch(() => {});
    if (perm) {
      SH.logActivity(T('{name} deleted permanently', { name: n.name }), { sub: T('{size} freed', { size: fmtB(n.size) }), ic: 'trash', go: ID, tab: 'largest' });
      SH.toast(T('{name} deleted permanently.', { name: n.name })); return;
    }
    SH.logActivity(T('{name} sent to the Recycle Bin', { name: n.name }), { sub: T('{size} freed', { size: fmtB(n.size) }), ic: 'trash', go: ID, tab: 'largest' });
    SH.toast(T('{name} sent to the Recycle Bin.', { name: n.name }), { action: { label: T('Undo'), sound: 'undo', run: async () => {
      const rr = await fromTrash(path); if (!rr || !rr.ok) { SH.toast((rr && rr.error) || T("Couldn't restore it."), { kind: 'error' }); return; }
      BIG.removed.delete(id); const l = $('.st-blist', el); const before = new Map($$('.st-br', l).map(r => [r.dataset.big, r.getBoundingClientRect().top])); el._paint();
      const nr = $(`.st-br[data-big="${id}"]`, l); $$('.st-br', l).forEach(r => { const b = before.get(r.dataset.big); if (b !== undefined) { const dy = b - r.getBoundingClientRect().top; if (dy) anim(r, [{ transform: `translate3d(0,${dy}px,0)` }, { transform: 'none' }], { d: 420, e: EASE.spring }); } });
      if (nr) anim(nr, [{ opacity: 0, transform: 'scale(.96)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 420, delay: 120, e: EASE.spring }); } } });
  });
  function total2() { const l = bigList(); const t = $('.st-btot', el); if (t) t.textContent = T('{n} files, {size}', { n: fmtInt(l.length), size: fmtB(l.reduce((a, n) => a + n.size, 0)) }); }
}
function flipSort(list) {
  const before = new Map($$('.st-br', list).map(r => [r.dataset.big, r.getBoundingClientRect().top]));
  const rows = new Map($$('.st-br', list).map(r => [r.dataset.big, r]));
  bigList().forEach(n => { const r = rows.get(String(n.id)); if (r) list.appendChild(r); });
  $$('.st-br', list).forEach((r, i) => { const b = before.get(r.dataset.big); if (b === undefined) return; const dy = b - r.getBoundingClientRect().top; if (Math.abs(dy) > 1) anim(r, [{ transform: `translate3d(0,${dy}px,0)` }, { transform: 'none' }], { d: 560, delay: Math.min(i, 20) * 8, e: EASE.spring }); });
}

/* ---------------- Duplicates ---------------- */
const U = 'C:\\Users\\user\\';
const DUPS_MOCK = [
  { name: 'ubuntu-24.04.3-desktop-amd64.iso', size: 6.1 * GB, ext: 'iso', copies: [[U + 'Downloads', 'Sep 2, 2026'], [U + 'VirtualBox VMs\\ISOs', 'Sep 2, 2026']] },
  { name: 'Serum Presets Pack.zip', size: 2.3 * GB, ext: 'zip', copies: [[U + 'Downloads\\PLUGINS', 'Oct 18, 2026'], [U + 'Documents\\Music production\\packs', 'Oct 19, 2026']] },
  { name: 'matrix_backup.db', size: 412 * MB, ext: 'db', copies: Array.from({ length: 6 }, (_, i) => [U + `Documents\\Project_v${851 + i}\\data`, `Nov ${15 + Math.floor(i / 2)}, 2026`]) },
  { name: 'flstudio_win64_26.1.3.5570.exe', size: 1.1 * GB, ext: 'exe', copies: [[U + 'Downloads', 'Oct 2, 2026'], [U + 'Downloads\\Image-Line FL Studio Producer Edition 26.1.3.5570', 'Oct 2, 2026']] },
  { name: 'Match 2026-11-03 23-14.mp4', size: 820 * MB, ext: 'mp4', copies: [[U + 'Videos\\Medal', 'Nov 3, 2026'], [U + 'Videos\\Medal\\Exports', 'Nov 4, 2026']] },
  { name: 'movavi_setup_27.1.0.exe', size: 380 * MB, ext: 'exe', copies: [[U + 'Downloads', 'Nov 8, 2026'], [U + 'Downloads\\Movavi Video Editor 27.1.0 (x64)', 'Nov 8, 2026'], [U + 'Desktop', 'Nov 8, 2026']] },
  { name: 'thumbnail_final.psd', size: 240 * MB, ext: 'psd', copies: [[U + 'Downloads\\channel_art', 'Oct 4, 2026'], [U + 'Downloads\\auto_thumbnails', 'Oct 6, 2026'], [U + 'Documents\\VideoHub_channel\\art', 'Oct 6, 2026'], [U + 'Pictures', 'Oct 7, 2026']] },
  { name: 'vc_redist.x64.exe', size: 25 * MB, ext: 'exe', copies: Array.from({ length: 5 }, (_, i) => [U + ['Downloads', 'Downloads\\PLUGINS', 'Downloads\\installers', 'Documents\\tools', 'Desktop'][i], 'Oct 1, 2026']) },
];
let DUPS = [];
const dupType = d => d.type || EXT2T[d.ext] || 'other';
const dupFree = () => DUPS.filter(d => !d.done).reduce((a, d) => a + d.size * (d.copies.length - 1), 0);
const DUPMIN = { v: 1 };
async function renderDups(el) {
  if (needScan()) return scanFirst(el, T('Finds repeated files by comparing their content, not just the name.'));
  el.classList.add('fill');
  if (ST.real && !ST.dups) {
    el.innerHTML = `<div class="pan st-first st-dfind" data-asm><span class="st-fi">${ic('copy')}</span><b>${T('Find duplicate files')}</b>
      <span class="muted">${T('Compares by size, then by a hash of the start and end, and finally by the full content. It skips Windows, the Recycle Bin and program and game folders (Program Files, ProgramData, AppData, Steam, Epic, GOG, Xbox), where identical files are needed.')}</span>
      <div class="seg st-dmin"><span class="ind"></span>${[1, 10, 100].map(v => [v, T('From {n} MB', { n: v })]).map(([v, l]) => `<button data-min="${v}"${DUPMIN.v === v ? ' class="on"' : ''}>${l}</button>`).join('')}</div>
      <button class="btn pri" data-dfind>${ic('search')}${T('Find')}</button>
      <div class="st-dprog" hidden><div class="bar"><span style="transform:scaleX(0)"></span></div><span class="faint st-dpt">&nbsp;</span><button class="btn sm ghost" data-dstop>${ic('x')}${T('Cancel')}</button></div></div>`;
    requestAnimationFrame(() => SH.placeSeg($('.st-dmin', el), true));
    if (!el.dataset.bf) { el.dataset.bf = 1; el.addEventListener('click', dupFindClick); }
    if (ST.dupJob) showDupProgress(el);
    return;
  }
  DUPS = ST.real ? ST.dups.groups.map((g, i) => ({ id: i, name: g.name, size: g.size, ext: g.ext, type: g.type, keep: 0, done: false,
    copies: g.copies.map(c => [c.dir, c.mtime ? fmtDate(c.mtime) : '', c.path]) }))
    : DUPS_MOCK.map((d, i) => ({ ...d, id: i, keep: 0, done: false, copies: d.copies.map(c => [c[0], fmtDate(Date.parse(c[1]))]) }));
  if (!DUPS.length) { el.innerHTML = `<div class="pan st-first" data-asm><span class="st-fi ok">${ic('check')}</span><b>${T('No duplicate files')}</b><span class="muted">${T('Nothing from {n} MB up is duplicated. Nice.', { n: DUPMIN.v })}</span><button class="btn sec" data-dagain>${ic('updater')}${T('Search again')}</button></div>`; bindDups(el); return; }
  const mxd = Math.max(...DUPS.map(d => d.size * (d.copies.length - 1)));
  el.innerHTML = `<div class="st-dup">
    <aside class="pan st-dsum" data-asm><h4>${T('Duplicate files')}${ST.real ? `<em><button class="btn sm ghost" data-dagain>${ic('updater')}${T('Search again')}</button></em>` : ''}</h4>
      <div class="big"><span class="st-dfree">0</span><small>${T('GB you can free up')}</small></div><p class="muted st-dsub"></p>
      ${ST.real ? `<p class="faint st-dskip">${T('Program and game files are left out: identical files there are needed by the apps.')}</p>` : ''}
      <div class="st-dbars st-scroll">${DUPS.map(d => `<button class="st-dbr" data-dgo="${d.id}"><span class="st-dbn"><span>${esc(d.name)}</span><b>${fmtB(d.size * (d.copies.length - 1))}</b></span><span class="bar"><span style="transform:scaleX(${(d.size * (d.copies.length - 1) / mxd).toFixed(4)});background:${T_(dupType(d)).c}"></span></span></button>`).join('')}</div>
      <button class="btn danger" data-dall>${ic('trash')}${T('Delete all copies')}</button></aside>
    <div class="st-dgroups st-scroll">${DUPS.map(d => `<div class="pan st-dg${d.id < 2 ? ' open' : ''}" data-dg="${d.id}" data-asm>
      <button class="st-dgh" data-dt="${d.id}">${badge(d.name, d.copies[0] && d.copies[0][2], T_(dupType(d)).c)}
        <div class="st-bn"><b>${esc(d.name)}</b><span class="faint">${T('{n} copies of {size}', { n: d.copies.length, size: fmtB(d.size) })}</span></div>
        <span class="chip acc">${T('Frees {size}', { size: fmtB(d.size * (d.copies.length - 1)) })}</span><span class="st-dch">${ic('chevd')}</span></button>
      <div class="st-dbody"><div><div class="st-dcs">${d.copies.map((c, j) => `<button class="st-dc${j === d.keep ? ' keep' : ''}" data-dk="${d.id}:${j}"><span class="st-radio"></span><span class="st-dp">${wp(c[0])}</span><span class="faint">${c[1]}</span><span class="st-dkl">${j === d.keep ? T('Keep') : T('Delete')}</span></button>`).join('')}</div>
        <div class="st-dfoot"><span class="faint">${T('Pick which one to keep. The others go to the Recycle Bin.')}</span><button class="btn sm sec" data-dclean="${d.id}">${T('Delete the other copies')}</button></div></div></div>
    </div>`).join('')}</div></div>`;
  SH.assemble(el, 40);
  updDups(el); bindDups(el); paintIcons(el);
}
function updDups(el, d = 900) {
  const f = dupFree(); const el2 = $('.st-dfree', el); if (!el2) return; SH.countUp(el2, +(f / GB).toFixed(1), d, 1);
  const left = DUPS.filter(x => !x.done); $('.st-dsub', el).textContent = left.length ? T('{n} duplicate copies in {groups} groups. Compared by content, not just by name.', { n: left.reduce((a, x) => a + x.copies.length - 1, 0), groups: left.length }) : T('No duplicate files left.');
  $('[data-dall]', el).disabled = !left.length;
}
function bindDups(el) {
  if (el.dataset.bd) return; el.dataset.bd = 1;
  el.addEventListener('click', async e => {
    if (e.target.closest('[data-dagain]')) { SH.sound('refresh'); ST.dups = null; renderDups(el); return; }
    const go = e.target.closest('[data-dgo]'); if (go) { const g = $(`[data-dg="${go.dataset.dgo}"]`, el); if (!g || g.style.display === 'none') return;
      if (!g.classList.contains('open')) $('[data-dt]', g).click();
      g.scrollIntoView({ block: 'nearest', behavior: SH.effInt() === 'min' ? 'auto' : 'smooth' }); g.classList.add('flash'); setTimeout(() => g.classList.remove('flash'), 1400); return; }
    const tg = e.target.closest('[data-dt]'); if (tg) { const g = tg.closest('.st-dg'); g.classList.toggle('open'); if (g.classList.contains('open')) $$('.st-dc', g).forEach((c, i) => anim(c, [{ opacity: 0, transform: 'translate3d(0,-6px,0)' }, { opacity: 1, transform: 'none' }], { d: 300, delay: 60 + i * 30 })); return; }
    const k = e.target.closest('[data-dk]'); if (k) { const [gid, j] = k.dataset.dk.split(':').map(Number); const d = DUPS[gid];
      /* a copy already sent to the Recycle Bin (the group was cleaned in part) cannot become the one kept: the next
         clean would then send the last copy on disk away too */
      if (j !== d.keep && d.gone && d.gone.has(copyPath(d, d.copies[j]))) { SH.sound('unavailable'); return; }
      d.keep = j;
      $$(`[data-dk^="${gid}:"]`, el).forEach(b => { const on = b.dataset.dk === `${gid}:${j}`; b.classList.toggle('keep', on); $('.st-dkl', b).textContent = on ? T('Keep') : T('Delete'); });
      anim($('.st-radio', k), [{ transform: 'scale(.6)' }, { transform: 'scale(1)' }], { d: 320, e: EASE.spring }); return; }
    const c = e.target.closest('[data-dclean]'); if (c) { SH.sound('delete'); const btn = c; btn.disabled = true; await cleanGroups([DUPS[+c.dataset.dclean]], el); btn.disabled = false; return; }
    const all = e.target.closest('[data-dall]'); if (all) {
      if (all.dataset.sure !== '1') { all.dataset.sure = '1'; const old = all.innerHTML; all.innerHTML = `${ic('alert')}${T('Press again to confirm')}`; setTimeout(() => { all.dataset.sure = ''; all.innerHTML = old; }, 4000); return; }
      all.dataset.sure = ''; all.disabled = true; SH.sound('delete'); await cleanGroups(DUPS.filter(d => !d.done), el); }
  });
}
function dupFindClick(e) {
  const el = e.currentTarget;
  const m = e.target.closest('[data-min]'); if (m) { $$('.st-dmin button', el).forEach(x => x.classList.toggle('on', x === m)); SH.placeSeg($('.st-dmin', el)); DUPMIN.v = +m.dataset.min; return; }
  if (e.target.closest('[data-dstop]')) { if (ST.dupJob) ST.dupJob.cancel(); return; }
  if (!e.target.closest('[data-dfind]') || ST.dupJob) return;
  const act = SH.activity.start(ID, { key: 'dups', label: T('Looking for duplicates'), go: { tab: 'duplicates' }, cancel: () => ST.dupJob && ST.dupJob.cancel() });
  ST.dupJob = SH.job('storage', 'duplicates', [DUPMIN.v], { sound: 'scan', activity: act, onProgress: m => { ST.dupProg = m; paintDupProg(); } });
  showDupProgress(el);
  ST.dupJob.then(r => { ST.dups = r; ST.dupJob = null; const tab = $(`#v-${ID} .tab[data-tab="duplicates"]`); if (tab) renderDups(tab);
    const msg = r && r.wasted ? T('{size} in duplicate files.', { size: fmtB(r.wasted) }) : '';
    if (!act.end({ ok: true, summary: msg || T('No duplicates found'), quiet: !r }) && msg) SH.toast(msg); })
    .catch(err => { ST.dupJob = null; const tab = $(`#v-${ID} .tab[data-tab="duplicates"]`); if (tab) renderDups(tab);
      if (act.end(err.cancelled ? { cancelled: true } : { ok: false, error: err.message })) return;
      if (!err.cancelled) SH.toast(T("Couldn't finish the search: {error}", { error: err.message }), { kind: 'error' }); });
}
function showDupProgress(el) { const p = $('.st-dprog', el); if (!p) return; p.hidden = false; $('[data-dfind]', el).disabled = true; anim(p, [{ opacity: 0, transform: 'translate3d(0,6px,0)' }, { opacity: 1, transform: 'none' }], { d: 300 }); paintDupProg(); }
function paintDupProg() {
  const m = ST.dupProg; const el = $(`#v-${ID} .tab[data-tab="duplicates"]`); if (!m || !el) return;
  const b = $('.st-dprog .bar>span', el); if (b) b.style.transform = `scaleX(${(m.pct || 0).toFixed(4)})`;
  const t = $('.st-dpt', el); if (t) t.textContent = T('{pct}%, {n} groups found. {file}', { pct: Math.round((m.pct || 0) * 100), n: m.data && m.data.groups || 0, file: m.text ? m.text.split('\\').pop() : '' });
}
async function cleanGroups(groups, el) {
  if (!groups.length) return;
  let freed = 0; const moved = []; const failed = []; const nobin = [];
  for (const d of groups) {
    d.gone = d.gone || new Set();
    const paths = dupPaths(d).filter(p => !d.gone.has(p));  /* a retry skips the copies already in the Recycle Bin */
    let ok = 0;
    for (const p of paths) { const r = await toTrash(p); if (r && r.ok) { ok++; moved.push(p); d.gone.add(p); freed += d.size; } else if (r && r.noBin) nobin.push({ d, p }); else failed.push(r && r.error); }
    if (dupPaths(d).every(p => d.gone.has(p))) finishGroup(d, el);
  }
  updDups(el, 500);
  if (nobin.length) {          // nothing was deleted from those: ask before deleting for good
    SH.toast(nobin.length > 1 ? T('{n} copies are on a drive without a Recycle Bin, so they were not deleted.', { n: nobin.length }) : T('1 copy is on a drive without a Recycle Bin, so it was not deleted.'),
      { ms: 12000, kind: 'warning', action: { label: T('Delete permanently'), sound: 'delete', run: () => deleteForGood(nobin, el) } });
  }
  if (failed.length) { const why = failed.find(Boolean) || T('in use'); SH.toast(failed.length > 1 ? T("{n} copies couldn't be moved: {why}", { n: failed.length, why }) : T("1 copy couldn't be moved: {why}", { why }), { kind: 'warning' }); }
  if (!moved.length) return;
  SH.logActivity(T('Duplicate copies sent to the Recycle Bin'), { sub: T('{size} freed', { size: fmtB(freed) }), ic: 'copy', go: ID, tab: 'duplicates' });
  SH.toast(T('{size} sent to the Recycle Bin.', { size: fmtB(freed) }), { ms: 7000, action: { label: T('Undo'), sound: 'undo', run: async () => {
    let back = 0; for (const p of moved) { const r = await fromTrash(p); if (r && r.ok) back++; }
    groups.forEach(d => { moved.forEach(p => d.gone && d.gone.delete(p)); d.done = false; const b = $(`[data-dgo="${d.id}"]`, el); if (b) b.classList.remove('done'); const g = $(`[data-dg="${d.id}"]`, el); if (g) { g.style.display = ''; g.getAnimations().forEach(a => a.cancel()); anim(g, [{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { d: 400, e: EASE.spring }); } });
    updDups(el, 500); if (back < moved.length) SH.toast(T('Restored {n} of {total}. The rest are in the Recycle Bin.', { n: back, total: moved.length }), { kind: 'warning' });
  } } });
}

const copyPath = (d, c) => c[2] || (c[0] + '\\' + d.name);
const dupPaths = d => d.copies.filter((c, j) => j !== d.keep).map(c => copyPath(d, c));
function finishGroup(d, el) {
  d.done = true; const b = $(`[data-dgo="${d.id}"]`, el); if (b) b.classList.add('done');
  const g = $(`[data-dg="${d.id}"]`, el); if (!g) return; const h = g.offsetHeight;
  anim(g, [{ opacity: 1, transform: 'none', height: h + 'px' }, { opacity: 0, transform: 'scale(.97)', height: h + 'px', offset: .45 }, { opacity: 0, transform: 'scale(.97)', height: '0px', paddingTop: '0px', paddingBottom: '0px', marginBottom: '-14px' }], { d: 480 })
    .finished.then(() => { g.style.display = 'none'; }).catch(() => {});
}
/* the user chose "Delete permanently" for copies that can't go to the Recycle Bin: no undo for these */
async function deleteForGood(items, el) {
  let freed = 0, n = 0; const hit = new Set(); const failed = [];
  for (const { d, p } of items) {
    const r = await toTrash(p, true);
    if (r && r.ok) { n++; freed += d.size; d.gone = d.gone || new Set(); d.gone.add(p); hit.add(d); } else failed.push(r && r.error);
  }
  hit.forEach(d => { if (dupPaths(d).every(p => d.gone.has(p))) finishGroup(d, el); });
  updDups(el, 500);
  if (failed.length) SH.toast(T("{n} copies couldn't be deleted: {why}", { n: failed.length, why: failed.find(Boolean) || T('in use') }), { kind: 'warning' });
  if (!n) return;
  SH.logActivity(T('Duplicate copies deleted permanently'), { sub: T('{size} freed', { size: fmtB(freed) }), ic: 'copy', go: ID, tab: 'duplicates' });
  SH.toast(T('{size} deleted permanently.', { size: fmtB(freed) }), { ms: 7000 });
}

/* ---------------- Compare ---------------- */
const CMP_MOCK = {
  prev: Date.parse('2026-11-10T10:00:00'), delta: 16.6 * GB, dfiles: 18920,
  changes: [[U + 'Videos\\Medal', 6.1, 214], [U + 'Documents (Project_v847 to Project_v856)', 4.8, 18420], [U + '.ollama\\models', 4.7, 6], [U + 'Downloads', -3.2, -312],
    ['C:\\Program Files (x86)\\Steam\\steamapps\\common', -2.6, -2810], ['C:\\$Recycle.Bin', 2.4, 1880], [U + 'AppData\\Local\\Temp', 1.9, 6230],
    ['C:\\Windows\\SoftwareDistribution', 1.4, 240], [U + 'AppData\\Local\\NVIDIA\\DXCache', .9, 1410], ['C:\\ProgramData\\Package Cache', .6, 58], [U + 'AppData\\Roaming\\npm', -.4, -3200]].map(([p, g, f]) => [p, g * GB, f]),
  history: [['2026-10-13', 561], ['2026-10-20', 566], ['2026-10-27', 571], ['2026-11-03', 575], ['2026-11-10', 578], ['2026-11-17', 592]].map(([d, g]) => [Date.parse(d) / 1000, g * GB]),
  newbig: [['sha256-ff82381e2bea.gguf', 7.1, U + '.ollama\\models\\blobs', '2026-11-12'], ['Match 2026-11-14 22-40.mp4', 1.4, U + 'Videos\\Medal', '2026-11-14'], ['Project_v856.zip', 1.2, U + 'Documents', '2026-11-17'],
    ['nvidia_driver_617.42.exe', .9, U + 'Downloads', '2026-11-11'], ['Kontakt 8 Factory Library 2.nicnt', .8, 'C:\\Program Files\\Native Instruments', '2026-11-13']].map(([n, g, d, t]) => [d + '\\' + n, g * GB, Date.parse(t) / 1000]),
};
const dshort = ms => new Date(ms).toLocaleDateString(SH.i18n.locale, { day: 'numeric', month: 'short' });
async function renderCompare(el) {
  if (needScan()) return scanFirst(el, T("Every scan is saved. With two, you'll see which folders grew and which large files are new."));
  el.classList.add('fill');
  let D;
  if (ST.real && ST.cmp === undefined) {            // the comparison takes a moment: skeleton meanwhile, error box if it fails
    el.innerHTML = `<div class="st-cmpsk" aria-busy="true"><p class="muted st-cmpl">${T('Comparing with the previous scan…')}</p><div class="sk" style="height:120px"></div><div class="sk" style="height:220px;margin-top:14px"></div></div>`;
    try { D = ST.cmp = await SH.engine('storage', 'compare'); } catch (e) { ST.cmp = undefined; el.classList.remove('fill'); loadErr(el, e, () => renderCompare(el)); return; }
    if (!D) { ST.cmp = undefined; el.classList.remove('fill'); loadErr(el, null, () => renderCompare(el)); return; }
  } else D = ST.real ? ST.cmp : CMP_MOCK;
  const hist = (D.history || []).map(([w, s]) => [dshort(w * 1000), Math.round(s / GB)]);
  if (!D.prev) {
    el.innerHTML = `<div class="pan st-first" data-asm><span class="st-fi">${ic('grow')}</span><b>${T('This is the first scan of {name}', { name: esc(targetShort()) })}</b>
      <span class="muted">${T("It's saved. When you scan again (in a few days, or after installing or downloading things) you'll see here which folders grew, which shrank and which large files are new.")}</span>
      ${hist.length ? `<span class="faint">${T('{n} GB are in use right now.', { n: fmtInt(hist[hist.length - 1][1]) })}</span>` : ''}</div>`;
    SH.assemble(el, 40); return;
  }
  const CH = D.changes.map(([p, b, f]) => [p, b / GB, f]); const mx = Math.max(.01, ...CH.map(c => Math.abs(c[1])));
  const NB = (D.newbig || []).map(([p, b, t]) => [p.split('\\').pop(), b / GB, p.split('\\').slice(0, -1).join('\\'), dshort(t * 1000)]);
  const H = hist.length ? hist : [[dshort(Date.now()), 0]];
  const vals = H.map(h => h[1]); const lo = Math.min(...vals) - 4, hi = Math.max(...vals) + 4;
  const W = 320, HH = 90; const px = i => 10 + i * (W - 20) / Math.max(1, H.length - 1), py = v => HH - 14 - (v - lo) / Math.max(1, hi - lo) * (HH - 28);
  const path = H.map(([, v], i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const dg = D.delta / GB;
  el.innerHTML = `<div class="st-cmp">
    <div class="st-cl">
      <div class="pan st-diff st-fp" data-asm>
        <div class="st-ph st-cph"><div class="big">${dg >= 0 ? '+' : '−'}${fmt1(Math.abs(dg))}<small>${T('GB since {date}', { date: dshort(D.prev) })}</small></div><p class="muted">${D.dfiles >= 0 ? T('{n} more files than in the previous scan. Biggest changes first.', { n: fmtInt(Math.abs(D.dfiles)) }) : T('{n} fewer files than in the previous scan. Biggest changes first.', { n: fmtInt(Math.abs(D.dfiles)) })}</p></div>
        <div class="tbl-head st-dh"><span>${T('Folder')}</span><span class="st-axis"><span>${T('Shrank')}</span><span>${T('Grew')}</span></span><span>${T('Change')}</span></div>
        <div class="st-scroll">${CH.length ? CH.map(([p, d, f]) => `<div class="st-dr"><div class="st-bn"><b>${esc(p.split('\\').filter(Boolean).pop())}</b><span class="faint">${wp(p)}</span></div>
          <span class="st-dv"><span class="${d > 0 ? 'up' : 'down'}" style="--v:${(Math.abs(d) / mx).toFixed(4)}"></span></span>
          <span class="st-dn ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${fmt1(Math.abs(d))} ${unit('GB')}<small>${T('{n} files', { n: (f >= 0 ? '+' : '−') + fmtInt(Math.abs(f)) })}</small></span></div>`).join('') : SH.emptyState({ art: 'ok', small: true, title: T('Almost nothing changed'), text: T('No folder changed by more than 64 MB.') })}</div></div>
    </div>
    <div class="st-cr">
      <div class="pan st-hist" data-asm><h4>${T('Space used')} <em>${T('{n} scans', { n: H.length })}</em></h4>
        <svg viewBox="0 0 ${W} ${HH}" class="st-spark"><path class="area" d="${path} L${px(H.length - 1)},${HH} L${px(0)},${HH} Z"/><path class="ln" d="${path}"/>${H.map(([, v], i) => `<circle cx="${px(i)}" cy="${py(v)}" r="${i === H.length - 1 ? 4 : 2.5}"/>`).join('')}</svg>
        <div class="st-hx">${H.slice(-6).map(([d, v]) => `<span><b>${v}</b>${d}</span>`).join('')}</div></div>
      <div class="pan st-new st-fp" data-asm><h4>${T('New large files')} <em>${T('{n} since the last scan', { n: NB.length })}</em></h4><div class="rows st-scroll">${NB.length ? NB.map(([n, g, p, d]) => `<div class="row">${badge(n, p + '\\' + n, T_(EXT2T[extOf(n)] || 'other').c)}<div class="rt"><b>${esc(n)}</b><span>${wp(p)}, ${d}</span></div><span class="st-bs">${fmt1(g)} ${unit('GB')}</span></div>`).join('') : SH.emptyState({ art: 'ok', small: true, title: T('None'), text: T('No new file over 300 MB showed up.') })}</div></div>
    </div></div>`;
  SH.assemble(el, 40); paintIcons(el);
  const ln = $('.st-spark .ln', el); const L = ln.getTotalLength(); ln.style.strokeDasharray = `${L} ${L}`; anim(ln, [{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { d: 1200, delay: 200 });
  anim($('.st-spark .area', el), [{ opacity: 0 }, { opacity: 1 }], { d: 800, delay: 700 });
  $$('.st-spark circle', el).forEach((c, i) => anim(c, [{ opacity: 0, transform: 'scale(0)' }, { opacity: 1, transform: 'scale(1)' }], { d: 380, delay: 200 + i * 170, e: EASE.spring }));
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
}

/* ---------------- drives (header) ---------------- */
let actEl = null;
function drivesHTML() {
  const ds = ST.real ? ST.drives : [{ root: 'C:\\', letter: 'C:', total: 953 * GB, free: 361 * GB, system: true }];
  const custom = ST.target && !/^[A-Za-z]:\\$/.test(ST.target);
  return `<div class="seg st-drv"><span class="ind"></span>${ds.map(d => `<button data-drv="${esc(d.root)}"${!custom && ST.target === d.root || (!ST.real && d.system) ? ' class="on"' : ''} title="${T('{free} free of {total}', { free: fmtB(d.free), total: fmtB(d.total) })}${d.label ? ', ' + esc(d.label) : ''}">${ic('drive')}${esc(d.letter)} ${fmtInt(d.total / GB)} ${unit('GB')}</button>`).join('')}
    <button data-drv="pick"${custom ? ' class="on"' : ''} title="${custom ? esc(ST.target) : T('Choose a folder')}">${ic('folder')}${custom ? esc(ST.target.split('\\').filter(Boolean).pop()) : T('Other folder')}</button></div>
    <button class="btn pri" data-scan>${ic('search')}${T('Scan')}</button>`;
}
function paintActions() { if (!actEl) return; actEl.innerHTML = drivesHTML(); requestAnimationFrame(() => SH.placeSeg($('.st-drv', actEl), true)); }
async function refreshDrives() { try { ST.drives = await SH.engine('storage', 'drives') || ST.drives; } catch (e) { console.error(e); } }
/* after a new scan, the other tabs already open are rebuilt with its data */
const RENDERED = {};
function rerenderOthers() { for (const [tab, el] of Object.entries(RENDERED)) if (tab !== 'map' && el.isConnected) { el.classList.remove('in'); RENDER[tab](el); } }
const RENDER = { map: renderMap, tree: renderTree, types: renderTypes, largest: renderBig, duplicates: renderDups, compare: renderCompare };

/* ---------------- registration ---------------- */
SH.module({
  id: ID, real: true,
  actions(el, ctx) {
    ctxRef = ctx; actEl = el; paintActions();
    isReal().then(r => { if (r) paintActions(); });
    el.addEventListener('click', async e => {
      if (e.target.closest('[data-scan]')) { if (TM.scanning) return; SH.sound('scan_start'); if (curTab !== 'map') ctx.setTab('map'); setTimeout(() => runScan(true).then(() => rerenderOthers()), curTab === 'map' ? 0 : 260); return; }
      const b = e.target.closest('[data-drv]'); if (!b || TM.scanning) return;
      if (b.dataset.drv === 'pick') {
        if (!await isReal()) { SH.toast(T('Choosing a folder only works inside the app.')); return; }
        const p = await SH.engine('storage', 'pick_folder'); if (!p) return;
        ST.target = p;
      } else { if (ST.target === b.dataset.drv && b.classList.contains('on')) return; ST.target = b.dataset.drv; }
      paintActions(); anim($('[data-scan]', el), [{ transform: 'scale(1)' }, { transform: 'scale(1.06)', offset: .4 }, { transform: 'scale(1)' }], { d: 420, keep: true });
      if (ST.real) { SH.sound('scan_start'); if (curTab !== 'map') ctx.setTab('map'); setTimeout(() => runScan(true).then(() => rerenderOthers()), curTab === 'map' ? 0 : 260); }
    });
  },
  renderTab(tab, el) { RENDERED[tab] = el; RENDER[tab](el); },
  enterTab(tab) {
    curTab = tab;
    if (tab === 'map') { TM.dirty = true; if (!TM.ready && !TM.scanning) openMap(); else { renderLegend(); markLegend(); } }
    else if (RENDERED[tab] && (ST.done ? $('.st-first [data-goscan]', RENDERED[tab]) : ($('.st-first [data-goscan]', RENDERED[tab]) && TM.scanning) || ($('.st-first.st-wait', RENDERED[tab]) && !TM.scanning))) RENDER[tab](RENDERED[tab]);
    if (tab === 'tree' && treeTarget) { const n = treeTarget; treeTarget = null; setTimeout(() => revealInTree(n), 120); }
  },
  leaveTab() { TM.hover = TM.hoverTop = null; TM.tipA.set(0); },
  leave() { curTab = null; },
  enter() { const v = $(`#v-${ID} .subnav .on`); curTab = v ? v.dataset.tab : 'map'; },
});
SH.actions.add([
  { t: T('View the largest files on the drive'), go: ID, tab: 'largest', ic: 'file' },
  { t: T('What has grown on the drive since the last scan'), go: ID, tab: 'compare', ic: 'grow' },
  { t: T('View the drive by file type'), go: ID, tab: 'types', ic: 'grid' },
  { t: T("Explore the drive's folders"), go: ID, tab: 'tree', ic: 'folder' },
]);
/* the folders normal mode can't read: the administrator prompt; the elevated copy comes back to the map and scans
   again (read-only, so it simply runs) */
document.addEventListener('click', e => {
  if (!e.target.closest('#v-storage [data-stadm]')) return;
  SH.requireAdmin(T('to read the system folders Windows keeps from normal mode.'), { resume: { action: 'storage.scan', args: {} } });
});
SH.resume.register('storage.scan', async (a, r) => {
  const p = await r.open('storage', 'map'); if (!p) return false;
  const b = await r.until(() => { const x = $('#v-storage [data-scan]'); return x && !x.disabled ? x : null; }, 8000); if (!b) return false;
  b.click(); return true;
});
})();
