"""Every sentence the interface translates exists in every language, and translations keep the key's {placeholders}
and inline tags: SH.t('…') / SH.tc('ctx', '…') and the files' own aliases of them (t, T, _t, tr, tc, _tc) called
with a literal string, plus the static HTML's data-t / data-t-attr text. Keys built at run time (t(x.label)) are
not seen here; a missing entry would only show in English, never break anything, but it is still a bug."""
import glob
import json
import os
import re
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI = os.path.join(ROOT, "stellarhub", "ui")
LANGS = ["ru", "es", "pt", "it", "fr", "zh", "ja"]
STR = r"""('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\$]|\\.|\$(?!\{))*`)"""
ESC = {"n": "\n", "'": "'", '"': '"', "`": "`", "\\": "\\", "t": "\t"}


def unquote(s):
    b = s[1:-1]
    b = re.sub(r"\\u\{([0-9a-fA-F]+)\}", lambda m: chr(int(m.group(1), 16)), b)
    b = re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), b)
    return re.sub(r"\\(.)", lambda m: ESC.get(m.group(1), m.group(1)), b)


def strip_comments(src):
    """Comments out (their examples are not real keys), lines kept so the line numbers still match."""
    src = re.sub(r"/\*.*?\*/", lambda m: re.sub(r"[^\n]", " ", m.group(0)), src, flags=re.S)
    return re.sub(r"(^|[\s;{}])//[^\n]*", lambda m: m.group(1), src)


def dictionary(lang):
    d = {}
    for f in sorted(glob.glob(os.path.join(UI, "i18n", lang, "*.json"))):
        with open(f, encoding="utf-8") as fh:
            d.update(json.load(fh))
    return d


def uses():
    """(file, line, context or None, key) for every literal key."""
    out = []
    for f in glob.glob(os.path.join(UI, "js", "**", "*.js"), recursive=True):
        with open(f, encoding="utf-8") as fh:
            src = strip_comments(fh.read())
        names = {"SH.t": None}
        for m in re.finditer(r"\b(?:const|let)\s+(\w+)\s*=\s*SH\.t\s*[;,]", src):
            names[m.group(1)] = None
        for m in re.finditer(r"(?:const\s+)?(\w+)\s*=\s*\(\w+,\s*\w+\)\s*=>\s*SH\.tc\('(\w+)'", src):
            names[m.group(1)] = m.group(2)
        for n, ctx in names.items():
            for m in re.finditer(r"(?<![\w.$])" + re.escape(n) + r"\(\s*" + STR, src):
                out.append((f, src.count("\n", 0, m.start()) + 1, ctx, unquote(m.group(1))))
        for m in re.finditer(r"SH\.tc\(\s*'(\w+)',\s*" + STR, src):
            out.append((f, src.count("\n", 0, m.start()) + 1, m.group(1), unquote(m.group(2))))
    for f in glob.glob(os.path.join(UI, "*.html")):
        with open(f, encoding="utf-8") as fh:
            src = fh.read()
        for m in re.finditer(r"<(\w+)([^>]*\sdata-t(?:\s|>|=)[^>]*)>([^<]+)</\1>", src):
            out.append((f, src.count("\n", 0, m.start()) + 1, None, m.group(3).strip()))
        for m in re.finditer(r"<\w+([^>]*data-t-attr=\"([^\"]+)\"[^>]*)>", src):
            for a in m.group(2).split():
                v = re.search(r"\s" + re.escape(a) + r"=\"([^\"]*)\"", m.group(1))
                if v:
                    out.append((f, src.count("\n", 0, m.start()) + 1, None, v.group(1)))
    return out


def py_uses():
    """The engine's literal keys: tr('…'), tc('ctx', '…'), privacy's _L('…') and the Scheduled Tasks log's _m('…')
    (shown through SH.tc('autopilot', …))."""
    import ast
    out = []
    for f in glob.glob(os.path.join(ROOT, "stellarhub", "**", "*.py"), recursive=True):
        with open(f, encoding="utf-8") as fh:
            tree = ast.parse(fh.read())
        for n in ast.walk(tree):
            if not isinstance(n, ast.Call) or not n.args:
                continue
            name = n.func.id if isinstance(n.func, ast.Name) else n.func.attr if isinstance(n.func, ast.Attribute) else None
            a = [x.value if isinstance(x, ast.Constant) and isinstance(x.value, str) else None for x in n.args[:2]]
            if name in ("tr", "_L") and a[0] is not None:
                out.append((f, n.lineno, None, a[0]))
            elif name == "_m" and a[0] is not None:
                out.append((f, n.lineno, "autopilot", a[0]))
            elif name == "tc" and len(a) > 1 and a[0] is not None and a[1] is not None:
                out.append((f, n.lineno, a[0], a[1]))
    return out


PH = lambda s: sorted(set(re.findall(r"\{(\w+)\}", s)))
TAGS = lambda s: sorted(re.findall(r"</?[a-zA-Z]+[^>]*>", s))


class Keys(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.uses = uses()
        cls.dicts = {lang: dictionary(lang) for lang in LANGS}

    def test_russian_dictionary_localizes_bit_rates(self):
        ru = self.dicts["ru"]
        self.assertEqual({u: ru.get("unit|" + u) for u in ("Kb/s", "Mb/s", "Gb/s", "Tb/s")}, {
            "Kb/s": "Кбит/с", "Mb/s": "Мбит/с", "Gb/s": "Гбит/с", "Tb/s": "Тбит/с"})

    def test_the_scan_finds_the_keys(self):
        self.assertGreater(len(self.uses), 3000)

    def test_every_literal_key_is_translated(self):
        for lang, d in self.dicts.items():
            missing = sorted({f"{os.path.relpath(f, UI)}:{ln} {k!r}" for f, ln, ctx, k in self.uses
                              if re.search(r"[A-Za-z]", k) and not ((ctx and d.get(ctx + "|" + k)) or d.get(k))})
            self.assertEqual(missing, [], lang)

    def test_every_engine_message_is_translated(self):
        found = py_uses()
        self.assertGreater(len(found), 500)
        for lang, d in self.dicts.items():
            missing = sorted({f"{os.path.relpath(f, ROOT)}:{ln} {k!r}" for f, ln, ctx, k in found   # ('{error}' alone has no words)
                              if re.search(r"[A-Za-z]", re.sub(r"\{\w+\}", "", k)) and not ((ctx and d.get(ctx + "|" + k)) or d.get(k))})
            self.assertEqual(missing, [], lang)

    def test_translations_keep_placeholders_and_tags(self):
        for lang, d in self.dicts.items():
            bad = []
            for k, v in d.items():
                if not isinstance(v, str):
                    bad.append(k)
                    continue
                key = k.split("|", 1)[1] if re.match(r"^\w+\|", k) else k
                forms = v.split("|")
                if lang == "ru" and len(forms) != 1 and len(forms) != 3:
                    bad.append(k)
                    continue
                for form in forms:
                    if form and (PH(key) != PH(form) or TAGS(key) != TAGS(form)):
                        bad.append(k)
                        break
            self.assertEqual(bad, [], lang)


class RussianWording(unittest.TestCase):
    def test_storage_duplicate_summary_is_grammatical(self):
        self.assertEqual(dictionary("ru")["{n} duplicate copies in {groups} groups. Compared by content, not just by name."],
                         "Дубликатов: {n}, групп: {groups}. Сравнение по содержимому, а не только по имени.")

    def test_display_title_stays_compact(self):
        self.assertEqual(dictionary("ru")["{n} inch, {res}"], "Диагональ {n}″; {res}")

    @unittest.skipUnless(shutil.which("node"), "needs Node.js")
    def test_javascript_merged_dictionary_keeps_actions_and_plurals_unambiguous(self):
        script = r"""
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('stellarhub/ui/js/i18n.js', 'utf8');
const areas = [...src.match(/const AREAS = \[([\s\S]*?)\];/)[1].matchAll(/'([\w-]+)'/g)].map(m => m[1]);
const dict = {};
for (const area of areas) {
  try { Object.assign(dict, JSON.parse(fs.readFileSync(`stellarhub/ui/i18n/ru/${area}.json`, 'utf8'))); } catch {}
}
const sandbox = {
  navigator: {languages: ['ru-RU']},
  localStorage: {getItem: () => 'ru'},
  document: {readyState: 'complete', documentElement: {}, querySelectorAll: () => []},
  XMLHttpRequest: class {
    open() {} overrideMimeType() {}
    send() { this.status = 200; this.responseText = JSON.stringify(dict); }
  }
};
sandbox.window = sandbox;
vm.runInNewContext(src, sandbox);
console.log(JSON.stringify({
  start: sandbox.SH.t('Start'),
  open: sandbox.SH.t('Open'),
  optimizerOpen: sandbox.SH.tc('optimizer', 'Open'),
  restore: sandbox.SH.t('Restore'),
  installed: sandbox.SH.t('Installed'),
  export: sandbox.SH.t('Export'),
  import: sandbox.SH.t('Import'),
  devices: [1, 2, 5].map(n => sandbox.SH.t('{n} device', {n}))
}));
"""
        out = subprocess.check_output(["node", "-e", script], text=True, encoding="utf-8")
        self.assertEqual(json.loads(out), {
            "start": "Начать", "open": "Открыть", "optimizerOpen": "Открыто", "restore": "Восстановить",
            "installed": "Установлено", "export": "Экспортировать", "import": "Импортировать",
            "devices": ["1 устройство", "2 устройства", "5 устройств"]})


class RussianPlurals(unittest.TestCase):
    def test_python_translation_selects_one_few_and_many(self):
        from stellarhub import i18n
        saved = (i18n._lang, i18n._dict)
        try:
            i18n._lang = "ru"
            i18n._dict = {"{n} files": "{n} файл|{n} файла|{n} файлов"}
            for n, want in ((1, "1 файл"), (2, "2 файла"), (5, "5 файлов"),
                            (11, "11 файлов"), (21, "21 файл"), (22, "22 файла"), (25, "25 файлов")):
                self.assertEqual(i18n.tr("{n} files", n=n), want)
        finally:
            i18n._lang, i18n._dict = saved

    @unittest.skipUnless(shutil.which("node"), "needs Node.js")
    def test_javascript_units_follow_the_dictionary(self):
        script = r"""
const fs = require('fs'), vm = require('vm');
const dict = {'unit|GB': 'ГБ', 'unit|GHz': 'ГГц', 'unit|Mb/s': 'Мбит/с', 'unit|kHz': 'кГц', 'unit|unknown': 'неизвестно'};
const sandbox = {
  navigator: {languages: ['ru-RU']},
  localStorage: {getItem: () => 'ru'},
  document: {readyState: 'complete', documentElement: {}, querySelectorAll: () => []},
  XMLHttpRequest: class {
    open() {} overrideMimeType() {}
    send() { this.status = 200; this.responseText = JSON.stringify(dict); }
  }
};
sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync('stellarhub/ui/js/i18n.js', 'utf8'), sandbox);
console.log(JSON.stringify([
  sandbox.SH.unit('GB'),
  sandbox.SH.unit('unknown'),
  sandbox.SH.localizeUnits('5.2 GHz · 16 GB · 120 Mb/s · 20 kHz')
]));
"""
        out = subprocess.check_output(["node", "-e", script], text=True, encoding="utf-8")
        self.assertEqual(json.loads(out), ["ГБ", "неизвестно", "5.2 ГГц · 16 ГБ · 120 Мбит/с · 20 кГц"])

    @unittest.skipUnless(shutil.which("node"), "needs Node.js")
    def test_javascript_updater_schedule_hours_follow_the_dictionary(self):
        script = r"""
const fs = require('fs'), vm = require('vm');
const dict = {'unit|h': 'ч'};
const sandbox = {
  navigator: {languages: ['ru-RU']},
  localStorage: {getItem: () => 'ru'},
  document: {readyState: 'complete', documentElement: {}, querySelectorAll: () => []},
  XMLHttpRequest: class {
    open() {} overrideMimeType() {}
    send() { this.status = 200; this.responseText = JSON.stringify(dict); }
  }
};
sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync('stellarhub/ui/js/i18n.js', 'utf8'), sandbox);
sandbox.U = sandbox.SH.unit;
const src = fs.readFileSync('stellarhub/ui/js/modules/updater.js', 'utf8');
const template = src.match(/\[0, 6, 12, 18, 24\]\.map\(h => `([^`]+)`\)/)[1];
const html = vm.runInNewContext(`[0, 6, 12, 18, 24].map(h => \`${template}\`).join('')`, sandbox);
console.log(JSON.stringify([...html.matchAll(/<i[^>]*>(.*?)<\/i>/g)].map(m => m[1])));
"""
        out = subprocess.check_output(["node", "-e", script], text=True, encoding="utf-8")
        self.assertEqual(json.loads(out), ["00 ч", "06 ч", "12 ч", "18 ч", "24 ч"])

    @unittest.skipUnless(shutil.which("node"), "needs Node.js")
    def test_javascript_russian_language_picker_renders(self):
        script = r"""
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('stellarhub/ui/js/shell.js', 'utf8');
const flags = src.match(/const FLAGS = (\{[\s\S]*?\n\});/)[1];
const flag = src.match(/(const flag = code => [^\n]+;)/)[1];
const sandbox = {ic: () => ''};
const html = vm.runInNewContext(`const FLAGS = ${flags};\n${flag}\nflag('ru')`, sandbox);
console.log(JSON.stringify(html));
"""
        out = subprocess.check_output(["node", "-e", script], text=True, encoding="utf-8")
        self.assertIn('<svg viewBox="0 0 30 20"', json.loads(out))

    @unittest.skipUnless(shutil.which("node"), "needs Node.js")
    def test_javascript_self_update_demo_formats_sizes(self):
        script = r"""
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('stellarhub/ui/js/selfupdate.js', 'utf8');
const template = src.match(/got: `([^`]+)`/)[1];
const sandbox = {SH: {fmt1: n => String(n).replace('.', ',')}, U: u => ({MB: 'МБ'})[u]};
console.log(JSON.stringify(vm.runInNewContext(`\`${template}\``, sandbox)));
"""
        out = subprocess.check_output(["node", "-e", script], text=True, encoding="utf-8")
        self.assertEqual(json.loads(out), "8,2 МБ")

    @unittest.skipUnless(shutil.which("node"), "needs Node.js")
    def test_javascript_translation_selects_one_few_and_many(self):
        script = r"""
const fs = require('fs'), vm = require('vm');
const dict = {'{n} files': '{n} файл|{n} файла|{n} файлов'};
const sandbox = {
  navigator: {languages: ['ru-RU']},
  localStorage: {getItem: () => 'ru'},
  document: {readyState: 'complete', documentElement: {}, querySelectorAll: () => []},
  XMLHttpRequest: class {
    open() {} overrideMimeType() {}
    send() { this.status = 200; this.responseText = JSON.stringify(dict); }
  }
};
sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync('stellarhub/ui/js/i18n.js', 'utf8'), sandbox);
console.log(JSON.stringify([1, 2, 5, 11, 21, 22, 25].map(n => sandbox.SH.t('{n} files', {n}))));
"""
        out = subprocess.check_output(["node", "-e", script], text=True, encoding="utf-8")
        self.assertEqual(json.loads(out), ["1 файл", "2 файла", "5 файлов", "11 файлов",
                                           "21 файл", "22 файла", "25 файлов"])


if __name__ == "__main__":
    unittest.main()
