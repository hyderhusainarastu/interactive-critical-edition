# Stage 6 Write Verification (round 1)

Branch `redesign/stage6-write`, worktree `/private/tmp/palimnote-s6-write`. This is the Stage 6
VERIFICATION lane's gate check over the Write focused-editor layout shipped by
`docs/design/stage6-write-spec.md` (commits `cfebbf6`, `fe2c10e`, `e9e5190`, `f18d960`). Verified
against a real production build (`next build` + `next start` on `PORT=3260`) with a dedicated local
Postgres (`palimnote-s6-pg`, port 5436, freshly created and migrated — 46/46 migrations applied,
matching the production ledger), `PHASE_12_WRITER_ENABLED`/`PHASE_25_WRITER_EVIDENCE_ENABLED`/
`PHASE_25_RESEARCH_ENABLED` all `true` locally.

**Result: GATE NOT PASSED.** Journey 7's core sequence completes end to end and every export format
produces real, correct file bytes — but this round surfaces **two real, in-scope, reproducible
defects** in the new narrow-viewport panel/keyboard interaction (§4 below), confirmed independently
by both a dedicated driver script and the repository's own pre-existing `writer-panels.spec.ts`
suite failing on the exact same interactions. Two further defects were found and are **out of this
lane's file ownership** (§5) — real, but not fixable here. Nothing was fixed in this round; this is a
verification-only pass per the task's own scope.

---

## 1. Static gates

| Check | Result |
|---|---|
| `pnpm --filter web typecheck` | PASS — clean, no errors (including the new `stage6-write-fixtures.ts`) |
| `pnpm --filter web lint` | PASS — clean, no errors |
| `pnpm --filter web build` | PASS — production build succeeded, all routes compiled including `/writer` and `/writer/[projectId]` |

## 2. Environment

- **Postgres**: `palimnote-s6-pg`, `pgvector/pgvector:pg17`, port 5436, freshly created this round
  (`docker run ... -p 5436:5432 pgvector/pgvector:pg17`) and migrated via
  `pnpm --filter @ice/db db:migrate` against `postgresql://ice:ice_dev_only@localhost:5436/interactive_critical_edition`.
  `drizzle.__drizzle_migrations` count: **46**, matching the production ledger in `docs/PROJECT-LOG.md`.
- **Web**: `apps/web/.env.local` (gitignored, not committed) pointed `DATABASE_URL`/`DIRECT_URL` at the
  dedicated Postgres above, set a fresh `AUTH_SECRET`, and enabled `PHASE_12_FOUNDATION_ENABLED`,
  `PHASE_12_WRITER_ENABLED`, `PHASE_25_RESEARCH_ENABLED`, `PHASE_25_WRITER_EVIDENCE_ENABLED`. Served via
  `next start -p 3260` against a real production build — not `next dev`.
- **Seeding**: `apps/web/e2e/stage6-write-fixtures.ts` (new file, committed) — `e2e/helpers.ts` itself
  was not edited, per the program's file-ownership rule. `seedStage6Fixture(userId)` reuses
  `seedWorkWithLibraryItem` (imported from `./helpers`, not redefined) for a real Library source (work
  → work_identity → resource_role → learning_resource, the exact join `listOwnedLibrarySources`
  performs), and adds a minimal, real research-evidence chain (research_project → work →
  processing_run → page → text_block → research_claim, anchored with a real quote drawn from the
  block's own text) matching the shape `writer-evidence.spec.ts`'s own `seedFixture` already uses.
  `markOnboarded(userId)` mirrors the same helper `writer-evidence.spec.ts` defines locally.

## 3. Journey 7 core — pass/fail detail

Driven by a standalone Playwright script (not committed — see §8) against the real running server,
seeding via `createVerifiedTestUser` + `seedStage6Fixture`, then exercising every step through the
real UI. **53/57 checks passed** in the final run; the 4 failures are the confirmed defects in §4–§5,
not script bugs (each is independently reproduced by an existing repo test — see those sections).

| Step | Result | Evidence |
|---|---|---|
| Create project (+ auto-created first document) | PASS | `01-project-created-1440-light.png` |
| Type into the draft | PASS | status shows `"Editing"` immediately after the keystroke (before the 750ms debounce fires) |
| Autosave status visible and truthful | PASS (best-effort on the in-flight "Saving…" catch) | `"Editing"` → `"Saved"` confirmed every run; the brief in-flight `"Saving…"` state was caught on a 20ms poll in the final run — genuinely real (confirmed by reading `WriterEditor.tsx`'s `saveNow()`), just fast over a local dedicated Postgres |
| Create a second document, reorder (Move earlier) | PASS | displayed order actually changes (`Untitled document,Second document` → `Second document,Untitled document`), persists to `"Saved"` before the next step |
| Archive → restore round trip | PASS | native `confirm` accepted, project disappears from the active list, appears under "Archived projects", "Restore project" brings it back | `02-reordered-1440-light.png` precedes this step |
| Link evidence (research project) | PASS | picker lists the seeded project by title, "Link" attaches it, the claim card renders with its real excerpt | `03-evidence-linked-and-inserted-1440-light.png` |
| Insert evidence (claim → real draft content) | PASS | draft content changes to include the claim's real supporting excerpt |
| Cite a Library source, insert the citation | PASS | draft content changes again after "Insert" in the Citations panel |
| Restore a revision | PASS | native `confirm` accepted, status returns to `"Saved"` | `04-after-restore-revision-1440-light.png` |
| **Every currently supported export** | PASS (all 6) | DOCX: real download, 2626 bytes, `PK` magic bytes (ZIP/OOXML). PDF: real download, 829 bytes, `%PDF` magic bytes. Citation exports — `bibtex` (348B, `application/x-bibtex`), `ris` (207B, `application/x-research-info-systems`), `apa` (173B, `text/plain`), `chicago` (168B, `text/plain`) — all 200, all nonzero, all correct content-type, verified via direct `page.request.get`. The UI's own format picker (set to `apa`) was separately driven end to end and downloaded a real, nonzero `.txt` file. |

## 4. Confirmed defects — in this lane's file ownership (gate-blocking)

Both were found independently by the driver script **and** reproduced by the pre-existing
`writer-panels.spec.ts` suite (`PLAYWRIGHT_BASE_URL=http://localhost:3260 ... playwright test
writer-panels.spec.ts`, run against this same server/DB), so these are not script artifacts.

### 4.1 Narrow-viewport "one-panel rule": a single tap on the other toggle cannot both close the current sheet and open the other

**Spec §2.1 promises**: "Opening Citations while Sources is open closes Sources first" (a single
action). **`writer-panels.spec.ts:80`'s own assertion** (`opening the other closes the first`) times
out at 120s on both 768px and 375px, on every attempt (2/2, not flaky — confirmed via a retry).

**Root cause** (`apps/web/src/components/writer/panels/WriterPanelSheet.tsx:61`): the open sheet's
full-screen backdrop (`<div className="fixed inset-0 z-40 ..." onMouseDown={closeFromOutside}>`) sits
above the document toolbar that hosts **both** toggle buttons — nothing in `WriterEditor.tsx`'s
toolbar row lifts the toggle buttons' own stacking above `z-40`. A real click/tap on the
`"Citations and history"` button while the Sources sheet is open therefore lands on the backdrop
instead: Playwright's default actionability check refuses to dispatch it at all (confirmed via the
exact `"<div role="presentation" ...> intercepts pointer events"` retry log). Forcing the click
through (`{ force: true }`, simulating a raw coordinate tap) confirms what a real user would
experience: the backdrop's own `onMouseDown` fires, closing Sources — and nothing else. Citations
never opens from that single action (`sourcesClosedAfterTap=true, citationsOpenedAfterTap=false`,
confirmed on both 768px and 375px). A user must dismiss the current sheet first (Escape, or a second,
separate tap) and only then open the other — the spec's "closes the first" single-action promise is
unreachable as written.

Confirmed the panel itself works correctly in isolation (Citations opens fine when nothing else is
open) — this isolates the defect to the cross-toggle transition specifically, not the panels
themselves. Screenshots: `07-narrow-sources-sheet-{768,375}-light.png` (Sources open),
`07b-narrow-after-blocked-cross-toggle-{768,375}-light.png` (state after the blocked tap — Sources
closed, Citations still not open), `08-narrow-citations-sheet-{768,375}-light.png` (Citations opened
correctly on its own, after an explicit Escape).

### 4.2 Keyboard-only pass-through: tabbing forward from the (reopened) Sources toggle never enters the Sources panel's own content

**`writer-panels.spec.ts:137`** (`desktop (1280px): keyboard-only pass through`) fails deterministically
(2/2) at `expect(page.getByLabel("Citation import format")).toBeFocused()` after one `Tab` press from
the Sources toggle button — the received value is `"inactive"` (focus landed nowhere the assertion
expected).

**Root cause, confirmed via a targeted repro logging `document.activeElement` at each step**: after
`.focus()` on the "Sources and evidence" toggle, Enter (collapse), Enter (reopen — focus correctly
stays on the toggle both times), one `Tab` press moves focus to the **"Citations and history" toggle
button**, not into the Sources panel. This is a genuine DOM/tab-order mismatch: `WriterEditor.tsx`
renders `<SourcesEvidencePanel>` **before** `<main>` in JSX (so it appears visually to the left, which
is correct), but both toggle buttons live **inside** `<main>`'s own toolbar row, which comes **after**
the Sources panel in DOM/tab order. So tabbing *forward* from a toggle button skips right past its own
panel (which is earlier in the document) and lands on the very next toolbar control — the other
toggle. The Citations panel doesn't have this asymmetry (it's positioned *after* `<main>`, so tabbing
forward from *its* toggle correctly would enter its own content next) — this is specific to the
Sources side. A keyboard user reopening Sources and pressing Tab, expecting to enter its content, is
instead bounced to the unrelated Citations toggle.

## 5. Confirmed defects — outside this lane's file ownership (deferred, not gate-blocking for Stage 6 itself)

Both are real and reproducible, but live in files this lane may not edit (`shell/**` and
`WorkspacePreferencesProvider.tsx`/`PreferenceBootstrap.tsx`, neither under `apps/web/src/app/(app)/writer/**`
or `apps/web/src/components/writer/**`). Recorded here for the record and for whichever lane owns
those files next; Stage 6's own new code consumes both existing conventions correctly and is not the
source of either defect.

### 5.1 `data-motion` never syncs from the OS/browser-level `prefers-reduced-motion` signal

`writer-panels.spec.ts:110` (`the sheet traps Tab focus and reduced motion does not prevent it from
opening`) fails at `expect(page.locator("html")).toHaveAttribute("data-motion", "reduced")` —
received `"full"`, even with `page.emulateMedia({ reducedMotion: "reduce" })` active (separately
confirmed the emulation itself took effect at the browser level:
`window.matchMedia('(prefers-reduced-motion: reduce)').matches === true`).

**Root cause, confirmed by direct code read**: `data-motion` is set exclusively by
`WorkspacePreferencesProvider.tsx`'s `applyPreferences()` (`root.dataset.motion =
preferences.motionEnabled ? "full" : "reduced"`) and `PreferenceBootstrap.tsx`'s matching inline
bootstrap script — both read only a stored `motionEnabled` **user preference** (default `true`/
`"full"`), and neither ever calls `matchMedia('(prefers-reduced-motion: reduce)')`. Unlike `theme`
(which does have a `"system"` mode that reads `prefers-color-scheme`), motion has no such mode: a real
user with OS-level reduced-motion turned on gets **zero** of the app's reduced-motion accommodations
unless they separately toggle the in-app preference too. This directly contradicts Stage 6's own spec
§10 ("Reduced motion: the sheet's `app-panel-enter` class already respects the site-wide
`data-motion="reduced"` override") — that statement is only true once `data-motion` is actually set to
`"reduced"`, which an OS-level signal alone never achieves.

**Downstream, consistent symptom** (same root cause, not a separate defect): with `data-motion`
staying `"full"`, `document.getAnimations()` reports **8 running animations** while the Sources sheet
is open under emulated reduced motion — the `:root[data-motion="reduced"] *` blanket override
(`globals.css:805`) never engages because the attribute it keys off never flips.

Screenshot: `10-reduced-motion-sheet-375.png` (sheet open, real animation in progress despite emulated
reduced motion).

### 5.2 `WorkspaceRailItem` has no accessible name when the rail is collapsed

Found via `writer-evidence.spec.ts`'s own axe scan (`axe: zero wcag2a/wcag2aa violations on a writer
project with a linked evidence panel, light and dark`), which **fails** with a `link-name` (serious,
WCAG 2A — 2.4.4/4.1.2) violation on **all four** rail items (Home, Read, Research, Write) in both the
light and dark passes.

**Root cause, confirmed by direct code read**: `WorkspaceRailItem.tsx`'s own doc comment claims "an
`aria-label` ... when collapsed," but the actual implementation never sets `aria-label` anywhere — only
`data-tooltip={collapsed ? label : undefined}` (a CSS-only `::before`/`::after` tooltip convention,
not an accessible-name mechanism). When collapsed, the visible `<span className="rail-label">{label}</span>`
is hidden by CSS, leaving the `<a>` with only an `aria-hidden="true"` icon — no accessible name at all.

This surfaces prominently on `/writer/[projectId]` specifically because `isImmersiveRoute()`
(`apps/web/src/components/shell/immersive.ts`, unchanged by Stage 6, already matched
`/writer/[projectId]` before this stage) triggers `WorkspaceRail.tsx`'s one-time
"auto-collapse-on-first-immersive-visit" convenience for any fresh session with no stored rail
preference — exactly the case for every freshly seeded test user here. The underlying defect is
app-wide (every immersive route: Reader, Knowledge Map, Writer), not Writer-specific, and the file is
squarely `shell/**` — outside this lane's ownership.

## 6. Existing CI-safe-style writer specs

Run against the same dedicated server/DB (`PLAYWRIGHT_BASE_URL=http://localhost:3260`, except
`writer-evidence.spec.ts`, which spawns its own dedicated port-3170 server per its existing design):

| Spec | Result |
|---|---|
| `writer.spec.ts` | **5/5 passed** |
| `writer-export.spec.ts` | **4/4 passed** |
| `writer-evidence.spec.ts` | **4/5 passed** — the one failure is §5.2's pre-existing, out-of-lane accessibility defect |
| `writer-panels.spec.ts` | **7/11 passed** — the 4 failures are §4.1 (×2, one per narrow width) and §4.2 (×1) and §5.1 (×1), each confirmed with a retry (deterministic, not flaky) |

No new spec file was added or modified — the failures above are the pre-existing suite's own honest
signal, not something this round weakened or worked around.

## 7. Screenshots (unmasked, `docs/audits/stage6-write-verification/`)

`01-project-created-1440-light.png`, `02-reordered-1440-light.png`,
`03-evidence-linked-and-inserted-1440-light.png`, `04-after-restore-revision-1440-light.png`,
`05-panels-both-collapsed-{1024,1440}-light.png`, `06-panels-both-open-{1024,1440}-light.png`,
`07-narrow-sources-sheet-{375,768}-light.png`, `07b-narrow-after-blocked-cross-toggle-{375,768}-light.png`,
`08-narrow-citations-sheet-{375,768}-light.png`, `09-dark-{375,1440}.png`,
`10-reduced-motion-sheet-375.png`. 17 total, covering 1440/1024/768/375, light + dark, and the reduced-motion
state.

## 8. Cleanup

- Killed the `next start` process on port 3260 (post-kill `curl` confirms connection refused).
- All seeded test users self-deleted via each script/spec's own `deleteTestUser()` call in a
  `finally`/`afterAll` block, **except** one orphan left by an ad hoc dev-mode repro
  (`stage6-devmode-...@example.com`, from a `next dev` session on port 3261 used only to get a
  full non-minified React hydration stack trace — see the note below — killed without giving its
  script a chance to reach its own cleanup). Found and deleted explicitly via `deleteTestUser()`;
  verified `select count(*) from "user"` = 0 afterward, and 0 rows in `work`/`writer_project`/
  `research_project` as well.
- Every ad hoc scratch/debug script (`.stage6-debug-*.ts`, `.stage6-verify-driver.ts`,
  `.stage6-cleanup-orphan.ts`) was removed from the worktree before this commit — only
  `apps/web/e2e/stage6-write-fixtures.ts`, this report, and the screenshots are committed, matching
  the Stage 1 verification lane's own precedent.
- The dedicated `palimnote-s6-pg` Postgres container was **left running** (not destroyed) for reuse by
  a future verification round, matching the "create+migrate or reuse" instruction and the precedent of
  the shared `palimnote-redesign-postgres` container on port 5433.
- `apps/web/.env.local` (gitignored) was left in place pointing at the dedicated Postgres, so a future
  round in this same worktree can reuse the environment without re-deriving it.

## 9. A separately observed, non-blocking artifact (not a new register row)

During the archive → restore → re-enter sequence, a client-side (`<Link>`) navigation into
`/writer/[projectId]` intermittently triggered a React hydration-mismatch warning ("A tree hydrated
but some attributes of the server rendered HTML didn't match the client properties," on the root
`<html>`'s `data-theme`/`data-motion`/etc. attributes — confirmed via a side-by-side `next dev` run
with full, non-minified error output). This is **not** Writer- or Stage-6-specific: it reproduced
identically on the very first `/login` page load and on a plain `/writer` (list) → `/works/[id]`
navigation had none, but `/writer` list → `/writer/[projectId]` did, on a completely fresh session with
zero prior code differences from Stage 6. React recovers by discarding and re-rendering the affected
subtree client-side ("This won't be patched up" refers to the mismatched *tree*, not broken
functionality) — confirmed the app remained fully interactive immediately afterward in every
reproduction. Because of the resulting brief DOM churn, the driver script uses a direct `page.goto`
rather than a `.click()` + `waitForURL` race for that one re-entry step (documented inline in the
script before it was removed). Not promoted to a numbered defect here since its scope (root shell
layout attributes) sits outside every file this lane can inspect further without exceeding its
ownership boundary — flagged for whichever lane next touches `apps/web/src/app/(app)/layout.tsx` or
`PreferenceBootstrap.tsx`.

---

## Summary

| Gate item | Result |
|---|---|
| Static gates (typecheck/lint/build) | PASS |
| Dedicated Postgres created + migrated (46/46) | PASS |
| Seed helper (new file, `e2e/helpers.ts` untouched) | PASS |
| Journey 7 core (create → type → autosave → reorder/archive → link evidence → insert citation → restore revision) | PASS |
| Every currently supported export (DOCX/PDF/4 citation formats) — real bytes, nonzero, correct content-type | PASS (6/6) |
| Panel collapse behavior, wide (1440/1024) | PASS |
| Panel collapse behavior, narrow (768/375), one-panel rule | **FAIL** — §4.1 (in-lane) |
| Keyboard-only pass-through | **FAIL** — §4.2 (in-lane) |
| Dark mode (1440 + 375) | PASS |
| Reduced motion | **FAIL** — §5.1 (pre-existing, out-of-lane) |
| Accessibility (via existing specs' axe coverage) | **FAIL** — §5.2 (pre-existing, out-of-lane) |
| Affected existing writer specs | 20/25 passed across 4 files (§6) |

**gatePassed = false.** Two real, in-scope, deterministically-reproducible defects (§4.1, §4.2) remain
open in this lane's own files; two further real defects (§5.1, §5.2) are confirmed but outside this
lane's file ownership and are deferred, not fixed, here.
