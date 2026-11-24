"""What the installer and the build promise, checked from their sources: per-user by default, no update task made
at install time, a complete version resource and manifest on StellarHub.exe, and a compiled PyInstaller bootloader
in release builds."""
import os
import re
import sys
import unittest
import xml.etree.ElementTree as ET

from stellarhub.i18n import CODES

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8-sig") as fh:
        return fh.read()


class Installer(unittest.TestCase):
    ISS = read("packaging", "StellarHub.iss")

    def test_russian_uses_the_installer_language_and_keeps_the_app_language(self):
        self.assertIn('Name: "russian"; MessagesFile: "compiler:Languages\\Russian.isl"', self.ISS)
        self.assertIn("7: Result := 'ru';", self.ISS)
        self.assertIn(f"for I := 0 to {len(CODES) - 1} do", self.ISS)
        self.assertIn("else if WizardLanguage = 'russian' then Result := 'ru'", self.ISS)
        self.assertIn("LangCombo.Items.Add('Русский');", self.ISS)
        russian = set(re.findall(r"(?m)^russian\.(\w+)=", self.ISS))
        english = set(re.findall(r"(?m)^english\.(\w+)=", self.ISS))
        self.assertEqual(russian, english)

    def test_installs_for_the_current_user_unless_the_user_chooses_otherwise(self):
        self.assertRegex(self.ISS, r"(?m)^PrivilegesRequired=lowest\s*$")
        self.assertRegex(self.ISS, r"(?m)^PrivilegesRequiredOverridesAllowed=dialog commandline\s*$")
        self.assertRegex(self.ISS, r"(?m)^DefaultDirName=\{autopf\}\\{#AppName\}\s*$")  # %LOCALAPPDATA%\Programs per user
        self.assertNotRegex(self.ISS, r"(?m)^UsePreviousPrivileges=no")  # an all-users install upgrades in place

    def test_the_installer_no_longer_creates_the_update_task(self):
        code = "\n".join(line for line in self.ISS.splitlines() if not line.lstrip().startswith((";", "{")))
        self.assertNotIn("--update-task", code)
        self.assertNotIn("schtasks", code)

    def test_what_stays(self):
        for needle in ("--admin-task", "--quit", "--uninstall-cleanup", "_internal.bak", "UninstallFilesDir={app}",
                       "/SELFUPDATE", "{param:SELFUPDATE|}"):
            self.assertIn(needle, self.ISS)


class ExeResources(unittest.TestCase):
    def test_version_resource_is_complete(self):
        sys.path.insert(0, os.path.join(ROOT, "packaging"))
        import tempfile
        import make_assets
        old = make_assets.OUT
        make_assets.OUT = tempfile.mkdtemp()
        try:
            make_assets.version_file()
            with open(os.path.join(make_assets.OUT, "version_info.txt"), encoding="utf-8") as fh:
                text = fh.read()
        finally:
            make_assets.OUT = old
        for key in ("CompanyName", "FileDescription", "FileVersion", "InternalName", "LegalCopyright", "OriginalFilename",
                    "ProductName", "ProductVersion"):
            self.assertRegex(text, rf"StringStruct\('{key}', '[^']+'\)")

    def test_manifest(self):
        root = ET.parse(os.path.join(ROOT, "packaging", "StellarHub.manifest")).getroot()
        text = read("packaging", "StellarHub.manifest")
        self.assertEqual(root.find(".//{*}requestedExecutionLevel").get("level"), "asInvoker")
        self.assertGreaterEqual(len(root.findall(".//{*}supportedOS")), 5)
        self.assertIn("<dpiAware", text)
        self.assertIn("StellarHub.manifest", read("packaging", "StellarHub.spec"))


class Bootloader(unittest.TestCase):
    def test_release_builds_compile_it_and_fail_on_a_silent_fallback(self):
        ps1, yml = read("packaging", "build.ps1"), read(".github", "workflows", "build.yml")
        self.assertIn("PYINSTALLER_COMPILE_BOOTLOADER", ps1)
        self.assertIn("--no-binary", ps1)
        self.assertIn("STELLARHUB_COMPILE_BOOTLOADER", ps1)
        self.assertIn("vswhere", ps1)
        self.assertIn("check_bootloader.py", ps1)
        self.assertIn("STELLARHUB_REQUIRE_COMPILED_BOOTLOADER=1", yml)
        self.assertIn("STELLARHUB_COMPILE_BOOTLOADER=1", yml)
        self.assertIn("check_bootloader.py", yml)
        pinned = re.search(r'\$pyi = "pyinstaller==([\d.]+)"', ps1)
        self.assertTrue(pinned, "PyInstaller stays pinned to one exact version")


if __name__ == "__main__":
    unittest.main()
