"""App Hangar: catalog integrity, installed matching, winget search parsing, icons, kits, history and the install queue.
They never install anything: the queue runs on a fake winget (hangar.RUNNER) or on the built-in dry run."""
import io
import json
import os
import re
import shutil
import tempfile
import unittest

from stellarhub.engine import hangar as h
from stellarhub.i18n import CODES, tr

UI = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "stellarhub", "ui")


class FakeJob:
    def __init__(self, cancel_after=None):
        self.cancelled = False
        self.data = {}
        self.logs = []
        self.events = []
        self._cancel_after = cancel_after

    def progress(self, pct=None, text=None, force=False, **data):
        self.data.update(data)
        self.events.append((pct, text))

    def log(self, line):
        self.logs.append(line)
        if self._cancel_after and self._cancel_after in line:
            self.cancelled = True

    def check(self):
        pass


class TempData(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="hangar_test_")
        self._env = {k: os.environ.get(k) for k in ("STELLARHUB_HANGAR_DATA", "STELLARHUB_HANGAR_DRYRUN")}
        os.environ["STELLARHUB_HANGAR_DATA"] = self.dir
        os.environ.pop("STELLARHUB_HANGAR_DRYRUN", None)
        h.RUNNER = None

    def tearDown(self):
        h.RUNNER = None
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.dir, ignore_errors=True)


class Catalog(unittest.TestCase):
    """The curated catalog lives in hangar.js: every id must be a valid winget id, unique, and the kits only use it."""
    @classmethod
    def setUpClass(cls):
        with open(os.path.join(UI, "js", "modules", "hangar.js"), encoding="utf-8") as fh:
            cls.js = fh.read()
        cls.ids = re.findall(r"^\s*A\('([^']+)', '", cls.js, re.M)

    def test_size_and_ids(self):
        self.assertGreaterEqual(len(self.ids), 120)
        self.assertEqual(len(self.ids), len(set(i.lower() for i in self.ids)), "duplicate ids")
        for i in self.ids:
            self.assertRegex(i, h.ID_RE)

    def test_kits_only_use_catalog_apps(self):
        block = self.js[self.js.index("const KITS"):self.js.index("/* ---------------- sample data")]
        for apps in re.findall(r"apps: \[([^\]]+)\]", block):
            for i in re.findall(r"'([^']+)'", apps):
                self.assertIn(i, self.ids, f"kit app {i} is not in the catalog")

    def test_every_category_is_known(self):
        cats = set(re.findall(r"^\s*A\('[^']+', '[^']*', '[^']*', '(\w+)'", self.js, re.M))
        self.assertEqual(cats, {"browsers", "communication", "media", "creative", "gaming", "dev", "productivity",
                                "utilities", "security", "runtimes"})


class Installed(unittest.TestCase):
    ROWS = [{"name": "Google Chrome", "id": "Google.Chrome"}, {"name": "7-Zip 24.08 (x64)", "id": "ARP\\Machine\\X64\\7-Zip"},
            {"name": "Python 3.12.4 (64-bit)", "id": "Python.Python.3.12"}, {"name": "Steam", "id": "ARP\\Machine\\X86\\Steam"}]

    def test_by_id_and_by_name(self):
        items = [["Google.Chrome", "Google Chrome"], ["7zip.7zip", "7-Zip"], ["Valve.Steam", "Steam"], ["Mozilla.Firefox", "Firefox"]]
        self.assertEqual(h.match_installed(items, self.ROWS), ["Google.Chrome", "7zip.7zip", "Valve.Steam"])

    def test_versioned_names_need_the_id(self):
        # "Python 3.13" must not match an installed Python 3.12
        self.assertEqual(h.match_installed([["Python.Python.3.13", "Python 3.13"]], self.ROWS), [])
        self.assertEqual(h.match_installed([["Python.Python.3.12", "Python 3.12"]], self.ROWS), ["Python.Python.3.12"])


class Search(unittest.TestCase):
    EN = ("Name               Id                       Version   Match            Source\n"
          "-------------------------------------------------------------------------------\n"
          "Notepad++          Notepad++.Notepad++      8.8.8     Moniker: notepad winget\n"
          "Notepads App       9NHL4NSC67WM             Unknown                    msstore\n"
          "AkelPad            AkelPad.AkelPad          4.9.9     Tag: notepad     winget\n")
    ES = ("Nombre             Id                       Versión   Coincidencia     Origen\n"
          "-------------------------------------------------------------------------------\n"
          "Notepad++          Notepad++.Notepad++      8.8.8     Moniker: notepad winget\n")
    FR = ("Nom                Id                       Version   Correspondance\n"
          "------------------------------------------------------------------\n"
          "Notepad++          Notepad++.Notepad++      8.8.8     Moniker: notepad\n")

    def test_english_with_sources(self):
        rows = h.search_rows(self.EN)
        self.assertEqual([r["id"] for r in rows], ["Notepad++.Notepad++", "9NHL4NSC67WM", "AkelPad.AkelPad"])
        self.assertEqual(rows[1]["source"], "msstore")
        self.assertEqual(rows[1]["version"], "")
        self.assertEqual(rows[0]["version"], "8.8.8")

    def test_other_languages_by_position(self):
        self.assertEqual(h.search_rows(self.ES)[0]["id"], "Notepad++.Notepad++")
        fr = h.search_rows(self.FR)
        self.assertEqual((fr[0]["id"], fr[0]["source"]), ("Notepad++.Notepad++", "winget"))


class Icons(TempData):
    def _png(self, color, size=(80, 40), margin=20):
        from PIL import Image
        im = Image.new("RGBA", (size[0] + 2 * margin, size[1] + 2 * margin), (0, 0, 0, 0))
        im.paste(Image.new("RGBA", size, color), (margin, margin))
        buf = io.BytesIO()
        im.save(buf, "PNG")
        return buf.getvalue()

    def test_normalized_square_trimmed(self):
        from PIL import Image
        out = Image.open(io.BytesIO(h.normalize_icon(self._png((255, 120, 100, 255)))))
        self.assertEqual(out.size, (64, 64))
        # trimmed and centred: the wide mark now spans the full width, transparent above and below
        self.assertGreater(out.getpixel((2, 32))[3], 200)
        self.assertEqual(out.getpixel((32, 2))[3], 0)

    def test_dark_logo_gets_a_light_plate(self):
        from PIL import Image
        out = Image.open(io.BytesIO(h.normalize_icon(self._png((10, 10, 10, 255), (40, 40)))))
        r, g, b, a = out.getpixel((5, 32))
        self.assertGreater(r + g + b, 600)
        self.assertEqual(a, 255)

    def test_empty_image_is_not_an_icon(self):
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGBA", (48, 48), (0, 0, 0, 0)).save(buf, "PNG")
        self.assertIsNone(h.normalize_icon(buf.getvalue()))

    def test_cache_roundtrip(self):
        h._save_png("Foo.Bar", h.normalize_icon(self._png((100, 200, 255, 255))))
        got = h.icons_cached(["Foo.Bar", "Nope.Nope", "../evil"])
        self.assertEqual(list(got), ["Foo.Bar"])
        self.assertTrue(got["Foo.Bar"].startswith("data:image/png;base64,"))

    def test_wikimedia_sizes_and_unigetui_keys(self):
        self.assertIn("/250px-Blender.svg.png", h._wiki_size("https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Blender.svg/293px-Blender.svg.png"))
        self.assertEqual(h.udb_keys("Microsoft.VCRedist.2015+.x64")[0], "vcredist-2015+-x64")
        self.assertEqual(h.udb_keys("Mozilla.Firefox")[0], "firefox")


class Kits(TempData):
    def test_clean_kit(self):
        k = h.clean_kit({"name": "  My   PC ", "apps": ["7zip.7zip", {"id": "9NKSQGP7F2NH", "name": "WhatsApp"}, "7ZIP.7zip",
                                                        "-rf", "bad id", {"id": "Valve.Steam", "source": "evil"}]})
        self.assertEqual(k["name"], "My PC")
        self.assertEqual([a["id"] for a in k["apps"]], ["7zip.7zip", "9NKSQGP7F2NH", "Valve.Steam"])
        self.assertEqual([a["source"] for a in k["apps"]], ["winget", "msstore", "winget"])
        self.assertIsNone(h.clean_kit({"apps": ["--force"]}))
        self.assertIsNone(h.clean_kit("nope"))


class Queue(TempData):
    def fake(self, script):
        """script: {id: [(code, lines)...]} consumed per call; records the commands."""
        calls = []

        def run(cmd, on_text=None, job=None, timeout=None):
            calls.append(cmd)
            wid = cmd[cmd.index("--id") + 1]
            code, lines = script[wid].pop(0)
            for ln in lines:
                on_text(ln)
            return code, "\n".join(lines)
        h.RUNNER = run
        return calls

    def test_command_is_silent_exact_and_scoped(self):
        cmd = h.install_command({"id": "7zip.7zip"}, {"scope": "machine", "skipInstalled": True})
        for flag in ("install", "--exact", "--silent", "--accept-package-agreements", "--accept-source-agreements",
                     "--disable-interactivity", "--no-upgrade"):
            self.assertIn(flag, cmd)
        self.assertEqual(cmd[cmd.index("--scope") + 1], "machine")
        self.assertEqual(cmd[cmd.index("--source") + 1], "winget")
        store = h.install_command({"id": "9NKSQGP7F2NH"}, {"scope": "machine"})
        self.assertNotIn("--scope", store)  # Store apps are per user
        self.assertEqual(store[store.index("--source") + 1], "msstore")

    def test_progress_results_and_history(self):
        calls = self.fake({
            "Good.App": [(0, ["Found Good [Good.App]", "  ██▒▒  2.0 MB / 8.0 MB", "  ████  8.0 MB / 8.0 MB",
                               "Starting package install...", "Successfully installed"])],
            "Busy.App": [(0x8A150101, ["Installer failed"])],
            "Have.App": [(0x8A150061, ["Found an existing package already installed."])],
            "Scope.App": [(0x8A150010, ["No applicable installer found"]), (0, ["Successfully installed"])],
        })
        job = FakeJob()
        r = h.install(job, [{"id": "Good.App", "name": "Good"}, {"id": "Busy.App", "name": "Busy"},
                            {"id": "Have.App", "name": "Have"}, {"id": "Scope.App", "name": "Scope"}, {"id": "bad id"}],
                      {"scope": "user", "skipInstalled": True, "run": "r1"})
        st = [s["st"] for s in r["items"]]
        self.assertEqual(st, ["done", "fail", "skip", "done"])  # the invalid id never reaches winget
        self.assertEqual(r["items"][0]["mb"], 8.0)
        self.assertEqual(r["items"][1]["msg"], tr("The program is open: close it and try again."))
        self.assertEqual(r["items"][3]["msg"], tr("This app only installs for all users."))
        scope_calls = [c for c in calls if "Scope.App" in c]
        self.assertIn("--scope", scope_calls[0])
        self.assertNotIn("--scope", scope_calls[1])  # retried with the package's own scope
        run = h.history()[0]
        self.assertEqual(run["run"], "r1")
        self.assertEqual(run["scope"], "user")
        self.assertEqual([x["st"] for x in run["items"]], ["done", "fail", "skip", "done"])

    def test_cancel_stops_the_queue(self):
        def run(cmd, on_text=None, job=None, timeout=None):
            job.cancelled = True
            return None, ""
        h.RUNNER = run
        r = h.install(FakeJob(), [{"id": "A.A"}, {"id": "B.B"}], {})
        self.assertEqual([s["st"] for s in r["items"]], ["cancel", "cancel"])
        self.assertEqual(h.history(), [])

    def test_dry_run_installs_nothing_and_says_so(self):
        os.environ["STELLARHUB_HANGAR_DRYRUN"] = "1"
        os.environ["STELLARHUB_HANGAR_DRYRUN_SPEED"] = "50"
        try:
            self.assertIs(h._runner({}), h._fake_winget)
            job = FakeJob()
            r = h.install(job, [{"id": "Mozilla.Firefox", "name": "Firefox"}], {"run": "d1"})
            self.assertEqual(r["items"][0]["st"], "done")
            self.assertTrue(r["dry"])
            self.assertTrue(any("example.invalid" in ln for ln in job.logs))
            self.assertTrue(h.history()[0]["dry"])
        finally:
            os.environ.pop("STELLARHUB_HANGAR_DRYRUN_SPEED", None)

    def test_history_clear_and_restore(self):
        h._history_add("x", {"id": "A.A", "name": "A", "st": "done", "msg": None, "at": 1.0}, {"scope": "", "dry": True})
        old = h.history_clear()
        self.assertEqual(h.history(), [])
        self.assertTrue(h.history_restore(old))
        self.assertEqual(h.history()[0]["items"][0]["id"], "A.A")


class Translations(unittest.TestCase):
    def test_every_language_has_the_catalog_descriptions(self):
        with open(os.path.join(UI, "js", "modules", "hangar.js"), encoding="utf-8") as fh:
            js = fh.read()
        descs = re.findall(r"""^\s*A\('[^']+', '[^']*', '[^']*', '\w+', t\((?:'([^']*)'|"([^"]*)")\)""", js, re.M)
        descs = [a or b for a, b in descs]
        self.assertGreaterEqual(len(descs), 120)
        for lang in (code for code in CODES if code != "en"):
            with open(os.path.join(UI, "i18n", lang, "hangar.json"), encoding="utf-8") as fh:
                d = json.load(fh)
            missing = [x for x in descs if x not in d]
            self.assertEqual(missing, [], lang)


if __name__ == "__main__":
    unittest.main()
