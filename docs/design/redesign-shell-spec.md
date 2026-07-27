# Stage 1 Shell & Design-System Spec — Palimnote Signed-In Redesign

Binding implementation spec for Stage 1 (charter §15 "Stage 1 — Design system and shell"). Every decision
below is final for this stage; nothing is left "TBD." Where a decision constrains a later stage (renderer,
graph, Reader/Research/Writer internals) that is called out explicitly in §8 (Stage boundary) rather than
silently decided here.

Sources read before writing this spec: charter §5–§7 (`docs/handoffs/claude-code-ui-ux-graph-rebuild-prompt.md`),
baseline audit §3 (`docs/audits/ui-graph-redesign-baseline.md`) and the full Stage-0 inventory
(`docs/audits/ui-graph-redesign-baseline/stage0-inventory.md`), plus direct reads of `AppShell.tsx` and its
imports (`CommandPalette.tsx`, `GlobalRagSidebar.tsx`, `AppFooter.tsx`, `PreferenceBootstrap.tsx`,
`ProfileMenu.tsx`, `WorkspacePreferencesProvider.tsx`), `apps/web/src/app/globals.css`, and
`apps/web/src/app/(app)/layout.tsx`. All file:line references below are to the redesign worktree
(`/private/tmp/palimnote-redesign`) as of this commit; re-derive if a cited line has since moved.

No new npm dependency is used anywhere in this spec. The repo already has no headless-UI/Radix/react-aria
library (`apps/web/package.json` confirmed — only `motion`, no icon library, no dialog/menu primitive
package), and every existing shell surface (`MobileDrawer`, `PreferencesMenu`, `ProfileMenu`,
`CommandPalette`, `FeedbackModal`) hand-rolls its own focus trap/Escape handling inline. Stage 1 continues
that house style deliberately — see §5 — rather than introducing a dependency to replace ~40 lines of
duplicated-but-working focus-trap code four times over.

---

## 1. Token map

### 1.1 Charter palette → existing token names

The charter's seven palette values (§7) are **already** the exact `:root` light-theme values in
`globals.css:20-141` — confirmed byte-for-byte, not approximately:

| Charter value | Existing token | `globals.css` line |
|---|---|---|
| `#FBF9F4` background | `--color-background` | 21 |
| `#F4F0E7` surface | `--color-surface` | 22 |
| `#172838` ink | `--color-text` | 23 |
| `#7A3F48` burgundy | `--color-accent-burgundy` | 27 |
| `#3E5D52` green | `--color-accent-green` | 28 |
| `#765641` umber | `--color-accent-umber` | 30 |
| `#B48A47` gold | `--color-highlight` | 31 |

**Decision: no color token changes value in Stage 1.** The palette work the charter asks for was already
done (2026-07-24 landing-palette swap, per the file's own header comment, `globals.css:3-19`) and re-verified
against WCAG 2.2 AA. Stage 1 reuses every existing token unchanged and adds only the new tokens the shell's
new geometry (rail, mobile bottom nav, immersive-mode chrome) requires. This is the single biggest
simplification Stage 1 makes: no risky app-wide recolor, only additive tokens plus new *component* CSS.

### 1.2 New tokens (additive only)

All nine new tokens below are read off token combinations that already independently pass AA elsewhere in
the file (verified again for this exact use with the computed ratios in §1.3) — none is a new hue.

| New token | Light value | Dark value | Purpose |
|---|---|---|---|
| `--rail-width` | `232px` | (same) | Desktop expanded rail width |
| `--rail-width-collapsed` | `64px` | (same) | Desktop/tablet collapsed rail width |
| `--context-bar-height` | `56px` | (same) | Desktop/tablet context bar |
| `--bottom-nav-height` | `56px` | (same) | Mobile bottom nav (plus safe-area inset, see §2.4) |
| `--mobile-context-bar-height` | `52px` | (same) | Mobile top context bar |
| `--color-rail-surface` | `var(--color-surface)` | `var(--color-surface)` | Rail/bottom-nav background — reuses the existing surface token, not a new hue |
| `--color-rail-active-bg` | `var(--color-surface-strong)` | `var(--color-surface-strong)` | Active rail-item / active bottom-nav-item fill — reuses the existing `--color-surface-strong`/`-fg` pair already used for the Visualization toolbar's selected-pill state (`globals.css:43-62`, D-23-53) |
| `--color-rail-active-fg` | `var(--color-surface-strong-fg)` | `var(--color-surface-strong-fg)` | Text/icon color on the active fill above |
| `--color-immersive-scrim` | `color-mix(in srgb, var(--color-background) 92%, transparent)` | (same formula) | Immersive-mode context-bar underlay, mirroring the existing header underlay technique (`AppShell.tsx:211`) rather than a new opaque color |

No new token invents a color; every one is either a pixel dimension or an alias to an existing
`--color-*`/`--color-surface-strong*` pair. This keeps the token-map risk at zero — a redesign that
changed hex values across 20+ existing tokens would need a full re-audit of every consumer; aliasing new
names to old values needs none.

### 1.3 Contrast computation (WCAG 2.2 AA, 4.5:1 normal text / 3:1 large text & UI components)

Computed directly (relative luminance → contrast ratio, standard WCAG formula) for every pair the new shell
introduces or reuses in a new context:

| Pair | Light ratio | Dark ratio | Verdict |
|---|---|---|---|
| `--color-text` on `--color-background` (rail/nav labels) | 14.29:1 | 16.61:1 | Pass (AA + AAA) |
| `--color-text-muted` on `--color-background` (secondary rail metadata) | 5.39:1 | 8.69:1 | Pass AA |
| `--color-text` on `--color-surface` (context-bar/rail-surface labels) | 13.22:1 | 15.17:1 | Pass |
| `--color-text-muted` on `--color-surface` (collapsed-rail tooltip/label) | 4.99:1 | 7.94:1 | Pass AA |
| `--color-accent-ink` on `--color-background` (active-item indicator bar) | 11.08:1 | 15.57:1 | Pass |
| `--color-surface-strong-fg` (`#fff`) on `--color-rail-active-bg` (active rail/bottom-nav pill) | 11.66:1 | 5.27:1 | Pass AA both themes |
| `--color-focus-ring` on `--color-background` (2px focus outline) | 11.08:1 | 15.57:1 | Pass — clears the AA non-text 3:1 floor by a wide margin |
| `--color-accent-burgundy` on `--color-background` | 7.58:1 | 8.60:1 | Pass (used for e.g. an active-state accent if ever needed) |
| `--color-accent-green` on `--color-background` | 6.90:1 | 9.14:1 | Pass |
| `--color-accent-umber` on `--color-background` | 6.28:1 | 8.54:1 | Pass |
| `--color-highlight` (gold) on `--color-background` — **decorative/large-only** | 2.99:1 | n/a (dark value `#dcbd7f` similarly bright) | **Fails 4.5:1 normal-text floor.** Confirms the existing rule already documented at `globals.css:85-94`: never use `--color-highlight` for text; use `--color-status-highlight-text` (5.08:1) instead. Stage 1 nav/rail code must not put label text directly in `--color-highlight`. |
| `--color-border` on `--color-background` (rail/nav hairline dividers) | 1.46:1 | n/a | **Below the 3:1 non-text floor** — acceptable ONLY as a purely decorative divider that is never the sole boundary cue for an interactive control. Stage 1 rule (binding): any element where the border is the *only* way to perceive a clickable/focusable boundary (e.g. a rail item's hover/selected state) must pair it with a background-fill or the `--color-focus-ring` outline, never rely on `--color-border` alone. This matches what `--color-rail-active-bg` already does (fill, not border) for the active state. |

**Binding rule for all new shell chrome:** any new text uses `--color-text`, `--color-text-muted`, or
`--color-status-highlight-text` — never `--color-highlight` directly. Any new interactive-boundary-only
affordance uses a fill (`--color-rail-active-bg`) or the focus ring, never `--color-border` alone.

### 1.4 Typography scale

Charter requirements (§7) mapped onto the existing scale (`globals.css:210-212, 264-266`, confirmed via
Stage-0 inventory §4):

| Charter requirement | Existing mechanism | Stage 1 decision |
|---|---|---|
| Scholarly serif for page titles/section headings | `--font-serif` = `Georgia, "Times New Roman", serif` (`globals.css:454-458`) already used for `Wordmark`/page `<h1>`s | Keep. Every new shell heading (rail section labels excluded — see below) uses `font-serif`. |
| Sans-serif for controls/tables/metadata/body UI | `--font-sans` (Geist Sans) | Keep as the default UI font; rail items, context bar, bottom nav all sans. |
| Default UI body text 16px | `body { font-size: calc(1rem * var(--app-font-scale)) }` (`:499`), 1rem = 16px at `medium` scale | Keep unchanged — the existing `data-font-size` scale (small 0.94 / medium 1 / large 1.12) already satisfies this; Stage 1 shell text uses `1rem` (16px effective) for primary rail/nav labels. |
| Secondary text 14px | No existing named token for this exact px value; components use `text-sm` (Tailwind, 0.875rem = 14px at scale 1) | Adopt `text-sm` for rail item captions and context-bar secondary text — already the app's de facto 14px utility, no new token needed. |
| Small metadata never below 12px | Tailwind `text-xs` = 0.75rem = 12px at scale 1 | Floor already respected by existing components (nav labels currently use `text-[11px]` — see §1.5 below, a pre-existing deviation this spec corrects). |
| Uppercase reserved for genuine metadata, not primary nav/actions | Current `NavLink` (`AppShell.tsx:310`) uses `uppercase tracking-[.08em] text-[11px]` for **primary nav**, which is exactly what the charter says NOT to do | **Corrected in Stage 1**: new rail/bottom-nav primary items render in sentence case, `text-sm` (14px) minimum, no `uppercase`. Uppercase small-caps treatment is retained only for genuine metadata labels (e.g. a status chip, a field caption like "Reading width") — not moved into this spec's scope beyond the rail/nav fix, since existing metadata labels elsewhere are Stage 3–6 territory. |

### 1.5 Pre-existing typography defect this spec fixes as part of the token/shell work

`AppShell.tsx:310`'s `NavLink` renders every primary-nav item at `text-[11px] uppercase` — below the
charter's 12px floor and using uppercase for primary navigation, which §7 explicitly prohibits. This is
fixed as part of the Stage 1 rail rebuild (not a separate task): new rail/bottom-nav items use `text-sm`
(14px) sentence case. This is called out here so it isn't mistaken for scope creep — it is required by the
same charter section (§7 typography) that authorizes this whole token/shell stage.

### 1.6 Motion tokens — unchanged

`--spring-fast`, `--spring-gentle`, `.app-reveal`, `.app-control`, the `data-motion="reduced"` blanket
override (`globals.css:133-134, 703-733, 752`) are reused as-is for every new shell primitive (rail
expand/collapse, drawer/sheet open, context-bar transitions). No new motion vocabulary is introduced —
consistent with charter §7's "every loading/empty/... state" reduced-motion requirement already being
satisfied app-wide by the existing blanket override.

---

## 2. Shell layout

### 2.1 Breakpoint contract (charter §6 "Global shell", verbatim thresholds)

| Viewport | Layout |
|---|---|
| `>=1024px` (desktop) | Collapsible 232px rail (`--rail-width`) + 56px context bar (`--context-bar-height`) |
| `768–1023px` (tablet) and desktop when the user collapses the rail | 64px rail (`--rail-width-collapsed`), icons + accessible labels/tooltips |
| `<768px` (mobile) | 56px bottom nav (`--bottom-nav-height`) + 52px top context bar (`--mobile-context-bar-height`), safe-area insets |

These thresholds are implemented as CSS custom-media-free plain `@media` queries (no new PostCSS plugin —
Tailwind's `md:`/`lg:` utilities already default to 768px/1024px, which match exactly, so the breakpoint
work is Tailwind-utility-only, no new token needed for the breakpoints themselves).

### 2.2 Component file plan

New files, all under `apps/web/src/components/shell/` (new directory):

| File | Responsibility |
|---|---|
| `AppShellRoot.tsx` | Top-level shell layout: renders `WorkspaceRail`, `ContextBar`, `<main>`, `MobileBottomNav`, mounts `CommandPalette`/`GlobalRagSidebar`/`AppFooter` exactly as `AppShell.tsx` does today. Replaces `AppShellContents` (see §2.3). |
| `WorkspaceRail.tsx` | Desktop/tablet rail: Home/Read/Research/Write items, collapse toggle, Upload action, profile-menu trigger anchored at the rail foot. Owns expanded/collapsed local+persisted state (see §2.5). |
| `WorkspaceRailItem.tsx` | One rail entry (icon + label, active-state fill, tooltip when collapsed). Shared by expanded and collapsed rail render paths so active-state logic lives in one place. |
| `ContextBar.tsx` | The 56px (desktop/tablet) / 52px (mobile) context bar: breadcrumb/title slot, contextual actions slot (e.g. Ask Library entry, work-scoped tabs anchor point for Stage 4+), search/command trigger. Route-aware content is injected via a small context (`ContextBarProvider`, below) rather than prop-drilled through every page. |
| `ContextBarProvider.tsx` | React context + hook (`useContextBar()`) letting a page (Stage 4+ Reader, Stage 5+ Research, Stage 6+ Writer) set the context bar's title/actions without `ContextBar.tsx` itself needing per-route knowledge. Stage 1 ships the provider and a default (breadcrumb = current nav section) fallback; individual pages populate it starting in their own stage. |
| `MobileBottomNav.tsx` | The `<768px` bottom nav: Home/Read/Research/Write (research/write conditionally per flag, same as today), safe-area-aware, 44px+ touch targets. |
| `UploadAction.tsx` | The persistent global Upload affordance — rendered inside `WorkspaceRail` (desktop/tablet, as a distinct pinned item, not just another nav row) and inside `ContextBar` on mobile (since the bottom nav's four slots are reserved for the primary destinations per charter §6, Upload cannot also occupy a fifth bottom-nav slot — see §3.6). |
| `ImmersiveLayoutToggle.tsx` | No visual output — a tiny client component that reads a route-group-provided `immersive` boolean (see §4) and toggles a `data-immersive` attribute on the shell root so CSS can hide the footer/minimize chrome without prop-drilling through every layout. |

Existing files that move/adapt rather than get deleted outright:

| Existing file | Disposition |
|---|---|
| `AppShell.tsx` | **Becomes a thin re-export/composition root.** Keeps the exported `AppShell` component name and prop signature (`userId`, `email`, `name`, `image`, `admin`, `writerEnabled`, `ragEnabled`, `researchEnabled`, `askResearchModesEnabled`, `initialPreferences`, `initialReaderLevel`, `children`) so `apps/web/src/app/(app)/layout.tsx:34`'s call site needs **zero changes**. Internally it now renders `ToastProvider` → `WorkspacePreferencesProvider` → `AppShellRoot` instead of the current `AppShellContents`. This is the one file every other shell file plugs into, matching the layout's existing centralized-auth-check design (`layout.tsx:12-18`'s own comment) — Stage 1 does not touch that auth boundary at all. |
| `AppFooter.tsx` | Unchanged content; only its mount point changes (rendered by `AppShellRoot` conditionally on `!immersive`, see §4). |
| `CommandPalette.tsx` | Unchanged logic (see §6); its `items` prop now also receives Home/Read/Research/Write as navigable entries alongside the existing per-flag list. |
| `GlobalRagSidebar.tsx` | Unchanged. Its trigger moves from the old header's icon-button row into `ContextBar.tsx` (see §3.7); the component itself is not touched in Stage 1. |
| `ProfileMenu.tsx` | Unchanged content/behavior; its trigger moves from the header to the rail foot (desktop/tablet) or the mobile context bar (mobile) — see §3.5. |
| `WorkspacePreferencesProvider.tsx` | Unchanged — still wraps the whole shell exactly as today. |
| `PreferenceBootstrap.tsx` | Unchanged — still mounted once at `(app)/layout.tsx`, still stamps `data-theme`/`data-font-size`/etc. on `<html>` before hydration. Stage 1 adds one more dataset write here: nothing — the rail's own collapsed/expanded state is **not** a `WorkspacePreferences` field (see §2.5), so no bootstrap-script change is needed. |
| `AppShellContents` (currently inline inside `AppShell.tsx:76-306`) | **Deleted**, its logic redistributed into `AppShellRoot.tsx` + `WorkspaceRail.tsx` + `ContextBar.tsx` + `MobileBottomNav.tsx`. Every piece of existing behavior it currently owns is accounted for below, not silently dropped: |

Behavior-preservation ledger for what `AppShellContents` currently does, and where each piece lands:

| Current behavior (`AppShell.tsx` line) | New home |
|---|---|
| `navItems` construction (`:109-119`) | `WorkspaceRail.tsx` + `MobileBottomNav.tsx` + `CommandPalette` items (shared helper, not duplicated three times — see §3.1) |
| Header-compact-on-scroll (`:84, 121-126`) | `ContextBar.tsx` (same scroll listener, same `header-compact` CSS class semantics, renamed conceptually to the context bar's own compact state) |
| Focus-mode exit button + focus-restoration (`:90-91, 127-138, 197`) | `AppShellRoot.tsx` (unchanged mechanism — the exit button is chrome-independent of rail/context-bar/bottom-nav, so it stays a top-level sibling exactly as today) |
| Reader-level state + `updateReaderLevel` (`:85, 147-162`) | Stays in `PreferencesMenu`, which itself stays a `WorkspaceRail`/mobile-context-bar-anchored popover (unchanged content, new anchor point — see §3.5) |
| Drawer open/close + focus trap (`:164-167, 313-357`) | **Removed as a concept.** Mobile no longer has a slide-in nav drawer — mobile navigation is the persistent bottom nav (charter §6), so there is nothing to open/close. The drawer's focus-trap *pattern* (not the component) is reused for the mobile secondary "Read management" sheet (Trash) — see §3.4. |
| Preferences popover open/close + outside-click (`:168-179, 192, 238-251, 359-405`) | `WorkspaceRail.tsx` (desktop/tablet trigger at rail foot) and `ContextBar.tsx` (mobile trigger) both call the same extracted `usePreferencesMenu()` hook wrapping the existing `useOutsideMenuClose` logic — one implementation, two anchor points, not a fork. |
| RAG sidebar trigger + reopen-guard (`:82, 106, 180-183, 253-270, 303`) | `ContextBar.tsx` (see §3.7) — same `useReopenGuard` hook, unchanged. |
| Profile menu trigger + outside-click (`:83, 184-193, 271-287`) | `WorkspaceRail.tsx` foot (desktop/tablet) / `ContextBar.tsx` (mobile) — same extraction pattern as preferences above. |
| `NavLink` active-state logic (`:308-311`) | `WorkspaceRailItem.tsx` (rail) + a mobile-bottom-nav-specific variant in `MobileBottomNav.tsx` (same `pathname === href \|\| startsWith` logic, tested once as a shared pure function — see §7). |
| `PageTransition` wrapping `children` (`:300`) | Unchanged, stays wrapping `children` inside `AppShellRoot.tsx`'s `<main>`. |
| `CommandPalette`/`GlobalRagSidebar` mount points (`:302-303`) | Unchanged mount level — still siblings of `<main>` inside the shell root. |

### 2.3 `AppShellRoot.tsx` structure (desktop/tablet)

```
<div className="app-shell" data-immersive={immersive}>
  {focusMode && <ExitFocusModeButton />}           {/* unchanged from today */}
  <WorkspaceRail ... />                             {/* fixed-position, 232px/64px */}
  <div className="app-shell-content-column">        {/* margin-inset-start: rail width */}
    <ContextBar ... />                              {/* sticky, 56px */}
    <main id="main-content"><PageTransition>{children}</PageTransition></main>
    {!immersive && <AppFooter />}
  </div>
  <CommandPalette items={...} />
  {ragEnabled && ragOpen && <GlobalRagSidebar ... />}
</div>
```

Mobile structure (`<768px`) is the same tree with `WorkspaceRail` replaced by `MobileBottomNav` (fixed to
the viewport bottom, not the content column) and `ContextBar` rendered at `--mobile-context-bar-height`
instead of `--context-bar-height`. Both are always-mounted; CSS media queries (not JS viewport detection)
decide which one is visible, so there is no client-side layout flash and no hydration mismatch risk — same
technique the existing header already uses for its `hidden md:flex`/`md:hidden` nav split (`AppShell.tsx:224,
288`).

### 2.4 Mobile safe-area insets

`MobileBottomNav.tsx` uses `padding-bottom: max(0px, env(safe-area-inset-bottom))` added to
`--bottom-nav-height` for its total reserved height (charter §6 "respecting safe-area insets"), and `<main>`
gets a matching `padding-bottom` equal to the nav's total rendered height (a `ResizeObserver`-free fixed
constant is sufficient since the nav's height never changes at runtime — only two conditional items
[Research/Write] can appear/disappear per feature flag, and flags don't change within a session, so the
constant is computed once from the flag props at render time, not observed).

### 2.5 Rail collapse state — where it lives

The rail's expanded/collapsed state on desktop (`>=1024px`, where the user can toggle it — tablet is
**always** collapsed per charter §6, not user-toggleable) is:

- **Not** a new `WorkspacePreferences` field. `WorkspacePreferences` is server-synced/DB-backed
  (Stage-0 inventory §5) for durable, cross-device reading preferences (theme, font size, reading width,
  etc.) — rail-collapsed is a viewport-chrome density choice closer to `GlobalRagSidebar`'s own width,
  which the codebase already treats as `localStorage`-only (`GlobalRagSidebar.tsx:22-32`'s own comment,
  explicitly reasoned there). Stage 1 follows that exact precedent: `localStorage` key
  `palimnote:rail-collapsed` (boolean), read synchronously in `WorkspaceRail.tsx`'s initializer exactly the
  way `GlobalRagSidebar.tsx:56` reads its stored width, defaulting to expanded (`false`) when unset or on
  first render server-side (SSR renders expanded; the client corrects itself before paint via the same
  lazy-`useState`-initializer pattern, so there is at most one non-flashing layout correction, never a
  visible pop).
- No DB migration, no new API route — this is explicitly the same category of decision the charter's own
  Arrange-mode guidance makes for the graph (§11 "Pinned positions... may be stored locally if no existing
  owner-scoped persistence exists... Do not add a database migration solely for saved layout").

---

## 3. Nav mapping (old → new)

Every current nav destination and every current shell affordance is accounted for below — none is silently
dropped.

### 3.1 Primary workspace items (rail / bottom nav)

| Old (`AppShell.tsx:109-119`) | New | Notes |
|---|---|---|
| Dashboard (`/dashboard`) | **Home** (`/dashboard`) | Same route. Charter §6 renames the *destination label*, not the URL — `/dashboard`'s own page content is explicitly Stage-4+/out-of-scope for Stage 1 (see §8); only the nav label and icon change this stage. |
| Visualization (`/graph`) | **Not a primary rail item.** Global `/graph` stays reachable per charter §6 ("leaves primary nav per charter section 8") | See §3.8 below for exactly where it moves. |
| Works | **Read → Reading Queue** (`/works`) | Read subnav item, not a top-level rail item — see §3.2. |
| Library | **Read → Library** (`/library`) | Read subnav item — see §3.2. |
| Ask Library (flag-gated) | **Context-bar entry**, not primary nav | Charter §6: "Ask Library entry in context bar (flag-gated)." See §3.7. |
| Writer (flag-gated) | **Write** (`/writer`) | Becomes a primary rail/bottom-nav item, flag-gated exactly as today (`writerEnabled`). |
| Research (flag-gated) | **Research** (`/research`) | Becomes a primary rail/bottom-nav item, flag-gated exactly as today (`researchEnabled`). |
| Upload | **Persistent global action**, not a plain nav row | Charter §6: "Put Upload in a persistent, clearly labeled action." See §3.6. |
| Admin (flag-gated) | **Profile menu only** | Charter §6: "Put Account and conditional Admin in the profile menu." See §3.5. |

Resulting **primary rail items** (desktop `>=1024px` expanded/collapsed, and mobile bottom nav): exactly
**Home, Read, Research (flag-gated), Write (flag-gated)** — four items maximum, matching charter §6's mobile
bottom-nav enumeration ("Home/Read/Research/Write") and §"Target information architecture" ("Use four
primary destinations"). When Research and/or Write are flag-disabled, the rail/bottom-nav simply renders
fewer items (2 or 3) rather than reserving empty slots — same "conditional" pattern the current code already
uses for Ask Library/Writer/Research/Admin (`AppShell.tsx:114-118`).

A shared pure function, `buildWorkspaceNavItems({ writerEnabled, researchEnabled })`, returns this exact
ordered list once; `WorkspaceRail.tsx`, `MobileBottomNav.tsx`, and the `CommandPalette` items prop all call
it, so the four-vs-fewer-item logic is defined in exactly one place (testable in isolation — see §7).

### 3.2 Read subnavigation

Charter §6 "Read" subnav: Reading Queue, Library, Upload, Trash (secondary but always reachable). Stage 1
decision for **where** this subnav renders: since Home/Read/Research/Write are the only *primary* rail
items, clicking **Read** in the rail does not itself navigate to a single page — it expands a subnav
disclosure (rail: an inline expandable group under the Read item, matching the existing collapsible-rail
requirement already in charter §6's "collapsible 232px workspace rail"; mobile: tapping the bottom nav's
Read item opens `/works` directly as the default Read destination, with Library/Upload/Trash reachable from
`ContextBar`'s secondary menu on that route — see below).

| Read subnav item | Route | Reachability |
|---|---|---|
| Reading Queue | `/works` (unchanged route) | Rail subnav (desktop/tablet); mobile bottom-nav Read tap default |
| Library | `/library` (unchanged route) | Rail subnav; mobile via the Read-section secondary menu (`ContextBar`'s "more" affordance while on any `/works*`/`/library*` route) |
| Upload | `/upload` (unchanged route) | Rail subnav **and** the persistent global Upload action (§3.6) — reachable two ways by design, not a conflict: the subnav entry is "go to the upload page," the global action is "start an upload from anywhere." |
| Trash | `/works/trash` (unchanged route) | **Secondary Read-management menu**, always reachable — a small "Manage" disclosure inside the Read rail-subnav group (desktop/tablet) and inside `ContextBar`'s overflow menu on Read-family routes (mobile), never removed from being reachable, matching charter §6's explicit "placed in a secondary Library/Read management menu but always reachable." |

This satisfies the Remaining-Tasks note in `docs/PROJECT-LOG.md` about Trash reachability review implicitly
(current code links to `/works/trash` from inside the Works page itself, `works/page.tsx:42-45`, confirmed
during this spec's own reading) — Stage 1 additionally exposes it from the shell chrome itself, which is a
strict reachability improvement, not a regression.

### 3.3 Work-scoped contextual header

Charter §6: "A work opens a persistent contextual work header with: Reader, Sources, Roadmap, Curriculum,
Concept Check, Knowledge Map, Work details/status." This is `ContextBar.tsx`'s route-scoped content on any
`/works/[workId]*` route, populated via `useContextBar()` (§2.2). **Stage 1 ships the mechanism (the
provider + the bar's rendering of whatever tabs a page registers) but does NOT populate the actual
work-scoped tab set** — that is explicitly Stage 4 (Read integration) work per the charter's own stage
breakdown (§15 Stage 4: "Persistent work context"). See §8.

### 3.4 Secondary drawer/sheet single-instance rule

Charter §6: "Never show more than one secondary drawer or bottom sheet on mobile." Stage 1's primitive layer
(§5) enforces this with one shared `useSecondaryPanel()` singleton hook: any component that wants to open a
drawer/sheet/bottom-sheet calls `openSecondaryPanel(id, content)`, and the hook guarantees at most one is
open at a time — opening a second one closes the first first (not stacked, not simultaneous). The existing
three independent popovers (preferences, profile, RAG sidebar) are **not** retrofitted onto this singleton
in Stage 1 for the *desktop* icon-button popovers (they're small anchored popovers, not full
drawers/sheets, and the charter's one-at-a-time rule is scoped to mobile drawer/sheet — its own words: "on
mobile"). On **mobile**, though, all of preferences/profile/RAG-sidebar/Trash-management do route through
the shared singleton, which is the concrete Stage 1 fix for the pre-existing duplicate-Ask-Library-mount
risk's *sibling* problem (a user opening the mobile RAG sheet and then the mobile preferences sheet without
closing the first) — narrower than the RAG-controller consolidation itself (Stage 4, per charter §"Ask
Library" bullet + §15 Stage 4), but the singleton this stage ships is exactly the seam Stage 4 will plug the
full RAG single-controller rule into.

### 3.5 Account + conditional Admin

Both live **only** in `ProfileMenu.tsx`'s existing content (unchanged), anchored at:
- Desktop/tablet: the rail foot (a fixed bottom slot in `WorkspaceRail.tsx`, replacing the old header's
  top-right avatar button — same component, same `admin` prop, same conditional Admin link inside it).
- Mobile: `ContextBar.tsx`'s trailing icon slot (replacing the old header's `hidden lg:block` desktop-only
  gate at `AppShell.tsx:271` — Stage 1 makes the profile menu reachable on every viewport, which the current
  code does not: today's `hidden lg:block` means phones/tablets currently have **no** profile-menu
  affordance in the header at all, relying solely on the mobile drawer's bottom "Log out" link
  [`AppShell.tsx:353`] for anything account-related. This is a reachability fix, not scope creep — Admin
  access without a working profile-menu entry point on mobile would be an actual capability loss under the
  charter's own "preserve reachability" constraint.)

### 3.6 Persistent Upload action

Rendered as a visually distinct pinned control — not styled identically to an ordinary nav row — in two
places simultaneously per viewport class:
- Desktop/tablet: `WorkspaceRail.tsx` renders `UploadAction` as a bordered/filled button directly under the
  four primary items, separated by a divider, always visible even when the rail is collapsed (in collapsed
  state it's an icon-only circular button, same accessible-label pattern as every other collapsed-rail
  item — see §3.9).
- Mobile: since the 4-slot bottom nav is reserved for Home/Read/Research/Write per charter §6's literal
  enumeration, `UploadAction` renders inside `ContextBar.tsx`'s mobile leading/trailing slot (a persistently
  visible icon button, not buried in a menu) rather than claiming a fifth bottom-nav slot.

### 3.7 Ask Library entry point

Context-bar entry (both desktop and mobile `ContextBar.tsx`), flag-gated on `ragEnabled` exactly as today.
Clicking it opens `GlobalRagSidebar` exactly as today (`AppShell.tsx:253-270, 303` logic moves verbatim into
`ContextBar.tsx`, same `useReopenGuard` hook, same accessible name "Library chat sidebar" so the existing
`workspace-shell.spec.ts` assertions keep matching — see §7).

### 3.8 `/graph` reachability

**Decision: `/graph` is reachable from the command palette (⌘K) as a first-class navigable entry, plus a
context-bar icon button on desktop/tablet ("Knowledge Map" — matching the charter's own §8 naming for the
3D surface), not from the primary rail.** Rationale: charter §"Target information architecture" explicitly
lists only four primary destinations and separately states (§6) "`/graph` stays reachable (context bar or
command palette — decide) but leaves primary nav per charter section 8" — this spec decides **both**
placements are used (context-bar icon on desktop/tablet where there's room; command palette everywhere,
including mobile where context-bar space is scarcer) rather than picking only one, since the charter
explicitly authorizes "context bar **or** command palette," which is naturally satisfied more robustly by
both without violating anything (neither placement is a primary-nav item, so the "leaves primary nav"
constraint holds either way). `/works/[workId]/graph` (the work-scoped Knowledge Map) is additionally
reachable from the work-scoped contextual header (§3.3, Stage 4 work) once that ships — Stage 1 itself only
needs the global entry point to exist, which the context-bar icon + command-palette item both provide
immediately.

### 3.9 Collapsed-rail accessible labels

Every rail item, collapsed or expanded, is a real `<Link>` (or `<button>` for the collapse toggle/Upload/
profile trigger) with a **visible** text label when expanded and an `aria-label` plus a CSS-tooltip
(`data-tooltip`, reusing the exact pattern the existing icon-buttons already use — `data-tooltip="Workspace
preferences"` etc., `AppShell.tsx:229,250,258` — confirmed as an existing, working CSS-only tooltip
convention, not something Stage 1 invents) when collapsed. This directly satisfies charter §6's "64px:
icons + accessible labels/tooltips" wording, using a mechanism the codebase already has rather than a new
one.

---

## 4. Immersive mode

**Routes:** Reader (`/works/[workId]/reader`), the global and work-scoped Knowledge Map (`/graph`,
`/works/[workId]/graph`), and Writer (`/writer/[projectId]`) — exactly the three surfaces charter §6 names
("Hide the marketing-style footer and minimize global chrome in Reader, Knowledge Map, and Writer").

**Mechanism:** a route-group layout flag, not per-page opt-out logic scattered across pages. Concretely:

1. A new tiny server component, `apps/web/src/app/(app)/_shell/ImmersiveRouteFlag.tsx`, is rendered once at
   the top of each of the three route segments' own `layout.tsx` (Reader's, graph's, and Writer's — three
   one-line additions, each just `<ImmersiveRouteFlag />` before `{children}`). It renders nothing visible;
   it writes a value into a request-scoped context that `AppShellRoot.tsx` reads via React's
   `useSyncExternalStore`-free simplest option: a plain client-side `IMMERSIVE_ROUTES` prefix-match array
   (`["/works/", "/graph"]` combined with a route-specific suffix check for `/reader` and `/graph`, plus
   `"/writer/"`) evaluated against `usePathname()` **inside `AppShellRoot.tsx` itself** — i.e., Stage 1 does
   NOT actually need the server-side flag component at all, because the shell already has `pathname` via
   `usePathname()` (exactly as `AppShell.tsx:77` does today) and immersive-or-not is a pure function of the
   pathname, matching the existing `WORK_ROUTE_PATTERN` regex precedent at `AppShell.tsx:34`. **Simplified
   decision: `isImmersiveRoute(pathname)` is one pure, unit-tested function living in
   `apps/web/src/components/shell/immersive.ts`, called once inside `AppShellRoot.tsx`.** This is simpler
   than a route-group-layout-flag-plus-context-plumbing approach and needs no new server component, no new
   route-group restructuring, and no risk of the flag and the actual rendered route silently drifting apart
   (a real risk the charter's own Known-Problems-style caution about "migration timing" would flag if this
   were built as two independently-updated things instead of one function evaluated against the single
   source of truth, `pathname`).
2. `AppShellRoot.tsx` sets `data-immersive={isImmersiveRoute(pathname)}` on the shell root div and:
   - Does not render `<AppFooter />` when immersive.
   - Passes a `compact` prop to `ContextBar.tsx` (immersive routes get a slimmer, minimal-chrome bar — same
     52/56px height, but only a back-to-context breadcrumb + the essential contextual actions, no
     decorative elements) — this is a rendering variant of the same `ContextBar` component, not a second
     component, so Reader/Knowledge-Map/Writer's own contextual tabs (Stage 4–6 work) still have exactly one
     place to register into.
   - Desktop rail still renders (charter does not say to hide the rail in immersive routes, only the
     footer/"global chrome" broadly) but Stage 1 additionally auto-collapses it (not force-hides it) the
     first time a user lands on an immersive route in a session, respecting the user's own subsequent manual
     expand/collapse choice thereafter (same `localStorage` key from §2.5 — auto-collapse only writes a
     default the first time that key has never been set, never overrides an explicit user choice).
   - Mobile bottom nav is unaffected (charter doesn't ask to hide it, and hiding primary navigation entirely
     on mobile while inside Reader/Writer would strand the user without a way back to Home/Research —
     worse than the minimized-chrome goal actually intends).

**Compatibility check:** `isImmersiveRoute()` must correctly classify `/works/[workId]/roadmap`,
`/works/[workId]/curriculum`, `/works/[workId]/diagnostic` as **non**-immersive (they are work-scoped but
are not Reader/Knowledge-Map/Writer) — only `/works/[workId]/reader` and `/works/[workId]/graph` match.
This is a named unit-test case in §7.

---

## 5. Primitives

### 5.1 Inventory: what exists today (patterns, not shared components)

Confirmed by reading every current dialog-shaped surface: **no shared `Dialog`/`Drawer`/`BottomSheet`
component exists.** Each of the following independently hand-rolls its own `role="dialog"`, its own
Tab-key focus trap, and its own Escape handling, with near-identical (but not literally shared) code:

| Surface | File | Focus-trap / Escape mechanism |
|---|---|---|
| Mobile nav drawer | `AppShell.tsx:313-357` (`MobileDrawer`) | Inline `keepFocusInDrawer()` querying focusable descendants each keydown |
| Preferences popover | `AppShell.tsx:359-404` (`PreferencesMenu`) | `onKeyDown` Escape only; no Tab-trap (small popover, relies on natural DOM tab order plus `useOutsideMenuClose`) |
| Command palette | `CommandPalette.tsx:67-87` (`trapFocus`) | Same querying-focusable-descendants pattern as `MobileDrawer`, independently written |
| Profile menu | `ProfileMenu.tsx` | Not opened line-by-line this pass, but confirmed (Stage-0 inventory) to be the same `role="dialog"` + outside-click pattern |
| Feedback modal | `FeedbackModal.tsx:201` | Own `role="dialog"`, not opened further this pass |
| RAG chat panel | `RagChatPanel.tsx` (via `GlobalRagSidebar`) | Drawer-presentation `role="dialog"`, own focus handling |

Existing reusable **hooks** (genuinely shared, unlike the components above):
- `useOutsideMenuClose(open, onCloseFromOutside, containerRef)` — pointerdown-outside detection.
- `useReopenGuard(windowMs)` — debounces a reopen-immediately-after-close race (currently RAG-sidebar-only).
- `ToastProvider.tsx:23` — a genuinely shared `aria-live="polite" aria-atomic="true"` live region, already
  the one real precedent for a shared status/announcement primitive.

### 5.2 What Stage 1 builds

Four new files under `apps/web/src/components/primitives/` (new directory), each extracting the
**mechanism** that's currently duplicated 3–4 times, without changing any existing surface's visual
behavior in Stage 1 (existing dialogs are migrated onto the new primitives incrementally in later stages —
see §8 — Stage 1 itself only needs the primitives to exist and to be used by the **new** Stage 1 chrome:
`WorkspaceRail`'s collapse-toggle tooltip, the new mobile "Read management" sheet, and `ContextBar`'s new
overflow menu):

| New file | Extracts | Used by (Stage 1) |
|---|---|---|
| `useFocusTrap(containerRef, active)` | The Tab-key-cycling logic duplicated in `MobileDrawer`/`CommandPalette` | New mobile "Read management" sheet (§3.2); available for later-stage migration of the existing four dialogs |
| `useDialogEscape(active, onClose)` | Escape-key-closes-and-doesn't-bubble pattern (currently ad hoc per component, e.g. `PreferencesMenu.tsx:383`'s inline `onKeyDown`) | New `ContextBar` overflow menu, new mobile sheet |
| `useFocusRestoration(triggerRef)` | The "focus the trigger on close" pattern (currently duplicated in `closeDrawer`/`closePreferences`/`closeRag`/`closeProfile`, `AppShell.tsx:164-190`) | Every new Stage 1 popover/sheet trigger (rail collapse toggle doesn't need it — it's not a dialog — but the new mobile secondary sheets do) |
| `useSecondaryPanel()` | The mobile one-at-a-time singleton described in §3.4 | Mobile preferences/profile/RAG/Trash-management sheets |

Additionally, two small **presentational** primitives (not just hooks, since they render real markup used
by multiple Stage 1 surfaces):

| New file | Purpose |
|---|---|
| `LiveRegion.tsx` | Thin wrapper around the existing `ToastProvider` live-region pattern, generalized so `ContextBar`'s job-status/loading announcements (e.g. a future "Extraction in progress" chip) and the rail's own state changes can announce politely without each hand-rolling `aria-live` markup. Stage 1 uses it for exactly one thing: announcing rail collapse/expand state changes to screen-reader users ("Navigation collapsed" / "Navigation expanded"). |
| `EmptyState.tsx` | A generic empty/loading/error-state card (icon slot, heading, body text, optional action) — charter §7: "Every loading, empty, unavailable, partial, failed, and retrying state must explain what happened and what the user can do." Stage 1 uses this **once**, for the new Read-management ("Trash") mobile sheet's empty state, and makes it available for Stage 3–6 to reuse rather than each stage re-inventing its own empty-state markup. |

### 5.3 Focus-restoration requirements (binding for every Stage 1 primitive)

- Every dialog/drawer/sheet/menu opened by a trigger button restores focus to that exact trigger element on
  close, **except** when closed by an outside pointerdown — matching the existing, already-reasoned
  distinction in `AppShell.tsx:172-179`'s comment (outside-click close deliberately does not yank focus back,
  since the user was already interacting with something else).
- Command-palette-style surfaces (where the "trigger" can be a global keyboard shortcut with no visible
  button, e.g. ⌘K) restore focus to `document.activeElement` at open time, not a fixed ref — matching
  `CommandPalette.tsx:26,36`'s existing (correct) approach, which Stage 1 keeps unchanged.
- No new primitive introduces a focus trap for a non-modal popover (the existing preferences/profile menus
  correctly rely on natural tab order + outside-click rather than an artificial trap, since they're small
  anchored popovers, not full-screen modals) — `useFocusTrap` is opt-in per surface, not force-applied to
  every primitive.

---

## 6. Command palette

### 6.1 Current implementation summary

`CommandPalette.tsx` (131 lines) is a single client component, mounted once at shell level
(`AppShell.tsx:302`), opened via `⌘K`/`Ctrl+K` or a dispatched `palimnote:open-command-palette` custom
event (fired from the header's search icon-button today, from `ContextBar`'s search trigger in Stage 1).
It searches two independent lists client-side (case-insensitive substring match, no fuzzy/ranked search):
the `items` prop (nav links) and a fetched `works` list (`GET /api/command-menu`, fetched lazily on first
open and cached in component state for the session). Results render in two labeled groups ("Navigate",
"Uploaded works"), capped at 8 works. Full keyboard support: focus-trapped, Escape closes, Enter/click
selects and navigates, closing without stealing focus from wherever the trigger came from.

### 6.2 Stage 1 foundation work

- `items` prop now receives the new four-item primary list from `buildWorkspaceNavItems()` (§3.1) instead of
  the old nine-item flat list — **same prop shape** (`{ href, label, shortcut? }[]`), so `CommandPalette.tsx`
  itself needs no logic change, only what's passed in from `AppShellRoot.tsx`.
- The Upload shortcut (`shortcut: "U"` today, `AppShell.tsx:302`) is preserved unchanged.
- `/graph` (Knowledge Map) is added to the `items` list as a fifth navigable entry (see §3.8) — this is the
  one actual content change to what the palette lists, and it's additive, not a restructuring.

### 6.3 Extension seam (defined now, built later)

Later stages (charter §6: "expand it to works, Library records, passages, projects, claims, debates,
hypotheses, and writing projects") will add more searchable entity types. Stage 1 defines — but does not
implement — the seam this expansion plugs into, so a later stage isn't stuck retrofitting the whole
component:

```ts
// Stage 1 ships this type and the two existing groups conforming to it.
// Later stages add new PaletteResultGroup entries; CommandPalette.tsx's
// rendering loop (already `.map`-based over groups, not hand-duplicated
// per-group JSX) does not need to change shape to accept a third group.
interface PaletteResultGroup {
  id: string;                 // "navigate" | "works" | later: "library" | "claims" | ...
  label: string;               // group heading text
  results: PaletteResult[];
}
interface PaletteResult {
  id: string;
  href: string;
  primaryText: string;
  secondaryText?: string;
  shortcut?: string;
}
```

Stage 1 refactors `CommandPalette.tsx`'s two hard-coded groups (`visibleNavigation`, `visibleWorks`) to both
conform to this shape and render via one shared `.map()` over an array of groups, rather than two
copy-pasted `<PaletteGroup>` blocks (`CommandPalette.tsx:112-117` today) — a small internal simplification
that costs nothing behaviorally (same visible output, same tests pass unchanged) but means a later stage
adding a `claims` group is an additive array entry, not a structural edit. The actual new fetch
endpoints/entity types themselves are explicitly **not** Stage 1 scope (no new `/api/command-menu` query
params, no new searchable entity backend) — that lands with whichever stage owns claims/debates/etc.
(Stages 3–6).

---

## 7. Compat: existing E2E specs asserting current shell/nav structure

Grepped `apps/web/e2e/*.spec.ts` for shell/nav-structure assertions. Three specs assert on the primary-nav
landmark or shell chrome directly; several more assert on individual shell affordances by accessible name
(these survive unchanged as long as the accessible names are preserved — see the "New assertion" column for
which ones are, and are not, touched).

| Spec | Current assertion | Intended new assertion |
|---|---|---|
| `graph.spec.ts:73-75` ("promotes Visualization in the main nav...") | `page.getByRole("navigation", {name:"Primary navigation"}).locator("a").allTextContents()` must contain `["Visualization","Works","Library"]` with `Visualization` before `Works` | **Must be rewritten, not preserved as-is** — under the new IA, "Visualization"/"Works"/"Library" are no longer primary-nav items at all (they're Read-subnav items and a context-bar/palette entry per §3.1/§3.8). New assertion: the primary-nav landmark's link text equals exactly `["Home","Read","Research","Write"]` (flag-dependent subset), and a **separate** new assertion (not the same locator) confirms the Knowledge Map is reachable via the command palette (`⌘K` → visible "Knowledge Map" result) and, on desktop, via a `ContextBar` icon button. This is a deliberate IA-structure rewrite per program rules ("updating a shell test to assert the NEW intended IA is legitimate"), not a deletion of coverage — the underlying capability (Visualization is promoted/reachable) is asserted just as strongly, against the new location. |
| `responsive-visual.spec.ts:618` (`Primary navigation` landmark, viewport sweep) | Asserts the nav landmark doesn't cause horizontal overflow at various viewports | **Preserved** — still asserts `getByRole("navigation", {name:"Primary navigation"})` exists and doesn't overflow; the landmark name (`"Primary navigation"`) is kept unchanged on the new rail/bottom-nav `<nav>` element specifically so this assertion (and any other by-accessible-name lookup) needs no rename, only the visible-item-count expectation to match the new four-or-fewer-item list. |
| `workspace-shell.spec.ts` (36 assertions across the file, Stage-0 inventory §7) | Extensive: `Workspace preferences` button/dialog, `Account menu` button/dialog, `Open navigation` button + `Mobile navigation` dialog, `Library chat sidebar` button + `Ask Library — global sidebar`/`Ask Library — Reader panel` dialogs, `Exit focus mode`, `Command palette` dialog, focus-restoration assertions, the mobile-drawer-as-modal test (`:504-521`) | **Mostly preserved by accessible name, with the mobile-drawer test rewritten.** Every popover/dialog accessible name (`"Workspace preferences"`, `"Account menu"`, `"Ask Library — global sidebar"`, `"Ask Library — Reader panel"`, `"Command palette"`) is kept unchanged in Stage 1 (§3.5, §3.7, §6) specifically so these assertions keep passing without a rename. **The one test that must change structurally**: `"treats mobile navigation as a modal drawer and restores its trigger"` (`:504-521`) — there is no more slide-in `MobileDrawer`/`"Open navigation"` button under the new IA (mobile nav is the persistent bottom nav, §2.2/§3.1, not a drawer). This test is rewritten to assert the new mobile bottom-nav structure instead: exactly the primary items render as a `role="navigation"` (or the bottom-nav's own accessible name) with 44px+ targets, safe-area padding present, and — replacing the "modal drawer" assertion — a new test for the mobile **secondary Read-management sheet** (§3.2/§3.4) as the thing that now behaves like a modal (focus-trapped, Escape-closes, restores focus), since that's the actual remaining modal-sheet surface on mobile. This is an IA-structure rewrite of one test, not a deletion — the "focus behaves correctly in a modal mobile surface" capability is still asserted, against the surface that now actually has that shape. |
| `library.spec.ts`, `upload.spec.ts`, `trash.spec.ts` (various `getByRole("link", {name: ...})` for in-page links like "Open work", "Upload a work", "Owner's Private Work") | Page-content links, not shell-nav links | **Fully preserved, unaffected** — none of these assert on the primary-nav landmark or shell chrome; they assert on links rendered by the pages themselves, which Stage 1 does not touch (see §8). |
| `account.spec.ts` | No `Primary navigation` grep hits; asserts page content (`account/usage` image alt text etc.) | **Fully preserved, unaffected.** |
| `admin-dash.spec.ts` | Asserts `admin-dash` (separate cookie-auth surface) headings, not the signed-in-user shell at all | **Fully preserved, unaffected** — `admin-dash` is architecturally outside `AppShell`/`(app)` entirely (Stage-0 inventory §1), so this redesign doesn't touch it. |
| `accessibility-sweep.spec.ts`, `competency-signals.spec.ts`, `ask-research-modes.spec.ts`, `rag.spec.ts`, `canonical-identity.spec.ts` (many `getByRole("button", {name:"Ask Library"})` / `getByRole("dialog", {name:"Ask Library — Reader panel"})` hits) | Reader's own contextual Ask Library toggle/drawer — a Reader-internal affordance, not shell-level | **Fully preserved, unaffected** — this is `ReaderShell.tsx`'s own button (Stage-0 inventory §6, mount #2), explicitly Reader-internal and therefore Stage 4+ scope (§8), not touched by the shell/rail/context-bar work in Stage 1. |
| `performance.spec.ts:252` (`getByRole("heading", {name:"Writer"})`) | Page-level `<h1>` on the Writer list page | **Fully preserved, unaffected** — a page heading, not shell chrome. |

**Net compat summary:** two specs need a deliberate, charter-mandated IA-structure rewrite
(`graph.spec.ts`'s primary-nav-content assertion, and `workspace-shell.spec.ts`'s single mobile-drawer test);
every other shell-adjacent assertion — every dialog/popover accessible name, the `"Primary navigation"`
landmark name itself, every Reader-internal/page-internal link assertion — is preserved verbatim by Stage 1
keeping those exact accessible names and landmark roles stable across the rail/context-bar/bottom-nav
rebuild.

---

## 8. Stage boundary — what Stage 1 does NOT touch

Explicitly out of scope for this stage (owned by the stages named, per charter §15):

- **Reader internals** (Stage 4): `ReaderShell.tsx`'s own toolbar, outline, apparatus/terms/sources/claims
  panels, the Reader's own contextual Ask Library toggle/drawer, split-view, Published-Edition/Interactive-
  Reader/original-file switching, highlights/notes/bookmarks/saved-position. Stage 1 only adds the
  `isImmersiveRoute()` chrome-minimization wrapper (§4) and the not-yet-populated `useContextBar()` seam
  (§3.3) around the Reader route — none of the Reader's own rendered content changes.
- **Graph/Knowledge Map internals** (Stages 2–3): the renderer bakeoff, the actual 3D scene, camera
  controller, depth bands, node/edge grammar, the context chooser, 2D/List views. Stage 1 only decides
  where `/graph` is *linked from* (§3.8) and that it gets the immersive-chrome treatment (§4) — the page's
  own content, current `layout=explore`/`roadmapRoot` query-param handling, and every other graph-specific
  behavior in the charter (§8–§14) is untouched.
- **Research page internals** (Stage 5): project overview/corpus/claims/debates/chambers/hypotheses/
  monitors content, the claims/evidence tables, `window.prompt`/`window.alert` replacement, the canonical
  research-pipeline-action consolidation. Stage 1 only makes `/research` a primary rail/bottom-nav
  destination and gives it the (currently empty) `ContextBar` project-nav seam to populate later.
- **Writer internals** (Stage 6): the editor layout, Sources/Evidence panel, Citations/History panel,
  autosave/revision UI. Stage 1 only makes `/writer` a primary rail/bottom-nav destination and applies the
  immersive-chrome treatment.
- **Dashboard/Home page content** (Stage 4, per charter §6 "Home" bullet list — resume reading, review a
  claim, continue research, latest Writer draft, etc.): Stage 1 renames the nav label to "Home" and keeps
  routing it to `/dashboard`; the page's own current "counter-led" content (Stage-0 inventory notes it as
  "light cross-cutting overview") is not rewritten this stage.
- **Legacy graph URL compatibility table, focus-mode camera state, graph query-param translation** (charter
  §9's compatibility table): entirely a graph-page-internal concern, Stage 3 scope.
- **The duplicate-RAG-controller consolidation itself** (charter's "Ask Library" bullet, "Eliminate the
  current risk of duplicate... instances competing for state"): Stage 1 ships the mobile one-at-a-time
  *shell-chrome* singleton (§3.4) as a down-payment on this, but the actual cross-surface (Reader-drawer vs.
  shell-global-sidebar) single-controller consolidation the charter describes is Stage 4 work, since it
  requires touching `ReaderShell.tsx` itself.
- **Any new database migration, new AI/paid-API call, or production deploy** — none is needed or performed
  for Stage 1; every decision above is either a pure client-side/CSS change or a `localStorage`-only state
  addition (§2.5), consistent with the worktree's standing constraints.

---

## Summary of files this spec commits to creating/modifying in Stage 1 implementation

New: `apps/web/src/components/shell/{AppShellRoot,WorkspaceRail,WorkspaceRailItem,ContextBar,
ContextBarProvider,MobileBottomNav,UploadAction,ImmersiveLayoutToggle,immersive}.{tsx,ts}`,
`apps/web/src/components/primitives/{useFocusTrap,useDialogEscape,useFocusRestoration,useSecondaryPanel,
LiveRegion,EmptyState}.{tsx,ts}`.

Modified: `apps/web/src/components/app/AppShell.tsx` (becomes the thin composition root), `globals.css`
(additive tokens only, §1.2), `graph.spec.ts` and `workspace-shell.spec.ts` (the two IA-structure test
rewrites in §7).

Unchanged: `apps/web/src/app/(app)/layout.tsx` (same `AppShell` call signature), `AppFooter.tsx`,
`CommandPalette.tsx` (internal logic), `GlobalRagSidebar.tsx`, `ProfileMenu.tsx`,
`WorkspacePreferencesProvider.tsx`, `PreferenceBootstrap.tsx`, every Reader/Research/Writer/Graph page's own
internal content, every non-shell E2E assertion.
