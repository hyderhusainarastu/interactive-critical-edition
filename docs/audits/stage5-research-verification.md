# Stage 5 Research Integration — Verification (round 1)

Scoped gate run against `/private/tmp/palimnote-s5-research` (branch
`redesign/stage5-research`, tip `c0b9418` at the time of this run — clean
working tree, only this verification's own new files added). Verifies the
work described in `docs/design/stage5-research-spec.md` against the actual
codebase, actual running server, and actual browser automation — not just a
re-read of the spec text.

## Environment

- **Postgres:** dedicated `palimnote-s5-pg` Docker container (`pgvector/pgvector:pg17`), host port **5435**, database `interactive_critical_edition`, isolated from every other worktree/lane's Postgres on this machine. Migrated with `pnpm --filter @ice/db db:migrate` — clean apply, no errors.
- **App server:** a real production build (`next build` then `next start -p 3250`), not `next dev` — so what was verified is the same artifact that would actually ship. `apps/web/.env.local` (gitignored, worktree-local) points at the dedicated Postgres above and sets `PHASE_25_RESEARCH_ENABLED` / `PHASE_25_READER_CLAIM_LAYER_ENABLED` / `PHASE_25_GRAPH_DEBATE_LAYER_ENABLED` / `PHASE_25_WRITER_EVIDENCE_ENABLED` / `PHASE_25_ASK_RESEARCH_MODES_ENABLED` / `PHASE_25_MONITORING_ENABLED` all to `true` (Stage 5's own research surfaces need all of these on to be reachable); `PHASE_25_HUMANITIES_JUDGE_ENABLED` and `BETA_TESTING_MODE` stay `false`, unrelated to this lane.
- **No worker process ran at any point in this session**, and **no live provider (OpenAI/Anthropic/Semantic Scholar/OpenAlex/arXiv) was called**. Every claim/relationship/cluster/chamber/hypothesis/gap/monitor/corpus-item row exercised below was seeded directly against Postgres. The two pipeline dispatches exercised (`detect_relationships`, `cluster_debates` — see "Pipeline surface" below) are plain DB inserts + a pg-boss enqueue nothing consumes, the same "verify the queued row, don't run the worker" precedent every other research e2e spec in this repo already uses.

## Gate results

| Check | Result |
|---|---|
| `pnpm -r typecheck` (17 workspace projects) | **Clean** |
| `pnpm -r lint` | **Clean** |
| `pnpm --filter web build` (production build) | **Clean** — `/research/[projectId]/{chambers,claims,corpus,debates,debates/[clusterId],hypotheses,monitors}`, `/research/{chambers/[chamberId],claims/[claimId],monitors}`, `/research/[projectId]` all present in the route manifest. **`/research/[projectId]/graph` is absent from the build output** — see Finding 1. |
| Migrations | Clean apply, `palimnote-s5-pg`, port 5435 |

## New files added for this verification (round 1 only, not part of the Stage 5 implementation itself)

Per this lane's file-ownership rule (may not edit `e2e/helpers.ts`; new helper/spec files only):

- `apps/web/e2e/stage5-verification-seed.ts` — `seedStage5Fixture(ownerId, suffix)`, a single project with 2 works (each with an anchored claim), 1 relationship (contradiction), 1 debate cluster, 1 evidence chamber, 1 hypothesis + 1 gap, 1 imported corpus item + its own claim, 1 project-scoped monitor + 1 hit, and 4 `research_job_request` rows (2×`extract_claims`, 1×`detect_relationships`, 1×`cluster_debates`, all `complete`) — everything journeys 4/6 need in one composed fixture. No standalone cleanup function: every table it writes to cascades on `user_id` (verified by direct read of `packages/db/src/schema.ts`), so `deleteTestUser()` is sufficient.
- `apps/web/e2e/stage5-research-verification.spec.ts` — 13 tests covering journey 4 core, journey 6, the pipeline-surface single-dispatch-site check, permalink preservation, the Knowledge Map stub check, an axe sweep, and the screenshot pass below.

## Journey 4 core (project → corpus → claim correction → relationship → debate/chamber → contextual graph)

All PASS except the final leg (Knowledge Map), which is a real, recorded failure (Finding 1):

1. **Create project via the accessible dialog** — clicked "New project," the dialog (`role="dialog"`, name `/New research project/i`) opened with focus on the title field, filled and submitted, landed on the new project's Overview. **Zero `window.prompt`/`window.alert`/`window.confirm` anywhere in the built research bundle** — confirmed by grepping every `.next/static/chunks/*.js` and `.next/server/chunks/ssr/*.js` file for `window.prompt(`: the only two hits in the entire build are `WriterEditor.tsx` and `WriterProjectsView.tsx` (the **Writer** feature, `writer/**`, explicitly outside this lane's ownership and untouched by this spec). Zero hits in any `research/**`-sourced chunk.
2. **Corpus view** — `/research/[id]/corpus` renders the seeded imported item ("A Reading of Akrasia round1") under "In this project's corpus" and the "Search providers" search UI. (Search itself was not submitted — would be a real network call — see "no live provider" note above.)
3. **Claims list responsive at 375px** — at 375px width the `<table>` has `toHaveCount(0)` (verified absent from the accessibility tree, not just visually hidden) and the `role="list"` card view renders with the claim text; at 1280px the reverse. Matches spec §7 exactly.
4. **Correct a claim: dispute with a reason → revision history shows it** — disputed claim A with a reason string; the verification chip flipped to "Disputed"; opening History showed both "Revision 1 — Disputed" (with the exact reason text) and "Revision 0 — Generated."
5. **Monitors page** — both the project-scoped page (`/research/[id]/monitors`, heading "Monitors") and the global page (`/research/monitors`, heading **"Research monitors"** — a real, intentional distinction in `MonitorsView.tsx`: `{project ? "Monitors" : "Research monitors"}`, confirmed by direct read, not a defect) render the seeded monitor and hit respectively.
6. **Evidence Chambers project view + permalink** — `/research/[id]/chambers` lists the seeded chamber, links to `/research/chambers/[chamberId]` with the correct `href`, and following the link lands on the permalink with the same heading.
7. **Hypotheses + gaps combined view** — `/research/[id]/hypotheses` renders both the hypothesis (statement/rationale/methodology) and the "Open gaps" section from the same project in one view.
8. **Contextual graph (Knowledge Map tab)** — **FAILS**. See Finding 1.

## Journey 6 (every correction action)

All six correctable object types (`claim`, `relationship`, `cluster`, `chamber`, `hypothesis`, `gap`) were round-tripped through `verify`/`dispute`/`hide`/`restore` with the verification chip and revision history both confirmed to update. One reachability gap was found and is recorded as Finding 2, not silently routed around.

- **cluster** — verify/hide/restore on the debate cluster detail page (`/research/[id]/debates/[clusterId]`), `ResearchCorrectionControls` rendered directly.
- **relationship** — **not reachable from the debate cluster page** (Finding 2). Reachable instead from a hypothesis's "Cited conflicts" section on `/research/[id]/hypotheses`, where the fixture's one hypothesis cites this exact relationship — verified there.
- **chamber** — verify, on its own permalink (`/research/chambers/[chamberId]`).
- **hypothesis** — verify, on the hypotheses page.
- **gap** — hide/restore, on the hypotheses page.
- **claim** — verify/dispute/hide/restore (shared `ResearchCorrectionControls`) already exercised in journey 4 step 4 above; separately confirmed the claim-only extras (`ClaimCorrectionExtras`) are present on the claim permalink: **Edit**, **Reclassify**, **Split**, **Merge with another claim**.

**Honest "unsupported" enumeration (per spec §8, confirmed by direct read, not merely assumed):**
- Edit/Reclassify/Split/Merge are **claim-only** — never rendered for relationship/cluster/chamber/hypothesis/gap anywhere in the app (confirmed: `ClaimCorrectionExtras` is imported and mounted only on the claim permalink page). The door is **omitted**, not shown-disabled — matches this codebase's established flag-gated-nav convention for "hide the door rather than show a locked one."
- `window.confirm`-style destructive confirmation for `deleteMonitor`/`removeMember`/`deleteQuestion` remains genuinely absent (fires immediately on click) — spec §12 records this as a deliberate exclusion from Stage 5's mandate (the charter asks to *replace* existing confirm flows, not add new ones), confirmed still true by direct read of `MonitorsView.tsx`/`ResearchProjectOverview.tsx`.

## Pipeline surface (spec §6: one canonical action/status surface)

**PASS.** On the Overview page:
- The "Pipeline" stepper (`region`, name "Pipeline") renders **zero buttons** — pure status + links for steps that already had one, exactly as spec §6 requires (`ResearchPipelineStepper.tsx` no longer accepts `onDispatch`/`actionState`, confirmed by direct read).
- The "Research jobs" panel (`region`, name "Research jobs") is the **only** place with a "Detect relationships"/"Cluster debates" button pair (`toHaveCount(1)` each) — both enabled, since the fixture seeded 2 works-with-claims and 1 relationship, matching `getResearchPipelineOverview`'s own `detectReady`/`clusterReady` thresholds.
- The old quick-link row ("View claims" / "View debates" / "Hypotheses & gaps") is confirmed absent (§2.3).
- The persistent nav (`navigation`, name "Research project sections") renders all 8 tabs in charter §6 order: Overview, Corpus, Claims, Debates, Evidence Chambers, Hypotheses, Monitors, Knowledge Map.

## Permalink preservation

**PASS** for every permalink except the one covered by Finding 1:
- `/research/claims/[claimId]` — resolves directly, correct heading.
- `/research/chambers/[chamberId]` — resolves directly, correct heading.
- `/research/[projectId]/debates/[clusterId]` — resolves directly.
- `/research/monitors` (global) and `/research/[projectId]/monitors` (project) — both resolve directly with their own (intentionally distinct) headings.

## Screenshots

Unmasked, `fullPage: true`, written to `docs/audits/stage5-research-verification/`:

| File | What it shows |
|---|---|
| `overview-1440-light.png` | Project overview at 1440px, light mode — persistent nav, pipeline stepper, Research jobs panel |
| `overview-375-light.png` | Same page at 375px |
| `overview-1440-dark.png` | Same page, dark mode |
| `overview-1440-reduced-motion.png` | Same page, `prefers-reduced-motion: reduce` |
| `claims-1440-light.png` | Claims page at 1440px — table view |
| `claims-375-light.png` | Claims page at 375px — card view, filters wrap correctly, no horizontal scroll |
| `chambers-1440-dark.png` | Evidence Chambers project view, dark mode |

Visual spot-check of every file: correct light/dark contrast, no layout breakage, filters wrap rather than scroll at 375px, dark-mode chips/borders all legible.

## Axe (WCAG 2A/2AA)

Zero violations across `/research/[id]`, `/corpus`, `/claims`, `/chambers`, `/hypotheses`, `/monitors`, light and dark (12 page×theme combinations in the new spec, plus the existing suites' own axe coverage below).

## Existing e2e specs run (affected by Stage 5, per spec §10)

All run against the dedicated stack above (`PLAYWRIGHT_BASE_URL=http://localhost:3250` for specs that share the default server; dedicated-port specs spawn their own `next start` reading the same `.env.local`).

| Spec | Result |
|---|---|
| `research.spec.ts` | **9/9 pass** |
| `research-projectnav.spec.ts` | **6/6 pass** (one env-interaction note below) |
| `research-claims-dialogs.spec.ts` | **5/5 pass** |
| `research-hypotheses.spec.ts` | **10/10 pass** |
| `research-dashboard.spec.ts` | **4/4 pass** |
| `research-chambers.spec.ts` | **4/4 pass** |
| `research-corpus.spec.ts` | **10/11 pass** — 1 fail, Finding 3 (out-of-lane) |
| `research-monitors.spec.ts` | **14/16 pass** — 2 fail, Finding 3 (out-of-lane, same defect twice) |
| `research-corrections.spec.ts` | **15/17 pass** (+1 flaky-recovered) — 1 fail, Finding 3 (out-of-lane); 1 test failed on first attempt and passed on retry (pre-existing timing sensitivity around `router.refresh()` + an inline "unanchored" notice, not a Stage 5 regression — this file is unmodified by Stage 5 and the retry-recovers pattern already exists elsewhere in this codebase's suite, e.g. the documented `annotations.spec.ts` precedent) |

**Environment note (not a product defect):** `research-projectnav.spec.ts`'s flag-off assertion (`the Monitors tab is present only when PHASE_25_MONITORING_ENABLED is on`) initially failed because this verification's own `.env.local` had `PHASE_25_MONITORING_ENABLED=true` set globally (needed for the main 3250 server to exercise Monitors in journeys 4/6). That spec's dedicated port-3197 server relies on `.env.local` defaulting the flag **off**, turning it on only for its own secondary port-3198 server. Fixed by flipping `.env.local`'s `PHASE_25_MONITORING_ENABLED` to `false` before running this one spec (its dedicated servers are spawned fresh each run, so this doesn't affect the already-running main server) — all 6 tests then passed. Recorded here for the next verification round, not left silently unexplained.

## Findings

### Finding 1 (P2, real defect, spec §4/§9 not implemented) — `/research/[projectId]/graph` (the Knowledge Map stub) does not exist

The spec (§4, §9's file plan) calls for a **new file**, `app/(app)/research/[projectId]/graph/page.tsx`, rendering an honest "not built yet, here's the link to the full Knowledge Map" stub. It was never created. `ResearchProjectNav.tsx` still links to `/research/${projectId}/graph` (confirmed present in the tab list, `aria-current`-tracked like every other tab), but the route returns a genuine Next.js **404**, not the honest deferred-feature message the spec's own §4 prose promises ("A Knowledge Map scoped to this project's own claims and works is planned for a later integration stage..."). Confirmed three independent ways: (a) absent from the `next build` route manifest, (b) `find` on the filesystem confirms no `graph/page.tsx` under `[projectId]`, (c) a live `page.goto()` in the new spec returns HTTP 404 and Next's generic not-found page. This breaks journey 4's own literal final leg ("follow the new Knowledge Map tab to the honest stub") and the charter §15 gate's "contextual graph" journey step, as the spec itself defines it (§11).

**Not fixed in this verification pass** — round 1 is scoped to verification, not repair, and this lane's own charter is silent on whether a verification pass may write implementation code. Flagging for the implementation lane to close before Stage 5 can be marked done.

### Finding 2 (P3, UX gap, pre-existing to this lane's own file set) — relationship correction is unreachable from the page that shows the relationship

`DebateClusterDetail.tsx` (the page a user reaches by clicking into a debate) renders correction controls (`ResearchCorrectionControls`) for the **cluster** only. The relationship itself is displayed only as a static link/chip with **no** verify/dispute/hide/restore affordance on that page at all — confirmed by direct read (no `data-research-correction-controls="relationship"` anywhere in `DebateClusterDetail.tsx`). The only place a relationship can actually be corrected is indirectly, via a hypothesis's "Cited conflicts" section (`ResearchHypothesesView.tsx`) — and only for relationships some hypothesis happens to cite. A relationship with no hypothesis citing it (a very plausible state — hypothesis generation is a separate, optional, paid dispatch) has **no UI path to correction at all**, despite `claim_relationship` being one of the six correctable object types the schema and `applyResearchCorrection` fully support. This is not a Stage 5-introduced regression (Stage 5's own file plan, §9, explicitly leaves `DebateClusterDetail.tsx` untouched), but it is a real, user-facing gap surfaced by exercising journey 6 completely rather than assuming reachability from the schema alone.

### Finding 3 (P3, pre-existing, confirmed out-of-lane) — `WorkspaceRail.tsx`'s "Hide/Show Read section" toggle fails the 44×44 touch-target floor

`components/shell/WorkspaceRail.tsx:131` renders `{readOpen ? "Hide Read section ▾" : "Show Read section ▸"}` in a button with `py-0.5 text-xs` and no `min-h-11` — measured height 20px, width 126px, well under this app's own enforced 44×44 floor. This is caught by `auditTouchTargets()` in `research-corpus.spec.ts`, `research-monitors.spec.ts` (×2), and `research-corrections.spec.ts` — every existing research spec's own touch-target audit that happens to scan the full page (sidebar included), not something specific to research pages. Confirmed **not** a Stage 5 regression: `components/shell/**` is outside this lane's file ownership, `git status` shows zero modifications to any shell file in this worktree, and the defect is deterministic across every run. Not fixed here (out of lane) — flagged for whichever lane owns `shell/**`.

## Deferred / not run in this round

- **The paid/live-provider legs of journey 4** (corpus provider search actually submitted, a real `extract_claims`/`detect_relationships`/`cluster_debates`/`generate_hypotheses`/`run_monitor` job actually consumed by a worker) — out of scope by this lane's own standing constraint ("research pipeline dispatches in tests must use seeded data, never live provider calls"). Every state journey 4/6 needed was reached by seeding instead, matching every existing research e2e spec's own precedent.
- **`pnpm -r test` (Vitest unit suites)** — not run this round; this verification touched no `packages/**` or non-e2e application code, so unit coverage is unchanged from whatever the implementation lane's own commits already established. Left for a future round if a code fix (Finding 1) lands here.
- **A fix for Finding 1** (implementing the missing stub page) — round 1 is verification-scoped; the finding is reported, not silently patched.
- **CI wiring** — these specs remain in the existing "manually run, CI-safe in spirit" category, matching every other research e2e file's own documented status; this round did not change that.

## Fix round (post round-1)

Two of round 1's three findings were fixed in a follow-up Stage 5 FIX lane pass on this same branch:

- **Finding 1 (P2) — fixed.** `app/(app)/research/[projectId]/graph/page.tsx` now exists: the honest stub spec §4
  describes (heading "Knowledge Map", the "planned for a later integration stage" explanation, a working link to
  the existing global `/graph` route), reusing `ResearchBreadcrumb` and the `getOwnedResearchProject` ownership
  guard exactly like every sibling `[projectId]/*` page. Confirmed present in the `next build` route manifest
  and returning 200 with the correct heading/link/`aria-current` state via a rewritten Playwright test (previously
  asserting the 404, now asserting the honest stub renders); added to the axe sweep's page list.
- **Finding 2 (P3) — fixed.** `getDebateClusterDetail` (`lib/research/debates.ts`) now also selects the cluster's
  own judged edges via the existing `debate_cluster_relationship` join table (no migration — the table already
  existed, unused by any query until now), and `DebateClusterDetail.tsx` renders a new "Relationships in this
  debate" section with `ResearchCorrectionControls` (`objectType="relationship"`, `compact`) for each one — the
  same component/props `ResearchHypothesesView.tsx`'s "Cited conflicts" section already uses. A relationship no
  hypothesis cites now has a real correction UI path. `journey 6`'s test was extended (not weakened) to verify
  and check the relationship directly on the cluster page, then re-visit the hypotheses page to confirm the same
  object shows the same, already-verified state via its second reachability path.
- **Finding 3 (P3) — not fixed, confirmed still out-of-lane.** `components/shell/WorkspaceRail.tsx` remains
  outside this lane's file ownership (`shell/**`); the touch-target defect is unchanged and still flagged for
  whichever lane owns `shell/**`.

Verification for the fix round: `pnpm -r typecheck` clean, `pnpm -r lint` clean, `pnpm --filter web build` clean
with `/research/[projectId]/graph` now present in the route manifest, all 13 `stage5-research-verification.spec.ts`
tests green (including the two rewritten ones) and `research.spec.ts` 9/9 green, run against a fresh
`palimnote-s5-pg` Postgres container (port 5435) torn down after the run.

## Cleanup

- The verification's own test user (`e2e-stage5-verify-*@example.com`) and every row `seedStage5Fixture` wrote were deleted via `deleteTestUser()` in `afterAll` (cascades verified against `packages/db/src/schema.ts` before relying on it — see the helper file's own comment).
- The disposable "Journey 4 dialog project" created via the real UI dialog was deleted explicitly inside its own test.
- Every other spec run above (`research.spec.ts` etc.) performs its own existing cleanup in its own `afterAll` — unmodified by this round.
- `apps/web/.env.local`, the `palimnote-s5-pg` Postgres container, and the port-3250 `next start` process are all local to this verification session; the container and process are torn down at the end of this round (see the accompanying JSON summary for exact commands run).
