# Claude Code Task: Rebuild Palimnote’s Signed-In UI/UX and 3D Knowledge Map

You are Claude Code working on Palimnote, a deployed scholarly reading, research, and writing application.

Your task is to redesign the entire signed-in product and rebuild the graph workspace from a clean implementation. The present graph is not usable. Treat this as a functional product repair with a visual redesign, not as a cosmetic reskin.

Work autonomously through the staged gates below. Do not ask the owner to choose routine technical details already decided in this prompt. Stop only for a genuine authority, credential, destructive-action, or irreducible product blocker.

## 1. Repository and source-of-truth order

The application repository is:

`/Users/hyderhusainarastu/Project/AutoCriticalEditionProject`

The research repository is:

`/Users/hyderhusainarastu/Project/Palimnote_Research`

Before changing code, read the following in this order:

1. `/Users/hyderhusainarastu/Project/AutoCriticalEditionProject/docs/PROJECT-LOG.md`
2. `/Users/hyderhusainarastu/Project/AutoCriticalEditionProject/docs/project-status.json`
3. The current signed-in routes, graph types, graph API construction, design tokens, shell, Reader, Research, Writer, tests, and feature flags in the application repository.
4. `/Users/hyderhusainarastu/Project/Palimnote_Research/palimnote-scholarlens-hybrid-brief.md`, especially its six graph layers, progressive-disclosure rules, core workflows, evidence requirements, and correction model.
5. `/Users/hyderhusainarastu/Project/Palimnote_Research/research/graph_rebuild_prompt.md`.

The last file is an older, undelivered handoff. It is useful for domain constraints, but this prompt supersedes it. In particular, do not preserve its vague “your call” visual instructions, its global-force-first default, its optional treatment of claims, or any stale file/version assumption.

Authority order when sources disagree:

1. This prompt is authoritative for the target UI, interaction behavior, visual language, graph spatial model, implementation stages, and acceptance gates.
2. Current database schema, application types, canonical IDs, authentication, owner isolation, provenance, and evidence contracts constrain how that target is implemented.
3. Current `docs/PROJECT-LOG.md` and generated project status are authoritative for what exists and what has actually been verified.
4. The ScholarLens hybrid brief is authoritative for product and scholarly semantics not contradicted by this prompt.
5. The older graph prompt is background only.

Current live route behavior is diagnostic evidence, not a reason to preserve a defective interaction. Preserve route reachability, data, security, and valid capabilities while replacing the behavior this prompt explicitly redesigns.

Do not copy code or prose from `external-reference`. It may inform high-level interaction patterns only. Its licensing status does not authorize reuse.

## 2. Mission and definition of success

Deliver a coherent signed-in application organized around Home, Read, Research, and Write, sharing one Library, identity system, evidence store, graph, project model, and context-aware Ask Library assistant.

Replace the current graph renderer, camera controller, and graph orchestration from the ground up while preserving valid graph data contracts, provenance, destinations, authentication, ownership checks, and corrections.

“Functional 3D graph” means all of the following:

- It always renders a visible, correctly framed scene when valid data exists.
- A user can understand what the initial scene contains and what depth means.
- Nodes and links can be found, selected, inspected, focused, expanded, filtered, and followed.
- Camera actions are deterministic and recoverable.
- Navigation, selection, filtering, view switching, resizing, and route remounting cannot strand the user in a blank or edge-on scene.
- The graph remains usable on guided mobile, by keyboard, with reduced motion, without WebGL, and through a semantic list/2D alternative.
- Its visual semantics are restrained, redundant, and explainable rather than decorative.
- Real task walkthroughs, unmasked scene evidence, camera assertions, and performance measurements prove these claims.

A passing typecheck, a visible `<canvas>`, green wrapper tests, masked screenshots, or a polished empty state do not establish success.

## 3. Operating constraints

- Begin with a clean status check. Preserve unrelated user changes.
- Work in a new isolated worktree and branch unless the current environment is already an explicitly dedicated clean worktree.
- Make small, reviewable local commits by stage. Do not push, merge, deploy, alter production settings, or run production migrations without separate owner authorization.
- Do not delete or reset user work.
- Do not use paid APIs for this redesign unless separately authorized.
- Do not make unrelated ingestion, worker, public marketing-site, billing, or infrastructure changes.
- Preserve existing URLs and deep links. Add compatibility redirects or shells rather than breaking bookmarks.
- Preserve authentication, owner isolation, IDOR protections, feature flags, canonical IDs, provenance, confidence, evidence, revisions, and correction history.
- No database migration is part of this task by default. If a narrowly additive schema change appears unavoidable, first prove why an adapter or existing table cannot satisfy the requirement, document the proposed migration, and stop before applying it.
- Existing APIs remain compatible. A narrowly additive owner-scoped application endpoint is allowed only when a required action cannot be wired through an existing endpoint and no schema change is needed.
- Never fabricate graph nodes, passages, full-text access, claims, relationships, credibility, mastery, or evidence.
- If authenticated production access is unavailable, use realistic local seeded data and state the verification boundary. Do not imply that production was visually verified.
- Do not weaken tests, mask the graph canvas, update snapshots blindly, or remove assertions to make the redesign pass.
- Continue autonomously after each objective stage gate. Do not insert a manual visual-approval pause.

## 4. Verified current defects to reproduce before replacing

Verify these against the current code rather than trusting line numbers:

- The default Roadmap layout fixes nodes on `z=0`.
- Selecting a Roadmap node derives a camera position by multiplying the node’s world coordinates. This keeps camera `z=0`, places the camera in the graph plane, and can place camera and target at the same point for an origin node.
- Reset derives its bearing relative to world origin rather than the active controls target, so it can preserve the invalid edge-on direction.
- Zoom-dependent node/label sizing uses camera distance from world origin rather than distance from the current camera target.
- Explore-mode force registration can lose a React/library synchronization race and silently skip clustering until an unrelated future change.
- The graph is constrained inside a narrow page and loses additional space to a fixed inspector even when nothing is selected.
- The initial scene can ask the user to select labeled nodes while many selectable nodes have no discoverable label, especially on touch.
- The page presents too many primary controls, legends, and filters without a clear task hierarchy.
- The accessible table can become a very wide, unpaginated representation with unbounded connection text.
- Existing visual regression tests mask the actual WebGL canvas.
- Existing graph tests largely prove wrapper, heading, table, and URL behavior, not that nodes are visible, framed, legible, selectable, or navigable.
- The existing “large graph” test does not exercise the current 140, 400, and 800-node degradation boundaries.

Create `docs/audits/ui-graph-redesign-baseline.md` containing:

- Reproduction steps and screenshots or recordings.
- Exact confirmed defects and any prompt assumption disproven by current code.
- Current route and feature inventory.
- Current node/edge counts for available realistic corpora: median, p95, and maximum nodes, links, and node degree.
- Current scene-ready time, representative interaction latency, and sustained orbit performance.
- Current accessibility, mobile, and no-WebGL behavior.
- The authenticated/local/production verification boundary.

Complete this baseline before changing production UI code.

## 5. Scope that must not lose functionality

The redesign covers every signed-in route family:

- `/dashboard`
- `/works` and `/works/*`
- `/library` and `/library/*`
- `/upload`
- `/graph`
- `/ask-library`
- `/research` and `/research/*`
- `/writer` and `/writer/*`
- `/account` and `/account/*`
- `/admin`
- Signed-in welcome, loading, error, feedback, preferences, and utility states

Preserve these capabilities even if their presentation changes:

### Upload and work lifecycle

- Batch upload.
- Duplicate decisions.
- Upload and processing progress.
- Metadata confirmation.
- Retry and reprocessing.
- Trash, restore, and explicit permanent-delete protections.

### Library

- Uploaded/owned text versus cited-only or metadata-only source distinction.
- Focus work.
- Search, filtering, sorting, and reading state.
- Credibility, provenance, licensing/access status, and missing-source acquisition/upload.
- Canonical identity shared across Library, graph, roadmap, Research, citations, and Writer.

### Reader and learning

- Immutable original source and processed/annotated representations.
- Outline, original text, notes, apparatus, terms, sources, claims, annotations, and generated critical notes.
- Highlights, notes, bookmarks, saved position, typography, script display, reader level, focus mode, and reduced motion.
- Ask Library with grounded citations.
- Roadmap, curriculum, concept check, reading state, and clearly qualified self-rated/inferred mastery.

### Research

- Projects, questions, members, and corpus.
- Claims, evidence anchors, corrections, verification, disputes, revisions, and provenance.
- Relationship detection and judging.
- Debate clusters, Evidence Chambers, hypotheses, gaps, monitors, research jobs, and honest progress/error reporting.

### Writer

- Projects and documents.
- Autosave, ordering, archive, revisions, and restore.
- Library sources and Research evidence.
- Citation insertion and export.
- DOCX/PDF and citation output already supported by the application.

### Ask Library

- Existing ordinary and research modes.
- Grounded citations, conversation history, and contextual entry points.
- Exactly one mounted assistant/conversation controller at a time. Eliminate the current risk of duplicate full-page/sidebar/Reader instances competing for state.

### Account and preferences

- Profile, data-sharing controls, usage, plan display, account deletion, feedback, theme, text size, reading width, script display, reader level, motion, and focus preferences.
- Conditional Admin access without placing Admin among the primary workspaces.

## 6. Target information architecture

Use four primary destinations:

1. **Home**
2. **Read**
3. **Research**
4. **Write**

Library is the shared corpus beneath all three workspaces. Upload is a prominent global action, not a fifth workspace.

### Global shell

- Desktop at `>=1024px`: a collapsible 232px workspace rail and a 56px context bar.
- Collapsed desktop/tablet rail: 64px with accessible labels/tooltips.
- Mobile below `768px`: a 56px bottom navigation bar for Home, Read, Research, and Write, respecting safe-area insets.
- Mobile top context bar: 52px.
- Put Upload in a persistent, clearly labeled action.
- Put Account and conditional Admin in the profile menu.
- Retain the command palette and expand it to works, Library records, passages, projects, claims, debates, hypotheses, and writing projects.
- Preserve browser history, query parameters, saved preferences, reader position, graph context, and selection.
- Hide the marketing-style footer and minimize global chrome in Reader, Knowledge Map, and Writer.
- Never show more than one secondary drawer or bottom sheet on mobile.

### Home

Replace the counter-led dashboard with an evidence-backed “next work” surface:

- Resume the most recent reading position.
- Review a claim or relationship awaiting attention.
- Continue a running or interrupted Research job.
- Return to the latest Writer draft.
- Show concise processing/research status only when actionable.
- Retain direct access to Library, Upload, and recent projects.

### Read

Use Read subnavigation for:

- Reading Queue
- Library
- Upload
- Trash, placed in a secondary Library/Read management menu but always reachable

A work opens a persistent contextual work header with:

- Reader
- Sources
- Roadmap
- Curriculum
- Concept Check
- Knowledge Map
- Work details/status

The Roadmap is a clear 2D stage-column DAG. It is not a mode inside the 3D Knowledge Map.

Simplify Reader chrome:

- One compact reading toolbar.
- Optional outline on the left.
- One contextual analysis/notes drawer on the right.
- Do not allow multiple side panels to crush the reading measure.
- On mobile, use one bottom sheet at a time.
- Preserve and clearly distinguish Published Edition, Interactive Reader, original PDF/file access, and split-view reading.
- Preserve outline, apparatus, terms, generated critical notes, claims, annotations, sources, highlights, notes, bookmarks, and saved position while switching representation or split state.

### Research

A Research project has persistent project navigation:

- Overview
- Corpus
- Claims
- Debates
- Evidence Chambers
- Hypotheses
- Monitors
- Knowledge Map

`Evidence Chambers` is a new project-level presentation route or view over the existing owner-scoped chamber records; it does not imply that such a route already exists or require a new table. Preserve existing chamber permalinks at `/research/chambers/[chamberId]`, claim permalinks, global `/research/monitors`, project monitors, debate-cluster permalinks, and the existing combined hypotheses-and-gaps behavior.

Remove duplicated pipeline/job actions. One canonical action displays real queued/running/completed/failed progress and next steps.

Replace `window.prompt` and `window.alert` flows with accessible dialogs, inline validation, and recoverable error states.

Dense claim and evidence tables must become responsive cards or adaptive lists on narrow screens rather than unexplained horizontal scrolling.

### Write

Use a focused editor with:

- Collapsible Sources/Evidence panel.
- Central draft.
- Collapsible Citations/History panel.
- At most one side panel open on narrow widths.
- Clear autosave and revision status.
- Context-preserving insertion from Library, Research, Reader, and Knowledge Map.

## 7. Visual system: “scholarly atlas”

Retain and normalize Palimnote’s editorial identity:

- Background: `#FBF9F4`
- Surface: `#F4F0E7`
- Primary ink: `#172838`
- Burgundy: `#7A3F48`
- Green: `#3E5D52`
- Umber: `#765641`
- Gold: `#B48A47`

Dark theme must provide equivalent semantic tokens and WCAG 2.2 AA contrast, not a separate visual language.

Typography:

- Scholarly serif for page titles and meaningful section headings.
- Readable sans-serif for controls, tables, metadata, and body UI.
- Default UI body text: 16px.
- Secondary text: 14px.
- Small metadata: never below 12px.
- Reserve uppercase/small caps for genuine metadata, not primary navigation or primary actions.

Interaction and components:

- Conventional touch targets are at least 44×44 CSS pixels.
- Use a visible 2px focus treatment with adequate offset.
- Use semantic buttons, links, headings, landmarks, dialogs, drawers, tabs, live regions, and status messages.
- Restore focus after closing dialogs, drawers, sheets, and command surfaces.
- Use search-first progressive disclosure, active-filter chips, saved views where the current data supports them, and an “All filters” drawer.
- Move layout tuning and diagnostics out of primary task controls.
- Every loading, empty, unavailable, partial, failed, and retrying state must explain what happened and what the user can do.
- Preserve theme, text-size, reading-width, script, reader-level, motion, and focus preferences.

## 8. Knowledge Map purpose and spatial model

The 3D Knowledge Map is a contextual scholarly navigation surface. It is not a generic citation cloud, a decorative constellation, or a field-wide claim of completeness.

It must support the bidirectional movement:

`passage → claim → evidence → disagreement → debate/field map`

and:

`debate/question → positions → claims → decisive evidence → owned source passage`

Valid entry contexts:

- Work
- Passage
- Research question
- Claim
- Debate

The global `/graph` route opens a context chooser and recent contexts. It must never immediately render the entire corpus as an undifferentiated network.

Initial disclosure:

- Desktop: root plus no more than 24 prioritized direct neighbors.
- Mobile: root plus no more than 12 prioritized direct neighbors.
- Each explicit expansion adds at most 20 nodes.
- Above 120 visible desktop nodes or 60 mobile nodes, aggregate remaining branches into labeled display-only summaries such as “12 more sources” and require narrowing or explicit expansion.
- Prioritize direct, verified, evidence-anchored relationships before inferred or lower-confidence relationships, with stable ID tie-breaking.
- Do not silently drop hidden nodes; show counts and the reason for aggregation.

Use six semantic depth-band indices:

- Index `-2`: **Evidence** — passages, quotations, data, examples, methods.
- Index `-1`: **Intellectual** — works, references, sources, authors, people, concepts, traditions, influences, historical contexts.
- Index `0`: **Claims** — claims, premises, objections, replies, qualifications.
- Index `1`: **Debates** — questions, positions, controversies, interpretations, unresolved issues.
- Index `2`: **Learning** — prerequisites, explicitly qualified mastery, curricula, recommended routes.
- Index `3`: **Research** — gaps, hypotheses, proposed investigations, writing projects.

Define `BAND_GAP = min(120, max(48, 1.25 × the configured median X/Y link distance in world units))`. A node’s semantic position is `z = bandIndex × BAND_GAP`. Constrain nodes to their semantic band while allowing deterministic force separation within X/Y. Within-band Z jitter may not exceed `0.08 × BAND_GAP` and carries no meaning.

Use world Z as the band normal and world up: `camera.up = (0, 0, 1)`. Azimuth rotates in the X/Y plane around the positive Z axis. Elevation is the angle above the X/Y plane. If a renderer assumes Y-up internally, adapt coordinates at one boundary; do not allow competing coordinate conventions in camera or layout code.

Provide restrained layer-reference labels or planes at no more than 6% opacity when the layer guide is enabled. They must make the band structure legible without becoming decorative scenery.

Explain in the interface:

- Z band has the semantic meaning listed above; the displayed `-2…3` values are indices multiplied by `BAND_GAP`, not literal world-unit separations.
- X/Y distance and residual spacing are layout aids, not factual similarity measurements.
- Algorithmic clusters, if offered, are explicitly labeled exploratory and never treated as scholarly classification.

The Roadmap remains a separate 2D/DAG learning view. Do not extrude its flat stage columns and call that 3D.

## 9. Graph data contracts and display adapter

Preserve the current canonical graph payload and stable IDs. The current graph contract includes:

- Node types: `work`, `reference`, `peer_reviewed_source`, `online_source`, `concept`, `person`, `section`, `claim`, and `debate`.
- Node states: `primary`, `read`, `reading`, `unread`, `missing`, and `structural`.
- Stable destinations, associated work IDs, upload/held state, roadmap annotations, source/access/license provenance, reader-level scoping, credibility dimensions, mastery, and debate/claim metadata where real data exists.
- Stable link IDs, source/target, direction, category, confidence, evidence, provenance, associated work IDs, and reader-level metadata.

Preserve the current ten-value relationship category enum losslessly:

- `explicit_reference`
- `secondary_scholarly_recommendation`
- `historical_context`
- `prerequisite`
- `conceptual_influence`
- `disagreement_polemical_target`
- `interpretive_aid`
- `parallel_comparison`
- `optional_extension`
- `ai_inferred`

Preserve the current structural edge vocabulary and additive debate edges.

`ai_inferred` records provenance/origin. It is not a tenth semantic line family. Render it as an uncertainty/provenance treatment and label it honestly.

Create a separate pure, tested display/render contract. Do not widen `GraphNode.type` with ad hoc strings or pass display-only nodes to code that expects the canonical nine-value `NodeType`.

At minimum, define a discriminated model equivalent to:

```ts
type DisplayKind =
  | NodeType
  | "passage"
  | "question"
  | "position"
  | "evidence"
  | "learning_step"
  | "hypothesis"
  | "gap"
  | "writing_project"
  | "aggregate";

interface DisplayNode {
  id: string;                         // stable display id
  displayKind: DisplayKind;
  canonicalNodeId: string | null;     // canonical GraphNode id when one exists
  sourceEntity: { kind: string; id: string } | null;
  layer: "evidence" | "intellectual" | "claim" | "debate" | "learning" | "research";
  label: string;
  destination: string | null;
  unavailableReason: string | null;
  projection: {
    basisIds: string[];
    rule: string;
    version: string;
  } | null;
}

interface DisplayLink {
  id: string;
  source: string;                     // DisplayNode id
  target: string;                     // DisplayNode id
  canonicalLinkId: string | null;
  displayFamily: string;
  directed: boolean;
  evidence: unknown;
  provenance: unknown;
}
```

Use exact project types rather than `string`/`unknown` where current schemas already define them. The shape above specifies the required separation and traceability, not permission to weaken typing.

Before implementation, add a data-source matrix to the baseline audit:

- Canonical work/reference/source/person/concept/section/claim/debate nodes come from the existing owner-scoped graph payload.
- Passage/evidence display nodes come only from owned text blocks, anchored annotations, claims, quotations, or evidence records the current user is authorized to read.
- Question/position/debate display nodes come only from the current user’s Research projects, project membership, debate clusters, and judged claim relationships.
- Learning-step display nodes are deterministic projections of the current owner-scoped computed Roadmap; they are not persisted snapshots.
- Hypothesis/gap display nodes come only from existing owner-scoped Research records.
- Writing-project display nodes come only from existing owner-scoped Writer projects and explicit project/evidence links.
- Aggregate nodes are deterministic summaries of the current filtered display set; their `basisIds` enumerate the hidden display nodes they summarize.

Adapter invariants:

- Canonical server payload remains immutable.
- Clone only renderer coordinates/endpoints that a force engine must mutate.
- Inspector, 3D view, 2D view, and semantic list consume one filtered canonical/display selection.
- Every display node has a stable ID, owner-scoped source, layer, destination or explicit unavailable reason, and projection provenance.
- Every derived link records its basis and never upgrades inference into fact.
- Never infer that a cited-only work contains accessible full text. Selecting it opens the citation occurrence in the uploaded source and legitimate acquisition/upload actions.
- Add contract tests proving canonical and display models cannot be confused.

Make the following URL state restorable:

- Context kind and ID.
- `3d`, `2d`, or `list` view.
- Selected node.
- Active semantic layers.
- Active filters.
- Ordered expansion trail, using stable display IDs and capped to the product’s explicit expansion limit.
- Focus state: all visible context, one-hop neighborhood, two-hop expansion, concepts-only, or reading path.

Camera coordinates remain ephemeral. Home is deterministic.

Reconstruction rules:

- Rebuild the base context deterministically.
- Replay valid expansion IDs in order.
- Recreate aggregate summaries from their current basis rather than trusting stale counts.
- Ignore unauthorized, deleted, or no-longer-valid IDs, announce the omission non-disruptively, and preserve the rest of the state.
- Back/Forward must reconstruct the same context, expansion trail, focus state, selection, layers, and filters.

### Legacy graph URL compatibility

Inventory all current graph query parameters and create an explicit compatibility table and tests. At minimum:

| Existing state | Required new behavior |
|---|---|
| `layout=explore` | Open the context-first Knowledge Map with `view=3d` |
| Explicit `layout=roadmap`, or any legacy URL carrying `roadmapRoot` under the old default | Open the separate 2D Roadmap; never render the old flat 3D roadmap |
| One valid `roadmapRoot=work:<id>` | Redirect/map to `/works/<id>/roadmap`, preserving applicable reader/stage/path state |
| Multiple valid `roadmapRoot` values | Open a compatibility multi-root 2D Roadmap chooser/view with those roots preselected |
| Invalid or absent roadmap root in an explicit legacy Roadmap URL | Open the 2D Roadmap chooser with an explanatory notice |
| Repeated `pinnedWork` | Convert to initial anchored work context(s); multiple values open a preselected context chooser rather than silently choosing one |
| `readingThread=1` | Restore the reading-path overlay/focus state |
| `focusMode=focus` | Restore selected node plus one hop |
| `focusMode=expand` | Restore selected node plus two hops |
| `focusMode=full` | Restore all nodes within the current bounded contextual disclosure |
| `focusMode=concepts` | Restore selected node plus its concept/person neighbors |
| `selected` | Restore selection if authorized and visible; otherwise announce why it was omitted |
| `search`, `state`, `type`, `authority`, `provider`, `relation`, `credibilityBand`, `associatedWork`, `stage`, `readerLevel`, `conceptKind` | Translate losslessly to the new filter state |

Keep `/graph` and `/works/[workId]/graph` reachable. A bare new `/graph` intentionally opens the context chooser; that target behavior supersedes the old implicit Roadmap default.

Also preserve and test existing Ask Library deep-link state, including `mode`, `claimId`, `clusterId`, and `workIdB`, while enforcing the single-controller rule.

## 10. Exact 3D scene specification

### Backdrop and materials

- Solid graph background: `#0B1020`.
- Optional stationary reference grid: `#263A4F` at no more than 8% opacity.
- Use subtle depth fog only if it measurably improves orientation without hiding nodes.
- Matte, low-poly materials.
- No star field.
- No bloom.
- No shadows.
- No animated particles.
- No automatic rotation.
- No decorative post-processing in the first release.

### Node geometry and color

Use at most six base silhouettes. Color is always reinforced by geometry, material, outline, label, state, and the persistent legend.

| Entity | Required geometry and material |
|---|---|
| Uploaded work | Solid ivory sphere `#FDF8EE` with a gold equatorial ring `#F0C47C` |
| Cited/reference work | Smaller hollow sphere; use `#C99B9B` wireframe when text is unavailable |
| Peer-reviewed source | Solid sphere with a green double band `#8FC4A8` |
| Online source | Solid sphere with an umber single band `#D3AB86` |
| Concept/tradition/context | Green icosahedron `#8FC4A8` |
| Person/author | Vertical umber capsule `#D3AB86` |
| Passage/evidence/section | Shallow document slab in bone `#FDF8EE` or slate `#A7B6C2` |
| Claim/premise/objection/reply | Blue octahedron `#8DB3C4` |
| Debate/question/position/hypothesis/gap | Burgundy hexagonal prism `#E0A3AC` with one thin orbital ring |

Sizing:

- Use the following bounded importance formula; do not invent a popularity, credibility, mastery, or confidence proxy:
  - Compute `degreeComponent = sqrt(min(visibleDegree, p95VisibleDegree) / max(1, p95VisibleDegree))`.
  - Start with `scale = 0.9 + 0.35 × degreeComponent`.
  - Add `0.15` for a direct evidence-anchored claim/evidence neighbor of the root.
  - Add `0.05` for an aggregate-summary node.
  - Clamp the result to `0.8–1.6`.
  - Override the root to exactly `1.5`.
  - Selection changes rings/emphasis, not node size.
- Clamp ordinary nodes to `0.8×–1.6×` the base size.
- Root context node: `1.5×`.
- No hub may exceed `2×` base size.
- Tune world dimensions so ordinary nodes project to roughly 10–24px at Home and the root to roughly 24–30px.
- Use a larger invisible picking volume so touch selection remains reliable; it must not change the visible geometry.

State:

- Selection: static bone inner ring plus gold outer ring.
- Hover/focus: one thin bone ring.
- Reading state: a small lower progress arc.
- Missing/unavailable text: wireframe or dashed outline in addition to its label.
- Structural/display-only node: lower-saturation material and explicit label.
- Do not pulse nodes as a normal status treatment.

Credibility:

- Credibility never controls node size.
- Show the six separate credibility dimensions as a segmented ring only for selection/close focus and in the inspector.
- Keep popularity separate.
- Missing credibility data is “not assessed,” never zero.

Mastery:

- Label it “self-rated” or “inferred.”
- Do not present the existing threshold or score as objective knowledge.
- Missing mastery is “not assessed,” never zero.

### Edge grammar

| Relationship family | Required treatment |
|---|---|
| Citation/reference/recommendation | `#A9B3BC`, 0.7px-equivalent solid line |
| Prerequisite/presupposition | `#F0C47C`, 1.4px solid line with arrow |
| Influence/support/agreement | `#8FC4A8`, 1.2px solid line |
| Contradiction/opposition | `#E0A3AC`, 1.4px dashed `6/4` line |
| Qualification/nuance | `#D3AB86`, 1.1px dot-dash line |
| Structural/contains/edition | `#718096`, 0.8px dotted line |

Keep the canonical five-value `EdgeFamily` contract unchanged. Define an additive display-only `DisplayEdgeFamily` that can distinguish `qualification` from the canonical influence family without altering stored or API semantics.

Required relationship-category mapping:

| Current relationship category | Display family |
|---|---|
| `explicit_reference` | Reference |
| `secondary_scholarly_recommendation` | Reference |
| `historical_context` | Influence |
| `prerequisite` | Prerequisite |
| `conceptual_influence` | Influence |
| `disagreement_polemical_target` | Opposition |
| `interpretive_aid` | Influence |
| `parallel_comparison` | Influence |
| `optional_extension` | Reference |
| `ai_inferred` | Use the underlying semantic family plus the inference/provenance overlay described below |

Required edge-type mapping:

- **Reference:** `cites`, `quotes`, `is_recommended_by`, `review_of`, `responds_to`, `discovered_source`, `supplementary_context`, `explicit_reference`, `secondary_scholarly_recommendation`.
- **Prerequisite:** `presupposes`, `is_prerequisite_for`, `prerequisite`.
- **Influence:** `influences`, `provides_context_for`, `interprets`, `is_comparable_to`, `historical_context`, `conceptual_influence`, `interpretive_aid`, `parallel_comparison`, `claim_supports`.
- **Qualification:** `claim_nuances`; canonical semantics remain the existing influence family, but the display adapter gives it the qualification treatment.
- **Opposition:** `criticizes`, `disagrees_with`, `disagreement_polemical_target`, `claim_contradicts`.
- **Structural:** `outline_section`, `translates`, `is_edition_of`, `edition_of`, `translation_of`, `excerpt_of`, `asserts_claim`, `in_debate`, and provenance/containment-only links.

Audit the actual emitted values and add any current value omitted above before implementation. An unknown value must render as a labeled neutral “Unclassified relationship” with provenance and a recorded diagnostic; it must not silently default to agreement/influence.

For `ai_inferred`, preserve the mapped semantic family but reduce default opacity to 70% of that family, add an `AI-inferred` provenance badge in the inspector/accessible view, and use a subtle outer dash in selected/near-detail LOD. Do not create a distinct semantic color.

Rules:

- Straight links by default.
- Curves only for self-links and parallel edges.
- Arrowheads only for directed selected/nearby relationships at a readable zoom.
- Default opacity: 0.25.
- Selected path and direct neighborhood: 0.85.
- Unrelated visible content while selected: 0.12, never silently removed unless explicit Focus mode is active.
- No moving particles.
- Widths above are target screen-space hierarchy, not a requirement to build expensive per-edge cylinders merely to force subpixel WebGL widths.
- Exact dash/dot-dash patterns are mandatory for selected, focused, and near-detail relationships. At far zoom or where the chosen renderer cannot provide portable subpixel patterns without violating the performance gate, preserve the distinction through color, opacity, endpoint glyph, legend, and accessible label, then restore the exact pattern at detail LOD.
- Every current edge value must map deterministically to one of these visual families.

### Labels

Show labels for:

- Root.
- Selected node.
- Hovered/focused node.
- Search target.
- Direct neighbors.
- A capped priority set of at most 20 desktop or 10 mobile nodes.

Label treatment:

- Use a screen-space HTML or SDF label layer with collision avoidance.
- Do not create one SpriteText object per graph node.
- Root/selected: 16px semibold.
- Priority: 13px.
- Secondary: 12px.
- Maximum two lines.
- Dark translucent plate, 1px border, 6px padding.
- Truncate only visually; inspector and accessible view retain the full text.
- Labels must be available on keyboard focus and tap, not hover alone.

### Graph workspace layout

Desktop:

- Use the full available viewport; remove the narrow `max-w-5xl` constraint.
- 52px graph toolbar.
- Collapsible semantic-layer/filter rail.
- Canvas dominates the remaining area.
- Selected-only inspector drawer, 360px wide. It overlays rather than permanently reducing the canvas. Open it on the side opposite the selected node’s projected X position when possible, so selection never hides the node that was just clicked.
- Compact bottom context/history tray.

The primary toolbar contains only:

- Context/breadcrumb.
- Search.
- `3D / 2D / List`.
- Focus neighborhood.
- Fit.
- Home.
- Filters.
- Help.

Put Arrange, orientation presets, diagnostics, export, and advanced layout controls in secondary menus.

Mobile:

- Fullscreen context-limited graph.
- Persistent `3D / 2D / List` switch.
- Inspector bottom sheet with snap points near 28%, 70%, and 95%.
- One-finger orbit.
- Pinch zoom.
- Two-finger pan.
- At least 44px controls and enlarged invisible node hit targets.
- Do not render the entire corpus by default.

2D and List:

- Consume the same selected context, filtered data, layer visibility, and inspector state.
- 2D uses readable layer columns/bands and collision-aware labels.
- List groups by layer and relationship distance and supports search, sorting, selection, actions, and return to context.
- Large lists/tables use pagination or virtualization.
- Neither view is a second independently filtered data source.

## 11. Camera and interaction contract

Use an explicit target-aware camera controller with pure, unit-tested math.

Canonical Home:

- Use `camera.up = (0, 0, 1)`.
- Use a positive-Z semantic band normal.
- 45° azimuth in the X/Y plane around positive Z.
- 35° elevation above the X/Y plane.
- Construct the canonical unit vector as `(cos(elevation) × cos(azimuth), cos(elevation) × sin(azimuth), sin(elevation))`.
- Target the actual graph bounding-box center.
- Expand render bounds by visible node radii, selection/credibility rings, and label safe areas.
- Calculate fit using both horizontal and vertical FOV, viewport aspect ratio, near/far planes, 18% content padding, and current toolbar/rail/drawer safe-area insets.
- Maintain nonzero camera-target separation.
- Maintain at least 20° elevation relative to the graph’s X/Y plane.
- Never derive viewing direction by normalizing the camera position from world origin.

Focus:

- Single click/tap selects and opens/updates the inspector without moving the camera.
- Double-click or explicit Focus moves the camera.
- Search selection may select and focus.
- Compute focus as `cameraPosition = target + normalizedViewDirection × distance`.
- Define `normalizedViewDirection = normalize(currentCameraPosition - currentControlsTarget)`.
- If that vector has length below epsilon or violates the 20° minimum off-band-plane angle, use the canonical unit vector above.
- Derive focus distance from the selected node plus its currently emphasized neighborhood’s expanded render bounds, current viewport/FOV, and active UI safe-area insets. Do not use a fixed scalar multiple of node coordinates.
- Every programmatic Home, Fit, and Focus operation must enforce nonzero target separation and at least 20° off-band-plane elevation.
- A node at `(0,0,0)` must be safe.
- Default focus tween: 350ms.
- Reduced motion: no tween; snap immediately.

Reset and history:

- Home always returns to the canonical elevated fit.
- Fit frames the expanded current visible render bounds around their real center, including node/halo/label bounds and toolbar/rail/inspector safe areas.
- Back/Forward restores graph context and selection, not arbitrary stale camera vectors.
- Optional Front/Top/Side presets may live in a secondary orientation menu. Front/Side presets retain at least 20° elevation; Top is a deliberate 90° orientation and must retain an unambiguous up direction.

Controls:

- Upright Orbit controls.
- Left-drag orbit.
- Wheel/pinch zoom.
- Right-drag or modified drag pan.
- Background click clears selection.
- Escape closes transient UI before clearing persistent context.
- Hover never moves the camera or changes layout.

Arrange mode:

- Node drag is disabled during ordinary navigation.
- Explicit Arrange mode enables drag/pin.
- Provide Pin, Unpin, and Reset Layout.
- Pinned positions are scoped to the current user/context and may be stored locally if no existing owner-scoped persistence exists.
- Do not add a database migration solely for saved layout.

Zoom-dependent sizing and labels must use distance to the active target/node, not `camera.position.length()` from world origin.

## 12. Inspector and scholarly actions

The inspector groups:

- Identity and type.
- Held/uploaded/access state.
- Full label, authorship, year, venue, DOI, and destination where real.
- Incoming relationships.
- Outgoing relationships.
- Relationship category, direction, confidence, evidence, and provenance.
- Separate credibility dimensions and popularity.
- Reading status.
- Explicitly qualified mastery.
- Debate and claim metadata.

Wire real supported actions:

- Open owned evidence or Reader passage.
- Open work, Library item, claim, debate, Evidence Chamber, Research project, Roadmap, or Writer destination.
- Verify.
- Dispute.
- Edit.
- Reclassify.
- Add evidence.
- Remove a relationship.
- Mark uncertain.
- Request reprocessing.

Use existing owner-scoped correction/research APIs whenever possible. If an action has no real backend support, either add a minimal compatible owner-scoped endpoint using existing tables and tests or show an honest unavailable state and document the gap. Never render a button that only pretends to work.

For a cited-only work:

- Open the citation occurrence within an uploaded source.
- Show metadata and provenance.
- Offer legitimate acquisition or upload.
- Never imply access to that cited work’s own full text or passage.

## 13. Renderer bakeoff

The installed `react-force-graph-3d@1.29.1` is current. A version bump is not the repair.

Build two minimal prototypes using identical frozen data and interactions:

### Prototype A

- Clean `react-force-graph-3d`.
- Default/shared low-poly nodes and simple links.
- Target-aware camera.
- Capped screen-space labels.
- Picking, selection, focus, filters, resize, and remount.

### Prototype B

- React Three Fiber plus Three.js.
- `InstancedMesh` for repeated node geometries.
- Batched links.
- Instance-aware ray picking.
- Same camera, labels, interactions, data, fixtures, and benchmark script.

Do not add React Three Fiber to the final production dependencies unless Prototype B is selected. Keep prototype dependencies and files isolated and remove the losing implementation.

Audit actual corpus sizes first, then test:

- Mandatory production-context fixtures at the visible disclosure boundaries: 12, 24, 60, and 120 nodes with representative incident links.
- Mandatory renderer-headroom fixture: 500 nodes / 2,000 links.
- Nonblocking stress characterization: 1,000 nodes / 4,000 links, unless the corpus audit identifies a legitimate workflow that renders this many nodes simultaneously, in which case it becomes mandatory.

Run on the development Mac in current Chrome at 1440×900 with device-pixel ratio capped at 1.5:

- Median orbit performance: at least 50 FPS.
- p95 frame time: no more than 33ms.
- p95 pointer-to-highlight latency: no more than 100ms.
- Payload-received-to-interactive: no more than 2 seconds.
- Warm client-navigation-to-interactive: no more than 3.5 seconds for a 120-node contextual scene.
- Cold client-navigation-to-interactive: no more than 5 seconds for the same scene.
- Local seeded graph API request-to-serialized-payload p95: no more than 1.5 seconds.
- No blank scene or crash after repeated mount, resize, filter, view switch, and route navigation.
- No unbounded GPU resource, detached-listener, or worker growth after repeated remounts.

Use one checked-in benchmark harness and this reproducible protocol for both prototypes:

1. Record machine model, OS, browser version, power mode, viewport, DPR, fixture hash, renderer build, and cold/warm cache state.
2. Define `payload-received` immediately after the complete fixture/payload is available to the adapter.
3. Define `interactive` as the first visible frame in which the renderer has nonzero dimensions, the root is in-frustum, picking is enabled, search/selection controls are enabled, and no loading overlay blocks input. Simulation settlement is a separate metric.
4. Warm up with one mount, one complete scripted orbit, and one selection/focus/reset cycle.
5. Run five measured trials per mandatory fixture.
6. Measure frames during the same 12-second scripted azimuth/elevation orbit after a 3-second stabilization period. Derive median FPS and p95 `requestAnimationFrame` interval from those samples.
7. Measure pointer latency with at least 50 deterministic pointer moves over known visible node screen positions after warm-up, from dispatched pointer event to rendered highlight confirmation.
8. Measure three cold and five warm route navigations separately using Performance API marks from navigation intent, API request start/end, payload receipt, renderer initialization, first valid frame, and interactive.
9. Run 20 mount/unmount cycles after two warm-up cycles. After a stabilization interval and explicit GC only when the test environment exposes it, compare `renderer.info` geometry/texture/program counts, active workers, observers, timers, and registered lifecycle listeners against the stabilized baseline. Counts must return to baseline or a documented cache plateau within 5% and may not increase monotonically across the final five cycles.
10. Report all trials, not only the best run.

Decision rule:

1. Correctness and lifecycle reliability are mandatory.
2. The 12/24/60/120 production-context fixtures and 500/2,000 headroom fixture must meet the numeric floors.
3. The 1,000/4,000 stress fixture must not crash or go blank; its FPS/latency floors are diagnostic unless real product evidence makes that scale mandatory.
4. If Prototype A meets every mandatory gate, select it.
5. Select Prototype B only if A fails a mandatory gate and B materially resolves that measured failure.
6. If neither passes, introduce stronger contextual aggregation and retest before rendering more nodes.
7. Do not preserve the old 140/400/800 degradation tiers automatically. Derive any new LOD thresholds from the selected renderer and the new 12/24/60/120 product disclosure contract.
8. Do not promise 5,000-node support unless real corpus evidence requires it and a separate test proves it.
9. Keep one production 3D renderer, not two.

Create `docs/audits/graph-renderer-bakeoff.md` with:

- Fixture and machine details.
- Metrics.
- Camera, picking, label, lifecycle, accessibility integration, bundle, and maintainability findings.
- Chosen renderer and exact reasons.
- Rejected alternative and exact reasons.

## 14. Renderer implementation requirements

- Client-only initialization after a nonzero responsive container is measured.
- One renderer lifecycle owner.
- No renderer remount for selection, inspector, or ordinary filter changes.
- No React state updates or avoidable allocations in the frame loop.
- Canonical graph data remains immutable.
- Deterministic layout seed.
- Freeze the force simulation after convergence.
- Preserve coordinates across selection and filter changes.
- Reheat only for a genuine topology or layout change.
- For larger static layouts, evaluate precomputation in a worker.
- Share geometries, materials, textures, and label resources.
- Dispose renderer, controls, materials, geometries, textures, listeners, observers, timers, and workers on teardown.
- Cancel stale asynchronous layout/data work after route or context changes.
- Cap device-pixel ratio before degrading interaction quality.
- Reduce labels/detail before removing selection, focus, or recovery behavior.
- Validate duplicate IDs, dangling endpoints, unsupported direction, self-links, and parallel links.
- Handle loading, empty, malformed, fetch error, zero-size container, unsupported WebGL, `webglcontextlost`, and `webglcontextrestored`.
- Prevent default context-loss handling where appropriate, stop the frame loop, release/cancel stale work, explain the state, and switch to 2D/List. Never leave a blank rectangle.
- On `webglcontextrestored`, either reinitialize exactly once and restore context/view/selection/layers/filters/expansion state, or remain in the semantic fallback until the user activates Retry. Do not create duplicate renderers, controls, listeners, or workers.
- Provide a visible Retry where retry is meaningful.

## 15. Autonomous implementation stages and gates

### Stage 0 — Baseline

Deliver:

- Route/feature inventory.
- Current screenshots/recordings.
- Confirmed defect report.
- Corpus scale report.
- Baseline performance and accessibility evidence.

Gate:

- `docs/audits/ui-graph-redesign-baseline.md` exists and distinguishes verified, unverified, and unavailable evidence.

### Stage 1 — Design system and shell

Implement:

- Token cleanup.
- Home/Read/Research/Write navigation.
- Desktop/tablet/mobile shell.
- Context bars, dialogs, drawers, sheets, tabs, status, errors, empty states, and command-palette foundations.
- Route compatibility and immersive shell behavior.

Gate:

- Existing routes still resolve.
- Keyboard, focus restoration, touch targets, light/dark, reduced motion, and 1440/1024/768/375/320 layouts pass.

### Stage 2 — Renderer bakeoff

Implement and measure both prototypes.

Gate:

- Renderer decision report exists.
- Selected renderer passes correctness, camera, picking, lifecycle, and performance floors.

### Stage 3 — Knowledge Map rebuild

Implement:

- Context chooser.
- Pure render adapter.
- Semantic depth bands.
- Progressive disclosure and aggregation.
- Exact node/edge/label grammar.
- Camera controller.
- Search, selection, focus, inspector, filters, Help, Arrange mode, and history.
- Synchronized 3D, 2D, and List views.
- WebGL fallback and context-loss recovery.
- Work/passage/question/claim/debate entry contexts.

Gate:

- Actual unmasked scene evidence.
- Camera/frustum assertions.
- Desktop/touch/keyboard journeys.
- Dense fixtures and performance floors.
- No blank or edge-on reproduction after load, select, Home, filter, resize, remount, or view switch.

### Stage 4 — Read integration

Implement:

- Reading queue and shared Library hierarchy.
- Persistent work context.
- Simplified Reader chrome.
- Separate 2D Roadmap.
- Passage-to-claim/evidence/map continuity.
- Single Ask Library controller in Reader context.

Gate:

- Upload, Library, Reader, notes/highlights/bookmarks, Ask Library, Roadmap, and missing-source journeys pass without feature loss.

### Stage 5 — Research integration

Implement:

- Persistent project navigation.
- Responsive claims/evidence review.
- Accessible project creation/editing.
- One canonical research-pipeline action/status surface.
- Claim, debate, chamber, hypothesis, monitor, and graph continuity.

Gate:

- Project → corpus → claim correction → relationship → debate/chamber → contextual graph journey passes with real state and provenance.

### Stage 6 — Write integration

Implement:

- Focused editor layout.
- Collapsible evidence/citation/history panels.
- Research/Library/Reader/graph insertion continuity.
- Autosave/revision/export status.

Gate:

- Evidence → citation → draft → autosave → restore → export journey passes.

### Stage 7 — Full verification and handoff

Run the full proportional validation matrix and create:

- `docs/audits/ui-graph-redesign-verification.md`
- `docs/handoffs/ui-graph-redesign.md`

Gate:

- Every definition-of-done item below has linked evidence or is explicitly listed as a remaining limitation.

## 16. Required tests

### Graph data fixtures

- Empty.
- One node.
- Disconnected components.
- Directed relationships.
- Self-link.
- Parallel links.
- Duplicate node/link IDs.
- Dangling endpoint.
- Long labels.
- Dense hub.
- Realistic held/missing mix.
- Claim/debate expansion.
- 11/12/13 mobile-initial nodes.
- 23/24/25 desktop-initial nodes.
- 59/60/61 mobile-visible-limit nodes.
- 119/120/121 desktop-visible-limit nodes.
- 500 nodes / 2,000 links.
- 1,000 nodes / 4,000 links.

### Pure graph tests

- Canonical data is not mutated.
- Every current node type/state has a visual mapping.
- Every current edge value has a family mapping.
- `ai_inferred` remains provenance.
- Depth-band assignment.
- Prioritized initial neighborhood.
- Expansion and aggregation limits.
- Stable deterministic layout.
- Bounding-box center and fit.
- Horizontal/vertical FOV handling.
- Origin-node focus.
- Minimum camera-target separation.
- Minimum elevation.
- Home canonical pose.
- Zoom scaling relative to active target.
- URL state parsing/restoration.
- Ordered expansion/focus reconstruction.
- Legacy graph URL translation.
- Malformed/dangling data handling.

### Browser graph tests

- Data loading to scene ready.
- Nonblank unmasked pixels plus numeric in-frustum node assertions.
- Initial labels legible.
- Search, select, focus, clear, Fit, Home, Back, and filters.
- Node and link hit testing.
- Inspector and accessible-view parity.
- 3D/2D/List switching.
- Route remount and deep-link restoration.
- Table/List → 3D remount.
- Repeated resize.
- Rapid filter changes.
- Fullscreen.
- Pointer orbit/zoom/pan.
- Touch tap/orbit/pinch/pan.
- Arrange, pin, unpin, and reset.
- Reduced motion.
- Unsupported WebGL.
- `webglcontextlost`.
- `webglcontextrestored` without duplicate renderer/lifecycle resources.
- Stale async cancellation.
- Repeated mount/unmount cleanup.

Do not mask the graph canvas in all visual coverage. Use deterministic frozen coordinates for visual regression. Combine screenshot review with camera/frustum/data assertions; pixel variance alone is insufficient.

Run real-GPU performance measurements separately from headless CI and record the machine/browser. Do not present headless GPU timing as the production performance result.

### Signed-in journey tests

1. Onboarding → batch upload → duplicate choice → progress → metadata confirmation → Reader → retry/reprocess → Trash → restore → guarded permanent-delete flow.
2. Resume reading → switch Published Edition/Interactive Reader/original PDF or file/split view → outline → apparatus/term/generated note/annotation/claim → evidence/source → note/highlight/bookmark → grounded Ask Library answer → return to the same saved position and representation.
3. Library search/filter → distinguish uploaded from cited-only → inspect credibility/provenance/access → set reading state → upload a missing source.
4. Create Research project without browser prompt → add/remove members and question → corpus → extract claims → real job progress → review/correct claim → detect relationships → debate/chamber → hypothesis and gap → monitor → contextual Knowledge Map.
5. Passage → claim → evidence → disagreement → graph → 2D learning Roadmap/Curriculum → Writer insertion, with reversible navigation.
6. For every relationship correction the current data model genuinely supports, verify/dispute/edit/reclassify/remove and confirm provenance/revision history. For any unsupported action, test the explicit unavailable explanation and ensure no nominal or inert endpoint/button is created merely to satisfy this journey.
7. Create Writer project and document → reorder/archive → link Research evidence → insert citation → autosave → restore revision → run every currently supported document/citation export.
8. Use `/ask-library` directly in ordinary and research modes → restore conversation history → open valid `mode`, `claimId`, `clusterId`, and `workIdB` deep links → enter/leave Reader without mounting a second conversation controller.
9. Account preferences, profile, data-sharing, feedback, usage/plan, account-deletion confirmation, and conditional Admin access remain available.
10. Open representative pre-redesign bookmarks for every route family and every legacy graph state in the compatibility table; confirm deterministic translation rather than merely HTTP success.

Use a risk-based matrix rather than a combinatorial cross-product:

- Run every journey end to end in desktop Chromium at 1440px and in one appropriate guided-mobile viewport, alternating 375px and 320px so both are covered.
- Run the Reader, Research, Writer, and Knowledge Map cross-workflow journeys additionally at 1024px and 768px.
- Run critical-route smoke coverage in Chromium, Firefox, and WebKit at desktop and one mobile viewport.
- Cover light and dark themes on every major surface, but use targeted visual/integration cases rather than repeating every full journey in both.
- Cover reduced motion explicitly for shell navigation, Reader, Knowledge Map camera/layout, sheets/drawers, and Writer.
- Run keyboard-only completion for one full Read journey, one Research/Graph journey, one Write journey, command search, account deletion confirmation, and every dialog/drawer pattern.
- Exercise long titles plus loading, empty, partial, error, retry, unauthorized/unavailable, and large-data states through targeted component/integration cases and at least one end-to-end recovery path each.
- Perform representative manual VoiceOver walkthroughs for Home/Read navigation, Reader passage evidence, Research claim/debate, Knowledge Map semantic List/inspector, and Writer evidence insertion.
- Document the pairwise/risk rationale so an omitted combination is deliberate rather than accidental.

## 17. Accessibility requirements

- WCAG 2.2 AA.
- Complete keyboard access through navigation, command palette, toolbar, search results, filters, 2D/List, inspector, corrections, dialogs, drawers, and sheets.
- Canvas must not create a keyboard trap.
- Visible, predictable focus.
- DOM/List focus highlights the corresponding graph node without stealing focus.
- Hover content is also available on focus and tap, dismissible with Escape, and persistent long enough to inspect.
- Polite concise live-region updates for loading, result counts, selection, filtering, jobs, errors, and fallback.
- Color is never the only state, type, direction, or relationship cue.
- Reduced motion produces a pre-settled graph, no camera tween, and no decorative motion.
- Use an equal-capability semantic 2D/List representation because WebGL canvas content is not inherently available to assistive technology.
- Paginate or virtualize large semantic results.
- Run automated accessibility checks and manual keyboard and VoiceOver walkthroughs. Automated axe results alone are not sufficient.

## 18. Completion evidence and definition of done

Provide:

- Baseline audit.
- Route and capability preservation matrix.
- Renderer bakeoff report.
- Chosen renderer rationale.
- Before/after screenshots at all required viewport classes and both themes.
- Unmasked graph screenshots and short interaction recordings.
- Camera/frustum test results.
- Actual corpus-size report.
- Performance benchmark report.
- Typecheck, lint, build, unit, integration, and browser results.
- Accessibility results, including manual keyboard and VoiceOver notes.
- Bundle-size comparison.
- Compatibility/redirect notes.
- Commit map by stage.
- Honest unresolved limitations and follow-up risks.

Do not call the work complete if:

- The graph can still open blank, edge-on, or inside itself.
- Home/Reset can preserve a bad bearing.
- Nodes cannot be reliably discovered or selected on touch.
- The graph canvas is hidden below a wall of controls.
- Any primary task requires the semantic fallback because the 3D implementation is broken.
- The fallback cannot complete the same scholarly task.
- The entire corpus opens without context or aggregation.
- Missing sources appear to have full text.
- Credibility, popularity, mastery, and inference are conflated.
- Any existing signed-in capability is silently removed.
- Tests pass but the named journeys remain confusing or unusable.
- Evidence consists only of masked screenshots, wrapper assertions, or empty states.

## 19. Authoritative implementation references

Use these primary references while implementing:

- React Force Graph API: https://github.com/vasturiano/react-force-graph
- `react-force-graph-3d` package: https://www.npmjs.com/package/react-force-graph-3d
- `d3-force-3d` and worker guidance: https://github.com/vasturiano/d3-force-3d
- React Three Fiber performance pitfalls: https://r3f.docs.pmnd.rs/advanced/pitfalls
- React Three Fiber scaling: https://r3f.docs.pmnd.rs/advanced/scaling-performance
- Three.js `InstancedMesh`: https://threejs.org/docs/pages/InstancedMesh.html
- Three.js `Raycaster`: https://threejs.org/docs/pages/Raycaster.html
- Three.js `OrbitControls`: https://threejs.org/docs/pages/OrbitControls.html
- Graphology algorithms: https://graphology.github.io/standard-library/
- Sigma documentation, noting that Sigma is 2D: https://www.sigmajs.org/docs/
- 2024 3D graph viewpoint evaluation: https://doi.org/10.1111/cgf.15077
- 2025 preferred-viewpoint study: https://doi.org/10.4230/LIPIcs.GD.2025.37
- WebGL best practices: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
- WebGL context loss: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextlost_event
- HTML canvas fallback requirements: https://html.spec.whatwg.org/multipage/canvas.html
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Playwright accessibility testing: https://playwright.dev/docs/accessibility-testing

Proceed through the stages autonomously, preserve valid product semantics, and optimize for a graph and application that a scholar can actually understand and use.
