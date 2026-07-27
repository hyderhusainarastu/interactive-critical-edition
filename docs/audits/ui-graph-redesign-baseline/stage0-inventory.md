# Stage 0 Current-State Inventory — Palimnote UI/Graph Redesign

Read-only audit. All claims cite file:line. Repo root: `/Users/hyderhusainarastu/Project/AutoCriticalEditionProject`.

---

## 1. Signed-in route inventory

Route groups: `(app)` = signed-in (guarded centrally by `apps/web/src/app/(app)/layout.tsx:24` calling `requireSession()`, plus most individual pages call `requireSession()`/`getApiUserId()` again as belt-and-suspenders — see `apps/web/src/app/(app)/layout.tsx:12-18` comment); `(auth)` = public; `admin-dash` = separate cookie-based admin auth (not the normal user session); top-level `page.tsx`/`privacy`/`terms`/`development` = public marketing site.

### (app) — signed-in, gated by `requireSession()` in the shared layout

| Path pattern | Gate | Purpose |
|---|---|---|
| `/account` | signed-in | Redirect/index stub (`apps/web/src/app/(app)/account/page.tsx:1`) |
| `/account/plan` | signed-in | Decorative usage-meter/plan page, no real caps enforced (`apps/web/src/app/(app)/account/plan/page.tsx` comment) |
| `/account/profile` | signed-in | Profile fields, danger-zone delete (`apps/web/src/app/(app)/account/profile/page.tsx:2`) |
| `/account/usage` | signed-in | Personal AI usage/cost history (`apps/web/src/app/(app)/account/usage/page.tsx:2`) |
| `/admin` | signed-in + admin-email-gated (404 otherwise) | Platform counts, AI cost/usage, processing-job health (`apps/web/src/app/(app)/admin/page.tsx` comment) |
| `/ask-library` | signed-in, `phase18RagEnabled()`-gated (404) | Standalone Ask Library / RAG chat page (`apps/web/src/app/(app)/ask-library/page.tsx:21-27`) |
| `/dashboard` | signed-in | Light cross-cutting overview + onboarding redirect (`apps/web/src/app/(app)/dashboard/page.tsx` comment) |
| `/graph` | signed-in | Global (all-works) knowledge graph — 3D + accessible table (`apps/web/src/app/(app)/graph/page.tsx:2-3`) |
| `/library` | signed-in | Recommended/discovered sources across all owned works (`apps/web/src/app/(app)/library/page.tsx` comment) |
| `/library/[resourceId]` | signed-in, ownership-gated | One Library entry detail incl. "Upload source text" (`apps/web/src/app/(app)/library/[resourceId]/page.tsx` comment) |
| `/research` | signed-in, `phase25FeatureEnabled("research")`-gated (404) | Research projects list (`apps/web/src/app/(app)/research/page.tsx`) |
| `/research/[projectId]` | signed-in, research-flag-gated | One research project overview (`apps/web/src/app/(app)/research/[projectId]/page.tsx`) |
| `/research/[projectId]/claims` | signed-in, research-flag-gated | Project's extracted claims list (`apps/web/src/app/(app)/research/[projectId]/claims/page.tsx`) |
| `/research/[projectId]/corpus` | signed-in, research-flag-gated | Corpus-import UI, Phase 30 fix lane (`apps/web/src/app/(app)/research/[projectId]/corpus/page.tsx` comment) |
| `/research/[projectId]/debates` | signed-in, research-flag-gated | Project's debate clusters list (`apps/web/src/app/(app)/research/[projectId]/debates/page.tsx`) |
| `/research/[projectId]/debates/[clusterId]` | signed-in, research-flag-gated | One debate cluster detail (`apps/web/src/app/(app)/research/[projectId]/debates/[clusterId]/page.tsx`) |
| `/research/[projectId]/hypotheses` | signed-in, research-flag-gated | Project hypotheses & gaps (`apps/web/src/app/(app)/research/[projectId]/hypotheses/page.tsx`) |
| `/research/[projectId]/monitors` | signed-in, research+monitoring-flag-gated | Project-scoped monitors (`apps/web/src/app/(app)/research/[projectId]/monitors/page.tsx`) |
| `/research/chambers/[chamberId]` | signed-in, research-flag-gated | One Evidence Chamber detail (`apps/web/src/app/(app)/research/chambers/[chamberId]/page.tsx`) |
| `/research/claims/[claimId]` | signed-in, research-flag-gated | One claim permalink/detail (`apps/web/src/app/(app)/research/claims/[claimId]/page.tsx`) |
| `/research/monitors` | signed-in, research+monitoring-flag-gated | Global (cross-project) monitors view (`apps/web/src/app/(app)/research/monitors/page.tsx:1-4`) |
| `/upload` | signed-in | Upload flow entry point |
| `/welcome` | signed-in | Optional onboarding (reader-level pick, skippable) (`apps/web/src/app/(app)/welcome/page.tsx` comment) |
| `/works` | signed-in | The reader's own uploads list (`apps/web/src/app/(app)/works/page.tsx` comment) |
| `/works/[workId]` | signed-in, ownership | One work's detail/overview page |
| `/works/[workId]/curriculum` | signed-in, ownership | Curriculum / study-guide view |
| `/works/[workId]/diagnostic` | signed-in, ownership | Reader-level diagnostic quiz for one work |
| `/works/[workId]/graph` | signed-in, ownership | Work-scoped knowledge graph |
| `/works/[workId]/reader` | signed-in, ownership | The Interactive Reader / Published Edition view |
| `/works/[workId]/roadmap` | signed-in, ownership | Personalized reading roadmap for one work |
| `/works/trash` | signed-in | Soft-deleted works list + restore/purge |
| `/writer/[projectId]` | signed-in, `phase12FeatureEnabled("writer")`-gated | One Writer document/project editor |
| `/writer` | signed-in, writer-flag-gated | Writer projects list |

### (auth) — public

| Path | Purpose |
|---|---|
| `/login` | Sign in |
| `/reset-password` | Password reset completion |
| `/signup` | Registration (blocked entirely when `isBetaTestingMode()` is on) |
| `/verify-email` | Email verification landing |

### admin-dash — separate cookie-based admin auth (`requireAdminDash()`/`isAdminDashAuthed()`, `apps/web/src/lib/adminDash.ts`), NOT the normal signed-in user session

| Path | Gate | Purpose |
|---|---|---|
| `/admin-dash` | `requireAdminDash()` | Dashboard index (`apps/web/src/app/admin-dash/(dash)/page.tsx`) |
| `/admin-dash/feedback` | `requireAdminDash()` | Feedback review |
| `/admin-dash/users` | `requireAdminDash()` | Users list |
| `/admin-dash/users/[id]` | `requireAdminDash()` | One user's detail |
| `/admin-dash/login` | unguarded (deliberately — the one login page, `apps/web/src/app/admin-dash/login/page.tsx` comment) | Admin login form, never linked from nav/footer |

### Public marketing site (no `(app)` wrapper)

| Path | Purpose |
|---|---|
| `/` | Landing page (`apps/web/src/app/page.tsx`) |
| `/privacy` | Privacy policy |
| `/terms` | Terms |
| `/development` | Public "development timeline" page, own `site-theme.css`/`development.css` (`apps/web/src/app/development/page.tsx:1-9`) |

### API routes — counted by family (89 total `route.ts` files)

| Family (`/api/<family>/...`) | Count |
|---|---|
| `works` | 34 |
| `research` | 20 |
| `writer` | 13 |
| `auth` | 5 |
| `graph` | 4 |
| `rag` | 3 |
| `library` | 2 |
| `admin-dash` | 2 |
| `usage-event` | 1 |
| `reader-level` | 1 |
| `preferences` | 1 |
| `feedback` | 1 |
| `command-menu` | 1 |
| `admin` | 1 |

---

## 2. Feature flags (`packages/config/src`)

All flags follow one convention: **release controls, not authorization controls** — every gated route still performs its own auth/ownership check regardless of flag state (stated explicitly in each file's doc comment). Env-var parsing accepts `1/true/yes/on` and `0/false/no/off` (case-insensitive), unset → default.

| Flag key | Env var | Default | Gates | Source |
|---|---|---|---|---|
| `foundation` | `PHASE_12_FOUNDATION_ENABLED` | `true` | Phase 12 foundation | `packages/config/src/phase12.ts:7` |
| `libraryIdentity` | `PHASE_12_LIBRARY_IDENTITY_ENABLED` | `false` | Library canonical-identity features | `packages/config/src/phase12.ts:8` |
| `pipelineV4` | `PHASE_12_PIPELINE_V4_ENABLED` | `false` | v4 edition pipeline | `packages/config/src/phase12.ts:9` |
| `interactiveReader` | `PHASE_12_INTERACTIVE_READER_ENABLED` | `false` | Interactive Reader mode | `packages/config/src/phase12.ts:10` |
| `crossLibraryGraph` | `PHASE_12_CROSS_LIBRARY_GRAPH_ENABLED` | `false` | Cross-library graph edges (`workRelationshipJudgments`) | `packages/config/src/phase12.ts:11` |
| `writer` | `PHASE_12_WRITER_ENABLED` | `false` | `/writer` nav item + routes | `packages/config/src/phase12.ts:12` |
| `phase18RagEnabled()` (single function, no key) | `PHASE_18_RAG_ENABLED` | `false` | `/ask-library`, reader RAG panel, `GlobalRagSidebar` nav item | `packages/config/src/phase18.ts:6-9` |
| `isBetaTestingMode()` (single function) | `BETA_TESTING_MODE` | `false` | Blocks signup, shows beta badge | `packages/config/src/betaTesting.ts:8-11` |
| `enabled` (Phase 22 competency) | `PHASE_22_COMPETENCY_ENABLED` | `false` | Whole conversational-competency-designation feature | `packages/config/src/phase22.ts:17` |
| `providerEnabled` (Phase 22 competency) | `PHASE_22_COMPETENCY_PROVIDER_ENABLED` | `false` | Gated structured-model-call tier (implies `enabled` too) | `packages/config/src/phase22.ts:18` |
| `research` | `PHASE_25_RESEARCH_ENABLED` | `false` | `/research/*` routes + API | `packages/config/src/phase25.ts:27` |
| `readerClaimLayer` | `PHASE_25_READER_CLAIM_LAYER_ENABLED` | `false` | Reader Claims tab + in-text claim markers | `packages/config/src/phase25.ts:28` |
| `graphDebateLayer` | `PHASE_25_GRAPH_DEBATE_LAYER_ENABLED` | `false` | `claim`/`debate` graph nodes + expansion route | `packages/config/src/phase25.ts:29` |
| `writerEvidence` | `PHASE_25_WRITER_EVIDENCE_ENABLED` | `false` | Writer evidence panel + claim-backed citations | `packages/config/src/phase25.ts:30` |
| `askResearchModes` | `PHASE_25_ASK_RESEARCH_MODES_ENABLED` | `false` | Ask Library per-message research modes | `packages/config/src/phase25.ts:31` |
| `monitoring` | `PHASE_25_MONITORING_ENABLED` | `false` | Scheduled corpus/citation/author monitors | `packages/config/src/phase25.ts:32` |
| `humanitiesJudge` | `PHASE_25_HUMANITIES_JUDGE_ENABLED` | `false` | Interpretive judge branch (stays off — gated by design, D-25-11) | `packages/config/src/phase25.ts:33` |

Also: `ANALYSIS_PIPELINE` (`packages/config/src/pipeline.ts:15-20`) — not a boolean flag but an ordered pipeline-version selector (`v1|v2|v3|v4`, default `v1` if unset/unrecognized).

**Where production state is documented:** `docs/PROJECT-LOG.md`'s "Credentials, Environment Variables, and External Services" section and per-phase changelog entries state which flags are live in Vercel production (e.g. all five Phase 12/18 flags confirmed `true` in production per the 2026-07-22 changelog entry; Phase 25 flags enabled in production per the 2026-07-26 changelog entry) — not the code itself. COULD NOT VERIFY current live Vercel env-var values directly (would require a production read I did not perform, per this audit's read-only/no-production-access scope).

---

## 3. Graph data contract

All types live in `apps/web/src/components/graph/types.ts` (doc comment at `:16-23` calls this "THE graph data contract"). The payload builder is `buildGraph()` in `apps/web/src/lib/graph.ts:253`, with additive extension from `apps/web/src/lib/graphDebate.ts` (debate layer, flag-gated).

### `NodeType` (`apps/web/src/components/graph/types.ts:14`)
```
"work" | "reference" | "peer_reviewed_source" | "online_source" | "concept" | "person" | "section" | "claim" | "debate"
```
9 values. `claim`/`debate` are additive (Phase 28.4, behind `graphDebateLayer`); `claim` is never emitted by the base payload, only by the per-cluster expansion route (comment at `:5-13`).

### `NodeState` (`apps/web/src/components/graph/types.ts:4`)
```
"primary" | "read" | "reading" | "unread" | "missing" | "structural"
```
6 values. Meta/labels at `STATE_META` (`:275-285`), display order at `STATE_ORDER` (`:287`).

### `GraphNode` interface — full shape at `apps/web/src/components/graph/types.ts:24-164`. Key fields:
- `id`, `label`, `type`, `state`, `uploaded`, `associatedWorkIds`, `destination` (`:26-45`)
- `authors`, `year`, `url` (`:47-49`)
- v2 research enrichment: `authority`, `credibilityScore`, `provider`, `providers` (`:50-56`)
- `kind` (concept_kind), `accessStatus`, `sourceTextStatus`, `license`, `sourceUrl`, `provenance`/`provenances` (`:57-67`)
- `supplementary` (`:69`)
- `roadmap?: RoadmapAnnotation` — absent on explore-mode payloads, present only in roadmap-mode projection (`:70-81`)
- **Data contract v2 additive fields** (`:83-138`): `readerLevels?: string[]` (union of `resource_role.reader_level`, absent = "no scoping data", never "matches nothing"), `workRole?`, `credibility?` (6-dimension dossier object, see below), `masteryScore?`, `summary?`, `aliases?`, `venue?`, `doi?`
- **Debate layer additive fields** (`:140-163`): `debateClaimCount?`, `debateQuestion?` (debate nodes only), `claimNature?`, `valenceSummary?` (claim nodes only, from expansion route)

### `GraphLink` interface (`apps/web/src/components/graph/types.ts:198-225`)
```ts
{
  id: string;            // `source|edgeType|target`
  source: string;
  target: string;
  edgeType: string;
  directed: boolean;      // via isDirectedEdgeType()
  associatedWorkIds: string[];
  category: string | null;
  confidence: number;
  explanation?: string | null;
  evidence?: unknown;
  provenance?: { relationId: string; runId: string; depth: number } | null;
  evidences?: unknown[];
  provenances?: { relationId; runId; depth }[];
  readerLevel?: string | null;   // v2 additive, promoted from evidence.readerLevel
}
```

### `EdgeFamily` (`apps/web/src/components/graph/types.ts:325`)
```
"reference" | "influence" | "opposition" | "structural" | "prerequisite"
```
5 values, order `EDGE_FAMILY_ORDER` (`:335`), display meta `EDGE_FAMILY_META` (`:327-333`). Mapping table `EDGE_TYPE_FAMILY` (`:347-398`) is an EXPLICIT enumeration (not a keyword heuristic) of every edge-type string the payload can emit, per the comment at `:337-346` citing plan §21.5's audit finding about the old keyword-only matcher silently mis-bucketing several strings.

### Full edge-type strings actually EMITTED by `buildGraph()`/`graphDebate.ts` (exhaustive, grep-verified against every emission site)

From the 14-value DB `edge_type` enum (`packages/db/src/schema.ts:501-516`), read directly off `graph_edge` rows and passed through unmodified at `apps/web/src/lib/graph.ts:801-807` (references) and `:808-814` (concepts):
```
cites, quotes, influences, criticizes, responds_to, presupposes,
provides_context_for, interprets, disagrees_with, translates,
is_edition_of, is_prerequisite_for, is_comparable_to, is_recommended_by
```

Synthetic/derived edge-type strings emitted by `buildGraph()` itself (never DB enum values):
- `outline_section` — synthetic work→section outline edge, never persisted (`apps/web/src/lib/graph.ts:821`, doc comment `:44-45`)
- `discovered_source` — default for a `sourceRows` edge when no explicit `edition_relation` exists (`apps/web/src/lib/graph.ts:831`)
- Whatever `edition_relation.relation_type` actually holds, when a direct relation does exist (`apps/web/src/lib/graph.ts:831`, e.g. `review_of`/`translation_of`/`edition_of`/`excerpt_of`/`responds_to`/`translates`/`is_edition_of`/`is_comparable_to` per the `EDGE_TYPE_FAMILY` comment `:337-343`)
- Whatever `resourceRelations` (`edition_relation`) between two `research_resource` rows holds, passed through unmodified (`apps/web/src/lib/graph.ts:843`)
- `edgeTypeForRelationshipCategory(role.relationship)` output for `resource_role` rows (`apps/web/src/lib/graph.ts:857`) — maps the 10-value `relationship_category` enum through `RELATIONSHIP_CATEGORY_TO_EDGE_TYPE` (`apps/web/src/components/graph/types.ts:423-434`) into one of: `cites, is_recommended_by, provides_context_for, is_prerequisite_for, influences, disagrees_with, interprets, is_comparable_to` (8 distinct target strings for the 10 categories, since `optional_extension`→`is_recommended_by` and `ai_inferred`→`provides_context_for` both collide with another category's mapping)
- Same `edgeTypeForRelationshipCategory()` mapping again for `passage_annotation` rows (`apps/web/src/lib/graph.ts:778`)
- Whatever `workRelationshipJudgments.relationshipType` holds, passed through unmodified for the cross-library (non-work-scoped) graph only (`apps/web/src/lib/graph.ts:907`, category always `"cross_library"`)

Debate layer (`apps/web/src/lib/graphDebate.ts`, behind `graphDebateLayer` flag):
- `in_debate` — work→debate cluster edge (`apps/web/src/lib/graphDebate.ts:139`)
- `asserts_claim` — work→claim edge, expansion route only (`apps/web/src/lib/graphDebate.ts:275`)
- `claim_contradicts`, `claim_supports`, `claim_nuances` — claim↔claim edges via `VALENCE_EDGE_TYPE` mapping (`apps/web/src/lib/graphDebate.ts:169-173`, `:286`)

**Undirected edge types** (`UNDIRECTED_EDGE_TYPES`, `apps/web/src/components/graph/types.ts:261-267`): `is_comparable_to`, `parallel_comparison` (legacy — not actually in the 14-value enum, appears to be a category-string leftover; COULD NOT VERIFY a live emission site producing literal `parallel_comparison` as an `edgeType`, only as a `relationship_category` value which gets mapped to `is_comparable_to` before reaching `GraphLink.edgeType`), `claim_contradicts`, `claim_supports`, `claim_nuances`.

### `relationship_category` — the 10-value enum

Defined once at `packages/db/src/schema.ts:461-472` (`relationshipCategoryEnum`):
```
explicit_reference, secondary_scholarly_recommendation, historical_context,
prerequisite, conceptual_influence, disagreement_polemical_target,
interpretive_aid, parallel_comparison, optional_extension, ai_inferred
```
The TypeScript-side `RelationshipCategory` type is re-exported from `@ice/roadmap` (imported at `apps/web/src/components/graph/types.ts:2`); I confirmed this exact 10-string list is what `RELATIONSHIP_CATEGORY_TO_EDGE_TYPE` (`apps/web/src/components/graph/types.ts:423-434`) keys on. COULD NOT VERIFY the literal `RelationshipCategory` type declaration site inside `packages/roadmap/src` (grep for `RelationshipCategory` in that package's own files returned no match in this session — it may be inferred/re-exported from a `pgEnum`'s inferred TS type rather than declared as a standalone `type` statement; not chased further as it doesn't change the enumerated value list already confirmed at the DB-schema source of truth).

### Where destinations/provenance/credibility/mastery attach to nodes

- **`destination`**: computed once in the finalization pass (`apps/web/src/lib/graph.ts:977-979`) — `/works/<id>` for the reader's own uploaded work nodes, `/library/<learningResourceId>` only when a `resource_role` ownership-gate would actually resolve it (via `libraryDestinationByNodeId`, populated at `:636, :652, :738`), else `null`. Never a guessed route (comment `apps/web/src/lib/graph.ts:504-506`).
- **`provenance`/`provenances`**: attached per external source node from the `resource_provenance` LATERAL join (`apps/web/src/lib/graph.ts:407-413`, `:668-672`) and merged across providers in `mergeExternal()` (`apps/web/src/lib/graph.ts:586-587, :617-618`).
- **`credibility`**: built by `credibilityFromAssessment()` (`apps/web/src/lib/graph.ts:222-251`) from a `credibility_assessment` row's 6 separated dimensions (`publication_rigor, creator_expertise, host_provenance, pedagogical_value, relevance, evidence_strength`) plus `peer_reviewed`/`rationale`/`creator`/`popularity`; attached to reference nodes (`:642`), source nodes (`:667`), and backfilled onto role-only nodes from a narrower `learning_resource`-only dossier when no `credibility_assessment` row exists (`:705-712`). Dimension key list + labels: `CREDIBILITY_DIMENSIONS`/`CREDIBILITY_DIMENSION_LABEL` (`apps/web/src/components/graph/types.ts:550-566`). Banding: `credibilityBandFor()` (`:600-605`, high ≥0.75, medium ≥0.45, else low, `unknown` when null).
- **`masteryScore`**: attached only to concept/person nodes from `concept_mastery` (`apps/web/src/lib/graph.ts:742-748`), raw 0–100, distinct from `state` (which only expresses read/known at `KNOWN_THRESHOLD`).
- **`readerLevels`**: the ONE place this union is computed, `addReaderLevel()` closure (`apps/web/src/lib/graph.ts:694-700`), populated by every `resource_role` row targeting a node (`:704`), finalized sorted at `:982`.

---

## 4. Design tokens (`apps/web/src/app/globals.css`)

Also present: `apps/web/src/app/site-theme.css` (public marketing-site-only `.pal-site`-scoped palette — NOT read in this pass beyond one cross-reference at `globals.css:461-470` re: the shared `Mark`/wordmark glyph; COULD NOT VERIFY whether its token values are identical to or diverge from `globals.css`'s app palette, this file was not opened) and `apps/web/src/app/development/development.css` (public dev-timeline page only, not opened).

### Core palette (`:root`, `globals.css:20-141`, light default; no `prefers-color-scheme` auto-flip by design, comment `:6-11`)
| Token | Light value | Dark value (`:root[data-theme="dark"]`) |
|---|---|---|
| `--color-background` | `#fbf9f4` | `#10171e` |
| `--color-surface` | `#f4f0e7` | `#16202a` |
| `--color-text` | `#172838` | `#f2f6f9` |
| `--color-text-muted` | `#5f6870` | `#a7b6c2` |
| `--color-border` | `#d7d0c3` | `#2d3d4a` |
| `--color-accent-burgundy` | `#7a3f48` | `#e0a3ac` |
| `--color-accent-green` | `#3e5d52` | `#8fc4a8` |
| `--color-accent-ink` | `#263a4f` | `#e9eff4` |
| `--color-accent-umber` | `#765641` | `#d3ab86` |
| `--color-highlight` (gold/ochre) | `#b48a47` | `#dcbd7f` |
| `--color-surface-sunken` | `#eee8dd` | `#202c37` |
| `--color-surface-strong` | `#263a4f` | `#4a6f93` |
| `--color-surface-strong-fg` | `#ffffff` | `#ffffff` |

There is also an explicit `:root[data-theme="light"]` block (`globals.css:182-208`) duplicating the `:root` defaults, so the OS/media-query default and the explicit light toggle state agree byte-for-byte.

### Status/functional tokens
| Token | Light | Dark | Purpose |
|---|---|---|---|
| `--color-credibility-critical` | `#b3261e` | `#ff6b5e` | Credibility alerting, "critical" band |
| `--color-credibility-warning` | `#a8630a` | `#f0a94e` | Credibility alerting, "warning" band |
| `--color-beta-badge` | `#91540a` | `#f0a94e` | Split from `--color-credibility-warning` for contrast (comment `:72-83`) |
| `--color-status-highlight-text` | `#8a6423` | `#dcbd7f` | Split from `--color-highlight` for gold-text contrast (comment `:85-94`) |
| `--color-graph-dim-text` | `#726a5c` | `#968e7c` | Graph accessible-table dimmed-row text (comment `:96-104`) |
| `--color-graph-backdrop` | `#0d1420` | `#05080c` | 3D canvas "astronomical plate" backdrop, deliberately theme-independent-dark (comment `:106-119`) |
| `--color-graph-node-gold` | `#e8b968` | `#f0c47c` | Uploaded/pinned/next-up ring accent |
| `--color-graph-node-wireframe` | `#a37e7e` | `#c99b9b` | Missing (referenced-not-acquired) node stroke |
| `--color-graph-node-ring-lit` | `#f2ead9` | `#fdf8ee` | Credibility ring lit segments |
| `--color-graph-claim` | `#5b7c8f` | `#8db3c4` | Phase 28.4 debate layer claim-node color |
| `--color-focus-ring` | `#263a4f` | `#e9eff4` | `:focus-visible` outline |

### Typography scale
- Font stacks via `@theme inline` (`globals.css:439-459`): `--font-sans` = Geist Sans (`var(--font-geist-sans)`), `--font-mono` = Geist Mono, `--font-serif` = `Georgia, "Times New Roman", serif` (system stack, no webfont fetch, for headings — matches public landing per comment `:454-458`).
- Font-size scale via `data-font-size` attribute (`:210-212`): `small` → `--app-font-scale: 0.94`, `medium` → `1`, `large` → `1.12`, applied to `body { font-size: calc(1rem * var(--app-font-scale, 1)) }` (`:499`).
- Reading-width scale via `data-reading-width` (`:213-215`): `compact` → `58ch`, `comfortable` → `72ch`, `wide` → `88ch` (`--reading-measure`).

### Motion tokens
- `--spring-fast: cubic-bezier(.2, .8, .2, 1)`, `--spring-gentle: cubic-bezier(.22, 1, .36, 1)` (`:133-134`).
- `.app-reveal` (`:729-733`): scroll-triggered entrance (`data-reveal-ready`/`data-revealed` attrs + IntersectionObserver elsewhere), gated entirely inside `@media (prefers-reduced-motion: no-preference)`.
- `.app-control` (`:703-707`): shared hover/focus transition vocabulary for interactive surfaces (border-color/background/color/box-shadow transitions).
- `:root[data-motion="reduced"] *` blanket override (`:752`): forces `animation: none !important; transition: none !important` app-wide — the in-app motion toggle, independent of/redundant with the OS-level `prefers-reduced-motion: reduce` media query (`:484-493`).
- Additional motion vocabularies layered on the same two primitives (not a second system, per comments): `.app-panel-enter` (modals/drawers, `:806-809`), `.rag-chat-*` (streaming/turn-taking, `:820-831`), `.chart-*` (hand-rolled SVG chart draw-in, `:878-918`).

### Where dark-theme tokens live
All in `apps/web/src/app/globals.css` itself — no separate `dark.css`/theme file. `:root[data-theme="dark"]` block at `:143-180`; `:root[data-theme="light"]` explicit-light block at `:182-208`. The runtime attribute (`data-theme`) is set by the workspace-preferences theme control (`AppShell.tsx`'s Light/Dark quick-switch, `apps/web/src/components/app/AppShell.tsx:234-237`) — COULD NOT VERIFY the exact DOM-attribute-setting call site (likely inside `WorkspacePreferencesProvider.tsx`/`PreferenceBootstrap`, not opened this pass).

---

## 5. Shell (signed-in)

### Components
- **`apps/web/src/components/app/AppShell.tsx`** — the whole signed-in chrome: header/masthead (`:210-291`), primary nav (`:224-226`, `navItems` built at `:109-119` conditionally including Ask Library/Writer/Research/Admin per flags), mobile drawer (`MobileDrawer`, `:313-357`), workspace-preferences popover (`PreferencesMenu`, `:359-405`), focus-mode exit affordance (`:197`), theme quick-switch (`:234-237`), the RAG-sidebar trigger button (`:253-270`), and the profile-menu trigger (`:271-287`).
- **`apps/web/src/components/app/AppFooter.tsx`** — footer (not opened this pass; referenced at `AppShell.tsx:301,16`). COULD NOT VERIFY its exact contents/links.
- **`apps/web/src/components/app/CommandPalette.tsx`** — the command palette (⌘K). Mounted once at shell level (`AppShell.tsx:302`), items = the same `navItems` list, opened via a `window.dispatchEvent(new CustomEvent("palimnote:open-command-palette", ...))` from the header's search icon-button (`AppShell.tsx:229`). Backing API route: `apps/web/src/app/api/command-menu/route.ts`.
- **`apps/web/src/components/app/ProfileMenu.tsx`** — account-menu popover content (referenced `AppShell.tsx:19,286`, not opened this pass).
- **`apps/web/src/components/app/WorkspacePreferencesProvider.tsx`** — React context provider wrapping the whole shell (`AppShell.tsx:69`), exposing `preferences`/`updatePreferences`.

### Nav destinations (signed-in primary nav, `AppShell.tsx:109-119`)
Always: Dashboard, Visualization (`/graph`), Works, Library, Upload.
Conditional: Ask Library (`ragEnabled`), Writer (`writerEnabled`), Research (`researchEnabled`), Admin (`admin`).

### Preferences: storage and application
- **Type/shape**: `WorkspacePreferences` — `apps/web/src/lib/workspacePreferences.ts` (fields referenced across `AppShell.tsx`: `theme`, `fontSize`, `readingWidth`, `scriptDisplay`, `soundEnabled`, `motionEnabled`, `focusMode`).
- **Persistence**: server-synced via `apps/web/src/app/api/preferences/route.ts` (the workspace-preferences POST endpoint) and read server-side at layout time via `getWorkspacePreferences()` (`apps/web/src/lib/preferences.ts`, called at `apps/web/src/app/(app)/layout.tsx:27`) — so `WorkspacePreferences` is a durable, cross-device, per-user DB-backed object, NOT localStorage. (Contrast with the RAG-sidebar WIDTH, which is explicitly localStorage-only and explicitly NOT part of `WorkspacePreferences` — see `GlobalRagSidebar.tsx:22-32` comment.)
- **Reader level** is a SEPARATE, account-level field (`users.readerLevel`), not part of `WorkspacePreferences` — set via `POST /api/reader-level` (`AppShell.tsx:147-162`) and read via `getUserReaderLevel()` (`apps/web/src/lib/readerLevel.ts`, called at `apps/web/src/app/(app)/layout.tsx:28`). Comment at `AppShell.tsx:140-146` explains why: it seeds default Library/Curriculum/Roadmap/Reader behavior and deliberately never changes silently just from browsing.
- **Application to DOM**: `PreferenceBootstrap` (`apps/web/src/components/app/PreferenceBootstrap.tsx`, mounted at `apps/web/src/app/(app)/layout.tsx:32`, not opened this pass) presumably stamps `data-theme`/`data-font-size`/`data-reading-width`/`data-motion` onto `<html>`/`<body>` — COULD NOT VERIFY the exact attribute-setting code, not opened.
- **Motion preference** maps to the `:root[data-motion="reduced"]` CSS override (`globals.css:752`) — toggled via the "Motion" checkbox in `PreferencesMenu` (`AppShell.tsx:390`).

---

## 6. Ask Library / RAG chat controller mount points

**Confirmed: THREE distinct mount points of `RagChatPanel`, and the code's own comment explicitly documents that two of them can be open simultaneously.**

1. **`/ask-library` standalone page** — `apps/web/src/app/(app)/ask-library/page.tsx:39-47`, `presentation="page"`. Only one instance can ever be open here (it's a dedicated route).
2. **Reader's own contextual drawer** — `apps/web/src/app/(app)/works/[workId]/reader/ReaderShell.tsx:731`: `{showRagChat && enablePhase18Rag && !embedded && <RagChatPanel id={ragPanelId} contextWorkId={workId} onClose={closeRagChat} dialogLabel="Ask Library — Reader panel" enableResearchModes={enableAskResearchModes} />}`.
3. **Shell-level global sidebar** — `apps/web/src/components/app/AppShell.tsx:303`: `{ragEnabled && ragOpen && <GlobalRagSidebar id={ragSidebarId} contextWorkId={routeWorkId} onClose={closeRag} enableResearchModes={askResearchModesEnabled} />}`. `GlobalRagSidebar` (`apps/web/src/components/app/GlobalRagSidebar.tsx:4`) itself wraps `RagChatPanel` (drawer presentation) with a resizable-sidebar affordance.

**The duplicate-controller risk is explicitly acknowledged in code, not merely inferred by this audit**: `RagChatPanel.tsx:78-88`'s doc comment for the `dialogLabel` prop states verbatim: *"this panel is mounted as a `dialog` from two independent disclosures — the Reader's own contextual drawer and the shell-level global sidebar (`GlobalRagSidebar`) — and both can be open at once on a Reader route."* The stated mitigation is accessible-name uniqueness only (`dialogLabel` defaults differ per call site so the two dialogs don't collide as the same accessible name for assistive tech) — there is **no mutual-exclusion logic** preventing both from being open at once; each mounted `RagChatPanel` instance owns fully independent local component state (`conversationId`, `messages`, `mode`, etc., all `useState` inside the component itself, `RagChatPanel.tsx:104-138`), so a user could genuinely have two live, independent conversation threads open simultaneously while on a `/works/[workId]/reader` route (one from the reader drawer, one from the shell's global sidebar).

State location: entirely local `useState` inside `RagChatPanel` per mount — no shared/global RAG conversation state exists anywhere in the shell (confirmed: no RAG-specific state in `WorkspacePreferencesProvider` or any other context provider found in this pass).

---

## 7. Test inventory

### E2E specs (`apps/web/e2e/*.spec.ts`) — one-line scope note (top-level `test.describe` title), CI-safe vs manual

**CI-safe** (run on every push per `.github/workflows/*.yml:131`, against web + Postgres only, no worker/Storage/live APIs):
| Spec | Scope |
|---|---|
| `landing.spec.ts` | Landing & policy pages (Phase 6) |
| `landing-contract.spec.ts` | Landing page visual contract (frozen baseline) |
| `onboarding.spec.ts` | Onboarding (Phase 6) |
| `security.spec.ts` | Authorization / IDOR matrix (Phase 7) |
| `edition.spec.ts` | (no top-level `test.describe` matched by simple grep — likely nested/`test.step`-based; not opened further this pass) |
| `diagnostic.spec.ts` | Per-work diagnostic (Phase 9.4) |
| `library.spec.ts` | Library (Phase 9.5) |
| `upload.spec.ts` | Batch upload (Phase 14) |
| `curriculum.spec.ts` | Curriculum (Phase 9.6) |
| `graph.spec.ts` | Visualization graph |
| `trash.spec.ts` | Work trash (Phase 9.7 + 20.3) |
| `workspace-shell.spec.ts` | Phase 12 workspace foundation |
| `auth.spec.ts` | Authentication (Phase 8.1) |
| `work-status.spec.ts` | Work status controls (Phase 19) |

**Manual / full-stack only** (need worker + Supabase Storage + live external APIs, per `docs/PROJECT-LOG.md`'s documented CI/manual split):
| Spec | Scope |
|---|---|
| `accessibility-sweep.spec.ts` | Accessibility sweep (Phase 19.8) |
| `account.spec.ts` | Account — profile, data sharing, plan (Workstream G) |
| `admin-dash.spec.ts` | Admin dashboard (Workstream H) |
| `annotations.spec.ts` | Scholarly analysis (Phase 4) |
| `ask-research-modes.spec.ts` | Ask Library research modes (Phase 28.6) |
| `canonical-identity.spec.ts` | Canonical identity and duplicate collapse (Phase 20.6) |
| `competency-signals.spec.ts` | Sub-phase 22.9b conversational competency designation |
| `feedback.spec.ts` | Feedback mechanism (Workstream J) |
| `graph-debates.spec.ts` | Knowledge-graph debate layer (Phase 28.4) |
| `graph-expansion.spec.ts` | Cross-library graph API guardrails |
| `graph-scene.spec.ts` | Visualization scene data contract (D-21-9) |
| `hardening.spec.ts` | Phase 12 hardening |
| `identity-cleanup.spec.ts` | D-20-65: test cleanup of `work_identity`/`learning_resource` rows |
| `link-check.spec.ts` | Link checker (Phase 23.1) |
| `performance.spec.ts` | Performance budgets (Phase 23.6) |
| `public-experience.spec.ts` | Public editorial experience |
| `rag.spec.ts` | Phase 18 Library-grounded Socratic RAG |
| `reader-claims.spec.ts` | Reader Claims tab (Phase 28.3) |
| `reader.spec.ts` | Reader (Phase 3) |
| `research-chambers.spec.ts` | Evidence Chamber (Phase 27.1) |
| `research-corpus.spec.ts` | Research corpus (Phase 30 fix lane) |
| `research-corrections.spec.ts` | Research corrections (Phase 29.2) |
| `research-dashboard.spec.ts` | Dashboard research insight module (Phase 29.3) |
| `research-hypotheses.spec.ts` | Research hypotheses & gaps (Phase 27.2) |
| `research-monitors.spec.ts` | Research monitoring (Phase 29.1) |
| `research.spec.ts` | Research workspace (Phase 28.1) |
| `responsive-visual.spec.ts` | Phase 23.3 viewport sweep, no horizontal overflow 320–1440px |
| `roadmap-constellation.spec.ts` | Roadmap constellation (smoke) |
| `roadmap-graph.spec.ts` | Roadmap visualizer |
| `roadmap.spec.ts` | Roadmap & knowledge graph (Phase 5) |
| `source-attach.spec.ts` | Upload source text for Library-added works (Phase 20.4) |
| `trash-storage.spec.ts` | Work trash — real-Storage regressions (Phase 20.3) |
| `upload-integrity.spec.ts` | Signed upload integrity (Phase 19) |
| `visual.spec.ts` | Phase 12 visual regression |
| `writer-evidence.spec.ts` | Writer evidence insertion (Phase 28.5) |
| `writer-export.spec.ts` | Writer citation export |
| `writer.spec.ts` | Writer mode |

Playwright config (`apps/web/playwright.config.ts`): `fullyParallel: false`, `workers: 1` (serialized — all specs share ONE local worker+Postgres, comment explains concurrent analysis jobs previously starved extraction), `retries: 1`, `timeout: 120_000`, single `chromium` project. No CI project split inside the config itself — the CI/manual split is enforced entirely by which spec filenames are passed on the CI `playwright test` command line (`.github/workflows/*.yml:131`), not by a Playwright `project`/tag mechanism.

### Unit-test areas relevant to graph/roadmap/shell
| File | Area |
|---|---|
| `apps/web/src/components/graph/edgeTypeForRelationshipCategory.test.ts` | relationship_category → edge_type mapping |
| `apps/web/src/components/graph/filterGraphData.test.ts` | `filterGraphData()` / `GraphFilters` semantics |
| `apps/web/src/components/graph/graphFocus.test.ts` | Graph focus-mode dimming logic |
| `apps/web/src/components/graph/graphForces.test.ts` | 3D force-layout tuning |
| `apps/web/src/components/graph/graphSceneScaling.test.ts` | 3D scene scaling/`edgeRelationLabel` |
| `apps/web/src/components/graph/roadmapLayout.test.ts` | Roadmap-mode stage-column layout |
| `apps/web/src/lib/graphConnectivity.test.ts` | `selectVisualNodes`/concept-concept edge mapping |
| `apps/web/src/lib/graphEdgeCategory.test.ts` | `deriveEdgeCategory()` (D-21-9 fix) |
| `apps/web/src/lib/roadmapGraph.test.ts` | `buildRoadmapGraph()` roadmap-mode projection |
| `apps/web/src/lib/workspacePreferences.test.ts` | Workspace preferences shape/defaults |
| `packages/roadmap/src/rank.test.ts` | Pure roadmap ranking (`rankRoadmap`, incl. Heidegger/Vico acceptance cases per `docs/PROJECT-LOG.md`) |
| `packages/curriculum/src/index.test.ts` | `stageForRelationship()`/`checkpointFor()` pure functions |

No dedicated shell-component (`AppShell.tsx`, `CommandPalette.tsx`) unit-test file was found by this grep — shell behavior appears to be covered only by `workspace-shell.spec.ts` (E2E, CI-safe).

---

## Verification boundary (see also the JSON summary)

Every claim above is grounded in a file I actually opened via the `Read` tool or a `grep`/`find` command I actually ran in this session, with file:line citations given wherever the claim is about specific code content. Explicit `COULD NOT VERIFY` markers are inline above for: (a) `site-theme.css`/`development.css` token contents (files not opened), (b) the exact DOM-attribute-setting code in `PreferenceBootstrap.tsx` (not opened), (c) `AppFooter.tsx`/`ProfileMenu.tsx` contents (not opened), (d) the literal `RelationshipCategory` TypeScript declaration site inside `packages/roadmap/src` (grep found no match; likely a `pgEnum`-inferred type, not chased further), (e) `edition.spec.ts`'s top-level scope title (grep pattern didn't match its structure), (f) current live Vercel production env-var values for any flag (no production read performed — this is a read-only local-code audit only).

No files were modified, created, or deleted anywhere in `/Users/hyderhusainarastu/Project/AutoCriticalEditionProject` or `/private/tmp/palimnote-redesign` during this audit. No paid API calls were made. No production system was accessed.
