# Phase 17 → Phase 18 compact handoff

Status: local acceptance complete; Phase 18 is not dispatched because this host session has no context-replacement adapter. This is an intentional fail-closed result, not a claimed compaction.

## Decisions

- Phase 17 is Citation Completeness, Library Integrity, and Research-Web Repair; Library-grounded Socratic RAG is Phase 18.
- Citation mentions carry source type, raw text, normalized query, parser confidence, page/block/marker anchor, and resolution state. Apparatus remains out of reader body while becoming a citation input.
- Every mention immediately creates an `explicit_reference` Library projection. Metadata resolution is queued separately; unresolved items retain exact source text and a visible needs-resolution label.
- Canonical work identity order is DOI, ISBN/external identifier, canonical URL, then conservative title+author+year. Graphs collapse provider/run observations into one external-work node and merge logical-edge evidence/provenance.
- YouTube is D; Mastodon and Bluesky are E. They are supplementary/non-scholarly and cannot meet the factual-claim authority gate on their own.

## Changed areas

- `packages/phase-lifecycle/`: host/session lifecycle controller, ordered record read, fail-closed closeout tests.
- `packages/db/` and migration `0028_wooden_frank_castle`: citation anchor/resolution fields, citation-to-Library links, metadata-resolution queue.
- `packages/ingestion/`, `apps/worker/`: structural citation extraction, immediate Library projection, queued metadata resolution, public-source coverage/projection, deterministic fixtures.
- `apps/web/`: citation provenance in Library; canonical topic graph, labels, focal inspector, fullscreen/reset, accessible disclosure browser, header Light/Dark controls.
- `docs/project-status.json`, `docs/PROJECT-LOG.md`, `CLAUDE.md`, `docs/architecture/plan.md`, `progress-checklist.html`: Phase 17/18 tracking.

## Verification

- `pnpm --filter @ice/phase-lifecycle typecheck && pnpm --filter @ice/phase-lifecycle test` — 3 passed.
- `pnpm --filter @ice/ingestion test` — 38 passed.
- `pnpm --filter @ice/research typecheck && pnpm --filter @ice/research test` — 228 passed.
- `pnpm --filter worker typecheck` and local-Postgres worker suite — 33 passed, including the 22-target Vice and Reason fixture and mocked public-source worker projection.
- `pnpm --filter web typecheck` — passed.
- `pnpm --filter web exec playwright test e2e/graph.spec.ts` with local web/Postgres — 13 passed.
- `pnpm generate:project-status && pnpm check:project-status` and `git diff --check` — pending final rerun after documentation closeout.

## Remaining risks and gates

- Migration `0028` was applied only to the local development database. No production migration, deployment, or paid canary was requested or performed.
- The fresh-context host adapter is unavailable in this Codex session. Do not mark Phase 17 closed or begin Phase 18 in this same context; invoke a real adapter that atomically terminates this context and starts the next one from this file only.
- `research/` and `research.zip` are unreviewed local inputs and remain uncommitted.

## Phase 18 prompt

Read this handoff, then `CLAUDE.md`, `docs/PROJECT-LOG.md`, and `docs/project-status.json` in that order. Begin only Phase 18’s owner-scoped, Library-grounded Socratic RAG work. Preserve Phase 17’s citation anchors, canonical Library identity, public-source D/E boundary, and production approval gates. Do not rely on prior context beyond this handoff.
