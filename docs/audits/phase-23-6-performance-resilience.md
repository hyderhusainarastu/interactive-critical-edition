# Phase 23.6 — Performance and Resilience

Per `docs/project-status.json`'s Phase 23 subphase `23.6` and `palimnote_phases_19_23_plan_revised.md` §23.6. Written under a **measurement freeze**: a paid measurement run was in progress on the shared local stack at the time of this work, so nothing here connects to `localhost:3000`, starts a server against the shared local Postgres, or touches that database. Allowed and used: typecheck, lint, `pnpm --filter web build` (a production build touches no DB), and read-only production checks (Render CLI logs/deploys — a separate service from the frozen local stack). Everything requiring a running local app is authored here and marked **pending**, to be executed post-freeze.

No new subscription, SaaS, or paid tool was added (standing prohibition, `docs/PROJECT-LOG.md`). No k6, no external perf SaaS. Local/free tooling only: Playwright timing assertions, `next build` output inspection, and the Render CLI the project already uses.

---

## 1. Render incident revalidation (plan §23.6, first bullet list)

Read-only checks against the production Render worker (`srv-d9dgiamrnols73ccpa10`) — not the frozen local stack — comparing against the two incidents in `docs/incidents/render-server-failures-phase-19.md` (R-19-1 `unsupported Unicode escape sequence`, R-19-2 `SELF_SIGNED_CERT_IN_CHAIN`). Run 2026-07-24.

| Check | Result |
|---|---|
| Deployed commit vs. `main` HEAD | Latest deploy `dep-d9hdd66rnols73d0as0g`, commit `b67ca77` (`docs: record D-23-21 production verification`), status `live`, finished 2026-07-24T03:07:10Z — matches local `git log` HEAD on this branch's parent history. |
| Deploy history (last 20) | All `live` or `deactivated` (superseded). Zero `build_failed`/`update_failed`/`canceled` in the window. |
| Service configuration vs. documented baseline | `render services -o json`: region `virginia`, plan `starter`, branch `main`, `autoDeploy: yes`, `suspended: not_suspended`, start command `pnpm --filter worker start`. Matches `docs/PROJECT-LOG.md`'s recorded baseline exactly. |
| R-19-1 recurrence (`unsupported Unicode`) | **Zero** occurrences since the original incident. `render logs --text "unsupported Unicode"` returns exactly one match, timestamp `2026-07-20T04:57:20.019544641Z` — the original incident, not a new one. |
| R-19-2 recurrence (`SELF_SIGNED_CERT_IN_CHAIN`) | **Zero** occurrences since recovery. Last match `2026-07-22T04:53:31.039250631Z`, inside the documented incident window; nothing after. |
| Worker boot / queue health | Latest startup line: `[worker] listening for "extract-text", "analyze-work", "resolve-citation-metadata", and "expand-cross-library-graph" jobs (pipeline v4)` at `2026-07-24T03:07:21Z`, seconds after the `b67ca77` deploy went live. Pipeline version and job set match expectations. |
| Restart recovery | Not separately exercised this session (would require triggering a real restart against production, out of scope for a read-only revalidation); the fact that every recent deploy transitions cleanly to a healthy `[worker] listening...` line is treated as continuous evidence the boot path works, consistent with the runbook's own verification method (`docs/runbooks/render-worker-failure-response.md` §4.4). |
| Alerts contain actionable context | Confirmed **statically** (code read, not a live-fired alert): `apps/worker/src/index.ts`'s `uncaughtException`/`unhandledRejection` handlers still call `reportError(err, { scope, pipeline: activePipelineVersion(), commit: process.env.RENDER_GIT_COMMIT })` — unchanged since the Phase 19 fix. |
| Unexplained failed/stalled jobs | **Error-level logs since 2026-07-23T00:00:00Z: zero.** No new incident-shaped signature found. A `pgboss.job` state check (any row stuck `active`/`created` past its expiry) needs a DB query and is **pending** post-freeze (see §5). |

**New observation, not a recurrence of either documented incident:** a burst of 16 `[pg-boss] Error: read ECONNABORTED` log lines, all within a 2-second window (`2026-07-22T11:56:27.946Z`–`11:56:29.543Z`), roughly 7 hours after R-19-2's resolution. The dumped connection object shows `_ending: true, _connected: true, _queryable: false` — consistent with Supavisor recycling one pooled connection mid-use, which `pg-boss`/`pg` logs at `error` level even though it's an expected pool-lifecycle event, not an application fault. No worker restart followed, no repeat occurrence in the ~40 hours since, and no `[worker] listening...` boot line appears near that timestamp (i.e., the process did not crash). Classified as **informational, monitor-only** — not promoted to a new incident/defect-register row, since it never recurred and had no visible user impact. If this signature becomes recurrent, escalate per the runbook's §3 diagnosis order.

**Verified now, no code change required.** All revalidation above is read-only against production; nothing in this section touched the frozen local stack.

---

## 2. Static findings from a production build (no DB connection)

`pnpm --filter web typecheck`, `pnpm --filter web lint`, and `pnpm --filter web build` were run in this worktree. The build needs `DATABASE_URL` to be a syntactically valid string at module-eval time (`packages/db/src/index.ts` throws if absent) but the `postgres.js` client connects lazily — no route in this app does build-time static generation against the DB (every route is dynamic, `ƒ` in the build output), so a dummy, unreachable connection string is sufficient and **no network connection to any Postgres instance was made**. Confirmed by the build completing with zero connection errors.

```sh
DATABASE_URL="postgresql://user:pass@localhost:5432/build_dummy" \
AUTH_SECRET="build-dummy-secret-not-real-0123456789" \
NEXTAUTH_URL="http://localhost:3000" \
pnpm --filter web build
```

Typecheck, lint, and build were all clean.

### 2.1 A Phase 19 tooling assumption no longer holds

`docs/audits/phase-19-frontend-tooling.md` substituted the missing Uncodixify plugin's "performance/bundle analysis" category with: *"`next build` output (route-level bundle sizes already printed)."* That assumption is now **false** for this Next.js version (16.2.10, Turbopack): the per-route "First Load JS" table is not printed at all — confirmed by `grep -rl "First Load JS" node_modules/next/dist/` returning zero matches anywhere in the installed `next` package. The build only prints a route list with a dynamic/static marker (`ƒ`/`○`), no sizes. This is a real, durable gap in that Phase 19 substitution, recorded here rather than silently worked around.

**What was done instead** (no new dependency added — `@next/bundle-analyzer` was deliberately not installed, matching the Phase 19 tooling decision's own "avoid redundant plugins"/no-new-dependency discipline): inspected `.next/static/chunks/*.js` directly by size, then attributed the largest chunks to source via string-signature `grep` and the app-router's own `page_client-reference-manifest.js` files (which chunk id(s) each route actually references).

### 2.2 Bundle size findings (production build, this commit)

Total client JS across `.next/static/chunks`: **3.2 MB**. Largest individual chunks, each confirmed route-scoped (not global) by checking which routes' `page_client-reference-manifest.js` reference them:

| Chunk | Size | Content | Scope confirmed |
|---|---|---|---|
| `1f4g0qbip8rij.js` | 1.3 MB | `three.js` (via `react-force-graph-3d`) | `/graph`, `/works/[workId]/graph` only — `GraphView.tsx` already loads `KnowledgeGraph3D` via `next/dynamic(..., { ssr: false })`. Not referenced by the landing page's manifest. |
| `14dqy86tqa9mm.js` | 444 KB | Next.js/React client runtime (router, hydration) | Global baseline — unavoidable, present on every route. |
| `0o-r482t5g6q0.js` | 348 KB | `pdfjs-dist` | Loaded via a runtime `await import("pdfjs-dist")` inside `PdfReader.tsx` (not a static import), so it is its own on-demand chunk, fetched only when a PDF is actually opened in the reader. |
| `2ad69_7mzo4vm.js` | 292 KB | Writer/ProseMirror + `zod` (citation validation) | Referenced by `writer/[projectId]`'s manifest; **zero** references in the landing page's (`/`) manifest — confirmed via `grep -c` against both manifest files. Scoped to Writer users only. |

All four largest chunks are therefore either an unavoidable framework baseline or already correctly code-split to the one route that needs them — **no bundle-splitting regression found**, consistent with the documented design decision that the 3D graph is deliberately dynamic-imported (`docs/PROJECT-LOG.md` Design Decisions table).

**One real, but low-risk-to-defer, finding:** the Writer chunk's 292 KB includes every locale's translated error-message strings from `zod@4.4.3` (`E-Mail-Adresse`, `IPv4-osoite`, dozens of languages), even though the app never calls a non-English locale. This is because `zod`'s own top-level `index.js` does `export * as locales from "../locales/index.js"`, which re-exports every bundled locale regardless of what a consumer actually imports — traced to `apps/web/src/lib/writer.ts` (`import { z } from "zod"`), which `WriterEditor.tsx` (a client component) imports. **Not fixed here**: the only avoidance path is importing from a narrower `zod` subpath across the app's ~40 `import { z } from "zod"` call sites, which is a broad, behavior-adjacent change (risk of quietly changing which build of zod's validators run) that cannot be verified end-to-end under the measurement freeze, and the actual cost is scoped to one route (Writer), not a severe regression. Flagged as a follow-up opportunity, not a defect.

---

## 3. Measured performance budgets (plan §23.6 "Measure:")

New spec: `apps/web/e2e/performance.spec.ts` — 9 `test()` blocks (one, Visualization, bundles 3 timed sub-assertions: build/render, filter, focus). The plan lists 10 "Measure:" scenarios; 7 are covered by this always-seeded, zero-external-cost spec (no worker, no live AI/bibliographic call — same CI-safety precedent as `graph.spec.ts`/`library.spec.ts`/`roadmap-graph.spec.ts`), 3 require a live worker and/or a paid provider call and are budgeted here but **not** wired into a routinely-run spec (see §3.2).

### 3.1 Covered by `performance.spec.ts` (pending execution — see §5 for the exact command)

| Scenario | Budget | Measured as |
|---|---|---|
| Landing performance | 4000 ms | Time from `page.goto("/")` to the hero `<h1>` visible. |
| Library search | 2500 ms | Time from filling the search box to the filtered result list settling (300 ms client debounce + server round trip, plan §20.1's server-authoritative search). |
| Library search at scale (large-Library query test) | 3500 ms | Same, but the work carries 50 seeded `learning_resource` items. |
| Reader initial render | 4000 ms | Time from `page.goto(".../reader")` to the first paragraph (`[data-paragraph-index="0"]`) visible. |
| Roadmap calculation | 3500 ms | Time from `page.goto(".../roadmap")` to the first ranked item (`[data-roadmap-item]`) visible, over a work with 5 graph-edge targets across distinct relationship categories (recursive-CTE traversal + `@ice/roadmap`'s pure ranking). |
| Visualization build/render | 5000 ms | Time from `page.goto(".../graph?layout=explore")` to the "Visualization" heading visible (includes the `three.js` dynamic-import fetch). |
| Visualization filter | 2000 ms | Time to apply the "Kind" filter and see it reflected. |
| Visualization focus mode | 2000 ms | Time to switch Focus mode ("Full graph") and see `aria-pressed` flip. |
| Visualization at scale (large-graph test) | 6000 ms | Same build/render milestone, over a work with 40 additional seeded graph nodes. |
| Writer autosave | 2500 ms | Time from the last keystroke to the status region reading "Saved" (750 ms debounce in `WriterEditor.tsx` + a PATCH round trip). |
| Trash/delete cleanup | 2000 ms | Time for `POST /api/works/:id/purge` to resolve, on a bare trashed work (no Storage object). |

Every test both asserts the budget (`expect(elapsed).toBeLessThan(...)`, so a severe regression fails the suite) and `console.log`s the exact measured number — the terminal output of a real run **is** the numeric record, not just pass/fail.

Budgets are deliberately generous headroom over a local dev server, not tuned targets — the plan's own words are "prevent severe regressions," not micro-optimize. **First real run should record the actual numbers and, if they land far under budget, tighten the constants** rather than leaving slack that would hide a real 2–3x regression.

### 3.2 Not covered by the routine spec — budgeted, not automated (needs a live worker/provider, real cost)

| Scenario | Budget | Why not automated here |
|---|---|---|
| Large PDF processing | ≤ 5 min from upload to `ready`/`needs_review` | Needs GROBID + a real multi-page PDF; `docs/PROJECT-LOG.md` already documents this pipeline stage can legitimately take several minutes depending on network/API conditions (D-19-6) — folding it into a routinely-run spec would make CI-safe timing meaningless and would cost real GROBID/AI spend on every run. |
| Reprocess | ≤ 3 min from `POST /reprocess` to the new run completing | Needs a real prior run to reprocess against; same live-pipeline cost reasoning. |
| RAG first token | ≤ 3 s from question submit to the first streamed token | Needs a live AI provider call (real $ per invocation, per the project's own cost-cap discipline). |
| RAG completion | ≤ 15 s from question submit to the answer finishing | Same. |

**Manual run procedure, post-freeze, within the standing $1 normal / $5 hard cost caps already authorized for canaries:** upload the private eval fixture (`irwin-vice-and-reason-2001` in the `eval-fixtures` Storage bucket) through the UI, time to `ready`; trigger one `/reprocess`, time to completion; ask one question via **Ask Library** on a work with real indexed chunks, time to first token and to completion via the browser's network panel or a `performance.now()` instrumented click. Record the cost from `ai_usage_logs` afterward and clean up exactly as every other canary in this project's history has (`docs/PROJECT-LOG.md` Changelog).

---

## 4. Resilience drills (plan §23.6 "Run:") — all pending, procedures documented

None of these were executed — every one either needs the live local stack (blocked by the freeze) or is a genuine infrastructure fault-injection exercise that shouldn't be automated into a routine test run. Documented here so they are runnable in one sitting post-freeze, per the plan's own "Run:" list.

| Drill | Procedure | Budget / pass criterion |
|---|---|---|
| **Worker restart test** | Follow `docs/runbooks/render-worker-failure-response.md` §4.4 verification method locally: start the worker (`cd apps/worker && pnpm dev`), enqueue a job, kill the process mid-job (`kill -9`), restart it, confirm the job is either retried (pg-boss `expireInMinutes` window) or manually re-enqueued per the documented `INSERT` pattern (`docs/PROJECT-LOG.md` Known Problems, "A pg-boss job left `active`..."). | Worker resumes listening within 10 s of restart; no job is silently lost past its expiry window. |
| **Database connection recovery** | Stop and restart the local Postgres container (`docker compose restart postgres`) while the web app and worker are running; confirm both reconnect without a manual restart. | Web app requests succeed again within ~30 s of Postgres becoming reachable (Next.js/`postgres.js` pool reconnects automatically); worker resumes job pickup without a process restart. |
| **Provider outage simulation** | Point `OPENAI_API_KEY`/bibliographic API base URLs at an unreachable host (or temporarily unset the key) for one local upload; confirm the pipeline falls back to the deterministic heuristic classifier (already the documented Design Decision fallback) rather than hanging or crashing the job. | Job reaches `analysis_status: complete` (heuristic) or a clearly surfaced `analysis_error`, never an unhandled crash. |
| **Storage failure simulation** | `trash-storage.spec.ts` already exercises a persisted partial-Storage-failure state (`docs/audits` cross-reference: `trash.spec.ts`'s "a persisted storage-failure cleanup state is retried to completion" test) — rerun that spec and additionally point `SUPABASE_URL` at an invalid host for one purge request to confirm the cleanup row records the failure honestly (`lastError` set) rather than silently reporting success. | Purge reports `outcome: "partial"` or equivalent, not `"completed"`, when Storage is unreachable; a retry once Storage is reachable again converges to `"completed"`. |
| **Backup/restore drill** | `docs/PROJECT-LOG.md` records "The local Postgres restore drill is complete" (Phase 7) as a prior drill; re-run the same local `pg_dump`/`pg_restore` cycle against the current schema (migration ledger through `0033`) to confirm it still round-trips cleanly after 12+ migrations' worth of schema growth since that drill. | `pg_restore` completes with no errors; row counts for a sample of tables match pre-dump counts. |
| **Concurrent upload test (single-user limits)** | Open two browser contexts as the same test user, upload two files back-to-back before the first finishes extracting; confirm both complete correctly and no job overwrites the other's `processing_job`/`document` row (the existing `workers: 1` Playwright discipline documents this exact contention risk for the shared local worker — see `docs/PROJECT-LOG.md`'s E2E-serialization Known Problems entry). | Both uploads reach `ready`/`needs_review` independently; no cross-contamination of extracted text or metadata between the two documents. |
| **Large-document ingestion benchmark** | Upload a large multi-hundred-page PDF (or the `eval-fixtures` bucket's fixture, ~3 MB / typical monograph length) and time extraction alone (upload → `processing_status: ready`), separate from the research/classification stages already budgeted in §3.2. | ≤ 60 s for text-layer PDF extraction of a document this size (GROBID page-aware extraction, not OCR). |

---

## 5. Exact commands to run everything above, post-freeze

```sh
# The new performance budget suite (needs web + worker + local Postgres
# already running, per the project's standard E2E prerequisites)
cd apps/web
pnpm exec playwright install chromium   # one-time per machine, if not already done
pnpm test:e2e -- performance.spec.ts

# Full regression alongside it, to confirm nothing else moved
pnpm test:e2e

# Static checks already run and recorded above (safe to re-run any time)
pnpm --filter web typecheck
pnpm --filter web lint
DATABASE_URL="postgresql://user:pass@localhost:5432/build_dummy" \
  AUTH_SECRET="build-dummy-secret-not-real-0123456789" \
  NEXTAUTH_URL="http://localhost:3000" \
  pnpm --filter web build

# Render incident revalidation (read-only, safe to re-run any time,
# does not touch the frozen local stack)
render deploys list srv-d9dgiamrnols73ccpa10 --output json
render logs --resources srv-d9dgiamrnols73ccpa10 --text "SELF_SIGNED_CERT_IN_CHAIN" --output json
render logs --resources srv-d9dgiamrnols73ccpa10 --text "unsupported Unicode" --output json
render logs --resources srv-d9dgiamrnols73ccpa10 --level error --output json --limit 50

# Section 3.2's live/paid measurements — run manually, one at a time,
# within the standing $1/$5 cost caps, and cost-log + clean up afterward
# exactly as every other canary in docs/PROJECT-LOG.md's Changelog.

# Section 4's resilience drills — each has its own command inline above;
# none touch production and none should be run against the frozen stack
# until the freeze lifts.
```

---

## 6. Assumptions surfaced

- The plan's "Measure:"/"Run:" lists are read as the authoritative scope for 23.6 (§23.6 of `palimnote_phases_19_23_plan_revised.md`); no additional scenario was invented beyond what's listed there.
- "Budgets" are read as regression guards ("prevent severe regressions," the plan's own phrase), not tuned performance targets — the numbers chosen are deliberately generous and should be tightened after a first real measurement run, not treated as final.
- Read-only Render CLI checks (§1) were judged to be outside the measurement freeze's scope, since the freeze's stated concern is the shared **local** stack and its local Postgres, not the separate production service; nothing in §1 writes to or restarts anything in production.
- The `zod` locale-bundle finding (§2.2) is documented as a flagged opportunity rather than fixed, because a safe fix touches import sites across the app broadly and cannot be verified end-to-end (typecheck/lint/build alone can't prove client-side validation behavior is unchanged) under the current freeze.
- `docs/project-status.json`'s subphase `23.6` state is left as `in_progress` (not `complete`) — the gate explicitly requires measured budgets and drill results, and §3.2/§4 remain pending real execution.
