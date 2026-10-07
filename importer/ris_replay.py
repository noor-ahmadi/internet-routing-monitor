"""Reconstruct one exact-prefix replay from RIPE RIS MRT archives."""

import argparse
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
from importlib.metadata import version
import ipaddress
import json
from pathlib import Path
import shutil
import struct
from urllib.request import Request, urlopen

PREFIX = "129.134.30.0/24"
COLLECTOR = "rrc06"
BASELINE = "2021-10-04T08:00:00Z"
START = "2021-10-04T15:35:00Z"
END = "2021-10-04T21:30:00Z"
PARSER_VERSION = "0.18.0"
ROOT = Path(__file__).resolve().parents[1]


def epoch(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def iso(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat().replace("+00:00", "Z")


def archive_names():
    names = ["bview.20211004.0800.gz"]
    at = datetime.fromisoformat(BASELINE.replace("Z", "+00:00"))
    end = datetime.fromisoformat(END.replace("Z", "+00:00"))
    while at < end:
        names.append(at.strftime("updates.%Y%m%d.%H%M.gz"))
        at += timedelta(minutes=5)
    return names


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def scan_mrt(path):
    """Check complete framing/CRC; read RIB capture time and peer session changes.

    BGPKIT decodes routes. This small RFC 6396 framing check also sees FSM
    records that its route-element iterator does not expose.
    """
    rib_times, sessions, records = [], [], 0
    network = ipaddress.ip_network(PREFIX)
    with gzip.open(path, "rb") as stream:
        while header := stream.read(12):
            if len(header) != 12:
                raise ValueError(f"Truncated MRT header: {path.name}")
            timestamp, kind, subtype, size = struct.unpack("!IHHI", header)
            if size > 8 * 1024 * 1024:
                raise ValueError(f"Unexpected MRT record size: {path.name}")
            body = stream.read(size)
            if len(body) != size:
                raise ValueError(f"Truncated MRT record: {path.name}")
            records += 1
            if kind == 13 and subtype == 2:  # TABLE_DUMP_V2 / RIB_IPV4_UNICAST
                if len(body) < 7 or body[4] > 32:
                    raise ValueError("Invalid IPv4 RIB framing")
                length = body[4]
                address = body[5:5 + (length + 7) // 8].ljust(4, b"\0")
                if length == network.prefixlen and address == network.network_address.packed:
                    rib_times.append(timestamp)
            if kind in (16, 17) and subtype in (0, 5):
                offset = 4 if kind == 17 else 0  # BGP4MP_ET microseconds
                width = 4 if subtype == 5 else 2
                minimum = offset + 2 * width + 4
                if len(body) < minimum:
                    raise ValueError("Truncated peer session record")
                asn = int.from_bytes(body[offset:offset + width], "big")
                afi = int.from_bytes(body[minimum - 2:minimum], "big")
                ip_size = {1: 4, 2: 16}.get(afi)
                if ip_size is None or len(body) != minimum + 2 * ip_size + 4:
                    raise ValueError("Invalid peer session record")
                peer = str(ipaddress.ip_address(body[minimum:minimum + ip_size]))
                old, new = struct.unpack("!HH", body[-4:])
                sessions.append({"peer": peer, "asn": asn, "at": timestamp, "old": old, "new": new})
    if not records:
        raise ValueError(f"Empty MRT archive: {path.name}")
    return {"records": records, "ribTimes": rib_times, "sessions": sessions}


def normalize_path(raw):
    # Preserve prepends. Sets/confederations need a different diagram model.
    parts = (raw or "").split()
    if not parts or any(not part.isdecimal() for part in parts):
        raise ValueError(f"Unsupported AS path: {raw!r}")
    path = [int(part) for part in parts]
    if any(not 0 < asn <= 4294967295 for asn in path):
        raise ValueError("Invalid AS number")
    return path


def evidence(element, name, digest, index, source_time):
    raw = element.to_dict()
    return {
        "archive": name, "sha256": digest, "prefixElement": index,
        "sourceTime": iso(source_time), "raw": raw,
    }


def reconstruct(baselines, updates, sessions, capture_time):
    start, end = epoch(START), epoch(END)
    if not epoch(BASELINE) <= capture_time < start:
        raise ValueError("RIB capture must precede replay")
    states, observers = {}, {}
    for record in baselines:
        raw = record["raw"]
        key = f"{COLLECTOR}:{raw['peer_ip']}:{raw['peer_asn']}"
        if key in observers or raw["prefix"] != PREFIX or raw["elem_type"] != "A":
            raise ValueError("Ambiguous or invalid baseline")
        path = normalize_path(raw["as_path"])
        if path[0] != raw["peer_asn"] or path[-1] != 32934:
            raise ValueError("Unsupported peer or destination origin in baseline")
        states[key] = (path, record)
        observers[key] = {
            "id": key, "city": f"RRC06 · AS{raw['peer_asn']}", "collector": COLLECTOR,
            "peer": raw["peer_ip"], "asn": raw["peer_asn"],
        }
    if not observers:
        raise ValueError("No starting RIB paths for this prefix")
    for session in sessions:
        key = f"{COLLECTOR}:{session['peer']}:{session['asn']}"
        if key in observers and capture_time <= session["at"] < end:
            raise ValueError("Selected peer changed session; a replacement baseline is required")
    replay_events, warmup_count = [], 0
    # Archive order and element order break ties; identities do not set chronology.
    ordered = sorted(enumerate(updates), key=lambda item: (epoch(item[1]["sourceTime"]), item[0]))
    seen = set()
    for sequence, record in ordered:
        raw, at = record["raw"], epoch(record["sourceTime"])
        key = f"{COLLECTOR}:{raw['peer_ip']}:{raw['peer_asn']}"
        if raw["prefix"] != PREFIX:
            raise ValueError("Unexpected prefix")
        if key not in states:
            raise ValueError("Update observer has no validated starting RIB path")
        if not capture_time <= at < end:
            continue
        identity = f"{COLLECTOR}:{record['archive']}:{record['sha256']}:{record['prefixElement']}"
        if identity in seen:
            continue
        seen.add(identity)
        previous, _ = states[key]
        if raw["elem_type"] == "W":
            path, kind = [], "withdrawal"
        elif raw["elem_type"] == "A":
            path = normalize_path(raw["as_path"])
            if path[0] != raw["peer_asn"] or path[-1] != 32934:
                raise ValueError("Unsupported peer or destination origin in update")
            kind = "path-change" if previous and previous != path else "announcement"
        else:
            raise ValueError("Unsupported route element")
        if at < start:
            states[key] = (path, record)
            warmup_count += 1
        else:
            # Freeze the replay-start state once, before applying the first event.
            if not replay_events:
                for observer_id, observer in observers.items():
                    observer["baseline"], observer["baselineEvidence"] = states[observer_id]
                    observer["baselineStatus"] = "observed" if observer["baseline"] else "withdrawn"
            event = {"id": f"ris:{identity}", "at": at - start, "sequence": sequence,
                     "observerId": key, "kind": kind, "evidence": record}
            if path:
                event["path"] = path
            replay_events.append(event)
            states[key] = (path, record)
    if not replay_events:
        raise ValueError("No observed replay events")
    return {
        "id": "historical", "source": "ris-mrt", "start": int(start * 1000),
        "duration": int(end - start), "initialTime": 120,
        "observers": sorted(observers.values(), key=lambda observer: observer["asn"]),
        "events": replay_events, "warmupEvents": warmup_count,
    }


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def build(cache_dir, output_dir, download=False, verify=False):
    from pybgpkit_parser import Parser

    if version("pybgpkit-parser") != PARSER_VERSION:
        raise ValueError(f"Use pybgpkit-parser=={PARSER_VERSION}")
    manifest_path = output_dir / "manifest.json"
    expected = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else None
    names = archive_names()
    if expected and [archive["name"] for archive in expected["archives"]] != names:
        raise ValueError("Manifest does not match the bounded archive sequence")
    cache_dir.mkdir(parents=True, exist_ok=True)
    archives, baseline_records, updates, sessions = [], [], [], []
    capture_time = None
    for position, name in enumerate(names):
        path = cache_dir / name
        url = f"https://data.ris.ripe.net/{COLLECTOR}/2021.10/{name}"
        if not path.exists() and download:
            temporary = path.with_suffix(".part")
            request = Request(url, headers={"User-Agent": "internet-routing-monitor/research-import"})
            with urlopen(request, timeout=60) as response, temporary.open("wb") as stream:
                shutil.copyfileobj(response, stream)
            temporary.replace(path)
        if not path.exists():
            raise ValueError(f"Missing archive {name}; run with --download")
        digest = sha256(path)
        if expected and digest != expected["archives"][position]["sha256"]:
            raise ValueError(f"Checksum mismatch: {name}")
        framing = scan_mrt(path)
        sessions.extend(framing["sessions"])
        if position == 0:
            if len(framing["ribTimes"]) != 1:
                raise ValueError("Expected one exact-prefix IPv4 RIB record")
            capture_time = framing["ribTimes"][0]
        matched = []
        for index, element in enumerate(Parser(str(path), filters={"prefix": PREFIX}), 1):
            at = capture_time if position == 0 else element.timestamp
            matched.append(evidence(element, name, digest, index, at))
        (baseline_records if position == 0 else updates).extend(matched)
        archives.append({"name": name, "url": url, "bytes": path.stat().st_size,
                         "sha256": digest, "records": framing["records"], "prefixElements": len(matched)})
        if position % 12 == 0:
            print(f"Validated {position + 1}/{len(names)} archives", flush=True)
    replay = reconstruct(baseline_records, updates, sessions, capture_time)
    manifest = {
        "schemaVersion": 1, "source": "RIPE NCC Routing Information Service (RIS)",
        "collector": COLLECTOR, "prefix": PREFIX,
        "baselineNominalTime": BASELINE, "baselineCaptureTime": iso(capture_time),
        "replayStart": START, "replayEndExclusive": END,
        "parser": {"name": "pybgpkit-parser", "version": PARSER_VERSION},
        "terms": "https://www.ripe.net/about-us/legal/terms-of-service/",
        "copyright": "https://www.ripe.net/about-us/legal/copyright-statement/",
        "commercialTerms": "https://www.ripe.net/analyse/internet-measurements/routing-information-service-ris/commercial-use/",
        "scope": "Exact prefix, one collector, RIB-present peers with no recorded session transitions. Archive coverage does not prove uninterrupted external capture or global reachability.",
        "replaySha256": hashlib.sha256(json_bytes(replay)).hexdigest(),
        "observers": len(replay["observers"]), "warmupEvents": replay["warmupEvents"],
        "replayEvents": len(replay["events"]), "archives": archives,
    }
    outputs = {"replay.json": replay, "manifest.json": manifest}
    if verify:
        for name, value in outputs.items():
            if (output_dir / name).read_bytes() != json_bytes(value):
                raise ValueError(f"Reconstruction differs from committed {name}")
    else:
        output_dir.mkdir(parents=True, exist_ok=True)
        for name, value in outputs.items():
            (output_dir / name).write_bytes(json_bytes(value))
    print(f"{'Verified' if verify else 'Wrote'} {len(replay['observers'])} observers, "
          f"{replay['warmupEvents']} warm-up and {len(replay['events'])} replay events", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, default=ROOT / ".cache/ris/rrc06")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data/facebook-2021")
    parser.add_argument("--download", action="store_true", help="Fetch missing archives sequentially")
    parser.add_argument("--verify", action="store_true", help="Rebuild and compare without changing outputs")
    args = parser.parse_args()
    try:
        build(args.cache_dir, args.output_dir, args.download, args.verify)
    except (ValueError, OSError) as error:
        parser.exit(1, f"Import failed: {error}\n")
