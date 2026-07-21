# Interactive Critical Edition — Implementation Plan

## Context

The user wants a production-quality web application that helps readers understand difficult scholarly works (philosophy, monographs, research articles) by automatically generating an "interactive critical edition": an annotated reader that surfaces explicit citations, implicit intellectual context, and secondary literature, then turns that into a personalized, priority-ranked reading roadmap. The working directory is empty (true greenfield, not yet a git repo). The user gave an extremely detailed 26-section specification; this plan's job is to turn that spec into a buildable architecture and phased roadmap without dropping any requirement, and to resolve the ambiguous points the spec explicitly asks to have resolved (stack choice, reference-project license analysis, etc.).

**Resolved via research and clarifying questions this session:**
- GitHub repo name: `interactive-critical-edition`, created under `hyderhusainarastu` (already authenticated via `gh`), **private**.
- Infra stack: **Vercel + Supabase + Render** (confirmed by user).
- AI providers: **multi-provider from day one — OpenAI and Anthropic**, because the user already holds OpenAI credits and wants to use whichever is convenient per task, not pay twice for the same call.
- Auth: **Auth.js (NextAuth) backed by our own Postgres tables**, not a managed auth vendor.
- A public reference project surveyed for prior art has **no LICENSE file** — confirmed via a GitHub API check (404 on the license endpoint, `license: null` in repo metadata) — despite an MIT badge image in its README with no actual license text anywhere in the repo. Verdict: **treat as all-rights-reserved. No code or verbatim text will be copied.** Its publicly described architecture (FastAPI, Next.js, Supabase Postgres+pgvector, hybrid BM25+embedding retrieval, two-stage LLM-judge classification, claim-level provenance, evidence-strength scoring alongside LLM verdicts) is used only as **prior art for architectural ideas**, which is not a licensing concern.
- Filesystem check on this machine: creating a test file and reading it back under a different letter-case succeeded → **this disk is case-insensitive APFS**, so two variously-cased requested filenames are the same directory entry here and cannot coexist as distinct files. This is handled explicitly in §3 and §29 rather than silently dropped.
- **3D knowledge-graph visualizer (added by explicit user request):** a dedicated, per-user, separate-tab 3D node-graph view of a work's relationships to other works, figures, concepts, and traditions — showing read/unread status and flagging missing links (referenced-but-unacquired works). This is reconciled with the brief's "avoid excessive 3D effects" instruction as follows: that instruction targets gratuitous decorative 3D (the landing page stays free of it, matching the brief's explicit contrast with the reference project surveyed in §4); this is one deliberate, opt-in, purposeful data-visualization tool living behind login, not ambient UI chrome, and it is built restrained (damped camera, no forced auto-rotation, calm palette-consistent colors) with a non-3D fallback for accessibility (§20). Full design in §9, §16, §17, §19, §23 Phase 5.
- **Cost constraint (explicit design constraint, not a soft preference):** optimize for lowest cost at current (single-user) scale, on both infrastructure and AI-token spend equally, accepting that some service tiers may need upgrading later as usage grows. The user explicitly does **not** want to trade this for less dev/ops burden — managed services (Vercel/Supabase/Render) stay as decided; the savings come from *tier* and *routing* choices, not from self-hosting. No fixed dollar ceiling was given, so this plan optimizes structurally (cheapest viable tier per service, cheapest-by-default model routing, aggressive caching) and surfaces actual spend via the admin cost dashboard (§20/§22) so the user can set a real ceiling once they see real numbers. This reshapes §5, §11, and §22 below.

---

## 1. Product Definition

A web application where a user uploads a primary scholarly text (book, article, monograph) and receives:
1. A **reader** that renders the text with original notes intact, plus layered AI- and user-generated annotations that link out to background/context/secondary works, each annotation tagged with a relationship type, confidence, and provenance back to the exact passage that triggered it.
2. A **reading roadmap**: a personalized, dependency-ordered, priority-ranked list of what to read before/alongside/after the primary text, computed from a prerequisite graph and the user's own recorded knowledge.
3. A **personal knowledge profile**: per-user, per-work (and per-concept) understanding ratings that feed back into roadmap generation so the system stops recommending what the user already knows.
4. A **multi-work workspace**: every uploaded text gets its own reader, roadmap, bibliography, and annotation set, navigable via sidebar/tabs/search, with split-pane reading across two works at once.

Explicitly **not** a substitute for reading primary sources, and the product must say so — every AI-generated claim carries confidence and provenance rather than being presented as settled scholarship.

## 2. Requirement Inventory (coverage checklist)

Every numbered section of the user's brief maps to a plan section below; nothing is dropped.

| Brief §  | Topic | Covered in |
|---|---|---|
| 1 | Project log init | §3 (assumption), §23 Phase 0, §29, §30 |
| 2 | GitHub repo, git hygiene, checkpoints | §23 (every phase), §29, §30 |
| 3–4 | Core concept, Heidegger/Vico examples | §1, §13 (roadmap algorithm uses these as test cases), §25 risk R1 |
| 5 | 10 relationship categories, evidence/confidence/provenance | §12 |
| 6 | Reading roadmap system | §13 |
| 7 | Personal reading catalogue / knowledge profile | §9 (schema: `reading_records`, `understanding_ratings`), §13 |
| 8 | Multi-work workspace, tabs, split view | §16, §17, §18 |
| 9 | Reader / interactive critical edition | §18 |
| 10 | Ingestion & document processing | §10 |
| 11 | Scholarly discovery / bibliographic APIs | §11, §6 (comparison table) |
| 12 | AI reliability, anti-hallucination | §11, §12, §21 (eval harness) |
| 13 | Knowledge graph model | §9 (hybrid relational+edge-table design), §16/§17/§19/§20/§23 Phase 5 (3D visualizer, added by explicit user request) |
| 14 | Auth, accounts, persistence, security | §14, §15 |
| 15 | Landing page | §16, §19 |
| 16 | Visual design | §19 |
| 17 | Technical direction / stack comparisons | §5, §6 |
| 18 | Core user flows | §18 (reader flow), §13 (roadmap flow), embedded in phase acceptance criteria §23 |
| 19 | Search, export, research utilities | §16 (pages), §26/§27 (MVP vs post-MVP split) |
| 20 | Admin & observability | §16 (admin pages), §22 |
| 21 | Testing | §21 |
| 22 | Performance & scalability | §22, §25 |
| 23 | Privacy, copyright, ethics | §15 |
| 24 | Implementation phases | §23 |
| 25 | This planning document itself | entire document |
| 26 | Working rules post-approval | §30, and restated in docs/PROJECT-LOG.md itself |
| — | *Added after initial planning, not in the original 26-section brief:* 3D knowledge-graph visualizer | §9, §16, §17, §19, §20, §23 Phase 5 |
| — | *Added after initial planning, not in the original 26-section brief:* independent educational companion site | §23 Phase 11, §31 |
| — | *Redefined 2026-07-19, completed 2026-07-20:* Phase 9 = Interactive Learning Workspace, sub-phases 9.1–9.7 (9.8 "Comprehensive dossier" retired as a phantom requirement — never enumerated anywhere it was referenced by count — before implementation) | §23 Phase 9, §34 |
| — | *Added 2026-07-20:* Phase 10 = Workspace Depth & Adaptivity Completion (closes the concrete gaps 9.1–9.7 left in Phase 9's own original objective, rather than inventing new scope) | §23 Phase 10, §35 |
| — | *Redefined this session:* Phase 8 = Critical Edition Recovery, Autonomous Research & Public-Source Discovery (repairs + autonomous critical-edition generation) | §23 Phase 8, §33 |

## 3. Assumptions and Resolved/Open Decisions

**Resolved this session (see Context):** repo name, infra stack, AI providers, auth approach, reference-project license verdict, project-log filesystem-casing constraint.

**Assumptions made to keep the spec buildable (flagged per the instruction to document and preserve intent):**
- The originally requested second, differently-cased copy of the project log — since this OS is case-insensitive, a byte-identical second file under a different case is impossible locally. Resolution: one canonical file (`docs/PROJECT-LOG.md`) is used; a short note inside it documents the constraint. If the repo is ever cloned onto a case-sensitive filesystem (Linux CI, most Docker containers, or a case-sensitive APFS volume), a same-content symlink under the alternate casing can be added there safely — this is recorded as a documented, non-blocking gap rather than silently skipped.
- Embeddings: use **OpenAI `text-embedding-3-small`** (cheap, good enough, spends down existing credits) via `pgvector`, with the adapter layer allowing a swap to Anthropic-compatible or open-source embeddings later. Not a hard requirement in the brief, but needed to implement §11/§13.
- Object storage for uploads: **Supabase Storage** (S3-compatible, bundled with the chosen Supabase plan) rather than raw AWS S3, to keep the infra surface to the three chosen platforms.
- Background jobs: **pg-boss** (Postgres-backed job queue) rather than adding Redis/BullMQ, since Postgres is already the system of record — one fewer moving part, runs as a Node worker service on Render.
- ORM: **Drizzle ORM** over Prisma — first-class `pgvector` column support and lighter runtime, fits the TypeScript-throughout direction the brief suggests.
- OCR: **Tesseract.js** as the default (free, no per-page cost) with an documented adapter seam for a paid cloud OCR fallback (Google Cloud Vision or AWS Textract) on pages Tesseract scores low-confidence — not built in MVP, stubbed as a fallback interface (see §26/§27).
- Email delivery for verification/reset: **Resend**, chosen for the cleanest Next.js/NextAuth integration and a workable free tier.
- Error monitoring: **Sentry** (frontend + worker), chosen for first-class Next.js and Node support.
- These are all swappable — every external integration in §11 sits behind an adapter interface per the brief's explicit requirement that AI providers (and by extension other vendors) must be replaceable.

**Genuinely open, deferred to Phase 0/1 rather than blocking planning approval** (small, non-architectural, will be resolved in docs/PROJECT-LOG.md as they're decided):
- Exact OpenAI/Anthropic model IDs to pin (will use latest available small/large tiers at implementation time and record the exact IDs used in docs/PROJECT-LOG.md, since model catalogs change).
- Whether social login (Google) is enabled in MVP or added post-MVP — recommendation: defer to post-MVP, ship email/password first, since it's explicitly "optional" in the brief.

## 4. Reference Project Analysis

**Reusable ideas (patterns, not code):**
- Two-stage retrieval (cheap lexical/BM25 filter → expensive LLM judge only on survivors) — directly applicable to our relationship-classification pipeline (§11) to control AI cost, matching the brief's cost-tiering requirement.
- Claim/passage-level extraction with verbatim source text retained alongside the AI verdict, rather than re-summarizing — directly implements the brief's anti-hallucination and provenance requirements (§12).
- A deterministic, non-LLM "second opinion" signal computed alongside the LLM verdict (their evidence-strength score) — same idea applied here as a rule-based confidence floor that doesn't depend on the model's own self-reported confidence.
- Pluggable auth provider pattern, and a provider-abstracted LLM client with BYOK support — validates the plan's own adapter-layer approach (§11, §14).
- Persistent-cache pattern (compute once, re-read indefinitely) — applied to our annotation/roadmap caching strategy (§22).

**Not reused / explicitly rejected:**
- FastAPI backend — this plan uses Next.js API routes + a Node worker instead, to keep one language (TypeScript) across the stack per the brief's "TypeScript throughout" suggestion, which this plan adopts.
- Their claim-graph-only model (paper-vs-paper contradiction detection) is narrower than what's needed here — this product needs a general-purpose prerequisite/context graph across works, authors, concepts, and editions, not just claim contradiction between papers.
- Any literal code, prompts, SQL, or config files — **not inspected file-by-file and not to be copied**, since there is no license granting reuse. If the user later obtains written permission from the author, this can be revisited.
- Its "agentic" framing / heavy custom force-directed graph JS — this plan uses a restrained, non-3D graph visualization per the brief's explicit instruction to avoid that reference project's excessive 3D effects.

## 5. Recommended Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language across web, API, worker, shared packages |
| Frontend framework | Next.js (App Router) | SSR/streaming, file-based routing fits the multi-work workspace nav, deploys natively to Vercel |
| UI components | Radix UI primitives + Tailwind CSS | Accessible-by-default primitives (dialogs, popovers, tooltips — needed for annotation hover cards) + fully custom warm palette via Tailwind tokens |
| Backend API | Next.js Route Handlers (for CRUD/auth) + a standalone Node worker service (for ingestion/AI) | Keeps request/response CRUD simple and colocated; isolates long-running/expensive work so it can't block the web tier |
| Database | PostgreSQL via Supabase | Relational integrity for users/works/annotations, plus... |
| Vector store | `pgvector` extension on the same Postgres | No second database to operate; HNSW index for embedding search |
| Object storage | Supabase Storage | S3-compatible, same platform, signed URLs, no extra vendor |
| Auth | Auth.js (NextAuth) v5, credentials + email verification, own Postgres tables | Full control over email verification/reset flows the brief requires; no vendor lock-in; social login addable later as an Auth.js provider with no schema change |
| Background jobs / queue | pg-boss on Postgres, consumed by a Render worker service | No Redis needed; jobs and data share one transactional store |
| AI providers | OpenAI + Anthropic, behind a common adapter interface | User has OpenAI credits; Anthropic available; task-type routing config decides which handles cheap extraction vs. hard interpretation |
| Embeddings | OpenAI `text-embedding-3-small` (swappable) | Cheap, good quality, spends existing credits |
| PDF rendering | `pdf.js` (Mozilla, Apache-2.0) | Open license, precise text-layer positions needed for annotation anchoring |
| EPUB rendering | `epub.js` | Standard, MIT-licensed |
| 3D knowledge-graph rendering | `react-force-graph-3d` (wraps Three.js + `d3-force-3d`), MIT | Purpose-built for force-directed 3D node-link graphs — physics layout, node/edge styling, and interaction handling out of the box, far less dev time than hand-rolling a `react-three-fiber` scene; free/open-source, matches the cost constraint |
| OCR | Tesseract.js, adapter seam for cloud OCR fallback | Free default; fallback interface documented but not built in MVP |
| Bibliographic data | OpenAlex (primary) + Crossref (DOI resolution) + Open Library/Google Books (book metadata) | See §6 comparison |
| Deployment | Vercel (web) + Render (worker) + Supabase (db/storage) | User-confirmed; managed, low-ops, matches the brief's "avoid architecture that blocks moderate growth" without over-building |
| Email | Resend, **free tier** (3,000 emails/mo) | Clean NextAuth integration; verification/reset volume at single-user scale is far under the free limit |
| Monitoring/errors | Sentry, **free developer tier** | First-class Next.js + Node support; usage monitored so an overage doesn't silently start billing |
| Testing | Vitest (unit/integration), Playwright (+ `axe-playwright` for a11y, cross-browser), Testing Library | Standard TS-ecosystem choices, all free/open-source |
| ORM/migrations | Drizzle ORM + `drizzle-kit` | Native `pgvector` column type, lightweight, generates SQL migrations |

**Cost-tier decisions (per the explicit cost constraint above):** Vercel Hobby tier, Supabase free tier (Postgres + Storage + pgvector, upgraded only if storage/row limits are hit), Sentry and Resend free tiers as noted. The one place a free tier isn't realistically available: Render's free web-service tier spins down on idle and isn't suited to a persistent job-consuming worker, so the worker runs on Render's lowest paid **Starter** instance (~$7/mo) — this is called out explicitly rather than glossed over, since it's the one recurring cost that isn't $0. No managed Redis (pg-boss avoids it), no dedicated vector DB (pgvector avoids it), no premium OCR (Tesseract.js only in MVP) — each of these is also an AI/infra cost-avoidance decision, not just an architectural-simplicity one.

## 6. Comparison of Major Alternatives

**Auth:** Auth.js+own tables (chosen: full control, no vendor cost, brief demands custom verification/reset flows anyway) vs. Supabase Auth (less code but couples auth to Supabase specifically, harder to move later) vs. Clerk (fastest but a paid vendor at scale, another external dependency and data-residency question for a scholarly-privacy-sensitive app).

**Background jobs:** pg-boss on existing Postgres (chosen: zero new infra) vs. BullMQ+Redis (more mature ecosystem, but adds a service to operate and pay for on Render) vs. cloud-native queues (SQS/Cloud Tasks — ties the whole worker tier to one cloud, contradicts the "keep it simple, avoid unnecessary graph-DB-style complexity" spirit of the brief).

**Vector search:** `pgvector` in existing Postgres (chosen, per the brief's explicit "do not introduce a separate graph/vector database unless clearly justified") vs. Pinecone/Weaviate (better at very large scale, unnecessary operational overhead for MVP scale, another vendor and another place private embeddings live).

**Graph representation:** relational tables + a generic typed edge table with recursive CTEs for traversal (chosen — see §9) vs. a dedicated graph database (Neo4j/Memgraph) — rejected for MVP per the brief's explicit instruction to avoid this unless query needs clearly justify it; the schema is designed so a graph DB could be introduced later purely as a read-optimized mirror without changing the source of truth.

**Bibliographic APIs:**
| Source | Access | License/Terms | Use |
|---|---|---|---|
| OpenAlex | Free, no key, generous rate limits | CC0 data | Primary: works, authors, concepts, citation graph |
| Crossref | Free, polite pool with email | Open metadata | DOI resolution, canonical bibliographic fields |
| Open Library | Free, no key | Open data (archive.org) | ISBN/book metadata, public-domain full text links |
| Google Books API | Free tier, key required | Google ToS — metadata/snippets only | Supplementary book metadata/cover images |
| Semantic Scholar API | Free tier, key recommended | Open, rate-limited | Later phase: citation graph cross-check, not MVP |
| CORE / DOAJ | Free | Open access aggregators | Later phase: open-access full-text discovery |
JSTOR/Project MUSE/publisher paywalls have no reusable API for this purpose — the system stores a proper citation and a "not accessible; consider legitimate acquisition" state (per brief §11) rather than attempting access.

**OCR:** Tesseract.js (chosen default, free) vs. Google Cloud Vision/AWS Textract (materially better accuracy on poor scans, per-page cost — kept as an opt-in fallback adapter, not default, to control cost per the brief's cost-control requirement).

**AI providers:** OpenAI + Anthropic (chosen, per user's existing credits and stated preference) behind one adapter interface with per-task-type routing (e.g., cheap-tier model for metadata/citation extraction, strong-tier model for relationship classification and roadmap synthesis) — both configurable per environment variable, neither hardcoded into business logic.

**3D graph visualization:** `react-force-graph-3d` (chosen: purpose-built physics-based 3D node-link rendering, MIT-licensed, React-friendly, minimal dev time) vs. hand-rolled `react-three-fiber` scene (much more flexible but far more implementation time for no clear benefit here, works against the cost/time constraint) vs. a 2D-only graph (rejected — the user explicitly asked for 3D) vs. a commercial graph-visualization SaaS embed (rejected — unnecessary vendor and cost for something this library handles directly).

**Deployment:** Vercel+Supabase+Render (chosen, user-confirmed: fastest to ship, lowest ops burden) vs. full AWS/GCP (more control, materially more setup/IAM work not justified at this stage) vs. self-hosted VPS+Docker (cheapest steady-state, but the user owns patching/backups/scaling, rejected as unnecessary ops burden for a solo project starting out).

## 7. High-Level System Architecture

Three deployable units sharing one Postgres database as the system of record:

1. **Web app (Vercel)** — Next.js. Serves the landing page, authenticated app shell, reader UI, roadmap UI, and CRUD API routes (auth, works metadata, annotations, notes, bookmarks, reading records, roadmap overrides). Enqueues jobs into `pg-boss` for anything slow (ingestion, AI analysis) and polls/streams job status back to the UI.
2. **Worker (Render)** — Node service consuming the `pg-boss` queue. Runs document ingestion (extraction, OCR, structure detection), citation/entity extraction, embedding generation, AI relationship classification, bibliographic API lookups, and roadmap recomputation. Nothing here is user-request-latency-bound.
3. **Database + storage (Supabase)** — Postgres (relational + `pgvector`) is the single source of truth; Supabase Storage holds raw uploaded files and derived assets (extracted page images for OCR review, etc.), accessed only via signed URLs issued after an authorization check in the web/worker tier.

External services accessed only from the worker (never the browser, to keep API keys server-side): OpenAI, Anthropic, OpenAlex, Crossref, Open Library, Resend, Sentry.

## 8. Text-Based Architecture Diagram

```
                         ┌─────────────────────────┐
                         │        Browser           │
                         │  (Next.js client, React) │
                         └────────────┬─────────────┘
                                      │ HTTPS
                         ┌────────────▼─────────────┐
                         │   Vercel: Next.js app     │
                         │  - Landing/App UI (SSR)   │
                         │  - Route Handlers (API)   │
                         │  - Auth.js session/JWT    │
                         └───┬───────────────┬──────┘
                             │ SQL (Drizzle)  │ enqueue job
                             │                │ (pg-boss)
                 ┌───────────▼───────┐  ┌─────▼─────────────────┐
                 │  Supabase Postgres │  │  Render: Worker svc    │
                 │  - relational data │◄─┤  - pg-boss consumer    │
                 │  - pgvector index  │  │  - ingestion pipeline  │
                 │  - pg-boss queue   │  │  - AI adapters         │
                 └─────────┬──────────┘  │  - bibliographic APIs  │
                           │             └──────┬───────┬────────┘
                 ┌─────────▼──────────┐         │       │
                 │  Supabase Storage   │◄────────┘       │
                 │  (uploaded files,   │                 │
                 │   signed URLs)      │      ┌──────────▼──────────┐
                 └─────────────────────┘      │  External services   │
                                               │  OpenAI / Anthropic   │
                                               │  OpenAlex / Crossref  │
                                               │  Open Library         │
                                               │  Resend (email)       │
                                               │  Sentry (errors)      │
                                               └───────────────────────┘
```

## 9. Data Model and Schema

Hybrid design per the brief's guidance ("prefer the simplest architecture ... but do not prevent future graph traversal/visualization"): strongly-typed core tables for the entities users directly interact with, plus one generic typed edge table for graph relationships so traversal (recursive CTEs) and future graph-DB mirroring stay possible without redesigning the schema.

**Core entity tables** (all with `id uuid`, `created_at`, `updated_at`; user-owned tables carry `user_id` for row-level authorization):
- `users` (email, password_hash, email_verified_at, preferences jsonb)
- `works` (title, work_type [primary/secondary], canonical metadata: authors, publication info)
- `editions` (work_id, edition_label, translator, publisher, year, isbn/doi)
- `documents` (edition_id, user_id nullable [null = platform-shared public-domain doc], storage_path, mime_type, processing_status, uploaded_by)
- `authors` (name, birth/death dates, external ids: VIAF/OpenAlex author id)
- `chapters` / `sections` (document_id, ordinal, title, start/end position refs)
- `passages` (document_id, section_id, text_content, position refs [page/offset], language)
- `footnotes` (document_id, passage_id, note_type [authorial/editorial], content)
- `concepts` (name, description, external ref e.g. Wikidata/SEP)
- `annotations` (document_id, passage_id, annotation_type [system/user], relationship_category enum, target_work_id nullable, target_concept_id nullable, explanation, confidence numeric, verification_status enum, extracted_source_text, model_used, prompt_version, created_by)
- `citations` (document_id, passage_id, raw_citation_text, resolved_work_id nullable, resolution_source [crossref/openalex/manual/unresolved])
- `bibliographic_records` (external_id, source [openalex/crossref/openlibrary], title, authors, year, access_status enum [open/subscription/metadata_only/user_uploaded/unavailable])
- `reading_records` (user_id, work_id, status enum [planned/reading/completed/abandoned], edition_read, sections_completed jsonb, notes, started_at, finished_at)
- `understanding_ratings` (user_id, work_id nullable, concept_id nullable, score 0-100, label derived, updated_at) — CHECK constraint: exactly one of work_id/concept_id set
- `reading_roadmaps` (user_id, root_work_id, mode [concise/comprehensive], generated_at, params jsonb [time budget/depth/expertise])
- `roadmap_items` (roadmap_id, work_id, priority_tier enum [essential/high/strongly_recommended/contextual/interpretive_aid/comparative/optional], sequence_position, user_override jsonb, hidden boolean, estimated_minutes)
- `notes`, `bookmarks`, `highlights` (user_id, document_id, position refs, content)
- `collections` (user_id, name) and `collection_items` (collection_id, work_id)
- `processing_jobs` (document_id, job_type, status, error, attempts, pg-boss job id)
- `audit_logs` (user_id, action, resource_type, resource_id, metadata, created_at)
- `admin_actions` (admin_user_id, action, target_resource, justification, created_at) — per brief §20's "record and justify any privileged access"

**Generic graph edge table** (implements §13's node/edge model without a separate graph DB):
- `graph_edges` (source_type, source_id, target_type, target_id, edge_type enum [cites/quotes/influences/criticizes/responds_to/presupposes/provides_context_for/interprets/disagrees_with/translates/is_edition_of/is_prerequisite_for/is_comparable_to/is_recommended_by], weight, evidence jsonb, confidence, verification_status, created_by [system/user/editor])

`source_type`/`target_type` reference the core entity tables (`work`, `author`, `concept`, `passage`, `annotation`) by discriminator + uuid — a lightweight polymorphic reference, not a full graph database. Prerequisite-graph traversal for the roadmap algorithm (§13) is a recursive CTE over `graph_edges` filtered to `is_prerequisite_for`/`presupposes`.

**3D graph visualizer data needs no new tables** — it's a different view over the same `graph_edges`/`bibliographic_records`/`reading_records` data already defined above: a node is "read"/"in progress"/"unread" by joining to the current user's `reading_records.status`; a node is a **missing link** (rendered as a ghost/outline node in the visualizer) when a `graph_edges` target resolves to a `bibliographic_records` entry with no corresponding user-owned `documents` row — i.e., referenced by the scholarship but not yet in this user's library. The graph API endpoint that feeds the visualizer is per-user-scoped (never returns another user's `reading_records`/private `documents`), which is what makes the view "unique to each user" as requested.

Row-level authorization: every user-owned table is queried through a data-access layer that always filters by `user_id = current_user`, backed by Supabase/Postgres row-level security policies as defense-in-depth (belt-and-suspenders per brief §14).

## 10. Document Ingestion Pipeline

Stages, run in the worker via `pg-boss` jobs, each updating `processing_jobs.status` so the UI can show live progress (per brief §10's explicit "show processing progress"):

1. **Upload** → virus/malware scan (ClamAV via a lightweight scan step or a hosted scanning API) → format detection.
2. **Text extraction**: `pdf.js`/`pdf-parse` for text-layer PDFs; `epub.js`/`ebooklib`-equivalent for EPUB; `mammoth` for DOCX; direct read for plain text/Markdown.
3. **OCR fallback**: triggered when extracted text density is implausibly low for the page count (heuristic threshold) → Tesseract.js per page; low-confidence pages flagged for user review rather than silently trusted (brief explicitly warns not to assume OCR accuracy).
4. **Structure detection**: table-of-contents parsing where present; heuristic + LLM-assisted chapter/section/heading detection; footnote/endnote extraction (pattern + LLM-assisted); bibliography section detection.
5. **Text cleanup**: hyphenation/line-break correction, paragraph boundary preservation, quotation recognition.
6. **Citation extraction**: regex/pattern matchers for common styles (Chicago, MLA, APA, footnote-numeral) + LLM-assisted extraction for irregular styles, each raw citation stored with its source passage before any resolution attempt.
7. **Citation resolution**: raw citation text → Crossref/OpenAlex/Open Library lookup → `bibliographic_records` row; unresolved citations kept as-is with `resolution_source = unresolved`, never silently dropped or guessed.
8. **Named-entity / author / title / metadata extraction**: LLM-assisted with the extracted TOC/title page as primary evidence; user confirms/corrects before it's treated as final (brief explicitly requires user inspection/correction of extracted metadata).
9. **Language detection** per passage — supports the brief's required language set (Greek, Latin, German, French, Arabic, Persian, Urdu, etc.) by tagging passages so the reader can apply correct fonts/RTL layout and so downstream AI calls get a language hint.
10. **Chunking + embedding** for retrieval (semantic search, relationship-candidate generation).
11. **User review step**: a metadata/structure confirmation screen before the document is marked "ready" — extraction is never presented as ground truth without this gate.

Failure recovery: every stage records partial success; a failed stage is retryable independently (admin can reprocess per brief §20) without re-running already-succeeded stages.

## 11. AI and Retrieval Pipeline

**Provider adapter interface** (implements brief §12's "AI providers must be replaceable"):
```
interface LLMProvider {
  complete(params: { task: TaskType; prompt: string; sourceText: string }): Promise<{ text, confidence, tokensUsed, model }>
}
interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>
}
```
Concrete `OpenAIProvider` and `AnthropicProvider` implementations; a routing config (`config/ai-routing.ts`) maps `TaskType` (e.g., `metadata_extraction`, `citation_parse`, `relationship_classification`, `roadmap_synthesis`) to a provider+model tier. Per the explicit cost constraint (§3), the default routing is **cheapest-tier-first for every task type**, including relationship classification and roadmap synthesis — a stronger/pricier model is only promoted for a task if eval-harness accuracy (§21) on that task is unacceptable at the cheap tier, and that promotion is a deliberate, documented config change, not a default assumption. This is stricter than a generic "cheap for routine, strong for hard" split: it starts everything cheap and only spends more where evidence shows it's needed.

**Two-stage relationship discovery** (an idea adapted from prior-art research, not code): 
1. Cheap stage — embedding similarity + BM25-style lexical match between the primary text's passages/entities and candidate background works/concepts, producing a shortlist.
2. Expensive stage — LLM classifies each shortlisted candidate into one of the 10 relationship categories (§12) with a rationale and confidence, run only on survivors of stage 1 to control cost.

**Cost and cache controls** (both AI-token and infra spend are being controlled equally, per §3's cost constraint): every AI call logged with token counts and estimated cost (`ai_usage_logs` table, feeds the admin cost dashboard in §16/§20); results cached — an annotation or embedding, once generated for a given passage hash, is never regenerated on unchanged content, and re-ingestion of an already-processed document reuses prior extraction/embedding results rather than recomputing; per-user/day rate limits on ingestion and roadmap-recompute to bound spend (brief §22). Since there's no fixed dollar ceiling yet, the dashboard's real numbers are the mechanism for the user to set one later.

**Retrieval-augmented generation guardrails**: the LLM is never asked to produce a bibliographic fact from memory. Any claim about an external work's title/author/year/ISBN must originate from a `bibliographic_records` lookup (§10 step 7), not from model generation — this is the primary anti-hallucination control the brief demands in §12.

## 12. Citation, Provenance, and Confidence Model

Every `annotations` row (§9) carries, per brief §5/§12:
- `relationship_category` — one of the 10 required categories (explicit_reference, secondary_scholarly_recommendation, historical_context, prerequisite, conceptual_influence, disagreement_polemical_target, interpretive_aid, parallel_comparison, optional_extension, ai_inferred).
- `explanation` — concise human-readable rationale.
- `extracted_source_text` — the verbatim passage that triggered the annotation (never paraphrased away, per brief's "preserve the extracted source text").
- `confidence` — numeric 0–1, always shown in the UI, never hidden.
- `provenance` — `model_used` + `prompt_version` for AI annotations, or `created_by = user`/`created_by = editor` for human ones.
- `verification_status` — `unreviewed` / `user_verified` / `source_verified` / `disputed` / `rejected`; users can approve/reject/edit/hide any AI annotation (brief §12), which updates this field and is itself audit-logged.
- Disagreement handling: where `graph_edges`/scholarship indicates competing interpretations, the UI presents them side-by-side rather than picking one (brief's "present competing interpretations when relevant").
- A persistent, non-dismissible-but-collapsible disclaimer on every reader view: "AI-assisted research aid — verify against primary sources," per brief §12.

## 13. Reading Roadmap Algorithm

1. Build the prerequisite subgraph: recursive CTE over `graph_edges` where `edge_type IN (is_prerequisite_for, presupposes, provides_context_for)` rooted at the primary work.
2. Assign each candidate work a priority tier (essential/high/strongly_recommended/contextual/interpretive_aid/comparative/optional) from the classification in §12, combined with graph centrality (how many other essential items depend on it — e.g., Kant scores higher than Camus for a Heidegger roadmap because more downstream prerequisite edges point through it, matching the brief's worked example).
3. Topological sort respecting prerequisite edges, tie-broken by priority tier, producing a sequence — not a flat list.
4. Personalization pass: for each candidate, check the user's `understanding_ratings`; items above a configurable threshold (e.g., score ≥ 60 = "working understanding") are deprioritized or marked "already known — recommend review only," per brief §7's explicit requirement that the roadmap use the knowledge profile to avoid redundant recommendations. User can always override this.
5. Mode toggle: **concise** (essential + high priority only) vs. **comprehensive** (full graph) — a filter on the same computed sequence, not two separate algorithms.
6. Filters: available time (greedy knapsack-style selection under a page/time budget using each work's estimated reading time), depth, and expertise level (beginner sees fewer, more essential items; advanced researcher sees the full contextual/comparative tail).
7. User controls, all persisted per-user as `roadmap_items.user_override`: manual priority change, hide, add a work not in the auto-generated set, reorder, mark as known, mark specific chapters read, trigger recalculation.
8. Section-level precision where determinable: if a secondary work's relevance was established from a specific passage/chapter (via the citation/annotation that generated the recommendation), the roadmap item carries a `relevant_sections` pointer rather than "read the whole book," per brief's explicit requirement.
9. **Test cases baked into the eval suite (§21)**: the Heidegger scenario (Kant ranks high, Husserl high, Camus low/comparative-only, transitive Hume/Descartes prerequisites surfaced under Kant) and the Vico/Verene scenario (a secondary interpretive aid ranks above generic context works) are used as acceptance tests for this algorithm, per the brief's explicit instruction to use these as continuing correctness tests.

## 14. Authentication and Authorization Strategy

- Auth.js (NextAuth) v5 with the Credentials provider (bcrypt-hashed passwords) against our own `users` table; email verification and password reset implemented as token-based flows (signed, single-use, expiring tokens in a `verification_tokens` table) sent via Resend.
- Session strategy: database sessions (not pure JWT) so sessions can be revoked server-side (needed for account deletion / "sign out everywhere").
- Every API route and Server Action re-checks `user_id` ownership on the resource being accessed — no route trusts a client-supplied user id. Combined with Postgres row-level security policies as a second layer (defense-in-depth against IDOR, per brief §14).
- Rate limiting on auth endpoints (login attempts, password reset requests) and upload endpoints via a token-bucket in Postgres or Vercel's edge rate limiting.
- Upload limits: per-file size cap and per-user storage quota enforced server-side before accepting an upload.
- Social login: architected as addable (Auth.js provider config) but not built for MVP per §3.

## 15. Privacy, Copyright, and Security Strategy

- **Uploads are untrusted input**: scanned for malware, size-capped, MIME-sniffed (not trusted by extension), parsed by sandboxed/library-level parsers (not shelling out to arbitrary converters), and any text extracted from them is never directly interpolated into an LLM system prompt unescaped — treated as data, with the prompt structure designed to resist prompt injection embedded in document text (brief explicitly calls this out).
- **Tenant isolation**: every query for user-owned data is scoped by `user_id`; automated authorization tests (§21) assert one user's documents/annotations/notes are unreachable by another user's session, including by direct object id guessing.
- **Copyright**: the platform never attempts to bypass paywalls or source copyrighted text itself. For works it can't obtain, it stores a proper citation + legitimate acquisition pointer (library/purchase link where known) and lets the user upload their own legally obtained copy; roadmap generation continues without the full text, marking those items "not directly inspected" (brief §11).
- **AI data handling**: use each provider's zero/no-training-retention API tier where available (OpenAI and Anthropic both offer API-tier data-use terms distinct from consumer products); document in docs/PROJECT-LOG.md exactly what is/isn't sent and retained. Uploaded content is never used to train models without explicit, separate, informed opt-in consent (brief §12/§23) — default is opt-out.
- **Deletion**: account deletion cascades to uploaded files (Storage), extracted text, embeddings, and derived annotations — not just the account row. A deletion job (worker) performs and verifies the cascade, tested explicitly (§21).
- **Data export**: user can export their notes, roadmap, bibliography, and account data (brief §14/§19).
- **Audit log**: privileged admin access to any user content is logged with a justification field, and admins do not get blanket content access — support tooling surfaces metadata/status by default, with content access requiring an explicit, logged action (brief §20).
- **Disclosure**: a written, user-facing privacy/copyright policy page summarizing all of the above in plain language, linked from the footer and onboarding.

## 16. Main Pages and Navigation Structure

```
/                              Landing page (public)
/login /signup                Auth.js pages
/verify-email /reset-password
/privacy /terms                Policy pages

/app                            Authenticated shell (sidebar + topbar)
  /app/dashboard                 Library: recent works, collections, search
  /app/upload                    Upload wizard
  /app/works/[workId]             Work workspace (tabbed)
    /reader                        Interactive critical edition view
    /roadmap                       Reading Roadmap tab
    /bibliography                  Work's bibliography
    /graph                         3D knowledge-graph visualizer, scoped to this work's network
    /notes                         Notes/highlights/bookmarks for this work
    /settings                      Edition/metadata correction, processing status
  /app/collections                Collections/folders/reading lists
  /app/graph                     Global 3D knowledge-graph visualizer (whole personal library, all works/figures/concepts/traditions)
  /app/search                    Cross-work search (text, notes, annotations)
  /app/settings                  Account, privacy, export, deletion, preferences
  /app/admin                     Admin-only: jobs, abuse reports, usage/cost, feature flags (§20)
```
Split-pane mode is a reader-level UI state (opens a second work/annotation in an adjacent pane), not a separate route, so the originating reading position is preserved (brief §8/§9 requirement).

## 17. Component Hierarchy (top level)

```
AppShell
 ├─ Sidebar (WorkspaceSwitcher, RecentWorks, Collections, Search entry)
 ├─ TopBar (GlobalSearch, UserMenu)
 └─ MainContent
     ├─ WorkWorkspace (per-work tab bar)
     │   ├─ ReaderPane
     │   │   ├─ DocumentViewer (pdf.js/epub.js wrapper)
     │   │   ├─ AnnotationLayer (underline/highlight/margin-marker renderers)
     │   │   ├─ AnnotationPreviewPopover (hover)
     │   │   ├─ AnnotationDetailDrawer (click)
     │   │   ├─ FootnoteSidebar (original notes, visually distinct)
     │   │   └─ SplitPaneContainer (secondary work/note pane, resizable)
     │   ├─ RoadmapPane
     │   │   ├─ RoadmapGraph (restrained 2D dependency view)
     │   │   ├─ RoadmapItemCard (priority badge, why/how-much/order)
     │   │   └─ KnowledgeProfileEditor (understanding sliders)
     │   ├─ BibliographyPane
     │   ├─ NotesPane
     │   └─ GraphPane (work-scoped 3D visualizer)
     │       ├─ KnowledgeGraph3D (react-force-graph-3d canvas)
     │       ├─ GraphControls (filter by relationship type, read-status, show/hide missing links)
     │       ├─ GraphNodeDetailPanel (click a node → summary + link to open it)
     │       ├─ GraphLegend (relationship-category color/icon key, shared with AnnotationLayer's coding)
     │       └─ GraphAccessibleFallback (sortable/filterable table view of the same nodes/edges, §20)
     ├─ GlobalGraphView (same components as GraphPane, unscoped — whole personal library)
     └─ UploadWizard (Dropzone → MetadataConfirm → ProcessingStatus)
```

## 18. Reader Interaction Model

- Hover an annotation marker → lightweight popover: referenced work/author, relationship category (color+icon coded), one-line reason, confidence, provenance badge.
- Click → full annotation detail (explanation, evidence, extracted source text, verification status, related passages) with an action to open the referenced work.
- Opening a reference either opens a new internal tab for that work or opens it in the split-pane's second slot; either way, the originating passage position in the primary text is preserved and a "return to origin" affordance is always visible (brief's explicit requirement).
- Visual distinction (color + icon + label, never color alone, for accessibility): original authorial footnote vs. editorial/bibliographic note vs. AI-generated annotation vs. user note — four visually and semantically distinct treatments per brief §9.
- Reader controls: text size/spacing/margin/line-length adjustment, light/dark/distraction-reduced modes (all built on the same warm palette tokens, §19), persistent reading position (saved per document per user), keyboard navigation (next/prev annotation, next/prev section, search-in-text), full-text search within the document.

## 19. Visual Design System and Palette

Warm, calm, scholarly, contemporary — not faux-antique. Base tokens (light mode default):
- Background: warm ivory/parchment `#FAF6EE`-range; elevated surfaces: soft cream `#F3ECDD`-range.
- Primary text: deep charcoal/umber `#2A241C`-range (contrast-checked ≥7:1 on background for body text — exceeds AA).
- Accents: muted burgundy, deep green, ink blue, dark umber — used for primary actions/links, not decoration.
- Selection/highlight: subdued gold/ochre.
- Annotation-category colors: a distinct, accessible qualitative palette for the 10 relationship categories, each paired with a unique icon so category is never color-only (WCAG requirement). **The `dataviz` skill's categorical-palette method will be used at implementation time** to derive and validate this 10-color set for contrast and light/dark parity, rather than hand-picking colors now.
- Dark mode and distraction-reduced mode are token overrides of the same system, not a separate design.
- Motion: restrained — hover/focus transitions, gentle expand/collapse for annotation cards, no parallax-heavy or 3D landing-page effects (explicit brief instruction, and explicit contrast with the reference project surveyed in §4). **Exception, by explicit later request:** the dedicated 3D knowledge-graph visualizer (§9/§16/§17) is a real, purposeful 3D tool — but even there, motion stays restrained: damped/inertia-limited camera controls, no forced auto-rotation, node/edge colors drawn from the same palette and category coding as the reader's annotations (not a separate visual language), and it lives behind an explicit tab the user chooses to open, not on the landing page or embedded ambiently in the reader.

## 20. Accessibility Strategy

Target: WCAG 2.2 AA. Semantic HTML and Radix primitives for all interactive components (dialogs, popovers, tooltips, menus) to get correct ARIA roles and focus trapping for free. Every annotation category distinguishable by icon+label, not color alone. Full keyboard operability for the reader (documented shortcut list, visible on request). Visible focus indicators styled to match the palette (never removed). `prefers-reduced-motion` respected throughout. Automated `axe-core`/`axe-playwright` checks in CI on every PR touching UI. Manual screen-reader passes (VoiceOver) on the reader, roadmap, and upload flows before each phase's sign-off. Usable at 200% browser zoom without horizontal scroll or lost functionality (brief's explicit "usable at high zoom" requirement). **3D knowledge-graph visualizer accessibility:** a WebGL 3D scene is inherently not screen-reader- or keyboard-navigable, so the `GraphPane`/`GlobalGraphView` always ships with a `GraphAccessibleFallback` — the identical node/edge data as a sortable, filterable, fully keyboard- and screen-reader-operable table (work, relationship type, related entity, read status, missing-link flag) — reachable via a visible toggle, not buried; the 3D view is treated as an enhancement over that table, never the only way to get the information.

## 21. Testing Strategy

- **Unit** (Vitest): schema validators, roadmap-sequencing algorithm, citation-resolution logic, provider adapters (mocked).
- **Integration** (Vitest + test DB): ingestion pipeline stages, authorization checks on API routes, job retry logic.
- **E2E** (Playwright): upload → confirm metadata → read → click annotation → open related work → roadmap recalculation → mark-as-read flow; login/signup/verify/reset; account deletion cascade.
- **Accessibility** (`axe-playwright`) on every major page as part of the E2E suite.
- **Cross-browser** (Playwright projects: Chromium, Firefox, WebKit) and responsive-layout checks (mobile/tablet/desktop viewports).
- **Security**: authorization-bypass test matrix (user A attempts every resource-scoped route against user B's ids, expects 403/404); upload fuzzing (malformed PDFs, zip bombs, oversized files, encrypted PDFs, non-UTF8 text, multilingual/RTL documents).
- **AI reliability eval harness**: a fixed set of gold-standard passages (including the Heidegger and Vico test cases from §13) with known correct/incorrect citations, run against the pipeline to measure fabrication rate and classification precision/recall — run in CI on a schedule (not every PR, to control cost) and gates any provider/model/prompt change.
- **Background job tests**: forced provider failure → verify retry/backoff and eventual dead-letter handling, not silent job loss.
- **Data deletion tests**: verify full cascade (files, embeddings, annotations) on account deletion.
- **Performance**: k6 load tests on the reader/search endpoints; large-document ingestion timing benchmarks.

## 22. Deployment and Observability

Vercel auto-deploys the Next.js app from `main` (with preview deployments per PR); Render auto-deploys the worker from `main`. Structured logging (`pino`) from both web and worker, correlated by a request/job id. Sentry captures errors from both tiers plus the browser. `ai_usage_logs` (per §11) power a simple admin cost dashboard (§20). Supabase's managed backups cover the database; a documented, periodically-tested restore procedure satisfies the brief's backup/restore requirement. Graceful degradation: if an AI provider or bibliographic API is down, ingestion continues through the stages that don't need it and marks the dependent stage `deferred`/`retry` rather than failing the whole document (brief §22 explicit requirement).

## 23. Phased Implementation Roadmap

Each phase: objective, tasks, dependencies, deliverables, tests, definition of done, git checkpoint, docs/PROJECT-LOG.md updates. Every phase ends with a pushed, tagged commit (`git tag phase-N-complete`) recorded in docs/PROJECT-LOG.md's changelog.

**Phase 0 — Research & Planning (this document + first execution actions)**
- Tasks: this plan; reference-project license inspection (done); create GitHub repo (private); scaffold monorepo; write `docs/PROJECT-LOG.md` (+ documented filesystem-casing constraint); `README.md`; `.gitignore`; `.env.example`.
- Deliverables: initialized private GitHub repo with governance files committed.
- DoD: `git log` shows an initial commit on `main`, pushed; docs/PROJECT-LOG.md accurately describes repo state.

**Phase 1 — Foundation**
- Tasks: Next.js scaffold, Tailwind + design tokens, Drizzle schema + first migration (users, sessions, verification_tokens), Auth.js credentials flow + email verification + reset, base app shell/layout, Supabase project provisioning, Storage bucket + access policy, structured logging + Sentry wiring, GitHub Actions CI (lint/typecheck/unit tests).
- Dependencies: Phase 0.
- Tests: auth flow E2E (signup/verify/login/reset), CI green on a trivial change.
- DoD: a user can sign up, verify email, log in, log out, reset password, and land on an empty dashboard, in production on Vercel.
- Git: feature branches per sub-area, merged after tests pass; tag `phase-1-complete`.

**Phase 2 — Upload and Library**
- Tasks: upload wizard (dropzone, format validation, virus scan stub), `documents`/`works`/`editions` tables + migrations, worker service scaffold on Render + pg-boss wiring, first parser (text-layer PDF + plain text/Markdown), metadata confirm/correct screen, processing-status UI (polling), library/dashboard listing.
- Dependencies: Phase 1 (auth, storage).
- Tests: upload→extract→confirm E2E for a text-layer PDF and a `.txt` file; upload security tests (oversized, wrong-MIME, malformed file).
- DoD: a user uploads a real text-layer PDF, sees live processing status, confirms extracted metadata, and it appears in their library.

**Phase 3 — Reader**
- Tasks: `pdf.js`/`epub.js` viewer integration with precise text-position mapping, chapter/section navigation, reading-position persistence, footnote rendering (original notes, visually distinct), highlights/notes/bookmarks CRUD + UI, work-tab and split-pane shell.
- Dependencies: Phase 2 (a processed document to render).
- Tests: annotation-position accuracy tests (does a highlight anchor survive re-render/reflow), reading-position persistence E2E, split-pane E2E.
- DoD: a user opens an uploaded work, navigates by section, highlights text, adds a note, closes the tab, reopens the work, and lands back at the same position.

**Phase 4 — Scholarly Analysis**
- Tasks: citation/entity extraction, bibliography detection, `bibliographic_records` resolution via Crossref/OpenAlex/Open Library adapters, LLM provider adapters (OpenAI + Anthropic) with task routing, two-stage relationship classification producing `annotations`/`graph_edges` rows with full provenance, annotation UI in the reader (hover/click, category-coded), user correction workflow (approve/reject/edit/hide).
- Dependencies: Phase 3 (reader to display annotations in).
- Tests: citation-extraction accuracy fixtures, fabrication-rate eval harness first run, provenance-completeness test (every AI annotation has `extracted_source_text` and a resolvable `bibliographic_records` link or explicit "unresolved" state).
- DoD: an uploaded work shows AI-generated annotations with correct category coding, confidence, and provenance; a user can approve/reject one and the status persists.

**Phase 5 — Reading Roadmap and Knowledge Profile**
- Tasks: `reading_records`/`understanding_ratings` schema + UI (status, sliders with numeric+label), prerequisite-graph traversal (recursive CTE), roadmap generation algorithm (§13), Roadmap tab UI (priority tiers, sequence, section-level pointers, time estimates), manual override controls (reorder/hide/add/mark-known), concise/comprehensive mode toggle, time/depth/expertise filters, recalculation trigger; **3D knowledge-graph visualizer** — per-user graph API endpoint (§9), `GraphPane` (work-scoped) + `GlobalGraphView` (library-wide) built on `react-force-graph-3d`, read/unread/missing-link visual states, filter controls, node detail panel, and the mandatory `GraphAccessibleFallback` table view (§20).
- Dependencies: Phase 4 (graph edges to traverse).
- Tests: the Heidegger and Vico algorithm test cases from §13 as automated acceptance tests; override-persistence tests; recalculation-respects-overrides test; graph-visualizer per-user isolation test (user A's graph endpoint never returns user B's reading status or private documents); accessible-fallback parity test (table view exposes the same nodes/edges as the 3D view).
- DoD: uploading a Being and Time-style test fixture produces a roadmap ranking Kant/Husserl above Camus, with transitive prerequisites surfaced, and marking a work "known" measurably changes the roadmap; opening the graph tab for that work renders a 3D network distinguishing read/unread/missing-link nodes, and the accessible table fallback shows the same data.

**Phase 6 — Landing Page and Onboarding**
- Tasks: interactive landing page (hero, annotated-passage demo, roadmap example, small restrained knowledge-graph demo, workflow explanation, researcher vs. newcomer feature sections, privacy/reliability explanation, sign-up CTA), short optional onboarding (expertise level, first-upload nudge).
- Dependencies: Phases 1–5 (needs real features to demonstrate, even if the demo uses a fixed illustrative example rather than live user data).
- Tests: landing-page a11y and cross-browser E2E; onboarding-completion E2E.
- DoD: an unauthenticated visitor can understand the product's value from the landing page alone and complete signup→first upload without confusion (manually validated, not just automated).

**Phase 7 — Hardening and Deployment**
- Tasks: full security review (authz test matrix, upload fuzzing, prompt-injection resistance check on uploaded-text handling), accessibility review (manual screen-reader pass), performance pass (k6 load test, large-document ingestion benchmark), AI eval harness full run + gate, backup/restore drill, admin dashboard (§20) completion, production monitoring dashboards, full documentation pass in docs/PROJECT-LOG.md/README, a real recovery test restoring from an earlier tagged GitHub checkpoint.
- Dependencies: all prior phases.
- Tests: everything in §21 run end-to-end.
- DoD: the recovery drill succeeds, all Phase 0–6 acceptance criteria still pass, and docs/PROJECT-LOG.md fully reflects shipped state.

**Phase 8 — Critical Edition Recovery, Autonomous Research & Public-Source Discovery (redefined; runs after Phase 7)**
- Objective: transform the app into a reliable, largely autonomous critical-edition generator. Uploading a PDF leads — with no manual refresh and no unnecessary metadata form — to page-aware extraction, automatic title/author, anchored authorial footnotes, resolved explicit + implied references, broad credibility-aware research across scholarly/web/social sources, and traceable critical notes, under a cost ceiling.
- Full decision-complete plan (defect audit, GROBID + Tavily decisions, provider matrix, GPT-5.x tiers, data model, sub-phases 8.1–8.9, testing, DoD): **§33 below**.
- Dependencies: Phases 0–7 (repairs and extends the shipped pipeline).
- DoD: autonomous upload→edition with no manual refresh; *Vice and Reason* acceptance tests pass (≥95% explicit-citation recall, *Nicomachean Ethics* as essential background, all configured providers queried-or-reported-unavailable, weak sources separated, generated≠authorial, every factual claim traceable, no fabricated data); failed reprocess preserves the last edition; `phase-8-complete` tagged.

**Phase 9 — Interactive Learning Workspace (redefined 2026-07-19; complete 2026-07-20; full detail in §34)**
- Objective: turn the published critical edition into a workspace that adapts to the reader's level without ever hiding depth — passage-anchored annotations, a Library of every recommended source, curriculum routes, an entity-rich knowledge graph, and safe deletion.
- Tasks: sub-phases 9.1–9.7 behind `ANALYSIS_PIPELINE=v3`, v2 retained as rollback. See §34. (The originally planned 9.8 "Comprehensive dossier" was retired before implementation — an exhaustive repo-wide search found its "14 modules" referenced by count everywhere and enumerated nowhere, and given the real AI-spend stakes attached to it, guessing at scope was rejected in favor of retiring it. Phase 9's own original objective — full-depth adaptivity — is completed instead by Phase 10 below.)
- Dependencies: Phase 8 complete (`phase-8-complete`, 2026-07-20).
- DoD: see §34 acceptance gates; `phase-9-complete` tagged. **Met.**

**Phase 10 — Workspace Depth & Adaptivity Completion (added 2026-07-20; full detail in §35)**
- Objective: complete Phase 9's own original objective — turn the published critical edition into a workspace that adapts to the reader's level without ever hiding depth — passage-anchored annotations, a Library of every recommended source, curriculum routes, an entity-rich knowledge graph, and safe deletion — by closing the concrete gaps sub-phases 9.1–9.7 left open, rather than inventing new scope in their place.
- Tasks: see §35 for the full feature-by-feature audit and scope (annotation relationship/source linking, annotation filter/sort, Library reader-level default-scoping, 3D graph visual richness, a suggested-reader-level nudge, and jargon/terminology-extraction tightening).
- Dependencies: Phase 9 complete (`phase-9-complete`, 2026-07-20).
- DoD: see §35 acceptance gates; `phase-10-complete` tagged.

**Phase 11 — Educational Companion Site (added by explicit user request, runs after Phase 10; renumbered from Phase 10 on 2026-07-20)**
- Objective: a second, fully independent website that teaches, start to end, everything done in Phases 0–10 of this project — a step-by-step course for someone who wants to learn how to build this kind of system themselves. Excludes documenting Phase 11 itself (no infinite regress).
- Tasks: see §31 for full detail — new sibling folder + new independent git repo/GitHub repo, Astro Starlight-based docs/tutorial site, chapters mirroring Phases 0–10, content sourced primarily from this repo's own `docs/PROJECT-LOG.md` changelog/decision log (already continuously maintained per the working rules), deployed to a free static host.
- Dependencies: all of Phases 0–10 complete (it teaches what was actually built, not a plan).
- Deliverables: a deployed, independent, publicly reachable tutorial site with one chapter per phase plus an intro and retrospective.
- Tests: build/link-check CI on the new site's repo; a content read-through pass verifying each chapter's claims match the actual repo's code/history at time of writing.
- DoD: someone with no prior context could follow the site from Chapter 1 onward and understand, and largely reproduce, the architecture and decisions of the main project.
- Git: its own repo, its own commit history, its own checkpoints — entirely separate from the main repo's history.

**Post-MVP (kept explicitly separate so it never blocks core delivery — see §27).**

## 24. Task Dependencies (critical path)

`Phase 0 → Phase 1 (auth+storage) → Phase 2 (upload+parsing) → Phase 3 (reader)` is a strict chain — each needs the previous. `Phase 4 (analysis)` needs a renderable document from Phase 3 to attach annotations to. `Phase 5 (roadmap)` needs Phase 4's graph edges. `Phase 6 (landing)` needs real features from Phases 1–5 to demo honestly. `Phase 7 (hardening)` needs everything. Within phases, backend schema/migration work always precedes the UI that depends on it; adapter interfaces (AI providers, bibliographic APIs) are built before the pipeline logic that calls them, so the pipeline can be tested against mocks first.

## 25. Major Technical Risks and Mitigations

- **R1 — AI fabricates citations/relationships** (core product-trust risk). Mitigation: §12's provenance model + §11's "never invent bibliographic facts, only resolve via lookup" rule + §21's eval harness gating any prompt/model change.
- **R2 — OCR/citation-extraction inaccuracy silently trusted.** Mitigation: user-facing review/correction step is mandatory before a document is "ready" (§10), never a silent pass-through.
- **R3 — Annotation position drift** (highlight anchored to wrong text after reflow/re-extraction). Mitigation: position anchoring by stable offsets/text-fingerprint (not raw pixel/page coordinates alone), tested explicitly in Phase 3.
- **R4 — AI cost overrun.** Mitigation: two-stage cheap-filter/expensive-classify pipeline, per-user rate limits, usage logging + admin dashboard, caching of unchanged results (§11/§22).
- **R5 — Cross-user data leakage.** Mitigation: mandatory authorization test matrix (§21) run in CI, RLS as second layer (§14).
- **R6 — Roadmap algorithm produces a scholarly-tone-deaf ranking** (e.g., ranks a comparative work above a real prerequisite). Mitigation: the Heidegger/Vico test cases as ongoing acceptance criteria (§13/§23), manual override always available so a bad ranking is never a dead end.
- **R7 — Vendor lock-in on AI/bibliographic providers.** Mitigation: adapter interfaces throughout (§5/§11), no business logic imports a vendor SDK directly.
- **R8 — Scope creep vs. delivery.** Mitigation: explicit MVP/post-MVP split (§26/§27) enforced per phase.

## 26. MVP Scope

Phases 0–6 as specified above, with these deliberate MVP-level reductions (not omissions — all are explicitly named as post-MVP in §27, not silently dropped):
- Formats: text-layer PDF, EPUB, TXT, Markdown in MVP; scanned/OCR PDF and DOCX are Phase-4-adjacent but can slip to immediately-post-MVP if ingestion complexity runs long — flagged, not silently cut.
- Bibliographic sources: OpenAlex + Crossref + Open Library only; Semantic Scholar/CORE/DOAJ deferred.
- OCR: Tesseract.js only; cloud OCR fallback adapter interface exists but isn't wired to a paid provider.
- Social login: not built, but Auth.js makes it a config addition later.
- Citation export formats: BibTeX only in MVP; RIS/CSL-JSON post-MVP.
- Reference-manager integration (Zotero, etc.): post-MVP, explicitly named in the brief as "optional integration in a later phase."

## 27. Post-MVP Features

Cloud OCR fallback activation; Semantic Scholar/CORE/DOAJ integrations; DOCX ingestion if slipped; social login; RIS/CSL-JSON export; reference-manager integrations; dedicated graph-database mirror for large-scale traversal if `pgvector`+recursive-CTE performance becomes a bottleneck; collaborative/shared workspaces (out of current scope — brief is single-user-owned data throughout); mobile-native app (brief only requires responsive web); advanced admin feature-flag UI beyond a basic on/off table.

## 28. Acceptance Criteria per Phase

Embedded in each phase's "DoD" line in §23 rather than repeated separately — each is a concrete, testable behavior (e.g., "user can X and observe Y"), not a vague checkbox, per the instruction to give clear acceptance criteria for every major feature.

## 29. Proposed Repository Structure

```
interactive-critical-edition/
  apps/
    web/                  # Next.js app: UI + API routes + Auth.js
    worker/                # Node worker: pg-boss consumer, ingestion, AI pipeline
  packages/
    db/                    # Drizzle schema, migrations, shared DB types
    ai-adapters/            # LLMProvider/EmbeddingProvider interfaces + OpenAI/Anthropic impls
    ingestion/              # PDF/EPUB/DOCX/OCR parsers, shared by web preview + worker
    bibliographic/          # OpenAlex/Crossref/Open Library client adapters
    ui/                     # Shared design-system components + Tailwind tokens
    config/                 # shared eslint/tsconfig/tailwind config
  docs/
    architecture/           # this plan, ADRs, diagrams
  .github/workflows/        # CI: lint, typecheck, unit, integration, Playwright, axe
  docker-compose.yml         # local Postgres+pgvector for dev
  docs/PROJECT-LOG.md                  # canonical project memory (see §30 for the filesystem-casing note)
  README.md
  .env.example
  .gitignore
```

## 30. Exact First Implementation Tasks After Plan Approval

In order, each its own small commit:
1. `gh repo create interactive-critical-edition --private --source=. --description "..."` (after `git init` and the files below exist locally) — or `git init` first, then `gh repo create` with `--source=.` to link.
2. `.gitignore` (Node/Next.js/env/OS-file coverage).
3. `README.md` (project description, setup instructions placeholder, links to docs/PROJECT-LOG.md).
4. `docs/PROJECT-LOG.md` — full canonical file per the brief's required contents (purpose, functional requirements summary, architecture, design decisions + rationale, implementation status = "Phase 0 complete," completed/remaining tasks, known gaps including the documented filesystem case-insensitivity constraint, DB/API decisions, run/test/build/migrate/deploy commands [placeholders until Phase 1 scaffolds them], required env vars by name only, changelog with today's entry, "how to resume" instructions).
5. `.env.example` (variable names only: `DATABASE_URL`, `SUPABASE_*`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AUTH_SECRET`, `RESEND_API_KEY`, `SENTRY_DSN`, etc. — no values).
6. Commit all of the above: "Initial project governance: docs/PROJECT-LOG.md, README, env template."
7. Push to `origin main`.
8. Tag `phase-0-complete`.
9. Begin Phase 1: scaffold the Next.js app in `apps/web` (this becomes the first Phase 1 commit).

## 31. Educational Companion Site (Phase 11 detail — renumbered from Phase 9 on 2026-07-19, then from Phase 10 on 2026-07-20)

**Purpose:** a genuinely separate, independent website — not a subsection of the main app — that teaches a reader how to build this entire project themselves, in order, from the empty-repo starting point through the hardened deployment. It documents everything done in Phases 0–10 of this plan; it does not document its own creation.

**Location and independence:** a new sibling folder next to this project (e.g. `/Users/hyderhusainarastu/Documents/interactive-critical-edition-course`), with its own `git init`, its own new private-or-public GitHub repo (recommend **public** at Phase 8 kickoff, since the content is generic educational material with no user data, scholarly uploads, or secrets in it — but this is a recommendation to confirm with the user at that time, not decided now), and its own deploy — fully decoupled from `interactive-critical-edition`'s codebase, history, and hosting.

**Stack:** Astro + Starlight (MIT-licensed, purpose-built for chaptered docs/tutorial content — sidebar navigation, search, code blocks, versioning — out of the box), deployed as a static site to a free tier (Vercel free/GitHub Pages), consistent with the cost constraint (§3) since this site has no backend, no database, and no AI calls of its own.

**Content sourcing strategy:** rather than reconstructing the build narrative from memory at the very end, each chapter is drafted from that phase's own entry in `interactive-critical-edition`'s `docs/PROJECT-LOG.md` changelog/decision log — which the working rules already require to be updated after every meaningful step (brief §1/§26). This means Phase 8 is genuinely a synthesis-and-polish pass at the end, not a parallel documentation effort competing with the main build for time; the raw material already exists by the time Phase 8 starts.

**Chapter structure (mirrors §23's phases):**
0. Introduction — the problem (the Heidegger/Vico framing from the original brief), what gets built, how to use the course.
1. Planning & governance — how the plan itself was built, docs/PROJECT-LOG.md/GitHub setup.
2. Foundation — auth, scaffolding, CI.
3. Upload & ingestion pipeline.
4. The reader and annotation system.
5. Scholarly analysis — citation extraction, the provenance/confidence model, anti-hallucination design.
6. Reading roadmap algorithm and knowledge profile.
7. The 3D knowledge-graph visualizer.
8. Landing page and onboarding.
9. Hardening, testing, deployment, observability.
10. Retrospective — what was hard, what would change next time, real cost numbers from the admin dashboard (§20/§22).

**Tests:** CI on the new repo runs the Astro build and a link-checker on every push; before each chapter is marked done, a read-through pass confirms its code references and claims match the actual state of the `interactive-critical-edition` repo at that point (not idealized/aspirational descriptions).

**DoD:** the site is live, navigable start-to-end, and a reader unfamiliar with the project could follow it to understand — and largely reproduce — every major decision in this plan.

## Verification

- Phase 0 is verified by: `git log` on GitHub showing the pushed initial commit, the repo visible as private under `hyderhusainarastu/interactive-critical-edition`, and docs/PROJECT-LOG.md content matching actual repo state.
- Each subsequent phase is verified per its DoD line in §23 — run the relevant app flow manually plus the automated test suite for that phase, not typecheck alone, before marking the phase complete in docs/PROJECT-LOG.md.

## 33. Phase 8 — Critical Edition Recovery, Autonomous Research & Public-Source Discovery (approved plan)

**Goal.** Turn the app into a reliable, largely autonomous critical-edition generator: upload → (no manual refresh, no unnecessary metadata form) → page-aware extraction, automatic title/author, anchored authorial footnotes, resolved explicit + implied references, credibility-aware research across scholarly/web/social sources, and traceable critical notes, under a cost ceiling.

**Locked technical decisions.**
- **PDF/structure:** **GROBID** (self-hosted Docker → TEI-XML: headers, per-reference bibliography, footnotes, sections, coords) is the extraction anchor; `pdfjs-dist` for page rasterization + reader text-layer; **Tesseract.js** OCR fallback for scanned pages; `epub.js`-class parser for EPUB. `GROBID_URL` env; graceful "structure-limited" fallback to pdf.js if unreachable.
- **Web discovery:** **Tavily** (`TAVILY_API_KEY`) for search + content extraction, behind a swappable adapter.
- **Providers (enable all *free*, ship paid/gated as fallback-only; UI reports coverage):** live/free — Crossref, OpenAlex, Open Library, Google Books, Semantic Scholar, Tavily, YouTube Data API, Mastodon, Bluesky; free-but-approval-gated — Reddit (adapter shipped disabled); paid/gated fallback-only — X/Twitter, Meta/Instagram, Threads. OCR = Tesseract.js (free) with a cloud seam.
- **AI models (GPT-5.x, env-overridable, structured outputs/JSON-schema):** mechanical extraction/classification → `gpt-5.4-nano` ($0.20/$1.25 per 1M); research planning + note synthesis → `gpt-5.4-mini`/`gpt-5.6-luna`; escalate conflicts/failed validations → `gpt-5.5`/`gpt-5.6-sol`. `gpt-4o-mini` kept as override.
- **Cost/saturation caps (config):** ~$2 soft / $5 hard AI budget per work; ≤300 explicit-citation candidates, ≤750 pre-dedup resources, traversal depth 2, 12 web / 8 YouTube / 6 per social queries, ≤120 full inspections; stop after 2 discovery batches add <5% new relevant non-dupes.

**Two-axis credibility.** (1) Document provenance: authorial-footnote/bibliography → main-text citation/quote → strong implication → AI research lead. (2) Source authority A–E (A: primary/peer-reviewed/academic press; … E: unreliable). Authorial footnotes are strongest evidence of *what the document cites*, but the cited source's authority is assessed independently. Engagement/popularity is never credibility. Low-authority-but-relevant kept in a clearly separated supplementary section, never the sole support for a factual note.

**Data model (additive; legacy tables untouched, UI prefers a published run).** Migration **0008** is the committed base schema: `processing_run`, `page`, `text_block`, `doc_footnote`, `doc_metadata`; it is not yet deployed. Corrective migration **0009** adds run-version and metadata uniqueness, one published run per document, and the explicit `full`/`limited` structure state. Migration **0010** adds `research_resource`, `resource_provenance` (provider, inspection depth), `edition_relation` (each with evidence anchor + confidence), `credibility_assessment`, `generated_note`, `evidence_span`; it extends `ai_usage_logs` with run/stage. **Versioned processing runs with publish-on-success** — a failed reprocess never destroys the last good edition (fixes the delete-before-success defect).

**Sub-phases (execution order, each its own reviewable commit group + gate + docs/checklist update + push):** 8.1 defect recovery (login, live polling, auto-advance) + bone-white theme + doc renumber · 8.2 versioned page-aware doc model + GROBID + OCR/EPUB + auto-metadata · 8.3 evidence-first pipeline skeleton + versioned publish + validation · 8.4 scholarly adapters (candidate-ranked resolution) · 8.5 web/blog/newsletter/social discovery (honest inspection-depth) · 8.6 credibility + relations + implied refs + critical-note synthesis · 8.7 critical-edition UI · 8.8 admin reprocessing + orphan cleanup + reprocess safety · 8.9 full test matrix + non-hardcoded gold eval + CI + deploy + prod smoke + `phase-8-complete`.

**Rollout/rollback.** Feature flag `ANALYSIS_PIPELINE` (v1 legacy / v2 new); publish-on-success + additive migrations mean bad runs never replace good editions; every provider degrades independently. Never fabricate URLs/DOIs/titles/quotations/authors/dates/credentials — a validator cross-checks every generated factual claim against inspected evidence or labels it interpretive/uncertain.

**Acceptance (Vice and Reason).** Upload without manual refresh; auto title/author on sufficient evidence; page boundaries + authorial notes retained; explicit-citation recall ≥95%; *Nicomachean Ethics* as essential background; relevant Aristotle/virtue-ethics scholarship; all configured providers queried or explicitly reported unavailable; ≥40 relevant deduped resources and ≥20 A/B authority (unless saturation proves fewer); no per-social-platform minimum; weak sources separated; generated ≠ authorial; every factual claim traceable; zero fabricated bibliographic/quote/creator/credential/transcript/URL data; failed reprocess preserves the last edition.

---

## 34. Phase 9 — Interactive Learning Workspace (approved plan; complete 2026-07-20)

**Status:** approved 2026-07-20, **complete 2026-07-20** — sub-phases 9.1–9.7 shipped and canary-verified/production-applied, tagged `phase-9-complete`. Supersedes the old "Phase 9 = Educational Companion Site", which is now Phase 11 (§31). This section is the plan of record; `docs/PROJECT-LOG.md`'s changelog remains the record of what actually shipped. **9.8 "Comprehensive dossier" was retired before implementation** (see §34.2/§34.4 note below) — Phase 9's own original objective is completed instead by Phase 10 (§35).

### 34.1 Objective

Phase 8 produced a trustworthy critical edition: relevant sources, honest credibility, evidence-linked claims. Phase 9 turns that edition into a **workspace a reader learns in** — adapting to their level without ever hiding depth, anchoring every explanation to the passage it explains, and organising what to read next.

### 34.2 Delivery shape

Sub-phases **9.1–9.7**, each committed, pushed and verified before the next begins, gated behind **`ANALYSIS_PIPELINE=v3`** with v2 retained as rollback. **Core edition first**, so canary runs cost cents, not dollars, while the pipeline is still moving. *(Originally planned as 9.1–9.8, with a 14-module "Comprehensive dossier" deferred to 9.8. Retired before implementation: an exhaustive grep across this plan, the project log, and the changelog found the "14 modules" referenced by count everywhere and enumerated nowhere, and given the real AI-spend stakes attached to it, guessing at scope was rejected in favor of retiring it outright. Phase 9's own original objective — full-depth adaptivity without hiding anything — is completed instead by Phase 10, §35.)*

> **Known trap.** `ANALYSIS_PIPELINE` is compared by exact equality today (`=== "v2"` in `apps/worker/src/index.ts`, `!== "v2"` in `apps/web/src/app/api/works/[workId]/reprocess/route.ts`). Setting `v3` would silently fall back to v1 *and* disable the reprocess route. Replace both with a version-aware helper in 9.1, before anything else.

### 34.3 Reuse, don't rebuild

| Need | Existing implementation |
|---|---|
| Learner profile primitives | `reading_record`, `understanding_rating` (0–100, ≥60 = known), `roadmap_override` — `packages/db/src/schema.ts` |
| Reader level | `users.preferences.expertise` — **3 levels today** (`beginner\|intermediate\|advanced`); Phase 9 needs 4 (`beginner\|undergraduate\|advanced\|research`). Migrate and map (`intermediate → undergraduate`), do not add a parallel field. |
| Ranking | `packages/roadmap` pure `rankRoadmap()` + `apps/web/src/lib/roadmap.ts` recursive-CTE traversal |
| Graph | `apps/web/src/lib/graph.ts`, `components/graph/*` (3D + mandatory accessible table sharing one filter set) |
| Work identity | `packages/research/src/workIdentity.ts` + `research_resource.work_*` (migration `0014`) |
| Relevance gate | `packages/research/src/relevance.ts` (12 lanes, verdicts, `research_candidate`) |
| Credibility | `credibility_assessment` (authority A–E, agreement, relevance, evidence strength) |
| Edition assembly | `apps/web/src/lib/edition.ts` `getPublishedEdition()` (already returns work-grouped `works`) |
| Passage anchoring | quote+prefix+suffix fingerprint in `reader/highlightDom.ts` |
| Cost gating | `canAfford()` / `overSoftCap()` in `packages/research/src/discover.ts` |

### 34.4 Sub-phases

- **9.1 Foundations & flag.** Version-aware pipeline helper (`v1|v2|v3`). Migration `0015`: 4-level `reader_level` enum + mapping; `concept`, `concept_mastery`, `work_identity` (promoting run-scoped `work_key` to a shared table), `learning_resource`, `resource_role`. Schema only, no behaviour change.
- **9.2 Research sequence v3.** Canonical identity → structural outline → section/passage anchors → explicit citations → concepts/people/debates → lane discovery → relevance gate → creator verification → citation-graph expansion → credibility → claims → conservative influence classification. Adds creator identity and separates credibility into publication rigor, creator expertise, host provenance, evidence strength, relevance, pedagogical value, and popularity — **popularity is displayed but never scored as credibility**.
- **9.3 Passage-anchored annotations.** Valid page+block anchor, ≤240-character summary, expandable explanation, type, reader level, confidence, relationship, evidence. Whole-document synthesis is allowed but must be labelled "Whole-work guidance" and must never carry a fabricated anchor.
- **9.4 Reader levels & concept mastery.** Four levels; optional skippable 5–10 question per-work diagnostic. Precedence: explicit rating → diagnostic → completed prerequisites (weak evidence only) → global level. **Level changes what opens by default, never what is reachable**: always show the level selector, per-level counts, and "Show all levels". Browsing alone never silently changes a level.
- **9.5 Library & work grouping.** Split `/works` (uploads) from `/library` (recommended sources), with the spec's tabs, filters, sorts and reading states. Nav: Dashboard · Works · Library · Graph · Upload.
- **9.6 Curriculum & study guide.** Five stages; minimal / university / graduate routes; acyclic dependencies; per-item rationale, time, difficulty and checkpoint. Completed items become review-only rather than disappearing.
- **9.7 Graph, trash, cost UI.** Graph nodes extended to concepts/people/traditions/debates/sections, filters persisted in the URL and **identical** across the 3D scene and the accessible table. 30-day work trash with restore and idempotent purge. Cost estimate and actual, per run and per module, with hard stops.

**9.8 retired before implementation** — see §34.2. Phase 9's own original objective (§34.1) is completed instead by Phase 10, §35.

### 34.5 Cost posture

Core edition ~$0.50–2/run, hard cap $5. No call begins if its projected maximum crosses the cap — reuse `canAfford()`. *(The Comprehensive-dossier cost tier — $3–10, warn at $8, user-confirmed ceiling $20 — was specific to the retired 9.8 and no longer applies; see §34.2.)*

### 34.6 Acceptance gates

Every passage annotation has a valid anchor · Reader/Library/Curriculum/Graph share canonical IDs · 3D and accessible-table filters yield identical sets · relevant expert lectures accepted and correctly labelled "not peer-reviewed" · unrelated popular media rejected · anonymous comments never solely support a factual claim · reader state survives reload · Library status changes immediately affect Curriculum and Graph · cost warnings and hard stops fire · trash/restore/purge retry-safe · **a failed v3 publish leaves the previous edition served** · then tag `phase-9-complete`. **All met, 2026-07-20.**

### 34.7 Testing

Pure logic unit-tested offline; the pipeline proven by canary — the Phase 8 pattern that caught seven defects unit tests could not. E2E stays **seeded and CI-safe** (no worker, GROBID or API spend), as `apps/web/e2e/edition.spec.ts` demonstrates. Canary from the private `eval-fixtures` Irwin PDF, then an owner-only production canary, **purging production after every run**.

---

## 35. Phase 10 — Workspace Depth & Adaptivity Completion (approved plan)

**Status:** approved 2026-07-20, in progress. Returns to and completes Phase 9's own original objective (§34.1, restated below) rather than inventing new scope, after 9.8 was retired as a phantom requirement (§34.2). Nothing built in 9.1–9.7 is removed or replaced — this phase only adds/enhances. The old Phase 10 (Educational Companion Site) is renumbered Phase 11 (§23, §31).

### 35.1 Objective

*"Turn the published critical edition into a workspace that adapts to the reader's level without ever hiding depth — passage-anchored annotations, a Library of every recommended source, curriculum routes, an entity-rich knowledge graph, and safe deletion."* (§34.1/§23 Phase 9's own original wording.) Sub-phases 9.1–9.7 built the mechanisms; Phase 10 closes the concrete gaps that remain between what those mechanisms do today and that full objective.

### 35.2 Scope, audited against the shipped codebase rather than guessed

| Requirement | Current state (9.1–9.7) | Phase 10 action |
|---|---|---|
| Reader shows clickable highlights/markers explaining terms, jargon, foreign concepts, moves, arguments, claims | Built (9.3): `passage_annotation`, inline collapsed/expandable notes in `EditionReader.tsx`, `annotationType` enum incl. `definition`/`clarification` | Verify the extraction prompt (`packages/research/src/passageAnnotations.ts`) actually targets terminology/jargon explicitly, not just general passage commentary — tighten if it's under-indexing on definitions |
| Sources classified by credibility, type, relevance | Built (9.2a/9.2b): separated credibility dimensions, `resourceType`, `resource_role.confidence` | None — already correct |
| 10 relationship categories (background/context, similar argument, influenced-by, influenced, explanation, etc.) | Built (Phase 4/9.1): `relationship_category` enum, reused everywhere | None |
| Annotations show which text/source they relate to and how, with a link | Gap: `PassageAnnotationNote` renders type/level/confidence/summary/explanation/quote but never surfaces `relationship` or `relatedResourceId`, even though both are already fetched | Add the relationship label + a link to the related resource (when set) to the existing card — no new schema, no new AI call, pure UI |
| Filter/sort annotations by type, topic, relevance, credibility | Gap: `AnnotationsPanel.tsx` only has a `showHidden` toggle, no filter/sort at all, unlike Library | Add filter/sort controls mirroring `LibraryView.tsx`'s established pattern |
| Library sources default-scoped to reader level (not just an optional filter) | Gap: Library's reader-level control is an optional filter dropdown; Roadmap/Curriculum already default-scope-then-offer-"show all" | Bring Library's reader-level behavior in line with Roadmap/Curriculum's established default-then-override pattern |
| Reading behavior (read/reading/to-read/not-interested) gauges reader's knowledge level | Partial: `concept_mastery` already infers from completed prerequisite works (9.4); no broader "suggest a reader level from aggregate Library behavior" exists | New: a suggested-level nudge derived from Library completion patterns — surfaced as a suggestion the reader can accept or ignore, never a silent overwrite (same precedent as 9.4's mastery precedence chain) |
| 3D graph made visually rich, interactive, effect-heavy; node filtering | Filtering: built (9.7). Visual richness: deliberately restrained per an earlier design decision this explicitly reverses | Add directional link particles, hover-highlight of the neighbor subgraph, click-to-focus camera fly-to, richer node materials — still driven by the same palette tokens, so meaning doesn't drift, only presentation does. The accessible table stays an equal, unchanged fallback |
| Every view shows how a source relates to the main/focus work | Partial — Library has "recommended for" chips; Graph has the primary node; Curriculum is inherently per-work | Small audit/polish pass: a consistent "primary work" badge/anchor treatment across Library, Graph, and Curriculum |
| Upload any work, build competency with no prior knowledge | Already the whole product's premise (Phase 0 brief); Phase 10 is in service of this, not a discrete task | — |
| Convenient UI throughout | Ongoing | Applied per-feature above, not a separate task |

Pure-UI items above (annotation relationship/link display, annotation filter/sort, Library default-scoping, graph visual richness) need no migration and no canary. The jargon-extraction tightening and the suggested-reader-level nudge touch the worker/AI pipeline and require the full established discipline: schema change if any, worker wiring, local + CI-safe tests, then an owner-approved production canary before being marked done.

### 35.3 Reference-project-informed techniques (ideas only, no code reuse, never named)

Four techniques surveyed from prior-art research as starting points, interleaved into §35.2's work rather than built as a separate track. **Outcome (2026-07-20), each independently audited against the shipped codebase before writing any code — one adopted, one already satisfied, two assessed and honestly declined:**
1. **A cheap two-stage pre-filter ahead of the relevance gate's LLM calls — assessed, not applicable.** `relevance.ts`'s own header confirms the gate is already deterministic with no LLM call at all, so there's nothing to pre-filter ahead of; the real per-candidate cost (`classifyRelationship`/`synthesizeNote` in `apps/worker/src/analyze.ts`) is already capped and budget-gated.
2. **Deterministic evidence-strength scoring from structural cues — adopted.** `evidenceStrength` turned out to be a binary snippet-presence heuristic, not an LLM judgment, so the "reduce LLM reliance" framing didn't apply — but the structural-cue scoring (study design, sample size, statistics, hedging, scoped to scholarly articles) is still a real, standalone improvement over the binary check, and is now live (`structuralEvidenceStrength()`, `credibilityV3.ts`).
3. **Ideas about what makes a knowledge graph feel alive — already satisfied** by §35.2's graph-richness item (directional particles, hover-highlight, click-to-focus), which stayed on `react-force-graph-3d` with no engine rewrite as planned.
4. **Concurrent/parallel LLM calls per document — assessed, not adopted.** Provider-level concurrency across discovery adapters already exists (`Promise.all` in `discover.ts`'s round loop) — the real remaining sequential stage is the per-candidate classification/credibility/note-synthesis/DB-write loop in `analyze.ts`, and parallelizing it would race the shared `CostBudget`'s check-then-charge pattern and risk non-deterministic write ordering across foreign-key-dependent inserts. Declined per this section's own caveat rather than forced.

Full reasoning and verification for each: `docs/PROJECT-LOG.md`'s Phase 10 entry.

### 35.4 Acceptance gates

Every pure-UI item ships with typecheck/lint/test/build green, relevant CI-safe Playwright coverage, and a manual screenshot. Every AI-pipeline-touching item ships with the same plus a migration (if needed) and an owner-approved production canary. No regression in any 9.1–9.7 behavior. Then tag `phase-10-complete`.
