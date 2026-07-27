# Stage 0 Defect Verification Report — Palimnote Graph/Visualization

Read-only audit. All line numbers below were read directly from the current
working tree at the time of this audit (not from memory or the prompt's
remembered numbers). No files were modified.

Primary files involved:
- `apps/web/src/components/graph/KnowledgeGraph3D.tsx` (1730 lines) — the 3D scene (react-force-graph-3d)
- `apps/web/src/components/graph/roadmapLayout.ts` — fixed stage-column layout math
- `apps/web/src/components/graph/graphSceneScaling.ts` — pure scene-scaling/label-visibility/perf-ladder helpers
- `apps/web/src/components/graph/GraphView.tsx` (1327 lines) — page orchestration, filters, URL sync
- `apps/web/src/components/graph/GraphInspector.tsx` — selection detail panel
- `apps/web/src/components/graph/GraphAccessibleFallback.tsx` — the mandatory accessible table
- `apps/web/src/lib/roadmapGraph.ts` — server-side roadmap-mode query parsing
- `apps/web/src/app/api/graph/route.ts` — the graph API route
- `apps/web/e2e/graph.spec.ts`, `roadmap-graph.spec.ts`, `graph-scene.spec.ts`, `graph-debates.spec.ts`, `responsive-visual.spec.ts`, `performance.spec.ts` — e2e coverage

---

## 1. Default Roadmap layout fixes nodes on z=0

**Verdict: CONFIRMED**

`apps/web/src/components/graph/roadmapLayout.ts:93` — `assignStagePositions()` sets
`positions.set(node.id, { fx, fy: (row - offset) * ROW_GAP, fz: 0 })` for every node,
with no branch that ever assigns a non-zero `fz`. The function's own doc comment
states this explicitly at `roadmapLayout.ts:64`: "All nodes are flat on z=0 (the 3D
value is the camera/continuity with explore mode, not a third spatial encoding —
feature plan §2.1)."

Mechanism: `KnowledgeGraph3D.tsx:731-738` calls `assignStagePositions(data.nodes)`
whenever `layoutMode === "roadmap"` and spreads the returned `{fx,fy,fz}` onto each
node before handing `graphData` to `<ForceGraph3D>`. Since `fz` is always `0`,
every node in the default (roadmap) layout is mathematically confined to the
world z=0 plane — a genuinely flat, 2D-in-3D-space layout, not a spatial hairball.

---

## 2. Selecting a Roadmap node derives camera position by multiplying world coordinates (z=0 preserved, camera==target possible for origin node)

**Verdict: CONFIRMED**

`KnowledgeGraph3D.tsx:1476-1496`, `focusCameraOnSelection`:
```
const position = target as { x: number; y: number; z: number };
const distance = 120;
const ratio = position.x === 0 && position.y === 0 && position.z === 0
  ? 1
  : 1 + distance / Math.hypot(position.x, position.y, position.z || 1);
graph.cameraPosition(
  { x: position.x * ratio, y: position.y * ratio, z: position.z * ratio },
  position,
  effectsEnabled ? 700 : 0,
);
```
(`position` is read back from the node's live `object.position` in the scene at
`KnowledgeGraph3D.tsx:1484-1491`.)

Mechanism: the camera position is literally `nodeWorldPosition * ratio`
component-wise. Because every Roadmap-mode node has `fz = 0` (see #1), `position.z`
is always `0`, so `position.z * ratio` is always `0` too — the camera stays exactly
in the z=0 plane the graph itself occupies, i.e. "in the graph plane." For the
special case where the selected node sits at the world origin (`x=y=z=0`, the
`RoadmapForPopover`'s trailing anchor column can land there, or any node whose
computed `fx/fy` both happen to be 0), the code's own explicit guard sets
`ratio = 1`, so the computed camera position becomes `{0,0,0} * 1 = {0,0,0}` —
identical to `target` (`position`, also `{0,0,0}`). Camera and look-at target are
then literally the same point, which is a degenerate camera (no defined viewing
direction), confirming the exact defect described.

---

## 3. Reset derives bearing relative to world origin, not the active controls target

**Verdict: CONFIRMED**

`KnowledgeGraph3D.tsx:1413-1441`, `fitCameraToGraph` (invoked by the "Reset view"
button via `resetSignal` at `GraphView.tsx:748` and `KnowledgeGraph3D.tsx:1459-1462`):
```
const camera = graph.camera();
const direction =
  camera.position.lengthSq() > 0 ? camera.position.clone().normalize() : new THREE.Vector3(0, 0, 1);
graph.cameraPosition(
  { x: fit.target.x + direction.x * fit.distance, y: fit.target.y + direction.y * fit.distance, z: fit.target.z + direction.z * fit.distance },
  fit.target,
  durationMs,
);
```
The code's own comment at lines 1420-1425 states this directly: "Bearing (viewing
direction) is taken from the camera's current position relative to WORLD ORIGIN
... only the distance and look-at target are corrected here."

Mechanism: `direction` is `camera.position` normalized — a vector from world
origin (0,0,0) to the camera, not a vector from OrbitControls' actual look-at
target to the camera. If the user has orbited/panned so that the camera sits
in a degenerate orientation relative to the graph's own bbox center — most
concretely, since Roadmap-mode content is confined to the z=0 plane (#1), a
user who orbits the camera down into (or near) that same z=0 plane is looking
"edge-on" at a flat layout (the columns collapse to a near-invisible line).
Because Reset only ever recomputes `distance`/`target` and reuses the existing
`direction`, an edge-on bearing survives Reset unchanged — Reset can "fix" the
zoom level and re-center on the bbox centroid while leaving the user staring
at the flat layout edge-on, i.e. preserving an invalid viewing direction rather
than restoring a sane default view.

---

## 4. Zoom-dependent node/label sizing uses distance from world origin, not from the camera target

**Verdict: CONFIRMED**

`KnowledgeGraph3D.tsx:638` inside the throttled camera-distance sampler:
```
const distance = camera.position.length();
```
`camera.position.length()` is the Euclidean norm of the camera's position vector,
i.e. its distance from world origin (0,0,0) — not from `controls().target` (the
point the OrbitControls camera is actually orbiting/looking at). This value is
stored in `cameraDistance` state (`KnowledgeGraph3D.tsx:487-488, 639-642`) and
feeds `nodeSceneScale` (`nodeScaleForDistance(cameraDistance)`, line 722),
`readerLevelBeadsVisible(cameraDistance)` (line 1221), `edgeLabelVisible` (line
1345), and the screen-space label scale inputs. A grep of the whole file for
`controls().target`/`OrbitControls().target` usage (`grep -n "target"` across the
file) turns up no such read anywhere — the only place "target" appears in a
camera-framing computation is the *look-at* target passed to `cameraPosition()`
calls (#2, #3), never as the basis for a distance measurement. So all
zoom-dependent sizing is driven by distance-from-origin, which is only correct
when the controls target coincidentally sits at/near the origin (true for
explore mode's force-clustered layout and Roadmap mode's origin-centered column
grid by construction — see `roadmapLayout.ts:41`'s `COLUMN_X_OFFSET` centering
comment — but not guaranteed once a user pans the OrbitControls target away
from origin, which OrbitControls' default pan behavior allows).

---

## 5. Explore-mode force registration can lose a React/library sync race and silently skip clustering

**Verdict: CONFIRMED**

`KnowledgeGraph3D.tsx:815-841`, the `conceptAttraction` d3-force registration
effect. The code's own comment (`KnowledgeGraph3D.tsx:792-814`) documents this
exact race as a *found, reproduced* defect, not a hypothetical:
> "`Simulation.force(name, forceFn)` calls `forceFn.initialize()` IMMEDIATELY
> against whatever node array the underlying (non-React) simulation already
> has registered, but `three-forcegraph`'s own internal sync of a freshly
> changed `graphData` prop is NOT guaranteed to have completed by the time this
> SIBLING React effect fires (a one-frame defer measurably reduces how often
> this races but does not eliminate it — reproduced still throwing even after
> adding the defer, during this same investigation)... Reproduced live:
> filtering the Kind select to 'reference' (dropping a concept node) then
> clicking 'Clear all filters' crashed the whole graph pane into its error
> boundary."

The actual fix is a bare `try { ... } catch { /* skip; next real graphData
change retries */ } ` (lines 819-837) around the `forceLink(...)` registration.
Mechanism: on a genuine race (registration attempted before `three-forcegraph`'s
internal node array reflects the new `graphData`), the `catch` swallows the
"node not found" throw and the function returns having done nothing — the
`conceptAttraction` force is simply not (re-)registered for that render pass.
Nothing schedules an explicit retry beyond "the next real `graphData` change";
if no further `graphData`/`layoutMode` change happens after the race, concept
clustering silently stays off for that session with no user-visible error
(the whole point of the catch is to prevent the app's error boundary from
firing, but the tradeoff is a silent no-op rather than a guaranteed-eventual
recovery).

---

## 6. Graph constrained inside a narrow page and loses space to a fixed inspector even when nothing is selected

**Verdict: CONFIRMED**

- Page width cap: `GraphView.tsx:593` — `<div className="mx-auto max-w-5xl px-6 py-8">` wraps the entire Visualization page (header, controls, the 3D scene/table section, legends, filters — everything).
- Fixed inspector column: `GraphView.tsx:764` —
  `` `${isFullscreen ? "grid h-[calc(100vh-4.5rem)] min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]" : "grid gap-3 xl:grid-cols-[minmax(0,1fr)_19rem]"}` ``
  This grid-template-columns value unconditionally reserves a `19rem` (or
  `20rem` in fullscreen) second column for `<GraphInspector>`
  (`GraphView.tsx:780-792`), regardless of whether a node/link is selected.
- `GraphInspector.tsx:221` confirms the column still renders content (a
  placeholder paragraph) rather than collapsing when nothing is selected:
  `{!selected && !selectedLink && <p ...>Select a graph node or a table row to inspect its source, access, and provenance. Select a link for relationship evidence.</p>}`

Mechanism: the canvas's actual available width on a `max-w-5xl` (64rem/1024px)
page is reduced by the CSS grid to `1fr` inside `minmax(0,1fr)_19rem` — i.e. the
3D canvas permanently cedes ~19rem (with gap) of the already-narrow ~1024px
column budget to an inspector panel with no content to show, on every load of
the page before any selection is made.

---

## 7. Initial scene can prompt "select a labeled node" while many selectable nodes have no discoverable label, especially on touch

**Verdict: CONFIRMED**

Prompt text: `GraphView.tsx:717` — `<p ...>Select a labeled node to focus it; drag to orbit and scroll to zoom.</p>`

Label-visibility policy: `graphSceneScaling.ts:201-207`:
```
export function nodePrimaryLabelVisible(node: { id: string; type: NodeType }, ctx: NodeLabelVisibilityContext): boolean {
  if (node.type === "work") return true;
  if (ctx.selectedNodeId === node.id) return true;
  if (ctx.nextUpNodeId === node.id) return true;
  if (ctx.highlightNodeIds?.has(node.id)) return true;
  return false;
}
```
`highlightNodeIds` (`KnowledgeGraph3D.tsx:857-865`) is populated only from an
active selection focus (`emphasis.emphasizedNodeIds`) or from `hoverNode` (set
by `onNodeHover`, `KnowledgeGraph3D.tsx:1722`) plus that hovered node's
neighbors.

Mechanism: on initial page load (nothing selected, `nextUpNodeId` only
populated in Roadmap mode when an unread item exists), every node whose
`type !== "work"` — references, concepts, people, sections, debates, claims,
peer-reviewed/online sources — has **no visible primary label at all** until it
is hovered or selected. Hover is a pointer-device concept: react-force-graph-3d's
`onNodeHover` fires from mouse movement over the canvas, which has no touch
equivalent (a tap goes straight to `onNodeClick` with no preceding hover event).
So on a touch device, a user following the "select a labeled node" instruction
has no way to discover which of the many unlabeled non-`work` nodes are
selectable/what they represent before tapping one — they must tap blind. This
also affects desktop users before their first hover, just for a shorter window.

---

## 8. Page presents too many primary controls/legends/filters without task hierarchy

**Verdict: CONFIRMED (concrete count below)**

All controls below share identical visual weight (same `text-sm`/`text-xs`,
same `.app-control` border/padding styling, same `<fieldset>` treatment) — no
heading level, size, or color differentiates "primary" from "secondary"
controls anywhere in this file. Concrete inventory, in page order, with data-
independent items marked (D) and data-dependent (only rendered when the
underlying data happens to be non-empty/multi-valued) marked (C):

1. `GraphView.tsx:626-645` — Layout mode toggle group (2 buttons: Roadmap/Explore) (D)
2. `GraphView.tsx:646-653`,`1134-1201` — "Roadmap for" popover trigger + its own internal "Whole library" button + one checkbox per uploaded work (Roadmap mode) (C, count = workNodes.length)
3. `GraphView.tsx:655-670` — Reader level select (toolbar, Roadmap mode) (D within Roadmap mode)
4. `GraphView.tsx:671-680` — Reading thread toggle button (Roadmap mode) (D within Roadmap mode)
5. `GraphView.tsx:1210-1266` (`RoadmapProgressStrip`) — "Next up: <label>" button (conditional) + one button per `STAGE_ORDER` stage (5 buttons) (Roadmap mode, some data-dependent)
6. `GraphView.tsx:726-739` — Focus mode button group (3 buttons: the modes in `FOCUS_MODES`) (D)
7. `GraphView.tsx:740-747` — "Clear focus" button (D)
8. `GraphView.tsx:748` — "Reset view" button (D)
9. `GraphView.tsx:749` — "Fullscreen" button (D)
10. `GraphView.tsx:750` — "Export PNG" button (D)
11. `GraphView.tsx:753-763` — Reading-sequence "← Previous"/"Next →" buttons (Roadmap mode, when sequence-ordered nodes exist)
12. `GraphView.tsx:795-809` — "Accessible node browser" disclosure (`<details>`) (D)
13. `GraphView.tsx:814-825` — Reading-state color legend, 6 non-interactive swatches + a stats summary line (D)
14. `GraphView.tsx:833-846` — Edge-family color legend, non-interactive swatches (D, count = distinct edge families present)
15. `GraphView.tsx:856-895` — "Scope" fieldset: Stage select (Roadmap mode) + Associated work select (C, only if `workNodes.length > 1`)
16. `GraphView.tsx:898-1052` — "Attributes" fieldset: Search input (D) + Reading status select (D) + Kind select (C, `types.length>1`) + Authority select (C) + Provider select (C) + Credibility select (C) + Reader level select (explore mode only, D) + Concept category select (C)
17. `GraphView.tsx:1066-1086` — "Relations" fieldset: Relation select (C, only if any edge relations present)
18. `GraphView.tsx:1088-1102` — "Clear all filters" button (D)
19. `GraphView.tsx:1105-1118` — "Pinned uploaded works" fieldset, one checkbox per work (C, count = workNodes.length)
20. `GraphView.tsx:1120`,`1274-1326` (`GraphExpansionControls`) — "Expand from work" select + "New candidates" number input + "Queue expansion" button + conditional "Confirm expansion" button (only when `enableExpansion` is true for the route)

Even excluding every strictly-data-dependent (C) item, the data-independent
(D) baseline alone is at least **13 distinct interactive controls** (2+1+1+3+1
+1+1+1+1+1 buttons/groups, plus the disclosure, plus 2 always-present filter
controls) rendered above/around the canvas with no grouping beyond the four
same-weight `<fieldset>` boxes (`Scope`/`Attributes`/`Relations`/the ungrouped
button row) — before counting the two non-interactive legends, the roadmap
progress strip's per-stage buttons, or any of the up to 6 additional
data-dependent filter selects that appear once the library/graph contains
more than one work, more than one node type, or any authority/provider/
credibility/concept-kind data at all (all realistic in any populated
library). No control is marked "primary" vs. "advanced"/"more filters" — they
are all rendered flat, in sequence, at the same visual level.

---

## 9. Accessible table can become very wide, unpaginated, with unbounded connection text

**Verdict: CONFIRMED**

- No pagination: `GraphAccessibleFallback.tsx:259` — `{rows.map((n) => (<NodeRow .../>))}` renders every node in `data.nodes` (via the `rows` memo at lines 171-211, itself just a full sort of `data.nodes` with no `.slice()`/page-size anywhere in the file). No page-size state, no "load more," no virtualization.
- Column count: with `hasRoadmap` true, the header row (`GraphAccessibleFallback.tsx:227-256`) renders 11 columns: Title, Kind, Status, Stage, Priority, Order, Known, Connections, Why, Reader level, Credibility.
- Unbounded connection text: `GraphAccessibleFallback.tsx:150-169` builds, per node, one string per incident edge including the edge's own free-text `explanation` field verbatim (`` const evidence = l.explanation ? ` — ${l.explanation}` : ""; ``, line 157) with no length clamp; `GraphAccessibleFallback.tsx:432-434` renders every one of those strings as a `<li>` in an unbounded `<ul>` inside the Connections cell:
  ```
  {connections.length === 0 ? "—" : <ul className="flex flex-col gap-0.5">{connections.map((c, i) => <li key={i}>{c}</li>)}</ul>}
  ```
  A high-degree node (a heavily-cited work, a widely-discussed concept) therefore renders one list item per edge with no truncation, no "show N more," and no cap on the evidence text length per item.
- The container div itself (`GraphAccessibleFallback.tsx:222`, `<div className="overflow-x-auto">`) is a tacit admission the table can overflow its container horizontally — it exists specifically to let a too-wide table scroll rather than break layout, which only becomes necessary because nothing bounds the table's width in the first place.

---

## 10. Existing visual regression tests mask the actual WebGL canvas

**Verdict: CONFIRMED**

`apps/web/e2e/responsive-visual.spec.ts:229-230,268`:
```
{ name: "roadmap", path: () => `/works/${roadmapWorkId}/roadmap`, heading: "Reading roadmap", mask: true },
{ name: "graph", path: () => `/works/${roadmapWorkId}/graph`, heading: "Visualization", mask: true },
...
...(mask ? { mask: [page.locator("[data-graph-canvas]"), page.locator("[data-roadmap-canvas]")] } : {}),
```
The file's own doc comment (`responsive-visual.spec.ts:54-59`) states the
rationale directly: "The one exception is the 3D graph's own `<canvas>`
(`[data-graph-canvas]`), whose WebGL projection varies with device pixel
ratio and container size — not a stable screenshot subject ... so the
Visualization baseline masks that one region rather than skipping the page
entirely; the surrounding chrome (heading, filters, legend, accessible table)
is still real screenshot coverage." `[data-graph-canvas]` is the container
`<div>` wrapping `<ForceGraph3D>` (`KnowledgeGraph3D.tsx:1652`), i.e. the
entire WebGL viewport is blacked out/ignored by Playwright's screenshot
diffing for both the Roadmap page and the Visualization page — a deliberate
and documented choice, but it means these visual-regression tests cannot
catch any pixel-level 3D-scene regression (broken node rendering, wrong
colors, missing geometry, camera framing, label legibility) — only the
chrome around it.

---

## 11. Existing graph tests largely prove wrapper/heading/table/URL behavior, not visible/framed/legible/selectable 3D nodes

**Verdict: CONFIRMED**

The `data-graph-node` attribute — the target of nearly every node-presence
assertion across `graph.spec.ts` and `roadmap-graph.spec.ts` — exists in
exactly one place in the whole codebase:
`apps/web/src/components/graph/GraphAccessibleFallback.tsx:357`,
on the accessible table's `<tr>` element. It is never set anywhere in
`KnowledgeGraph3D.tsx` (confirmed via `grep -rn "data-graph-node"
apps/web/src/components/graph/*.tsx`, one hit). Every assertion of the shape
`await expect(page.locator('[data-graph-node="..."]')).toBeVisible()` (dozens
of occurrences, e.g. `graph.spec.ts:50-53,89-105,134-166,175-234,246-254,
303-306,423-434,457-462`; `roadmap-graph.spec.ts:119-175,190,206,220-227,
249-250,266`) is therefore checking the presence/attributes of a DOM table
row, not that a node is actually rendered, in-frame, legible, or clickable
inside the WebGL `<canvas>`.

Other representative assertions in these files are entirely about: page
`<h1>`/heading text (`graph.spec.ts:47,62,108,239`), URL query-string shape
(`toHaveURL(/[?&]type=concept/)` etc., `graph.spec.ts:92,130,154,178,204,224,
245,276-290`; `roadmap-graph.spec.ts` similarly), the accessible table's own
`<table>`/`role="table"` presence (`graph.spec.ts:114-120`), select/input
values (`getByLabel(...).toHaveValue(...)`), and a `data-graph-effects`
string attribute on the canvas container div (`graph.spec.ts:351`;
`roadmap-graph.spec.ts:235`) which is a React state string, not a rendered-
pixel check. The one test explicitly titled "the 3D graph is primary and its
keyboard browser is a secondary disclosure" (`graph.spec.ts:108-120`) asserts
only that the wrapping `<section aria-label="3D graph canvas">` is present
(`toBeVisible()` on the aria-label locator, line 119) and that the table's
`role="table"` toggles with the `<details>` open/closed — it never inspects
the canvas's rendered content. The one node-selection test that "clicks a
node" (`graph.spec.ts:316`, `roadmap-graph.spec.ts:266`) clicks the
`[data-graph-node=...]` DOM table row, not a raycast-hit coordinate on the
WebGL canvas — so it proves the DOM→selection wiring, not that the same node
is clickable/selectable inside the actual 3D scene. No test in these files
does a `page.evaluate()`/canvas readback, a `scene()` traversal, or a
coordinate-based canvas click to prove a node is genuinely rendered, framed
by the camera, legible, or hit-testable in 3D.

---

## 12. The existing "large graph" test does not exercise the 140/400/800-node degradation boundaries

**Verdict: CONFIRMED**

Tiers defined at `apps/web/src/components/graph/graphSceneScaling.ts:371-376`:
```
export const GRAPH_EFFECTS_LADDER: readonly { maxNodes: number; config: ... }[] = [
  { maxNodes: 140, config: { ... tier "full" ... } },
  { maxNodes: 400, config: { ... tier "reduced" ... } },
  { maxNodes: 800, config: { ... tier "minimal" ... } },
  { maxNodes: Number.POSITIVE_INFINITY, config: { ... tier "bare" ... } },
];
```
(consumed via `graphEffectsForNodeCount()`, lines 383-388, and
`KnowledgeGraph3D.tsx:466`.)

The only "large graph" test in the repo is
`apps/web/e2e/performance.spec.ts:231-244`,
`"Visualization stays within budget with 40 seeded nodes (large-graph test)"`:
```
test("Visualization stays within budget with 40 seeded nodes (large-graph test)", async ({ page }) => {
  const BUDGET_MS = 6000;
  const { workId } = await seedWorkWithGraphData(userId, { title: "Perf Large Graph Work" });
  await seedManyGraphNodes(workId, 40);

  await login(page);
  const start = Date.now();
  await page.goto(`/works/${workId}/graph?layout=explore`);
  await expect(page.getByRole("heading", { name: "Visualization" })).toBeVisible();
  await expect(page.getByText(/\d+ of \d+ shown/)).toBeVisible();
  const elapsed = Date.now() - start;
  record("Visualization render (40+ nodes)", elapsed, BUDGET_MS);
  expect(elapsed).toBeLessThan(BUDGET_MS);
});
```
`seedManyGraphNodes(workId, 40)` (defined at lines 83-108 of the same file)
inserts exactly 40 concept nodes plus whatever `seedWorkWithGraphData` seeds
as a baseline (a handful of nodes) — comfortably under the first tier's
`maxNodes: 140` boundary, so this test only ever exercises the "full" tier.
It asserts nothing about `data-graph-effects` (a repo-wide grep of
`performance.spec.ts` for that string returns no hits) — only page-load
timing and the presence of a heading and an "N of M shown" text node. There
is no test anywhere in the e2e suite that seeds >140, >400, or >800 nodes,
and no test that asserts the `data-graph-effects` attribute resolves to
`"reduced"`, `"minimal"`, or `"bare"` at any node count. The 141/401/801-node
degradation transitions are entirely unexercised by e2e coverage; only
`graphSceneScaling.test.ts` (a Vitest unit test, not e2e, not checked in
detail here beyond confirming it's a separate file from the e2e suite) could
plausibly cover the pure function in isolation.

---

## Query-parameter inventory (URL-compatibility table input)

### Client-side (`apps/web/src/components/graph/GraphView.tsx`)

| Param | Const/definition | Read (file:line) | Written (file:line) |
|---|---|---|---|
| `search` | `FILTER_KEYS` array, `GraphView.tsx:74` | `filtersFromParams`, `GraphView.tsx:105-112` (called at line 158) | `updateFilter`, `GraphView.tsx:228-241`; cleared by `clearAllFilters`, `GraphView.tsx:247-253` |
| `state` | same `FILTER_KEYS`, `GraphView.tsx:74` | same as above | same as above |
| `type` | same `FILTER_KEYS`, `GraphView.tsx:74` | same as above | same as above |
| `authority` | same `FILTER_KEYS`, `GraphView.tsx:74` | same as above | same as above |
| `provider` | same `FILTER_KEYS`, `GraphView.tsx:74` | same as above | same as above |
| `relation` | same `FILTER_KEYS`, `GraphView.tsx:74` | same as above | same as above |
| `credibilityBand` | same `FILTER_KEYS`, `GraphView.tsx:74` | same as above | same as above |
| `associatedWork` | same `FILTER_KEYS`, `GraphView.tsx:74` | same as above | same as above |
| `stage` | same `FILTER_KEYS`, `GraphView.tsx:74` | same as above | same as above |
| `readerLevel` | same `FILTER_KEYS`, `GraphView.tsx:74`; also reused server-side (see below) | same as above; also `GraphView.tsx:206` builds it into `fetchUrl` for the server request | same as above |
| `conceptKind` | same `FILTER_KEYS`, `GraphView.tsx:74` | same as above | same as above |
| `pinnedWork` | `PINNED_WORK_PARAM = "pinnedWork"`, `GraphView.tsx:75` | `GraphView.tsx:159` (`searchParams.getAll(PINNED_WORK_PARAM)`) | `togglePinnedWork`, `GraphView.tsx:333` |
| `layout` | `LAYOUT_PARAM = "layout"`, `GraphView.tsx:81` | `layoutModeFromParams`, `GraphView.tsx:92-94` (called at line 178); also read server-side (see below) | `setLayoutMode`, `GraphView.tsx:349` |
| `roadmapRoot` | `ROADMAP_ROOT_PARAM = "roadmapRoot"`, `GraphView.tsx:82` | `GraphView.tsx:179-181` (`searchParams.getAll`); also read server-side (see below) | `toggleRoadmapRoot`, `GraphView.tsx:375` |
| `readingThread` | `READING_THREAD_PARAM = "readingThread"`, `GraphView.tsx:88` | `GraphView.tsx:182-184` (`=== "1"`) | `setShowReadingThread`, `GraphView.tsx:404` |
| `selected` | `SELECTED_PARAM = "selected"`, `GraphView.tsx:102` | `GraphView.tsx:168-169` | `selectNode`, `GraphView.tsx:262` |
| `focusMode` | `FOCUS_MODE_PARAM = "focusMode"`, `GraphView.tsx:103` | `GraphView.tsx:171-174` | `setFocusMode`, `GraphView.tsx:311` |

Note: `WORK_PREFIX = "work:"` (`GraphView.tsx:89`) is not itself a param; it is
a value-prefix convention used inside `pinnedWork`/`roadmapRoot` values (e.g.
`?pinnedWork=work:<uuid>`), stripped/re-added at `GraphView.tsx:159,180,205`.

### Server-side (`apps/web/src/lib/roadmapGraph.ts`, consumed by `apps/web/src/app/api/graph/route.ts`)

| Param | Read (file:line) | Notes |
|---|---|---|
| `layout` | `isRoadmapLayoutRequested`, `roadmapGraph.ts:63-65` (`params.get("layout") === "roadmap"`); called at `route.ts:29` | Absence = explore mode (documented at `roadmapGraph.ts:58-62`) |
| `roadmapRoot` | `parseRoadmapRootParams`, `roadmapGraph.ts:51-56` (`params.getAll("roadmapRoot")`, strips `work:` prefix); called at `route.ts:30` | Repeated param, one value per pinned/rooted work |
| `readerLevel` | `parseRoadmapRankOptions`, `roadmapGraph.ts:70-82`, specifically line 72 (`params.get("readerLevel")`); called at `route.ts:31` | Validated against `READER_LEVELS` ∪ `"all"`; invalid values become `undefined` |
| `mode` | `parseRoadmapRankOptions`, `roadmapGraph.ts:71` | Not currently written by `GraphView.tsx`'s `fetchUrl` — present in the shared ranking-options parser (also used by the Roadmap page) but not observed as a graph-page URL param in `GraphView.tsx` |
| `maxMinutes` | `parseRoadmapRankOptions`, `roadmapGraph.ts:73` | Same note as `mode` — parsed by the shared function, not written by `GraphView.tsx` |

### Other graph-adjacent routes (found while searching, not part of the visualization page's own URL sync)

| Param | Read (file:line) | Notes |
|---|---|---|
| `workId` | `querySchema`, `apps/web/src/app/api/graph/expansion/preview/route.ts:9,17` | Required UUID, query string on `GET /api/graph/expansion/preview` |
| `candidates` | `querySchema`, `apps/web/src/app/api/graph/expansion/preview/route.ts:9,17` | Optional, coerced number, capped at `MANUAL_GRAPH_CANDIDATE_CAP` |

These two are driven by `GraphExpansionControls`'s own local React state
(`GraphView.tsx:1275-1288`), not by the page's own address-bar URL — they are
listed for completeness since they are graph-route query parameters, but they
are not part of the `GraphView`/`FILTER_KEYS` URL-compatibility surface.

---

## Verification boundary

Everything above was verified by reading the actual current source files
listed at the top of this report (not from memory, not from the prompt's
suggested line numbers) via the Read/Bash/Grep tools, cross-checking claims
against literal code (control-flow, exact string constants, DOM attribute
names) and, where the code's own comments described a "found, reproduced"
defect (claims #3, #5), citing that documentation as corroborating evidence
alongside the actual code path. No app was run, no browser was launched, no
tests were executed — this is a static-code verification only. Where a claim
depended on runtime behavior that static reading cannot fully settle (e.g.
whether OrbitControls' `target` genuinely drifts from world origin in
practice for claim #4, or exactly how often the race in claim #5 fires in
production), that uncertainty is noted inline in the mechanism explanation
rather than asserted as directly observed. `graphSceneScaling.test.ts` was
not opened in detail — its existence was confirmed via `find`/`wc -l` but its
assertions were not read line-by-line, since the specific question (claim #12)
concerned e2e coverage, which was verified directly in `performance.spec.ts`.
