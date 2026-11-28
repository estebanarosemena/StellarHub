"""Autopilot's state file (last run, retry tomorrow) is shared by the scheduler's check and the runs: neither may erase
what the other saved. Routines started from an elevated StellarHub stay within the user's own reach. Everything lives
in a temp folder; nothing runs for real."""
import json
import os
import shutil
import tempfile
import threading
import time
import types
import unittest
from unittest import mock

from stellarhub.engine import autopilot


class TickKeepsWhatARunSaved(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="sh_test_")
        self.addCleanup(shutil.rmtree, self.dir, True)
        sp = os.path.join(self.dir, "settings.json")
        with open(sp, "w", encoding="utf-8") as fh:
            json.dump({"autopilotRoutines": [{"id": "r1", "name": "R", "acts": [{"k": "wait"}],
                                              "triggers": [{"k": "daily", "p": {"time": "03:00"}}]}],
                       "autopilotNotify": {"weekly": False, "noGame": False}}, fh)
        for p in (mock.patch.object(autopilot, "_settings_path", return_value=sp),
                  mock.patch.object(autopilot, "fullscreen_state", return_value=0)):
            p.start()
            self.addCleanup(p.stop)

    def test_a_run_ending_during_the_check_keeps_its_record(self):
        writer = {}

        def run_ends():  # what run() does when a routine finishes (on its job thread)
            with autopilot._lock:
                s = autopilot._state()
                s["last"]["r1"] = 12345.0
                s.setdefault("retry", {})["r1"] = time.time() + 86400
                autopilot._save_state(s)

        def triggers(r, st, now, ctx):  # the check is busy (reading triggers) when the run ends
            t = writer["t"] = threading.Thread(target=run_ends)
            t.start()
            t.join(0.5)
            return None
        with mock.patch.object(autopilot, "_check_triggers", side_effect=triggers):
            autopilot._tick()
        writer["t"].join(5)
        st = autopilot._state()
        self.assertEqual(st["last"].get("r1"), 12345.0)
        self.assertIn("r1", st.get("retry") or {})


class OneOddRoutine(unittest.TestCase):
    """The routines file can be edited by any program running as the user: one routine whose condition can't be read
    (days written as text) must not stop the check of all the others, nor the saving of the state."""

    def test_the_other_routines_still_run(self):
        d = tempfile.mkdtemp(prefix="sh_test_")
        self.addCleanup(shutil.rmtree, d, True)
        sp = os.path.join(d, "settings.json")
        with open(sp, "w", encoding="utf-8") as fh:
            json.dump({"autopilotRoutines": [
                {"id": "odd", "name": "Odd", "acts": [{"k": "wait"}], "triggers": [{"k": "daily"}],
                 "conds": [{"k": "days", "p": {"days": "135"}}]},
                {"id": "ok", "name": "OK", "acts": [{"k": "wait"}], "triggers": [{"k": "daily"}]}],
                "autopilotNotify": {"weekly": False, "noGame": False}}, fh)
        with mock.patch.object(autopilot, "_settings_path", return_value=sp), \
                mock.patch.object(autopilot, "fullscreen_state", return_value=0), \
                mock.patch.object(autopilot, "_check_triggers", return_value=autopilot._m("it's time")), \
                mock.patch.object(autopilot, "_enqueue") as enq, \
                mock.patch.object(autopilot, "_save_state") as save:
            autopilot._tick()
        self.assertEqual([c.args[0] for c in enq.call_args_list], ["ok"])
        save.assert_called_once()


class ElevatedRoutines(unittest.TestCase):
    """Routines live in a file any program running as the user can edit: from an elevated StellarHub they must not
    reach beyond the user's own programs, nor run "as you" with administrator rights."""

    class Job:
        cancelled = False

        def __init__(self):
            self.lines = []

        def log(self, line):
            self.lines.append(line)

        def check(self):
            pass

    def proc(self, pid, name, user, exe):
        p = mock.Mock(pid=pid, info={"name": name})
        p.username.return_value = user
        p.exe.return_value = exe
        return p

    def test_close_app_only_ends_the_users_own_programs(self):
        me = "PC\\ana"
        mine = self.proc(10, "spotify.exe", me, "C:\\Users\\ana\\AppData\\Roaming\\Spotify\\Spotify.exe")
        other = self.proc(11, "spotify.exe", "PC\\bob", "C:\\Users\\bob\\AppData\\Roaming\\Spotify\\Spotify.exe")
        system = self.proc(12, "winlogon.exe", me, "C:\\Windows\\System32\\winlogon.exe")

        def windir(buf, n):
            buf.value = "C:\\Windows"
            return 10
        with mock.patch.object(autopilot.psutil, "process_iter", return_value=[mine, other, system]), \
                mock.patch.object(autopilot, "_me", return_value=me), mock.patch.object(autopilot.psutil, "wait_procs"), \
                mock.patch.object(autopilot.ctypes.windll.kernel32, "GetSystemWindowsDirectoryW", side_effect=windir):
            self.assertEqual(autopilot._act(self.Job(), {"k": "closeApp", "p": {"app": "spotify"}}, {})[0], "ok")
            autopilot._act(self.Job(), {"k": "closeApp", "p": {"app": "winlogon"}}, {})
        mine.terminate.assert_called_once()
        other.terminate.assert_not_called()
        system.terminate.assert_not_called()

    def test_a_command_as_you_is_not_run_elevated(self):
        a = {"k": "cmd", "p": {"cmd": "echo hi", "as": "user"}}
        with mock.patch.object(autopilot, "_admin", return_value=True), \
                mock.patch.object(autopilot, "_approved_load", return_value={autopilot._action_hash(a)}), \
                mock.patch.object(autopilot.subprocess, "run") as run:
            out = autopilot._act(self.Job(), a, {"after": {}})
            note = autopilot.dry_run({"acts": [a]})["acts"][0]["noteM"]
        self.assertEqual(out[0], "skip")
        self.assertIn("running as administrator", autopilot._en(out[1]))
        self.assertIn("runs as you", autopilot._en(note))
        self.assertFalse([c for c in run.call_args_list if c[0] and c[0][0][:1] == ["cmd.exe"]])

    def test_command_output_in_this_windows_code_page_is_readable(self):
        text = "Configuración"
        try:
            oem = text.encode("oem")
        except UnicodeEncodeError:  # Russian OEM (866) cannot encode Spanish accented letters
            text = "Настройка"
            oem = text.encode("oem")
        job = self.Job()
        with mock.patch.object(autopilot, "_admin", return_value=False), \
                mock.patch.object(autopilot.subprocess, "run", return_value=types.SimpleNamespace(stdout=oem, returncode=0)):
            out = autopilot._act(job, {"k": "cmd", "p": {"cmd": "echo x"}}, {"after": {}})
        self.assertEqual(out[0], "ok")
        self.assertEqual(job.lines, [text])


if __name__ == "__main__":
    unittest.main()
