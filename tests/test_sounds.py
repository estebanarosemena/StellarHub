"""Interface sounds: the files and their credits, the settings the sanitizer accepts, the WebView2 switch that lets the
start sound play, the exit sound's wait, and the translations of the Sound settings."""
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

os.environ["STELLARHUB_NO_DIALOGS"] = "1"
os.environ["STELLARHUB_NO_SPLASH"] = "1"

from stellarhub import config, settings, startup  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI = os.path.join(ROOT, "stellarhub", "ui")
SOUNDS = os.path.join(UI, "sounds")


def read(*p):
    with open(os.path.join(UI, *p), encoding="utf-8") as fh:
        return fh.read()


def sound_table():
    """SOUND_EV (core.js): {event: {c, g, gap, tier, user?, f?, cut?}}."""
    block = re.search(r"const SOUND_EV = \{(.*?)\n\};", read("js", "core.js"), re.S).group(1)
    out = {}
    for ev, body in re.findall(r"(\w+): \{ (c: '[^}]*)\}", block):
        d = {}
        for k, v in re.findall(r"(\w+): ('[^']*'|[\d.]+)", body):
            d[k] = v.strip("'") if v.startswith("'") else float(v)
        out[ev] = d
    return out


def sound_events():
    """The event names in SOUND_EV (core.js)."""
    return list(sound_table())


def swooshes():
    """SWOOSH (core.js): [(file, trim)], the swooshes that follow navigate's click."""
    block = re.search(r"const SWOOSH = \{.*?files: \[(.*?)\] \};", read("js", "core.js"), re.S).group(1)
    return [(f, float(g)) for f, g in re.findall(r"\['(\w+)', ([\d.]+)\]", block)]


def event_file(ev):
    return sound_table()[ev].get("f", ev)


def loop_info():
    """LOOP (core.js): (file, trim) of the loading loop."""
    m = re.search(r"const LOOP = \{ file: '(\w+)', g: ([\d.]+)", read("js", "core.js"))
    return m.group(1), float(m.group(2))


def event_files(ev, d):
    """the files an event plays: its own; percent_step_0..8 for one with steps; count_tick_1..4 for one with variants"""
    if "steps" in d:
        return [f"{ev}_{i}" for i in range(int(d["steps"]))]
    return [f"{ev}_{i}" for i in range(1, int(d["n"]) + 1)] if "n" in d else [d.get("f", ev)]


class SoundFiles(unittest.TestCase):
    def test_every_event_has_its_file_and_credit(self):
        table = sound_table()
        self.assertEqual(len(table), 40)
        files = {f[:-4] for f in os.listdir(SOUNDS) if f.endswith(".ogg")}
        sw = [f for f, _ in swooshes()]
        self.assertEqual(sw, [f"navigate_swoosh_{i}" for i in range(1, 8)])
        self.assertEqual(table["navigate"]["f"], "navigate_click")
        self.assertEqual(loop_info()[0], "loading")                                       # the loop is no event
        self.assertNotIn("loading", table)
        self.assertEqual(event_files("count_tick", table["count_tick"]), [f"count_tick_{i}" for i in range(1, 5)])
        self.assertEqual(event_files("percent_step", table["percent_step"]), [f"percent_step_{i}" for i in range(9)])
        want = {f for ev, d in table.items() for f in event_files(ev, d)}
        self.assertEqual(want | set(sw) | {"loading"}, files)                            # no file is left over
        self.assertNotIn("navigate", files)                                              # the old one is gone
        with open(os.path.join(SOUNDS, "CREDITS.json"), encoding="utf-8") as fh:
            credits = json.load(fh)
        self.assertEqual(len(credits), len(files))
        loading = next(c for c in credits if c["event"] == "loading")
        self.assertEqual((loading["license"], loading["sourceUrl"]), ("CC0-1.0", ""))
        self.assertIn("Orbital", loading["family"])
        self.assertEqual({c["event"] for c in credits}, files)
        for c in credits:
            self.assertIn(c["license"], ("CC0-1.0", "CC-BY-4.0"), c["event"])
            if c["license"] != "CC0-1.0":  # attribution licences carry their credit, shown in About and the README
                self.assertTrue(c["attribution"] and c["sourceUrl"], c["event"])
        # the primary hover is an Orbital original; unfa's "UI hover" is the base of the secondary one
        hover = next(c for c in credits if c["event"] == "hover")
        self.assertEqual((hover["license"], hover["sourceUrl"]), ("CC0-1.0", ""))
        self.assertIn("Orbital", hover["family"])
        soft = next(c for c in credits if c["event"] == "hover_soft")
        self.assertIn("freesound.org/people/unfa/sounds/565131", soft["sourceUrl"])
        self.assertEqual(soft["license"], "CC0-1.0")
        self.assertNotIn("f", table["hover_soft"])                                       # its own file

    def test_attribution_credits_are_shown(self):
        with open(os.path.join(SOUNDS, "CREDITS.json"), encoding="utf-8") as fh:
            credits = [c for c in json.load(fh) if c["license"] == "CC-BY-4.0"]
        self.assertTrue(credits)
        shell = read("js", "shell.js")
        with open(os.path.join(ROOT, "README.md"), encoding="utf-8") as fh:
            readme = fh.read()
        for c in credits:
            self.assertIn(c["author"], shell, c["event"])
            self.assertIn(c["sourceUrl"], shell, c["event"])
            self.assertIn(c["author"], readme, c["event"])
            self.assertIn(c["sourceUrl"], readme, c["event"])
            self.assertIn("CC BY 4.0", readme)

    def test_typing_and_map_ticks(self):
        t = sound_table()
        for ev in ("key_type", "map_hover"):
            self.assertEqual(t[ev]["c"], "ui", ev)             # Interface group (soundUi)
            self.assertEqual(t[ev]["tier"], 0, ev)             # never cuts or blocks another sound
        self.assertEqual(t["key_type"]["gap"], 30)
        self.assertEqual(t["key_type"]["user"], 1)
        self.assertEqual(t["map_hover"]["gap"], 35)
        self.assertNotIn("user", t["map_hover"])               # a hover, like hover itself

    def test_counters_and_percent_steps_are_quiet_task_sounds(self):
        """count_tick and percent_step: Tasks group (Settings > Sound), never cut anything, need no gesture (the work
        moves them, not a click); count_tick at most ~12 a second, in 4 variants; percent_step in 9 pitches, ~85 ms
        apart. The switches stay Interface sounds."""
        t = sound_table()
        for ev in ("count_tick", "percent_step"):
            self.assertEqual((t[ev]["c"], t[ev]["tier"]), ("tasks", 0), ev)
            self.assertNotIn("user", t[ev])
        self.assertGreaterEqual(t["count_tick"]["gap"], 83)
        self.assertEqual(t["count_tick"]["n"], 4)
        self.assertEqual((t["percent_step"]["steps"], t["percent_step"]["gap"]), (9, 85))
        # the Benchmark score: the step goes with the paint of the number (rollNumber), never on its own
        bench = read("js", "modules", "benchmark.js")
        self.assertIn("SH.rollNumber(sc, fmtInt(p * 100) + '%', { percent: p * 100 })", bench)
        self.assertNotIn("SH.sound.percent", bench)
        self.assertNotIn("percent:", re.search(r"Object\.assign\(sound, \{(.*?)\n\}\);", read("js", "core.js"), re.S).group(1))
        for ev in ("toggle_on", "toggle_off"):
            self.assertEqual(t[ev]["c"], "ui")

    def test_hover_soft_is_a_quiet_interface_tick(self):
        """The secondary elements' hover: Interface group, never cuts anything, needs no gesture (it is a hover) and
        comes at most every 90 ms."""
        t = sound_table()
        self.assertEqual((t["hover_soft"]["c"], t["hover_soft"]["tier"], t["hover_soft"]["gap"]), ("ui", 0, 90))
        self.assertNotIn("user", t["hover_soft"])
        self.assertGreater(t["hover_soft"]["gap"], t["hover"]["gap"])
        self.assertIn("'hover_soft'", read("js", "sounds.js"))                          # preloaded with the common ones

    def test_scan_complete_fits_its_short_file(self):
        """The tick-up (247 ms) may come again after 300 ms; the old 645 ms chord needed 700."""
        t = sound_table()["scan_complete"]
        self.assertEqual(t["gap"], 300)
        self.assertEqual((t["c"], t["tier"]), ("tasks", 2))

    def test_gain_trims_follow_the_loudest_100_ms(self):
        """Played level = the file's loudest 100 ms + its trim: the typing tick sits between the quiet sounds and the
        interface, the map tick under hover, and the replaced files where their family is."""
        try:
            import numpy as np
            import soundfile as sf
        except ImportError:
            self.skipTest("needs numpy and soundfile")
        import math
        t = sound_table()

        def level(ev):
            return raw(event_file(ev)) + 20 * math.log10(t[ev]["g"])

        def raw(name):
            x, sr = sf.read(os.path.join(SOUNDS, name + ".ogg"), always_2d=True)
            m = x.mean(axis=1)
            w = int(sr * 0.1)
            if len(m) < w:
                e = float(np.sum(m ** 2)) / w
            else:
                c = np.cumsum(np.concatenate([[0.0], m ** 2]))
                e = float(np.max(c[w:] - c[:-w])) / w
            return 10 * math.log10(max(e, 1e-18))

        self.assertLess(level("map_hover"), level("hover"))
        # the secondary hover sits clearly under the primary one (about 8 dB)
        self.assertAlmostEqual(level("hover") - level("hover_soft"), 8, delta=1.2)
        self.assertAlmostEqual(level("hover"), -45.1, delta=1)                          # where the old hover was
        self.assertGreater(level("key_type"), level("hover"))
        self.assertLess(level("key_type"), level("click") - 6)
        for ev in ("navigate", "tab_switch"):
            self.assertAlmostEqual(level(ev), -29, delta=2.5, msg=ev)           # the interface
        for ev in ("scan_complete", "success", "error"):
            self.assertAlmostEqual(level(ev), -24.5, delta=1.5, msg=ev)         # the notifications
        self.assertAlmostEqual(level("toast"), -26.5, delta=1.5)                # a plain toast: a little under those
        self.assertAlmostEqual(level("scan_start"), -25.5, delta=1.5)
        # navigate's swooshes: all about as loud as each other, well under the click they follow
        for f, g in swooshes():
            lv = raw(f) + 20 * math.log10(g)
            self.assertAlmostEqual(lv, -36, delta=1, msg=f)
            self.assertLess(lv, level("navigate") - 5, f)
        # the loading loop: a background, under the swooshes and well over hover
        f, g = loop_info()
        lv = raw(f) + 20 * math.log10(g)
        self.assertAlmostEqual(lv, -38.4, delta=1)
        self.assertGreater(lv, level("hover") + 5)
        # the counter's blips: between the secondary hover and hover (they come up to 12 a second)
        g = t["count_tick"]["g"]
        for i in range(1, 5):
            lv = raw(f"count_tick_{i}") + 20 * math.log10(g)
            self.assertAlmostEqual(lv, -50.5, delta=1, msg=i)
            self.assertLess(lv, level("hover") - 4)
            self.assertGreater(lv, level("hover_soft") + 1)
        # the percent plucks: about the progress ticks' level, a little over at the bottom of the scale
        g = t["percent_step"]["g"]
        for i in range(9):
            lv = raw(f"percent_step_{i}") + 20 * math.log10(g)
            self.assertAlmostEqual(lv, -43.6, delta=2, msg=i)

    def test_the_loading_loop_is_one_seamless_cycle(self):
        """loading.ogg is exactly one 2.1 s cycle whose end runs into its start (loop = true, no click at the seam)."""
        try:
            import numpy as np
            import soundfile as sf
        except ImportError:
            self.skipTest("needs numpy and soundfile")
        x, sr = sf.read(os.path.join(SOUNDS, "loading.ogg"), always_2d=True)
        self.assertAlmostEqual(len(x) / sr, 2.1, delta=0.01)
        self.assertLess(float(np.max(np.abs(x[-64:]))), 0.01)      # quiet at the seam
        self.assertLess(float(np.max(np.abs(x[:64]))), 0.01)

    def test_files_are_ogg_vorbis(self):
        for f in os.listdir(SOUNDS):
            if f.endswith(".ogg"):
                with open(os.path.join(SOUNDS, f), "rb") as fh:
                    head = fh.read(64)
                self.assertTrue(head.startswith(b"OggS") and b"vorbis" in head, f)

    def test_sounds_js_loads_right_after_core(self):
        html = read("index.html")
        scripts = re.findall(r'<script src="js/([\w/.-]+)"></script>', html)
        self.assertEqual(scripts[scripts.index("core.js") + 1], "sounds.js")

    def test_the_sound_section_follows_animation(self):
        m = re.search(r"const SECTIONS = \[(.*?)\];", read("js", "shell.js"))
        ids = re.findall(r"\['(\w+)', SH\.t", m.group(1))
        self.assertEqual(ids[ids.index("motion") + 1], "sound")
        self.assertNotIn("A soft sound when long tasks finish.", read("js", "shell.js"))

    def test_the_build_ships_the_sounds_and_the_cache_notices_them(self):
        with open(os.path.join(ROOT, "packaging", "StellarHub.spec"), encoding="utf-8") as fh:
            spec = fh.read()
        self.assertIn('(os.path.join(ROOT, "stellarhub", "ui"), os.path.join("stellarhub", "ui"))', spec)
        ui = tempfile.mkdtemp()
        web = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, ui, True)
        self.addCleanup(shutil.rmtree, web, True)
        os.makedirs(os.path.join(ui, "sounds"))
        ogg = os.path.join(ui, "sounds", "click.ogg")
        with open(ogg, "wb") as fh:
            fh.write(b"OggS one")
        stamp = os.path.join(web, "ui.version")
        with mock.patch.object(config, "UI_DIR", ui), mock.patch.object(config, "WEB_DIR", web), \
                mock.patch.object(config, "FROZEN", False), mock.patch("stellarhub.i18n.build_bundles"):
            startup.refresh_ui_cache()
            with open(stamp, encoding="utf-8") as fh:
                first = fh.read()
            with open(ogg, "wb") as fh:
                fh.write(b"OggS two")
            startup.refresh_ui_cache()
            with open(stamp, encoding="utf-8") as fh:
                self.assertNotEqual(fh.read(), first)


class BrowserArgs(unittest.TestCase):
    AUTOPLAY = "--autoplay-policy=no-user-gesture-required"

    def test_added_to_nothing(self):
        out = startup.merge_browser_args("")
        self.assertIn(self.AUTOPLAY, out.split())
        self.assertIn("--disable-features=ElasticOverscroll", out.split())

    def test_a_test_copys_debugging_port_is_kept(self):
        out = startup.merge_browser_args("--remote-debugging-port=9333").split()
        self.assertEqual(out[0], "--remote-debugging-port=9333")
        self.assertIn(self.AUTOPLAY, out)

    def test_merging_twice_changes_nothing(self):
        once = startup.merge_browser_args("--remote-debugging-port=9333")
        self.assertEqual(startup.merge_browser_args(once), once)

    def test_an_existing_value_wins_and_feature_lists_are_joined(self):
        out = startup.merge_browser_args("--autoplay-policy=user-gesture-required --disable-features=Foo").split()
        self.assertIn("--autoplay-policy=user-gesture-required", out)
        self.assertNotIn(self.AUTOPLAY, out)
        self.assertIn("--disable-features=Foo,ElasticOverscroll", out)

    def test_set_before_the_window_starts(self):
        with mock.patch.dict(os.environ, {startup.BROWSER_ARGS_ENV: "--remote-debugging-port=9444"}):
            startup.set_browser_args()
            val = os.environ[startup.BROWSER_ARGS_ENV].split()
            self.assertIn("--remote-debugging-port=9444", val)
            self.assertIn(self.AUTOPLAY, val)
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop(startup.BROWSER_ARGS_ENV, None)
            startup.set_browser_args()
            self.assertIn(self.AUTOPLAY, os.environ[startup.BROWSER_ARGS_ENV])

    def test_app_sets_them_before_webview_start(self):
        with open(os.path.join(ROOT, "stellarhub", "app.py"), encoding="utf-8") as fh:
            src = fh.read()
        self.assertLess(src.index("startup.set_browser_args()"), src.index("webview.start("))


class ExitSound(unittest.TestCase):
    def test_on_by_default(self):
        self.assertTrue(settings.plays_exit_sound({}))
        self.assertTrue(settings.plays_exit_sound(None))

    def test_off_with_any_switch_or_no_volume(self):
        self.assertFalse(settings.plays_exit_sound({"sounds": False}))
        self.assertFalse(settings.plays_exit_sound({"soundSystem": False}))
        self.assertFalse(settings.plays_exit_sound({"soundVolume": 0}))
        self.assertTrue(settings.plays_exit_sound({"soundUi": False, "soundVolume": "bad"}))

    def test_the_wait_stays_short(self):
        self.assertLessEqual(settings.EXIT_SOUND_WAIT, 0.75)


@unittest.skipUnless(shutil.which("node"), "needs Node.js")
class Sanitizer(unittest.TestCase):
    """sanitizeSettings from core.js, run in Node: the new keys keep their types and the volume its range."""

    @classmethod
    def setUpClass(cls):
        src = read("js", "core.js")
        defaults = re.search(r"const DEFAULTS = \{.*?\n\};", src, re.S).group(0)
        rest = re.search(r"const RANGE = .*?\nfunction sanitizeSettings\(saved\) \{.*?\n\}", src, re.S).group(0)
        cls.prelude = "const reduceMQ = { matches: false };\n" + defaults + "\n" + rest + "\n"

    def run_js(self, expr):
        code = self.prelude + f"process.stdout.write(JSON.stringify({expr}));"
        out = subprocess.run(["node", "-e", code], capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout)

    def test_defaults(self):
        d = self.run_js("DEFAULTS")
        self.assertIs(d["sounds"], True)
        self.assertEqual(d["soundVolume"], 0.4)
        for k in ("soundUi", "soundAlerts", "soundTasks", "soundSystem"):
            self.assertIs(d[k], True, k)

    def test_volume_is_clamped_and_typed(self):
        self.assertEqual(self.run_js("sanitizeSettings({ soundVolume: 4 })"), {"soundVolume": 1})
        self.assertEqual(self.run_js("sanitizeSettings({ soundVolume: -2 })"), {"soundVolume": 0})
        self.assertEqual(self.run_js("sanitizeSettings({ soundVolume: 0.35 })"), {"soundVolume": 0.35})
        self.assertEqual(self.run_js("sanitizeSettings({ soundVolume: '0.5' })"), {})

    def test_switches_must_be_booleans(self):
        out = self.run_js("sanitizeSettings({ sounds: false, soundUi: 'no', soundAlerts: 0, soundTasks: false, soundSystem: true })")
        self.assertEqual(out, {"sounds": False, "soundTasks": False, "soundSystem": True})

    def test_admin_asked_is_a_number_or_nothing(self):
        self.assertEqual(self.run_js("sanitizeSettings({ adminAsked: 1700000000000 })"), {"adminAsked": 1700000000000})
        self.assertEqual(self.run_js("sanitizeSettings({ adminAsked: 'soon' })"), {})


class Translations(unittest.TestCase):
    """Every sentence of Settings > Sound and the credits line is translated in every language."""
    KEYS = re.compile(r"SH\.t\('((?:[^'\\]|\\.)*)'\)|\bt\('((?:[^'\\]|\\.)*)'\)")

    def test_sound_section_strings(self):
        shell = read("js", "shell.js")
        sec = re.search(r"case 'sound': return `(.*?)`;", shell, re.S).group(1)
        keys = {a or b for a, b in self.KEYS.findall(sec)}
        about = re.search(r"case 'about': return `(.*?)`;", shell, re.S).group(1)
        keys |= {k for k in (a or b for a, b in self.KEYS.findall(about)) if "Orbital" in k or "JC Sounds" in k}
        keys |= {"Notification sound"}
        keys |= {"Sound", "Change the sound volume"}
        self.assertGreaterEqual(len(keys), 14)
        for lang in ("es", "pt", "it", "fr", "zh", "ja", "ru"):
            d = {}
            folder = os.path.join(UI, "i18n", lang)
            for f in os.listdir(folder):
                with open(os.path.join(folder, f), "rb") as fh:
                    raw = fh.read()
                self.assertFalse(raw.startswith(b"\xef\xbb\xbf"), f"{lang}/{f} has a BOM")
                d.update(json.loads(raw.decode("utf-8")))
            missing = sorted(k for k in keys if not d.get(k))
            self.assertEqual(missing, [], lang)


def sounds_list(name):
    """ROWS / ROW_ACTS (sounds.js): the selectors of that list."""
    m = re.search(r"const " + name + r" = \[(.*?)\]\.join", read("js", "sounds.js"), re.S)
    return re.findall(r"'([^']*)'", m.group(1))


def sounds_const(name):
    """HOVER / SOFT / CLICKABLE (sounds.js) as written (a ${ROWS} in it stays as it is)."""
    return re.search(r"const " + name + r" = ['`]([^'`]*)['`];", read("js", "sounds.js")).group(1)


def no_parens(sel, keep_attrs=False):
    """the selector without what is inside :not(), :has(), [..]: what the element itself must carry
    (keep_attrs: [data-x=".."] stays as [data-x])"""
    while re.search(r"\([^()]*\)", sel):
        sel = re.sub(r"\([^()]*\)", "", sel)
    return re.sub(r"\[([\w-]+)[^\]]*\]", r"[\1]" if keep_attrs else "", sel)


def css_hovers():
    """Every :hover of the main window's CSS: (file, the hovered element's compound selector)."""
    out = []
    for dp, _, fs in os.walk(os.path.join(UI, "css")):
        for f in fs:
            if not f.endswith(".css"):
                continue
            with open(os.path.join(dp, f), encoding="utf-8") as fh:
                css = re.sub(r"/\*.*?\*/", "", fh.read(), flags=re.S)
            for m in re.finditer(r"([^{}]+)\{[^{}]*\}", css):
                for part in re.split(r",(?![^(]*\))", m.group(1)):
                    if ":hover" not in part:
                        continue
                    i = part.index(":hover")
                    base = part[:i] + re.match(r"[^\s>+~]*", part[i + 6:]).group(0)
                    flat = no_parens(base, keep_attrs=True).strip()
                    out.append((f, re.split(r"[\s>+~]+", flat)[-1], base.strip()))
    return out


def markup():
    """The elements written in the interface's markup (index.html and every js file): (tag, classes, id, attributes)."""
    els = []
    files = [os.path.join(UI, "index.html")]
    for dp, _, fs in os.walk(os.path.join(UI, "js")):
        files += [os.path.join(dp, f) for f in fs if f.endswith(".js")]
    for p in files:
        with open(p, encoding="utf-8") as fh:
            src = fh.read()
        for m in re.finditer(r"<([a-z][a-z0-9]*)\b([^<>]*)>", src):
            attrs = re.sub(r"\$\{[^{}]*\}", " ", m.group(2))
            c = re.search(r'class="([^"]*)"', attrs)
            i = re.search(r'id="([^"]*)"', attrs)
            els.append((m.group(1), set(c.group(1).split()) if c else set(), i.group(1) if i else "", attrs))
    return els


class HoverSounds(unittest.TestCase):
    """Whatever lights up under the pointer sounds (hover or hover_soft), unless it is listed here as decorative."""
    # the :hover rules that are not a control (the compound selector of the hovered element -> why it stays quiet)
    DECOR = {
        "::-webkit-scrollbar-thumb": "a scroll bar",
        ".field:has": "the frame of a select: the select inside it sounds",
        "#v-autopilot .ap-name": "a text field (a routine's name): typed into, not clicked",
        "#v-autopilot .si-grip": "the grip of a step row (.si), which sounds itself",
    }
    CONTROL = {"button", "a", "select", "summary"}
    ACTS = re.compile(r'role="(button|tab|option|menuitem|switch|checkbox)"|tabindex="0"|data-go\b')

    def test_every_hover_style_has_its_sound(self):
        rows = sounds_list("ROWS")
        covered, covered_ids = set(), set()
        for s in (sounds_const("HOVER"), sounds_const("SOFT"), ", ".join(rows)):
            covered |= set(re.findall(r"\.([\w-]+)", no_parens(s)))
            covered_ids |= set(re.findall(r"#([\w-]+)", no_parens(s)))
        els = markup()

        def sounds(tag, cls, el_id, attrs):
            return (tag in self.CONTROL or bool(cls & covered) or el_id in covered_ids or bool(self.ACTS.search(attrs))
                    or any(c.startswith("sk") for c in cls))

        missing = []
        for f, last, base in css_hovers():
            if any(base.endswith(k) or last == k for k in self.DECOR):
                continue
            if "::-webkit-slider-thumb" in last:
                self.assertIn("input[type=range]", rows)                 # sliders
                continue
            if last.startswith("input"):
                self.assertIn("input[type=color]", rows, base)          # the colour pickers
                continue
            tag = re.match(r"[a-z]*", last).group(0)
            cls = set(re.findall(r"\.([\w-]+)", last))
            ids = set(re.findall(r"#([\w-]+)", last))
            attr = re.findall(r"\[([\w-]+)", last)
            if tag in self.CONTROL or cls & covered:
                continue
            # the elements that carry it (a class added by an expression, `lo${blocked ? ' blk' : ''}`: its first class)
            found = [e for e in els if (cls and cls <= e[1]) or (ids and e[2] in ids) or (not cls and not ids and attr and f" {attr[0]}=" in " " + e[3])]
            if not found and cls:
                first = re.findall(r"\.([\w-]+)", last)[0]
                found = [e for e in els if first in e[1]]
            if found and all(sounds(*e) for e in found):
                continue
            missing.append(f"{f}: {base}")
        self.assertEqual(missing, [])

    def test_the_rows_named_in_the_reports(self):
        rows, acts = sounds_list("ROWS"), sounds_list("ROW_ACTS")
        # Privacy > Overview's findings ("Secure Boot is off") and Live Monitor > Health's devices (USB, Bluetooth...)
        self.assertIn("#v-privacy .pv-f:not(.pv-pend)", rows)
        self.assertIn("#v-monitor .dv", rows)
        self.assertNotIn("#v-privacy .pv-f:not(.pv-pend)", acts)              # they only show: no click
        self.assertNotIn("#v-monitor .dv", acts)
        self.assertTrue(set(acts) <= set(rows) | {"#v-optimizer .cl-it:not(.clean, .busyrun) .cl-row",
                                                   "#v-optimizer .st-it .st-r", "#v-privacy .pv-pit .pv-pr0",
                                                   "#v-storage .st-tr[data-id]:not(.file)",
                                                   "#v-optimizer .cl-tr:not(.kept)",
                                                   "#v-optimizer .db-it:not(.keep, .rmv, .d, .done)"})
        self.assertIn("${ROWS}", sounds_const("SOFT"))
        self.assertIn("${ROW_ACTS}", sounds_const("CLICKABLE"))

    def test_small_controls_that_were_not_real_ones(self):
        # the radar's caption has a class of its own (it shared .pv-cap with the App permissions buttons: their hover,
        # and their display:none on short windows)
        privacy = read("js", "modules", "privacy.js")
        self.assertIn('<div class="pv-rcap faint">', privacy)
        self.assertNotRegex(privacy, r'<div class="pv-cap\b')
        self.assertNotRegex(read("css", "modules", "privacy.css"), r"\.pv-cap\{display:none\}")
        # the admin note's "Don't suggest this again": one checkbox button, its text included (a <label> without a
        # control did nothing when its text was clicked, and the box could not be reached with the keyboard)
        html = read("index.html")
        self.assertIn('<button type="button" class="note-never" id="noteNeverBtn" role="checkbox" aria-checked="false">'
                      '<span class="check" id="noteNever">', html)
        self.assertNotRegex(html, r"<label>(?:(?!</label>).)*class=\"check\"")
        shell = read("js", "shell.js")
        self.assertIn("$('#noteNeverBtn').addEventListener('click'", shell)
        self.assertIn("setAttribute('aria-checked', String(on))", shell)
        # Settings > Sound > Tasks names the loading loop
        self.assertIn("t('Scans, loading, refreshing, deleting, undoing and copying.')", shell)

    def test_the_tray_panel_has_its_hover_and_click(self):
        src = read("js", "tray-panel.js")
        self.assertIn("SH.sound(b.matches('.ft .ico') ? 'hover_soft' : 'hover', { visible: true })", src)
        self.assertIn("b.id !== 'quit' && b.dataset.a !== 'widget') SH.sound('click', { visible: true })", src)


# core.js + sounds.js in Node: a tiny event bus for window/document, a Web Audio stand-in that "plays" every buffer,
# and a recorder around SH.sound that lists what really played.
WIRING = r"""
const L = {};
const listen = (type, fn, o) => { (L[type] ||= []).push({ fn, capture: o === true || !!(o && o.capture) }); };
/* capture listeners first, then the target's own handler (h), then bubbling ones: enough for these tests */
const fire = (type, e, h) => { e = { type, isTrusted: true, detail: 1, button: 0, buttons: 0, pointerType: 'mouse', clientX: 5, clientY: 5, ...e };
  for (const l of (L[type] || []).filter(l => l.capture)) l.fn(e); if (h) h(e); for (const l of (L[type] || []).filter(l => !l.capture)) l.fn(e); return e; };
globalThis.window = globalThis;
const noop = () => {};
const el = () => ({ dataset: {}, style: { setProperty: noop }, animate: () => ({ finished: Promise.resolve(), cancel: noop }), classList: { add: noop, remove: noop, toggle: noop, contains: () => false } });
let DIALOGS = [], LOADERS = [], COVER = null, HIT = null;
/* LOADERS: loading indicators (see loader() in the tests); COVER: something over the middle of the window; HIT: what
   is under it otherwise (a counter), else the first loader */
globalThis.document = { documentElement: el(), body: {}, hidden: false, addEventListener: listen, querySelector: () => null,
  querySelectorAll: s => s.includes('.cs-o') ? DIALOGS : s.includes('.du-radar') ? LOADERS : [],
  elementFromPoint: () => COVER || HIT || LOADERS[0] || null, createElement: tag => node(tag) };
/* a small DOM node, enough for SH.rollNumber's cells */
function node(tag) { const n = { tag, dataset: {}, style: { setProperty: noop }, children: [], parentNode: null, _text: '',
  get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text; },
  set textContent(v) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._text = String(v); },
  get firstChild() { return this.children[0] || null; },
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
  insertBefore(c, ref) { c.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; },
  remove() { const p = this.parentNode; if (p) { p.children = p.children.filter(x => x !== this); this.parentNode = null; } },
  querySelectorAll: () => [], setAttribute(k, v) { this['@' + k] = v; }, getAttribute(k) { return this['@' + k] ?? null; },
  animate: () => ({ cancel: noop, onfinish: null, finished: Promise.resolve() }) }; return n; }
let SEQ = 0;   /* one counter for what the page paints and what the audio starts, to see what came right before what */
globalThis.innerWidth = 1280; globalThis.innerHeight = 800;
globalThis.getComputedStyle = () => ({ overflowX: 'visible', overflowY: 'visible' });
globalThis.addEventListener = listen; globalThis.removeEventListener = noop;
globalThis.matchMedia = () => ({ matches: false });
globalThis.requestAnimationFrame = noop; globalThis.setInterval = () => 0;
globalThis.MutationObserver = class { observe() {} };
globalThis.chrome = { webview: {} };
globalThis.pywebview = { api: new Proxy({}, { get: (_, n) => n === 'then' ? undefined : () => true }) };
globalThis.SH = { t: s => s };
class AudioBuffer {}
globalThis.AudioBuffer = AudioBuffer;
const param = () => ({ value: 1, cancelScheduledValues: noop, setTargetAtTime: noop });
globalThis.AudioContext = class { constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
  createGain() { return { gain: param(), connect: noop, disconnect: noop }; }
  createBufferSource() { const s = { connect: noop, playbackRate: { value: 1 }, stop() { if (s.loop) loopsStopped.push(s.buffer.file); setTimeout(() => s.onended && s.onended(), 5); },
    start(when) { started.push({ file: s.buffer && s.buffer.file, when: when || 0, loop: !!s.loop, rate: s.playbackRate.value, seq: ++SEQ, t: performance.now() }); if (!s.loop) setTimeout(() => s.onended && s.onended(), 20); } }; return s; }
  resume() { return Promise.resolve(); } decodeAudioData(a) { const b = new AudioBuffer(); b.file = a.file; return Promise.resolve(b); } };
const fetched = [], started = [], loopsStopped = [];
globalThis.fetch = u => { fetched.push(u); return Promise.resolve({ ok: true, arrayBuffer: () => { const a = new ArrayBuffer(8); a.file = u.replace(/^sounds\/|\.ogg$/g, ''); return Promise.resolve(a); } }); };
eval(require('fs').readFileSync(process.env.CORE_JS, 'utf8'));
const played = [], real = SH.sound;
const rec = (ev, o) => { const r = real(ev, o); if (r) played.push(ev); return r; };
Object.assign(rec, real); Object.defineProperty(rec, 'last', { get: () => real.last }); Object.defineProperty(rec, 'looping', { get: () => real.looping });
Object.defineProperty(rec, 'ducked', { get: () => real.ducked }); SH.sound = rec;
eval(require('fs').readFileSync(process.env.SOUNDS_JS, 'utf8'));
const tick = ms => new Promise(r => setTimeout(r, ms));
const out = x => { process.stdout.write(JSON.stringify(x)); process.exit(0); };
/* a dialog element: visible; fading out once close() starts its animation to opacity 0 */
const dialog = () => { const d = { isConnected: true, children: [], anims: [], checkVisibility: () => true, getAnimations() { return this.anims; } };
  d.close = () => { d.anims = [{ playState: 'running', effect: { getKeyframes: () => [{ opacity: 1 }, { opacity: 0 }] } }]; }; return d; };
const nothing = { closest: () => null };
"""


@unittest.skipUnless(shutil.which("node"), "needs Node.js")
class Wiring(unittest.TestCase):
    def run_js(self, body):
        code = WIRING + "(async () => {\n" + body + "\n})().catch(e => { console.log(String(e && e.stack || e)); process.exit(3); });"
        env = dict(os.environ, CORE_JS=os.path.join(UI, "js", "core.js"), SOUNDS_JS=os.path.join(UI, "js", "sounds.js"))
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        src = os.path.join(d, "wiring.js")
        with open(src, "w", encoding="utf-8") as fh:
            fh.write(code)
        r = subprocess.run(["node", src], capture_output=True, text=True, timeout=60, env=env)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return json.loads(r.stdout)

    def test_typing_in_the_palette_ticks_once_per_key(self):
        out = self.run_js(r"""
          const pal = { id: 'palIn', value: 'ab' }, other = { id: 'daQ', value: 'x' };
          const key = (k, x = {}) => fire('keydown', { key: k, target: pal, keyCode: 65, ...x });
          for (const k of 'stellarhub') { key(k); await tick(36); }
          const typed = played.filter(e => e === 'key_type').length;
          played.length = 0;
          key('Shift', { shiftKey: true }); await tick(36); key('Control', { ctrlKey: true }); await tick(36);
          key('k', { ctrlKey: true }); await tick(36); key('ArrowDown'); await tick(36); key('Enter'); await tick(36);
          key('a', { repeat: true }); await tick(36); key('a', { isComposing: true }); await tick(36); key('Process', { keyCode: 229 }); await tick(36);
          fire('keydown', { key: 'a', target: other }); await tick(36);
          fire('keydown', { key: 'a', target: pal, isTrusted: false }); await tick(36);
          const quiet = played.slice();
          key('Backspace'); await tick(36); pal.value = ''; key('Backspace'); await tick(36);
          const back = played.slice();
          played.length = 0;
          for (let i = 0; i < 10; i++) key('x');    // ten keys at once: the 30 ms gap keeps one
          out({ typed, quiet, back, burst: played.length, files: fetched.filter(f => /key/.test(f)) });
        """)
        self.assertEqual(out["typed"], 10)
        self.assertEqual(out["quiet"], [])
        self.assertEqual(out["back"], ["key_type"])          # Backspace on an empty field says nothing
        self.assertEqual(out["burst"], 1)
        self.assertEqual(out["files"], ["sounds/key_type.ogg"])

    def test_a_dialog_closes_with_one_panel_close_however_it_closes(self):
        out = self.run_js(r"""
          const res = {};
          const close = async (name, how) => {
            /* the dialog is open (its own panel_open has come and gone) */
            const d = dialog(); DIALOGS = [d]; fire('pointerdown', { target: nothing }); await tick(600); played.length = 0;
            fire('pointerdown', { target: nothing }); await tick(5);
            await how(d); await tick(500); res[name] = played.slice(); DIALOGS = []; await tick(200);
          };
          /* the backdrop: nothing clickable under the pointer, the dialog's own handler starts its fade */
          await close('backdrop', async d => { fire('click', { target: nothing }, () => d.close()); });
          /* its X: a button; the dialog closes in its handler, before the page-wide click sound */
          const x = { disabled: false, dataset: {}, matches: () => false, closest: () => x };
          await close('x', async d => { fire('click', { target: x }, () => d.close()); });
          /* Esc */
          await close('esc', async d => { fire('keydown', { key: 'Escape', target: nothing }, () => d.close()); });
          /* removed at once instead of fading */
          await close('removed', async d => { fire('click', { target: nothing }, () => { d.isConnected = false; DIALOGS = []; }); });
          /* a close that leads somewhere claims the click: the destination makes the sound */
          await close('claimed', async d => { fire('click', { target: x }, () => { SH.sound.claim(); d.close(); }); });
          out(res);
        """)
        for how in ("backdrop", "x", "esc", "removed"):
            self.assertEqual(out[how], ["panel_close"], how)
        self.assertEqual(out["claimed"], [])

    def test_a_module_change_plays_one_click_and_one_swoosh_that_rotates(self):
        out = self.run_js(r"""
          SH.sound.preload(['navigate']); await tick(30);
          const runs = [];
          for (let i = 0; i < 9; i++) {
            fire('pointerdown', { target: nothing }); started.length = 0; played.length = 0;
            SH.sound('navigate'); await tick(160);
            runs.push({ played: played.slice(), started: started.map(s => s.file), delayed: started.filter(s => s.when > 0).map(s => s.file) });
          }
          /* no gesture: no click and no swoosh either */
          await tick(1600); started.length = 0; SH.sound('navigate'); await tick(60); const quiet = started.length;
          /* intensity min: the transition is shorter, the swoosh stays */
          SH.state.settings.intensity = 'min'; fire('pointerdown', { target: nothing }); started.length = 0; SH.sound('navigate'); await tick(60);
          out({ runs, quiet, min: started.map(s => s.file), files: SH.sound.files('navigate') });
        """)
        sw = []
        for r in out["runs"]:
            self.assertEqual(r["played"], ["navigate"])
            self.assertEqual(len(r["started"]), 2, r)
            self.assertEqual(r["started"][0], "navigate_click")           # the click at once...
            self.assertTrue(r["started"][1].startswith("navigate_swoosh_"))
            self.assertEqual(r["delayed"], [r["started"][1]])            # ...the swoosh a moment later
            sw.append(r["started"][1])
        self.assertTrue(all(a != b for a, b in zip(sw, sw[1:])), sw)    # never the same twice in a row
        self.assertEqual(len(set(sw[:7])), 7, sw)                         # all seven take turns
        self.assertEqual(out["quiet"], 0)
        self.assertEqual(len(out["min"]), 2)
        self.assertEqual(out["files"], ["navigate_click"] + [f"navigate_swoosh_{i}" for i in range(1, 8)])

    def test_hover_soft_only_for_secondary_elements_and_throttled(self):
        out = self.run_js(r"""
          /* a tiny DOM: closest/matches/contains on a token per element */
          const elt = (token, parent = null) => { const e = { token, parent, disabled: false, getAttribute: () => null,
            matches: s => s.split(',').map(x => x.trim()).includes(token),
            closest(s) { return this.matches(s) ? this : parent ? parent.closest(s) : null; },
            contains(x) { for (let n = x; n; n = n.parent) if (n === this) return true; return false; } }; return e; };
          const panel = elt('.pan'), card = elt('.btn', panel), inner = elt('.toggle', card), tab = elt('[role=tab]', panel),
            tab2 = elt('[role=tab]', panel), row = elt('[data-go]', panel), label = elt('span', tab), text = elt('p', panel);
          SH.sound.preload(['hover', 'hover_soft']); await tick(30);
          const move = () => fire('pointermove', { movementX: 2, movementY: 1, target: panel });
          const enter = (el, from = panel) => { move(); fire('pointerover', { target: el, relatedTarget: from }); };
          const take = async (fn, ms = 120) => { played.length = 0; await fn(); await tick(ms); return played.slice(); };
          const r = {};
          r.soft = await take(() => enter(tab));
          r.row = await take(() => enter(row));
          r.primary = await take(() => enter(card));
          r.intoNested = await take(() => enter(inner, card));        /* from the card onto its switch: the card spoke */
          r.nestedFromOutside = await take(() => enter(inner));       /* straight onto the switch: the card's hover */
          r.inside = await take(() => enter(label, tab));             /* moving inside a tab */
          r.text = await take(() => enter(text));
          r.afterHover = await take(async () => { enter(card); await tick(30); enter(tab); });
          r.burst = await take(async () => { enter(tab); await tick(30); enter(tab2); await tick(30); enter(tab); await tick(100); enter(tab2); });
          r.scroll = await take(() => { fire('wheel', {}); enter(tab); }, 300);
          r.still = await take(async () => { move(); await tick(90); fire('pointerover', { target: tab2, relatedTarget: panel }); });
          r.touch = await take(() => { move(); fire('pointerover', { target: tab, relatedTarget: panel, pointerType: 'touch' }); });
          r.files = SH.sound.files('hover_soft');
          r.started = started.filter(s => /hover/.test(s.file)).map(s => s.file).slice(-1);
          out(r);
        """)
        self.assertEqual(out["soft"], ["hover_soft"])
        self.assertEqual(out["row"], ["hover_soft"])
        self.assertEqual(out["primary"], ["hover"])
        self.assertEqual(out["intoNested"], [])
        self.assertEqual(out["nestedFromOutside"], ["hover"])
        self.assertEqual(out["inside"], [])
        self.assertEqual(out["text"], [])
        self.assertEqual(out["afterHover"], ["hover"])                    # never right after a hover
        self.assertEqual(out["burst"], ["hover_soft", "hover_soft"])     # 90 ms apart at least
        self.assertEqual(out["scroll"], [])
        self.assertEqual(out["still"], [])
        self.assertEqual(out["touch"], [])
        self.assertEqual(out["files"], ["hover_soft"])

    def test_rows_that_light_up_tick_softly_and_click_only_when_they_act(self):
        out = self.run_js(r"""
          /* the same tiny DOM: an element matches the one selector it is named after */
          const elt = (token, parent = null, x = {}) => ({ token, parent, disabled: false, dataset: {}, getAttribute: () => null,
            classList: { contains: () => false },
            matches: s => s.split(',').map(x => x.trim()).includes(token),
            closest(s) { return this.matches(s) ? this : parent ? parent.closest(s) : null; },
            contains(x) { for (let n = x; n; n = n.parent) if (n === this) return true; return false; }, ...x });
          const view = elt('#v-privacy'),
            finding = elt('#v-privacy .pv-f:not(.pv-pend)', view), text = elt('b', finding), fix = elt('.btn', finding),
            device = elt('#v-monitor .dv', view), driver = elt('#v-drivers .du-row', view),
            pending = elt('div', view), planOff = elt('div', view),            /* a row still loading, a plan step marked .dis */
            slider = elt('input[type=range]', view), dead = elt('input[type=range]', view, { disabled: true });
          SH.sound.preload(['hover', 'hover_soft', 'click']); await tick(30);
          const move = () => fire('pointermove', { movementX: 2, movementY: 1, target: view });
          const enter = (el, from = view) => { move(); fire('pointerover', { target: el, relatedTarget: from }); };
          const take = async (fn, ms = 120) => { played.length = 0; await fn(); await tick(ms); return played.slice(); };
          const press = el => { fire('pointerdown', { target: el }); fire('click', { target: el }); };
          const r = {};
          r.finding = await take(() => enter(finding));
          r.insideFinding = await take(() => enter(text, finding));      /* moving over its text: still the same row */
          r.fixButton = await take(() => enter(fix, finding));            /* its Fix button is a primary one */
          r.device = await take(() => enter(device));
          r.pending = await take(() => enter(pending));
          r.planOff = await take(() => enter(planOff));
          r.slider = await take(() => enter(slider));
          r.deadSlider = await take(() => enter(dead));
          r.clickFinding = await take(() => press(text));                /* it only shows: no click */
          r.clickDevice = await take(() => press(device));
          r.clickDriver = await take(() => press(driver));               /* selecting an update: a click */
          out(r);
        """)
        self.assertEqual(out["finding"], ["hover_soft"])
        self.assertEqual(out["insideFinding"], [])
        self.assertEqual(out["fixButton"], ["hover"])
        self.assertEqual(out["device"], ["hover_soft"])
        self.assertEqual(out["pending"], [])
        self.assertEqual(out["planOff"], [])
        self.assertEqual(out["slider"], ["hover_soft"])
        self.assertEqual(out["deadSlider"], [])
        self.assertEqual(out["clickFinding"], [])
        self.assertEqual(out["clickDevice"], [])
        self.assertEqual(out["clickDriver"], ["click"])

    def test_the_loading_loop_follows_what_is_on_screen(self):
        out = self.run_js(r"""
          SH.booted = true; SH.state.view = 'drivers';
          /* a loading indicator (Driver Updater's radar): in its module's view, rendered, 200 px square */
          const loader = (mod = 'drivers') => { const v = { id: 'v-' + mod }; const l = { closest: s => s === '.view' ? v : null,
            matches: () => false, checkVisibility: () => true, parentElement: null, contains: x => x === l,
            getBoundingClientRect: () => ({ left: 100, top: 100, right: 300, bottom: 300, width: 200, height: 200 }) }; return l; };
          SH.emit('boot');
          const loops = () => started.filter(s => s.loop).length;
          const r = {};
          LOADERS = [loader()]; await tick(250); r.early = loops(); await tick(500);
          r.started = loops(); r.file = started.filter(s => s.loop).map(s => s.file); r.looping = SH.sound.looping;
          LOADERS = [loader()]; await tick(450); r.rerender = loops();          /* re-rendered: the same loop goes on */
          SH.state.view = 'home'; await tick(300); r.moduleSwitch = [SH.sound.looping, loopsStopped.length];
          SH.state.view = 'drivers'; await tick(700); r.back = loops();
          SH.emit('window', { shown: false }); await tick(30); r.hidden = SH.sound.looping;
          await tick(500); r.stillHidden = SH.sound.looping;
          SH.emit('window', { shown: true }); await tick(300);
          LOADERS = []; await tick(300); let n = loops();
          LOADERS = [loader()]; await tick(250); LOADERS = []; await tick(600); r.quick = loops() - n;   /* a quick load */
          n = loops(); LOADERS = [loader(), loader()]; await tick(900); r.two = loops() - n; r.twoLooping = SH.sound.looping;
          COVER = { contains: () => false }; await tick(300); r.covered = SH.sound.looping; COVER = null;
          LOADERS = [loader('storage')]; await tick(900); r.otherModule = SH.sound.looping;          /* not the one in view */
          /* the scan in view ends: its scan_complete ducks the loop and the radar goes, so the loop ends there */
          LOADERS = [loader()]; await tick(900); r.beforeDone = SH.sound.looping; let m = loops();
          SH.sound('scan_complete'); r.doneDucked = SH.sound.ducked; LOADERS = [];
          await tick(900); r.afterDone = [SH.sound.looping, loops() - m];
          /* the owner's case: an analysis in A, the user goes to B (A's loop stops) and starts one there (B's loop);
             A ends in the background: its scan_complete only ducks B's loop, which comes back, not from the start */
          LOADERS = [loader()]; await tick(900); SH.state.view = 'storage'; LOADERS = []; await tick(300); r.leftA = SH.sound.looping;
          LOADERS = [loader('storage')]; await tick(900); m = loops(); r.bLoop = SH.sound.looping;
          SH.sound('scan_complete'); await tick(30); r.bDucked = [SH.sound.looping, SH.sound.ducked];
          await tick(900); r.bBack = [SH.sound.looping, SH.sound.ducked, loops() - m];
          LOADERS = []; await tick(300); r.bEnd = SH.sound.looping;
          SH.state.view = 'drivers'; LOADERS = [loader()]; await tick(900); r.nextScan = SH.sound.looping;
          LOADERS = []; await tick(300);
          SH.state.settings.soundTasks = false; LOADERS = [loader()]; await tick(900); r.tasksOff = SH.sound.looping;
          out(r);
        """)
        self.assertEqual(out["early"], 0)                    # not before 400 ms
        self.assertEqual(out["started"], 1)
        self.assertEqual(out["file"], ["loading"])
        self.assertTrue(out["looping"])
        self.assertEqual(out["rerender"], 1)                 # never from the beginning again
        self.assertEqual(out["moduleSwitch"], [False, 1])
        self.assertEqual(out["back"], 2)
        self.assertFalse(out["hidden"])
        self.assertFalse(out["stillHidden"])
        self.assertEqual(out["quick"], 0)
        self.assertEqual(out["two"], 1)                      # one loop however many indicators
        self.assertTrue(out["twoLooping"])
        self.assertFalse(out["covered"])
        self.assertFalse(out["otherModule"])
        self.assertTrue(out["beforeDone"])
        self.assertTrue(out["doneDucked"])                   # under the scan's own sound
        self.assertEqual(out["afterDone"], [False, 0])       # its indicator went: it ends, no restart
        self.assertFalse(out["leftA"])
        self.assertTrue(out["bLoop"])
        self.assertEqual(out["bDucked"], [True, True])       # A's end, elsewhere: B's loop only steps aside...
        self.assertEqual(out["bBack"], [True, False, 0])     # ...and comes back, the same voice
        self.assertFalse(out["bEnd"])
        self.assertTrue(out["nextScan"])
        self.assertFalse(out["tasksOff"])

    def test_a_switch_says_on_or_off_even_when_its_handler_shows_a_toast(self):
        """Scheduled Tasks' routine switch shows "turned on/off" toasts: the plain toast's sound used to come first and
        take the click, so on and off sounded the same."""
        out = self.run_js(r"""
          const ctl = (token, on = false) => { const e = { token, on, disabled: false, dataset: {},
            classList: { contains: c => c === 'on' && e.on }, getAttribute: () => null,
            matches: s => s.split(',').map(x => x.trim()).includes(token), closest(s) { return this.matches(s) ? this : null; } }; return e; };
          const sw = ctl('.toggle'), btn = ctl('button');
          SH.sound.preload(['toggle_on', 'toggle_off', 'toast', 'click']); await tick(30);
          const press = async (el, handler, x = {}) => { played.length = 0; fire('pointerdown', { target: el }); fire('click', { target: el, ...x }, handler); await tick(450); return played.slice(); };
          const flip = () => { sw.on = !sw.on; SH.sound('toast'); };   /* what the handler does: the switch, then SH.toast(...) */
          const r = {};
          r.on = await press(sw, flip);
          r.off = await press(sw, flip);
          r.keyOn = await press(sw, flip, { detail: 0 });             /* Space on the switch */
          r.button = await press(btn, () => SH.sound('toast'));       /* a button that only says something: its click */
          r.buttonKey = await press(btn, () => SH.sound('toast'), { detail: 0 });   /* Enter: no click sound, so the toast */
          r.success = await press(btn, () => SH.sound('success'));    /* a notification still wins */
          out(r);
        """)
        self.assertEqual(out["on"], ["toggle_on"])
        self.assertEqual(out["off"], ["toggle_off"])
        self.assertEqual(out["keyOn"], ["toggle_on"])
        self.assertEqual(out["button"], ["click"])
        self.assertEqual(out["buttonKey"], ["toast"])
        self.assertEqual(out["success"], ["success"])

    def test_a_button_that_disables_itself_still_clicks(self):
        """Program Updater's row Update disables itself and shows a plain toast: the toast kept quiet for the button's
        click, and the click, seeing the button disabled after its handler, said nothing either."""
        out = self.run_js(r"""
          const btn = { disabled: false, dataset: {}, classList: { contains: () => false }, getAttribute: () => null,
            matches: s => s.split(',').map(x => x.trim()).includes('button'), closest(s) { return this.matches(s) ? this : null; } };
          SH.sound.preload(['toast', 'click']); await tick(30);
          fire('pointerdown', { target: btn }); fire('click', { target: btn }, () => { btn.disabled = true; SH.sound('toast'); }); await tick(450);
          out(played);
        """)
        self.assertEqual(out, ["click"])

    def test_a_dialog_that_opened_by_itself_closes_with_panel_close(self):
        """The update dialog opens on a timer, with no gesture: a press on its Later is not a panel_open, and Esc on it
        still says panel_close."""
        out = self.run_js(r"""
          const x = { disabled: false, dataset: {}, matches: () => false, closest: () => x };
          SH.sound.preload(['panel_open', 'panel_close', 'click']); await tick(30);
          const r = {};
          let d = dialog(); DIALOGS = [d]; await tick(600);                       /* opened by a timer */
          fire('pointerdown', { target: x }); await tick(60); fire('click', { target: x }, () => d.close()); await tick(500);
          r.later = played.slice(); played.length = 0; DIALOGS = []; await tick(200);
          d = dialog(); DIALOGS = [d]; await tick(600);
          fire('keydown', { key: 'Escape', target: nothing }, () => d.close()); await tick(500);
          r.esc = played.slice();
          out(r);
        """)
        self.assertEqual(out["later"], ["panel_close"])
        self.assertEqual(out["esc"], ["panel_close"])

    def test_count_ticks_follow_a_counter_on_screen(self):
        out = self.run_js(r"""
          globalThis.requestAnimationFrame = f => setTimeout(() => f(performance.now()), 16);
          SH.state.view = 'storage';
          const view = { id: 'v-storage' };
          const n = { dataset: {}, textContent: '', closest: s => s === '.view' ? view : null, checkVisibility: () => true,
            parentElement: null, contains: x => x === n, getBoundingClientRect: () => ({ left: 10, top: 10, right: 200, bottom: 60, width: 190, height: 50 }) };
          HIT = n;
          SH.sound.preload(['count_tick']); await tick(30);
          const ticks = () => started.filter(s => /^count_tick/.test(s.file)).map(s => s.file);
          SH.rollNumber(n, 1000, { tick: true }); await tick(50);
          const r = { first: ticks().length };
          let v = 1000; const t0 = Date.now();
          while (Date.now() - t0 < 1000) { v += 1500; SH.rollNumber(n, v, { tick: true }); await tick(40); }
          await tick(300);
          r.perSecond = ticks().length / ((Date.now() - t0) / 1000); r.files = ticks(); r.text = n.textContent;
          const before = ticks().length;
          SH.state.view = 'home';                                    /* another module in front: the counter is not seen */
          for (let i = 0; i < 10; i++) { v += 1500; SH.rollNumber(n, v, { tick: true }); await tick(40); }
          await tick(300); r.offScreen = ticks().length - before;
          out(r);
        """)
        self.assertEqual(out["first"], 0)                            # its first value is no change
        self.assertGreaterEqual(out["perSecond"], 6)
        self.assertLessEqual(out["perSecond"], 12.5)                 # about 12 a second at most
        self.assertTrue(all(re.fullmatch(r"count_tick_[1-4]", f) for f in out["files"]), out["files"])
        self.assertTrue(all(a != b for a, b in zip(out["files"], out["files"][1:])), out["files"])   # never twice in a row
        self.assertEqual(out["offScreen"], 0)

    def test_percent_steps_go_with_the_painted_number(self):
        """The Benchmark score: SH.rollNumber paints the percentage (at most every ~240 ms, the latest value) and the
        pluck for that very number starts in the same call, right after the paint; a step inside the 85 ms gap is
        dropped, never queued, so no sound ever comes late or with another number's pitch."""
        out = self.run_js(r"""
          SH.state.view = 'benchmark';
          const view = { id: 'v-benchmark' };
          const sc = Object.assign(node('b'), { closest: s => s === '.view' ? view : null, checkVisibility: () => true,
            parentElement: null, contains: x => x === sc, getBoundingClientRect: () => ({ left: 10, top: 10, right: 200, bottom: 60, width: 190, height: 50 }) });
          const paints = [], set = sc.setAttribute;
          sc.setAttribute = function (k, v) { if (k === 'aria-label') paints.push({ txt: v, seq: ++SEQ, t: performance.now() }); return set.call(this, k, v); };
          HIT = sc;
          SH.sound.preload(['percent_step']); await tick(30);
          const plucks = () => started.filter(s => /^percent_step_/.test(s.file));
          const show = p => SH.rollNumber(sc, SH.fmtInt(p) + '%', { percent: p });
          show(0); await tick(20);
          const r = { first: plucks().length };                        /* a run starting at 0: nothing */
          for (let p = 0; p <= 100; p += 1.3) { show(p); await tick(22); }
          show(100); await tick(600);
          r.paints = paints.map(x => ({ ...x })); r.plucks = plucks().map(x => ({ file: x.file, seq: x.seq, t: x.t }));
          /* going down (a new run) says nothing */
          let k = plucks().length; show(30); await tick(400); r.down = plucks().length - k;
          /* drawn at once (lighter effects: no roll, every value painted): two higher numbers 20 ms apart, the second
             falls in the gap and is dropped, not played later */
          SH.state.settings.countUp = false; k = plucks().length;
          show(40); await tick(20); show(41); await tick(400); r.burst = plucks().length - k;
          SH.state.view = 'home'; k = plucks().length; show(60); await tick(100); r.offScreen = plucks().length - k;
          out(r);
        """)
        self.assertEqual(out["first"], 0)
        paints, plucks = out["paints"], out["plucks"]
        self.assertGreaterEqual(len(plucks), 5)
        by_seq = {p["seq"]: p for p in paints}
        for pl in plucks:
            paint = by_seq.get(pl["seq"] - 1)                         # the event right before it: the paint
            self.assertIsNotNone(paint, pl)
            self.assertLess(pl["t"] - paint["t"], 2)                  # same call, not later
            shown = int(re.sub(r"\D", "", paint["txt"]))
            self.assertEqual(pl["file"], f"percent_step_{min(8, shown * 9 // 101)}", paint["txt"])
        self.assertLessEqual(len(plucks), len(paints) - 1)            # never more than the numbers painted
        steps = [int(p["file"].rsplit("_", 1)[1]) for p in plucks]
        self.assertEqual(steps, sorted(steps))                         # it only climbs
        self.assertEqual((steps[0] <= 1, steps[-1]), (True, 8))
        self.assertEqual(out["down"], 0)
        self.assertEqual(out["burst"], 1)
        self.assertEqual(out["offScreen"], 0)

if __name__ == "__main__":
    unittest.main()
