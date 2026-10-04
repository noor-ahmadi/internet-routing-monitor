# Internet Routing Monitor

## Summary

Build a visually striking investigation tool for internet routing changes. The central experience is a **layered web of routes on a charcoal canvas**, with fine paths connecting stable network nodes. As observers withdraw routes, the web becomes sparse; returning announcements rebuild it.

Open on a historical incident, paused shortly before the change. Users can play, scrub, inspect evidence, or switch to live observations in the same workspace. The first historical target remains Facebook’s October 2021 outage, subject to validating the underlying records.

Use **Internet Routing Monitor** throughout the interface and project metadata, with repository name `internet-routing-monitor`.

## Visual experience

- **Composition:** the route web dominates the screen. A slim masthead contains the prefix, incident selector, Live/Replay switch, and freshness. The timeline sits directly below the diagram. Selecting a route opens an evidence drawer.
- **Geometry:** observers sit toward the left, the destination prefix toward the right, and shared network nodes connect them through curved strands. Subtle offsets separate observer paths into layers. Node positions remain stable during playback and updates.
- **Style:** canvas `#0C1015`, opaque controls `#131920`, off-white text, neutral gray routes, cyan selection/new observations, and coral withdrawn observations. Use self-hosted IBM Plex Sans with Plex Mono for addresses, ASNs, and timestamps.
- **Restraint:** generous space around the network, thin separators, small corner radii, and readable labels. The diagram supplies the visual interest; surrounding controls stay quiet.
- **Interaction:** select a route, isolate an observer, compare before/after paths, pan, zoom, reset the view, and step through events. Display six observer paths at once, with explicit displayed/available counts and controls for choosing others.

| Observation | Visual behavior |
|---|---|
| Announcement | Briefly emphasize the complete new path, then settle |
| Path change | Crossfade between old and replacement paths while nodes remain fixed |
| Withdrawal | Show the previous path as a coral dashed trace, then remove its active appearance |
| Source gap | Mark affected observations as uncertain and show a coverage notice |
| Reannouncement | Restore the corresponding observed path |

Transitions last roughly 350 ms. No continuous drifting occurs when the data is unchanged. Reduced motion shows final states immediately.

Lines represent **observed network relationships**. They do not depict physical cables, packet movement, or a proven fault location. A withdrawal from one observer must preserve segments still supported by another.

## Frontend methods and interfaces

Apply the requested methods deliberately:

- **Taste:** composition, typography, restraint, and purposeful motion. Its marketing-layout recipes do not govern this investigation workspace.
- **VoltAgent references:** adapt Linear’s restrained controls and IBM’s analytical clarity into one original visual system.
- **Vercel Web Design Guidelines:** review keyboard behavior, contrast, responsive layouts, forms, and motion.
- **Playwright CLI:** inspect the actual interface and capture reproducible visual evidence.

Use React/TypeScript with **SVG**, D3 for stable layout and pan/zoom, **Anime.js** for scoped route transitions, and styled Radix primitives for complex controls. D3 supports fixed coordinates and static layouts, which fit the stable scene. [D3 documentation](https://d3js.org/d3-force/simulation), [Anime.js documentation](https://animejs.com/documentation/animation/)

Add these GraphQL capabilities to the earlier backend design:

- **Route snapshot:** return observer paths, coverage, freshness, and a consistent projection cursor for one prefix and replay position.
- **Route changes subscription:** deliver subsequent changes with observer identity, before/after paths, evidence references, and projection cursors.
- **Replay navigation:** seek to an authoritative historical state; stepping and scrubbing update the diagram, timeline, and evidence together.
- **Reconnect:** resume from the cursor when retained changes are available; otherwise explicitly request a fresh snapshot.

Pausing live presentation keeps capture running. Returning to live loads the latest authoritative state. Source time and processing delay remain visible.

## Backend, Kubernetes, and AWS

Retain Python capture/replay, Java/Spring GraphQL processing, and PostgreSQL storage. Store route state per collector, peer, and prefix; derive the displayed web from the selected observers.

Use deterministic event identities and transactional processing checkpoints. Enforce exclusive worker ownership so overlapping Kubernetes deployments cannot process the same stream out of order.

Develop with Docker Compose, then kind. Run continuous workloads as Deployments and bounded imports/replays as Jobs. Use Terraform for short EKS demonstrations, ECR for images, and S3 for archives. Temporary PostgreSQL uses EBS with the required CSI driver and permissions.

Keep AWS demonstrations operator-accessed and temporary. Retain the provisional $10–20 session allowance, refine it against the actual configuration, and verify teardown afterward. Continuous cloud hosting remains outside the first release.

## Build order and acceptance

1. **Visual prototype:** build the complete static composition and interactive replay using explicitly labeled deterministic fixtures.
2. **Data validation:** verify historical inputs, baseline reconstruction, source terms, and normalization.
3. **Local integration:** connect snapshots, evidence, replay navigation, and live updates.
4. **Recovery:** test duplicates, worker restarts, collector gaps, reconnects, and historical seeking.
5. **Kubernetes and AWS:** demonstrate deployment updates, Job retries, processing recovery, scoped permissions, and teardown.

Acceptance requires:

- Shared-edge withdrawals, unknown baselines, and capture gaps render correctly.
- Scrubbing backward and forward produces matching states without rearranging existing nodes.
- Keyboard controls, a synchronized textual route list, and reduced motion provide complete access.
- Desktop, mobile, 200% zoom, loading, empty, stale, and failure states are visually inspected.
- Dense fixtures remain responsive; hidden tabs stop visual animation.
- The finished replay remains compelling with animation disabled.
- A short recording shows the incident, its supporting evidence, and verified processing recovery.

These choices are locked: plain descriptive name, dark theme, layered web, incident-first entry, local development, and short AWS demonstrations.

## First iteration

The first implementation is the visual prototype in build step 1. It includes the layered SVG web, stable node positions, scoped 350 ms route transitions, replay playback and seeking, event stepping, observer selection, baseline comparison, route isolation, pan/zoom/reset, and an evidence drawer. A synchronized textual route list provides the same state and inspection actions. Mobile keeps the diagram horizontally navigable and the controls and route list in a single column.

All observers, transit paths, source timestamps, receipt delays, events, and evidence records are deterministic synthetic fixtures. The prefix and destination are the proposed historical target, not a reconstructed incident. The live demo uses a simulated capture clock that continues while presentation is paused. Real live capture and the GraphQL API are not implemented in this iteration.

Fixture scenarios cover a path replacement, shared-edge withdrawals, reannouncements, missing starting baselines, a source gap, uncertainty after reconnect, a 240-observer collection, loading, empty, stale, and failure states. Only 6 observer paths render at a time. Replay stops visual updates in hidden tabs, and reduced motion renders the final state immediately.

Local verification uses deterministic replay checks and Playwright in Chromium and WebKit at desktop and mobile sizes, plus an equivalent 200% desktop zoom viewport and automated accessibility checks. The GitHub verification workflow runs the same checks. Browser screenshots and traces are generated locally or in test output and are excluded from source control.

## Next implementation stages

1. Validate one bounded historical interval, its route-state baseline and warm-up updates, source terms, checksums, and normalization. Acquire large archives outside Git. Keep the synthetic replay available until the real reconstruction is verified.
2. Add Python import/capture, PostgreSQL migrations, and Java/Spring GraphQL processing. Use PostgreSQL as the durable observation inbox and projection store for one prefix first. Keep route state per collector, peer, and prefix. Accept observations idempotently and commit projection updates, evidence, and checkpoints in the same transaction.
3. Implement the route snapshot query, authoritative replay seeking, and subsequent route-change subscriptions. Snapshot and changes must share a consistent projection cursor; reconnect either resumes retained changes or explicitly requests a new snapshot. Bound pages and query complexity and batch relationship reads.
4. Prove duplicate handling, interrupted imports, worker restart recovery, per-peer ordering, collector gaps, and backward/forward seeking with real inputs. Enforce exclusive database-backed worker ownership through deployment overlap. A source reconnect alone cannot recover missed external events or establish a new baseline.
5. Package the verified local system in Docker Compose, then kind Deployments and bounded import/replay Jobs. Measure resource needs before a temporary Terraform/EKS demonstration with ECR, S3, and EBS-backed PostgreSQL. Refine the provisional session allowance using the actual region and configuration, and verify teardown afterward.

Kafka, Redis, Spark, additional API replicas, and continuous cloud hosting remain optional future decisions based on measured need. A validated replay recording and processing-recovery recording belong to the integrated stages; this prototype does not establish backend or deployment recovery.
