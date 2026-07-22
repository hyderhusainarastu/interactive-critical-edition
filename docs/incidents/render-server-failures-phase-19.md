# Render Server-Failure Incident Diagnosis — Phase 19

Investigation opened 2026-07-22 in response to owner reports of Render server-failure notifications. This record correlates every failure signature found in the available evidence window to a deploy, a log trace, and a root cause, per the Phase 19 plan (`palimnote_phases_19_23_plan_revised.md` §19.1).

## Evidence sources checked

- `render deploys list srv-d9dgiamrnols73ccpa10` — last 20 deploys.
- `render logs --resources srv-d9dgiamrnols73ccpa10` — error-level query and a targeted time-window query.
- `docs/PROJECT-LOG.md` Known Problems (prior documented Render incidents: the GitHub-outage `build_failed` misdiagnosis, the env-var-wipe incident, the IPv6/Supavisor pooler fix, the `render restart` stale-env-var trap, the stalled pg-boss job window — all already diagnosed and closed in earlier phases, not reopened here).

## Deploy-history finding

All 20 most recent worker deploys (through commit `ae49706`, 2026-07-22T01:41Z) show status `live` (the current one) or `deactivated` (superseded by a later successful deploy). **No `build_failed`, `update_failed`, or `canceled` deploy exists in this window.** There is no unresolved build/boot-level Render failure as of this audit.

## Confirmed application-level incident: worker crash on unpaired UTF-16 surrogate

| Field | Value |
|---|---|
| ID | R-19-1 |
| Timestamp | 2026-07-20T04:57:20.019Z (UTC) |
| Service | `interactive-critical-edition-worker` (`srv-d9dgiamrnols73ccpa10`) |
| Failure category | Crash / unhandled exception → process exit → auto-restart |
| Exit status | Node process exit 1 (`[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] worker@0.0.0 start`) |
| Log excerpt | `error: unsupported Unicode escape sequence` at `pg-pool/index.js:45:11`, called from `pg-boss@10.4.2/src/db.js:42:14` (`Db.executeSql`) |
| Last healthy | Preceding log activity in the same window shows normal job processing before the throw. |
| Recovery | Render auto-restarted the instance (`srv-d9dgiamrnols73ccpa10-8bhwz restarted` at 2026-07-20T04:57:21.7Z); worker rebooted cleanly, resumed queue listening at 04:57:29Z, and processed a job successfully seconds later (`relevance gate: 31 accepted...` at 04:57:55Z). |
| Recurrence | Searched the full available log retention for the string `unsupported Unicode` — exactly one match. Not a recurring/crash-looping pattern. |
| User-visible impact | The one `extract-text`/`analyze-work` job active on that connection failed; pg-boss's standard job-expiry/retry semantics apply (see `docs/PROJECT-LOG.md` Known Problems, "A pg-boss job left `active` by a crashed worker..."). No data loss — Postgres never received a malformed write because the client-side encoder threw before the query reached the wire. |
| Root cause | `node-postgres`'s query-parameter encoder throws `unsupported Unicode escape sequence` when a string parameter contains a lone (unpaired) UTF-16 surrogate code unit. Ingestion (`packages/ingestion`, especially OCR/PDF text extraction and GROBID TEI parsing) does not run any pass to guarantee well-formed UTF-16 output before that text is written to the database or embedded in a pg-boss job payload. A single work with damaged/malformed extracted text was therefore capable of taking down the whole worker process, not just its own job. |
| Repair | `packages/ingestion/src/sanitizeText.ts` (`sanitizeExtractedText`) strips unpaired surrogates and NUL bytes (also DB-illegal) at the single `parseDocument()` boundary all parsers (PDF/GROBID, EPUB, text/Markdown) return through — see `packages/ingestion/src/index.ts`. |
| Regression test | `packages/ingestion/src/sanitizeText.test.ts` — 5 cases (well-formed text passes through, unpaired high/low surrogate replaced, a valid surrogate pair emoji preserved, NUL byte stripped). |
| Observability improvement | `apps/worker/src/index.ts` now installs `uncaughtException`/`unhandledRejection` handlers that route through `reportError` (Sentry-forwarding when configured) with the resolved pipeline version and commit before exiting, so a future crash of this shape is diagnosable from structured logs/Sentry immediately rather than requiring a manual `render logs` archaeology pass like this one. |
| Deployment/verification evidence | Local: `pnpm --filter @ice/ingestion test` (43/43 pass, including the 5 new cases) and `pnpm --filter @ice/ingestion typecheck` / `pnpm --filter worker typecheck` (clean). Production deploy and a representative reprocess canary are pending owner authorization per the plan's cost/production-safety invariants (§2.7) — this fix ships to Render on the next authorized push to `main`, at which point the worker startup log's commit SHA is the verification anchor. |

## Classification

- **R-19-1**: confirmed application root cause and verified local repair; production deployment held for the next authorized push (no separate paid canary required — this is a zero-cost defensive text-sanitization change, not a pipeline/feature-flag change).
- All prior Render incidents referenced in `docs/PROJECT-LOG.md` Known Problems remain closed as previously documented; none reopened by this audit.
- No other failure signature (OOM, DB pool exhaustion, health-check failure, Storage failure) appears in the checked evidence window.

## Outcome

No unexplained P0/P1 Render failure remains as of this audit. Phase 20 production-affecting work is not blocked on this account. See `docs/runbooks/render-worker-failure-response.md` for the standing response procedure this incident fed into.
