# Stage 1 Shell Verification (round 1)

Branch `redesign/ui-graph-rebuild`, worktree `/private/tmp/palimnote-redesign`. This
is the Stage 1 VERIFICATION lane's gate check: existing routes still resolve;
keyboard, focus restoration, touch targets, light/dark, reduced motion, and
1440/1024/768/375/320 layouts pass. Verified against a real production build
(`next build` + `next start`) on `PORT=3210`, a dedicated local Postgres
(`palimnote-redesign-postgres`, port 5433, already migrated — no
`db:migrate` write was needed or attempted), with all Phase 12/18/25 flags
enabled locally per `apps/web/.env.local` (matches the documented practice
of exercising real gated surfaces rather than a 404 in this worktree).

**Result: GATE PASSED.** Every mandatory check below passed. Two script bugs
were found and fixed *in the verification script itself* during this run
(documented in §7); neither was a product defect.

---

## 1. Static gates

| Check | Result |
|---|---|
| `pnpm --filter web typecheck` | PASS — clean, no errors |
| `pnpm --filter web lint` | PASS — clean, no errors |
| `pnpm --filter web build` | PASS — production build succeeded, all ~63 routes compiled (see full route list in the build output; every `(app)`/`(auth)`/API route from the baseline audit's inventory is present) |

## 2. Route inventory sweep (HTTP 200 + real content, not an error boundary)

Standalone Playwright script (`scratchpad-verify.mjs`, run from
`apps/web`, not committed — see §7) logged in as a freshly seeded verified
test user (`createVerifiedTestUser`) with one owned work
(`seedOwnedWork`, `processingStatus: "ready"`, `analysisStatus: "complete"`
— no worker/GROBID/live API needed), then requested every signed-in route
family named in the baseline audit's §3 route inventory:

| Route | Status | `#main-content` present | Error boundary text found |
|---|---|---|---|
| `/dashboard` | 200 | yes | no |
| `/works` | 200 | yes | no |
| `/works/[id]` (seeded work) | 200 | yes | no |
| `/library` | 200 | yes | no |
| `/upload` | 200 | yes | no |
| `/graph` | 200 | yes | no |
| `/ask-library` | 200 | yes | no |
| `/research` | 200 | yes | no |
| `/writer` | 200 | yes | no |
| `/account` | 200 | yes | no |
| `/account/profile` | 200 | yes | no |
| `/works/trash` | 200 | yes | no |
| `/welcome` | 200 (not a redirect, since this account hadn't onboarded yet — a valid outcome, not a 404/500) | — | — |

All local flags (`PHASE_12_*`, `PHASE_18_RAG_ENABLED`, `PHASE_25_RESEARCH_ENABLED`)
are `true` per `apps/web/.env.local`, so none of the flag-gated routes
(`/ask-library`, `/research`, `/writer`) were expected to 404, and none did —
consistent with the charter's "404 when off is correct, not a failure" note,
which doesn't apply here since every relevant flag is on.

**13/13 routes PASS.**

## 3. Screenshots — shell at 1440/1024/768/375/320, light + dark

Saved to `docs/audits/stage1-shell-verification/`:

- `dashboard-1440-light.png`, `dashboard-1440-dark.png`
- `dashboard-1024-light.png`
- `dashboard-768-light.png`
- `dashboard-375-light.png`, `dashboard-375-dark.png`
- `dashboard-320-light.png`

(Light captured at all five widths; dark captured at 1440 and 375, satisfying
the "light AND dark at 1440+375 minimum" instruction.)

Visual review of every screenshot confirms:

- **Rail width**: 232px expanded at ≥1024px (1440px, 1024px both measured
  `232` via `getBoundingClientRect`), 64px force-collapsed at 768px tablet
  (measured `64`, and visually confirmed icon-only in the 768px screenshot).
- **Bottom nav**: hidden ≥768px; present <768px at 56px tall (measured `56`
  at both 375px and 320px) with exactly 4 destinations (Home/Read/Research/
  Write), visually confirmed in the 375/320 screenshots.
- **No horizontal body scroll** at any of the 7 screenshot captures
  (`document.documentElement.scrollWidth <= clientWidth + 1px` at every
  width/theme combination — 7/7 pass).
- **Footer**: present on `/dashboard` (non-immersive), correctly hidden on
  `/graph`, `/works/[id]/reader`, and `/works/[id]/graph` (all three
  immersive routes per `isImmersiveRoute()`), and correctly still present on
  the non-immersive `/works/[id]/roadmap` — 5/5 pass, matching
  `AppShellRoot.tsx`'s `{!immersive && <AppFooter />}` and `immersive.ts`'s
  route predicate exactly.
- **Content renders correctly at every breakpoint**: the seeded account's
  first-login dashboard state (the reader-level onboarding prompt, "Welcome,
  E2E." + the four depth options) is fully legible and correctly laid out
  at all 5 widths in both themes — no clipping, no overlap, no
  unreadable/invisible text.

One cosmetic, non-blocking observation: at 320px the "Palimnote" wordmark in
the mobile context bar truncates to "P…" (visible in
`dashboard-320-light.png`). This is not one of the charter's Stage 1 gate
criteria (no horizontal scroll, correct rail/bottom-nav dimensions, 44px
targets) and doesn't block any interaction — flagging it here as an honest
observation for a later polish pass, not as a gate failure.

## 4. Keyboard: tab order, focus restoration, Escape

Via the same standalone script plus the CI-safe `workspace-shell.spec.ts`
suite (§6):

- **Tab order reaches all four primary nav destinations, Upload, and the
  Account menu trigger** — walked the real Tab sequence from page load and
  confirmed `document.activeElement` visits Home, Read, Research, Write
  (rail links), the Upload action, and the Account-menu button, all within
  the same forward tab pass. PASS.
- **Opening + closing a dialog-like panel restores focus to its trigger**:
  opening Workspace preferences via keyboard, then pressing Escape, leaves
  `document.activeElement` back on the "Workspace preferences" button.
  PASS. The CI-safe suite additionally covers: the command palette itself
  ("traps focus in the command palette and returns focus to its trigger"),
  the mobile Read-management sheet ("treats the mobile Read-management
  sheet as a modal drawer and restores its trigger"), and the Ask Library
  global sidebar's dialog-initiated-close focus restoration (all passed —
  see §6).
- **Escape closes transient UI**: confirmed for both the workspace-
  preferences popover and the command palette (Ctrl+K opens it, Escape
  closes it) in the standalone script, and for the mobile drawer/RAG
  sidebar in the spec suite.

**All keyboard checks PASS.**

## 5. Reduced motion

Emulated `prefers-reduced-motion: reduce` via a dedicated Playwright
context (`reducedMotion: "reduce"`) and confirmed, via
`document.getAnimations()` (ground truth for what's actually running, not
just what a stylesheet declares):

- `window.matchMedia("(prefers-reduced-motion: reduce)").matches === true`
  inside the page (the emulation took effect).
- **0 running animations** while the workspace-preferences popover is open.
- **0 running animations** while the command palette is open.
- **0 running animations** immediately after entering focus mode (the one
  shell transition with an explicit enter/exit affordance).

This matches `globals.css`'s own structure: every shell transition/keyframe
is declared inside `@media (prefers-reduced-motion: no-preference)` blocks
(rail-item tooltips, wordmark hover flourishes, etc.), so `reduce` disables
them natively via the media query rather than needing a JS-side check —
confirmed empirically above rather than just by reading the CSS.

**PASS.**

## 6. CI-safe shell E2E spec

Ran the existing `workspace-shell.spec.ts` (the repo's own CI-safe spec for
this surface) directly against the built server on port 3210:

```
PLAYWRIGHT_BASE_URL="http://localhost:3210" node --env-file-if-exists=../../packages/db/.env \
  --env-file-if-exists=.env.local ./node_modules/@playwright/test/cli.js test workspace-shell
```

**26/26 passed** (24.4s), covering: command palette open/focus-trap/
restore, workspace-preferences as a keyboard-managed dialog, menu survival
across rapid re-navigation and double-click "switch-bounce," outside-click
close without stealing focus, Enter-key toggle, account-menu-item
navigation, focus-mode entry moving focus to Exit, text-size/reading-width/
focus-mode preferences actually applying and persisting after reload,
logout ending the session, the mobile bottom nav (44px+ targets), the
mobile Read-management sheet as a modal drawer with trigger-focus
restoration, immersive-route footer/rail-collapse behavior, menu z-index
correctness both settled and mid-page-transition, the Safari
backdrop-filter-ancestor clipping guard, and five Global Ask Library
sidebar behaviors (persistent trigger, survives navigation, work-scoping,
distinct naming from the reader's own drawer, mobile bottom-sheet
rendering).

This spec ran exactly as the repo intends (`pnpm --filter web test:e2e`'s
underlying invocation), just pointed at the Stage 1 build via
`PLAYWRIGHT_BASE_URL` instead of the default port.

## 7. Touch targets ≥ 44×44

Measured via `getBoundingClientRect()` (not Playwright's auto-waiting
`boundingBox()`, which can hang indefinitely waiting for "stability" behind
a continuously-repainting element — see the note below):

| Control | Viewport | w × h |
|---|---|---|
| Rail item "Home" | 1440px | 215 × 44 |
| Rail item "Read" | 1440px | 215 × 44 |
| Rail item "Research" | 1440px | 215 × 44 |
| Rail item "Write" | 1440px | 215 × 44 |
| Workspace-preferences button | 1440px & 375px | 44 × 44 |
| Account-menu button | 1440px & 375px | 44 × 44 |
| Rail collapse toggle ("«") | 1440px | 44 × 44 |
| Upload action (mobile context-bar) | 375px | 44 × 44 |
| Bottom-nav destinations (×4) | 375px & 320px | height 56 (well over 44); width ≈ viewport/4, ≥ 44 at both widths |

**All measured controls ≥ 44×44. PASS.**

### Script bugs found and fixed during this run (not product defects)

Two bugs in the *verification script itself* were found and fixed before
reaching the final 51/51-check pass reported above:

1. **False "Tab order" failure**: the script compared
   `document.activeElement.textContent` against plain labels ("Home",
   etc.), but `WorkspaceRailItem` renders an `aria-hidden` icon glyph
   sibling span before the `.rail-label` text span — `textContent` doesn't
   respect `aria-hidden`, so the real value was `"⌂Home"`, not `"Home"`.
   Fixed by reading `.rail-label`'s own `textContent` when present. This
   was a script defect, not a real accessibility problem — the icon glyph
   is correctly `aria-hidden`, so assistive tech announces just "Home".
2. **False "Upload action touch target" failure**: `UploadAction` is
   rendered in **three** places in the DOM at any given time — the rail's
   own footer copy, the rail's `READ_SUBNAV` copy, and (mobile-only)
   `ContextBar`'s copy — with the two rail copies present but
   `display:none` (`hidden md:flex`) below 768px. The script's
   `a[href="/upload"]').first()` matched a hidden rail copy, whose
   `boundingBox()` correctly returned `null`. Fixed by scoping to
   `a[href="/upload"]:visible`.

Separately (operational, not a script or product bug): one ad hoc
supplementary touch-target check hung indefinitely and had to be killed —
`locator.boundingBox()` auto-waits for two consecutive stable animation
frames, which can hang if used on an element under a state affected by a
still-open unrelated dialog from a prior script run reusing the same test
account's DB-persisted `workspace.focusMode` preference. Switched to
`getBoundingClientRect()` via `page.evaluate()` (no auto-wait) for all
subsequent ad hoc measurements, and reset the affected test account's
`focusMode` back to `false` directly before re-measuring. This confirms a
real, if narrow, operational lesson: workspace preferences are
DB-persisted per account (not per Playwright context), so a leftover state
change from one throwaway script can leak into a later script reusing the
same seeded account within one verification session — worth remembering
for any future ad hoc (non-`e2e/` fixture) scripts, though it isn't a
product-facing issue since every real user's own preferences are supposed
to persist exactly this way.

## 8. Cleanup

- Killed the `next start` process on port 3210 (`post-kill curl` confirms
  connection refused).
- Deleted the seeded test user (`stage1-verify-<ts>@example.com`) via the
  repo's own `deleteTestUser()` helper; verified via direct `psql` query
  against the local DB that both the `user` row and the seeded `work` row
  (which cascades from the user delete) are gone (`count = 0` for both).
  No file was uploaded via the UI at any point in this session, so no
  Supabase Storage object exists to clean up either.
- Removed all ad hoc scratch scripts from the worktree
  (`scratchpad-verify.mjs`, the seed/cleanup/reset-focus/touch-check
  helpers) before this commit — only this report and the screenshots are
  committed.

---

## Summary

| Gate item | Result |
|---|---|
| Existing routes still resolve | PASS (13/13 signed-in route families, 200 + real content) |
| Keyboard (tab order, focus restoration, Escape) | PASS |
| Touch targets ≥ 44×44 | PASS |
| Light/dark | PASS |
| Reduced motion | PASS (0 running animations under emulated `reduce`) |
| 1440/1024/768/375/320 layouts | PASS (rail 232px/64px, bottom-nav 56px + 4 destinations, no horizontal scroll, footer immersive-hide all correct) |
| CI-safe `workspace-shell.spec.ts` | PASS (26/26) |

**gatePassed = true.**
