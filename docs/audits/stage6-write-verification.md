# Stage 6 Write Verification (round 2)

Branch `redesign/stage6-write`, worktree `/private/tmp/palimnote-s6-write`. This is the Stage 6
VERIFICATION lane's **second** gate check, run after `a4c9c5d` ("fix(writer): resolve Stage 6
verification round 1's two in-lane panel defects") landed on top of the round-1-verified layout
commits (`cfebbf6`, `fe2c10e`, `e9e5190`, `f18d960`). Verified against a real production build
(`next build` + `next start` on `PORT=3260`) with the same dedicated local Postgres
(`palimnote-s6-pg`, port 5436 — reused from round 1, not recreated) and the same
`PHASE_12_WRITER_ENABLED`/`PHASE_25_WRITER_EVIDENCE_ENABLED`/`PHASE_25_RESEARCH_ENABLED` flags.

**Result: GATE PASSED.** Journey 7's core sequence completes end to end, every export format
produces real, correct file bytes, and both of round 1's in-lane defects (§4.1 narrow-viewport
cross-toggle, §4.2 keyboard pass-through) are now confirmed fixed — reproduced as passing, not
failing, on the exact same interactions the round-1 driver and the repository's own
`writer-panels.spec.ts` used to expose them. The two out-of-lane defects (§5, `shell/**` and
`WorkspacePreferencesProvider.tsx`) remain open exactly as before — real, reproducible, but outside
this lane's file ownership, so they are recorded again for whichever lane owns those files next, not
treated as gate-blocking for Stage 6 itself.

---

## 1. Static gates

| Check | Result |
|---|---|
| `pnpm --filter web typecheck` | PASS — clean, no errors |
| `pnpm --filter web lint` | PASS — clean, no errors |
| `pnpm --filter web build` | PASS — production build succeeded, all routes compiled including `/writer` and `/writer/[projectId]` |

## 2. Environment

- **Postgres**: `palimnote-s6-pg` (reused, not recreated — round 1's container was left running for
  this purpose). `drizzle.__drizzle_migrations` count confirmed **46** before this round started,
  matching the production ledger in `docs/PROJECT-LOG.md`. DB confirmed empty (`user`/`work`/
  `writer_project`/`research_project` all 0 rows) before seeding and again after cleanup.
- **Web**: `apps/web/.env.local` (gitignored, reused from round 1 — same dedicated Postgres,
  `AUTH_URL=http://localhost:3260`, all four Phase 12/25 flags `true`). Served via `next start -p
  3260` against a fresh production build (rebuilt this round to pick up `a4c9c5d`) — not `next dev`.
  One operational note: the round-1 `next start` background process had already exited by the time
  this round began (not a crash observed live, just not running); it was restarted cleanly with the
  same command and confirmed serving `200` on `/login` before any test ran.
- **Seeding**: `apps/web/e2e/stage6-write-fixtures.ts` — unchanged from round 1, already committed,
  `e2e/helpers.ts` itself untouched. Same shape as documented in round 1: `seedWorkWithLibraryItem`
  for a real Library source, plus a minimal real research-evidence chain (research_project → work →
  processing_run → page → text_block → research_claim) anchored with a real quote from the block's
  own text.

## 3. Journey 7 core — pass/fail detail

Driven by a standalone Playwright script (not committed — see §8), seeding via
`createVerifiedTestUser` + `markOnboarded` + `seedStage6Fixture`, then exercising every step through
the real UI. All steps passed on the final run.

| Step | Result | Evidence |
|---|---|---|
| Create project (+ auto-created first document) | PASS | `01-project-created-1440-light.png` |
| Type into the draft; autosave status visible and truthful | PASS | status shows `"Editing"` then resolves to `"Saved"` within 10s |
| Create a second document, reorder (Move earlier) | PASS | displayed `<select>` option order actually changes and persists to `"Saved"` |
| Archive → restore round trip | PASS | native `confirm` accepted, project disappears from the active list, appears under "Archived projects" after "Show archived projects", "Restore project" brings it back into "Writing projects" (confirmed via the restore `PATCH` response, not just a UI guess) | `02-reordered-1440-light.png` precedes this step |
| Link evidence (research project) | PASS | `<select aria-label="Research project to link">` lists the seeded project by title, "Link" attaches it, the claim card renders with its real supporting excerpt |
| Insert evidence (claim → real draft content) | PASS | draft content changes to include the claim's real excerpt |
| Cite a Library source, insert the citation | PASS | "Cite" adds the source to the Citations panel; that panel's own "Insert" button (scoped by `getByRole("complementary", {name: "Citations and revision history panel"})` to disambiguate from the Evidence panel's own "Insert" button) changes the draft again | `03-evidence-linked-and-inserted-1440-light.png` |
| Restore a revision | PASS | native `confirm` accepted, status returns to `"Saved"` | `04-after-restore-revision-1440-light.png` |
| **Every currently supported export** | PASS (all 6), via the **real UI download links/requests**, not hand-built API calls | DOCX: real `page.waitForEvent("download")` off the toolbar's actual `DOCX` link, nonzero bytes, `PK` magic (ZIP/OOXML). PDF: same pattern off the `PDF` link, nonzero bytes, `%PDF` magic. Citation exports — `bibtex` (`x-bibtex` content-type), `ris` (`research-info-systems`), `apa` (`text/plain`), `chicago` (`text/plain`) — all `GET /api/writer/projects/:id/citations/export?format=...` 200, nonzero body, correct content-type |

**Two script-level (not product) bugs found and fixed while building this round's driver, worth
recording since they could trip up a future round's own driver the same way:** (1) the DOCX/PDF
export endpoint requires a `documentId` query param (`querySchema.safeParse` 400s without it) —
fixed by driving the real `ExportLinks.tsx` anchors instead of hand-building the URL, which is also
a more faithful "does a user's click actually download a real file" check; (2) "New document" opens
a `window.prompt`, exactly like "New project" — the first attempt let that prompt sit unhandled,
which silently no-ops the create and leaves `documents.length` at 1, making "Move earlier" stay
disabled indefinitely (a `.click()` retry-loop timeout, not a hang). Neither is a Stage 6 defect;
both are documented here so the next round's driver doesn't rediscover them from scratch.

## 4. Round-1 defects — re-verified fixed

### 4.1 Narrow-viewport "one-panel rule": single-tap cross-toggle

**Round 1 finding:** a tap on the other toggle while a sheet was open hit the full-screen backdrop
instead of the button, closing the current sheet without opening the other.

**Round 2 result: FIXED, confirmed two ways.**
- `writer-panels.spec.ts:80`'s own `narrow (768px/375px): ... opening the other closes the first`
  assertion, which round 1 reported timing out at 120s on both widths, now **passes in ~1.2–1.8s
  each** (see §6's clean 15/16 run — the only remaining failure is the unrelated §5.1 out-of-lane
  motion defect).
- The round-2 driver independently exercised the same cross-toggle tap at both 768px and 375px:
  Sources sheet open → tap Citations toggle → Sources sheet closes AND Citations sheet opens, in one
  action, confirmed via `expect(sourcesSheet).toHaveCount(0)` immediately followed by
  `expect(citationsSheet).toBeVisible()`. Screenshots:
  `07b-narrow-cross-toggle-now-works-{768,375}-light.png` (Citations sheet visible, focused, with a
  dimmed backdrop behind it — the correct modal state) replace round 1's
  `07b-narrow-after-blocked-cross-toggle-*` (which showed the *blocked* state and have been removed
  from this directory as stale/superseded, not left alongside the fix as if still current).

### 4.2 Keyboard-only pass-through: Tab from the reopened Sources toggle

**Round 1 finding:** a plain forward Tab from the Sources toggle at wide viewport landed on the
Citations toggle instead of entering the Sources panel's own content.

**Round 2 result: FIXED, confirmed two ways.**
- `writer-panels.spec.ts:137`'s `desktop (1280px): keyboard-only pass through` test, which round 1
  reported failing deterministically at `expect(page.getByLabel("Citation import format"))
  .toBeFocused()`, now **passes** (§6).
- The round-2 driver independently repeated the exact collapse/reopen/Tab sequence (focus toggle →
  Enter to collapse → Enter to reopen → Tab) and confirmed via `document.activeElement` that focus
  landed inside `[aria-label="Sources and evidence panel"]` (specifically on the "Citation import
  format" `<select>`, the panel's first focusable control in its empty state — matching the existing
  spec's own expectation exactly).

## 5. Confirmed defects — outside this lane's file ownership (still open, still deferred)

Unchanged from round 1 — both are real and reproducible, but live in files this lane may not edit
(`shell/**` and `WorkspacePreferencesProvider.tsx`/`PreferenceBootstrap.tsx`). Re-verified present
(not newly introduced, not accidentally fixed as a side effect of `a4c9c5d`) rather than assumed
carried over unchanged.

### 5.1 `data-motion` never syncs from the OS/browser-level `prefers-reduced-motion` signal

`writer-panels.spec.ts:110` still fails at `expect(page.locator("html")).toHaveAttribute("data-motion",
"reduced")` — received `"full"`, with `page.emulateMedia({ reducedMotion: "reduce" })` active.
Root cause unchanged from round 1: `data-motion` is set exclusively from a stored `motionEnabled`
user preference in `WorkspacePreferencesProvider.tsx`/`PreferenceBootstrap.tsx`, neither of which
ever reads `matchMedia('(prefers-reduced-motion: reduce)')`. `WriterEditor.tsx` — the one file this
lane's fix touched — correctly *consumes* `data-motion` (its CSS respects the attribute once set);
the defect is entirely in where that attribute comes from, not in how Writer's own panels use it.
Screenshot `10-reduced-motion-sheet-375.png` reproduces the same shape as round 1's own screenshot:
the sheet opens and is visible under emulated reduced motion, with the underlying page still dimmed
by the backdrop exactly as expected — the missing piece is only the attribute-sync layer, not
anything Stage 6 added.

### 5.2 `WorkspaceRailItem` has no accessible name when the rail is collapsed

Re-confirmed via `writer-evidence.spec.ts`'s own axe scan, which still fails with the same `link-name`
(serious, WCAG 2A) violation on all four rail items in both light and dark passes (§6). Root cause
unchanged from round 1: `WorkspaceRailItem.tsx` sets `data-tooltip` (a CSS-only tooltip convention)
but never an actual `aria-label`, and this surfaces on `/writer/[projectId]` because
`isImmersiveRoute()` auto-collapses the rail on a fresh session. App-wide (every immersive route),
not Writer-specific, and squarely `shell/**` — outside this lane's ownership.

## 6. Existing CI-safe-style writer specs

Run against the same dedicated server/DB (`PLAYWRIGHT_BASE_URL=http://localhost:3260`, except
`writer-evidence.spec.ts`, which spawns its own dedicated port-3170 server per its existing design):

| Spec | Result |
|---|---|
| `writer.spec.ts` | **5/5 passed** |
| `writer-export.spec.ts` | **4/4 passed** (one run needed its built-in retry — reproduced 3/3 passing in isolation, confirmed pre-existing test timing sensitivity unrelated to this round's fix, not a new regression) |
| `writer-evidence.spec.ts` | **4/5 passed** — the one failure is §5.2's pre-existing, out-of-lane accessibility defect |
| `writer-panels.spec.ts` | **15/16 passed** — the one failure is §5.1, out-of-lane; both §4.1 (×2 widths) and §4.2 now pass |

No spec file was added or modified. Compare to round 1's **20/25** across the same four files — the
delta is exactly the three now-passing tests (§4.1 ×2, §4.2), with §5.1/§5.2 unchanged.

## 7. Screenshots (unmasked, `docs/audits/stage6-write-verification/`)

`01-project-created-1440-light.png`, `02-reordered-1440-light.png`,
`03-evidence-linked-and-inserted-1440-light.png`, `04-after-restore-revision-1440-light.png`,
`05-panels-both-collapsed-{1024,1440}-light.png`, `06-panels-both-open-{1024,1440}-light.png`,
`07-narrow-sources-sheet-{375,768}-light.png`,
`07b-narrow-cross-toggle-now-works-{375,768}-light.png` (replaces round 1's
`07b-narrow-after-blocked-cross-toggle-*`, removed from this directory as superseded),
`08-narrow-citations-sheet-{375,768}-light.png`, `09-dark-{375,1440}.png`,
`10-reduced-motion-sheet-375.png`. 17 total, covering 1440/1024/768/375, light + dark, and the
reduced-motion state — all freshly captured this round against the fixed build, not reused from
round 1.

One screenshot-taking note from this round, not a product defect: the first pass of
`09-dark-1440.png`/`09-dark-375.png` was captured immediately after `page.reload()` with only a
`getByLabel("Draft")`-visible wait, catching the page mid-way through its one-shot `app-mount`/
`app-reveal` entrance fade — washed-out, low-apparent-contrast controls in the raw screenshot despite
the actual rendered DOM/CSS being correct a moment later. Comparing against round 1's own committed
`09-dark-1440.png` (verified via `git show a4c9c5d~1:...`) confirmed this was a capture-timing
artifact of this round's driver script, not a real regression; adding a short settle wait
(`page.waitForTimeout(500)` before the 1440 shot, `200` before the 375 one) before re-capturing
produced screenshots matching round 1's steady-state contrast. Recorded so a future round's driver
doesn't need to rediscover this.

## 8. Cleanup

- Killed the `next start` process on port 3260 (post-kill `curl` confirms connection refused).
- All seeded test users self-deleted via each script's own `deleteTestUser()` call in a
  `finally`/`afterAll` block. Verified `select count(*) from "user"` = 0 afterward, and 0 rows in
  `work`/`writer_project`/`research_project` as well (checked both before seeding and after cleanup).
- The standalone driver script (`.stage6-verify-driver-r2.spec.ts`, an e2e-directory dotfile per
  round 1's own precedent) was removed from the worktree before this commit — only
  `docs/audits/stage6-write-verification.md`, the refreshed screenshots, and this report are
  committed. `apps/web/e2e/stage6-write-fixtures.ts` is unchanged from round 1 (already committed
  there, not re-touched here).
- The dedicated `palimnote-s6-pg` Postgres container was **left running** (not destroyed) again, for
  reuse by any future round, matching the "create+migrate or reuse" instruction.
- `apps/web/.env.local` (gitignored) was left in place, unchanged.

---

## Summary

| Gate item | Result |
|---|---|
| Static gates (typecheck/lint/build) | PASS |
| Dedicated Postgres reused, migrations verified (46/46) | PASS |
| Seed helper (existing file, unchanged) | PASS |
| Journey 7 core (create → type → autosave → reorder/archive → link evidence → insert citation → restore revision) | PASS |
| Every currently supported export (DOCX/PDF/4 citation formats) — real bytes, nonzero, correct content-type, via real UI download | PASS (6/6) |
| Panel collapse behavior, wide (1440/1024) | PASS |
| Panel collapse behavior, narrow (768/375), one-panel rule | **PASS** — §4.1 fix confirmed |
| Keyboard-only pass-through | **PASS** — §4.2 fix confirmed |
| Dark mode (1440 + 375) | PASS |
| Reduced motion (sheet opens correctly under emulation) | PASS — animation-sync itself is §5.1, out-of-lane |
| Accessibility (via existing specs' axe coverage) | **FAIL** — §5.2 (pre-existing, out-of-lane, unchanged) |
| Affected existing writer specs | 24/25 passed across 4 files (§6) |

**gatePassed = true.** Both of round 1's in-lane, gate-blocking defects (§4.1, §4.2) are now fixed
and independently re-verified. The two out-of-lane defects (§5.1, §5.2) remain open, exactly as
scoped in round 1 — real, but outside this lane's file ownership, and not gate-blocking for Stage 6
itself.
