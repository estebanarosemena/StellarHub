"""Program Updater: winget table parsing, return codes and silent uninstall switches. They never run winget."""
import unittest

from stellarhub.engine import updater as u
from stellarhub.engine.removal import programs as pm

TABLE_ES = (
    "Nombre        Id          Versión   Disponible  Origen\n"
    "------------------------------------------------------\n"
    "日本語アプリ  Foo.Bar     1.0       2.0         winget\n"
    "Plain App     Plain.App   Unknown   3.1         winget\n"
    "2 actualizaciones disponibles.\n"
)


class WingetTable(unittest.TestCase):
    def test_wide_characters_keep_columns_aligned(self):
        rows = u.parse_table(TABLE_ES)
        self.assertEqual([r["id"] for r in rows], ["Foo.Bar", "Plain.App"])
        self.assertEqual(rows[0]["name"], "日本語アプリ")
        self.assertEqual(rows[0]["available"], "2.0")
        self.assertEqual(rows[1]["version"], "Unknown")

    def test_summary_line_is_not_a_row(self):
        self.assertEqual(len(u.parse_table(TABLE_ES)), 2)


class WingetCodes(unittest.TestCase):
    def test_codes_match_the_official_meanings(self):
        # these four were mapped to the wrong meaning before (returnCodes.md in microsoft/winget-cli)
        self.assertIn("hash", u.WINGET_CODES["0x8A150011"])
        self.assertIn("administrator", u.WINGET_CODES["0x8A150056"])
        self.assertIn("cancelled", u.WINGET_CODES["0x8A15010C"])
        self.assertIn("sign-in", u.WINGET_CODES["0x8A150077"])

    def test_restart_codes_count_as_installed(self):
        self.assertEqual(u.WINGET_REBOOT_OK, {"0x8A150109", "0x8A15010B"})


class SilentSwitches(unittest.TestCase):
    def test_squirrel_uninstalls_silently(self):
        cmd, quiet = pm.uninstall_command({"kind": "squirrel", "uninstall": r'"C:\x\Update.exe" --uninstall'}, quiet=True)
        self.assertTrue(quiet)
        self.assertTrue(cmd.endswith("--uninstall -s"))
        self.assertTrue(pm.can_quiet({"kind": "squirrel"}))


if __name__ == "__main__":
    unittest.main()


class StreamEnds(unittest.TestCase):
    """winget can start an installer that leaves a process holding the output pipe (Foxit's update service):
    the read must end when the command ends, not when the pipe closes."""

    def test_returns_when_command_exits_even_if_a_child_keeps_the_pipe(self):
        import sys
        import time
        code = ("import subprocess,sys;print('Starting package install...',flush=True);"
                "subprocess.Popen([sys.executable,'-c','import time;time.sleep(25)']);print('Successfully installed',flush=True)")
        t = time.monotonic()
        rc, out = u._stream([sys.executable, "-c", code])
        self.assertLess(time.monotonic() - t, 10)
        self.assertEqual(rc, 0)
        self.assertIn("Successfully installed", out)

    def test_timeout_kills(self):
        import sys
        import time
        t = time.monotonic()
        u._stream([sys.executable, "-c", "import time;time.sleep(30)"], timeout=2)
        self.assertLess(time.monotonic() - t, 8)


class WingetLanguages(unittest.TestCase):
    """winget prints its table headers in the Windows display language."""

    def test_headers_in_other_languages(self):
        fr = ("Nom                      ID                 Version Disponible Source\n" + "-" * 70 + "\n"
              "Git                      Git.Git            2.50.0  2.51.0     winget\n2 mises à niveau disponibles.\n")
        de = fr.replace("Nom ", "Name").replace("Disponible", "Verfügbar ").replace("Source", "Quelle")
        zh = "名称  ID       版本    可用    源\n" + "-" * 40 + "\nGit   Git.Git  2.50.0  2.51.0  winget\n1 升级可用。\n"
        ru = "Имя   ИД       Версия  Доступно Источник\n" + "-" * 40 + "\nGit   Git.Git  2.50.0  2.51.0   winget\nДоступно обновлений: 1.\n"
        for text in (fr, de, zh, ru):
            rows = u.parse_table(text)
            self.assertEqual(len(rows), 1, text)
            self.assertEqual((rows[0]["name"], rows[0]["id"], rows[0]["available"], rows[0]["source"]), ("Git", "Git.Git", "2.51.0", "winget"))


class Defender(unittest.TestCase):
    """Defender's definitions update and its running mode, in any language. Nothing runs: the command is mocked."""

    class Job:
        cancelled = False

        def log(self, line):
            pass

    def update(self, code, out):
        from unittest import mock
        with mock.patch.object(u, "_stream", return_value=(code, out)):
            return u._defender_update(self.Job(), {}, lambda *a, **k: None)[0]

    def test_an_error_that_contains_ok_is_not_a_success(self):
        err = ("Update-MpSignature : Virus and spyware definitions update was completed with errors.\n"
               "    + CategoryInfo          : NotSpecified: (MSFT_MpSignature:ROOT\Microsoft\...MSFT_MpSignature) [Update-MpSignature], CimException\n"
               "    + FullyQualifiedErrorId : HRESULT 0x8050a004,Update-MpSignature\n"
               "At line:1 char:1 + Update-MpSignature -ErrorAction Stop; 'ok' (Invoke)\n")
        self.assertEqual(self.update(1, err), "fail")
        self.assertEqual(self.update(0, "ok\n"), "done")

    def test_running_mode_in_other_languages(self):
        for mode in ("Normal", "ejecución normal", "Normale", "EDR Block Mode", "Обычный режим"):
            self.assertTrue(u.defender_running(mode), mode)
        for mode in ("", None, "Passive Mode", "SxS Passive Mode", "Modo pasivo", "Modalità passiva", "Mode passif",
                     "Passiver Modus", "Not running", "No se está ejecutando", "Non in esecuzione",
                     "Пассивный режим", "Не выполняется", "Отключено"):
            self.assertFalse(u.defender_running(mode), mode)
