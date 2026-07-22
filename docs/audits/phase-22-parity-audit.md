# Phase 22 Parity Audit — Reader, Annotations, Roadmap, Global RAG Sidebar, Motion

**Status:** audit only, per the plan's §3.2 audit-before-edit rule. **Zero code changes made in this pass.**
**Produced by:** a pull-forward audit agent, running in parallel with Phase 20 wave 2 (concurrent, unrelated edits to
Library/graph/upload/canonical-identity code were in the working tree during this audit and were not touched, reviewed,
or relied upon as "current" — see Method below).
**Repo commit at audit time:** `8ae950acec0ba1093d68186d8e78dfcd387186e8` (`docs: migration 0030 applied in production
(pulled forward to match auto-deploy)`), audited 2026-07-22T20:27:58Z. Working tree had uncommitted changes to 17
tracked files plus several untracked files/directories (graph/upload/identity/`source-attach.spec.ts`/migration `0031`)
— all attributable to concurrent Phase 20 wave-2 agents per the task brief, not reviewed here.
**Plan sections audited:** `palimnote_phases_19_23_plan_revised.md` §22.0–§22.10 (full text read), §3.1–§3.7 (working
method / defect-register format), plus `docs/baselines/phase-19/landing-product-contract.md` and the 4 frozen PNGs in
`docs/baselines/phase-19/` and `apps/web/e2e/landing-contract.spec.ts-snapshots/`.

**Note on sub-phase numbering.** The task brief's "22.1–22.6" headings map onto the plan's actual §22.1–§22.7 as
follows (the plan's own §22.1 is the Uncodixify/Stitch workflow gate, not a parity topic):

| Brief heading | Plan section | Topic |
|---|---|---|
| 22.1 (landing showcase extraction) | §22.2 | Shared visual primitives without landing-page drift |
| 22.2 (Reader parity gaps) | §22.3 | Reader parity and usability |
| 22.3 (annotation parity) | §22.4 | Annotation parity and accuracy |
| 22.4 (Roadmap parity) | §22.5 | Roadmap parity and functionality |
| 22.5 (global RAG sidebar) | §22.6 | Expandable global RAG sidebar |
| 22.6 (motion tokens) | §22.7 | Site-wide motion, transitions, and 3D interaction |

This document is organized under the brief's numbering (so it lines up with the task that requested it) but cites the
plan's real section numbers throughout. The plan's own §22.1 (Uncodixify/Stitch workflow) and §22.8 (anti-"AI-generated"
visual-consistency pass) are out of scope for this parity dossier and are called out only where they bear directly on
a finding below.

## Method

- Read `docs/PROJECT-LOG.md` "Current Implementation Status" and "Known Problems" in full (already in context at
  session start) and the full plan text for §22.0–§22.10 and §3.1–§3.7.
- Read the frozen landing contract (`docs/baselines/phase-19/landing-product-contract.md`) and the real
  `apps/web/e2e/landing-contract.spec.ts` to determine the exact DOM the visual-regression baseline covers.
- Read the real source for every surface in scope: `apps/web/src/app/page.tsx` (landing showcases), the full Reader
  stack (`ReaderShell.tsx`, `EditionReader.tsx`, `TextReader.tsx`, `EditionAnnotationsPanel.tsx`, `AnnotationsPanel.tsx`,
  `annotationMeta.ts`, `NotesSidebar.tsx`), the Roadmap stack (`RoadmapView.tsx`, `apps/web/src/lib/roadmap.ts`,
  `packages/roadmap/src/index.ts`, `packages/roadmap/src/rank.test.ts`), the RAG stack (`RagChatPanel.tsx`,
  `apps/web/src/app/(app)/ask-library/page.tsx`), the shell (`AppShell.tsx`), and `apps/web/src/app/globals.css` for
  every design token/motion class referenced.
- Ran `pnpm --filter @ice/roadmap test -- --run` (read-only; no source touched) to directly re-verify the Heidegger and
  Vico acceptance cases still pass, rather than trusting the log's prior claim.
- Queried the local Postgres container read-only (`docker exec ... psql`) to check for a live edition-pipeline (v2+)
  document to visually exercise. **None exists locally at audit time** — the only document present
  (`4cef8d60-f919-4d95-b6ce-83a00cd60c04`, owned by an `e2e-link-check-*` test account, itself a stale concurrent-agent
  fixture) has zero `processing_run` rows and zero `passage_annotation` rows, i.e. it predates/bypassed the edition
  pipeline entirely. This reproduces the exact gap `docs/PROJECT-LOG.md`'s Known Problems section already documents as
  D-19-6 (local dev has no cheap way to get a real v2+ published edition without a multi-minute live-API upload run).
  Given the brief's instruction not to start second instances of the stack and to avoid a multi-minute live run purely
  for an audit, **the annotation/Reader findings below are evidenced at the source level (file:line, cross-checked
  against the DB schema and API contracts) rather than via a live screenshot**, and this is flagged explicitly wherever
  it applies rather than silently asserted as "verified live."
- Did not touch, run, or evaluate the Visualization/graph surfaces beyond what §22.1's shared-primitive discussion
  requires, per the task's own steer that graph code is concurrently being edited and is unreliable to check right now.

---

## 22.1 (plan §22.2) — Shared visual primitives without landing-page drift

### Which landing components depict Reader/Annotations/Roadmap

`apps/web/src/app/page.tsx`:

- **`ReaderShowcase()`** (lines 93–135), rendered via the shared **`Showcase()`** scaffold (lines 62–91). This is the
  *only* Reader/Annotations depiction on the landing page — confirmed by `docs/baselines/phase-19/landing-product-contract.md`'s
  own "one important structural fact": there is no separate landing "Reader" section, `landing-reader-*.png` and
  `landing-annotations-*.png` are byte-identical captures of this one section.
- **`RoadmapShowcase()`** (lines 137–170), also via `Showcase()`, with `flip=true`.
- Both are screenshotted in full by `apps/web/e2e/landing-contract.spec.ts` via
  `page.locator("section", { has: page.getByRole("heading", { name: "..." }) })` (lines 18, 26, 34, 42) — **the
  screenshot boundary is the entire `<section>` returned by `Showcase()`**, i.e. eyebrow + heading + lead paragraph
  column *and* the figure/illustration column together, not just the illustration. Any extraction that changes
  `Showcase()` itself, or either showcase's own JSX, is in the frozen contract's blast radius, not just the marker/card
  visuals.

### Tokens in play (all pre-existing, no new tokens introduced by either showcase)

- Color: `--color-text`, `--color-text-muted`, `--color-border`, `--color-surface`, `--color-background`,
  `--color-accent-{umber,green,burgundy,ink}` (all `globals.css` lines 13–70).
- Typography: `font-serif` (heading, `--font-serif` at `globals.css:201`) for the eyebrow/heading text column and for
  the Reader showcase's illustrative body prose (`page.tsx:101`, `className="font-serif text-[1.05rem] leading-[1.7]"`);
  `font-mono` for eyebrows/numerals.
  the same `1.05rem`/`1.7` pairing.
- Spacing/layout: `max-w-5xl`, `py-16`, `gap-8`/`md:gap-12`, `md:grid-cols-2`, `border-t` (all inside `Showcase()`,
  `page.tsx:76-89`).
- Annotation marker: `page.tsx:104-110` sets `--reader-annotation-color` inline and reuses the real
  `.reader-annotation-marker` CSS class (`globals.css:129-149`) — this one piece genuinely *is* shared already between
  the landing illustration and the real Reader/`EditionReader.tsx` markers (`EditionReader.tsx` applies the same class
  via `highlightDom.ts`'s `applyAnnotationMarkers`). This is the one primitive that already satisfies §22.2's rule
  today; everything else below is duplicated, hand-rolled markup in two places.

### What is duplicated rather than shared (extraction candidates)

Confirmed by direct code comparison — same visual grammar, independently implemented:

1. **Annotation category badge** (relation glyph in colored circle + label + confidence). Landing:
   `page.tsx:113-131` (a raw `<div>`/`<span>` tree with inline `style={{background: ...}}`). Real Reader:
   `EditionAnnotationsPanel.tsx`'s `PassageAnnotationCard` (lines 428-441) and the legacy `AnnotationsPanel.tsx`'s
   `AnnotationCard` (lines 244-261) — both re-implement the identical badge shape independently of each other *and*
   of the landing markup, all three pulling colors from the same `CATEGORY_META` (`annotationMeta.ts`) but rendering
   the DOM three separate times. A shared `RelationBadge` component (glyph circle + label + confidence, taking a
   `CategoryMeta` and confidence number) is a safe extraction target.
2. **Roadmap stage row** (numeral + colored dot + tier label + title + reason). Landing: `page.tsx:150-167`
   (hardcoded 3-item array with per-item `color` strings duplicating three of `RoadmapView.tsx`'s seven `TIER_COLOR`
   entries — `essential`→burgundy, `high`→ink, `comparative`→umber, all matching). Real Roadmap:
   `RoadmapView.tsx`'s `RoadmapCard` (lines 237-315) reuses the identical numeral/dot/tier-label/title/reason grammar
   but with many more real controls layered under it (understanding slider, status select, hide button, badges).
   Because the *first four visual elements* already agree pixel-for-pixel in intent (not yet in code — two
   independent token lookups), a shared `RoadmapStageRow` (or a lower-level `RoadmapItemHeader`) that both the
   showcase and the real card render as their opening row is a safe, well-evidenced extraction target — the real
   card would wrap it and add its extra controls below, unchanged.
3. **Confidence/provenance line.** Both `PassageAnnotationCard` (`EditionAnnotationsPanel.tsx:466-468`) and
   `AnnotationCard` (`AnnotationsPanel.tsx:315-319`) render a "Source: … · confidence NN% · provenance: …" sentence
   with near-identical wording but separately formatted strings — a shared `EvidenceLine({source, confidence,
   provenance})` primitive would collapse two near-duplicate implementations (plan's own listed primitive:
   "confidence/provenance treatment").

### Extraction plan that provably cannot shift the frozen screenshots

Because the visual-regression baseline covers the **entire enclosing `<section>`** of each showcase (not just the
figure), the only provably-safe sequencing is:

1. **Phase A — extract from the authenticated side only.** Build `RelationBadge`, `RoadmapStageRow`/`RoadmapItemHeader`,
   and `EvidenceLine` as new components consumed by `EditionAnnotationsPanel.tsx`, `AnnotationsPanel.tsx`, and
   `RoadmapView.tsx`. **Do not touch `page.tsx` in this step at all.** `landing-contract.spec.ts` cannot regress
   because its DOM tree is untouched by construction, not by luck — no rerun of the visual-regression suite is even
   strictly required for this step (though running it costs nothing and confirms zero diff).
2. **Phase B — retrofit the landing showcases onto the same primitives, only if desired for maintenance symmetry.**
   If `ReaderShowcase()`/`RoadmapShowcase()` are later changed to import the same components (rather than keep their
   own hand-rolled JSX), the new components' default props/markup must be constructed to render **byte-identical**
   output to today's hardcoded JSX for exactly the three illustrative rows/one marker in play, and
   `landing-contract.spec.ts`'s 4 screenshots must be re-run and diff to zero (not "visually close," zero) before that
   change is considered safe. Given the risk/benefit (the landing page is static, illustrative, never-changing
   content — there is no real duplication *cost* being paid, only a duplication *count*), **Phase B is optional and
   lower priority than Phase A**; recommend deferring it unless a later `Showcase()`/typography change makes the
   drift risk worth taking on deliberately.
3. Do **not** extract a primitive that would require the landing showcases to render *real* data-shaped content
   (e.g. a live confidence float, a live relationship enum value) — the showcases are deliberately static illustrative
   copy per the frozen contract's own "Interaction/motion states" section, and forcing them through the same
   data-shaped component as the real Reader risks exactly the kind of demo-content-forcing the plan's §22.2 rules
   warn against ("Do not force demo-only content structures onto real data").

---

## 22.2 (plan §22.3) — Reader parity gap list

All findings below are source-verified (file:line); none required a live edition run to detect, since they are either
missing CSS wiring, missing responsive rules, or structural facts about the components' props/markup. See the Method
section above for why no live screenshot comparison was performed.

### Typography — confirmed divergence from the landing depiction

The landing depiction's Reader/Annotations illustration explicitly renders the reading passage in **serif** body text
at `1.05rem`/`1.7` line-height (`page.tsx:101`, `className="font-serif text-[1.05rem] leading-[1.7] ..."`, and
documented verbatim in `landing-product-contract.md` line 15). Neither real reader component applies `font-serif` to
body paragraphs:

- `EditionReader.tsx:639` — the default paragraph branch renders `<p {...common} className="whitespace-pre-wrap">{text}</p>`
  with **no font-family class and no explicit font-size** at all; it inherits `body`'s `font-family: var(--font-sans),
  Georgia, serif` (`globals.css:218`) and `font-size: calc(1rem * var(--app-font-scale, 1))` (`globals.css:219`). Only
  the `title`/`header` block kinds get `font-serif` (`EditionReader.tsx:639`, the `h1`/`h2` branches) — body prose,
  the actual reading text the landing depiction is illustrating, does not.
- `TextReader.tsx:191` — same gap: `className="leading-[1.7] text-[var(--color-text)] whitespace-pre-wrap"`, no
  `font-serif`.

This is a real, unambiguous typography parity gap affecting **both** real reader implementations (the edition
pipeline's `EditionReader` and the legacy `TextReader`), not a cosmetic nit — the landing page is explicitly selling
serif reading prose as part of the product's visual identity (per `docs/PROJECT-LOG.md`'s own Design Decisions:
"Warm, contemporary-scholarly serif for display headings," and the landing contract calls the serif body text out by
name), and the actual reading experience does not deliver it.

### Reading-width preference — two parallel, disagreeing implementations

- `EditionReader.tsx:521` consumes the **global** `--reading-measure` custom property (`58/72/88ch`, set via
  `:root[data-reading-width="..."]` in `globals.css:76-78`, driven by `WorkspacePreferencesProvider`'s
  `root.dataset.readingWidth`) — this is the mechanism D-19-21 fixed in Phase 19 and it is correctly wired here.
- `TextReader.tsx:175` and `ReaderShell.tsx:411-412` instead use a **second, parallel** mechanism: `ReaderShell`
  computes its own `readerLineWidth` (`ReaderShell.tsx:325`, `56/66/82ch` — different numbers from the global
  `58/72/88ch` tokens) and sets it as a *locally scoped* `--reader-line-width` custom property on a wrapper `<div>`
  (`ReaderShell.tsx:408-414`), which only `TextReader`/`PdfReader` consume.
- **Net effect:** a document using the legacy (v1-pipeline) `TextReader` gets a *different* set of reading-width values
  than a document using the edition pipeline's `EditionReader`, from what is presented to the user as the exact same
  "Reading width: Compact/Comfortable/Wide" preference control in `AppShell.tsx`'s Workspace preferences menu
  (`AppShell.tsx:177`). This is a real behavioral inconsistency, not merely a naming one — a reader switching between
  a legacy and an edition-pipeline document would see the "same" preference produce visibly different column widths.
  D-19-21 fixed the specific *test* that was CI-flaky/wrong; it did not (and wasn't scoped to) unify the two
  mechanisms it left in place side by side.

### Mobile / narrow-screen layout — no responsive handling on either sidebar

- `EditionAnnotationsPanel.tsx:100` — `<aside ... className="w-80 shrink-0 ...">`, a fixed 320px width with **no
  responsive modifier at any breakpoint**.
- `NotesSidebar.tsx:32` — `<aside className="w-72 shrink-0 ...">`, fixed 288px, likewise no responsive modifier.
- `ReaderShell.tsx:329` wraps the reading column and these sidebar(s) in a plain `flex` row with no `flex-wrap` and
  no stacking behavior below a breakpoint.
- On a narrow viewport (the landing contract's own mobile baseline is 375×812, `landing-product-contract.md:40`), a
  work with both analysis and notes panels open would need to fit a reading column *plus* 320px *plus* 288px of
  sidebar in 375px of viewport — the reading column would be squeezed to near-zero or the layout would need to
  overflow horizontally, neither of which is an "accessible inline expansion" per plan §22.3's explicit requirement.
  This was not verified with a live screenshot (see Method), but is a direct, mechanical consequence of the CSS as
  written — there is no code path that changes these `w-80`/`w-72` classes or the parent's `flex` direction at any
  breakpoint.

### What already looks correct

- The margin-note responsive fallback is real and well-built: `MarginNote` in `EditionReader.tsx` is `hidden xl:block`
  (line 296), with an explicit inline `<details>`-based fallback (`inlineNotes`, `EditionReader.tsx:626-632`,
  `xl:hidden`) for narrower viewports — this is the one place the Reader genuinely does what plan §22.3 asks
  ("narrow screens use accessible inline expansion"). The sidebars above are the gap, not this mechanism.
- Position persistence, reading-position resume, split view, and the footnote modal's keyboard-dialog behavior
  (`ReaderShell.tsx:524-560`, `FootnoteModal`) all read as complete and already meet the D-19-18/19/20 keyboard
  standard — no gap found here.
- Reduced motion: the marker hover transform (`globals.css:145`, `.reader-annotation-marker { transition: transform
  0.08s ease }`) is covered by the blanket `@media (prefers-reduced-motion: reduce)` override at `globals.css:204-213`,
  so no dedicated reduced-motion escape hatch is missing here — but see §22.6 below for the broader point that almost
  nothing in the Reader has *any* deliberate motion to begin with, reduced or not.

### 200% zoom

Not verified live (no browser session was driven for this audit — see Method). No CSS was found that would obviously
break at 200% zoom (no `overflow: hidden` wrapping the reading column, no fixed pixel widths on the prose itself), but
this is an explicit open question below, not a confirmed pass.

---

## 22.3 (plan §22.4) — Annotation parity + defect reproduction

### Confirmed structural gap: passage annotations (the default, v2+ kind) have no verification workflow at all

This is the single most significant finding in this audit.

- **Schema** — `packages/db/src/schema.ts:1719-1754`, the `passage_annotation` table (added Phase 9.3, migration
  `0017`). Its columns are: `id`, `runId`, `textBlockId`, `isWholeWork`, `quote`, `summary`, `explanation`,
  `helpfulFor`, `scope`, `annotationType`, `relationship`, `readerLevel`, `confidence`, `relatedResourceId`,
  `createdBy`, `createdAt`. **There is no `verification_status` column and no `hidden` column** — contrast with the
  older `annotation` table (Phase 4), which has both (referenced throughout `AnnotationsPanel.tsx`/`types.ts`).
- **UI** — `EditionAnnotationsPanel.tsx`'s `PassageAnnotationCard` (lines 399-473) is **read-only**: it shows the
  category glyph/label, annotation type, reader level, confidence%, summary, an expand/collapse "Read more" toggle,
  the quote, related source, and a source/confidence/provenance line — and nothing else. There is no verify/dispute/
  reject/hide/edit affordance anywhere in this component. Compare directly to the legacy `AnnotationsPanel.tsx`'s
  `AnnotationCard` (lines 214-334), which has a full `StatusButton` row (Verify/Dispute/Reject, lines 322-324), a
  Hide/Unhide toggle (line 328), and an inline edit-the-explanation textarea (lines 280-303) — none of which exist for
  passage annotations.
- **Consequence:** since the edition pipeline (v2+) is production's default and `EditionAnnotationsPanel` is the
  sidebar shown whenever a published edition exists (`ReaderShell.tsx:469-486`, the `visibleEdition ?
  <EditionAnnotationsPanel> : <AnnotationsPanel>` branch), **the entire "verify/edit/dismiss anything" promise the
  landing page makes** ("Approve, edit, or dismiss anything," `page.tsx:98`, `landing-product-contract.md:13`) **is
  false for every document processed by the pipeline the product actually ships today.** A user cannot mark a passage
  annotation reviewed, dispute it, reject it, hide it, or edit its explanation — only the legacy, largely-superseded
  `annotation`-table records (now reachable only for documents that somehow never got a published edition) retain that
  workflow. This is a plan §22.4-listed requirement ("verification state") that is not just visually inconsistent but
  **functionally entirely missing** for the default pipeline, and it requires a schema migration (new columns +
  either new API routes or extending the existing pattern) to fix, not a CSS/markup change — i.e. it is squarely a
  §3.2 "smallest root cause" case, not a symptom to patch in the component.
- Not verified live (no local edition-pipeline document exists — see Method), but the schema absence and the
  component's complete lack of any mutating control are conclusive on their own; no live document could produce a
  verify button this component never renders.

### Other §22.4-listed items, checked against source

- **Relation type / summary / explanation / evidence(quote) / confidence / provenance / related work / reader level**:
  all present on `PassageAnnotationCard` (`EditionAnnotationsPanel.tsx:428-468`) — no gaps found for these fields
  specifically, aside from the verification-state gap above.
- **"Full destination"** (i.e., a link to the resolved bibliographic/Library record): present via `relatedResource.url`
  (`EditionAnnotationsPanel.tsx:454-465`) when a related resource exists and has a URL; when it doesn't, only the
  title is shown with no link — this matches the honest-when-unavailable posture the project favors elsewhere, not a
  defect.
- **Duplicate annotation**: not independently reproduced (would need a live multi-run document); the
  `matchNoteToBlock` heuristic for *generated notes* (a separate, non-`passage_annotation` mechanism) already
  degrades to "sidebar-only, no in-text marker" on ambiguous/multiple matches (`EditionReader.tsx:372-382`,
  documented intent), so generated notes have a built-in duplicate-marker guard; whether `passage_annotation` rows
  themselves can be produced as literal duplicates by the classification pipeline (two rows, same block, same
  relationship) was not checked here — flagged as an open question below, since that would be a worker/pipeline
  question, not a Reader-UI one, and pipeline code was out of this audit's scope.
- **Mismatched related work labels between annotation sidebar and Visualization** ("The works shown in
  annotation-related sidebars and Visualization must share the same label metadata"): not checked — Visualization is
  explicitly out of scope for this pass per the task brief (concurrent wave-2 editing), and doing so would require
  cross-referencing `graph_edge`/canonical-identity code that is mid-edit right now. Open question below.
- **Hover-only access**: not applicable — passage annotations are click-to-reveal in-text markers with a *separate*
  hover preview (`AnnotationHoverPreview.tsx`, wired via `EditionReader.tsx:647-655`), i.e. hover is a bonus preview,
  not the only way in; this already matches the plan's intent, no defect found.
- **Overlapping panels**: not observed in source — `EditionAnnotationsPanel` and `NotesSidebar` render side-by-side
  (`ReaderShell.tsx:469-510`), not stacked/overlapping, at desktop widths. See the mobile-layout finding above for the
  narrow-viewport version of this same concern.
- **Mobile interaction**: see the Reader-parity mobile-layout finding above (§22.2) — the same fixed-width-sidebar
  problem is exactly the "mobile interaction" defect plan §22.4 asks to repair for annotations specifically, since
  `EditionAnnotationsPanel` *is* the annotation UI.

---

## 22.4 (plan §22.5) — Roadmap parity and functionality

### Verified: the philosophical acceptance tests still pass

Ran `pnpm --filter @ice/roadmap test -- --run` directly (read-only, no source touched): **26/26 tests pass**, in
`packages/roadmap/src/rank.test.ts`. Confirmed present and passing:
- `describe("rankRoadmap — Heidegger acceptance case (plan §13 step 9)")` (line 46) — Kant/Husserl (conceptual
  influence) rank above Camus (parallel comparison); ties broken by graph centrality.
- `describe("rankRoadmap — Vico/Verene acceptance case")` (line 100) — interpretive aid ranks above generic context.
- `describe("rankRoadmap — modes, filters, overrides")` (line 114), `countByReaderLevel` (line 187), and
  `suggestReaderLevelFromCompletions` (line 204) also pass.

This directly re-verifies (rather than trusts) `docs/PROJECT-LOG.md`'s claim that these acceptance cases exist and
pass; no drift found.

### Confirmed gap: the Roadmap traversal has no awareness of canonical work identity — duplicate collapse is not implemented here

- `apps/web/src/lib/roadmap.ts`'s `computeRoadmap()` builds its candidate list directly from `bibliographic_record`
  rows reached by the `graph_edge` recursive CTE (lines 66-186), deduplicating only by literal `bib_id`
  (`const bibIds = [...new Set(reach.map((r) => r.bib_id))]`, line 109). **Neither `apps/web/src/lib/roadmap.ts` nor
  `packages/roadmap/src/index.ts` reference `work_identity`, `workIdentityId`, `learning_resource`, or
  `canonicalTitle` anywhere** (confirmed via `grep`, zero matches in both files).
- Compare this to the Reader/Sources side, which **does** do work-level grouping: `EditionPayload.works` in
  `EditionReader.tsx` (the `EditionWork` type, lines 27-33) groups the same underlying resource records into one
  entry per work with `related` editions/reviews attached, exactly the mechanism `docs/PROJECT-LOG.md`'s Design
  Decisions table describes as fixing "one cited book accepted 5 times" (Phase 9.5/canonical identity).
- **Net effect:** if a cited book resolves to multiple `bibliographic_record` rows (the book itself, a review of it,
  a second edition) that each got their own `graph_edge` from the root work, `computeRoadmap` would surface each as a
  **separate roadmap item** — the exact "duplicate collapse" defect plan §22.5 explicitly lists as a requirement
  ("duplicate collapse" appears verbatim in the plan's Roadmap requirement list, `palimnote_phases_19_23_plan_revised.md:1548`).
  This was not reproduced against a live multi-edition case locally (no such document/edges exist in the local DB at
  audit time), but is conclusively demonstrated by the code's complete absence of any canonical-identity join, which
  the Reader's parallel code path *does* have.
- **Relevant context for sequencing:** the working tree at audit time has concurrent, in-progress Phase 20 wave-2 work
  touching exactly this area — untracked `packages/research/src/canonicalIdentity.ts` /
  `canonicalIdentity.test.ts` and `apps/worker/src/identity/` (per `git status`, not reviewed here since it belongs to
  another agent). **Phase 22's roadmap fix should check what canonical-identity data model that concurrent work lands
  with before designing the roadmap-side join** — there is a real chance the underlying `work_identity`-equivalent
  primitive Phase 22 would need already exists or is about to, from Phase 20's own §20.6 ("Duplicate collapse and
  canonical identity," plan line 935). This is recorded as an explicit sequencing dependency, not a "go implement now"
  instruction.

### Other §22.5-listed requirements, checked against the real `RoadmapCard`/API

| Requirement (plan §22.5) | Status | Evidence |
|---|---|---|
| Staged hierarchy / priority | present | `TIER_ORDER`/`TIER_LABEL` grouping, `RoadmapView.tsx:220-232` |
| Dependency order | present | `rankRoadmap`'s depth/centrality ordering, verified by passing tests above |
| Reason for recommendation | present | `item.reason`, `RoadmapView.tsx:261` |
| Relation type | **partially** — the tier/color communicates a *derived* priority family, but the underlying `relationship_category` value itself (e.g. "prerequisite" vs "conceptual_influence") is never shown on the card, only folded into `item.reason`'s prose and the tier color | `RoadmapCard`, `RoadmapView.tsx:237-315`; no `CATEGORY_META`/glyph usage anywhere in this file |
| Estimated effort | present | `~{hours}h`/`{minutes}m`, `RoadmapView.tsx:263` |
| Current reading/known state | present | Understanding slider + Status select + "review only"/"in your library"/"not acquired" badges, `RoadmapView.tsx:266-306` |
| Mark known | present | Understanding slider (`onMutate(... understandingScore ...)`, line 286) |
| **Hide** | present (button) | `RoadmapView.tsx:307-309` |
| **Restore** (un-hide) | **missing** | The server fully supports `{hidden: false}` (`apps/web/src/app/api/works/[workId]/roadmap/item/route.ts:99-135`), but `RoadmapView.tsx` has no "show hidden items" toggle or hidden-items list anywhere — once hidden, an item has no UI path back. Confirmed by full read of the file; no such control exists. |
| **Manual add** | **missing** | No "add a work/reference manually" affordance in `RoadmapView.tsx`; the override schema supports `addedManually` (`roadmapOverrides` table, referenced in `rank.test.ts` but not surfaced) with no route/UI to set it from the client at all (the `item/route.ts` schema doesn't even accept an `addedManually` field, only `hidden`/`manualTier`/`manualPosition`/ratings — so this is missing at the API layer too, not just the UI). |
| **Manual reorder** | **missing** | Server supports `manualPosition`/`manualTier` (`item/route.ts:26-33`, both accepted and persisted), but no drag-reorder or position-input control exists in `RoadmapView.tsx` to set them. |
| Concise/comprehensive mode | present | Depth select, `RoadmapView.tsx:147-150` |
| Expertise/time/depth filters | present | Reader-level select + time-budget input, `RoadmapView.tsx:165-197` |
| Recalculation without losing overrides | present by construction | `computeRoadmap` is recomputed fresh every request directly from `roadmapOverrides` (Design Decisions: "Roadmap computed on demand… recalculation respects overrides is automatic") |
| **Duplicate collapse** | **missing** | See above — no canonical-identity join in the roadmap traversal |
| **Navigation to Library/Reader** | **missing** | `RoadmapCard`'s title (`RoadmapView.tsx:257-259`) is plain text, not a `<Link>`; there is no way to jump from a roadmap item to its Library entry or (for items already in the user's library) directly into that work's Reader. Confirmed by full read — no `<Link>`/`<a>` anywhere inside `RoadmapCard`. |

---

## 22.5 (plan §22.6) — Global RAG sidebar inventory

### What already exists and is directly reusable, unchanged

- **`RagChatPanel.tsx`** is already a single, presentation-agnostic component supporting both `"drawer"` and `"page"`
  modes (`presentation` prop, lines 18-26, 128-138) — this is most of the hard part of §22.6 already built:
  - Conversation persistence per scope key in `localStorage` (`conversationStorageKey`, lines 8-10, keyed by
    `contextWorkId ?? "library"`) — "preserve current conversation when navigating" and the entire-Library-vs-
    current-work scope distinction are already implemented at the data layer.
  - "Start a new conversation" (`createConversation`, lines 67-79, wired to the "＋" button, line 141).
  - Real SSE streaming with incremental `delta`/`citation`/`done` events (lines 96-120), already announced via
    `aria-live="polite"` on the scroll container (line 143).
  - Citations link to real hrefs with `sourceType`-conditional `target`/`rel` (`MessageCard`, line 159) — "link
    citations to Reader anchors or Library entries" is already satisfied by the existing `Citation.href`/`label`
    contract.
  - An explicit insufficient-evidence posture in the empty-state copy (line 144: "If your eligible Library does not
    support an answer, chat will say so rather than guess") backed by the Phase 18 API's documented evidence-required
    behavior (per `docs/PROJECT-LOG.md`'s Phase 18 entry).
- **`/ask-library` page** (`apps/web/src/app/(app)/ask-library/page.tsx`) already exists as the dedicated,
  discoverable destination the plan says must not be replaced (§22.6: "Do not replace the existing `/ask-library`
  page"), rendering the same `RagChatPanel` in `"page"` presentation (line 24).
- **Contextual Reader chat** already exists and must likewise be preserved: `ReaderShell.tsx:514` renders
  `RagChatPanel` in its default `"drawer"` presentation, gated by `enablePhase18Rag && !embedded`, toggled by an
  "Ask Library" button in the reader toolbar (`ReaderShell.tsx:405`). This is the "contextual Reader chat" the plan
  explicitly protects.

### What is genuinely missing for §22.6's "expandable global sidebar" requirement

- **No global trigger exists in `AppShell.tsx` at all.** The only way to reach RAG today is (a) the `/ask-library`
  nav link (`AppShell.tsx:53`, only added to `navItems` when `ragEnabled`) which is a full page navigation, not an
  expandable sidebar, or (b) the Reader-only "Ask Library" toolbar button. **Dashboard, Library, work detail, Roadmap,
  Visualization, Writer, and Trash have no RAG entry point of any kind** — confirmed by grep: `RagChatPanel` is
  imported only in `ReaderShell.tsx` and `ask-library/page.tsx`, nowhere else in `apps/web/src`. This is the exact gap
  `docs/PROJECT-LOG.md`'s Phase 19.I/19.J entry already names as an open, deferred item ("contextual Ask Library is
  deferred to Phase 22.5's global-sidebar rebuild") — this audit confirms that description is still accurate; nothing
  has landed since.
- **No persistent edge trigger / no resizable sidebar.** The Reader's drawer presentation
  (`RagChatPanel.tsx:132-134`) is `fixed inset-y-0 end-0 ... w-[min(26rem,100vw)]` — a fixed width with **no resize
  handle** and **no size-preference persistence** (contrast with `WorkspacePreferencesProvider`, which already
  persists reading-width/font-size/focus-mode/theme — RAG sidebar width/open-state is not part of that preference
  object at all, confirmed by reading `apps/web/src/lib/workspacePreferences.ts`'s shape via
  `WorkspacePreferencesProvider.tsx`).
- **No scope indicator beyond "current work."** `RagChatPanel` accepts only a single `contextWorkId` — there is no
  prop or UI for "current Reader passage," "selected graph node," or "selected roadmap item" scoping that §22.6 lists
  as required scope options. Adding these is a real feature addition (new API-scoping semantics on the Phase 18 RAG
  backend), not a UI-only change — flagged as an open question on backend readiness below.
- **No Escape-to-close / focus-restoration on the Reader's drawer instance.** Unlike every other reader-shell
  disclosure this session's own history documents bringing up to a keyboard-dialog standard (D-19-18/19/20, the
  `FootnoteModal` in `ReaderShell.tsx:528-560` explicitly cites this precedent), `RagChatPanel` has **no `onKeyDown`
  handler for Escape anywhere in the component** (confirmed by full read) and `ReaderShell.tsx:514`'s
  `onClose={() => setShowRagChat(false)}` wiring has no accompanying trigger-focus-restoration ref (contrast with
  `footnoteTriggerRef`/`closeFootnote` at `ReaderShell.tsx:76, 274-277`, or `AppShell.tsx`'s
  `closeDrawer`/`closePreferences` pattern). This is a real, concrete accessibility parity gap against the codebase's
  own established pattern, and it will need fixing regardless of whether the global sidebar reuses this exact
  component or a wrapper around it.

### Reuse recommendation

`RagChatPanel` itself should not need a rewrite — it should gain: (1) a `scope` prop generalizing beyond
`contextWorkId` (passage/node/roadmap-item, each producing its own `conversationStorageKey`), (2) Escape-to-close +
focus-restoration wired the same way as every other dialog in this codebase, (3) a resize affordance + persisted
width/open-state (naturally extending `WorkspacePreferences`, following the same pattern reading-width/font-size
already use). The genuinely new work is entirely in `AppShell.tsx`: a persistent edge trigger button (parallel to the
existing `⌕`/`⚙` icon buttons already in the header, `AppShell.tsx:90-104`) and a shell-level `RagChatPanel` mount
that is route-aware (so its `contextWorkId`/future `scope` prop reflects "what page am I on" without every page having
to wire it manually) — this is the "new shell integration" the task brief anticipated, and it is the majority of the
real implementation cost in this sub-phase, not the chat component itself.

---

## 22.6 (plan §22.7) — Motion tokens: current state and gaps

### What exists

`globals.css` defines exactly two shared motion primitives, both introduced for Phase 14 per their own comment
(`globals.css:256-257`, "Shared interaction vocabulary for the signed-in workspace"):

- **`.app-control`** (`globals.css:259-263`): a 0.16s border/background/color/box-shadow transition, hover border
  color, and a focus-visible ring.
- **`.app-reveal`** (`globals.css:264-267`): a one-shot scroll-entrance animation (translateY + opacity), gated behind
  `@media (prefers-reduced-motion: no-preference)` so it is fully absent under reduced motion by construction — this
  is a correctly-built reduced-motion fallback where it is used.
- A blanket global override (`globals.css:204-213`) collapses **all** CSS animations/transitions to ~0 under
  `prefers-reduced-motion: reduce`, so nothing in the app can violate reduced-motion at the token level even where a
  component-specific escape hatch wasn't separately written.
- `KnowledgeGraph3D.tsx` has its own dedicated reduced-motion handling (confirmed via grep — the only component
  outside `globals.css` itself that references `prefers-reduced-motion`/`reducedMotion` directly).

### Where these tokens are — and are not — applied

Confirmed via `grep -rl` across all of `apps/web/src` (not a sample): **`.app-control` and `.app-reveal` are used in
exactly two files**:

- `apps/web/src/app/(app)/library/LibraryView.tsx` — both classes.
- `apps/web/src/app/(app)/upload/page.tsx` — `.app-reveal` only.

**Every other authenticated surface has zero use of either class**, including all of the following, checked directly:
Reader (`ReaderShell.tsx`, `EditionReader.tsx`, `TextReader.tsx`, `PdfReader.tsx`), both annotation sidebars
(`EditionAnnotationsPanel.tsx`, `AnnotationsPanel.tsx`), `NotesSidebar.tsx`, Roadmap (`RoadmapView.tsx`), the RAG panel
(`RagChatPanel.tsx`), `AppShell.tsx`'s own header/nav/drawer/preferences-menu chrome, Writer, Trash, Dashboard, and the
Visualization control chrome outside the 3D canvas itself. Concretely, against plan §22.7's own "apply to every major
surface" checklist:

| Plan §22.7 item | Current state |
|---|---|
| Page-section scroll reveals | Only Library + Upload |
| Cards/panels entering viewport | Only Library's cards |
| Hover/focus elevation | Only Library's `.app-control` usage + the generic `app-icon-button`/`:focus-visible` treatment global to all pages (`globals.css:223-254, 270+`) — Reader/Roadmap/RAG cards have no dedicated hover/focus elevation beyond default browser/Tailwind focus rings |
| Button press feedback | Not found anywhere as a distinct token/class |
| Tab underline / panel transition | `EditionAnnotationsPanel`'s tab buttons (`annotations`/`notes`/`apparatus`/`terms`/`sources`) switch instantly via inline `style={{background: ...}}` with no transition at all |
| Filter result transition | Roadmap/Annotations filter changes re-render instantly, no transition |
| Modal/drawer motion | `FootnoteModal`, `RagChatPanel`'s drawer, `AppShell`'s `MobileDrawer`/`PreferencesMenu` all mount/unmount with a hard show/hide (conditional render), no enter/exit transition of any kind |
| Loading skeleton / stage progression | Reader shows a bare `<p>Loading…</p>` (`ReaderShell.tsx:318`); Roadmap shows `<p>Computing roadmap…</p>` (`RoadmapView.tsx:204`) — text-only, no skeleton/progress motion |
| Graph focus / camera movement | Out of scope for this pass (Visualization) |
| Roadmap expansion | The `PassageAnnotationCard`/`CriticalNoteCard` "Read more"/"Evidence and claims" `<details>`-style expand (`open`/`aria-expanded`) is an instant show/hide — no height/opacity transition |
| Annotation reveal | Same as above — instant, no transition |
| Trash/restore confirmation | Not checked directly in this pass (Trash out of primary scope) but not among the two files using these classes |
| Library search result updates | **Present** — this is inside `LibraryView.tsx`, the one surface that already has the token applied |

**Summary:** the shared motion vocabulary exists, is well-designed (restrained, reduced-motion-safe by construction),
and is applied to roughly 2 of the ~12+ major authenticated surfaces plan §22.7 lists. This is not a token-design gap
— the tokens already do the right thing where used — it is purely an application-coverage gap, which is exactly what
plan §22.7 itself frames the work as ("Apply to every major surface").

---

## Proposed defect register rows (§3.3 format)

These are proposed for `docs/audits/phase-19-product-audit.md` (or wherever the Phase 22 register lives) — **not
written to the register by this audit**, per this task's file-ownership restriction. IDs continue the existing
`D-19-NN` numbering convention seen in the project log; renumber to whatever the actual register's next free ID is at
implementation time.

| ID | Surface | Route/Component | Description | Severity | Evidence |
|---|---|---|---|---|---|
| D-22-1 | Annotations | `EditionAnnotationsPanel.tsx` (`PassageAnnotationCard`), `packages/db/src/schema.ts` (`passage_annotation`) | Passage annotations — the default kind under the production v2+ pipeline — have no verification/dispute/reject/hide/edit workflow at all; the schema itself lacks `verification_status`/`hidden` columns. The landing page's "Approve, edit, or dismiss anything" promise is false for every document processed by the pipeline actually in production. | **P1** (materially incorrect/misleading product claim + a required plan §22.4 field entirely absent) | `packages/db/src/schema.ts:1719-1754`; `EditionAnnotationsPanel.tsx:399-473` vs `AnnotationsPanel.tsx:214-334`; `page.tsx:98` |
| D-22-2 | Roadmap | `RoadmapView.tsx`, `apps/web/src/lib/roadmap.ts` | Roadmap traversal has no canonical-work-identity join; a work reached via multiple `bibliographic_record` rows (review/edition/reprint) will surface as separate roadmap items — "duplicate collapse," an explicit plan §22.5 requirement, is unimplemented on this code path (though implemented on the Reader/Sources path). | P2 | `apps/web/src/lib/roadmap.ts:66-186` (no `work_identity`/`workIdentityId` reference anywhere); contrast `EditionReader.tsx:27-33` (`EditionWork`) |
| D-22-3 | Roadmap | `RoadmapView.tsx` | No restore (un-hide), manual-add, or manual-reorder UI, despite the server-side API (`roadmap/item/route.ts`) already supporting `hidden:false`/`manualTier`/`manualPosition`; `addedManually` is unsupported at both the API schema and UI layers. | P2 | `apps/web/src/app/api/works/[workId]/roadmap/item/route.ts:20-33, 99-135`; `RoadmapView.tsx:237-315` (full file read, no such controls) |
| D-22-4 | Roadmap | `RoadmapView.tsx` (`RoadmapCard`) | No navigation from a roadmap item to its Library entry or Reader — title renders as plain text, not a link. | P3 | `RoadmapView.tsx:257-259` |
| D-22-5 | Reader | `EditionReader.tsx`, `TextReader.tsx` | Reading-passage body text does not use the serif font family the landing depiction explicitly shows and the project's own design decisions describe as the intended reading-prose identity; only headings get `font-serif`. | P2 | `EditionReader.tsx:639`; `TextReader.tsx:191`; landing reference `page.tsx:101` |
| D-22-6 | Reader | `ReaderShell.tsx`, `TextReader.tsx`, `EditionReader.tsx`, `globals.css` | Two parallel, disagreeing reading-width mechanisms: `EditionReader` uses the global `--reading-measure` token (58/72/88ch, D-19-21-fixed); `TextReader`/`PdfReader` use a separate, locally-scoped `--reader-line-width` (56/66/82ch) computed independently in `ReaderShell`. The same user-facing preference produces different actual widths depending on which reader a document uses. | P2 | `ReaderShell.tsx:325, 408-414`; `EditionReader.tsx:521`; `TextReader.tsx:175`; `globals.css:76-78` |
| D-22-7 | Reader/Annotations | `EditionAnnotationsPanel.tsx`, `NotesSidebar.tsx` | Both sidebars are fixed-width (`w-80`, `w-72`) with zero responsive/breakpoint handling; on narrow viewports (the landing contract's own 375px mobile baseline) they cannot both coexist with a usable reading column, and there is no accessible inline/bottom-sheet fallback the way `MarginNote` has for margin notes. | P2 | `EditionAnnotationsPanel.tsx:100`; `NotesSidebar.tsx:32`; `ReaderShell.tsx:329` (no wrap/stack logic) |
| D-22-8 | Global RAG | `AppShell.tsx` | No global expandable RAG sidebar/trigger exists anywhere in the shell; RAG is reachable only via a full-page `/ask-library` nav link or the Reader-only contextual drawer. Dashboard/Library/work detail/Roadmap/Visualization/Writer/Trash have no RAG entry point, contradicting plan §22.6's explicit route list. | P1 (a Phase-22-mandated top-level feature is entirely absent, not partially built) | `AppShell.tsx` (full file, no `RagChatPanel` import); `RagChatPanel` import sites limited to `ReaderShell.tsx`/`ask-library/page.tsx` |
| D-22-9 | Global RAG | `RagChatPanel.tsx` | The Reader's drawer instance has no Escape-to-close handling and no trigger-focus restoration, unlike every other reader-shell disclosure this codebase has already brought to that standard (D-19-18/19/20). | P2 | `RagChatPanel.tsx` (full file — no `onKeyDown`/Escape logic); contrast `ReaderShell.tsx:76, 274-277` (`footnoteTriggerRef`/`closeFootnote`) |
| D-22-10 | Site-wide motion | `globals.css`, all major authenticated surfaces | `.app-control`/`.app-reveal` motion tokens are applied in only 2 of ~12+ major surfaces (Library, Upload); Reader, Annotations, Roadmap, RAG, Writer, Trash, Dashboard, and Visualization's non-3D chrome have no scroll-reveal, hover-elevation, button-press, tab-transition, panel-motion, or loading-progression treatment at all. | P3 (polish/consistency, per severity rubric — no functional break, but plan §22.7 explicitly requires site-wide application) | `grep -rl "app-control\|app-reveal"` across `apps/web/src` → 2 files total |

---

## Open questions

1. **Can `passage_annotation` classification actually produce literal duplicates** (same block, same relationship,
   two rows)? This is a worker/pipeline question outside this audit's file scope (Reader/Roadmap only); needs a
   pipeline-code read before D-22-1's fix design assumes single-row-per-passage is already guaranteed.
2. **Do annotation-related sidebars and Visualization already share label metadata**, or is there a real mismatch
   (plan §22.4's explicit callout)? Not checked — Visualization was out of scope for this pass per the task brief.
   Needs a dedicated cross-check once Phase 20 wave-2's graph/identity work has landed and stabilized.
3. **What canonical-identity primitive will Phase 20's concurrent `canonicalIdentity.ts`/`apps/worker/src/identity/`
   work actually land with?** D-22-2's fix should be designed against whatever that work ships, not designed blind in
   parallel — recommend checking `docs/PROJECT-LOG.md`'s Phase 20 wave-2 entry (once committed) before starting D-22-2.
4. **200% zoom behavior** — not verified live in this pass (no browser session driven); flagged rather than asserted
   either way. Needs an actual Chromium check once a live edition-pipeline document is available or a lightweight
   fixture can be seeded cheaply.
5. **RAG backend scoping for "current Reader passage"/"selected graph node"/"selected roadmap item"** — does the
   Phase 18 RAG retrieval layer already support scoping narrower than `contextWorkId`, or would §22.6's fuller scope
   list require new retrieval-layer work beyond the UI? Not checked — the RAG API route/retrieval code itself was not
   read in this pass (out of the Reader/Roadmap file scope this audit targeted). Needs a read of
   `apps/web/src/app/api/rag/` before committing to a UI design that assumes scoping "just works."
6. **No live edition-pipeline document existed locally at audit time** (see Method) — every Reader/Annotations
   finding above is source-level, cross-checked against schema/API contracts, but Phase 22's own implementation work
   should include an early step to seed (or wait for) a real published v2+/v3/v4 run locally before trusting any
   screenshot-based parity comparison, per D-19-6's already-documented caution about local dev's legacy pipeline
   default and the multi-minute live-API cost of a real run.

## Recommended implementation order for Phase 22

Given the plan's own instruction ("§22.1 is mandatory and must occur before broad frontend implementation") and the
dependencies surfaced above:

1. **§22.1 (plan numbering) — Uncodixify/Stitch workflow gate**, as the plan mandates first; not audited here (out of
   this dossier's scope) but must run before the items below per the plan's own sequencing rule.
2. **D-22-1 (passage-annotation verification workflow)** first among the functional fixes — it is the highest
   severity (P1), requires a schema migration (longest lead time of any item here), and blocks an honest "Annotation
   parity" claim for the rest of Phase 22's own verification checklist (§22.9: "Annotation anchor and metadata tests").
3. **D-22-8 (global RAG sidebar shell integration)**, the other P1 — start once open question 5 (backend scoping) is
   resolved; the component-level reuse (`RagChatPanel`) is already in good shape, so this is mostly `AppShell.tsx`
   work plus D-22-9's Escape/focus fix, which should be folded into the same change since they touch the same
   component.
4. **D-22-5/D-22-6 (Reader typography + reading-width unification)** — do these together, since fixing serif body
   text and unifying the two reading-width mechanisms both touch the same `EditionReader`/`TextReader` paragraph
   rendering; sequencing them together avoids two separate passes over the same lines.
5. **D-22-7 (sidebar mobile layout)** — do after the typography pass above so mobile screenshots are taken against
   final typography, not text that will change again immediately after.
6. **D-22-2/D-22-3/D-22-4 (Roadmap gaps)** — sequence after Phase 20 wave-2's canonical-identity work lands (open
   question 3), since D-22-2 specifically should reuse that data model rather than build a second one.
7. **D-22-10 (motion-token coverage)** last, as the plan's own §22.7/§22.8 framing suggests ("apply to every major
   surface" reads as a coherence pass once the surfaces themselves are otherwise settled, not before) — applying
   `.app-control`/`.app-reveal` to components that are about to change shape (Roadmap's restore/add/reorder UI,
   the RAG sidebar's new shell chrom) would mean redoing the motion wiring twice.
8. **§22.2 primitive extraction (this document's own §22.1)** can run in parallel with any of the above from item 4
   onward, since Phase A of the extraction plan (extract from authenticated components only, don't touch `page.tsx`)
   is provably inert against the frozen landing screenshots and has no ordering dependency on the functional fixes.
