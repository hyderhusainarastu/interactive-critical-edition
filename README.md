# Interactive Critical Edition

A web application that helps readers understand difficult scholarly works — philosophy, monographs, research articles — by automatically generating an interactive "critical edition": an annotated reader that surfaces explicit citations, implicit intellectual context, and secondary literature, and turns that into a personalized, priority-ranked reading roadmap.

Upload a primary text (e.g. Heidegger's *Being and Time*) and the system helps answer the questions a reader is otherwise left to guess at: what background material is actually necessary, where to start, in what order, how much of each work to read, and which references are explicit versus scholarly inference. A personal knowledge profile means the system stops recommending what you already know.

**Status:** Phases 0–6 complete and deployed; Phase 7 (hardening) underway. Live in production — web app on Vercel, background worker on Render, database/storage on Supabase. See [CLAUDE.md](./CLAUDE.md) for current implementation status and the full build log.

## What it does

- **Upload & ingest** PDF / EPUB / text — parsed, footnotes detected, metadata confirmed by you.
- **Scholarly analysis** — citations extracted and resolved against real bibliographic sources (Crossref / OpenAlex / Open Library), each reference classified into one of ten relationship categories with a confidence and full provenance. Bibliographic facts come only from real lookups, never invented; when no AI key is set a deterministic heuristic stands in (flagged as such).
- **Annotated reader** — quote-anchored highlights, notes, bookmarks (survive re-render), footnotes, and AI annotations you can approve / dispute / reject / edit / hide. Light / dark / focus modes, adjustable typography, split-pane.
- **Reading roadmap** — references ranked into dependency-ordered priority tiers, personalized by a knowledge profile (rate what you know and the plan re-sorts), with mode / expertise / time-budget filters.
- **3D knowledge graph** — your works and the readings they reference, with read / unread / missing-link states, plus a mandatory accessible table fallback.
- **Landing page, onboarding, privacy/terms, and an admin dashboard** (platform + AI-cost view).

Every AI-generated claim carries a confidence and its provenance — a research aid, not a substitute for the primary sources.

## Project memory

[`CLAUDE.md`](./CLAUDE.md) is the canonical, continuously-updated project memory: purpose, requirements, architecture, design decisions and rationale, current status, completed/remaining work, known issues, and exact commands to run/test/build/migrate/deploy. Read it first when resuming work on this project.

The full implementation plan (requirements inventory, architecture, data model, phased roadmap) lives at [`docs/architecture/plan.md`](./docs/architecture/plan.md).

## Stack

TypeScript throughout — Next.js (App Router) on Vercel, a Node worker service on Render (pg-boss consumer for ingestion + AI analysis), PostgreSQL + `pgvector` + Storage via Supabase, Auth.js for authentication, OpenAI and Anthropic behind a provider-agnostic adapter (with a deterministic heuristic fallback), `react-force-graph-3d` for the 3D knowledge-graph visualizer. Monorepo packages: `db` (Drizzle schema/migrations), `ingestion`, `ai-adapters`, `bibliographic`, `roadmap`, `observability`. Full rationale and alternatives comparison in the architecture plan linked above.

## Getting started

Requires Node 24 (see `.node-version`), pnpm (via Corepack), and a container runtime for local Postgres (Colima recommended on macOS — no Docker Desktop needed; `brew install colima docker docker-compose`, then `colima start` once).

```sh
corepack enable
pnpm install

docker compose up -d postgres        # local Postgres + pgvector
pnpm --filter @ice/db db:migrate     # apply migrations

# create apps/web/.env.local, packages/db/.env, and apps/worker/.env —
# see .env.example at repo root for the variable names; for local dev,
# DATABASE_URL is postgres://ice:ice_dev_only@localhost:5432/interactive_critical_edition
pnpm dev                             # apps/web on http://localhost:3000
cd apps/worker && pnpm dev           # separate terminal — background job processing
```

Other commands:

```sh
pnpm -r lint          # lint all packages
pnpm -r typecheck     # typecheck all packages
pnpm -r test          # unit tests (Vitest): citation extraction, classifier, bibliographic
                      # resolution, the roadmap ranking (Heidegger/Vico cases), and the AI eval harness
pnpm --filter web build

pnpm --filter @ice/db db:generate    # generate a new migration after editing packages/db/src/schema.ts
pnpm --filter @ice/db db:migrate     # apply pending migrations
pnpm --filter @ice/db db:studio      # browse the local database

# End-to-end (Playwright) — needs the full local stack running (web + worker + Postgres):
pnpm --filter web exec playwright install chromium   # one-time
pnpm --filter web test:e2e
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, a build, and the CI-safe E2E specs (landing/onboarding accessibility + the authorization matrix) against an ephemeral Postgres service on every push/PR — no external accounts required. The analysis/reader/roadmap E2E specs need the worker and live bibliographic APIs, so they run manually against the full local stack.

## License

Not yet decided; treat as all-rights-reserved until a LICENSE file is added.
