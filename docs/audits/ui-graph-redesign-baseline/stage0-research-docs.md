# Stage 0 — Research-Repo Document Digest

Lane: read-only research-docs audit. Prepared 2026-07-27 for Stages 3–6 of the UI/graph redesign program.

Sources read in full:
- **BRIEF** = `/Users/hyderhusainarastu/Project/Palimnote_Research/palimnote-scholarlens-hybrid-brief.md` (704 lines) — AUTHORITATIVE (subject to the program prompt).
- **OLD-PROMPT** = `/Users/hyderhusainarastu/Project/Palimnote_Research/research/graph_rebuild_prompt.md` (249 lines) — SUPERSEDED handoff, authored 2026-07-25, mined here only for still-useful domain facts.

Authority order for later stages: **program prompt > BRIEF > OLD-PROMPT**.

---

## Part 1 — The Hybrid Brief (authoritative content)

### 1.1 The six knowledge-graph layers (BRIEF "Knowledge graph" section, lines 428–458)

Quoted exactly, in the brief's own order:

1. **Intellectual layer** (line 432): "Works, authors, concepts, traditions, influences, and historical contexts." (line 434)
2. **Claim layer** (line 436): "Claims, premises, objections, replies, support, qualification, and contradiction." (line 438)
3. **Evidence layer** (line 440): "Passages, quotations, data, examples, methods, and sources." (line 442)
4. **Debate layer** (line 444): "Questions, positions, controversies, interpretations, and unresolved issues." (line 446)
5. **Learning layer** (line 448): "Prerequisites, mastery states, curricula, and recommended routes." (line 450)
6. **Research layer** (line 452): "Gaps, hypotheses, proposed investigations, and writing projects." (line 454)

Framing sentence (line 430): "The hybrid would use one multilayer knowledge graph." — one graph, multiple layers; not six separate graphs.

**Mapping to the program prompt's depth bands** (indices -2..3: evidence / intellectual / claims / debates / learning / research): every band has an exact BRIEF layer counterpart; only the *ordering/indexing* is the program prompt's own addition. The BRIEF lists Intellectual first and Evidence third; the program prompt puts evidence at -2 (deepest/most granular) and intellectual at -1. This is an ordering refinement, not a semantic conflict — but Stages 3–6 must use the program prompt's band order and indices, not the brief's listing order.

### 1.2 Progressive-disclosure rules (contract-like; lines 456–458)

Quoted exactly:
- "The graph should use progressive disclosure. It should open with a manageable question-centered or passage-centered map. Users could then expand positions, claims, sources, passages, concepts, and evidence as needed." (line 456)
- "The system should never open a large corpus as an undifferentiated network of thousands of nodes." (line 458)

Related disclosure rule at field level (line 135): "The user could begin at this field level and progressively expand into individual claims, works, sections, and source passages."

Risk framing (lines 624–626, "Graph overload"): "Large corpora may produce unusable interfaces." Controls list (line 648) includes "progressive disclosure" explicitly.

**Potential contradiction for the moderator (authority: program prompt wins):**
- BRIEF line 456 says the graph "should open with a manageable **question-centered or passage-centered** map." The program prompt specifies **context-first entry**. If "context-first" means opening on the currently-read work/passage's context, it is compatible with the "passage-centered" arm; if it means something other than question- or passage-centering (e.g., an intellectual-context band as the landing view), the program prompt overrides the brief's two-option wording. Flagged; not resolvable from the documents alone.
- BRIEF gives **no numeric** initial-disclosure budget — only "manageable" and "never ... thousands of nodes." The program prompt's **24/12-node initial disclosure** is a strict refinement, not a contradiction; treat 24/12 as the binding number.

### 1.3 Core workflows

**The defining spine** (line 12, quoted exactly): "Passage -> claim -> evidence -> disagreement -> field map -> research gap -> reading or investigation plan -> grounded writing".

**Forward direction, passage → field** (line 26): "A user examining a passage should be able to see the claims associated with it, discover how other sources support or contest those claims, understand why researchers disagree, determine what remains unresolved, and move the resulting evidence into a reading plan or writing project."

**Reverse direction, field → passage** (line 28): "A user examining a field-level debate should be able to move in the opposite direction. They should be able to open any claim, inspect its source sentence, read the surrounding argument, examine the document's notes and references, assess its credibility, and annotate the source directly."

**The contract sentence** (line 30): "This bidirectional movement between passage and field is the defining capability of the combined product."

Continuity restated as the product's value (lines 681–685): "A user could begin with a sentence and reach a field-level debate without losing the sentence." / "A user could begin with a field-level debate and reach the decisive source passages without losing the larger question." / "...move from either starting point into a research plan or written argument without losing the evidence chain."

**Two entry modes** (lines 185–225):
- **Deep Read** (lines 189–204): 10-step workflow from "Import the work" through "Reveal related claims and debates from the wider library" (step 6), "Generate prerequisite or debate-aware reading routes" (step 8), to "Move the resulting evidence into a writing project" (step 10).
- **Map a Field** (lines 209–223): 12-step workflow from "Define the research question" through "Extract reviewable claims from exact source passages" (step 4), "Open Evidence Chambers for important conflicts" (step 8), "Move important sources into close reading" (step 10), "Promote an unresolved gap into a research project" (step 11).
- Convergence rule (line 225): "Both modes would operate on the same underlying project. A close-reading project could expand into a literature review, while a field-mapping project could narrow into close examination of a decisive passage."

**Passage classification in Read** (lines 65–80): on selecting a passage the system may identify scholarly functions (Claim, Evidence, Definition, Premise, Conclusion, Objection, Reply, Qualification, Methodological statement, Interpretive move, Historical assertion, Prerequisite concept); "The user could accept, revise, split, merge, reject, or reclassify these suggestions." (line 80)

**Debate-aware learning route** (lines 462–475): a 10-step route ending "Promote the judgment into a research or writing project" — the learning band's workflow connective tissue between debates and research.

### 1.4 Evidence requirements (contract-like)

- Shared foundation (line 40): the three workspaces "would share one library, one source-identity system, one evidence store, one knowledge graph, and one project model."
- (line 257): "The most important part of the merger is the shared evidence model."
- (line 259): "Every scholarly object should remain connected to its origin."
- Canonical object shapes (lines 261–341): **Work** (canonical bibliographic identity, edition, contributors, import source, resolution status, rights); **Passage** ("Stable quotation anchor", location, surrounding context, document role, edition identity, extraction history — lines 278–283); **Claim** (claim text, type, "Source passage", authorial stance, scope, confidence, "Extraction method and version", review state, "Correction history" — lines 288–296); **Relationship** (source claim, target claim, type, direction, scope, "Supporting evidence", confidence, review state, "User corrections" — lines 302–310); **Evidence Chamber** (lines 314–328); **Research gap or hypothesis** ("The claims that generated it", "The evidence already inspected", the reason, missing evidence, "Machine-generated, user-edited, or expert-verified status" — lines 332–341).
- Grounded assistant rule (line 509): "Every answer should cite exact passages. If the available library does not contain sufficient evidence, the system should say so explicitly instead of producing an unsupported answer."
- Writer's central function (line 183): "The system's central writing function would be maintaining the evidence chain. It could help draft prose when explicitly requested, but its more important responsibility would be showing what supports each statement and where the argument remains incomplete."
- MCP evidence bar (lines 585–599): first release "should prove the complete evidence chain on a narrow corpus," including "Stable anchors", "Visible unresolved citations", "Reviewable claim extraction", "Citation integrity", "Quality and correction instrumentation."
- Anti-risk controls (line 648): "exact anchors, visible uncertainty, discipline-aware taxonomies, human review, progressive disclosure, permission-aware retrieval, background processing, and explicit quality gates."

### 1.5 Evidence Chamber (lines 387–426)

"The Evidence Chamber would be the central research interface for understanding disagreement." (line 389). Per-position display (lines 395–404): precisely stated claim, source, "Exact passage", surrounding context, evidence, method, scope, confidence, credibility indicators, review status. Then six structured sections (lines 408–424): **Shared ground / Point of divergence / Possible reconciliation / Unresolved question / Missing evidence / Next action**. Neutrality contract (line 426): "The system should not automatically declare a winner. It should help the user understand the structure of the disagreement and reach an informed judgment."

### 1.6 Claim and disagreement taxonomy (lines 343–385)

Claim types (lines 349–362, 13 values): Empirical finding, Textual assertion, Interpretive claim, Historical claim, Conceptual claim, Normative claim, Definition, Premise, Conclusion, Objection, Reply, Qualification, Methodological claim, Speculative proposal.
Relationship types (lines 366–383, 16 values): Supports, Corroborates, Reproduces, Directly contradicts, Partially contradicts, Qualifies, Narrows, Revises, Challenges an assumption, Offers a rival explanation, Uses a different definition, Interprets differently, Applies under different conditions, Fails to replicate, Appears inconsistent, Is uncertain or requires review.
Rationale (line 385): "Two scholars may appear to contradict one another while actually using a term differently, addressing different passages, or operating at different explanatory levels." — false-contradiction avoidance is the #1 named risk (lines 616–618).

### 1.7 Correction model (lines 511–539, contract-like)

- (line 513): "Every generated object should remain reviewable."
- User operations (lines 515–528): "Verify / Dispute / Edit / Split / Merge / Hide / Restore / Reclassify / Add evidence / Remove an incorrect relationship / Mark an object as uncertain / Request reprocessing."
- Non-destructive rule (line 530): "Corrections should not silently overwrite the original output." Preserved fields (lines 532–538): "Original generated version / Model or rule version / User-edited version / Editor identity / Time of change / Reason for correction / Current authoritative state."
- (Note: the app's shipped `research_revision` spine + `applyResearchCorrection` already implements this — see PROJECT-LOG 2026-07-26 Phase 29 entry — so Stage 3+ UI must surface, not invent, this model.)

### 1.8 Credibility rules (lines 540–553, contract-like)

- (line 540): "Credibility should also remain multidimensional. The system should not collapse trust into one score."
- Dimensions (lines 544–552): Publication rigor, Author expertise, Host or venue provenance, Evidence strength, Inspection depth, Relevance, Pedagogical value, Popularity.
- (line 553): "Popularity should remain separate from credibility." — hard rule, mirrored in code (see Part 2 §2.1).

### 1.9 Product structure & scope caveat

Three workspaces sharing one graph (lines 34–40): Palimnote Read / Palimnote Research / Palimnote Write. Read's responsibilities include "Connections to claims and debates elsewhere in the library" (line 61) and "The original text would remain central. Machine-generated analysis would appear around the text without replacing it." (line 63). Research organizes "around the questions it is attempting to answer rather than presenting only a list of documents" (line 106). Scope note (line 704): the brief synthesizes public descriptions; absent capabilities "should be validated through product and technical discovery" — i.e., the brief is a product target, not a code inventory.

### 1.10 Brief-vs-program-prompt conflict summary (moderator action list)

1. **Entry centering**: brief's "question-centered or passage-centered" opening (line 456) vs. program's context-first entry — program wins; note the brief never uses the phrase "context-first."
2. **Layer ordering/indexing**: brief has no ordering semantics or indices for its six layers; the program's -2..3 depth-band indexing (evidence deepest) is new and binding. The brief lists Intellectual first — do not carry that listing order into band order.
3. **Disclosure budget**: brief is qualitative ("manageable", "never ... thousands"); program's 24/12 initial-node budget is binding and strictly compatible.
4. **Band naming**: program uses "claims"/"debates" (plural) vs. brief's "Claim layer"/"Debate layer" — cosmetic only.
5. No other contradiction found: bidirectionality, evidence anchoring, correction model, credibility separation, and progressive expansion are all consistent with the program prompt as described.

---

## Part 2 — The Superseded Graph-Rebuild Prompt (facts to keep, instructions to drop)

Provenance: authored 2026-07-25 "from verified code inspection ... All file paths, enum values, and cost figures below were confirmed against the actual source on 2026-07-25" (OLD-PROMPT line 3). Two days of heavy merging (Phases 27–30, migrations through 0045/ledger 46) have passed since; each factual item below is marked verified-current, stale, or COULD NOT VERIFY.

### 2.1 Domain constraints and factual details still useful

- **Purpose statement worth preserving** (lines 25, 30): the graph "externalize[s] ... a relational, prerequisite-aware map"; "Its organizing semantics are pedagogical, not bibliometric." And line 31: "Nothing in the graph should be more than one click from the text that justifies it." — all consistent with BRIEF evidence rules; safe to reuse as design language.
- **Owner-scoping constraint** (lines 29, 163): graph is "built only from what the user has actually uploaded (owner-scoped)" and "The current codebase enforces this entirely at the application/query level (there is no database-level row-level security)". Verified-current in spirit: PROJECT-LOG's standing design and current schema comments still show per-user `user_id` indexing (e.g. `research_claim_user_idx`, `/Users/hyderhusainarastu/Project/AutoCriticalEditionProject/packages/db/src/schema.ts:3106`).
- **Ten-category relationship enum, verbatim** (OLD-PROMPT lines 47–58 / 195–208): `explicit_reference, secondary_scholarly_recommendation, historical_context, prerequisite, conceptual_influence, disagreement_polemical_target, interpretive_aid, parallel_comparison, optional_extension, ai_inferred`. Verified-current: `relationshipCategoryEnum` still defined with these values in `packages/db/src/schema.ts` (grep confirms `relationship_category` enum present; exact-value re-verification is a Stage 1 code-lane job).
- **Separate structural `edgeTypeEnum` superset** (lines 210–217): 14 values incl. `translates`, `is_edition_of`, `is_prerequisite_for` — the graph's edge vocabulary is NOT the ten-category vocabulary; `CATEGORY_TO_EDGE` maps between them (line 190, `apps/worker/src/crossLibraryGraph.ts`).
- **Held vs. cited-only distinction** (lines 39–40): uploaded works are "primary citizens"; cited-but-unheld works "must be visually distinct ... A user should be able to tell at a glance which nodes represent their own material and which represent gaps." Matches PROJECT-LOG's missing-link definition; durable product vocabulary.
- **Edge metadata contract** (lines 63–69): confidence, verification status, provenance (model vs. "deterministic rule-based fallback" — "never presenting a heuristic/rule-based classification as if it were a model judgment"), evidence anchors. Durable; matches app-wide provenance discipline.
- **Credibility model facts** (lines 222–224): authority bands `"A"|"B"|"C"|"D"|"E"` in `packages/research/src/credibility.ts` ("a deterministic function of the source's nature — NEVER its popularity"); six `CredibilityDimensions` in `packages/research/src/credibilityV3.ts` (`publicationRigor, creatorExpertise, hostProvenance, evidenceStrength, relevance, pedagogicalValue`) with `popularity` as "a sibling field, never folded into the scoring dimensions." COULD NOT VERIFY the claimed "dedicated unit test asserting popularity cannot leak into ordering" (reported secondhand even in OLD-PROMPT — "there is reportedly a dedicated unit test", line 224); a Stage 1 code lane should confirm.
- **Cost-bounding constants** (line 189, `apps/web/src/lib/graphExpansion.ts` as of 2026-07-25): automatic ≤20 candidates and ≤$0.25 estimate; manual ≤100 candidates, confirmation required over $1; $5 hard cap; $0.0125 per-pair budget reservation. COULD NOT VERIFY still exact — not re-read this session; treat as approximately right, re-verify before relying on numbers.
- **Judgment caching** (line 190): cross-library classification cached "keyed on a SHA-256 hash of the evidence basis" — identical evidence pairs never re-classified. Consistent with `basisHash.ts` now in `packages/claims/src/` (file listing confirmed this session).
- **Canonical identity lesson (D-20-62)** (line 241): graph once duplicated nodes by grouping on raw bibliographic-record ID instead of canonical `work_key` (`packages/research/src/workIdentity.ts`); rule to keep: the graph must use "the single canonical [identity] also used elsewhere in the app ... do not let the graph quietly re-invent its own, second notion of 'same work.'"
- **Referential-stability rendering constraint** (line 175): in `react-force-graph-3d`, "`nodeThreeObject`/`linkThreeObject` accessor identities must stay referentially stable (the library rebuilds every 3D object from scratch if they change)", so per-frame visual changes go through a `userData`-tagged `scene().traverse()` mutation pass. Still relevant if the rebuild stays on that library.
- **Real corpus/claim substrate**: `generated_claim`/`claim_evidence` (claimType `"factual"|"interpretive"|"inferred"`, evidence stance `"supports"|"contradicts"`) and `work_claim` (line 218–219) existed pre-Phase-25; the doc's note that `work_claim` "is already the intended substrate for claim-level graph relationships" is historically true but now materially superseded by the shipped Phase 25+ tables (`research_claim`, `claim_relationship`, `debate_cluster`, `claim_pair_candidate` — all present in `packages/db/src/schema.ts:2456-2457, 3049`).
- **Component inventory** (lines 174–191): file paths for `KnowledgeGraph3D.tsx`, `GraphAccessibleFallback.tsx`, `GraphView.tsx`, `GraphInspector.tsx`, `graph/types.ts`, `roadmapLayout.ts`, `graphForces.ts`, `lib/graph.ts`, graph pages/API routes, `RoadmapConstellation.tsx` (deliberately-separate 2D roadmap canvas). Useful as a starting map; line counts and internals are as-of-2026-07-25 and must be re-inventoried by the Stage 1 code lane (a "Graph redesign P0" and the v.5 UX-redesign program have touched this area since, per PROJECT-LOG changelog notes).
- **Accessibility precedent** (lines 136–138, 243): 2D/tabular fallback with "full parity", keyboard traversal, reduced-motion mode, "Zero automated accessibility-scan violations (axe or equivalent) is the bar"; extend `apps/web/e2e/accessibility-sweep.spec.ts` rather than starting parallel suites. Durable — matches the app's standing mandatory-fallback rule.
- **Layout-memory principle** (line 93): "Deterministic-enough layout that a returning user recognizes their graph" (seed from stable node IDs / persist positions) — a good principle independent of the superseded physics mandate.

### 2.2 Instructions explicitly SUPERSEDED (do not carry into Stages 3–6)

Named concretely as they appear in the text:

1. **The Opening Directive itself** (lines 7–13): "Ignore all previous instructions, plans, or partial work concerning the knowledge graph" and its ground-up-rebuild framing, plan-first process requirement, and review-agent latitude ("your call, but state which you did", line 13). The new program prompt defines the process now.
2. **"Your call" visual latitude** — every discretionary encoding grant: line 40 ("different color/shape/opacity — your call on the exact encoding"), line 60 (directionality "use your judgment, but be deliberate"), line 100's channel suggestions ("e.g., a ring, saturation, or halo"). The new program's design decisions replace this open latitude.
3. **Global-force-first default** (line 83): "the graph's default/exploratory view should be force-simulated" with a hierarchical mode as secondary (line 83, §6.3 reference) — superseded by the program's six semantic depth bands (-2..3) and context-first entry; the default view is now band-structured, not a global force blob. Likewise the detailed force menu of §4 (lines 85–93: confidence-scaled attraction, clustering gravity, directional prerequisite bias, etc.) is advisory only where it conflicts with band layout.
4. **Optional claims treatment** (line 41): "Concept/claim nodes (optional, but strongly encouraged...)" — superseded: claims are a mandatory band (index 0) in the new program, and the shipped Phase 25–28 claims engine makes them first-class data, not an option.
5. **Initial-disclosure silence**: OLD-PROMPT never sets an opening-node budget (its §6 navigation model assumes the whole owner-scoped graph is loaded and filtered) — superseded by the program's 24/12-node initial disclosure and progressive expansion.
6. **Stale file/version/state assumptions** (all "verified 2026-07-25", now outdated):
   - `packages/db/src/schema.ts` "2377 lines total" (line 193) — now **4077 lines** (verified this session: `wc -l`).
   - Feature-flag inventory limited to `PHASE_12_FEATURE_FLAGS` (lines 226–237) with `crossLibraryGraph` "default off" — `packages/config/src/phase25.ts` now exists (`PHASE_25_FEATURE_FLAGS`, exported from `packages/config/src/index.ts:21`), and PROJECT-LOG records Phase 25 flags enabled in production 2026-07-26. Flag-state claims must be re-read, not trusted.
   - "No browser Web Worker is currently used" (lines 131, 239) — COULD NOT VERIFY still true post-v.5-graph-redesign work; re-check before relying on it.
   - Exact package versions (line 239: Next.js 16.2.10, React 19.2.4, `react-force-graph-3d` ^1.29.1, `three` ^0.185.1, `d3-force-3d` ^3.0.6, Node 24.18.0) — plausible but not re-verified this session; re-read `apps/web/package.json` in Stage 1.
   - The claim/evidence substrate framing around `work_claim` (line 219) — superseded by shipped `research_claim`/`claim_relationship`/`debate_cluster` tables (schema.ts:3049, 2456–2457) and `packages/claims` (real directory, verified this session).
   - The `@react-three/fiber` revert note (line 130) cites a PROJECT-LOG entry "dated 2026-07-25, 'Graph redesign P0'" — that changelog entry has since been moved to `docs/CHANGELOG.md` per the 2026-07-27 archive note; the pointer, not necessarily the fact, is stale.
   - `external-reference/` directory pointer (line 245) — COULD NOT VERIFY it still exists; check before citing.
   - Component line counts (KnowledgeGraph3D "~1700 lines", GraphView "~1260 lines", etc., lines 175–186) — point-in-time; do not quote as current.
7. **Multi-agent decomposition and demo checklist** (§9, lines 140–159): the five-agent split, integration-phase requirement, and demo checklist were process for the old handoff; the new program has its own staging (Stages 0–6). The underlying *test expectations* (unit tests for graph transforms, interaction smoke tests, zero-axe-violation bar) remain good practice and align with repo standards.
8. **Aesthetic acceptance criterion as stated** (line 105: "modern, restrained, and readable ... something you will be asked to demonstrate at the end of this task") — the sentiment survives; the specific demo obligation belongs to the dead handoff.

---

## Verification boundary

- Both documents read in full (704 + 249 lines).
- Repo checks run read-only this session: `wc -l packages/db/src/schema.ts` (4077); grep confirming `research_claim`/`claim_relationship`/`debate_cluster` in schema.ts (lines 2456–2457, 2736–2768, 3049–3108); `packages/claims/src` directory listing; `PHASE_25_FEATURE_FLAGS` export at `packages/config/src/index.ts:21`.
- NOT re-verified this session (flagged inline above): exact current ten-enum values byte-for-byte, graphExpansion cost constants, package versions, Web Worker absence, the popularity-ordering unit test, `external-reference/` existence, current graph-component line counts/internals. These are Stage 1 code-lane work.
- No files modified anywhere outside this scratchpad; no paid API calls; no production access of any kind.
