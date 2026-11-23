# Interactive Critical Edition (Palimnote)

Upload a difficult scholarly text and get a traceable critical edition: resolved citations, a reading route, quote-anchored annotations and a knowledge graph. Built for readers of dense philosophy, monographs and research articles.

**Status:** beta, source-available. See [License](#license).

## What it does

- **Ingest** PDF, EPUB or text; footnotes are detected and you confirm the metadata.
- **Resolve citations** against Crossref, OpenAlex and Open Library. Each reference gets one of ten relationship categories, a confidence and its provenance. Bibliographic facts come only from real lookups. Without an LLM key a deterministic heuristic runs and is labelled as such.
- **Read and annotate** with quote-anchored highlights, notes, bookmarks and LLM annotations you can approve, dispute, edit or hide.
- **Reading roadmap** ranked into dependency-ordered tiers and re-sorted by what you already know.
- **Knowledge graph** of your works and their references, with an accessible table fallback.

Every generated claim carries a confidence and its provenance. It is a research aid, not a substitute for the primary sources.

## Stack

TypeScript monorepo. Next.js (App Router), a Node worker (pg-boss), PostgreSQL with pgvector, Auth.js, and provider-agnostic LLM adapters (OpenAI and Anthropic, plus the heuristic fallback). The citation resolution logic is also available as a standalone library: [scholarly-citation-resolver](https://github.com/hyderhusainarastu/scholarly-citation-resolver).

## Quick start

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

Local GROBID setup for full structured extraction is in [docs/grobid.md](./docs/grobid.md).

## Documentation

- [docs/PROJECT-LOG.md](./docs/PROJECT-LOG.md): current status, decisions, commands.
- [docs/architecture/plan.md](./docs/architecture/plan.md): architecture and data model.
- [AGENTS.md](./AGENTS.md): instructions for AI coding assistants.
- Historical audits, handoffs and prototypes live under [docs/internal/](./docs/internal/).

## License

All rights reserved; the source is published for reading and review. No open-source license is granted.

Part of the Palimnote project - more at https://github.com/hyderhusainarastu
