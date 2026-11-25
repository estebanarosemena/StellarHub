"""Following long work from anywhere (2.0.0): the SH.activity registry in core.js (run in Node with a small stand-in for
the page), the taskbar progress helper (stellarhub/taskbar.py) and the tray notification click."""
import json
import os
import re
import shutil
import subprocess
import threading
import time
import unittest
from unittest import mock

os.environ["STELLARHUB_NO_DIALOGS"] = "1"
os.environ["STELLARHUB_NO_SPLASH"] = "1"

from stellarhub import taskbar  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI = os.path.join(ROOT, "stellarhub", "ui")

# A stand-in for the page: just enough of window/document for core.js to load, an API whose calls are recorded, and a
# SH.toast that records what it shows. Each scenario is an async function body that ends by printing JSON.
PRELUDE = r"""
const calls = [], toasts = [];
globalThis.window = globalThis;
const noop = () => {};
const el = () => ({ dataset: {}, style: { setProperty: noop }, animate: () => ({ finished: Promise.resolve(), cancel: noop }), classList: { add: noop, remove: noop, toggle: noop } });
globalThis.document = { documentElement: el(), hidden: false, addEventListener: noop, querySelector: () => null, querySelectorAll: () => [] };
globalThis.matchMedia = () => ({ matches: false });
globalThis.addEventListener = noop;
globalThis.requestAnimationFrame = noop;
globalThis.setInterval = () => 0;
globalThis.MutationObserver = class { observe() {} };
globalThis.chrome = { webview: {} };
const api = new Proxy({}, { get: (_, name) => name === 'then' ? undefined : (...a) => { calls.push([name, ...a]); return name === 'engine_job' ? { ok: true, id: 'j' + calls.length } : true; } });
globalThis.pywebview = { api };
globalThis.SH = { t: (s, v) => v ? s.replace(/\{(\w+)\}/g, (m, k) => k in v ? v[k] : m) : s };
"""
LOAD = r"""
eval(require('fs').readFileSync(process.env.CORE_JS, 'utf8'));
SH.toast = (text, o = {}) => { SH.toast.lastAt = performance.now(); toasts.push({ text, kind: o.kind, silent: !!o.silent, action: o.action && o.action.label }); };
SH.go = (m, o) => { calls.push(['go', m, o || {}]); SH.state.view = m === 'settings' ? SH.state.view : m; SH.emit('view', { to: m }); };
const tick = ms => new Promise(r => setTimeout(r, ms));
const out = x => { process.stdout.write(JSON.stringify(x)); process.exit(0); };
"""


@unittest.skipUnless(shutil.which("node"), "needs Node.js")
class Registry(unittest.TestCase):
    def run_js(self, body):
        code = PRELUDE + LOAD + "(async () => {\n" + body + "\n})().catch(e => { console.log(String(e && e.stack || e)); process.exit(3); });"
        env = dict(os.environ, CORE_JS=os.path.join(UI, "js", "core.js"))
        r = subprocess.run(["node", "-e", code], capture_output=True, text=True, timeout=60, env=env)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return json.loads(r.stdout)

    def test_progress_and_the_most_relevant_one(self):
        out = self.run_js(r"""
          const a = SH.activity.start('storage', { key: 'scan', label: 'Scanning' });
          a.progress(.384, 'C:\\Users');
          const b = SH.activity.start('storage', { key: 'dups', label: 'Looking for duplicates' });
          const same = SH.activity.start('storage', { key: 'scan' });
          out({ of: SH.activity.of('storage'), pct: SH.activity.pct(SH.activity.of('storage')), apct: SH.activity.pct(SH.activity.list()[1]),
                same: same === a, n: SH.activity.list().length, busy: SH.activity.busy('storage'), idle: SH.activity.busy('drivers') });
        """)
        self.assertEqual(out["of"]["key"], "dups")          # the newest one is shown
        self.assertEqual(out["of"]["count"], 2)
        self.assertEqual(out["pct"], "")                    # not measurable yet
        self.assertEqual(out["apct"], "38 %")
        self.assertTrue(out["same"])                        # the same key is the same activity
        self.assertEqual(out["n"], 2)
        self.assertTrue(out["busy"])
        self.assertFalse(out["idle"])

    def test_ending_elsewhere_tells_once_and_leaves_a_badge_until_visited(self):
        out = self.run_js(r"""
          SH.state.view = 'home';
          const h = SH.activity.start('optimizer', { label: 'Analyzing', go: { tab: 'overview' } });
          h.progress(.5, 'Reading services');
          const told = h.end({ ok: true, summary: '4.6 GB can be freed' });
          const again = h.end({ ok: true });
          const badge = SH.activity.done('optimizer');
          SH.state.view = 'optimizer'; SH.emit('view', { to: 'optimizer' });
          out({ told, again, badge, after: SH.activity.done('optimizer'), toasts, open: h.open });
        """)
        self.assertTrue(out["told"])
        self.assertFalse(out["again"])
        self.assertEqual(out["badge"]["summary"], "4.6 GB can be freed")
        self.assertTrue(out["badge"]["ok"])
        self.assertIsNone(out["after"])                     # visiting the module clears it
        self.assertEqual(len(out["toasts"]), 1)
        self.assertEqual(out["toasts"][0]["text"], "Super Optimizer finished: 4.6 GB can be freed")
        self.assertEqual(out["toasts"][0]["kind"], "success")
        self.assertEqual(out["toasts"][0]["action"], "View")
        self.assertFalse(out["open"])

    def test_no_notice_when_looking_at_it_cancelled_or_in_the_background(self):
        out = self.run_js(r"""
          SH.state.view = 'updater';
          const here = SH.activity.start('updater').end({ ok: true, summary: 'x' });
          SH.state.view = 'home';
          const cancelled = SH.activity.start('updater').end({ cancelled: true });
          const quiet = SH.activity.start('updater', { user: false }).end({ ok: true });
          out({ here, cancelled, quiet, toasts, done: SH.activity.doneAll() });
        """)
        self.assertFalse(out["here"])
        self.assertFalse(out["cancelled"])
        self.assertFalse(out["quiet"])
        self.assertEqual(out["toasts"], [])
        self.assertEqual(out["done"], [])

    def test_errors_and_the_view_action(self):
        out = self.run_js(r"""
          SH.state.view = 'home';
          SH.activity.start('drivers', { go: { tab: 'updates' } }).end({ ok: false, error: new Error('no network') });
          const d = SH.activity.done('drivers');
          SH.activity.open('drivers', d.go);
          out({ toasts, d, go: calls.filter(c => c[0] === 'go'), after: SH.activity.done('drivers') });
        """)
        self.assertEqual(out["toasts"][0]["text"], "Driver Updater could not finish: no network")
        self.assertEqual(out["toasts"][0]["kind"], "error")
        self.assertFalse(out["d"]["ok"])
        self.assertEqual(out["go"], [["go", "drivers", {"tab": "updates"}]])
        self.assertIsNone(out["after"])

    def test_hidden_window_uses_the_tray_notification(self):
        out = self.run_js(r"""
          SH.state.view = 'storage'; document.hidden = true;   // even on its own module: nobody is looking
          SH.activity.start('storage', { go: { tab: 'map' } }).end({ ok: true, summary: '312 GB used' });
          await tick(30);
          out({ toasts, notes: calls.filter(c => c[0] === 'notify_activity'), badge: SH.activity.done('storage') });
        """)
        self.assertEqual(out["toasts"], [])
        self.assertEqual(out["notes"], [["notify_activity", "Storage Checker finished: 312 GB used", "storage", "map"]])
        self.assertIsNone(out["badge"])                     # it is the current module: no badge on its icon

    def test_python_says_the_window_is_hidden(self):
        """WebView2 can keep document.visibilityState "visible" in the tray: Python's 'window' event counts too."""
        out = self.run_js(r"""
          SH.state.view = 'home';
          SH.emit('window', { shown: false });
          SH.activity.start('drivers', { go: { tab: 'updates' } }).end({ ok: false, error: 'offline' });
          await tick(30);
          const hidden = { toasts: toasts.length, notes: calls.filter(c => c[0] === 'notify_activity') };
          SH.emit('window', { shown: true });
          SH.activity.start('drivers').end({ ok: true });
          out({ hidden, toasts: toasts.map(t => t.text), badge: !!SH.activity.done('drivers') });
        """)
        self.assertEqual(out["hidden"]["toasts"], 0)
        self.assertEqual(out["hidden"]["notes"], [["notify_activity", "Driver Updater could not finish: offline", "drivers", "updates"]])
        self.assertEqual(out["toasts"], ["Driver Updater finished."])
        self.assertTrue(out["badge"])

    def test_taskbar_aggregate(self):
        out = self.run_js(r"""
          await tick(20);
          const seen = () => calls.filter(c => c[0] === 'taskbar_progress').map(c => [c[1], c[2]]);
          const a = SH.activity.start('storage'); a.progress(.2);
          const b = SH.activity.start('drivers'); b.progress(.6);
          await tick(150);
          const both = seen().pop();
          const c = SH.activity.start('updater');          // not measurable: the whole button is indeterminate
          await tick(150);
          const ind = seen().pop();
          c.end({ cancelled: true }); a.end({ ok: true }); b.end({ ok: false, error: 'x' });
          await tick(30);
          const err = seen().pop();
          out({ both, ind, err });
        """)
        self.assertEqual(self.round(out["both"]), ["normal", 0.4])
        self.assertEqual(out["ind"][0], "indeterminate")
        self.assertEqual(out["err"], ["error", 1])

    @staticmethod
    def round(x):
        return [x[0], round(x[1], 2)]

    def test_user_started_jobs_feed_it_by_themselves(self):
        out = self.run_js(r"""
          SH.state.view = 'home';
          const p = SH.job('drivers', 'search', [], { sound: 'task' });
          await tick(20);
          const jid = calls.filter(c => c[0] === 'engine_job').length && 'j' + (calls.findIndex(c => c[0] === 'engine_job') + 1);
          SH.emit('job', { id: jid, kind: 'progress', pct: .25, text: 'Asking Windows Update' });
          await tick(120);
          const mid = SH.activity.of('drivers');
          SH.emit('job', { id: jid, kind: 'end', state: 'done', result: { n: 3 } });
          await p;
          await tick(400);
          // a background job (no sound) and a job inside the module's own activity add nothing
          const own = SH.activity.start('storage', { label: 'Scanning' });
          SH.job('storage', 'scan', [], { sound: 'scan' }); SH.job('privacy', 'protection');
          await tick(20);
          out({ mid, after: SH.activity.of('drivers'), toasts, list: SH.activity.list().map(a => a.mod) });
        """)
        self.assertEqual(out["mid"]["text"], "Asking Windows Update")
        self.assertAlmostEqual(out["mid"]["pct"], 0.25)
        self.assertIsNone(out["after"])
        self.assertEqual([t["text"] for t in out["toasts"]], ["Driver Updater finished."])
        self.assertEqual(out["list"], ["storage"])

    def test_the_modules_own_toast_is_enough_for_a_followed_job(self):
        out = self.run_js(r"""
          SH.state.view = 'home';
          const p = SH.job('drivers', 'install', [], { sound: 'task' });
          await tick(20);
          const jid = 'j' + (calls.findIndex(c => c[0] === 'engine_job') + 1);
          SH.emit('job', { id: jid, kind: 'end', state: 'done', result: {} });
          await p; SH.toast('2 drivers installed.', { kind: 'success' });
          await tick(400);
          out({ toasts: toasts.map(t => t.text), badge: !!SH.activity.done('drivers') });
        """)
        self.assertEqual(out["toasts"], ["2 drivers installed."])
        self.assertTrue(out["badge"])

    # ---- work a module starts by itself (bg): followed once it runs past the grace period ----

    def test_started_by_itself_shows_after_the_grace_period_and_tells_when_it_ends_elsewhere(self):
        out = self.run_js(r"""
          SH.state.view = 'storage';
          const h = SH.activity.start('storage', { key: 'scan', label: 'Scanning C:', go: { tab: 'map' }, bg: true, grace: 120 });
          h.progress(.3);
          await tick(20);
          const early = { of: SH.activity.of('storage'), user: SH.activity.list().filter(a => a.user).length, tb: calls.filter(c => c[0] === 'taskbar_progress').pop() };
          await tick(200);
          SH.state.view = 'home';                           // the user leaves Storage
          const late = SH.activity.of('storage');
          await tick(120);
          const tb = calls.filter(c => c[0] === 'taskbar_progress').pop();
          const told = h.end({ ok: true, summary: '312 GB in 1,204,551 files' });
          out({ early, late, tb, told, toasts, badge: SH.activity.done('storage') });
        """)
        self.assertIsNone(out["early"]["of"])               # inside the grace period: nothing shows anywhere
        self.assertEqual(out["early"]["user"], 0)
        self.assertNotEqual((out["early"].get("tb") or [None, "none"])[1], "normal")
        self.assertEqual(out["late"]["key"], "scan")        # past it: the dock ring, Home and the palette follow it
        self.assertTrue(out["late"]["bg"])
        self.assertAlmostEqual(out["late"]["pct"], 0.3)
        self.assertEqual(out["tb"][1:], ["normal", 0.3])
        self.assertTrue(out["told"])
        self.assertEqual([(t["text"], t["action"]) for t in out["toasts"]], [("Storage Checker finished: 312 GB in 1,204,551 files", "View")])
        self.assertEqual(out["badge"]["go"], {"tab": "map"})

    def test_a_quick_refresh_that_starts_by_itself_never_shows(self):
        out = self.run_js(r"""
          SH.state.view = 'home';
          await tick(20);
          const before = calls.filter(c => c[0] === 'taskbar_progress').length;
          const h = SH.activity.start('privacy', { key: 'check', bg: true });
          h.progress(.5);
          await tick(200);
          const mid = SH.activity.of('privacy');
          const told = h.end({ ok: false, error: 'x' });
          await tick(400);
          out({ mid, told, toasts, done: SH.activity.doneAll(), tb: calls.filter(c => c[0] === 'taskbar_progress').slice(before).map(c => c[1]) });
        """)
        self.assertIsNone(out["mid"])
        self.assertFalse(out["told"])
        self.assertEqual(out["toasts"], [])
        self.assertEqual(out["done"], [])
        self.assertNotIn("normal", out["tb"])
        self.assertNotIn("error", out["tb"])                # a failure nobody saw does not flash the taskbar red

    def test_the_default_grace_period_is_about_a_second_and_a_half(self):
        out = self.run_js(r"""
          SH.state.view = 'home';
          const h = SH.activity.start('updater', { key: 'scan:win', bg: true });
          await tick(1200); const a = !!SH.activity.of('updater');
          await tick(450); const b = !!SH.activity.of('updater');
          h.end({ cancelled: true });
          out({ a, b, toasts });
        """)
        self.assertFalse(out["a"])
        self.assertTrue(out["b"])
        self.assertEqual(out["toasts"], [])

    def test_the_user_asking_for_what_already_runs_makes_it_theirs_at_once(self):
        out = self.run_js(r"""
          SH.state.view = 'home';
          const bg = SH.activity.start('storage', { key: 'scan', label: 'Scanning C:', bg: true });
          const mine = SH.activity.start('storage', { key: 'scan', label: 'Scanning D:' });
          out({ same: bg === mine, of: SH.activity.of('storage') });
        """)
        self.assertTrue(out["same"])
        self.assertEqual(out["of"]["label"], "Scanning D:")
        self.assertFalse(out["of"]["bg"])

    def test_a_bg_job_follows_itself_silently(self):
        out = self.run_js(r"""
          SH.state.view = 'home';
          const p = SH.job('optimizer', 'registry_fix', [[1, 2]], { bg: true, label: 'Fixing entries' });
          await tick(20);
          const jid = 'j' + (calls.findIndex(c => c[0] === 'engine_job') + 1);
          SH.emit('job', { id: jid, kind: 'progress', pct: .4, text: 'Fixing 4 of 10' });
          await tick(1600);
          const mid = SH.activity.of('optimizer');
          SH.emit('job', { id: jid, kind: 'end', state: 'done', result: { ok: true } });
          await p; await tick(400);
          // a job of a module that already follows something adds nothing
          const own = SH.activity.start('drivers', { label: 'Looking for new drivers' });
          SH.job('drivers', 'delete_backup', ['x'], { bg: true });
          await tick(20);
          out({ mid, toasts: toasts.map(t => t.text), list: SH.activity.list().map(a => a.mod) });
        """)
        self.assertEqual(out["mid"]["label"], "Fixing entries")
        self.assertEqual(out["mid"]["text"], "Fixing 4 of 10")
        self.assertTrue(out["mid"]["bg"])
        self.assertEqual(out["toasts"], ["Super Optimizer finished."])
        self.assertEqual(out["list"], ["drivers"])

    def test_follow_a_promise(self):
        out = self.run_js(r"""
          SH.state.view = 'home';
          let ok, bad, gone;
          const p1 = new Promise(r => { ok = r; }), p2 = new Promise((_, r) => { bad = r; }), p3 = new Promise((_, r) => { gone = r; });
          const same = SH.activity.follow('drivers', p1, { key: 'list', label: 'Reading drivers again', go: { tab: 'all' }, summary: v => v.length + ' drivers', grace: 30 }) === p1;
          SH.activity.follow('hangar', p2, { key: 'scan', grace: 30 }).catch(() => {});
          SH.activity.follow('remover', p3, { key: 'list', grace: 30 }).catch(() => {});
          await tick(80);
          const running = SH.activity.list().filter(a => a.user).map(a => a.mod).sort();
          ok([1, 2, 3]); bad(new Error('winget broke')); gone(Object.assign(new Error('cancelled'), { cancelled: true }));
          await tick(50);
          out({ same, running, toasts: toasts.map(t => [t.text, t.kind]), left: SH.activity.list().length });
        """)
        self.assertTrue(out["same"])
        self.assertEqual(out["running"], ["drivers", "hangar", "remover"])
        self.assertEqual(out["toasts"], [["Driver Updater finished: 3 drivers", "success"], ["App Hangar could not finish: winget broke", "error"]])
        self.assertEqual(out["left"], 0)


class _FakeCom:
    def __init__(self, log, fail=0):
        self.log, self.fail = log, fail

    def apply(self, hwnd, state, value):
        if self.fail:
            self.fail -= 1
            raise OSError("E_FAIL")
        self.log.append((hwnd, state, value))

    def release(self):
        self.log.append("released")


def wait_for(cond, timeout=3.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.01)
    return False


class TaskbarHelper(unittest.TestCase):
    def test_normalize(self):
        self.assertEqual(taskbar.normalize("normal", 0.4567), ("normal", 0.457))
        self.assertEqual(taskbar.normalize("normal", 7), ("normal", 1.0))
        self.assertEqual(taskbar.normalize("normal", "x"), ("normal", 0.0))
        self.assertEqual(taskbar.normalize("normal", float("nan")), ("normal", 0.0))
        self.assertEqual(taskbar.normalize("indeterminate", 0.5), ("indeterminate", 0.0))
        self.assertEqual(taskbar.normalize("explode", 0.5), ("none", 0.0))

    def test_applies_the_latest_wish_on_its_own_thread(self):
        log = []
        tb = taskbar.TaskbarProgress(lambda: 42, factory=lambda: _FakeCom(log))
        self.assertTrue(tb.set("indeterminate"))
        self.assertTrue(wait_for(lambda: log))
        for v in (0.1, 0.2, 0.3):
            tb.set("normal", v)
        self.assertTrue(wait_for(lambda: log[-1] == (42, "normal", 0.3)))
        tb.stop()
        self.assertTrue(wait_for(lambda: log[-1] == "released"))

    def test_no_com_object_turns_it_off_quietly(self):
        def boom():
            raise OSError("class not registered")
        tb = taskbar.TaskbarProgress(lambda: 42, factory=boom)
        with mock.patch("builtins.print"):
            self.assertTrue(tb.set("normal", 0.5))
            self.assertTrue(wait_for(lambda: tb.dead))
        self.assertFalse(tb.set("normal", 0.6))

    def test_no_window_handle_waits_for_reapply(self):
        log, h = [], {"v": None}
        tb = taskbar.TaskbarProgress(lambda: h["v"], factory=lambda: _FakeCom(log))
        tb.set("normal", 0.5)
        time.sleep(0.15)
        self.assertEqual(log, [])
        h["v"] = 7
        tb.reapply()
        self.assertTrue(wait_for(lambda: log == [(7, "normal", 0.5)]))
        tb.reapply()  # the button was made again: the same state goes out once more
        self.assertTrue(wait_for(lambda: len(log) == 2))
        tb.stop()

    def test_a_handle_function_that_raises_is_harmless(self):
        def bad():
            raise RuntimeError("cross-thread")
        log = []
        tb = taskbar.TaskbarProgress(bad, factory=lambda: _FakeCom(log))
        tb.set("normal", 0.5)
        time.sleep(0.15)
        self.assertEqual(log, [])
        self.assertFalse(tb.dead)
        tb.stop()

    def test_repeated_failures_turn_it_off(self):
        log = []
        tb = taskbar.TaskbarProgress(lambda: 1, factory=lambda: _FakeCom(log, fail=99))
        with mock.patch("builtins.print"):
            for i in range(20):
                tb.set("normal", i / 20)
                time.sleep(0.01)
            self.assertTrue(wait_for(lambda: tb.dead))
        self.assertFalse(tb.set("none"))

    def test_one_failure_is_skipped(self):
        log = []
        tb = taskbar.TaskbarProgress(lambda: 1, factory=lambda: _FakeCom(log, fail=1))
        tb.set("normal", 0.2)
        time.sleep(0.1)
        tb.set("normal", 0.3)
        self.assertTrue(wait_for(lambda: (1, "normal", 0.3) in log))
        self.assertFalse(tb.dead)
        tb.stop()

    @unittest.skipUnless(os.name == "nt", "Windows only")
    def test_the_real_com_object_accepts_a_window_that_is_not_there(self):
        c = taskbar.ComTaskbar()
        try:
            c.apply(0, "none", 0)
        except OSError:
            pass  # refused is fine too: the worker skips it
        finally:
            c.release()


class ApiMethods(unittest.TestCase):
    def make(self):
        from stellarhub.api import Api
        a = Api()
        a._window = mock.Mock()
        return a

    def test_taskbar_progress_never_raises(self):
        a = self.make()
        with mock.patch("stellarhub.taskbar.TaskbarProgress", side_effect=RuntimeError("no")), mock.patch("builtins.print"):
            self.assertFalse(a.taskbar_progress("normal", 0.5))

    def test_hidden_window_has_no_handle(self):
        a = self.make()
        a._visible = False
        self.assertIsNone(a._taskbar_hwnd())
        a._visible = True
        a._window.native.Handle.ToInt64.return_value = 1234
        self.assertEqual(a._taskbar_hwnd(), 1234)

    def test_notify_activity_opens_the_module(self):
        a = self.make()
        a._tray = mock.Mock()
        sent = []
        a._js = lambda code, *x, **k: sent.append(code)
        a.show_main = mock.Mock()
        self.assertTrue(a.notify_activity("Storage Checker finished.", "storage", "map"))
        text, title = a._tray.notify.call_args[0]
        self.assertEqual((text, title), ("Storage Checker finished.", "StellarHub"))
        a._tray.notify.call_args[1]["on_click"]()
        a.show_main.assert_called_once()
        self.assertEqual(sent, ['window.SH && SH.activity && SH.activity.open("storage", {tab: "map"})'])

    def test_the_page_hears_when_the_window_is_hidden_or_shown(self):
        a = self.make()
        sent = []
        a._js = lambda code, *x, **k: sent.append(code)
        a._sampler = None
        with mock.patch("stellarhub.winmgr.wv_visible"):
            a._visible, a._minimized = True, False
            a._tele_refresh()
            a._tele_refresh()                      # no change: nothing more
            a._minimized = True
            a._tele_refresh()
            a._minimized, a._visible = False, False
            a._tele_refresh()                      # still out of sight
            a._visible = True
            a._tele_refresh()
        shown = [c for c in sent if "SH.emit('window'" in c]
        self.assertEqual(len(shown), 3)
        self.assertIn("shown: true", shown[0])
        self.assertIn("shown: false", shown[1])
        self.assertIn("shown: true", shown[2])

    def test_hidden_in_the_tray_the_page_is_asked_to_keep_its_memory_low(self):
        """Hidden in the tray, WebView2 is told to keep its memory low (measured: the process tree's working set
        went from ~660 MB to ~180-560 MB); a minimized window comes back often and keeps its memory."""
        a = self.make()
        a._js = lambda *x, **k: None
        a._sampler = None
        with mock.patch("stellarhub.winmgr.wv_visible") as vis:
            for visible, minimized in ((True, False), (True, True), (False, False)):
                a._visible, a._minimized = visible, minimized
                a._tele_refresh()
        main = [c for c in vis.call_args_list if c[0][0] is a._window]
        self.assertEqual([(c[0][1], c[1].get("trim", False)) for c in main], [(True, False), (False, False), (False, True)])

    def test_the_tray_says_why_administrator_mode_waits(self):
        from stellarhub.tray import Tray
        api = mock.Mock()
        t = Tray(api)
        t.icon = mock.Mock()
        api.relaunch_admin.return_value = "busy"
        with mock.patch("stellarhub.i18n.tr", side_effect=lambda text, **kw: text):
            t.to_admin()
        self.assertIn("still running", t.icon.notify.call_args[0][0])
        t.icon.notify.reset_mock()
        api.relaunch_admin.return_value = False  # Windows said no: nothing to add
        t.to_admin()
        t.icon.notify.assert_not_called()

    def test_notify_activity_rejects_odd_names(self):
        a = self.make()
        a._tray = mock.Mock()
        sent = []
        a._js = lambda code, *x, **k: sent.append(code)
        a.show_main = mock.Mock()
        a.notify_activity("x", "storage'); alert(1); ('", "map")
        a._tray.notify.call_args[1]["on_click"]()
        self.assertEqual(sent, [])
        a._tray = None
        self.assertFalse(a.notify_activity("x", "storage"))


class TrayClick(unittest.TestCase):
    def test_a_click_on_the_balloon_runs_the_last_notifications_action(self):
        from stellarhub import tray

        class Base:
            _icon_handle = 1

            def __init__(self):
                self.seen = []

            def _on_notify(self, wparam, lparam):
                self.seen.append(lparam)

        icon = tray._crisp_icon_class(Base)()
        done = threading.Event()
        icon._sh_click = done.set
        icon._on_notify(0, 0x405)          # NIN_BALLOONUSERCLICK
        self.assertTrue(done.wait(2))
        icon._on_notify(0, 0x0202)         # WM_LBUTTONUP: pystray's own handling
        self.assertEqual(icon.seen, [0x0202])

    def test_notify_keeps_the_click_action(self):
        from stellarhub import tray
        t = tray.Tray(mock.Mock())
        t.icon = mock.Mock()
        fn = lambda: None  # noqa: E731
        t.notify("done", on_click=fn)
        self.assertIs(t.icon._sh_click, fn)
        t.icon.notify.assert_called_once_with("done", "StellarHub")
        t.notify("plain")
        self.assertIsNone(t.icon._sh_click)


def _src(*p):
    with open(os.path.join(UI, *p), encoding="utf-8") as fh:
        return fh.read()


def _body(src, start):
    """The text of a block that starts at `start` (a function or method header ending in '{'), up to its closing brace."""
    i = src.index(start) + len(start) - 1
    depth = 0
    for j in range(i, len(src)):
        depth += {"{": 1, "}": -1}.get(src[j], 0)
        if depth == 0:
            return src[i:j + 1]
    raise AssertionError(start)


class OnDemand(unittest.TestCase):
    """2.0.0: opening a module or a tab starts no analysis (Storage's scan, Super Optimizer's analysis and measurements,
    Privacy's check, Program Updater's searches); the user's button does, with its sounds and activity. The old
    behaviour is a setting, off by default. (The sample-mode walk in a real browser checks the same from the outside.)"""

    def test_the_setting_exists_off_and_translated(self):
        core = _src("js", "core.js")
        self.assertIn("autoAnalyze: false", re.search(r"const DEFAULTS = \{.*?\n\};", core, re.S).group(0))
        self.assertIn("tog('autoAnalyze'", _src("js", "shell.js"))

    def test_opening_starts_nothing_unless_asked(self):
        st = _src("js", "modules", "storage.js")
        enter = _body(st, "  enterTab(tab) {")
        self.assertNotIn("runScan(", enter)                                     # the Map waits for Scan
        self.assertIn("SH.autoAnalyze()", _body(st, "async function openMap() {"))
        opt = _src("js", "modules", "optimizer.js")
        ov = _body(opt, "function renderOverview(el, ctx) {")
        self.assertIn("else if (SH.autoAnalyze()) analyze(el); else ovIdle(el);", ov)
        rt = _body(opt, "  async renderTab(tab, el, ctx) {")
        self.assertIn("SH.autoAnalyze()) analyzeTab(tab, true)", rt)
        self.assertEqual(re.findall(r"'(\w+)'", re.search(r"const AN_TABS = \[(.*?)\]", opt).group(1)), ["clean", "startup", "services", "registry"])
        pv = _src("js", "modules", "privacy.js")
        self.assertIn("if (!SH.autoAnalyze()) { notify('idle'); return; }", _body(pv, "async function start(force) {"))
        up = _src("js", "modules", "updater.js")
        self.assertNotIn("ensureScan", up)
        auto = _body(up, "function autoScan(...kinds) {")
        self.assertTrue(auto.startswith("{\n  if (!SH.autoAnalyze()) return;"), auto)
        for fn in ("renderOverview(el)", "renderApps(el)", "renderWindows(el)", "renderStore(el)", "renderRuntimes(el)", "renderDev(el)"):
            body = _body(up, f"function {fn} {{")
            self.assertNotRegex(body, r"\bscan(Apps|Windows|Dev)\(", fn)        # only through autoScan

    def test_the_buttons_are_the_users_with_their_sounds(self):
        opt = _src("js", "modules", "optimizer.js")
        an = _body(opt, "async function analyzeTab(tab, auto) {")
        self.assertIn("bg: !!auto", an)
        self.assertIn("if (!auto) SH.sound('scan_complete')", an)
        self.assertIn("SH.sound('scan_start'); analyzeTab(b.dataset.optAn)", opt)
        pv = _body(_src("js", "modules", "privacy.js"), "function checkNow(toast) {")
        self.assertIn("SH.sound('scan_start')", pv)
        self.assertNotIn("bg: true", pv)
        up = _body(_src("js", "modules", "updater.js"), "function checkDev() {")
        self.assertIn("scanDev(true, 'user')", up)
        st = _src("js", "modules", "storage.js")
        self.assertIn("SH.sound('scan_start'); runScan(true)", st)

    def test_cached_results_are_not_a_new_check(self):
        up = _src("js", "modules", "updater.js")
        self.assertIn("S.scanned && !S.fromCache.apps && !S.appsScanning", _body(up, "function publishPending() {"))
        pv = _src("js", "modules", "privacy.js")
        self.assertIn("!D.network._stale", _body(pv, "function netTick() {"))

    def test_new_sentences_are_translated(self):
        keys = set()
        for f in ("core.js", "shell.js", "modules/storage.js", "modules/optimizer.js", "modules/privacy.js", "modules/updater.js"):
            src = _src("js", *f.split("/"))
            keys |= {k for k in re.findall(r"(?<![\w.])(?:SH\.t|t|T)\('((?:[^'\\]|\\.)*)'", src)
                     if re.search(r"Last (analysis|check|scan): \{when\}|Not (analyzed|checked) yet|Analyze automatically|These results are from then|^Check now looks|^The check reads|See what takes up space", k)}
        self.assertGreaterEqual(len(keys), 15)
        for lang in ("es", "pt", "it", "fr", "zh", "ja", "ru"):
            d = {}
            for f in os.listdir(os.path.join(UI, "i18n", lang)):
                with open(os.path.join(UI, "i18n", lang, f), "rb") as fh:
                    raw = fh.read()
                self.assertFalse(raw.startswith(b"\xef\xbb\xbf"), f"{lang}/{f}")
                d.update(json.loads(raw.decode("utf-8")))
            self.assertEqual(sorted(k for k in keys if not d.get(k)), [], lang)
            for k in keys:
                self.assertEqual(sorted(re.findall(r"\{\w+\}", d[k])), sorted(re.findall(r"\{\w+\}", k)), (lang, k))


@unittest.skipUnless(shutil.which("node"), "needs Node.js")
class LastRun(unittest.TestCase):
    """SH.ago and SH.lastRun (core.js): the age of results kept from an earlier analysis and the strip above them."""
    run_js = Registry.run_js

    def test_ages_and_strip(self):
        out = self.run_js(r"""
          const now = Date.now(), m = 60e3, h = 3600e3, d = 864e5;
          const ages = [now - 20e3, now - 5 * m, now - 2 * h, now - 30 * h, now - 3 * d, 0].map(SH.ago);
          const strip = SH.lastRun({ when: now - 2 * h, title: 'Last check: {when}', text: 'From then', action: { label: 'Check now', data: 'data-x', icon: 'refresh' } });
          const plain = SH.lastRun({ when: now - 5 * m });
          const es = SH.emptyState({ art: 'first', title: 'T', action: { label: 'Go', pri: true, big: true } });
          out({ ages, strip, plain, es, auto: SH.autoAnalyze() });
        """)
        self.assertEqual(out["ages"], ["just now", "5 min ago", "2 h ago", "yesterday", "3 days ago", "never"])
        self.assertIn('Last check: <span class="lr-when"', out["strip"])
        self.assertIn(">2 h ago</span>", out["strip"])
        self.assertIn('<button class="btn pri sm" data-x>', out["strip"])
        self.assertIn("<span>From then</span>", out["strip"])
        self.assertIn("Last analysis: ", out["plain"])
        self.assertNotIn("<button", out["plain"])
        self.assertIn('class="btn pri"', out["es"])                              # big: a full-size primary button
        self.assertFalse(out["auto"])


if __name__ == "__main__":
    unittest.main()
