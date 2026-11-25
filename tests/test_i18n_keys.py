"""Every sentence the interface translates exists in every language, and translations keep the key's {placeholders}
and inline tags: SH.t('…') / SH.tc('ctx', '…') and the files' own aliases of them (t, T, _t, tr, tc, _tc) called
with a literal string, plus the static HTML's data-t / data-t-attr text. Keys built at run time (t(x.label)) are
not seen here; a missing entry would only show in English, never break anything, but it is still a bug."""
import glob
import json
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI = os.path.join(ROOT, "stellarhub", "ui")
LANGS = ["es", "pt", "it", "fr", "zh", "ja", "ru"]
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
                if v and (PH(key) != PH(v) or TAGS(key) != TAGS(v)):
                    bad.append(k)
            self.assertEqual(bad, [], lang)


if __name__ == "__main__":
    unittest.main()
