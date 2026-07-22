# Phase 19 System Inventory

Per `palimnote_phases_19_23_plan_revised.md` §19.3. Built from repository search (`find`, targeted `grep`), not from memory or prior documentation — cross-checked against `docs/PROJECT-LOG.md` where it made claims about coverage, and corrected where the grep found more than the log implied.

## Page routes (20)

| Route | Auth | Notes |
|---|---|---|
| `/` | public | Landing; protected visual contract (Phase 19.4). |
| `/privacy`, `/terms` | public | Policy pages. |
| `/(auth)/login`, `/signup`, `/reset-password`, `/verify-email` | public (pre-auth flows) | |
| `/(app)/dashboard` | `requireSession()` via `(app)` layout | |
| `/(app)/welcome` | `requireSession()` | Onboarding gate. |
| `/(app)/library` | `requireSession()` | |
| `/(app)/upload` | `requireSession()` | Multi-file sequential upload (Phase 14). |
| `/(app)/works`, `/works/[workId]`, `/works/trash` | `requireSession()` + `getOwnedWork()`/`getOwnedDocument()` | Trashed works excluded from `getOwnedDocument()` call sites; work detail page and trash routes use the narrower `getOwnedWork()` that still resolves trashed works (documented Design Decision). |
| `/works/[workId]/reader`, `/roadmap`, `/curriculum`, `/diagnostic`, `/graph` | `requireSession()` + `getOwnedDocument()`/`getOwnedWork()` | |
| `/graph` (global Visualization) | `requireSession()` | |
| `/ask-library` | `requireSession()` + `phase18RagEnabled()` feature gate | |
| `/writer`, `/writer/[projectId]` | `requireSession()` + `requireWriterApiUser`-equivalent ownership check | Feature-flagged (`writerEnabled`). |
| `/admin` | `requireSession()` + admin-email check | |

## API routes (55)

Full raw list captured via `find apps/web/src/app -iname route.ts`; grouped by owning surface below with the auth mechanism actually used (a naive grep for `getApiUserId|requireSession` initially under-counted — Writer and RAG routes wrap it in `requireWriterApiUser()`/`requireRagApiUser()`, both confirmed to call `getApiUserId()` internally, so there is no owner-scoping gap there, just an indirection the naive grep missed).

| Group | Routes | Auth |
|---|---|---|
| Auth | `/api/auth/[...nextauth]`, `register`, `request-reset`, `reset-password`, `verify-email` | Public by design (pre-session flows); NextAuth handler + Auth.js callbacks. |
| Preferences/reader-level | `/api/preferences`, `/api/reader-level`, `/api/command-menu` | `getApiUserId()` |
| Works lifecycle | `/api/works`, `/api/works/[workId]`, `/analyze`, `/confirm`, `/status`, `/reprocess`, `/restore`, `/purge`, `/api/works/trash`, `/api/works/upload`, `/upload/init`, `/upload/complete`, `/upload/proxy` | `getApiUserId()` + `getOwnedWork()`/`getOwnedDocument()` |
| Reader sub-resources | `/api/works/[workId]/reader`, `/annotations(+[id])`, `/bookmarks(+[id])`, `/highlights(+[id])`, `/notes(+[id])`, `/notes/[id]/highlights`, `/position`, `/terms/[id]` | `getApiUserId()` + `getOwnedDocument()` |
| Roadmap / curriculum / diagnostic / edition / graph (per-work) | `/api/works/[workId]/roadmap(+/item)`, `/curriculum`, `/diagnostic`, `/edition`, `/graph` | `getApiUserId()` + `getOwnedDocument()`/`getOwnedWork()` |
| Global graph | `/api/graph`, `/api/graph/expansion`, `/expansion/preview` | `getApiUserId()` |
| Library targets | `/api/library/[resourceId]/status` | `getApiUserId()` (resource is a shared, non-owned catalog entry — see route's own doc comment; only the caller's own reading-state row is scoped). |
| RAG | `/api/rag/conversations`, `/api/rag/conversations/[conversationId]` | `requireRagApiUser()` → `getApiUserId()`; feature-gated by `phase18RagEnabled()`. |
| Writer | `/api/writer/projects(+[id])`, `/citations`, `/documents(+[id])`, `/documents/[id]/revisions(+/[revisionId]/restore)`, `/export`, `/sources` | `requireWriterApiUser()` → `getApiUserId()`; feature-gated. |
| Admin | `/api/admin/pipeline-v4/backfill-forecast` | `getApiUserId()` + admin-email check (verify at implementation, not assumed from naming). |

## E2E spec coverage map (23 spec files)

`accessibility-sweep`, `annotations`, `auth`, `curriculum`, `diagnostic`, `edition`, `graph`, `graph-expansion`, `hardening`, `landing`, `landing-contract` (new, Phase 19.4), `library`, `onboarding`, `rag`, `reader`, `roadmap`, `security`, `trash`, `upload`, `upload-integrity` (new, Phase 19.7), `visual`, `workspace-shell`, `writer`.

**CI-safe subset** (`.github/workflows/ci.yml`, runs on every push): `landing`, `onboarding`, `security`, `edition`, `diagnostic`, `library`, `upload`, `curriculum`, `graph`, `trash`, `workspace-shell` — 11 of 23 spec files.

**Manual/non-CI subset**: `accessibility-sweep`, `annotations`, `auth`, `graph-expansion`, `hardening`, `landing-contract`, `rag`, `reader`, `roadmap`, `upload-integrity`, `visual`, `writer` — 12 of 23 spec files. The first group needs worker, Storage, or live APIs; `landing-contract` and `visual` are deliberately local visual gates. The new `upload-integrity` suite intentionally uses a real signed Storage URL and is isolated from CI's dummy-Storage upload fixture.

## Known gap surfaced by this inventory, not previously in the register

CI's "E2E (CI-safe specs)" step name and `docs/PROJECT-LOG.md`'s prose both describe an 11-spec CI-safe list; the actual `ci.yml` command matches that count exactly (verified above), so no drift found here — recorded as a confirmation, not a defect.

## Deferred to a later Phase 19 pass

A literal per-control interaction inventory (every button/link/tab/filter classified working/disabled/redundant/broken per §19.6) was not attempted in this pass — it requires exercising each authenticated surface interactively (user-journey audit, §19.5), which is the next piece of Phase 19 work, not a static-analysis task like this route inventory was. Recorded here rather than silently claiming §19.6 is done.
