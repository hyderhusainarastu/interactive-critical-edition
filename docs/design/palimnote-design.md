# Palimnote Design Reference

Repository-derived ground truth for the token/spacing/typography system, promised by
`docs/audits/phase-19-frontend-tooling.md` (§"Stitch" substitution, "`docs/design/palimnote-design.md`
... will still be built from the real repository tokens") but never written until this pass. Every
value below is read directly from the code, cited `file:line`, as of this doc's commit — it is a
reference sheet, not an aspirational spec. If a cited line moves, re-derive rather than trust this
file blindly.

Two stylesheets carry the whole system: `apps/web/src/app/globals.css` (the signed-in app) and
`apps/web/src/app/site-theme.css` (the public marketing pages, scoped so it cannot leak into the app).

---

## 1. Color tokens (`globals.css`)

20 `--color-*` custom properties are declared on `:root` (`apps/web/src/app/globals.css:20-89`), with
explicit dark-mode values under `:root[data-theme="dark"]` (`:93-113`) and a mirrored
`:root[data-theme="light"]` block (`:115-136`) for when the attribute is set explicitly rather than
left to the (bone-white) default. There is **no** `@media (prefers-color-scheme: dark)` auto-flip —
dark is opt-in only via the reader's theme toggle (comment, `:4-11`).

| Token | Light | Dark | WCAG note (from the token's own comment) | Line (light / dark) |
|---|---|---|---|---|
| `--color-background` | `#fbf9f4` | `#10171e` | base page surface | 21 / 93 |
| `--color-surface` | `#f4f0e7` | `#16202a` | raised/card surface | 22 / 94 |
| `--color-text` | `#172838` | `#f2f6f9` | >14:1 on background | 23 / 95 |
| `--color-text-muted` | `#5f6870` | `#a7b6c2` | secondary text | 24 / 96 |
| `--color-border` | `#d7d0c3` | `#2d3d4a` | hairline rules | 25 / 97 |
| `--color-accent-burgundy` | `#7a3f48` | `#e0a3ac` | category/status accent | 27 / 98 |
| `--color-accent-green` | `#3e5d52` | `#8fc4a8` | category/status accent, "good" reused by credibility | 28 / 99 |
| `--color-accent-ink` | `#263a4f` | `#e9eff4` | category/status accent, doubles as `--color-focus-ring` | 29 / 100 |
| `--color-accent-umber` | `#765641` | `#d3ab86` | category/status accent | 30 / 101 |
| `--color-highlight` | `#b48a47` | `#dcbd7f` | decorative/translucent gold only — **fails 4.5:1 as literal text (2.99:1)**, see `--color-status-highlight-text` | 31 / 102 |
| `--color-surface-sunken` | `#eee8dd` | `#202c37` | 3rd surface-ladder step (UI-overhaul §1.3) | 38 / 109 |
| `--color-surface-strong` | `#263a4f` | `#4a6f93` | solid-fill buttons/table heads | 39 / 110 |
| `--color-surface-strong-fg` | `#ffffff` | `#ffffff` | text on `--color-surface-strong` | 40 / 111 |
| `--color-surface-strong-fg-soft` | `#e9e3d9` | `#eef3f7` | secondary text on `--color-surface-strong` | 41 / 112 |
| `--color-credibility-critical` | `#b3261e` | `#ff6b5e` | credibility banding (plan §36 11.2), more saturated on purpose | 48 / 103 |
| `--color-credibility-warning` | `#a8630a` | `#f0a94e` | credibility banding — **not safe for small text**, see `--color-beta-badge` | 49 / 104 |
| `--color-beta-badge` | `#91540a` | `#f0a94e` | ~5.6:1 light / >7:1 dark — split from `--color-credibility-warning` (D-23-21, below) | 62 / 105 |
| `--color-status-highlight-text` | `#8a6423` | `#dcbd7f` | ~5.08:1 light / ~10:1 dark — split from `--color-highlight` for gold-colored *text* | 73 / 106 |
| `--color-graph-dim-text` | `#726a5c` | `#968e7c` | ~4.7:1 / ~5.1:1 on `--color-surface` — de-emphasized graph-table rows (Phase 21.6) | 83 / 107 |
| `--color-focus-ring` | `#263a4f` | `#e9eff4` | `:focus-visible` outline | 85 / 108 |

Font-size/reading-width/reading-mode tokens live alongside these (`:138-152`): `--app-font-scale`
(`data-font-size` = small/medium/large → 0.94/1/1.12) and `--reading-measure` (`data-reading-width` =
compact/comfortable/wide → 58ch/72ch/88ch).

### Public-site-only palette (`site-theme.css`, `.pal-site` scope, lines 84-144)

The public pages (`/`, `/privacy`, `/terms`) declare an additional set of palette variables and then
**remap the app's own `--color-*` tokens onto them** (`:145-157`), so `/privacy`/`/terms` — built from
Tailwind arbitrary-value utilities like `text-[var(--color-text)]` — retheme with only a wrapper class:

| Public-only token | Light | Dark override | Purpose | Line |
|---|---|---|---|---|
| `--ink` / `--ink-deep` | `#263a4f` / `#172838` | `#e9eff4` / `#f2f6f9` | headings / deepest text | 86-87, 699-700 |
| `--paper` / `--paper-light` | `#f4f0e7` / `#fbf9f4` | `#16202a` / `#10171e` | surfaces (→ `--color-surface`/`--color-background`) | 88-89, 701-702 |
| `--muted` | `#5f6870` | `#a7b6c2` | darkened from the campaign source `#687078` (4.42:1, failing) | 90, 703 |
| `--rule` | `#d7d0c3` | `#2d3d4a` | hairlines (→ `--color-border`) | 91, 704 |
| `--ui-muted` / `--ui-muted-dark` | `#62615a` / `#93a3af` | — | small chrome text inside product depictions, ≥4.7:1 | 100-101, 710 |
| `--prose-page` | `#485562` | `#cddae3` | long-form hero/copy prose | 104, 711 |
| `--solid-bg` / `--solid-fg` | `#263a4f` / `#ffffff` | `#4a6f93` / `#ffffff` | solid-fill buttons/table heads (split from `--ink` because dark-mode `--ink` is a *text* color) | 109-111, 713-715 |
| `--band-dark` / `--band-closing` | `#172838` / `#7a3f48` | `#060c12` / `#55282f` | the graph/integrity/closing bands — deliberately dark or burgundy **in both themes** | 142-143, 745-746 |

---

## 2. The `.pal-site` / `.pal-landing` scope system (`site-theme.css`)

**Why the split is load-bearing, not cosmetic** (documented in the stylesheet's own header,
`site-theme.css:1-72`, and in `docs/CHANGELOG.md:11`): the campaign stylesheet this was ported from
styles bare element selectors (`h1`, `h2`, `nav`, `footer`, `details`, `summary`). Without scoping,
those rules would reach every signed-in workspace page.

| Scope | Carries | What it owns |
|---|---|---|
| `.pal-site` | `/`, `/privacy`, `/terms` | palette + `--color-*` token remap + shared shell (masthead, footer, page width) — `site-theme.css:84-225` |
| `.pal-landing` | `/` only | the campaign layout itself: hero, section furniture, product depictions, graph band, FAQ, closing — `:230-681` |

**The concrete reason two scopes exist rather than one:** the campaign sheet sets `h1`/`h2`/`h3` sizes
on bare elements. `.pal-site h1` has specificity (0,1,1), which **outranks** Tailwind's `text-3xl`
utility class (0,1,0). A single combined scope would have blown `/privacy`'s and `/terms`' own headings
up to the landing page's 7rem hero size. Keeping the display-type rules under `.pal-landing` instead
leaves those two pages' existing utility classes in charge (`site-theme.css:22-26`; also recorded in
`docs/CHANGELOG.md:11`, "the split is load-bearing").

Three deliberate additions the port made over a straight copy (`site-theme.css:28-65`):
1. **Token remap** — `.pal-site` repoints the app's own `--color-*` variables at the campaign palette
   (`:145-157`), so `/privacy`/`/terms` retheme with zero markup/copy churn.
2. **Contrast pass** — several source greys measured 3.2–4.4:1 against their own backgrounds (would
   have failed the landing page's own axe gate); replaced by `--ui-muted`/`--ui-muted-dark`, each
   ≥4.5:1 with headroom.
3. **Dark mode** — ~30 hardcoded warm hex values across the depictions became surface/edge/accent
   tokens declared once in `.pal-site`, so the dark variant (`:698-753`) is a single override block, not
   a parallel copy of every rule. The one documented, *proven* exception: consolidating six
   near-identical hairline greys onto one `--edge` (and `#eee8dc`→`--surface-sunken`'s `#eee8dd`) was
   verified to leave all four landing-contract baseline screenshots **byte-identical** — below the
   image comparator's own per-pixel threshold, not merely "close enough" (`site-theme.css:44-57`).

The 3D graph's own canvas palette (`entityColors`/`relationColors` in
`apps/web/src/components/site/InteractiveGraph.tsx:119-120`) is explicitly **untouched** by any of
this — literal hex, ported as-is, renders identically in both themes (`site-theme.css:63-65`).

---

## 3. Typography

| Element | Stack / treatment | Source |
|---|---|---|
| `--font-serif` | `Georgia, "Times New Roman", serif` — system stack, no webfont fetch | `globals.css:268`, `site-theme.css:157` |
| `--font-sans` | `var(--font-geist-sans)` (Tailwind `@theme inline`) | `globals.css:262` |
| Headings (public pages) | `font-family: Georgia, ...; font-weight: 400` — `h1`/`h2` under `.pal-landing` | `site-theme.css:235` |
| Body prose (public + reader depictions) | `font-family: Georgia, serif` | e.g. `site-theme.css:237, 326, 469` |
| Wordmark (app shell) | `font-serif text-lg font-semibold tracking-tight` next to the `<Mark>` glyph | `apps/web/src/components/app/AppShell.tsx:108-109, 115-116` |
| Uppercase-tracked labels | `text-[11px] font-bold uppercase tracking-[.08em]` (nav items); public-site nav uses `font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase` | `AppShell.tsx:180`; `site-theme.css:188` |
| Underline-active nav | Active tab/nav item gets a colored 2px `border-b` in the accent-ink token; inactive items are `border-transparent` | `AppShell.tsx:180` (`border-[var(--color-accent-ink)]` when `active`); public-site's `.nav-cta` uses the same underline convention (`site-theme.css:190`) |

The app shell (signed-in) deliberately reuses the landing page's own typographic conventions — serif
wordmark, uppercase-tracked small-caps labels, underline-active nav — rather than inventing a second
vocabulary; see the 2026-07-24 UI-overhaul entry in `docs/PROJECT-LOG.md`'s Changelog ("landing
depictions adopted as visual paradigms for the signed-in app").

---

## 4. Spacing / layout conventions

- **Content width cap:** authenticated single-column pages consistently wrap in
  `mx-auto max-w-4xl px-6 py-8` (Library, Roadmap, Curriculum) or `py-10` (Admin) — `apps/web/src/app/(app)/library/LibraryView.tsx:332`, `.../roadmap/RoadmapView.tsx:189`, `.../curriculum/CurriculumView.tsx:110`, `.../admin/page.tsx:174`.
- **`.app-control`** (`globals.css:353-365`) — the shared interactive-surface vocabulary: a
  `border-color`/`background-color`/`color`/`box-shadow` transition on hover/focus-visible. Applied to
  every icon button, filter control, and toggle across the signed-in app (18 call sites, e.g.
  `apps/web/src/components/graph/GraphView.tsx:584, 592, 612, 627...`).
- **`.app-reveal`** (`globals.css:361-365`) — a single scroll-triggered entrance
  (`opacity: 0` → `translateY(10px)` → `app-scroll-reveal` keyframe), gated entirely behind
  `@media (prefers-reduced-motion: no-preference)` — it does not exist at all for reduced-motion
  readers, not merely a shortened duration. 10 call sites.
- **`.app-panel-enter`** (`:367-381`) — the complementary one-shot entrance for *conditionally mounted*
  UI (modals/drawers/popovers: `RagChatPanel`, `FootnoteModal`, `PermanentDeleteDialog`, the
  preferences menu, mobile drawer, graph's "Roadmap for" popover). Unlike `.app-reveal` it needs no
  `IntersectionObserver` — it runs unconditionally on mount, once, and is likewise absent under
  reduced motion.
- **Reduced motion, blanket safety net** (`:294-303`): a global
  `@media (prefers-reduced-motion: reduce)` rule collapses *every* animation/transition duration to
  `0.01ms` and forces `scroll-behavior: auto`, independent of the two rules above — belt-and-suspenders,
  not the only guard.
- **Touch targets:** `.app-icon-button` is `2.75rem` (44px) square (`:320-326`) — the project's own
  floor, stricter than WCAG 2.5.8 AA's 24px minimum (comment, `:313-319`).
- **Distraction-reduced reading mode** is a token overlay, not a second palette: it only sets
  `--color-border: transparent` (`:150-152`) — the reading surface itself never shifts.

---

## 5. Graph visual language

Three parallel "meaning → color token" mappings, one per surface, all resolving through the same
underlying `--color-*` tokens above — **never a hardcoded hex in the mapping tables themselves** (the
literal hex seen inside `KnowledgeGraph3D.tsx`/`InteractiveGraph.tsx` is `getComputedStyle` *output* or
WebGL-only white/fallback, see §6).

**Roadmap tiers** — `TIER_COLOR` (`apps/web/src/components/shared/roadmapPrimitives.tsx:19-27`), shared
between the real Roadmap view and the landing depiction (moved verbatim per that file's own header
comment, `:1-15`):

| Tier | Token |
|---|---|
| `essential` | `--color-accent-burgundy` |
| `high` / `interpretive_aid` | `--color-accent-ink` |
| `strongly_recommended` | `--color-accent-green` |
| `contextual` / `comparative` | `--color-accent-umber` |
| `optional` | `--color-text-muted` |

**Relationship categories** — `CATEGORY_META` (`apps/web/src/components/shared/annotationMeta.ts:50-111`),
the single source of truth for the reader's annotation markers, the annotations panel, and the graph
legend. Each of the 10 categories carries a **label + glyph + color token**, deliberately never color
alone (comment, `:10-14`) — e.g. `explicit_reference` → `→` / `--color-accent-ink`;
`disagreement_polemical_target` → `✕` / `--color-accent-burgundy`; `ai_inferred` → `∴` /
`--color-accent-umber`, rendered to readers as "Inferred connection" (no user-facing "AI" wording, see
§6). `categoryMetaFor()` (`:142-146`) is the safe lookup for edges that may not carry a category value
at all (structural/discovery/source-provenance edges) — returns `undefined` rather than guessing.

**Credibility banding** — `CredibilityMeter.tsx` (3 discrete bands, not a continuous gradient, "to
avoid implying a precision the underlying `credibility.score` doesn't have", `:1-7`):

| Band | Score | Token | Line |
|---|---|---|---|
| `good` | ≥0.7 | `--color-accent-green` | 13 |
| `warning` | ≥0.4 | `--color-credibility-warning` | 12 |
| `critical` | <0.4 | `--color-credibility-critical` | 11 |

**3D graph** (`apps/web/src/components/graph/types.ts`) — `STATE_META` (`:162-172`, node
read/reading/unread/missing/primary/structural status), `TYPE_META` (`:188-196`, node kind: work,
reference, peer-reviewed/online source, concept, person, section), and `EDGE_FAMILY_META`
(`:204-210`, 5-family collapse of the 14-value `edge_type` enum, with an explicit lookup table rather
than a keyword matcher — `:214-224` documents a prior bug where unmatched edge types silently
defaulted to "influence"). All three resolve their `colorVar` through `getComputedStyle` at render
time and **re-resolve on every `data-theme` mutation** via a `MutationObserver`
(`KnowledgeGraph3D.tsx:239-264`) — the palette is never baked in at build time.

---

## 6. Safety rules

These are the constraints that keep the system above from drifting. Each is enforced somewhere in the
codebase today, not aspirational.

1. **Token-only colors — no literal hex in components.** Every `--color-*` consumer in `.tsx`/`.ts`
   uses `var(--color-*)` or a Tailwind `text-[var(--color-*)]` arbitrary value. The only literal hex in
   component code are (a) `getComputedStyle` *output* stored in state (resolved colors, not authored
   ones — `KnowledgeGraph3D.tsx:243-258`), (b) hard WebGL fallbacks/label colors (`"#888"`, `"#ffffff"`
   for canvas label sprites — `:246, 250, 254, 382, 406, 426, 446, 699, 762`), and (c) the landing's own
   canvas-drawn 3D graph, `InteractiveGraph.tsx:119-120, 177, 185` — deliberately untouched, ported
   byte-for-byte (`site-theme.css:63-65`). One further pinned exception is documented, not
   accidental: the closing band's `.button-light` is "Pinned, not tokenized: parchment-on-burgundy
   clears 7.6:1 against both the light and dark band values" (`site-theme.css:591-593`).
2. **Contrast floors: 4.5:1 for text, 3:1 for non-text (WCAG 2.2 AA).** Every token comment above states
   its measured ratio where the value was chosen *because* of a contrast finding — `--color-beta-badge`,
   `--color-status-highlight-text`, and `--color-graph-dim-text` all exist specifically because an
   earlier token failed this floor as literal text (`globals.css:51-83`).
3. **Both-themes requirement.** No token may be defined only for light or only for dark — the
   `:root[data-theme="dark"]` and `:root[data-theme="light"]` blocks in `globals.css` are declared as a
   matched pair for every custom property, and `.pal-site`'s dark override (`site-theme.css:698-747`) is
   likewise total, not partial.
4. **No user-facing "AI" wording.** `ai_inferred` renders as "Inferred connection"
   (`annotationMeta.ts:105-110`); the standing rule is recorded as D-22-23 and enforced at the 2026-07-23
   landing rebuild ("No user-facing 'AI' wording (standing rule D-22-23)", `docs/CHANGELOG.md:11`).
5. **The public marketing pages are a protected visual contract.** `/`, `/privacy`, `/terms` are covered
   by `landing.spec.ts`'s screenshot/axe gate; the 2026-07-23 campaign-site rebuild explicitly scoped
   itself to "public pages only — no signed-in route, no `globals.css` token, and no
   worker/schema/pipeline code was touched" and treated the source campaign site as read-only
   (`docs/CHANGELOG.md:11`). Changing anything under `.pal-site`/`.pal-landing` requires regenerating the
   pinned-Docker-image baselines and re-running the axe gate in both themes — it is not a
   change-and-move-on surface like the rest of the app.
6. **Beta-badge token precedent for status-text tokens.** When a shared/banding token (tuned for large
   fills, 3:1 non-text) is reused as small text and fails 4.5:1, the fix is a **new, narrowly-scoped
   token** split from the original — never darkening the shared token itself, since that token has its
   own documented rationale and unrelated consumers. `--color-beta-badge` split from
   `--color-credibility-warning` this way (D-23-21: it measured 4.48:1 as 12px text, under the 4.5:1
   floor, discovered only by scanning *production* — CI never renders beta-gated UI at all since
   `BETA_TESTING_MODE` is off there, `globals.css:51-61`, `docs/CHANGELOG.md:13`).
   `--color-status-highlight-text` follows the identical precedent, split from `--color-highlight`
   (`globals.css:64-73`). Any future status/badge text color that fails AA as literal text should be
   fixed the same way: a new token, not a shared one darkened in place.

---

*Sources: `apps/web/src/app/globals.css`, `apps/web/src/app/site-theme.css`,
`apps/web/src/components/shared/{roadmapPrimitives,annotationMeta}.ts`,
`apps/web/src/components/CredibilityMeter.tsx`, `apps/web/src/components/graph/{types,KnowledgeGraph3D}.tsx`,
`apps/web/src/components/site/InteractiveGraph.tsx`, `apps/web/src/components/app/AppShell.tsx`,
`docs/audits/phase-19-frontend-tooling.md`, `docs/CHANGELOG.md`.*
