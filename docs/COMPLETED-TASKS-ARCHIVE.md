# Completed Tasks Archive — Interactive Critical Edition

Full per-phase completed-task detail, moved out of `docs/PROJECT-LOG.md` on 2026-07-20 to keep that file within a manageable size for every session's context. This is a historical record — nothing here is load-bearing for resuming work; `docs/PROJECT-LOG.md`'s condensed "Completed Tasks" section plus "Current Implementation Status" are the authoritative current-state summary. Phase 9 sub-phases stay in `docs/PROJECT-LOG.md` directly since that work is still active.

## Completed Tasks

**Phase 0:**
- [x] Full implementation plan written and approved (`docs/architecture/plan.md`).
- [x] Reference project inspected via GitHub API; license verdict recorded (no LICENSE file found).
- [x] Filesystem case-sensitivity constraint on the project log's filename verified and documented.
- [x] `git init`, `.gitignore`, `README.md`, `docs/PROJECT-LOG.md`, `.env.example` created and committed (`0b148b6`).
- [x] Private GitHub repo created (`gh repo create --private --source=. --push`), initial commit pushed to `main`.
- [x] `phase-0-complete` tag created and pushed.

**Phase 1a (local foundation):**
- [x] Toolchain bootstrapped on this machine: Node 24 LTS, pnpm via Corepack, Colima + Docker CLI + `docker-compose` plugin (see Known Problems for setup gotchas).
- [x] Repo-local git identity set (`git config --local`, not `--global`).
- [x] pnpm monorepo scaffold: root `package.json`/`pnpm-workspace.yaml`, `apps/web` (Next.js App Router + Tailwind v4 + warm-palette design tokens per plan §19), `packages/db` (Drizzle ORM).
- [x] Local Postgres + pgvector via `docker-compose.yml` (Colima runtime).
- [x] Drizzle schema (Phase 1 scope: `user`/`account`/`session`/`verification_token`/`password_reset_token`) + 2 migrations applied locally.
- [x] Auth.js v5 wired: Credentials provider, bcrypt hashing, `DrizzleAdapter`, JWT sessions + `sessionVersion` revocation (see Design Decisions).
- [x] Signup, email verification, login, password reset flows — pages + server actions + API routes, all tested live against the local dev server (not just typechecked).
- [x] `MailProvider` adapter: `ResendMailProvider` / `ConsoleMailProvider` fallback (verified the console fallback logs a working link when `RESEND_API_KEY` is unset).
- [x] Protected `/dashboard` page (server-side `auth()` check, verified redirects unauthenticated requests to `/login`).
- [x] GitHub Actions CI (`.github/workflows/ci.yml`): lint, typecheck, test, build, against an ephemeral Postgres service container — no external secrets required.
- [x] `phase-1a-complete` tag.

**Phase 1b (real Supabase + Vercel):**
- [x] Supabase org + project created via CLI (personal access token), `pgvector` enabled, Phase 1 migrations applied and verified against the real DB.
- [x] Vercel project created and linked; **Root Directory set to `apps/web`** via the API (see Known Problems — this is required for a pnpm monorepo, `vercel link`/`vercel --prod` from the subdirectory alone silently uploads only that subtree and loses pnpm-workspace context).
- [x] Production env vars set (`DATABASE_URL` = Supabase transaction pooler :6543, `DIRECT_URL` = Supabase direct :5432, `AUTH_SECRET` = freshly generated, distinct from the local dev one, `AUTH_URL`/`NEXT_PUBLIC_APP_URL` = the assigned `*.vercel.app` domain).
- [x] Deployed to production; full auth flow (signup/verify/login/dashboard) re-verified live against https://interactive-critical-edition.vercel.app and the real Supabase DB.
- [x] Test user cleaned up from the production DB after verification.
- [x] `phase-1-complete` tag.

**Phase 2a (Upload and Library, local):**
- [x] Schema: `work`, `edition`, `document`, `processing_job` tables (simplified subset of plan §9 — no shared canonical-work catalog or separate `authors` table yet, see Design Decisions), migration `0002_colossal_zarda.sql`.
- [x] Supabase Storage bucket `documents` created (private, 50MB limit, PDF/TXT/Markdown allowlist).
- [x] `packages/ingestion` created: shared Storage access (`uploadDocumentFile`/`downloadDocumentFile`/`deleteDocumentFile`) + parsers (`parsePdf` via `unpdf`, `parseText` for TXT/Markdown) dispatched by `parseDocument(buffer, mimeType)`.
- [x] `apps/worker` created: pg-boss consumer for the `extract-text` queue, runs the parser, updates `document.processing_status`/`extracted_text`/`extracted_title`/`extracted_author`, tracks attempts/errors in `processing_job`.
- [x] `(app)` route group with a centralized `requireSession()`/`getApiUserId()` auth check (see Known Problems for why these exist instead of raw `auth()` calls) — dashboard, upload, and work-detail pages moved under it.
- [x] Upload flow: dropzone UI (`/upload`) → signed direct Supabase Storage PUT (the browser never sends file bytes through Vercel) → authenticated init/complete routes. It enforces the MIME allowlist, 50MB file cap, 500MB per-user quota, atomically queues extraction, and validates content plus the optional ClamAV seam in the worker before parsing. This avoids serverless request-body limits while keeping uploaded documents private.
- [x] Work detail page (`/works/[workId]`): polls processing status, shows a metadata confirm form once `needs_review`, shows the ready/failed state otherwise; `GET/POST /api/works/[workId]/status` and `/confirm` routes, both 404 (not 403) on another user's work id.
- [x] Dashboard rebuilt as a library listing (work title/author/status, links to each work's page).
- [x] Full flow verified live: register → verify → login → upload (.txt and a hand-crafted text-layer .pdf) → worker extracts text and detects title → confirm metadata → appears in library as "Ready". Also verified: cross-user 404 on both the API and the page route, and all four upload-security rejections (wrong MIME, mislabeled content, empty file, unauthenticated).
- [x] Test data (DB rows and the actual Storage files) cleaned up after verification.
- [x] Migration `0002` also applied to the **production** Supabase DB (the web app is already live — leaving it without the Phase 2 tables would have broken the production upload route the moment it's used, even before Phase 2b's worker exists to consume the queue).
- [x] `phase-2a-complete` tag.

**Phase 2b (Render worker deployment):**
- [x] Render CLI installed; `render login`'s browser flow doesn't work in this sandbox (no TTY, same as Supabase/Vercel) — used a personal access token (`RENDER_API_KEY` env var) instead, which the CLI supports natively for non-interactive use.
- [x] GitHub connected to Render (dashboard OAuth step, done by the user — Render can't fetch even its own now-authorized repos without this, distinct from Vercel's model).
- [x] Payment method added (dashboard, done by the user — Render's free tier doesn't support persistent background workers, confirmed exactly as the plan predicted; a card is required before any paid-plan service can be created at all, not just at billing time).
- [x] Background worker service created via `render services create` (`srv-d9dgiamrnols73ccpa10`, `starter` plan, `virginia` region, Node runtime, build `corepack enable && pnpm install --frozen-lockfile`, start `pnpm --filter worker start`), auto-deploy from `main` enabled.
- [x] Production env vars set via the Render REST API (`PUT /v1/services/:id/env-vars` — the CLI's `services update` has no env-var flag): `DATABASE_URL` (Supabase pooler), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`.
- [x] First deploy crashed (`tsx --env-file=.env` errors when `.env` doesn't exist, and it never will on Render — env vars come from the platform directly). Fixed by switching both `dev` and `start` scripts to `tsx --env-file-if-exists=.env`, tested locally both with and without the file present, then pushed (auto-deploy picked it up).
- [x] Full production pipeline verified live end-to-end: registered/verified/logged in against the production web app, uploaded a `.txt` file, confirmed via Render's logs that the **Render worker** (not a local process) picked up the job and extracted the text, confirmed the metadata through the production API, and saw the correct `needs_review` → confirmed state. This is the whole real deployed system working together, not a partial/local-only check.
- [x] Test data (production DB user — cascades to work/document/processing_job — and the Storage file) cleaned up after verification.
- [x] `phase-2-complete` tag.

**Phase 3 (Reader):**
- [x] Schema: `documents.last_position` (jsonb) added; new `footnote`, `highlight`, `note`, `bookmark` tables. Migration `0003_broad_blade.sql`, applied to both local and production Postgres.
- [x] Heuristic footnote detector (`packages/ingestion/src/parsers/footnotes.ts`): finds a trailing block of consecutive numbered lines and keeps only entries whose number also appears as an in-body `[N]`/`(N)` marker earlier in the text — the in-body cross-check is what actually guards against false positives (e.g. a table of contents), not the run length. Wired into `apps/worker` for `text/plain`/`text/markdown` documents only (see Remaining Tasks re: PDF).
- [x] `getSignedDocumentUrl()` added to `packages/ingestion/src/storage.ts` for client-side PDF fetching (signed, time-limited, never a public bucket URL).
- [x] Full reader feature under `apps/web/src/app/(app)/works/[workId]/reader/`: quote-anchored highlight system (`highlightDom.ts` — text-fingerprint via quote+prefix+suffix context, not raw coordinates, so highlights survive re-render/reflow — plan §25 risk R3), `TextReader.tsx` (paragraph reader, footnote markers, IntersectionObserver reading-position tracking, selection-to-highlight UI), `PdfReader.tsx` (pdfjs-dist canvas+text-layer rendering, page nav, highlight application to the text layer), `ReaderShell.tsx` (orchestrator: theme/font-size/line-width/distraction-reduced-mode state, dispatches Pdf/TextReader, split-pane via a recursive embedded `ReaderShell`), `NotesSidebar.tsx`, `WorkPicker.tsx` (split-pane work selector).
- [x] Full reader REST API under `apps/web/src/app/api/works/[workId]/reader/`: main GET (document + footnotes + highlights + notes + bookmarks + last position + signed PDF URL), `position` (POST), `highlights`/`notes`/`bookmarks` CRUD (list + per-id delete), all via `getApiUserId()` + `getOwnedDocument()` (404, not 403, on another user's work — consistent IDOR posture with Phase 2). New `GET /api/works` listing the user's ready works, for the split-pane picker.
- [x] `apps/web/src/lib/auth.ts` centralized further with `requireSession()`/`getApiUserId()` used throughout the new reader routes (see Known Problems for why these exist instead of relying on type-augmented `auth()` calls directly).
- [x] pdf.js worker script vendored as a static file (`apps/web/public/pdf.worker.min.mjs`) instead of resolved via `import.meta.url`, for reliability under Turbopack; excluded from ESLint via `globalIgnores` (see Known Problems for the re-copy-on-upgrade maintenance note).
- [x] Playwright installed and configured (`apps/web/playwright.config.ts`, runs against an already-running local stack — not CI-wired yet, see Remaining Tasks). Two full E2E specs (`apps/web/e2e/reader.spec.ts`), both passing: (1) upload → open reader → click footnote marker → select text → highlight → add note → add bookmark → scroll → reload → confirm reading position and highlight both survive the reload (a real re-render, not just in-memory state); (2) split-pane opens a second work alongside the first and closes cleanly.
- [x] `apps/web/e2e/helpers.ts`: `createVerifiedTestUser`/`deleteTestUser` fixtures; `deleteTestUser` purges the user's Supabase Storage files (not just DB rows — the DB cascade has no knowledge Storage objects exist) after discovering 16 orphaned files from earlier manual + first-run test uploads, which were swept and deleted once confirmed no real users existed in either DB.
- [x] Bug fixed in the initial footnote heuristic: a single-footnote document (`Notes\n\n1. ...`) was silently detected as zero footnotes because the original code required a run of 2+ consecutive numbered lines. Removed that requirement (the in-body-marker cross-check already prevents false positives on its own); verified via a manual `tsx` script against three cases (single-footnote now detected, multi-footnote still detected, false-positive table-of-contents still correctly empty) plus the full Playwright suite re-passing. Committed (`ae9cfd6`), pushed, CI confirmed green (run `29633299747`), Render worker redeployed and confirmed live.
- [x] Test data (DB rows and Storage files, both local and production) cleaned up after every verification pass.
- [x] `phase-3-complete` tag.

**Phase 4 (Scholarly Analysis):**
- [x] Schema: `bibliographic_record`, `citation`, `annotation`, `graph_edge`, `ai_usage_log` tables; the 10-category `relationship_category` enum; `verification_status`/`provenance_source`/`access_status`/`edge_type`/`analysis_status` enums; `document.analysis_status`/`analysis_error`. Migration `0004_real_anthem.sql`, applied to local and production.
- [x] `packages/ai-adapters`: `LLMProvider` interface + fetch-based `OpenAIProvider`/`AnthropicProvider` (no SDK dep), cost-first task routing with env-overridable model IDs and per-call cost estimation, deterministic `heuristicClassify` fallback, `classifyRelationship()` entrypoint (real model when a key is set, else heuristic — provenance always honest). `CLASSIFY_PROMPT_VERSION` stored on every annotation.
- [x] `packages/bibliographic`: keyless `CrossrefSource`/`OpenAlexSource`/`OpenLibrarySource` behind one `BibliographicSource` interface; `resolveCitation()` tries them in order with a title-overlap confidence guard; unmatched citations stay unresolved (never guessed).
- [x] `packages/ingestion`: heuristic `extractCitations()` (reference-section entries + inline author–year), the cheap first stage of the two-stage pipeline.
- [x] `apps/worker`: `analyze-work` queue + `analyzeWork()` pipeline — extract citations → resolve bibliographically → anchor (text docs) → classify → write `annotations`/`citations`/`graph_edges`/`ai_usage_logs` with full provenance; idempotent re-runs preserve user edits.
- [x] Analysis enqueued automatically on metadata-confirm (work → ready); manual re-trigger via `POST /api/works/[workId]/analyze`.
- [x] Reader API: main GET now returns annotations + analysis status; `GET .../reader/annotations` (polling), `PATCH .../reader/annotations/[id]` (approve/dispute/reject/hide/edit) — all IDOR-safe (404 not 403).
- [x] Reader UI: `AnnotationsPanel` (category glyph+label+color, target + access status, always-visible confidence, honest provenance, verbatim source passage, correction workflow, 10-category legend, non-dismissible AI-research-aid disclaimer, analysis-status badge with live polling, re-analyze); inline category-colored superscript markers in `TextReader` (single-point insertion coexisting with the highlight layer) that open the corresponding annotation.
- [x] Vitest added (root `test` script was a no-op until now); 23 unit tests across the three new packages, all passing.
- [x] Playwright E2E (`apps/web/e2e/annotations.spec.ts`) covering upload → confirm → analysis → category-coded annotations → approve → reload-persistence. Fixed a real ordering bug (confidence-tie instability) surfaced by it; raised the suite's test timeout/retries for the live-API load (see Known Problems).
- [x] Fixed the worker `dev` script arg order (`tsx watch` must precede flags on tsx 4.23.1); `start` was unaffected so production was never impacted.
- [x] Verified through the deployed system: migration applied to prod via the Supabase Management API (Vercel stores the DB URLs as Sensitive, so `vercel env pull` couldn't provide them — see Known Problems); web deployed to Vercel, worker auto-deployed to Render; seeded a ready doc in prod, logged in on the live site, triggered `/analyze`, confirmed the production worker resolved citations against live Crossref and wrote 2 annotations (`analysis_status: complete`); all prod test data cleaned up.
- [x] `phase-4-complete` tag.

**Phase 5 (Reading Roadmap, Knowledge Profile, 3D Graph):**
- [x] Schema: `reading_records`, `understanding_ratings`, `roadmap_overrides` + `reading_status`/`priority_tier` enums. Migration `0005_lazy_black_knight.sql`, applied local and production. (No `reading_roadmaps`/`roadmap_items` snapshot tables — roadmap is computed on demand, see Design Decisions.)
- [x] `packages/roadmap`: pure `rankRoadmap()` — category→tier mapping, graph-centrality tiebreak, known/completed deprioritization ("review only"), concise/comprehensive mode, beginner/intermediate/advanced expertise filter, greedy time-budget pass, manual overrides (hide/tier-pin/position-pin). 14 unit tests incl. the Heidegger and Vico acceptance cases (plan §13 step 9).
- [x] `apps/web/src/lib/roadmap.ts`: recursive-CTE traversal over `graph_edges` (transitive through normalized-title-matched owned works) feeding `rankRoadmap`; verified against the real DB.
- [x] `apps/web/src/lib/graph.ts`: per-user knowledge-graph builder (works + referenced readings, with read/reading/unread/missing state) for both the 3D view and the table.
- [x] API: `GET /works/[workId]/roadmap` (compute, with mode/expertise/maxMinutes params), `POST /works/[workId]/roadmap/item` (upsert understanding rating / reading status / override), `GET /works/[workId]/graph` (work-scoped) and `GET /api/graph` (global). All IDOR-safe.
- [x] Roadmap UI (`RoadmapView`): tier-grouped ranked sequence, per-item understanding slider + reading-status + hide, depth/level/time-budget filters that recompute. Linked from the work page.
- [x] Graph UI (`components/graph/*`): `GraphView` orchestrator with a 3D⇄table toggle (table default), `KnowledgeGraph3D` (react-force-graph-3d, dynamic ssr:false, restrained), `GraphAccessibleFallback` (sortable/filterable/keyboard+SR table — plan §20), legend, stats, node detail. Work-scoped page + global `/graph` page. Linked from dashboard + work page.
- [x] Vitest total now 37 (12 ai-adapters + 6 bibliographic + 5 ingestion + 14 roadmap); typecheck/lint/build clean.
- [x] Playwright `roadmap.spec.ts` through the full stack, passing. Fixed a real bug it surfaced: drizzle expands a JS array to a param list `($1,$2)`, valid for `IN` but not `= ANY(...)` — both raw queries switched to `IN` (had been silently returning empty roadmaps/graphs). E2E suite serialized (`workers: 1`) to stop parallel spec files piling analysis jobs on the one shared worker.
- [x] Deployed: migration `0005` applied to prod via the Supabase Management API; web deployed to Vercel; new routes verified live and auth-gated. `phase-5-complete` tag.

**Phase 6 (Landing Page & Onboarding):**
- [x] Public landing page (`app/page.tsx`): warm scholarly design (serif display + Geist + the existing palette) — hero, three capability showcases (annotated reader / roadmap / knowledge graph) with **restrained static** illustrations (a passage+annotation card, tiered roadmap, hand-authored SVG graph sketch — deliberately NOT the WebGL 3D, per plan §19), how-it-works, researcher-vs-newcomer, a reliability/privacy section, and CTAs. Shared `SiteHeader` (adapts to signed-in state) + `SiteFooter`.
- [x] Policy pages: `/privacy` (data storage, isolation, copyright/BYO-texts, AI handling, deletion/export, research-aid disclaimer) and `/terms` — plain-language, plan §15.
- [x] Onboarding: `users.preferences` jsonb (migration `0006`); a skippable `/welcome` step capturing expertise level (seeds the roadmap's default) with a first-upload nudge; `completeOnboardingAction` stamps `onboardedAt`; the dashboard routes new users through `/welcome` until then; the roadmap page defaults its level to the stored expertise.
- [x] `@axe-core/playwright` added; `landing.spec.ts` (content + WCAG 2A/2AA scan, zero violations) and `onboarding.spec.ts` (first-login routing → complete → library) both passing. Landing verified visually via screenshot.
- [x] Deployed: migration `0006` applied to prod (Management API); web deployed to Vercel; live landing/policy/welcome routes verified. `phase-6-complete` tag.

**Phase 7 (Hardening & Deployment):**
- [x] Security — authorization-bypass matrix (`e2e/security.spec.ts`, plan §21/§25 R5): an authenticated attacker gets **404 on all 16** read/write routes for another user's work, and **401** on 5 unauthenticated. Added `seedOwnedWork()` fixture. Prompt-injection hardening in `classify.ts` (fenced + triple-quote-stripped source text, enum-constrained output) with a test proving an injection payload can't drive the classifier. Upload-security checks were already in place from Phase 2.
- [x] AI-reliability eval harness (`ai-adapters/eval.test.ts`, plan §21): gold-standard citation→category cases with an accuracy gate on the heuristic baseline — the promotion gate for when a real model is wired.
- [x] Admin dashboard (`/admin`, plan §20): platform counts, the AI usage/cost view over `ai_usage_logs`, processing-job health + recent failures. Env-allowlist gating (`ADMIN_EMAILS`) with a 404 for non-admins; admin nav link shown only to admins. `ADMIN_EMAILS` set in prod to the owner's email.
- [x] Error-reporting seam: `@ice/observability` `reportError()` (Sentry-ready, structured local fallback), wired into the worker's extract/analyze failures and the web upload route.
- [x] Performance: 15 indexes (migration `0007`) on the hot filter/join columns (graph_edges by user+source / user+target, per-document reader + annotation tables, work/document by owner, Phase 5 profile tables). Applied local + prod.
- [x] CI now runs the CI-safe E2E specs (landing/onboarding a11y + the authorization matrix — web + Postgres, no worker/live APIs) after build; verified green in CI. Analysis/reader/roadmap specs stay manual (documented).
- [x] Recovery drill: materialized the `phase-5-complete` tag in a git worktree and confirmed it installs (`--frozen-lockfile`) and typechecks — a genuine restore point (plan §23 "restore from an earlier tagged checkpoint").
- [x] README overhaul (feature overview, built stack + package list, test/E2E workflow); docs/PROJECT-LOG.md brought current.
- [x] Deployed: migration `0007` applied to prod; web + worker deployed; `/admin` live and auth-gated. `phase-7-complete` tag.
- [ ] **Honest gaps (need real infra / manual effort, documented not silently skipped):** a *manual* screen-reader (VoiceOver) pass — only the automated axe scan (zero violations) was run; a k6 load test — indexes landed as the perf improvement but no load run; real Sentry — the seam is wired but no DSN is provisioned (structured local logging until then); a live DB backup/restore drill — Supabase's managed backups cover this and the git-checkpoint recovery was done, but a point-in-time DB restore wasn't exercised.

**Post-Phase-7 operational verification:**
- [x] Restored and verified authenticated CLI access for GitHub (`gh`, including repo/workflow scopes), Supabase, Vercel, and Render. Credentials remain in the tools' own secure stores/Keychain, never the repository.
- [x] Re-ran the implemented product surface: all 40 Vitest tests, all 9 Playwright tests, typecheck, and the production build passed. Real OpenAI (`gpt-4o-mini`) and live bibliographic API calls succeeded.
- [x] Re-tested the deployed system with a dedicated verified non-admin acceptance account: browser login succeeded; a real PDF upload reached `needs_review` through the production Render worker in about four seconds with no processing error. The account/data remain only for the user's current manual acceptance pass and need explicit cleanup afterward.
- [x] Audited the production integrations without exposing values: migration ledger is current through `0007`; required Render/Vercel environment-variable names are configured; worker and web deployments are live; local and GitHub `main` matched before this documentation update.
- [x] Found one reproducible auth UX defect during negative-path testing: an invalid password lets `InvalidCredentialsError` escape from `apps/web/src/lib/auth.ts` through `apps/web/src/lib/actions.ts`, producing an error response/runtime failure instead of returning the login form's friendly “Invalid email or password” state. Correct credentials still work locally and in production. Tracked first in Remaining Tasks below; not silently treated as passing.

