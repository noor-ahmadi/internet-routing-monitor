import gzip
import json
from pathlib import Path
import struct
import tempfile
import unittest

from ris_replay import (BASELINE, END, PREFIX, START, archive_names,
                        epoch, normalize_path, reconstruct, scan_mrt)


def record(at, path="2497 32934", kind="A", index=1, peer="202.249.2.169"):
    return {"archive": "updates.example.gz", "sha256": "a" * 64,
            "prefixElement": index, "sourceTime": at,
            "raw": {"prefix": PREFIX, "peer_ip": peer, "peer_asn": 2497,
                    "elem_type": kind, "as_path": path, "timestamp": epoch(at)}}


def baseline():
    value = record(BASELINE)
    value["archive"] = "bview.example.gz"
    # RIB originated_time is not when the table was captured.
    value["raw"]["timestamp"] = epoch("2021-09-01T00:00:00Z")
    return value


class ReconstructionTests(unittest.TestCase):
    def test_rib_and_all_warmup_updates_establish_replay_baseline(self):
        before = record("2021-10-04T15:00:00Z", "2497 174 32934")
        during = record("2021-10-04T15:42:00Z", kind="W", path=None, index=2)
        replay = reconstruct([baseline()], [during, before], [], epoch(BASELINE))
        observer = replay["observers"][0]
        self.assertEqual(observer["baseline"], [2497, 174, 32934])
        self.assertEqual(observer["baselineEvidence"], before)
        self.assertEqual(replay["warmupEvents"], 1)
        self.assertEqual(replay["events"][0]["at"], 420)
        self.assertEqual(replay["events"][0]["kind"], "withdrawal")

    def test_withdrawn_start_is_distinct_from_missing_baseline(self):
        withdrawal = record("2021-10-04T15:00:00Z", kind="W", path=None)
        announcement = record("2021-10-04T16:00:00Z", index=2)
        replay = reconstruct([baseline()], [withdrawal, announcement], [], epoch(BASELINE))
        self.assertEqual(replay["observers"][0]["baseline"], [])
        self.assertEqual(replay["observers"][0]["baselineStatus"], "withdrawn")
        self.assertEqual(replay["events"][0]["kind"], "announcement")

    def test_duplicate_evidence_is_idempotent_and_same_second_keeps_input_order(self):
        first = record("2021-10-04T15:42:00Z", "2497 174 32934", index=2)
        last = record("2021-10-04T15:42:00Z", "2497 6939 32934", index=1)
        replay = reconstruct([baseline()], [first, first, last], [], epoch(BASELINE))
        self.assertEqual(len(replay["events"]), 2)
        self.assertEqual([event["path"] for event in replay["events"]],
                         [[2497, 174, 32934], [2497, 6939, 32934]])
        self.assertLess(replay["events"][0]["sequence"], replay["events"][1]["sequence"])

    def test_exact_prefix_and_validated_observers_are_required(self):
        for updates in [[record(START, peer="192.0.2.1")],
                        [{**record(START), "raw": {**record(START)["raw"], "prefix": "129.134.0.0/16"}}]]:
            with self.assertRaises(ValueError):
                reconstruct([baseline()], updates, [], epoch(BASELINE))
        with self.assertRaisesRegex(ValueError, "No starting RIB"):
            reconstruct([], [record(START)], [], epoch(BASELINE))

    def test_session_reset_requires_a_new_baseline(self):
        session = {"peer": "202.249.2.169", "asn": 2497, "at": epoch(START), "old": 6, "new": 1}
        with self.assertRaisesRegex(ValueError, "replacement baseline"):
            reconstruct([baseline()], [record(START)], [session], epoch(BASELINE))

    def test_replay_end_is_exclusive_and_pre_capture_updates_do_not_override_rib(self):
        ignored = record("2021-10-04T07:59:59Z", "2497 174 32934")
        during = record(START, "2497 6939 32934", index=2)
        end = record(END, kind="W", path=None, index=3)
        replay = reconstruct([baseline()], [ignored, during, end], [], epoch(BASELINE))
        self.assertEqual(replay["observers"][0]["baseline"], [2497, 32934])
        self.assertEqual(len(replay["events"]), 1)

    def test_prepends_are_preserved_and_sets_or_confederations_fail_closed(self):
        self.assertEqual(normalize_path("2497 174 174 32934"), [2497, 174, 174, 32934])
        for value in [None, "", "2497 {174,6939} 32934", "(2497) 32934", "0 32934", "4294967296"]:
            with self.assertRaises(ValueError):
                normalize_path(value)

    def test_archive_sequence_has_no_missing_warmup_or_replay_slots(self):
        names = archive_names()
        self.assertEqual(len(names), 163)
        self.assertEqual(names[:2], ["bview.20211004.0800.gz", "updates.20211004.0800.gz"])
        self.assertEqual(names[-1], "updates.20211004.2125.gz")
        self.assertEqual(len(names), len(set(names)))


class FramingTests(unittest.TestCase):
    def scan(self, raw):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.gz"
            path.write_bytes(gzip.compress(raw))
            return scan_mrt(path)

    def test_rib_capture_time_is_mrt_header_time(self):
        body = struct.pack("!IB", 1, 24) + bytes([129, 134, 30]) + struct.pack("!H", 0)
        raw = struct.pack("!IHHI", int(epoch(BASELINE)), 13, 2, len(body)) + body
        self.assertEqual(self.scan(raw)["ribTimes"], [epoch(BASELINE)])

    def test_ipv4_as4_and_extended_ipv6_session_changes_are_visible(self):
        import ipaddress
        for kind, subtype, afi, address in [(16, 5, 1, "202.249.2.169"), (17, 0, 2, "2001:db8::1")]:
            as_format = "!IIHH" if subtype == 5 else "!HHHH"
            body = struct.pack(as_format, 2497, 12654, 0, afi)
            body += ipaddress.ip_address(address).packed + ipaddress.ip_address(address).packed
            body += struct.pack("!HH", 6, 1)
            if kind == 17:
                body = struct.pack("!I", 1234) + body
            raw = struct.pack("!IHHI", int(epoch(START)), kind, subtype, len(body)) + body
            self.assertEqual(self.scan(raw)["sessions"][0]["peer"], address)

    def test_truncated_or_empty_archive_is_rejected(self):
        for raw in [b"", b"short", struct.pack("!IHHI", 0, 16, 1, 5) + b"x"]:
            with self.assertRaises(ValueError):
                self.scan(raw)


class PublishedDatasetTests(unittest.TestCase):
    def test_small_replay_matches_manifest_and_evidence_checksums(self):
        import hashlib
        from ris_replay import ROOT
        directory = ROOT / "data/facebook-2021"
        manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
        content = (directory / "replay.json").read_bytes()
        replay = json.loads(content)
        self.assertEqual(hashlib.sha256(content).hexdigest(), manifest["replaySha256"])
        self.assertEqual(len(replay["events"]), manifest["replayEvents"])
        archives = {archive["name"]: archive for archive in manifest["archives"]}
        self.assertEqual(list(archives), archive_names())
        for evidence in [observer["baselineEvidence"] for observer in replay["observers"]] + [event["evidence"] for event in replay["events"]]:
            archive = archives[evidence["archive"]]
            self.assertEqual(evidence["sha256"], archive["sha256"])
            self.assertLessEqual(evidence["prefixElement"], archive["prefixElements"])


if __name__ == "__main__":
    unittest.main()
