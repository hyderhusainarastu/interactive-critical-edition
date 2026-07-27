# `@ice/graph-display`

Pure, exhaustively-tested display/render contract for the Knowledge Map
rebuild (charter `docs/handoffs/claude-code-ui-ux-graph-rebuild-prompt.md`
§8/§9, "Stage 3 DISPLAY-ADAPTER lane"). Zero runtime dependencies, zero
renderer code, zero React — every export is a plain function or type over
plain data, mirroring `packages/roadmap`/`packages/curriculum`'s own
pure-package conventions exactly (`package.json`, `tsconfig.json`, `vitest`
as the house test runner, no build step — `main`/`types` point straight at
`src/index.ts`).

## What this package does NOT do

- No renderer code, no React components, no page/UI changes. The Stage 2
  renderer bakeoff (charter §13) is a separate, parallel workstream and this
  package must not assume its outcome.
- No wiring into `apps/web`. Nothing here reads a live canonical
  `GraphNode`/`GraphLink` payload, calls a DB, or imports anything from
  `apps/web`. A future integration lane instantiates this package's generic
  types with `apps/web`'s real `NodeType`/`GraphNode`/`GraphLink` and calls
  its functions from the actual `buildGraph()` consumers.

## Type provenance — why `DisplayKind` is generic, but `CanonicalEdgeFamily` isn't

The charter (§9) says: *"if `apps/web/src/components/graph/types.ts` is not
importable from a package... define the contract package as the new home
for the DISPLAY types only and take canonical types as generic/structural
parameters. Do NOT duplicate-and-drift canonical types."* `apps/web` is a
Next.js app, not an importable workspace package, so that condition holds —
but the charter's own two suggested resolutions (generic parameters, vs. a
manually-synced local mirror) trade off differently depending on how likely
the canonical type is to drift, so this package uses **both**, deliberately,
for different reasons on a case-by-case basis:

| Canonical type | This package's choice | Why |
|---|---|---|
| `NodeType` (9 values, has grown once already — Phase 28.4 added `claim`/`debate`) | **Generic parameter.** `DisplayKind<TCanonicalKind extends string = CanonicalNodeTypeMirror>` — a real caller instantiates it with the actual `NodeType` import for full type safety and zero duplication. | Real, demonstrated drift risk. Hard-coding it here would silently go stale the next time `NodeType` grows, exactly the failure mode the charter warns against. |
| `NodeState` (6 values) | **Generic parameter** (`unavailableReasonForState<TState>`), same reasoning as `NodeType`. | Smaller set, but the same growth-risk argument applies — no evidence it's more stable than `NodeType`. |
| `EdgeFamily` (5 values: `reference`/`influence`/`opposition`/`structural`/`prerequisite`) | **Local literal mirror** (`CanonicalEdgeFamily` in `types.ts`), NOT generic. | The charter itself restates these five values verbatim and explicitly as a **frozen** contract — *"Keep the canonical five-value `EdgeFamily` contract unchanged"* — unlike `NodeType`, there is no history or expectation of this set growing. Making the edge-family mapping table (`families.ts`, this package's actual deliverable value) generic over an unknown family-name type would have made it impossible to ship a real, hard-coded, exhaustively-tested mapping — the whole point of item 3. |
| `UNDIRECTED_EDGE_TYPES` (5 string values) | **Local mirror** (`UNDIRECTED_EDGE_VALUES` in `families.ts`), same reasoning as `EdgeFamily`. | Small, stable, needed by name for the `validateLinkDirection` invariant. |
| `GraphLink.provenance` shape (`{relationId, runId, depth} \| null`) | **Local mirror** (`DisplayLinkProvenance` in `types.ts`). | Tiny, stable object shape; re-declaring it lets `DisplayLink.provenance` be a real type instead of `unknown`, per the charter's "use exact project types" instruction, at negligible drift risk. |

Every mirrored constant carries a doc comment citing exactly this reasoning
and pointing at the canonical source, using the SAME manual-sync discipline
`apps/web/src/components/graph/types.ts` already established for its own
cross-package mirrors (`RELATIONSHIP_CATEGORY_TO_EDGE_TYPE`'s doc comment:
*"Kept in sync manually — apps/web cannot import from apps/worker"*;
`CONCEPT_KINDS` mirrors a DB enum the same way). This package is applying an
existing, precedented pattern, not inventing a new one.

For genuine completeness/testability, `bands.ts` and `state.ts` ALSO ship a
tested **default** mirror of `NodeType`/`NodeState` (`CanonicalNodeTypeMirror`
/`CanonicalNodeStateMirror` in `kinds.ts`) so every totality test in this
package's suite has something concrete to exercise, and so an
unparameterized caller gets useful behavior out of the box — but every
function that uses it accepts an override callback, so a real integration
can always supply the actual canonical mapping instead.

## Edge-value audit — two gaps the charter's own tables didn't cover

Before writing `families.ts`'s mapping table, this package's implementation
grepped every write site that ends up in a canonical `GraphLink.edgeType`
(`apps/web/src/lib/graph.ts`, `apps/web/src/lib/graphDebate.ts`,
`apps/worker/src/analyze.ts`, `packages/db/src/schema.ts`'s `edgeTypeEnum`)
rather than assuming the charter's own "Required edge-type mapping" bullets
were already complete. They were not, in one specific way:
`apps/worker/src/analyze.ts` writes `editionRelations.relationType` (a
free-text column) directly from the classifier's raw 10-value
`RelationshipCategory` output, and `apps/web/src/lib/graph.ts` then reads
that column straight into `GraphLink.edgeType` — unlike the
citation/passage-annotation/resource-role write paths, which normalize
through `edgeTypeForRelationshipCategory` into the 14-value DB enum first.
That means **`optional_extension` and `ai_inferred` can both appear as
literal `edgeType` values**, not only as `category` values. Neither appears
in the charter's edge-type-mapping bullets (only in its higher-level
relationship-category table). `families.ts`'s module doc comment has the
full detail; `EDGE_VALUE_FAMILY` folds both into the family the
relationship-category table already assigns them (`optional_extension` →
Reference, `ai_inferred` → the documented, cited `influence` fallback),
rather than letting them fall through to the keyword-heuristic silent
default the CURRENT `edgeFamilyFor()` has for exactly this gap.

`families.test.ts`'s `ALL_EMITTED_EDGE_VALUES` fixture (`testFixtures.ts`)
is the audited value list itself, asserted to classify into a real family
(never `"unclassified"`) as a group.

## Aggregate nodes have no static layer, by design

`bands.ts`'s `DISPLAY_ONLY_KIND_LAYER` covers every `DisplayOnlyKind`
**except** `"aggregate"`, and `layerForDisplayKind("aggregate")` throws a
typed `AggregateLayerLookupError` rather than returning a fixed default. An
aggregate node summarizes a specific, layer-homogeneous group of hidden
nodes (`disclosure.ts`'s `buildAggregateNodes` groups strictly by
`displayKind`, so every group shares one layer by construction) — modeling
"aggregate → some fixed layer" would be actively wrong (an aggregate of
hidden claims and an aggregate of hidden sources belong in different
bands). The real layer is always assigned directly from the basis group at
aggregate-creation time; `bands.test.ts` and `disclosure.test.ts` both cover
this split (one proves the exclusion/throw is intentional, the other proves
the real assignment happens correctly).

## URL state (Stage 3): what's restorable, what's ephemeral, what's translated

Five new files (`omission.ts`, `urlState.ts`, `urlStateCodec.ts`,
`reconstruct.ts`, `legacyGraphUrl.ts`, plus the standalone
`askLibraryDeepLink.ts`) implement charter §9's URL-state requirements as
pure functions over `URLSearchParams`, with zero coupling to any router,
history API, or React state — a caller (out of scope here, same as every
other renderer-facing concern this package deliberately stays out of)
reads/writes the actual address bar and calls into these functions with
plain strings.

- **Schema vs. wire format vs. reconstruction vs. legacy translation are
  four separate files**, not one, because they are four separable
  concerns with different failure modes: the schema (`urlState.ts`) can
  never be "wrong," only incomplete; the codec (`urlStateCodec.ts`) can
  fail to round-trip; reconstruction (`reconstruct.ts`) can produce a
  state that no longer matches the live authorization/data reality; legacy
  translation (`legacyGraphUrl.ts`) can misinterpret an old URL. Testing
  each in isolation (see each file's own `.test.ts`) is more precise than
  one large "URL state" module would allow.
- **Camera is not modeled anywhere in this package.** Charter §9,
  verbatim: "Camera coordinates remain ephemeral. Home is deterministic."
  `GraphUrlState` has no camera field, `urlStateCodec.ts` never reads or
  writes one, and no reconstruction path derives one — a renderer always
  computes its own deterministic default framing for whatever context/
  focus state it's given, never a restored prior camera pose.
- **`OmittedReason` is a closed, shared vocabulary** (`omission.ts`), not
  a free-text string, so both the new-URL reconstruction path and the
  legacy-URL translation path report omissions in one consistent shape a
  caller can render one UI for ("This item is no longer available" /
  "You don't have access to this" / etc.) regardless of which path
  produced it.
- **Every array-valued piece of state (`activeLayers`, `expansionTrail`,
  legacy's repeated `roadmapRoot`/`pinnedWork`) is carried as REPEATED
  `URLSearchParams` entries, never comma-joined.** A display/canonical id
  is an opaque string this package does not control the character set
  of — joining ids with a delimiter character risks that exact character
  appearing inside a real id. This mirrors the existing codebase's own
  convention for `pinnedWork`/`roadmapRoot` (baseline audit §8).
- **`translateLegacyGraphUrl` never throws**, by construction: every
  lookup goes through `params.get`/`getAll` (never index into an array
  that might be empty), every id transformation is a total string
  function, and every caller-supplied validity check returns a reason
  rather than throwing its own error. `legacyGraphUrl.test.ts`'s
  "malformed and hostile inputs" suite exercises this directly (SQL/path-
  traversal-shaped junk ids, a 200-entry `roadmapRoot` set, mixed legacy +
  new-style params, non-ASCII/emoji values) rather than only asserting it
  on well-formed compat-table inputs.

## File map

| File | Charter item |
|---|---|
| `ids.ts` / `ids.typecontract.ts` | Item 6 — branded `DisplayNodeId`/`DisplayLinkId`/`CanonicalNodeId`/`CanonicalLinkId`, plus the compile-time-only contract proof (checked by `pnpm typecheck`, not `vitest run` — see that file's own doc comment). |
| `kinds.ts` | Item 1/3 — `DisplayKind`, `CanonicalNodeTypeMirror`, `SourceEntityKind` (a new type this package owns, grounded in the baseline audit's data-source matrix). |
| `layers.ts` | Item 2 — the six-band `Layer` union and its fixed `-2..3` index. |
| `state.ts` | `NodeState` → `unavailableReason` projection (see "Type provenance" above). |
| `types.ts` | Item 1 — `DisplayNode`, `DisplayLink`, `DisplayEdgeFamily`. |
| `bands.ts` | Item 2 — `computeBandGap`, jitter, `layerForDisplayKind`. |
| `families.ts` | Item 3 — the exhaustive, audited edge-family mapping; `ai_inferred` provenance overlay; "unsupported direction" validation. |
| `disclosure.ts` | Item 4 — prioritized initial neighborhood, expansion, visible caps, deterministic aggregation. |
| `validate.ts` | Item 5 — structural diagnostics (duplicate ids, dangling endpoints, self-links, parallel links) and canonical-input immutability helpers. |
| `omission.ts` | Shared `OmittedReason`/`OmittedEntry`/`ValidityCheck` vocabulary — "ignore unauthorized/deleted/invalid ids, announce why" (charter §9), used by both `reconstruct.ts` and `legacyGraphUrl.ts`. |
| `urlState.ts` | Charter §9 "Make the following URL state restorable" — the `GraphUrlState` schema (context, view, selection, layers, filters, expansion trail, focus) and its total-function type guards. Camera is deliberately absent (module doc comment). |
| `urlStateCodec.ts` | `serializeGraphUrlState`/`parseGraphUrlState` — the `GraphUrlState` <-> `URLSearchParams` wire format, designed for exact round-trip identity (see `urlState.test.ts`'s seeded generator suite). |
| `reconstruct.ts` | Charter §9 "Reconstruction rules" as pure functions — `rebuildContext`, `replayExpansionTrail`, `reconcileSelectedId`, `recreateAggregatesFromBasis` (never accepts a stale count — see its own doc comment), composed into `reconstructGraphUrlState`. |
| `legacyGraphUrl.ts` | Charter §9 "Legacy graph URL compatibility" table — `translateLegacyGraphUrl`, a discriminated `redirect \| state \| chooser` union that never throws on malformed input. Two interpretive decisions the charter's own text leaves open are documented at the top of the file (what `layout=explore` means for `GraphUrlState`'s required `context`, and what a genuinely bare `/graph` resolves to). |
| `askLibraryDeepLink.ts` | Charter §9's closing paragraph — `mode`/`claimId`/`clusterId`/`workIdB` parse/serialize helpers. Placed here rather than in a new file elsewhere because the charter states this requirement inside §9 itself, and `claimId`/`clusterId` name the same entities `GraphUrlContext`'s `"claim"`/`"debate"` context kinds already cover — see the module's own doc comment for the full reasoning. Does NOT implement the single-controller mount rule itself (out of scope for a zero-React package); only the URL state a real controller reads. |
| `testFixtures.ts` | Shared, non-exported test fixtures — including the audited `ALL_EMITTED_EDGE_VALUES` list. |

## Usage sketch (illustrative — no real caller exists yet)

```ts
import {
  classifyEdgeFamily,
  layerForDisplayKind,
  initialNeighborhood,
  buildAggregateNodes,
  validateDisplayGraph,
  deepFreeze,
  toDisplayNodeId,
} from "@ice/graph-display";
import type { NodeType, GraphLink } from "@/components/graph/types"; // apps/web, illustrative

// A real caller would instantiate the generics with apps/web's own types:
const layer = layerForDisplayKind<NodeType>("work", (t) => canonicalLayerFor(t));
const family = classifyEdgeFamily(link.edgeType, link.category);
```
