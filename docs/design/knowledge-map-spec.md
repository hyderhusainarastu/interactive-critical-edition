# Knowledge Map Rebuild — Stage 3 Spec

Status: design spec for Stage 3 implementation. Written against the charter
(`docs/handoffs/claude-code-ui-ux-graph-rebuild-prompt.md`, hereafter "the
charter") §8–§14, the completed Stage 2 renderer bakeoff
(`docs/audits/graph-renderer-bakeoff.md`, winner **Prototype A** —
`react-force-graph-3d@1.29.1`, chosen per the correction addendum §C.6/§C.7,
final and binding over the original §7 verdict), the built-and-tested
`@ice/graph-display` package, the Stage 0 baseline audit
(`docs/audits/ui-graph-redesign-baseline.md`), and the Stage 1 shell
(`apps/web/src/components/shell/`). No code is written by this document —
it is the concrete plan Stage 3 implementation follows.

Scope discipline per the operating constraints this lane was launched
under: local worktree only (`/private/tmp/palimnote-redesign`, branch
`redesign/ui-graph-rebuild`), no push/merge/deploy, no paid APIs, no DB
migration, no new production npm dependency (`react-force-graph-3d` and
`three` are already `apps/web` dependencies — Prototype A adds nothing new;
`@react-three/fiber` must not be added, and isn't needed since Prototype A
won). Wiring `@ice/graph-display` into `apps/web` as a workspace dependency
is an internal monorepo package addition, not a new npm dependency — it is
called out explicitly in §1 as a required `apps/web/package.json` edit, not
silently assumed.

---

## 0. One correction to the task's own framing, established before the plan below

The task brief's item 8 says *"roadmapLayout.ts moves toward the separate 2D
Roadmap in Stage 4, note it."* Reading the actual code changes that: a
separate, already-shipped 2D Roadmap page **already exists** —
`apps/web/src/app/(app)/works/[workId]/roadmap/page.tsx` renders
`RoadmapView.tsx` + `RoadmapConstellation.tsx`, a hand-rolled 2D-canvas
constellation (yaw/pitch/zoom, no WebGL, no physics engine) built
specifically to be independent of the Knowledge Map. Its own doc comment
(`RoadmapConstellation.tsx:24-29`) says so explicitly: *"This is
deliberately NOT the Visualization page's WebGL 'Roadmap' layout mode
(`components/graph/GraphView.tsx`/`KnowledgeGraph3D.tsx` ...) — that shows
the whole cross-library research web; this shows one work's own roadmap."*

`apps/web/src/components/graph/roadmapLayout.ts` (stage-column DAG math,
fixed `z=0` positions — baseline defect #1) has exactly one consumer:
`GraphView.tsx`/`KnowledgeGraph3D.tsx`'s `layout=roadmap` mode, i.e. the
literal 3D-mode-inside-the-Knowledge-Map pattern charter §8's last line
forbids ("Do not extrude its flat stage columns and call that 3D... It is
not a mode inside the 3D Knowledge Map"). `RoadmapConstellation.tsx` does
**not** import it and has its own independent layout logic keyed off
`RoadmapItem[]`/`PriorityTier`.

So: once `GraphView.tsx`/`KnowledgeGraph3D.tsx` are deleted (§1 below),
`roadmapLayout.ts` has zero remaining consumers. There is nothing for Stage
4 to receive — the real, charter-compliant separate 2D Roadmap is already
built and already independent. `roadmapLayout.ts` and its test are deleted
in **Stage 3**, not carried forward. This is flagged here as a correction
to the task's assumption, not a silent deviation: `roadmapLayout.ts` is not
being "moved," it is dead code the moment its one caller is deleted.

The consequence for the charter's legacy-URL compatibility table is good
news, not a gap: `roadmapRoot=work:<id>` → *"Redirect/map to
`/works/<id>/roadmap`"* is a redirect to an **already-existing, already
charter-shaped** route, doable in Stage 3 itself (§1/§2 below), not
deferred to Stage 4.

---

## 1. File plan

### 1.1 New directory: `apps/web/src/components/knowledge-map/`

All new production code for the rebuilt Knowledge Map lives here, mirroring
the naming discipline `packages/graph-display` already established.

| File | Purpose | Ported from | Charter item |
|---|---|---|---|
| `adapter.ts` | Instantiates `@ice/graph-display`'s generic exports (`DisplayKind<NodeType>`, `layerForDisplayKind<NodeType>`, `unavailableReasonForState<NodeState>`, `classifyEdgeFamily`, `initialNeighborhood`, `buildAggregateNodes`, `validateDisplayGraph`) against `apps/web`'s real `NodeType`/`NodeState`/`GraphNode`/`GraphLink` (`@/components/graph/types`). This is the "future integration lane" the package README's own usage sketch describes — the first real caller. Pure functions only, no React, unit-tested. | — (new) | §9 |
| `contextChooser.ts` | Pure data-shaping for the context chooser's candidate list (work/passage/question/claim/debate + recent contexts), independent of how each candidate's raw rows are fetched. | — (new) | §8 "Valid entry contexts" |
| `recentContexts.ts` | `localStorage`-backed (namespaced per `userId`) read/write of the last N visited contexts — pure functions, no React, so they're unit-testable without DOM mocking beyond a `localStorage` stub. | — (new, precedent: `WorkspacePreferencesProvider.tsx`/`GlobalRagSidebar.tsx` already use `localStorage` for client-only, non-DB-worthy state) | §8 |
| `arrangeStore.ts` | `localStorage`-backed pinned-node-position persistence, scoped by `(userId, contextKind, contextId)` composite key — "Pinned positions are scoped to the current user/context and may be stored locally if no existing owner-scoped persistence exists... Do not add a database migration solely for saved layout." | — (new) | §11 "Arrange mode" |
| `useGraphUrlState.ts` | React/Next-router binding hook. Reads/writes `URLSearchParams` via `useSearchParams`/`router.replace`, calling straight into `@ice/graph-display`'s `parseGraphUrlState`/`serializeGraphUrlState`/`reconstructGraphUrlState` — **no URL-schema or reconstruction logic of its own**, so the pure package stays the single source of truth and this hook cannot silently drift from it. | — (new, thin binding only) | §9 "Make the following URL state restorable" |
| `useLegacyGraphUrlRedirect.ts` | On mount, calls `@ice/graph-display`'s `translateLegacyGraphUrl` against the current `URLSearchParams`; performs the `redirect` case via `router.replace`, seeds `state`/`chooser` cases into `useGraphUrlState`. One hook, one call site (`KnowledgeMapWorkspace.tsx`), so legacy translation runs exactly once per navigation. | — (new, thin binding only) | §9 "Legacy graph URL compatibility" |
| `cameraMath.ts` | **Re-export only** — `export * from "@ice/graph-display/camera"` (see §1.3 for why this lands in `@ice/graph-display`, not a new copy here). | `prototypes/graph-bakeoff/src/camera/cameraMath.ts` | §11 |
| `useKnowledgeMapCamera.ts` | React hook wrapping `cameraMath.ts`'s pure functions around a live `ForceGraphMethods` ref: `home()`, `fit()`, `focus(nodeId)`, `getCameraPose()`, reduced-motion detection, tween-vs-snap. Structurally the same shape as `GraphScene.tsx`'s inline `applyHome`/`applyFit`/`applyFocus`/`currentPoseVectors`, extracted into a reusable hook so `KnowledgeMapScene.tsx` isn't a 700-line single file the way `KnowledgeGraph3D.tsx` was. | `protoA/GraphScene.tsx`'s camera helpers (lines 268–345) | §11 |
| `nodeVisuals.ts` | `NodeVisualFactory`/`NodeVisual` — Object3D construction per `DisplayKind`, geometry/material caching, picking volume, selection/hover rings. | `protoA/nodeVisuals.ts` (near-verbatim; swap `DisplayKind`'s type param for the real `NodeType` instantiation via `adapter.ts`) | §10 "Node geometry and color" |
| `labelLayer.ts` | Capped screen-space HTML label overlay with greedy AABB collision avoidance. | `protoA/labelLayer.ts` (verbatim — zero product-specific logic, already generic over `LabelCandidate`) | §10 "Labels" |
| `theme.ts` | Backdrop/grid/palette/`KIND_VISUALS`/`EDGE_VISUALS` constants. | `protoA/theme.ts`, re-keyed from the bakeoff's standalone `DisplayKind` union to the real `DisplayKind<NodeType>` from `adapter.ts`; `KIND_VISUALS` gains real entries for `passage`/`question`/`position`/`hypothesis`/`gap`/`writing_project` per charter §10's table (the bakeoff fixture's three "extension" kinds — `learning_step`/`writing_project`/`aggregate` — are joined by the two the bakeoff never modeled, `passage`/`evidence` as first-class-in-charter and `question`/`position` distinct from `debate`; §10's table already assigns all of these explicitly, this file just needs every `DisplayKind` union member covered, checked by a totality test) | §10 |
| `layout.ts` | Deterministic golden-angle seeded initial XY position; two-pass band-Z pinning (`medianXYLinkDistance` → `computeBandGap` → `fz` per node). | `protoA/layout.ts` (verbatim — imports `computeBandGap`/`bandZ`/`maxBandJitter` from the now-shared `cameraMath.ts` re-export) | §8, §14 "deterministic layout seed" |
| `sizing.ts` | `computeNodeScale` (the bounded importance formula), `computeVisibleDegrees`, `percentileOf`. | `protoA/sizing.ts` (verbatim) | §10 "Sizing" |
| `KnowledgeMapScene.tsx` | The 3D scene component — mounts `<ForceGraph3D>`, owns the frozen `graphData` memo, `nodeThreeObject`, click/hover/background handlers, engine-stop band-Z pinning, WebGL context-loss listeners, the per-frame label/orbit `requestAnimationFrame` loop, lifecycle disposal. | `protoA/GraphScene.tsx`, restructured: camera helpers extracted to `useKnowledgeMapCamera.ts` (this file was 748 lines partly *because* camera math lived inline — the hook split keeps this file to scene/lifecycle/interaction only) | §10, §14 |
| `KnowledgeMapFallbackBoundary.tsx` | Error boundary + WebGL-availability probe wrapping `KnowledgeMapScene.tsx`'s mount point. Distinguishes "WebGL genuinely unavailable" (probe fails before mount) from "context lost mid-session" (`webglcontextlost` event) from "any other mount-time throw" (React error boundary) — three different messages, one shared "switch to 2D/List" affordance. | — (new; this is the direct fix for baseline defect "no-WebGL behavior," §5 below) | §14, definition-of-done "fallback cannot complete the same scholarly task" |
| `KnowledgeMapToolbar.tsx` | The 52px primary toolbar: context/breadcrumb, search, `3D / 2D / List`, Focus neighborhood, Fit, Home, Filters, Help. Arrange/orientation-presets/diagnostics/export live in a secondary menu this component owns, not inline. | — (new; replaces the >13-control flat toolbar baseline defect #8 documented) | §10 "Graph workspace layout" |
| `FilterRail.tsx` | Collapsible semantic-layer/filter rail (desktop) / part of the mobile filter sheet. Renders the six layer toggles plus the existing `GraphFilters` fields (search/state/type/authority/provider/relation/credibilityBand/associatedWork/stage/readerLevel/conceptKind) as active-filter chips + an "All filters" drawer per charter §7's progressive-disclosure rule, not all controls flat. | — (new; the filter *fields* are the existing, unmodified `GraphFilters` from `@/components/graph/types` — only the presentation is new) | §7, §10 |
| `InspectorDrawer.tsx` | Selected-only 360px overlay drawer (desktop) / bottom sheet (mobile, snap points 28/70/95%). Renders the charter §12 groups and wires the real action map (§3 below). Opens on the side opposite the selected node's projected X. | `apps/web/src/components/graph/GraphInspector.tsx`'s field-rendering conventions reused where the data shape matches (destination links, credibility display), but the action wiring is entirely new — the old inspector wired almost none of §12's actions (only "Close"/"Expand debate"/destination links — verified by grep, §3 below) | §12 |
| `ContextTray.tsx` | Compact bottom context/history tray (desktop) — breadcrumb of the expansion trail, recent contexts, quick-switch. | — (new) | §10 "Graph workspace layout" |
| `ContextChooser.tsx` | The `/graph` landing surface: pick Work / Passage / Research question / Claim / Debate, plus "Recent" (from `recentContexts.ts`). Never auto-opens the full corpus. | — (new; this is the direct fix for baseline defect: "entire corpus opens without context") | §8 "The global `/graph` route opens a context chooser" |
| `KnowledgeMap2DView.tsx` | Layer-column 2D projection (SVG or canvas2D — see §1.4), same filtered `DisplayNode[]`/`DisplayLink[]` selection as the 3D scene and List. | — (new) | §10 "2D and List" |
| `KnowledgeMapListView.tsx` | Semantic list grouped by layer then relationship distance, search/sort/select/actions, virtualized/paginated. | `apps/web/src/components/graph/GraphAccessibleFallback.tsx` (table-building conventions — column set, sort comparators, per-row action buttons — reused; the *missing* pagination/virtualization the baseline flagged as defect #9 is the one thing this port must add, not carry forward) | §10 "2D and List" |
| `KnowledgeMapWorkspace.tsx` | The composition root: owns `useGraphUrlState`, mounts `ContextChooser` (no context selected) or Toolbar+FilterRail+`{Scene│2DView│ListView}`+`InspectorDrawer`+`ContextTray` (context selected), owns the one `NodeFilterPredicate`/selection/focus state all four consumers (3D/2D/List/inspector) share. | `apps/web/src/components/graph/GraphView.tsx` (route-level orchestration role only — none of its internals are reused; GraphView mixed URL-sync, filter state, and page layout in one 1327-line file, which this component deliberately does not repeat, splitting URL sync into `useGraphUrlState` and layout into the toolbar/rail/tray files above) | §10, §15 Stage 3 |
| `index.ts` | Barrel export: `KnowledgeMapWorkspace` (the only thing route `page.tsx` files import). | — (new) | — |

Every new `.ts`/`.tsx` file above ships with a co-located `.test.ts(x)`
(pure-function unit tests for `adapter.ts`/`layout.ts`/`sizing.ts`/
`recentContexts.ts`/`arrangeStore.ts`/`useGraphUrlState.ts`'s pure helpers;
component/integration tests via Vitest+Testing Library or Playwright per
§7 below for the React components) — no file ships untested, matching the
existing repo convention (every current `graph/` file has a sibling
`.test.ts`).

### 1.2 Legacy file disposition

| File | Disposition | Reasoning |
|---|---|---|
| `apps/web/src/components/graph/KnowledgeGraph3D.tsx` | **Deleted.** | Replaced by `KnowledgeMapScene.tsx` + `useKnowledgeMapCamera.ts` + the ported `nodeVisuals.ts`/`labelLayer.ts`/`layout.ts`/`sizing.ts`. Carries 6 of the baseline's 12 confirmed defects (camera derivation, sizing, force-registration race). Not patched — the charter is explicit this is a from-scratch rebuild, not a repair of this file. |
| `apps/web/src/components/graph/GraphView.tsx` | **Deleted.** | Replaced by `KnowledgeMapWorkspace.tsx` + the toolbar/rail/tray/chooser files. Baseline defects #6 (narrow `max-w-5xl` + permanent inspector cede), #7 (unsatisfiable initial-scene prompt), #8 (13+ flat controls) all live here. |
| `apps/web/src/components/graph/GraphInspector.tsx` | **Deleted.** | Replaced by `InspectorDrawer.tsx`. Current file wires almost no real actions (verified: only `onCloseNode`/`onCloseLink`/`onExpandDebate`/destination `<Link>`s — no verify/dispute/edit/reclassify/etc. anywhere in the file). §3 below builds the real action map from scratch against this file's field-grouping conventions, not its action wiring. |
| `apps/web/src/components/graph/GraphAccessibleFallback.tsx` | **Deleted**, logic ported into `KnowledgeMapListView.tsx`. | Baseline defect #9 (no pagination/virtualization, unbounded evidence text) is fixed in the port, not carried forward as-is. Its role as "the mandatory always-available view" is preserved and *strengthened* — List becomes a first-class synchronized view (§10 "2D and List: consume the same selected context... Neither view is a second independently filtered data source"), not a WebGL-failure-only escape hatch, which directly fixes the baseline's most severe finding (§6 below). |
| `apps/web/src/components/graph/graphSceneScaling.ts` | **Deleted.** | Implements the dead 140/400/800 LOD tiers charter §13 rule 7 explicitly kills, and baseline defect #4 (`camera.position.length()` sizing) lives here. Replaced by `sizing.ts` + `cameraMath.ts`'s `distanceToTarget`. `graphSceneScaling.test.ts` deleted with it. |
| `apps/web/src/components/graph/roadmapLayout.ts` + `roadmapLayout.test.ts` | **Deleted in Stage 3** (correction to the task's own framing — see §0). | Sole consumer (`GraphView.tsx`/`KnowledgeGraph3D.tsx`'s `layout=roadmap` mode) is deleted; the real separate 2D Roadmap (`RoadmapConstellation.tsx`) already exists, is already independent, and never imported this file. |
| `apps/web/src/components/graph/graphFocus.ts` + `.test.ts` | **Kept, relocated to `knowledge-map/`, reviewed.** | Pure `emphasisStateForNode`/`FocusEmphasis` logic — not itself defect-bearing per the baseline's 12-item list. Its consumers (`GraphInspector.tsx`, `GraphAccessibleFallback.tsx`) are being deleted, so it moves to `knowledge-map/graphFocus.ts` and is re-audited against the charter's Focus-mode semantics (§9 `focusMode`: `all`/`neighborhood`/`expand2`/`concepts`/`readingPath`, matching `@ice/graph-display`'s `GRAPH_FOCUS_STATES`) rather than assumed compatible as-is. |
| `apps/web/src/components/graph/graphForces.ts` + `.test.ts` | **Deleted** if Prototype A's own force handling (charter-forced `d3AlphaMin`/`warmupTicks`/band-Z pinning, all inline in `protoA/GraphScene.tsx`) fully subsumes it; kept only if a genuine gap is found during port (e.g. concept-clustering forces the bakeoff fixture didn't need to model). Default assumption for planning: **deleted**, since it is one direct site of baseline defect #5 (the force-registration race) and Prototype A's port does not reproduce that pattern (no separate async force-registration effect — bands are pinned synchronously in `onEngineStop`, §1.1's `layout.ts` row). | |
| `apps/web/src/components/graph/filterGraphData.test.ts` | **Kept, target relocates.** | Tests `filterGraphData`/`GraphFilters` from `types.ts` — canonical-payload-level filtering that stays in `@/components/graph/types` unchanged (§2 below). Test file itself can stay in `components/graph/` since it tests a file that stays there; not moved. |
| `apps/web/src/components/graph/edgeTypeForRelationshipCategory.test.ts` | **Kept, unmoved.** | Same reasoning — tests `types.ts`'s `edgeTypeForRelationshipCategory`, unchanged canonical logic. |
| `apps/web/src/components/graph/types.ts` | **Kept, unmoved, additive edits only.** | This is the canonical graph data contract (§9 below — explicitly preserved, not replaced). Additive edits in Stage 3: none required for the base contract; `GraphNode`/`GraphLink`/`NodeType`/`NodeState`/`EdgeFamily` are all reused as-is by `adapter.ts`'s generic instantiation. If a genuinely new node/edge kind is needed (charter §9's hypothesis/gap/writing-project gap, confirmed by the baseline's data-source matrix §9 as a real contract gap), see §2's "genuinely missing endpoint" handling below — additive only, never a breaking change to an existing field. |
| `apps/web/src/lib/graph.ts` | **Kept, unmoved, PRESERVED per the task's own framing.** | The canonical payload builder. `buildGraph()`, `filterGraphData()`, `roadmapSubset()`, `mergeGraphDelta()` are all reused unchanged. `roadmapSubset()` specifically stops having a caller once the old in-Knowledge-Map roadmap mode is deleted (§0) — left in place, unused, rather than deleted, since it is exported, tested (`filterGraphData.test.ts` covers the module), and cheap to keep; flagged as a documented "currently unused, kept for potential Stage 4 reuse or future removal" note rather than silently orphaned. |
| `apps/web/src/app/api/graph/route.ts`, `apps/web/src/app/api/graph/expansion/route.ts`, `apps/web/src/app/api/graph/debate/[clusterId]/expand/route.ts` | **Kept, unmoved, unchanged.** | API surface stays exactly as-is; Stage 3 is a client-side rebuild consuming the same endpoints. Any additive endpoint need is called out explicitly in §2, not silently added here. |
| `apps/web/src/app/(app)/graph/page.tsx`, `apps/web/src/app/(app)/works/[workId]/graph/page.tsx` | **Edited, not deleted.** | Both are currently thin wrappers around `<GraphView ... />` (verified: `graph/page.tsx` imports only `GraphView`, `phase12FeatureEnabled`, `phase25FeatureEnabled`, `requireSession`). Same shape after the edit — swap `GraphView` for `KnowledgeMapWorkspace`, same server-side auth/flag/data-fetch responsibilities unchanged. |
| `apps/web/e2e/responsive-visual.spec.ts` | **Edited (unmask), not deleted.** | Baseline defect #10 — the graph canvas is currently masked in visual-regression coverage (`:229-230, 268`, "deliberate, documented masking"). The mask is removed and replaced with deterministic frozen-coordinate fixtures per charter §16's explicit instruction ("Do not mask the graph canvas in all visual coverage... Use deterministic frozen coordinates for visual regression"). |
| `apps/web/e2e/graph.spec.ts`, `apps/web/e2e/roadmap-graph.spec.ts` | **Rewritten**, files likely renamed to `knowledge-map.spec.ts` + companions (see §7). | Current coverage asserts almost exclusively on `data-graph-node` table rows / URL query-string shape / a `data-graph-effects` string (baseline defect #11) — real canvas/camera/frustum assertions are net-new, not a small patch. `roadmap-graph.spec.ts` specifically tested the now-deleted in-Knowledge-Map roadmap mode and is retired; any of its assertions still relevant to the real `/works/[workId]/roadmap` page belong to that page's own spec, out of this Stage 3 lane's scope (Stage 4 territory, and that page/spec already exists independently — see §0). |

### 1.3 Where the camera-math module lands: `packages/graph-display`, not a new sibling package

Decision: **port `prototypes/graph-bakeoff/src/camera/cameraMath.ts` into
`packages/graph-display/src/camera.ts`**, re-exported from
`packages/graph-display/src/index.ts`, with
`apps/web/src/components/knowledge-map/cameraMath.ts` reduced to a one-line
re-export (`export * from "@ice/graph-display/camera"`, or, if the
package's flat `main`/`types` export shape makes a subpath import awkward,
a plain `export * from "@ice/graph-display"` since `camera.ts` would join
the package's existing single-entry-point barrel — resolved during
implementation by whichever keeps `pnpm typecheck` cleanest, not a decision
this spec needs to pre-commit to at the import-syntax level).

Justification, weighed against the two obvious alternatives:

- **Not a new sibling package** (`packages/graph-camera` or similar): the
  charter never asks for one, and `packages/graph-display` already exists
  as exactly the "pure, zero-dependency, zero-React, exhaustively tested
  contract package for the Knowledge Map rebuild" home — camera math is
  the same kind of thing (pure functions over plain data, unit-testable
  without a renderer) the package's own README already commits to as its
  charter. A second pure package for one more pure module set is
  unnecessary process weight the charter's own "small, reviewable"
  discipline doesn't call for.
- **Not left in `apps/web`** (`components/knowledge-map/cameraMath.ts` as
  the *real* implementation, not a re-export): the bakeoff module's own doc
  comment is explicit that both prototypes AND "later, the real Knowledge
  Map rebuild" must consume "exactly this module... so Prototype A and
  Prototype B are judged on rendering/interaction, not on two different
  reimplementations of the same geometry deciding the outcome." That
  intent — one camera-math implementation, not a copy — extends naturally
  past the bakeoff into production: `packages/graph-display` is
  importable from a Vitest suite with zero React/DOM/WebGL setup (same as
  the bakeoff module's own test file), which is a real advantage over
  `apps/web` for a module this math-dense and safety-critical (charter
  §11's "a node at (0,0,0) must be safe" class of invariant deserves
  fast, dependency-free unit tests, exactly the profile `graph-display`'s
  existing 3,854 lines of pure-package tests already have).
- Placing it inside `graph-display` also means `disclosure.ts`/`bands.ts`
  (already in that package) and `cameraMath.ts` share one `Vec3`/band-gap
  vocabulary with no duplicate `computeBandGap`/`bandZ`/`maxBandJitter`
  definitions — `bands.ts` already has its own `computeBandGap`/`zForLayer`/
  `deterministicJitter`. **Concrete consequence for the port:** `cameraMath.ts`'s
  own `computeBandGap`/`bandZ`/`maxBandJitter` and `bands.ts`'s
  `computeBandGap`/`zForLayer`/`deterministicJitter` must be reconciled into
  ONE set during the port (not shipped as two near-duplicate definitions in
  the same package) — `bands.ts`'s versions are kept (they're already
  wired into `layerForDisplayKind`/the aggregate-layer machinery other
  Stage 3 code depends on) and `cameraMath.ts`'s three band functions are
  deleted at port time, with `layout.ts` (§1.1) importing `computeBandGap`/
  `zForLayer`/`deterministicJitter` from `bands.ts` instead of a
  `cameraMath.ts` copy. This is a real, callable-out reconciliation step,
  not hand-waved as "just merge them."

### 1.4 How protoA's scene code is adapted (bakeoff fixtures → real payload via the adapter)

`protoA/GraphScene.tsx` consumed `BakeoffFixture` — synthetic
`FixtureNode`/`FixtureLink` objects with `displayKind`/`layer`/`bandIndex`/
`degree` already precomputed by the fixture generator. Production
`KnowledgeMapScene.tsx` instead receives a **filtered `DisplayNode[]`/
`DisplayLink[]` selection** — the output of the pipeline in §2 below
(`/api/graph` payload → `adapter.ts` → `@ice/graph-display`'s
`initialNeighborhood`/`expandNeighborhood`/`buildAggregateNodes` →
`useGraphUrlState`'s active filters applied → one selection). The
adaptation is mechanical because `@ice/graph-display`'s `DisplayNode`/
`DisplayLink` types (charter §9's exact shape) already carry every field
the bakeoff's `FixtureNode`/`FixtureLink` had bespoke fields for:

| Bakeoff fixture field | Production `DisplayNode`/`DisplayLink` equivalent |
|---|---|
| `FixtureNode.displayKind` | `DisplayNode.displayKind` (same type, real values) |
| `FixtureNode.layer`/`bandIndex` | `DisplayNode.layer` (`layerForDisplayKind` computes it; `bandIndex` is `LAYER_INDEX[layer]` from `@ice/graph-display`'s `layers.ts`, not a separately-carried field) |
| `FixtureNode.degree` | Computed at scene-build time from the filtered `DisplayLink[]` via `computeVisibleDegrees` (`sizing.ts`), same as the bakeoff did — not a payload field either place |
| `FixtureNode.isRoot`/`isHub` | `isRoot`: node id === the active `GraphUrlContext`'s resolved root display id. `isHub`: not a `DisplayNode` field — computed the same way the bakeoff computed it, from degree percentile, at scene-build time |
| `FixtureNode.unavailableReason` | `DisplayNode.unavailableReason` (identical field name and semantics) |
| `FixtureLink.displayFamily` | `DisplayLink.displayFamily` (identical — `classifyEdgeFamily`'s output) |
| `FixtureLink.isSelfLink`/`parallelOf` | Not `DisplayLink` fields — computed at scene-build time by grouping links on `(source, target)` unordered pairs, same curvature-assignment logic the bakeoff used, now run over the real filtered link set instead of a fixture |

So the adaptation work is: (1) `adapter.ts` maps real `GraphNode`/
`GraphLink` → `DisplayNode`/`DisplayLink` via `@ice/graph-display`'s
generic exports; (2) `KnowledgeMapScene.tsx`'s `graphData` memo builds the
same derived-at-mount-time fields (`degree`, `isRoot`, `isHub`, self-link/
parallel-link curvature) the bakeoff fixture generator precomputed, now
computed once per filtered selection instead of once per fixture — a
straightforward, mechanical translation, not a redesign of the scene
logic itself. Everything downstream (node visuals, sizing, labels, camera)
is untouched by this swap, since it already consumed the
`displayKind`/`layer`/`unavailableReason`/`displayFamily` vocabulary that
carries over unchanged.

---

## 2. Data flow

```
/api/graph (unchanged: buildGraph() → GraphPayload {nodes, links, stats})
        │
        ▼
adapter.ts: GraphNode[]/GraphLink[] → DisplayNode[]/DisplayLink[]
    (classifyEdgeFamily, layerForDisplayKind, unavailableReasonForState,
     validateDisplayGraph — structural diagnostics logged, never thrown
     into the user's face per §14 "malformed/dangling data handling")
        │
        ▼
initialNeighborhood() / expandNeighborhood() / enforceVisibleCap() /
buildAggregateNodes()   (@ice/graph-display/disclosure.ts, pure)
        │
        ▼
useGraphUrlState's active filters (layers, GraphFilters fields, focus state)
applied via the SAME filterGraphData()-style predicate `KnowledgeMapWorkspace`
computes once
        │
        ▼
ONE filtered DisplayNode[]/DisplayLink[] selection
        │
   ┌────┼────────────┬───────────────┐
   ▼    ▼             ▼               ▼
3D Scene  2D View   List View    InspectorDrawer (selected subset only)
```

Canonical payload immutability (charter §9 "Canonical server payload
remains immutable") is enforced the same way `@ice/graph-display`'s own
test suite already proves it for the package's pure functions
(`validate.ts`'s `deepFreeze`/`assertNotMutated`): `adapter.ts` calls
`deepFreeze` on the raw `GraphPayload` immediately after fetch, before any
transformation runs, so a later bug that tries to mutate a canonical node
in place throws immediately in dev rather than silently corrupting shared
state — the same discipline `filterGraphData`/`roadmapSubset` in
`lib/graph.ts` already follow ("returns a new object and never mutates its
input").

### 2.1 Context chooser data sources (charter §8 "Valid entry contexts")

| Entry context | Data source | Endpoint / query |
|---|---|---|
| **Work** | The reader's own uploaded works. | `GET /api/works` (existing, unchanged) — already the Library/Reading-Queue data source, reused as-is for the chooser's "Work" tab. |
| **Passage** | Owned `passage_annotation` rows (anchored) or a work's `text_block` rows the reader has visited/bookmarked recently. | **No dedicated list-passages-across-works endpoint currently exists.** Per charter §3's allowance ("A narrowly additive owner-scoped application endpoint is allowed only when a required action cannot be wired through an existing endpoint and no schema change is needed"), this is a genuine gap — see §2.3 below for the specified additive endpoint. |
| **Research question** | The reader's own `research_project` rows (a project's stated question(s)). | `GET /api/research/projects` (existing — confirmed present under `apps/web/src/app/api/research/projects/route.ts`) — reused as-is, filtered client-side to projects carrying a question. |
| **Claim** | Owned `research_claim` rows across the reader's projects. | `GET /api/research/claims` (existing — confirmed present) — reused as-is; the chooser passes a small `limit`/recency sort, both already supported by that route's existing query-param surface (verified against its own handler at implementation time, not assumed). |
| **Debate** | Owned `debate_cluster` rows. | **No dedicated list-debates-across-projects endpoint currently found** at the `apps/web/src/app/api/research/` top level (only `/research/projects/[projectId]` and `/research/chambers/[chamberId]` singular-resource routes were found, not a cross-project debates listing). Per §2.3, this is the second genuine gap. |
| **Recent** | `recentContexts.ts`'s `localStorage` list — client-only, not server data. | No endpoint; pure client read. |

### 2.2 Passage/question/claim/debate context data sources (charter §9's own data-source matrix, cross-checked against the baseline audit's §9)

Restated from the baseline audit's own findings (`ui-graph-redesign-baseline.md`
§9, itself charter-mandated to precede implementation) rather than
re-derived independently, so Stage 3 does not silently disagree with
Stage 0's own audit:

- **Passage/evidence display nodes**: source is `passage_annotation`
  (DB-enforced anchor invariant), `research_claim`'s source-passage
  linkage, and evidence records referenced by claims — all real,
  owner-scoped tables. The baseline flagged that `buildGraph()` does not
  currently emit a passage-level node kind distinct from `section` in the
  base payload. Stage 3 does **not** change `buildGraph()`/the canonical
  contract (§1.2 — `lib/graph.ts` preserved). Passage/evidence
  `DisplayNode`s are instead synthesized in `adapter.ts` **only when a
  passage/claim/debate context is the active entry context** — i.e., they
  are a context-scoped display-layer construction over
  `passage_annotation`/`research_claim` rows fetched via the (existing or,
  for passage, additive per §2.3) endpoint, never invented from the base
  cross-work payload. This matches charter §9's own invariant: "Every
  display node has a stable ID, owner-scoped source, layer, destination or
  explicit unavailable reason, and projection provenance" — the
  `projection.basisIds`/`rule`/`version` fields on a synthesized
  passage/evidence node record exactly which `passage_annotation`/
  `research_claim` row(s) it came from.
- **Question/position/debate display nodes**: `research_project`,
  `debate_cluster`, judged `claim_relationship` rows — all confirmed
  present and owner-scoped. The existing `claim`/`debate` `NodeType`
  values (additive Phase 28.4, flag-gated behind `graphDebateLayer`) are
  the canonical anchor; `adapter.ts` maps them straight through via the
  generic `DisplayKind<NodeType>` instantiation with no synthesis needed —
  unlike passage/evidence, these already exist in the canonical contract.
  `position` (charter's display-only kind, distinct from `debate`) is
  synthesized only inside a debate expansion, from the same
  `claim_relationship`-judged data `graphDebate.ts` already loads (one
  claim "position" per distinct stance the judged relationships imply —
  see `docs/handoffs/claude-code-ui-ux-graph-rebuild-prompt.md` §8's
  `debate/question → positions → claims → decisive evidence` flow), not a
  new DB read.
- **Learning-step display nodes**: deterministic projection of the
  owner-scoped computed Roadmap — `RoadmapAnnotation` already exists on
  `GraphNode` (roadmap-mode payloads only). Since Stage 3 removes the
  in-Knowledge-Map roadmap layout mode (§0), `learning_step` display nodes
  are **not synthesized in Stage 3 at all** — they remain a documented
  Stage-4 concern once the Knowledge Map needs to show a "prerequisite for
  the Roadmap" link into the *separate* `/works/[workId]/roadmap` page,
  which is a destination link (charter §12: "Open... Roadmap"), not an
  in-scene node kind, in Stage 3's actual usage. This is a deliberate scope
  cut, stated here rather than silently left ambiguous: Stage 3 ships the
  `learning_step` `DisplayKind` in the type union (so `theme.ts`'s
  totality test passes and nothing crashes if one is ever emitted) but no
  Stage 3 code path constructs one.
- **Hypothesis/gap display nodes**: confirmed real, owner-scoped Research
  records (`research_hypothesis`-family tables per the Phase 27.2 shipped
  feature, `hypothesesNote.ts`/`hypotheses.ts` in `lib/research/`).
  Synthesized in `adapter.ts` only inside a debate/claim context expansion
  (same "context-scoped, not base-payload" pattern as passage/evidence
  above), fetched via `GET /api/research/projects/[projectId]` (which
  already returns a project's hypotheses/gaps alongside claims, confirmed
  by the "existing combined hypotheses-and-gaps behavior" the charter
  itself instructs Stage 3 to preserve, §6 "Preserve... the existing
  combined hypotheses-and-gaps behavior").
- **Writing-project display nodes**: confirmed real, owner-scoped Writer
  projects. Synthesized only when a claim/debate's evidence has been
  inserted into a Writer document — i.e., only where a real
  `writer`-evidence link exists (`writerEvidence.ts` in `lib/research/`,
  confirmed present) — never a "this claim could theoretically be cited"
  speculative edge.
- **Aggregate nodes**: `buildAggregateNodes()` (`@ice/graph-display/disclosure.ts`,
  already built and tested) — deterministic summaries of the current
  filtered display set, `basisIds` enumerating the hidden group. No data
  source beyond the already-fetched selection; purely a disclosure-layer
  computation.

### 2.3 Two genuinely missing endpoints (charter §3's explicit allowance)

Both specified here per the charter's own bar: *"a required action cannot
be wired through an existing endpoint and no schema change is needed."*
Both below satisfy that bar — additive, owner-scoped, no new table, no
migration.

**1. `GET /api/passages/recent`** (new file:
`apps/web/src/app/api/passages/recent/route.ts`)

- Purpose: back the context chooser's "Passage" tab and `recentContexts.ts`'s
  passage-kind entries with a real, owner-scoped list, since no existing
  endpoint aggregates `passage_annotation` rows across a reader's works.
- Query: `SELECT` from `passage_annotation` joined through
  `processing_run → document → work` scoped to `work.user_id = <caller>`
  (same ownership-chain pattern `passage-annotations/[annotationId]/route.ts`
  already uses for its own scoping), ordered by `passage_annotation.updated_at
  DESC` or `created_at DESC` (whichever the schema actually carries — checked
  against `packages/db/src/schema.ts` at implementation time), `LIMIT`
  capped (e.g. 20) via a query param with a hardcoded max, same convention
  `research/claims`'s existing `limit` param uses.
- Response shape: `{ id, workId, workTitle, quote, summary, updatedAt }[]`
  — enough for the chooser to render a card and to construct the
  `GraphUrlContext` (`{ kind: "passage", id: passage_annotation.id }`)
  charter §9 requires.
- Auth: `getApiUserId()`, 401 if absent — no separate ownership check
  needed beyond the join's `WHERE work.user_id = ...`, matching every
  other reader-scoped route's pattern.
- No new table, no migration — reads only.

**2. `GET /api/research/debates`** (new file:
`apps/web/src/app/api/research/debates/route.ts`)

- Purpose: back the context chooser's "Debate" tab with a cross-project
  list, since the existing debate-cluster surface (`graphDebate.ts`,
  `/research/debates/[clusterId]` page per the baseline's route inventory)
  is per-cluster/per-project, not an owner-scoped cross-project listing.
- Query: `SELECT` from `debate_cluster` scoped to the caller's own
  `research_project` rows (`WHERE research_project.user_id = <caller>`,
  same join-through-ownership pattern), ordered by recency, `LIMIT`
  capped.
- Response shape: `{ id, projectId, projectTitle, question, memberCount,
  updatedAt }[]` — mirrors `GraphNode.debateClaimCount`/`debateQuestion`
  fields already defined on the canonical contract (`types.ts:140-163`),
  so the chooser card and the eventual `DisplayNode` for the same debate
  read consistent field names.
- Auth: same pattern as above.
- No new table, no migration — reads only.

Both are genuinely additive per the charter's bar and are called out here
as **proposed**, to be built as part of Stage 3 implementation (not a
pre-existing gap silently worked around) — matching the "specify the
minimal owner-scoped ADDITIVE endpoint" instruction in the task brief
verbatim.

---

## 3. Inspector action map

Every charter §12 action, mapped against real, currently-existing
endpoints — verified by reading each candidate route's actual handler
(§ file citations below), not assumed from its name. Where no real
backend support exists, the honest-unavailable state is specified
explicitly rather than left implicit.

| §12 action | Applies to (display kind) | Real endpoint | Notes |
|---|---|---|---|
| **Open owned evidence or Reader passage** | `passage`/`evidence` nodes; any node with a `destination` route into `/works/[id]/reader` | Client-side `<Link href={destination}>` using `GraphNode.destination` (existing field, unchanged) or, for a synthesized passage `DisplayNode`, a constructed `/works/[workId]/reader?anchor=<passageAnnotationId>` deep link (matches the reader's own existing quote-fingerprint anchor convention, §"Design Decisions" in the project log) | No new endpoint — navigation only |
| **Open work / Library item / claim / debate / Evidence Chamber / Research project / Roadmap / Writer destination** | `work`, external `reference`/`peer_reviewed_source`/`online_source` (→ `/library/[id]`), `claim` (→ `/research/claims/[claimId]`), `debate` (→ `/research/debates/[clusterId]`), chamber (→ `/research/chambers/[chamberId]`), `question`/project (→ `/research/[projectId]`), work (→ `/works/[workId]/roadmap` per §0), `writing_project` (→ `/writer/[projectId]`) | `GraphNode.destination` where already populated (work/Library); constructed routes from known id fields for the rest (claim/debate/chamber/project ids are already carried on the synthesized `DisplayNode`'s `sourceEntity`) | For a cited-only work (no `destination`), see the dedicated row below — never a guessed/404 route (charter §9 invariant, already enforced by the existing `destination: string \| null` contract) |
| **Verify** | `claim`/`relationship`/`cluster`/`chamber`/`hypothesis`/`gap` display nodes whose `sourceEntity` resolves to a real research object id | `POST /api/research/corrections` `{ objectType, objectId, action: "verified" }` (existing, confirmed handler at `apps/web/src/app/api/research/corrections/route.ts:35-69`) | |
| **Dispute** | same set | `POST /api/research/corrections` `{ action: "disputed", reason }` | `reason` field wired to a short inline textarea per charter §6's "accessible dialogs, inline validation" instruction (no `window.prompt`) |
| **Edit** | `claim` only (the only object type the corrections endpoint supports `edited` for, confirmed at `corrections/route.ts:71-79`) | `POST /api/research/corrections` `{ objectType: "claim", action: "edited", changes: { claimText?, supportingExcerpt? } }` | For every other object type: honest unavailable — "Editing isn't supported for this type yet" |
| **Reclassify** | `claim` only (`corrections/route.ts:81-86`) | `POST /api/research/corrections` `{ action: "reclassified", changes: { claimNature } }` | Same honest-unavailable for non-claim types |
| **Add evidence** | `claim` only, and only as "replace/attach this claim's supporting excerpt" — there is no multi-evidence-list endpoint | `POST /api/research/corrections` `{ action: "edited", changes: { supportingExcerpt } }` (reusing the Edit action's own field, not a separate mechanism — the corrections API has no dedicated "add a second piece of evidence" concept) | UI copy must say "Update supporting excerpt," not "Add evidence," to avoid implying a capability (a list of multiple evidence items per claim) that doesn't exist — this is the "never render a button that only pretends to work" rule applied to *wording*, not just presence/absence |
| **Remove a relationship** | `relationship`-typed corrections objects (`claim_relationship` rows, surfaced as edges inside a debate expansion) | `POST /api/research/corrections` `{ objectType: "relationship", action: "hidden" }` (soft-hide, reversible via `"restored"` — matches the existing `verified/disputed/hidden/restored` action set for non-claim object types, `corrections/route.ts:25,43-46`) | For a `graph_edge`-sourced citation/classification edge (the base cross-work payload's `edges` — confirmed via `lib/graph.ts:786-792` to carry **no `provenance` field at all**, unlike `passageAnnotationLinks`/`resourceRelations` which do), there is **no correction endpoint** — `graph_edge` rows are written once at analysis time with no owner-scoped mutation path found anywhere in the API surface. Honest-unavailable: "This relationship was generated during analysis and can't be edited here yet." Documented as a real, confirmed gap, not a guess. |
| **Mark uncertain** | `annotation`-backed edges (citation/classification relationships anchored to a reader's own `annotations` row) and `passage_annotation`-backed edges | `PATCH /api/works/[workId]/reader/annotations/[annotationId]` `{ verificationStatus: "disputed" }` (existing, confirmed handler) for legacy `annotation` rows; `PATCH /api/works/[workId]/reader/passage-annotations/[annotationId]` `{ verificationStatus: "disputed" }` (existing, confirmed handler, identical schema) for v2+ passage annotations — "mark uncertain" maps to the existing `disputed` status value in both cases, there is no separate "uncertain" enum value to invent | The inspector must know which of the two annotation tables backs a given edge before choosing the route — carried on the `DisplayLink`'s `provenance.relationId` (§3's own edge-provenance audit above) plus a `provenance.kind: "annotation" \| "passage_annotation"` discriminant `adapter.ts` sets from which query produced the row (§2's pipeline — `passageAnnotationLinks` vs. the legacy `annotations`-sourced edges, if any remain reachable; confirmed the base `edges` array itself has no per-edge annotation-id linkage, so this action is realistically scoped to passage-annotation-sourced edges only in practice) |
| **Request reprocessing** | `work` nodes only | `POST /api/works/[workId]/reprocess` (existing, confirmed handler at `apps/web/src/app/api/works/[workId]/reprocess/route.ts:41`) | Matches the existing Library/work-detail "Reprocess" affordance — the inspector's version is the same call, not a new mechanism |

**Reading status / mastery** (charter §12 "Reading status," "Explicitly
qualified mastery" — listed under inspector *groups*, not explicitly under
"scholarly actions," but the natural place to set them):

- For a `work`/bib-id-backed node: `POST /api/works/[workId]/roadmap/item`
  `{ bibId, readingStatus, understandingScore }` (existing, confirmed
  handler, root-work-scoped).
- For a Library-catalog (`learning_resource`-backed) node: `POST
  /api/library/[resourceId]/status` `{ readingStatus, understandingScore }`
  (existing, confirmed handler, catalog-scoped).
- The inspector picks whichever endpoint matches the node's own id shape
  (`work:<uuid>` vs. `external:bib:<uuid>` resolved-to-`bibId` vs. a
  `learning_resource`-backed external node) — never guesses; a node with
  neither shape (e.g. a `concept`/`section`/`claim`/`debate` node) simply
  does not render reading-status controls, matching the existing contract's
  own scoping (`readingRecords`/`understandingRatings` are only ever keyed
  by `workId`/`bibId`/`learningResourceId`, never by a concept or claim
  id).

**For a cited-only work** (charter §12's own closing paragraph):

- Show metadata/provenance from the existing `GraphNode` fields
  (`authors`, `year`, `venue`, `doi`, `url`, `credibility`, `accessStatus`,
  `sourceTextStatus`).
- "Open the citation occurrence within an uploaded source": link to the
  citing work's Reader at the anchor of the citation (constructed from
  `GraphLink.provenance`/`evidence` where a passage anchor exists, same
  pattern as the "Open owned evidence" row above), not the cited work's own
  (nonexistent, for this user) full text.
- "Offer legitimate acquisition or upload": link to `/upload` pre-filled
  with the citation's known metadata where the existing upload flow
  already supports a prefill (checked against `/upload`'s current query-param
  handling at implementation time; if no prefill support exists, link to
  bare `/upload` rather than fabricating one) — never a fake "Access full
  text" button.

---

## 4. Camera/interaction

### 4.1 Hook architecture

```
useKnowledgeMapCamera(fgRef: RefObject<ForceGraphMethods>, containerRef: RefObject<HTMLDivElement>)
  → { home(animated), fit(), focus(nodeId, neighborhoodPoints), getCameraPose(), applyOrientationPreset(preset) }
```

Internally, `useKnowledgeMapCamera` is a direct port of
`protoA/GraphScene.tsx`'s `applyHome`/`applyFit`/`applyFocus`/
`currentPoseVectors`/`currentFov`/`visiblePoints` (lines 268–345),
extracted from the scene component into a standalone hook so:

1. `KnowledgeMapScene.tsx` stays focused on scene/lifecycle/interaction
   wiring (mirroring the file-size discipline §1.1 states).
2. The hook is unit-testable in isolation against a mocked
   `ForceGraphMethods`-shaped object (no real WebGL needed to test that
   `home()` calls `computeHomePose` with the right bounding box, e.g.), the
   same separation-of-concerns `cameraMath.ts` itself already models (pure
   math vs. renderer binding).

Every operation funnels through the same four `cameraMath.ts` (now
`@ice/graph-display`, §1.3) primitives, exactly as the charter specifies
and the bakeoff already implements — **no new camera math is written**,
only the binding layer around it:

| Charter §11 requirement | `cameraMath.ts` function | Hook call site |
|---|---|---|
| Canonical Home: az45/el35, Z-up, bounding-box center, 18% padding, both-FOV fit, ≥20° elevation floor, nonzero separation | `computeHomePose(FitParams)` | `home(animated)` |
| Fit: expanded visible bounds, safe-area insets | `computeFit(FitParams)` + `computeFocusPose` (fit recentres via the *current* camera-relative direction, not always canonical — matching `protoA`'s own `applyFit`, which uses `computeFocusPose` around `computeFit`'s result rather than jumping straight to the canonical direction) | `fit()` |
| Focus: `cameraPosition = target + normalize(currentPos - currentTarget) × distance`, 20° floor fallback to canonical, distance from the focused node's own expanded bounds (never a fixed scalar) | `computeFocusPose(FocusParams)`, distance from `computeFit` over `[nodePosition, ...visibleNeighborPositions]` | `focus(nodeId, neighborhoodPoints)` |
| 350ms tween / reduced-motion snap | Not in `cameraMath.ts` itself (it returns poses, not durations) — the hook reads `prefers-reduced-motion` (same `reducedMotionActive()` helper ported from `protoA/GraphScene.tsx:113-115`) and passes `0` or `DEFAULT_FOCUS_TWEEN_MS` to `fg.cameraPosition(pos, target, ms)` | every operation |
| Top/Front/Side orientation presets, Front/Side retain ≥20° elevation, Top is a deliberate 90° exception | New: `applyOrientationPreset(preset: "top" \| "front" \| "side")` computes a fixed azimuth/elevation pair per preset (`front`: az0/el20, `side`: az90/el20, `top`: az0/el90 — Top explicitly bypasses `validatePose`'s elevation check, matching the charter's own carve-out: *"the Top orientation preset is a deliberate, documented exception to the elevation floor... must not be run through this validator as if it were a bug"* — `cameraMath.ts`'s own doc comment on `validatePose` already states this) then calls `computeFocusPose`-equivalent math with that fixed direction instead of the live camera-relative one | Secondary orientation menu only (§10 toolbar spec — not primary toolbar) |
| Zoom-dependent sizing/labels use distance-to-target, not `camera.position.length()` | `distanceToTarget(cameraPosition, target)` | `sizing.ts`'s per-frame or per-filter-change scale recompute (ported unchanged from `protoA`, which already never calls `.length()` from origin — confirmed by reading `GraphScene.tsx` in full, no such call exists) |

### 4.2 Interaction rules (charter §11 "Controls")

Directly ported from `protoA/GraphScene.tsx`'s existing `handleNodeClick`/
`handleNodeHover`/`handleBackgroundClick` (lines 649–672) plus new,
charter-required additions the bakeoff didn't need to model (it had no
double-click/Escape/Arrange requirements in its own interaction test
matrix):

- **Single click/tap** → `applySelection(nodeId)` — selects, opens/updates
  `InspectorDrawer`, **no camera move** (ported verbatim; `protoA`'s
  `handleNodeClick` already only calls `applySelection`, never a camera
  function).
- **Double-click** (new binding, not in `protoA`) → `applySelection(nodeId)`
  followed immediately by `useKnowledgeMapCamera.focus(nodeId, ...)`.
- **Explicit Focus button** (toolbar) → same `focus()` call as double-click,
  for the current selection.
- **Search selection** → may select-and-focus in one action (same `focus()`
  call), matching charter §11's "Search selection may select and focus."
- **Background click** → `applySelection(null)` (ported verbatim from
  `handleBackgroundClick`).
- **Escape** → closes the topmost transient UI first (open filter drawer >
  open Help > open orientation menu > InspectorDrawer), and only clears
  persistent context (the active `GraphUrlContext`) on a *second* Escape
  with nothing transient open — implemented as a small ordered stack
  `KnowledgeMapWorkspace.tsx` owns (`transientUiStack: Array<() => void>`),
  not duplicated per-component Escape handlers, reusing the existing
  `useDialogEscape` primitive (`apps/web/src/components/primitives/useDialogEscape.ts`)
  for each individual transient surface and composing them.
- **Hover never moves the camera** — ported verbatim (`handleNodeHover`
  only toggles ring visibility + label tier, never touches `fgRef`).
- **Left-drag orbit / wheel-pinch zoom / right-drag or modified-drag pan** —
  native `OrbitControls` behavior via `react-force-graph-3d`'s built-in
  controls, unchanged from `protoA` (which sets no custom pan/zoom/rotate
  handlers — the library's stock upright-orbit behavior is exactly what
  charter §11 asks for, confirmed by `protoA`'s own decision not to
  override it).

### 4.3 Arrange mode

- Ordinary navigation: `enableNodeDrag={false}` (ported verbatim from
  `protoA/GraphScene.tsx:743`).
- Explicit Arrange mode (toolbar secondary menu → "Arrange"): flips
  `enableNodeDrag={true}` for the scene, and wires `onNodeDragEnd` to write
  the dragged node's final `(x, y)` (Z stays band-pinned — Arrange never
  moves a node out of its semantic band, matching charter §8's "Constrain
  nodes to their semantic band while allowing deterministic force
  separation within X/Y") into `arrangeStore.ts`'s `localStorage`-backed
  map, keyed `(userId, contextKind, contextId, nodeId) → {x, y}`.
- On next mount of the same context, `layout.ts`'s seeded-position pass
  checks `arrangeStore.ts` first per node before falling back to the
  golden-angle spiral — a pinned node's position is deterministic from
  local storage, an unpinned node's is deterministic from its index/seed,
  so the "deterministic layout seed" requirement (§14) holds either way.
- **Pin** / **Unpin** / **Reset Layout** are three toolbar-secondary-menu
  buttons: Pin writes the current position, Unpin removes that node's
  entry, Reset Layout clears every entry for the current
  `(userId, contextKind, contextId)` triple.
- No DB migration — `arrangeStore.ts` is `localStorage`-only, per charter
  §11's explicit instruction.

---

## 5. Fallback

### 5.1 WebGL-unavailable (charter §14, direct fix for the baseline's most severe finding, §6 above)

`KnowledgeMapFallbackBoundary.tsx` probes WebGL availability **before**
attempting to mount `KnowledgeMapScene.tsx`, using the same
`canvas.getContext("webgl")`/`getContext("webgl2")` check the baseline
audit's live lane used to reproduce the current failure
(`ui-graph-redesign-baseline.md` §6):

```
if (!webglAvailable) {
  render <KnowledgeMap2DView /> or <KnowledgeMapListView />
    (whichever the user's last-chosen `view` URL state was, defaulting to
    List — never silently forcing 2D over List or vice versa)
  + a visible, honest banner: "3D view isn't available in this browser.
    Showing the [List/2D] view instead." + a "Learn more" link, never a
    generic "This workspace view could not load" (the exact baseline
    defect being fixed)
}
```

This directly satisfies the charter's "mandatory accessible table as the
default view" design intent that the baseline proved is currently
**disproven** — with this boundary in place, WebGL absence degrades to a
fully-functional List/2D view with real node data, real filters, real
selection/inspector, not an error screen with zero graph content anywhere
on the page (definition-of-done: *"The fallback cannot complete the same
scholarly task"* must not be true).

### 5.2 `webglcontextlost` / `webglcontextrestored` (charter §14)

Ported and extended from `protoA/GraphScene.tsx`'s existing
`onContextLost`/`onContextRestored` wiring (lines 529–546, already does
`event.preventDefault()` + cancels the rAF loop + calls `callbacks.onContextLost`):

- **On `webglcontextlost`**: (already correct in `protoA`, ported
  unchanged) `event.preventDefault()` (per MDN's documented requirement to
  suppress default context-loss handling so a restore is even possible),
  stop the frame loop, cancel any in-flight layout/data work
  (`AbortController` on the current `/api/graph`/expansion fetch, new —
  the bakeoff never modeled mid-fetch context loss since its fixtures were
  synchronous). `KnowledgeMapFallbackBoundary.tsx` then switches to
  List/2D with an honest banner ("The 3D view lost its graphics context.
  Showing the List view — [Retry 3D]") and a visible Retry control (charter:
  "Provide a visible Retry where retry is meaningful").
- **On `webglcontextrestored`**: **do not** auto-reinitialize — remain in
  the semantic fallback (List/2D) until the user explicitly presses Retry,
  per charter §14's own explicit either/or: *"either reinitialize exactly
  once and restore context/view/selection/layers/filters/expansion state,
  or remain in the semantic fallback until the user activates Retry."* This
  spec picks the second, more conservative option deliberately: an
  automatic reinit risks racing a user who has already started
  interacting with the List/2D fallback (e.g. mid-filter-change), and
  "remain until Retry" is strictly simpler to make correct (no dual-path
  state reconciliation between "what the fallback view's state drifted to"
  and "what the 3D scene should resume with") while still satisfying every
  literal charter requirement. On Retry, `KnowledgeMapFallbackBoundary.tsx`
  unmounts and remounts `KnowledgeMapScene.tsx` fresh (not "resume the
  dead one") passing the **current** `useGraphUrlState` state (context,
  view, selection, layers, filters, expansion trail, focus) — so whatever
  the user did in the List/2D fallback while 3D was down is what 3D comes
  back showing, not a stale pre-loss snapshot. This satisfies "restore
  context/view/selection/layers/filters/expansion state" without needing a
  separate frozen-at-loss-time snapshot.

### 5.3 Any other mount-time throw (React error boundary)

`KnowledgeMapFallbackBoundary.tsx` is also a real React error boundary
(`componentDidCatch`/`getDerivedStateFromError`, function-component
equivalent via a small class wrapper — React error boundaries cannot be
hooks-only as of the React version this repo pins) around the
`KnowledgeMapScene.tsx` mount point specifically (not the whole
`KnowledgeMapWorkspace.tsx` tree — Toolbar/FilterRail/InspectorDrawer/
List/2D must keep working even if only the 3D mount throws). Catches
throw a distinct, honest message from the WebGL-unavailable case ("The 3D
view hit an unexpected error. Showing the List view — [Retry 3D] [Report
this]"), never the same generic copy for both causes — this is the direct
fix for the baseline's documented complaint that the current error screen
"reads like a network problem when the real cause is a client-side WebGL-
context failure": the three failure modes (unavailable / context-lost /
threw) now render three distinguishable messages, not one generic one.

### 5.4 Zero-size container / loading / empty / malformed data

- **Zero-size container**: `KnowledgeMapScene.tsx` does not mount
  `<ForceGraph3D>` until `dimensions.width > 0 && dimensions.height > 0`
  (ported verbatim from `protoA/GraphScene.tsx:716`, already correct).
- **Loading**: `KnowledgeMapWorkspace.tsx` shows a skeleton/spinner state
  while the `/api/graph` fetch is in flight, distinct from the
  zero-context ContextChooser state (loading vs. "nothing chosen yet" are
  different states, never conflated).
- **Empty** (a valid context with zero neighbors — e.g. a brand-new work
  with no analysis yet): a real, honest empty state ("No connections found
  yet for this work" + a link to trigger analysis/reprocessing where
  applicable), not a blank canvas.
- **Malformed/dangling payload data**: `validateDisplayGraph()` (already
  built, `@ice/graph-display/validate.ts`) runs in `adapter.ts` immediately
  after the canonical→display mapping; any `GraphDiagnostic` with severity
  `"error"` (duplicate ids, dangling endpoints) causes that specific
  node/link to be dropped from the filtered selection (never crash the
  whole scene for one bad row) with the diagnostic logged via the existing
  `@ice/observability` structured-error seam, and a small, dismissible
  "Some connections couldn't be displayed" notice — never silent, never
  fatal.

---

## 6. LOD/degradation

The old three-tier system (`graphSceneScaling.ts`'s 140/400/800-node
degradation boundaries) is **dead**, per charter §13 rule 7 ("Do not
preserve the old 140/400/800 degradation tiers automatically") and the
bakeoff's own explicit finding.

New thresholds, derived directly from the bakeoff report
(`docs/audits/graph-renderer-bakeoff.md` §8, "Derived LOD-threshold
recommendations") plus the charter's own 120/60 disclosure caps
(`@ice/graph-display/disclosure.ts`'s `VISIBLE_CAP`, already built:
`{ desktop: 120, mobile: 60 }`):

| Node count (visible, post-disclosure-cap) | Behavior |
|---|---|
| 0–120 desktop / 0–60 mobile | **No LOD demotion at all.** Bakeoff data: median FPS flat at 59.88, p95 frame time in a tight 17.1–18.4ms band across every mandatory fixture (12/24/60/120/500 nodes) — Prototype A shows **no measurable performance gradient** in this entire range, so no degradation tier is warranted between the smallest fixture and the 500-node headroom fixture. This directly supersedes the old system's first demotion boundary at 140 nodes, which the bakeoff proves is unnecessary at that scale for the chosen renderer. |
| 120–500 (desktop only — mobile's own cap is 60, so this range is desktop-exclusive; a mobile session is capped at 60 visible nodes by the disclosure contract itself, never reaching this range) | Charter §8's own aggregation rule already handles this, not a renderer-LOD concern: *"Above 120 visible desktop nodes or 60 mobile nodes, aggregate remaining branches into labeled display-only summaries."* `enforceVisibleCap()` (already built) triggers `buildAggregateNodes()` before the scene ever receives more than 120/60 real nodes — the renderer literally never sees a 500-node scene in ordinary product use; 500 is the bakeoff's *headroom* fixture (proving the renderer could handle more than disclosure ever asks of it), not a product-reachable scale. |
| 500–1,000 (diagnostic-only, per bakeoff/charter) | Bakeoff: "even the 1,000-node/4,000-link diagnostic fixture shows only a modest degradation" — stays diagnostic per charter §13 rule 3 ("Nonblocking stress characterization... its FPS/latency floors are diagnostic unless real product evidence makes that scale mandatory") and rule 8 ("Do not promise 5,000-node support unless real corpus evidence requires it"). The Stage 0 corpus audit (§4 above) found production's largest real graph is ~486 unique nodes across both existing works combined — nowhere near 1,000 — so this tier remains untested-in-product, diagnostic-only, exactly as the bakeoff report already concludes. |
| Above 1,000 | Out of scope — no product code path can reach this given the 120/60 disclosure cap plus explicit-expansion-only growth (each expansion adds ≤20 nodes, charter §8). |

**One real degradation the bakeoff *does* motivate** (its own §8, "Future
optimization targets"): Prototype A's p95 pointer→highlight latency
(28.4–44.0ms) is real but 3–4× higher than Prototype B's, comfortably
inside the 100ms floor at every mandatory fixture size but worth watching
if a future corpus grows well past 500 real nodes. Stage 3 does **not**
add a new LOD tier to preempt this (no product evidence justifies it per
rule 8), but does record it as a documented, non-blocking follow-up risk
in the Stage 3 completion evidence (§18 of the charter) rather than
silently dropping the bakeoff's own honest secondary finding.

Label-count LOD (charter §10 "capped priority set of at most 20 desktop or
10 mobile nodes") is **not** a new tier either — it's `labelLayer.ts`'s
existing `MAX_PRIORITY_LABELS_DESKTOP`/`MAX_PRIORITY_LABELS_MOBILE`
constants, ported unchanged from `protoA`, and already independent of node
count (it caps *labels shown*, not *nodes rendered*).

---

## 7. Test plan

Mapped against every charter §16 "Browser graph tests" item and the
fixture-boundary list, each assigned to a spec file. Fixture generation
reuses `@ice/graph-display`'s existing test fixtures
(`testFixtures.ts`) plus the bakeoff's own fixture generator
(`prototypes/graph-bakeoff/src/fixtures/`) where its shape already matches
(both already model empty/one-node/disconnected/directed/self-link/
parallel-link/duplicate-id/dangling-endpoint/long-label/dense-hub cases per
the bakeoff's own charter §16 mandate — reused, not reinvented).

### 7.1 Graph data fixtures (charter §16, first list)

All fixtures below live in a new
`apps/web/src/components/knowledge-map/__fixtures__/` directory, as
`DisplayNode[]`/`DisplayLink[]` (post-adapter shape, so scene/2D/List tests
share one fixture set) plus a small set of **pre-adapter** `GraphNode[]`/
`GraphLink[]` fixtures specifically for `adapter.ts`'s own unit tests
(charter: "Every current node type/state has a visual mapping" needs a
canonical-shape input to prove that against).

| Fixture | Node/link count | Used by |
|---|---|---|
| Empty | 0/0 | `adapter.test.ts`, `KnowledgeMapScene` empty-state browser test |
| One node | 1/0 | `cameraMath` "node at origin" tests (already exist in `@ice/graph-display`'s own suite — reused, not duplicated), `KnowledgeMapScene` single-node browser test |
| Disconnected components | varies | `disclosure.ts`'s existing tests (reused) + a `KnowledgeMapScene` browser test proving both components render and are independently selectable |
| Directed relationships | varies | `families.ts` arrow-rendering unit test + browser hit-test |
| Self-link | 1 node, 1 self-link | `layout.ts` curvature unit test (ported from `protoA`'s own `curvatureById` logic) |
| Parallel links | 2 nodes, 2+ links | same |
| Duplicate node/link IDs | — | `validate.ts`'s existing `validateDisplayGraph` tests (reused) + an `adapter.test.ts` case proving a duplicate is dropped with a logged diagnostic, not a crash |
| Dangling endpoint | — | same |
| Long labels | — | `labelLayer.ts` truncation unit test (ported from `protoA`, already covers 2-line max) |
| Dense hub | 1 node, many links | `sizing.ts` clamp unit test (`MAX_SCALE`/"no hub may exceed 2× base size" — note: charter's sizing formula clamps to 1.6×, which is itself ≤2×, so this is provably satisfied by the formula's own clamp, tested directly against `computeNodeScale`) |
| Realistic held/missing mix | ~20 nodes, mixed `state` | `theme.ts` totality test (every `NodeState` → visual treatment) + browser screenshot |
| Claim/debate expansion | — | `KnowledgeMapScene` debate-expansion browser test (mirrors the existing `graph/debate/[clusterId]/expand` E2E coverage, ported to assert on real canvas nodes appearing post-expansion, not just a `data-graph-node` count) |
| 11/12/13 mobile-initial | 11, 12, 13 nodes | `disclosure.ts`'s existing `INITIAL_NEIGHBOR_CAP.mobile` boundary tests (already built — reused) |
| 23/24/25 desktop-initial | 23, 24, 25 | same, `.desktop` |
| 59/60/61 mobile-visible-limit | 59, 60, 61 | `disclosure.ts`'s existing `VISIBLE_CAP.mobile` boundary tests (reused) |
| 119/120/121 desktop-visible-limit | 119, 120, 121 | same, `.desktop` |
| 500/2,000 | 500 nodes, 2,000 links | Bakeoff's own fixture, reused directly for a `KnowledgeMapScene` performance-adjacent browser test (real-GPU only, §7.4) |
| 1,000/4,000 | 1,000 nodes, 4,000 links | Bakeoff's own fixture, reused for the same diagnostic-only stress test |

### 7.2 Pure graph tests (Vitest, no DOM/WebGL)

| Charter requirement | Test file |
|---|---|
| Canonical data not mutated | `adapter.test.ts` (`deepFreeze`/`assertNotMutated` around `buildGraph()` output — reuses `@ice/graph-display/validate.ts`'s existing helpers, doesn't reimplement them) |
| Every node type/state has a visual mapping | `theme.test.ts` — totality test iterating every `DisplayKind`/`NodeState` union member against `KIND_VISUALS`/`unavailableReasonForState`, failing loudly on any gap (same pattern `@ice/graph-display`'s own `bands.test.ts`/`state.test.ts` already use) |
| Every edge value has a family mapping | Already covered by `@ice/graph-display/families.test.ts`'s `ALL_EMITTED_EDGE_VALUES` fixture — reused, re-run as part of `adapter.test.ts`'s own suite to prove the *real* `apps/web` edge-type set (not just the package's mirrored audit list) round-trips cleanly |
| `ai_inferred` remains provenance | `theme.test.ts` — asserts the `ai_inferred` category never produces a distinct color, only the 70%-opacity + dash treatment (`AI_INFERRED_OPACITY_MULTIPLIER`, already exported by `families.ts`) |
| Depth-band assignment | `@ice/graph-display/bands.test.ts` (existing, reused) + `layout.test.ts` (ported from `protoA/layout.test.ts` if one exists there, else new — proving `computeFixedZ` composes `bandZ`/`maxBandJitter` correctly for the real `DisplayKind` set) |
| Prioritized initial neighborhood | `@ice/graph-display/disclosure.test.ts` (existing, reused) |
| Expansion and aggregation limits | same |
| Stable deterministic layout | `layout.test.ts` — same seed/index → same position, twice |
| Bounding-box center and fit | `@ice/graph-display/camera.test.ts` (ported from `cameraMath.test.ts`, existing, reused verbatim after the §1.3 relocation) |
| Horizontal/vertical FOV handling | same |
| Origin-node focus | same (`MIN_FIT_DISTANCE` / "node at (0,0,0) must be safe" tests already exist in the bakeoff's `cameraMath.test.ts`) |
| Minimum camera-target separation | same (`validatePose` tests, existing) |
| Minimum elevation | same |
| Home canonical pose | same |
| Zoom scaling relative to active target | `sizing.test.ts` (ported) + `camera.test.ts`'s `distanceToTarget` tests |
| URL state parsing/restoration | `@ice/graph-display/urlState.test.ts` + `urlStateCodec.test.ts` (existing, reused) + `useGraphUrlState.test.ts` (new — thin binding-layer test proving the hook calls the package functions correctly, not re-testing the package's own logic) |
| Ordered expansion/focus reconstruction | `@ice/graph-display/reconstruct.test.ts` (existing, reused) |
| Legacy graph URL translation | `@ice/graph-display/legacyGraphUrl.test.ts` (existing, reused) + `useLegacyGraphUrlRedirect.test.ts` (new binding-layer test) |
| Malformed/dangling data handling | `adapter.test.ts` + `@ice/graph-display/validate.test.ts` (existing, reused) |

### 7.3 Browser graph tests (Playwright)

New spec: `apps/web/e2e/knowledge-map.spec.ts` (replaces `graph.spec.ts`),
plus `apps/web/e2e/knowledge-map-context-chooser.spec.ts`,
`apps/web/e2e/knowledge-map-fallback.spec.ts` (WebGL-unavailable/context-loss,
using Playwright's `--disable-gpu`/context-option WebGL-disable capability
or a page-init-script override of `HTMLCanvasElement.prototype.getContext`
— the same technique the baseline's live lane used to reproduce the
current defect, now reused to prove the *fix*), and
`apps/web/e2e/knowledge-map-legacy-urls.spec.ts` (the full compatibility
table from charter §9, one test per row, asserting the *resulting*
`GraphUrlState`/redirect target, not just an HTTP 200 — directly answering
the charter's "confirm deterministic translation rather than merely HTTP
success" instruction).

| Charter requirement | Coverage |
|---|---|
| Data loading to scene ready | `knowledge-map.spec.ts` — waits on a real `interactive`-equivalent signal (reuses the bakeoff's own "interactive" definition: nonzero canvas, root in-frustum, picking enabled — via a small test-only bridge analogous to the bakeoff's `HarnessBridge`, exposed only under `NODE_ENV=test`/a dedicated flag, never shipped to production bundles) |
| Nonblank unmasked pixels + numeric in-frustum node assertions | `knowledge-map.spec.ts` — real canvas screenshot (not masked, fixing baseline defect #10) + `graph2ScreenCoords`-equivalent readback via the same test bridge, asserting root/priority nodes are within `[0, viewportWidth] × [0, viewportHeight]` |
| Initial labels legible | same spec, OCR-free geometric assertion (label DOM element exists, is within viewport, has nonzero computed size) — not pixel-diffed text (fragile), matching how `labelLayer.ts`'s own DOM structure (`dataset.labelNodeId`) already makes this queryable |
| Search, select, focus, clear, Fit, Home, Back, filters | `knowledge-map.spec.ts` core interaction suite |
| Node and link hit testing | same — real pointer events dispatched at real screen coordinates (from the test bridge's `getNodeScreenPosition`, ported directly from `ProtoAHandle`'s existing method) |
| Inspector and accessible-view parity | `knowledge-map.spec.ts` — same node selected via 3D canvas vs. via List view produces the identical `InspectorDrawer` content (byte-for-byte assertion on rendered fields) |
| 3D/2D/List switching | `knowledge-map.spec.ts` |
| Route remount and deep-link restoration | `knowledge-map.spec.ts` + `knowledge-map-legacy-urls.spec.ts` |
| Table/List → 3D remount | `knowledge-map.spec.ts` |
| Repeated resize | `knowledge-map.spec.ts` — viewport resize x5, asserts scene stays framed (no baseline-defect-#3-style stuck bearing) |
| Rapid filter changes | `knowledge-map.spec.ts` — asserts no renderer remount occurs (charter §14: "No renderer remount for... ordinary filter changes") via the test bridge exposing a mount-instance counter |
| Fullscreen | `knowledge-map.spec.ts` |
| Pointer orbit/zoom/pan | `knowledge-map.spec.ts` |
| Touch tap/orbit/pinch/pan | `knowledge-map.spec.ts` at a mobile viewport with Playwright's touch emulation |
| Arrange, pin, unpin, reset | `knowledge-map.spec.ts` — new suite, asserts `localStorage` writes and position persistence across remount |
| Reduced motion | `knowledge-map.spec.ts` — `prefers-reduced-motion: reduce` context option, asserts zero-duration camera moves |
| Unsupported WebGL | `knowledge-map-fallback.spec.ts` |
| `webglcontextlost` | `knowledge-map-fallback.spec.ts` — dispatches the real event via the test bridge (mirrors `protoA`'s own `onContextLost` wiring, which already listens for the real DOM event, so a real dispatch exercises real production code, not a mock) |
| `webglcontextrestored` without duplicate renderer/lifecycle resources | `knowledge-map-fallback.spec.ts` — asserts exactly one Retry → exactly one new scene mount (mount-instance counter from the test bridge, same mechanism the bakeoff's own §13-step-9 lifecycle protocol already validates) |
| Stale async cancellation | `knowledge-map-fallback.spec.ts` — starts a context switch, immediately switches again, asserts only the second fetch's data ever reaches the scene (via `AbortController`, §5.2) |
| Repeated mount/unmount cleanup | `knowledge-map.spec.ts` — ports the bakeoff's own 20-cycle lifecycle protocol (charter §13 step 9, already implemented and passing for Prototype A per the corrected bakeoff report §C.4) as a Playwright-driven route-remount cycle rather than the bakeoff harness's own imperative mount/unmount, reusing the same `renderer.info`/active-worker/observer/timer/listener comparison logic |

Visual regression: `responsive-visual.spec.ts` is edited (§1.2) to unmask
the canvas region and use the deterministic frozen-coordinate fixtures
from §7.1 (fixed seed → fixed layout → fixed camera pose → a screenshot
that is legitimately stable across runs, unlike a live-force-simulation
screenshot would be) — combined with the numeric in-frustum assertions
above, per charter §16's explicit "Combine screenshot review with camera/
frustum/data assertions; pixel variance alone is insufficient."

### 7.4 Real-GPU performance measurements

Run separately from headless CI, on the same machine/protocol the bakeoff
report already established (`docs/audits/graph-renderer-bakeoff.md` §1) —
**not** re-measured from scratch, since Stage 3 is integrating the exact
renderer/camera/node-visual code the bakeoff already measured, not writing
new rendering logic. A short confirmation pass (one scripted orbit per
mandatory fixture, not the full 5-trial protocol) is run post-integration
specifically to catch any regression the *production* wiring (real
payload adapter, real filter state, real toolbar/rail/tray DOM overlaying
the canvas) might introduce that the bakeoff's isolated harness couldn't
have — e.g. the additional DOM chrome (toolbar/rail/tray) changing the
canvas's effective viewport size, which is exactly the kind of thing
`computeFit`'s `safeAreaInsets` parameter exists to absorb correctly (§11
above) but is worth confirming empirically once real chrome exists,
not merely assumed correct because the math is unit-tested.

### 7.5 Signed-in journey tests

Charter §16 journeys 4, 5, 6 (Research project → contextual Knowledge Map;
Passage → claim → evidence → disagreement → graph → Roadmap/Curriculum →
Writer; relationship corrections) are **owned by this Stage 3 lane only for
their Knowledge-Map-touching segments** — the full end-to-end journeys
(Research project creation, Writer insertion) are Stage 5/6 deliverables
per the charter's own stage breakdown and this task's own §8 boundary. This
spec's test plan therefore includes the Knowledge-Map-entry and
Knowledge-Map-exit points of each journey (context chooser → scene →
inspector action → destination navigation) as `knowledge-map.spec.ts`
cases, with the pre/post segments (creating the research project, writing
in Writer) stubbed via direct DB seeding (existing E2E helper convention,
`apps/web/e2e/helpers.ts`) rather than driven through UI that Stage 3 does
not own.

---

## 8. Stage boundary

Explicitly out of Stage 3's scope, confirmed against the charter's own
stage breakdown (§15) and this task's brief:

- **2D Roadmap page**: already exists (`/works/[workId]/roadmap`,
  `RoadmapView.tsx`/`RoadmapConstellation.tsx`, §0 above) and is
  **untouched** by this Stage 3 rebuild — no file under
  `apps/web/src/app/(app)/works/[workId]/roadmap/` is read, imported, or
  edited by any file in §1's plan. Stage 4 ("Read integration") owns any
  further Roadmap work (its own charter item: "Separate 2D Roadmap").
- **Reader integration**: `KnowledgeMapWorkspace`'s "Open owned evidence or
  Reader passage" inspector action (§3) constructs a URL into the existing
  Reader route — it does not modify the Reader itself, its chrome, its
  panels, or its own Ask Library mount. Full Reader-chrome simplification
  (charter §6 "Simplify Reader chrome") is Stage 4.
- **Research workspace integration**: destination links out of the
  Knowledge Map into `/research/*` routes (§3) are navigation only — no
  Research project-navigation shell, claims/evidence card redesign, or
  pipeline-action consolidation (all charter §6 "Research" / Stage 5 items)
  is built here.
- **Writer integration**: same — a destination link out to
  `/writer/[projectId]` where a real evidence-insertion link exists (§2.2),
  nothing about Writer's own editor/panels (Stage 6).
- **Global shell chrome** (rail/context-bar/command-palette expansion to
  cover claims/debates/hypotheses) is Stage 1's own deliverable, already
  built per the Stage 1 shell this lane read (`navItems.ts`'s
  `buildCommandPaletteNavItems` already lists `/graph` as "Knowledge Map" —
  confirmed present, unchanged by Stage 3, since Stage 3 doesn't touch
  `navItems.ts`).
- **Home surface's "review a claim/relationship awaiting attention"**
  (charter §6 "Home") is not built here — Home is untouched by this Stage
  3 lane.

Everything else in this document — the Knowledge Map itself, its context
chooser, its 3D/2D/List synchronized views, its camera contract, its
inspector and real action wiring, its fallback behavior, and its full test
matrix — is Stage 3's complete, self-contained deliverable.
