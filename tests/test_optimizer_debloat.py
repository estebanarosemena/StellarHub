"""Super Optimizer: console output parsing (SFC, DISM, chkdsk) and the Debloat tweaks/catalog, without touching
the real registry, apps or system (a fake registry and temporary state folder)."""
import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

from stellarhub.engine import debloat as D
from stellarhub.engine import optimizer as O
from stellarhub.i18n import CODES


def feed_all(raw, step=7, oem="cp850"):
    cs = O.ConsoleStream(oem)
    ev = []
    for i in range(0, len(raw), step):
        ev += cs.feed(raw[i:i + step])
    ev += cs.close()
    return cs, ev


SFC = ("\r\nBeginning system scan.  This process will take some time.\r\n\r\n"
       "Beginning verification phase of system scan.\r\n"
       + "".join(f"Verification {p}% complete.\r" for p in (0, 1, 5, 41, 67, 99, 100)) + "\n\r\n"
       "Windows Resource Protection did not find any integrity violations.\r\n")
DISM = ("\r\nDeployment Image Servicing and Management tool\r\nVersión: 10.0.26100.1\r\n\r\nImage Version: 10.0.26200.7171\r\n\r\n"
        "[                           0.0%                           ]\r"
        "[==                         4.3%                           ]\r"
        "[==========================62.3%                          ]\r"
        "[==========================100.0%==========================]\r\n"
        "The restore operation completed successfully.\r\nThe operation completed successfully.\r\n")
CHKDSK = ("The type of the file system is NTFS.\r\n\r\nStage 1: Examining basic file system structure ...\r\n"
          "Progress: 0 of 1203456 done; Stage:  0%; Total:  0%; ETA:   0:01:12      \r"
          "Progress: 52480 of 1203456 done; Stage:  4%; Total:  2%; ETA:   0:01:10 .    \r"
          "Progress: 1203456 of 1203456 done; Stage: 100%; Total: 37%; ETA:   0:00:40 ...  \r\n"
          "  1203456 file records processed.\r\n")


class ConsoleParsing(unittest.TestCase):
    def test_sfc_utf16_without_bom_in_odd_chunks(self):
        cs, ev = feed_all(SFC.encode("utf-16-le"), step=7)
        self.assertEqual(cs.encoding, "utf-16-le")
        lines = [t for k, t in ev if k == "line"]
        live = [t for k, t in ev if k == "live"]
        self.assertIn("Beginning verification phase of system scan.", lines)
        self.assertIn("Windows Resource Protection did not find any integrity violations.", lines)
        self.assertEqual(live[0], "Verification 0% complete.")
        self.assertIn("Verification 41% complete.", live)
        # the % updates are rewritten in place, they never become log lines
        self.assertFalse(any("Verification 41%" in t for t in lines))
        self.assertEqual(O.parse_pct(live[-1]), .99)
        self.assertIn("Verification 100% complete.", lines)  # the last one ends with 


    def test_sfc_utf16_with_bom_and_single_byte_reads(self):
        cs, ev = feed_all(b"\xff\xfe" + SFC.encode("utf-16-le"), step=1)
        self.assertTrue(cs.encoding.startswith("utf-16"))
        self.assertIn("Beginning system scan.  This process will take some time.", [t for k, t in ev if k == "line"])
        self.assertFalse(any("\ufeff" in t for _, t in ev))

    def test_peek_shows_a_percentage_not_yet_rewritten(self):
        cs = O.ConsoleStream()
        cs.feed("Beginning verification phase of system scan.\r\nVerification 12% comp".encode("utf-16-le"))
        self.assertEqual(cs.peek(), "Verification 12% comp")
        self.assertAlmostEqual(O.parse_pct(cs.peek()), .12)

    def test_dism_oem_codepage_and_bars(self):
        cs, ev = feed_all(DISM.encode("cp850"), step=5, oem="cp850")
        self.assertEqual(cs.encoding, "cp850")
        lines = [t for k, t in ev if k == "line"]
        self.assertIn("Versión: 10.0.26100.1", lines)
        bars = [t for _, t in ev if O.is_bar(t)]
        self.assertEqual([round(O.parse_pct(b), 3) for b in bars], [0.0, .043, .623, 1.0])
        self.assertFalse(O.is_bar("The restore operation completed successfully."))
        self.assertIn("The operation completed successfully.", lines)

    def test_chkdsk_total_is_the_last_percentage(self):
        _, ev = feed_all(CHKDSK.encode("cp437"), step=11, oem="cp437")
        live = [t for k, t in ev if k == "live"]
        self.assertEqual([O.parse_pct(t) for t in live], [0.0, .02])
        lines = [t for k, t in ev if k == "line"]
        self.assertAlmostEqual(O.parse_pct([t for t in lines if t.startswith("Progress")][0]), .37)
        self.assertIn("1203456 file records processed.", lines)

    def test_localized_and_comma_decimals(self):
        self.assertAlmostEqual(O.parse_pct("Comprobación 23% completada."), .23)
        self.assertAlmostEqual(O.parse_pct("[====   38,4%   ]"), .384)
        self.assertIsNone(O.parse_pct("no number here"))
        self.assertIsNone(O.parse_pct("1500%"))

    def test_chinese_sfc_and_short_outputs(self):
        zh = "开始系统扫描。此过程将需要一些时间。\r\n验证 37% 已完成。\r验证 38% 已完成。\r"
        cs, ev = feed_all(zh.encode("utf-16-le"), step=3)
        self.assertEqual(cs.encoding, "utf-16-le")
        self.assertEqual(ev[0], ("line", "开始系统扫描。此过程将需要一些时间。"))
        self.assertAlmostEqual(O.parse_pct(ev[-1][1]), .38)
        cs, ev = feed_all(b"ok\r\n", step=1)  # fewer bytes than needed to decide: decided on close
        self.assertEqual((cs.encoding, ev), ("cp850", [("line", "ok")]))

    def test_lone_cr_at_the_end_of_a_chunk_is_not_a_rewrite(self):
        cs = O.ConsoleStream()
        a = cs.feed(b"first line\r")
        b = cs.feed(b"\nsecond\r\n")
        self.assertEqual(a + b, [("line", "first line"), ("line", "second")])


class FakeReg:
    """In-memory registry with the WinReg interface. fail: value names whose write raises."""

    def __init__(self, fail=()):
        self.keys = set()
        self.vals = {}
        self.fail = set(fail)

    def _k(self, hive, key):
        return (hive, key.lower())

    def key_exists(self, hive, key):
        return self._k(hive, key) in self.keys

    def get(self, hive, key, name):
        return self.vals.get(self._k(hive, key) + (name.lower(),))

    def set(self, hive, key, name, typ, data):
        if name in self.fail:
            raise PermissionError(5, "Access is denied")
        parts = key.split("\\")
        for i in range(1, len(parts) + 1):
            self.keys.add(self._k(hive, "\\".join(parts[:i])))
        self.vals[self._k(hive, key) + (name.lower(),)] = (typ, data)

    def delete(self, hive, key, name):
        self.vals.pop(self._k(hive, key) + (name.lower(),), None)

    def delete_key_if_empty(self, hive, key):
        k = self._k(hive, key)
        if any(v[:2] == k for v in self.vals) or any(x != k and x[0] == hive and x[1].startswith(k[1] + "\\") for x in self.keys):
            return False
        self.keys.discard(k)
        return True

    def seed(self, hive, key, name, typ, data):
        self.set(hive, key, name, typ, data)


T = {t["id"]: t for t in D.TWEAKS}


class Tweaks(unittest.TestCase):
    def test_definitions(self):
        ids = [t["id"] for t in D.TWEAKS]
        self.assertEqual(len(ids), len(set(ids)))
        groups = {g for g, _ in D.GROUPS}
        for t in D.TWEAKS:
            self.assertIn(t["g"], groups)
            self.assertTrue(t["v"])
            for v in t["v"]:
                self.assertIn(v["hive"], (D.HKCU, D.HKLM))
                self.assertIn(v["type"], (D.DW, D.SZ))
                self.assertNotEqual(v["value"], v["default"], t["id"])
                # privacy toggles belong to the Privacy & Security module
                for word in ("AllowTelemetry", "AdvertisingInfo", "TailoredExperiences", "ActivityHistory", "DiagTrack"):
                    self.assertNotIn(word.lower(), (v["key"] + v["name"]).lower())

    def test_round_trip_restores_missing_values_and_created_keys(self):
        reg = FakeReg()
        tw = T["classic_menu"]
        self.assertEqual(D.tweak_state(tw, reg)[0], "on")
        rec = D.apply_tweak(tw, reg)
        self.assertEqual(D.tweak_state(tw, reg)[0], "off")
        self.assertTrue(reg.key_exists("HKCU", r"Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\InprocServer32"))
        rec = json.loads(json.dumps(rec))  # the backup survives being saved to disk
        self.assertEqual(D.undo_tweak(rec, reg), [])
        self.assertEqual(D.tweak_state(tw, reg)[0], "on")
        self.assertEqual(reg.vals, {})
        self.assertEqual(reg.keys, set())

    def test_round_trip_keeps_existing_values_and_types(self):
        reg = FakeReg()
        cdm = r"Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager"
        reg.seed("HKCU", cdm, "SilentInstalledAppsEnabled", "dword", 1)
        reg.seed("HKCU", cdm, "Other", "sz", "untouched")
        rec = D.apply_tweak(T["auto_install"], reg)
        self.assertEqual(reg.get("HKCU", cdm, "SilentInstalledAppsEnabled"), ("dword", 0))
        D.undo_tweak(rec, reg)
        self.assertEqual(reg.get("HKCU", cdm, "SilentInstalledAppsEnabled"), ("dword", 1))
        self.assertIsNone(reg.get("HKCU", cdm, "OemPreInstalledAppsEnabled"))
        self.assertEqual(reg.get("HKCU", cdm, "Other"), ("sz", "untouched"))
        self.assertTrue(reg.key_exists("HKCU", cdm))

    def test_a_failed_write_rolls_back_the_rest(self):
        reg = FakeReg(fail={"ShowCopilotButton"})
        with self.assertRaises(OSError):
            D.apply_tweak(T["copilot"], reg)
        self.assertEqual(reg.vals, {})

    def test_default_without_backup(self):
        reg = FakeReg()
        adv = r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"
        reg.seed("HKCU", adv, "HideFileExt", "dword", 0)
        D.default_tweak(T["extensions"], reg)
        self.assertEqual(reg.get("HKCU", adv, "HideFileExt"), ("dword", 1))
        reg.seed("HKCU", adv, "TaskbarAl", "dword", 0)
        D.default_tweak(T["tb_left"], reg)
        self.assertIsNone(reg.get("HKCU", adv, "TaskbarAl"))

    def test_present(self):
        self.assertTrue(D.present(T["tb_chat"], build=22621))
        self.assertFalse(D.present(T["tb_chat"], build=26200))
        self.assertTrue(D.present(T["recall"], build=26200, recall=True))
        self.assertFalse(D.present(T["recall"], build=26200, recall=False))
        self.assertFalse(D.present(T["recall"], build=22631, recall=True))


class TweakJobs(unittest.TestCase):
    """apply / tweak_undo / undo_all with the fake registry and a temporary state folder."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="sh_debloat_")
        self.p = mock.patch.object(D, "STATE_DIR", self.dir)
        self.p.start()

    def tearDown(self):
        self.p.stop()
        shutil.rmtree(self.dir, ignore_errors=True)

    class Job:
        cancelled = False

        def progress(self, *a, **k):
            pass

        def log(self, line):
            pass

        def check(self):
            pass

    def test_apply_then_undo_one_and_all(self):
        reg = FakeReg()
        with mock.patch.object(D, "_admin", return_value=False):
            r = D.apply(self.Job(), {"tweaks": ["tb_left", "search_highlights", "web_search", "widgets"]}, reg=reg)
            self.assertEqual(sorted(r["tweaks"]), ["search_highlights", "tb_left"])
            # HKLM and HKCU\Software\Policies (read-only for ordinary users) need administrator mode
            self.assertEqual(r["skippedAdmin"], ["web_search", "widgets"])
            self.assertTrue(r["explorer"])
            listed = {x["id"]: x for x in D.tweaks_list(reg)["items"]}
            self.assertEqual(listed["tb_left"]["state"], "off")
            self.assertTrue(listed["tb_left"]["ours"])
            self.assertFalse(listed["widgets"]["ours"])
            self.assertEqual(D.tweak_undo("tb_left", reg)["ok"], True)
            self.assertEqual(D.tweak_state(T["tb_left"], reg)[0], "on")
            self.assertEqual(D.tweak_undo("widgets", reg), {"needAdmin": True})
            self.assertEqual(D.tweak_undo("web_search", reg), {"needAdmin": True})
            u = D.undo_all(self.Job(), reg=reg)
            self.assertEqual(u["tweaks"], ["search_highlights"])
        self.assertEqual(reg.vals, {})
        self.assertEqual(D.history(), {"tweaks": [], "apps": []})

    def test_applying_twice_keeps_the_first_backup(self):
        reg = FakeReg()
        adv = r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"
        reg.seed("HKCU", adv, "Hidden", "dword", 2)
        with mock.patch.object(D, "_admin", return_value=False):
            D.apply(self.Job(), {"tweaks": ["hidden"]}, reg=reg)
            D.apply(self.Job(), {"tweaks": ["hidden"]}, reg=reg)
            D.tweak_undo("hidden", reg)
        self.assertEqual(reg.get("HKCU", adv, "Hidden"), ("dword", 2))

    def test_a_failed_undo_keeps_the_backup_to_try_again(self):
        adv = r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"
        for undo in (lambda reg: D.tweak_undo("hidden", reg), lambda reg: D.undo_all(self.Job(), reg=reg)):
            reg = FakeReg()
            reg.seed("HKCU", adv, "Hidden", "dword", 2)
            with mock.patch.object(D, "_admin", return_value=False):
                D.apply(self.Job(), {"tweaks": ["hidden"]}, reg=reg)
                reg.fail.add("Hidden")              # Windows refuses the write this time
                undo(reg)
                self.assertIn("hidden", D.history()["tweaks"])
                reg.fail.clear()
                D.tweak_undo("hidden", reg)         # the user's own value, not Windows' default
            self.assertEqual(reg.get("HKCU", adv, "Hidden"), ("dword", 2))
            self.assertNotIn("hidden", D.history()["tweaks"])


class Catalog(unittest.TestCase):
    def test_matching(self):
        self.assertEqual(D.catalog_entry("king.com.CandyCrushSodaSaga")["g"], "safe")
        self.assertEqual(D.catalog_entry("Microsoft.HEVCVideoExtension")["g"], "keep")
        self.assertEqual(D.catalog_entry("Microsoft.WindowsStore")["g"], "keep")
        self.assertEqual(D.catalog_entry("Microsoft.BingWeather")["n"], "Weather")
        self.assertIsNone(D.catalog_entry("Contoso.SomethingElse"))
        names = [c["m"] for c in D.CATALOG]
        self.assertEqual(len(names), len(set(n.lower() for n in names)))
        for c in D.CATALOG:
            self.assertIn(c["g"], ("safe", "choice", "keep"))
            if c.get("store"):
                D.winget_args(c["store"])  # valid product ids

    def test_scripts_only_take_package_names(self):
        s = D.remove_script("Microsoft.BingNews_4.1.0.0_x64__8wekyb3d8bbwe", "Microsoft.BingNews", True)
        self.assertIn("Remove-AppxPackage -Package 'Microsoft.BingNews_4.1.0.0_x64__8wekyb3d8bbwe'", s)
        self.assertIn("Remove-AppxProvisionedPackage -Online", s)
        self.assertNotIn("Provisioned", D.remove_script("A.B_1_x64__abc", "A.B", False))
        for bad in ("x'; Remove-Item C:\\ -Recurse; '", "a$(calc)", "a`b", "a\nb"):
            with self.assertRaises(ValueError):
                D.remove_script(bad, "A", False)
        with self.assertRaises(ValueError):
            D.register_script("C:\\x'; calc; '\\AppxManifest.xml")
        self.assertIn("-Register 'C:\\Program Files\\WindowsApps\\A_1\\AppxManifest.xml'",
                      D.register_script("C:\\Program Files\\WindowsApps\\A_1\\AppxManifest.xml"))
        with self.assertRaises(ValueError):
            D.winget_args("9WZ; calc")

    def test_restore_plan(self):
        self.assertEqual(D.restore_plan({"store": "9WZDNCRFJ3Q2"}, True), "register")
        self.assertEqual(D.restore_plan({"store": "9WZDNCRFJ3Q2"}, False), "store")
        self.assertEqual(D.restore_plan({"family": "A_8wekyb3d8bbwe"}, False), "store")
        self.assertEqual(D.restore_plan({"gone": True, "family": "A_x"}, False), "none")
        self.assertEqual(D.restore_plan({"gone": True}, True), "register")


class Translations(unittest.TestCase):
    """Every catalog and tweak text the engine shows is translated in every language."""

    def test_debloat_texts_are_translated(self):
        base = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "stellarhub", "ui", "i18n")
        keys = {c["n"] for c in D.CATALOG} | {c["d"] for c in D.CATALOG} | {t["t"] for t in D.TWEAKS} | \
            {t["d"] for t in D.TWEAKS} | {n for _, n in D.GROUPS}
        for lang in (code for code in CODES if code != "en"):
            merged = {}
            folder = os.path.join(base, lang)
            for f in os.listdir(folder):
                if f.endswith(".json"):
                    with open(os.path.join(folder, f), encoding="utf-8") as fh:
                        merged.update(json.load(fh))
            missing = sorted(k for k in keys if not merged.get(k))
            self.assertEqual(missing, [], f"{lang}: {missing[:5]}")


if __name__ == "__main__":
    unittest.main()
