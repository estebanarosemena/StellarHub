"""Live Monitor's DNS switch: what counts as "automatic" DNS. PowerShell and netsh are mocked: nothing changes."""
import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

from stellarhub.engine import monitor as M


def fake_ps(dhcp_ip, name_server, servers):
    """PowerShell as Windows answers for an adapter: its IP from DHCP or not, the NameServer value typed by hand
    (empty: the DNS comes from DHCP) and the DNS servers in use."""
    def ps_json(script, timeout=None, as_list=False):
        if "Get-DnsClientServerAddress" in script:
            return list(servers)
        if "NameServer" in script:
            return name_server
        if "Get-NetIPInterface" in script:
            return 1 if dhcp_ip else 0
        raise AssertionError(script)
    return ps_json


class AutomaticDns(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.cmds = []

        def run(c, **k):
            self.cmds.append(" ".join(c))
            return mock.Mock(returncode=0, stdout=b"")
        for p in (mock.patch.object(M, "DNS_BACKUPS", self.tmp), mock.patch.object(M, "_admin", return_value=True),
                  mock.patch.object(M.subprocess, "run", side_effect=run)):
            p.start()
            self.addCleanup(p.stop)

    def test_dns_typed_by_hand_on_an_automatic_address_is_not_automatic(self):
        with mock.patch.object(M, "ps_json", side_effect=fake_ps(True, "9.9.9.9,149.112.112.112", ["9.9.9.9", "149.112.112.112"])):
            self.assertEqual(M._current_dns("Wi-Fi"), (False, ["9.9.9.9", "149.112.112.112"]))
            r = M.set_dns("Wi-Fi", "auto")
        self.assertTrue(r["ok"])
        self.assertIsNotNone(r["backup"])  # it really changed: the user's servers were saved first
        self.assertTrue(any("source=dhcp" in c for c in self.cmds))
        with open(os.path.join(self.tmp, r["backup"] + ".json"), encoding="utf-8") as fh:
            saved = json.load(fh)
        self.assertFalse(saved["dhcp"])
        self.cmds.clear()
        self.assertTrue(M.dns_undo(r["backup"])["ok"])  # undo puts the user's own servers back, not "automatic"
        self.assertIn("address=9.9.9.9", self.cmds[0])
        self.assertIn("address=149.112.112.112", self.cmds[1])

    def test_dns_from_dhcp_is_automatic(self):
        with mock.patch.object(M, "ps_json", side_effect=fake_ps(True, "", ["192.168.1.1"])):
            self.assertEqual(M._current_dns("Wi-Fi"), (True, ["192.168.1.1"]))
            self.assertEqual(M.set_dns("Wi-Fi", "auto"), {"ok": True, "backup": None})
        self.assertEqual(self.cmds, [])

    def test_unreadable_adapter_changes_nothing(self):
        with mock.patch.object(M, "ps_json", side_effect=fake_ps(True, None, [])):
            self.assertIsNone(M._current_dns("Gone"))
            self.assertFalse(M.set_dns("Gone", "cloudflare")["ok"])
        self.assertEqual(self.cmds, [])


class PartialDnsChange(unittest.TestCase):
    """A second netsh command that fails leaves the first one's change in place: the error still carries the backup."""
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        for p in (mock.patch.object(M, "DNS_BACKUPS", self.tmp), mock.patch.object(M, "_admin", return_value=True)):
            p.start()
            self.addCleanup(p.stop)

    def test_second_command_fails_error_keeps_the_backup(self):
        # netsh's message as this console prints it: Spanish on a Western code page, Russian on a Cyrillic one
        msg, word = next((m, w) for m, w in (("El parámetro es incorrecto.", "parámetro"), ("Параметр задан неверно.", "Параметр"))
                         if m.encode("oem", "replace").decode("oem") == m)
        answers = iter([mock.Mock(returncode=0, stdout=b""), mock.Mock(returncode=1, stdout=msg.encode("oem"))])
        with mock.patch.object(M, "ps_json", side_effect=fake_ps(True, "", ["192.168.1.1"])),                 mock.patch.object(M.subprocess, "run", side_effect=lambda c, **k: next(answers)):
            r = M.set_dns("Wi-Fi", "cloudflare")
        self.assertFalse(r["ok"])
        self.assertIn(word, r["error"])   # the console's own code page, not a fixed cp850 guess
        self.assertTrue(os.path.isfile(os.path.join(self.tmp, r["backup"] + ".json")))

    def test_stuck_ipconfig_is_not_a_failure(self):
        def run(c, **k):
            if c[0] == "ipconfig":
                raise M.subprocess.TimeoutExpired(c, 10)
            return mock.Mock(returncode=0, stdout=b"")
        with mock.patch.object(M, "ps_json", side_effect=fake_ps(True, "", ["192.168.1.1"])),                 mock.patch.object(M.subprocess, "run", side_effect=run):
            r = M.set_dns("Wi-Fi", "google")
        self.assertTrue(r["ok"])
        self.assertTrue(r["backup"])

    def test_netsh_that_does_not_answer_is_an_error_not_a_crash(self):
        with mock.patch.object(M, "ps_json", side_effect=fake_ps(True, "", ["192.168.1.1"])),                 mock.patch.object(M.subprocess, "run", side_effect=M.subprocess.TimeoutExpired("netsh", 15)):
            r = M.set_dns("Wi-Fi", "google")
        self.assertFalse(r["ok"])
        self.assertTrue(r["backup"])


class AdaptersFromWmi(unittest.TestCase):
    """The Network tab's adapters come from WMI in this process (Get-NetIPConfiguration took ~3 s): the same rows."""
    ROWS = {
        "MSFT_NetAdapter": [
            {"Name": "Wi-Fi", "InterfaceDescription": "Realtek WiFi", "InterfaceIndex": 12, "InterfaceOperationalStatus": 1,
             "Hidden": False, "DeviceID": "{GUID-W}", "NetworkAddresses": ["EC3A567C5378"], "PermanentAddress": "EC3A567C5378",
             "Speed": 1201000000, "ReceiveLinkSpeed": 1201000000, "TransmitLinkSpeed": 1201000000, "NdisPhysicalMedium": 9},
            {"Name": "Ethernet", "InterfaceDescription": "Realtek GbE", "InterfaceIndex": 5, "InterfaceOperationalStatus": 2,
             "Hidden": False, "DeviceID": "{GUID-E}", "NetworkAddresses": None, "PermanentAddress": "30C599EC107E",
             "Speed": 0, "ReceiveLinkSpeed": 0, "TransmitLinkSpeed": 0, "NdisPhysicalMedium": 14},
            {"Name": "Conexión de área local* 8", "InterfaceDescription": "Wi-Fi Direct", "InterfaceIndex": 15,
             "InterfaceOperationalStatus": 1, "Hidden": True, "DeviceID": "{GUID-H}", "NetworkAddresses": None,
             "PermanentAddress": None, "Speed": None, "ReceiveLinkSpeed": None, "TransmitLinkSpeed": None, "NdisPhysicalMedium": None},
            {"Name": "Kaspersky VPN", "InterfaceDescription": "Kaspersky VPN", "InterfaceIndex": 16, "InterfaceOperationalStatus": 1,
             "Hidden": False, "DeviceID": None, "NetworkAddresses": None, "PermanentAddress": None,
             "Speed": None, "ReceiveLinkSpeed": 10 ** 10, "TransmitLinkSpeed": None, "NdisPhysicalMedium": 0}],
        "MSFT_NetIPAddress": [{"InterfaceIndex": 12, "IPAddress": "192.168.1.131", "Store": 1},
                              {"InterfaceIndex": 12, "IPAddress": "192.168.1.131", "Store": 0},
                              {"InterfaceIndex": 5, "IPAddress": "169.254.1.2", "Store": 1}],
        "MSFT_NetRoute": [{"InterfaceIndex": 12, "NextHop": "192.168.1.1", "Store": 1},
                          {"InterfaceIndex": 12, "NextHop": "192.168.1.254", "Store": 0}],
        "MSFT_DNSClientServerAddress": [{"InterfaceIndex": 12, "ServerAddresses": ["1.1.1.1", "1.0.0.1"]},
                                        {"InterfaceIndex": 16, "ServerAddresses": []}],
    }

    def test_rows(self):
        from stellarhub.engine import wmi
        with mock.patch.object(wmi, "query", side_effect=lambda ns, cls, props=None, where=None: self.ROWS[cls]),                 mock.patch.object(M, "_dns_from_dhcp", side_effect=lambda g: g == "{GUID-W}"):
            rows = M._net_wmi()
        self.assertEqual([r["alias"] for r in rows], ["Wi-Fi", "Kaspersky VPN"])   # down and hidden adapters left out
        w, v = rows
        self.assertEqual((w["ipv4"], w["gw"], w["dns"]), (["192.168.1.131"], ["192.168.1.1"], ["1.1.1.1", "1.0.0.1"]))
        self.assertEqual((w["mac"], w["speed"], w["media"], w["dhcpDns"], w["index"]),
                         ("EC-3A-56-7C-53-78", "1.2 Gbps", "Native 802.11", True, 12))
        self.assertEqual((v["mac"], v["speed"], v["media"], v["dhcpDns"], v["gw"], v["ipv4"]), ("", "10 Gbps", "Unspecified", False, [], []))

    def test_wmi_failure_falls_back_to_powershell(self):
        from stellarhub.engine import wmi
        with mock.patch.object(wmi, "query", side_effect=wmi.WmiError("no")),                 mock.patch.object(M, "ps_json", return_value=[{"alias": "Wi-Fi"}]) as ps:
            self.assertEqual(M._net_adapters(), [{"alias": "Wi-Fi"}])
        self.assertIn("Get-NetIPConfiguration", ps.call_args[0][0])

    def test_mac_text(self):
        self.assertEqual(M._mac("0A002700002B"), "0A-00-27-00-00-2B")
        self.assertEqual(M._mac(None), "")


if __name__ == "__main__":
    unittest.main()
