# Interactive Critical Edition

A web application that helps readers understand difficult scholarly works — philosophy, monographs, research articles — by automatically generating an interactive "critical edition": an annotated reader that surfaces explicit citations, implicit intellectual context, and secondary literature, and turns that into a personalized, priority-ranked reading roadmap.

Upload a primary text (e.g. Heidegger's *Being and Time*) and the system helps answer the questions a reader is otherwise left to guess at: what background material is actually necessary, where to start, in what order, how much of each work to read, and which references are explicit versus scholarly inference. A personal knowledge profile means the system stops recommending what you already know.

**Status:** Phase 1a (local foundation) complete — auth (signup, email verification, login, password reset, session revocation) works end to end against local Postgres. Not yet deployed anywhere. See [CLAUDE.md](./CLAUDE.md) for current implementation status and the full build log.

## Project memory

[`CLAUDE.md`](./CLAUDE.md) is the canonical, continuously-updated project memory: purpose, requirements, architecture, design decisions and rationale, current status, completed/remaining work, known issues, and exact commands to run/test/build/migrate/deploy. Read it first when resuming work on this project.

The full implementation plan (requirements inventory, architecture, data model, phased roadmap) lives at [`docs/architecture/plan.md`](./docs/architecture/plan.md).

## Stack (planned)

TypeScript throughout — Next.js (App Router) on Vercel, a Node worker service on Render for ingestion/AI processing, PostgreSQL + `pgvector` + Storage via Supabase, Auth.js for authentication, OpenAI and Anthropic behind a provider-agnostic adapter for AI, `react-force-graph-3d` for the personal 3D knowledge-graph visualizer. Full rationale and alternatives comparison in the architecture plan linked above.

## Getting started

Requires Node 24 (see `.node-version`), pnpm (via Corepack), and a container runtime for local Postgres (Colima recommended on macOS — no Docker Desktop needed; `brew install colima docker docker-compose`, then `colima start` once).

```sh
corepack enable
pnpm install

docker compose up -d postgres        # local Postgres + pgvector
pnpm --filter @ice/db db:migrate     # apply migrations

# create apps/web/.env.local and packages/db/.env — see .env.example at
# repo root for the variable names; for local dev, DATABASE_URL is
# postgres://ice:ice_dev_only@localhost:5432/interactive_critical_edition
pnpm dev                             # apps/web on http://localhost:3000
```

Other commands:

```sh
pnpm -r lint          # lint all packages
pnpm -r typecheck     # typecheck all packages
pnpm -r test          # unit tests (none yet — added from Phase 4 onward)
pnpm --filter web build

pnpm --filter @ice/db db:generate    # generate a new migration after editing packages/db/src/schema.ts
pnpm --filter @ice/db db:migrate     # apply pending migrations
pnpm --filter @ice/db db:studio      # browse the local database
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests, and a build against an ephemeral Postgres service on every push/PR — no external accounts required.

## License

Not yet decided; treat as all-rights-reserved until a LICENSE file is added.
