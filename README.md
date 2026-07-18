# Interactive Critical Edition

A web application that helps readers understand difficult scholarly works — philosophy, monographs, research articles — by automatically generating an interactive "critical edition": an annotated reader that surfaces explicit citations, implicit intellectual context, and secondary literature, and turns that into a personalized, priority-ranked reading roadmap.

Upload a primary text (e.g. Heidegger's *Being and Time*) and the system helps answer the questions a reader is otherwise left to guess at: what background material is actually necessary, where to start, in what order, how much of each work to read, and which references are explicit versus scholarly inference. A personal knowledge profile means the system stops recommending what you already know.

**Status:** Phase 0 (project governance and planning) complete. Not yet functional — see [CLAUDE.md](./CLAUDE.md) for current implementation status and the full build log.

## Project memory

[`CLAUDE.md`](./CLAUDE.md) is the canonical, continuously-updated project memory: purpose, requirements, architecture, design decisions and rationale, current status, completed/remaining work, known issues, and exact commands to run/test/build/migrate/deploy. Read it first when resuming work on this project.

The full implementation plan (requirements inventory, architecture, data model, phased roadmap) lives at [`docs/architecture/plan.md`](./docs/architecture/plan.md).

## Stack (planned)

TypeScript throughout — Next.js (App Router) on Vercel, a Node worker service on Render for ingestion/AI processing, PostgreSQL + `pgvector` + Storage via Supabase, Auth.js for authentication, OpenAI and Anthropic behind a provider-agnostic adapter for AI, `react-force-graph-3d` for the personal 3D knowledge-graph visualizer. Full rationale and alternatives comparison in the architecture plan linked above.

## Getting started

Not yet scaffolded — this section will be filled in during Phase 1 with real install/run/test commands.

## License

Not yet decided; treat as all-rights-reserved until a LICENSE file is added.
