"""Safety of the temp cleaner. Every test builds its own folder tree (never the real %TEMP%).

Regression for the incident where the cleaner deleted ~47 GB of %TEMP% with a 1-hour margin, including working
folders of tools that were still running.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

from stellarhub.engine.removal import cleaner

DAY = 86400


def _touch(path, age_days=0.0, size=10):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(b"x" * size)
    t = time.time() - age_days * DAY
    os.utime(path, (t, t))


def _age_dirs(root, age_days):
    t = time.time() - age_days * DAY
    for cur, dirs, _files in os.walk(root, topdown=False):
        os.utime(cur, (t, t))


def _temp_cat(d):
    return {"t": {"id": "t", "label": "Temp", "group": "g", "globs": [d], "grace": True, "temp": True,
                  "default": True, "desc": ""}}


class TempCleanerSafety(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="sh_cleaner_")
        self.outside = tempfile.mkdtemp(prefix="sh_cleaner_out_")

    def tearDown(self):
        for j in getattr(self, "junctions", []):
            subprocess.run(["cmd", "/c", "rmdir", j], capture_output=True)
        shutil.rmtree(self.root, ignore_errors=True)
        shutil.rmtree(self.outside, ignore_errors=True)

    def _junction(self, link, target):
        subprocess.run(["cmd", "/c", "mklink", "/J", link, target], capture_output=True)
        self.junctions = getattr(self, "junctions", []) + [link]

    def _clean(self, **kw):
        with mock.patch.object(cleaner, "categories", return_value=_temp_cat(self.root)):
            return cleaner.clean(["t"], **kw)

    def test_default_grace_is_seven_days(self):
        self.assertEqual(cleaner.TEMP_GRACE_DAYS, 7)
        _touch(os.path.join(self.root, "three_days.tmp"), 3)
        _touch(os.path.join(self.root, "ten_days.tmp"), 10)
        r = self._clean(in_use={})
        self.assertTrue(os.path.exists(os.path.join(self.root, "three_days.tmp")))
        self.assertFalse(os.path.exists(os.path.join(self.root, "ten_days.tmp")))
        self.assertEqual(r["deleted"], 1)

    def test_days_option(self):
        _touch(os.path.join(self.root, "three_days.tmp"), 3)
        self._clean(in_use={}, days=1)
        self.assertFalse(os.path.exists(os.path.join(self.root, "three_days.tmp")))

    def test_whole_folder_kept_if_anything_inside_is_recent(self):
        work = os.path.join(self.root, "active_audit")
        for i in range(20):
            _touch(os.path.join(work, "old", f"f{i}.txt"), 30)
        _touch(os.path.join(work, "scripts", "leer.py"), 30)
        _touch(os.path.join(work, "log.txt"), 0.2)   # one recent file deep in the tree
        _age_dirs(work, 30)
        os.utime(os.path.join(work, "log.txt"), None)
        rows = cleaner.temp_entries(self.root, 7, in_use={})
        row = next(r for r in rows if r["name"] == "active_audit")
        self.assertEqual(row["status"], "recent")
        self._clean(in_use={})
        self.assertTrue(os.path.exists(os.path.join(work, "old", "f0.txt")))   # nothing inside was touched
        self.assertTrue(os.path.exists(os.path.join(work, "scripts", "leer.py")))

    def test_folder_in_use_by_a_running_process_is_kept(self):
        work = os.path.join(self.root, "busy_tool")
        _touch(os.path.join(work, "data.bin"), 30)
        _age_dirs(work, 30)
        p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"], cwd=work)
        try:
            time.sleep(0.5)
            rows = cleaner.temp_entries(self.root, 7)          # real detection with psutil
            row = next(r for r in rows if r["name"] == "busy_tool")
            self.assertEqual(row["status"], "in_use")
            self._clean()
            self.assertTrue(os.path.exists(os.path.join(work, "data.bin")))
        finally:
            p.kill()
            p.wait()

    def test_path_in_a_command_line_counts_as_in_use(self):
        work = os.path.join(self.root, "script_dir")
        _touch(os.path.join(work, "run.py"), 30)
        _age_dirs(work, 30)
        in_use = cleaner.in_use_paths(budget=0)
        in_use[cleaner._norm(os.path.join(work, "run.py"))] = "python.exe"
        rows = cleaner.temp_entries(self.root, 7, in_use=in_use)
        self.assertEqual(next(r for r in rows if r["name"] == "script_dir")["status"], "in_use")

    def test_excluded_folders_are_kept(self):
        for name in ("keepme", "other"):
            _touch(os.path.join(self.root, name, "a.txt"), 30)
        _age_dirs(self.root, 30)
        self._clean(in_use={}, exclude=["keepme"])
        self.assertTrue(os.path.exists(os.path.join(self.root, "keepme", "a.txt")))
        self.assertFalse(os.path.exists(os.path.join(self.root, "other")))   # emptied and removed

    def test_skipping_loose_files_keeps_folders_cleanable(self):
        _touch(os.path.join(self.root, "loose.tmp"), 30)
        _touch(os.path.join(self.root, "oldfolder", "a.txt"), 30)
        _age_dirs(os.path.join(self.root, "oldfolder"), 30)
        self._clean(in_use={}, exclude=[cleaner.LOOSE_TOKEN + self.root])
        self.assertTrue(os.path.exists(os.path.join(self.root, "loose.tmp")))
        self.assertFalse(os.path.exists(os.path.join(self.root, "oldfolder")))

    def test_junctions_are_never_followed(self):
        _touch(os.path.join(self.outside, "node_modules", "pkg", "index.js"), 30)
        _age_dirs(self.outside, 30)
        self._junction(os.path.join(self.root, "link_top"), self.outside)
        nested = os.path.join(self.root, "rev", "frontend")
        os.makedirs(nested)
        self._junction(os.path.join(nested, "node_modules"), os.path.join(self.outside, "node_modules"))
        _touch(os.path.join(self.root, "rev", "old.txt"), 30)
        _age_dirs(os.path.join(self.root, "rev"), 30)
        rows = cleaner.temp_entries(self.root, 7, in_use={})
        self.assertEqual(next(r for r in rows if r["name"] == "link_top")["status"], "link")
        rev = next(r for r in rows if r["name"] == "rev")
        self.assertEqual(rev["files"], 1)                       # the junction's contents are not counted
        self._clean(in_use={})
        self.assertTrue(os.path.exists(os.path.join(self.outside, "node_modules", "pkg", "index.js")))

    def test_measure_counts_only_what_will_be_deleted(self):
        _touch(os.path.join(self.root, "old", "a.bin"), 30, size=1000)
        _touch(os.path.join(self.root, "new", "b.bin"), 0, size=5000)
        _age_dirs(os.path.join(self.root, "old"), 30)
        size, count, rows = cleaner._measure(_temp_cat(self.root)["t"], 7, (), {})
        self.assertEqual((size, count), (1000, 1))
        self.assertEqual({r["name"]: r["status"] for r in rows}, {"old": "clean", "new": "recent"})

    def test_locked_files_are_skipped_once(self):
        f = os.path.join(self.root, "loose_locked.tmp")
        _touch(f, 30)
        fh = open(f, "rb")   # Python opens without FILE_SHARE_DELETE: Windows refuses to delete it
        try:
            t0 = time.monotonic()
            r = self._clean(in_use={})
            self.assertLess(time.monotonic() - t0, 5)
            self.assertEqual(r["skipped"], 1)
            self.assertTrue(os.path.exists(f))
        finally:
            fh.close()

    def test_progress_and_cancel(self):
        for i in range(1500):
            _touch(os.path.join(self.root, "big", f"f{i}.tmp"), 30)
        _age_dirs(self.root, 30)
        seen, flag = [], threading.Event()

        def on_progress(d):
            seen.append(d)
            if d["deleted"] > 0:
                flag.set()
        orig = cleaner._delete_list

        def slow(found, counter, cancel=None, label=""):   # slow the deletion down so Cancel lands mid-way
            def slow_cancel():
                time.sleep(0.005)
                return cancel() if cancel else False
            return orig(found, counter, slow_cancel, label)
        with mock.patch.object(cleaner, "_delete_list", slow):
            r = self._clean(in_use={}, on_progress=on_progress, cancel=lambda: flag.is_set() and len(seen) > 1)
        self.assertTrue(r["cancelled"])
        self.assertLess(r["deleted"], 1500)
        last = seen[-1]
        self.assertEqual(last["total"], 1500)
        for k in ("deleted", "freed", "rate", "eta", "current"):
            self.assertIn(k, last)

    def test_a_path_after_the_exe_in_a_command_line_counts_as_in_use(self):
        # psutil gives the command line as a list; joined, the exe's path swallowed every path after it
        work = os.path.join(self.root, "tool_work")
        _touch(os.path.join(work, "state.bin"), 30)
        _age_dirs(work, 30)
        proc = mock.Mock(pid=-1, info={"name": "tool.exe", "exe": None, "cwd": None,
                                       "cmdline": [r"C:\Tools\tool.exe", "--work=" + work]})
        proc.open_files.side_effect = OSError
        with mock.patch("psutil.process_iter", return_value=[proc]):
            in_use = cleaner.in_use_paths(budget=0)
        row = next(r for r in cleaner.temp_entries(self.root, 7, in_use=in_use) if r["name"] == "tool_work")
        self.assertEqual(row["status"], "in_use")

    def test_short_name_temp_root_still_sees_the_programs_using_it(self):
        # %TEMP% is often C:\Users\JOHNSM~1\...; processes report the long name: both must be the same folder
        import ctypes
        made = os.path.join(self.root, "A temp folder with a long name")
        _touch(os.path.join(made, "busy", "data.bin"), 30)
        _age_dirs(made, 30)
        # self.root comes from this process's own %TEMP%, itself a short name on some PCs (and on CI): the long form
        # must be long all the way, as processes report it, or the test compares two short spellings
        buf = ctypes.create_unicode_buffer(1024)
        n = ctypes.windll.kernel32.GetLongPathNameW(made, buf, 1024)
        long_root = buf.value if 0 < n < 1024 else made
        work = os.path.join(long_root, "busy")
        buf = ctypes.create_unicode_buffer(1024)
        n = ctypes.windll.kernel32.GetShortPathNameW(long_root, buf, 1024)
        short_root = buf.value if 0 < n < 1024 else long_root
        if "~" not in short_root:
            self.skipTest("8.3 names are turned off on this drive")
        rows = cleaner.temp_entries(short_root, 7, in_use={os.path.normcase(os.path.join(work, "data.bin")): "x.exe"})
        self.assertEqual(next(r for r in rows if r["name"] == "busy")["status"], "in_use")
        rows = cleaner.temp_entries(long_root, 7, in_use={cleaner._norm(os.path.join(short_root, "busy")): "x.exe"})
        self.assertEqual(next(r for r in rows if r["name"] == "busy")["status"], "in_use")

    def test_walk_does_not_deadlock_on_unexpected_error(self):
        import threading
        done = threading.Event()
        def run():
            with mock.patch.object(cleaner, "_list_dir", side_effect=RuntimeError("boom")):
                cleaner._walk([self.root], grace=0, workers=2)
            done.set()
        t = threading.Thread(target=run, daemon=True)
        t.start()
        self.assertTrue(done.wait(timeout=3.0), "_walk deadlocked when _list_dir raised an unexpected exception")


if __name__ == "__main__":
    unittest.main()
