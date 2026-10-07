# Internet Routing Monitor

A routing investigation workspace with a layered route web, replay controls, and inspectable evidence. It now opens a saved RIPE RIS replay of Facebook's October 2021 routing changes across three RRC06 peers; synthetic scenarios remain available, and live capture and backend integration are next. The [plan](plan.md) tracks the build, and [data notes](docs/data-validation.md) explain the reconstruction. With Node 22.12+ and pnpm installed, run `pnpm install` and `pnpm dev`; `pnpm test`, `pnpm build`, and `pnpm test:e2e` check the interface.
