# Historical replay inputs

The saved replay covers the exact prefix `129.134.30.0/24` at RIPE NCC RIS collector **RRC06**, from **2021-10-04 15:35:00 UTC** to **21:30:00 UTC**, with an exclusive end. It contains three RIB-present peers: AS2497 (`202.249.2.169`), AS4777 (`202.249.2.20`), and AS25152 (`202.249.2.185`). These observations describe one collector's peers, not global reachability, packet delivery, or the cause of the incident.

The input is the [08:00 RIB](https://data.ris.ripe.net/rrc06/2021.10/bview.20211004.0800.gz) and all 162 five-minute update archives from 08:00 through 21:25. The 163 compressed files total 41,831,880 bytes and stay in the ignored local cache. [manifest.json](../data/facebook-2021/manifest.json) records each URL, byte count, SHA-256, MRT record count, and exact-prefix element count. These hashes identify the acquired bytes; they are not provider signatures.

The matching RIB record's MRT header establishes the table capture time at 08:00. Its route-entry timestamps describe when a prefix was heard and can be weeks older; they must not establish the replay clock. All warm-up files were processed. They contained zero matching updates before 15:35, so the three paths in the RIB remain the replay-start baseline.

The replay preserves all **144** matching observations: 75 announcements, 63 path replacements, and 6 withdrawals, including repeated announcements with changed attributes. The initial withdrawals reach these peers at 15:45:51, 15:46:19, and 15:46:44. Later announcements and withdrawals remain in the sequence rather than being reduced to one outage/recovery pair. Paths have returned at all three peers by the replay end. [RIPE's incident analysis](https://labs.ripe.net/author/alun_davies/facebook-down-and-out-in-bgplay/) supplies historical context; it is not the replay's event source.

## Reconstruction

Use Python 3.11+ in a virtual environment and install the single pinned decoder:

```sh
python -m pip install -r importer/requirements.txt
python importer/ris_replay.py --download --verify
python -m unittest discover -s importer -v
```

`--download` fetches missing files sequentially. Existing files must match the committed hashes. `--verify` reconstructs the replay and manifest and requires byte-for-byte equality with the saved files. A download-free repeat takes the same command without `--download`. Omitting `--verify` writes the generated files after validation.

[BGPKIT's Python binding](https://github.com/bgpkit/bgpkit-parser-py) decodes the exact-prefix route elements. A separate framing scan checks gzip CRCs, complete MRT headers/bodies, RIB capture time, and BGP peer FSM records described by [RFC 6396](https://datatracker.ietf.org/doc/html/rfc6396). No selected peer session transitions were recorded. Missing files, altered hashes, incomplete framing, ambiguous RIB entries, unvalidated peers, and recorded session changes fail the import. Archive completeness does not establish uninterrupted external capture.

Observations are identified by collector, archive name, content hash, and exact-prefix element ordinal. Source timestamps determine chronology; source element order breaks ties. AS prepends and original decoded attributes are preserved. This first importer requires a simple AS sequence starting with the selected peer and ending in AS32934; it rejects sets, confederations, and other origins instead of drawing invented relationships. Raw AS-path strings accompany every supporting record. MRT does not supply this project's receipt time or processing delay, so the interface reports those as unrecorded.

## Source and reuse

Source: **RIPE NCC Routing Information Service (RIS)** and its participating operators. See the [RIS archive documentation](https://ris.ripe.net/docs/mrt/), [service terms](https://www.ripe.net/about-us/legal/terms-of-service/), [copyright statement](https://www.ripe.net/about-us/legal/copyright-statement/), and [additional commercial-use conditions](https://www.ripe.net/analyse/internet-measurements/routing-information-service-ris/commercial-use/), checked on 7 October 2026 UTC. This is a public research and demonstration replay, with source attribution. The normalized observations are identified as derived RIS data and are not relicensed as project code. Large source archives are not distributed in this repository.
