"""Controller navigation (ui/js/gamepad.js): every label of its hint bar is translated, and the compact layout and the
Interface size rules are loaded before the shell uses them."""
import json
import re
import unittest
from pathlib import Path

from stellarhub.i18n import CODES

UI = Path(__file__).resolve().parent.parent / "stellarhub" / "ui"
LANGS = [code for code in CODES if code != "en"]


def dictionary(lang):
    d = {}
    for f in sorted((UI / "i18n" / lang).glob("*.json")):
        d.update(json.loads(f.read_text(encoding="utf-8")))
    return d


class HintBar(unittest.TestCase):
    def test_every_label_is_translated(self):
        src = (UI / "js" / "gamepad.js").read_text(encoding="utf-8")
        keys = set(re.findall(r"\bt\('((?:[^'\\]|\\.)+)'\)", src))
        self.assertIn("Enter", keys)
        self.assertIn("Leave", keys)
        for lang in LANGS:
            d = dictionary(lang)
            missing = sorted(k for k in keys if not d.get(k))
            self.assertEqual(missing, [], f"{lang}: untranslated controller labels")


class LoadOrder(unittest.TestCase):
    def test_zoom_rules_before_the_shell(self):
        html = (UI / "index.html").read_text(encoding="utf-8")
        scripts = re.findall(r'<script src="([^"]+)"', html)
        self.assertLess(scripts.index("js/core.js"), scripts.index("js/zoom.js"))
        self.assertLess(scripts.index("js/zoom.js"), scripts.index("js/shell.js"))

    def test_compact_layout_keeps_the_dock_clear(self):
        css = (UI / "css" / "base.css").read_text(encoding="utf-8")
        self.assertIn("html[data-layout=scroll] .view::after{content:\"\";display:block;height:var(--dockspace)}", css)
        self.assertRegex(css, r"html\[data-layout=scroll\] \.view\{[^}]*overflow-y:auto")


if __name__ == "__main__":
    unittest.main()
