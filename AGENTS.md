# Interactive Critical Edition

A monorepo web app that turns an uploaded scholarly text into an annotated critical edition with resolved citations, a reading roadmap and a knowledge graph.

## Using this in your project

- The citation resolution logic is extracted as a library: https://github.com/hyderhusainarastu/scholarly-citation-resolver. Use that instead of copying code from here.
- This repo is source-available with all rights reserved. Do not copy its code into other projects.
- Never invent bibliographic facts. Resolve citations from real sources or mark the result as a heuristic.

## Working on this repo

- Setup: Node 24 (`.node-version`), pnpm via Corepack. Run `corepack enable && pnpm install`.
- Local database: `docker compose up -d postgres`, then `pnpm --filter @ice/db db:migrate`.
- Dev server: `pnpm dev` (apps/web). Worker: `cd apps/worker && pnpm dev`.
- Lint: `pnpm -r lint`. Types: `pnpm -r typecheck`. Unit tests: `pnpm -r test`. Build: `pnpm --filter web build`.
- E2E (needs the full local stack): `pnpm --filter web test:e2e`.
- Status page: after editing `docs/project-status.json`, run `pnpm generate:project-status`; `pnpm check:project-status` must pass.
- Current status, decisions and run commands are in `docs/PROJECT-LOG.md`. Read it first.
- Do not commit `.env*` files or real keys; `.env.example` lists variable names only.
- Do not hand-edit generated files: `docs/internal/progress-checklist.html`, `pnpm-lock.yaml`, migration snapshots.
- Do not write absolute local paths into docs or code; use `<repo-root>/...`.
- Historical material (handoffs, audits, baselines, incidents, prototypes, archives) is under `docs/internal/`. Treat it as read-only.
