# CLAUDE.md — Interactive Critical Edition

Canonical project memory and progress file for Claude Code. Read this first when resuming work. Keep it current after every meaningful step — this file must never drift from the actual state of the codebase.

**A note on the filename:** the user's original request asked for both `CLAUDE.md` and a synchronized `Claude.md` compatibility copy. This machine's filesystem (macOS APFS, default configuration) is **case-insensitive** — confirmed empirically during planning (`touch CLAUDE_test.md && ls claude_test.md` succeeded). `CLAUDE.md` and `Claude.md` are the same directory entry here and cannot exist as two distinct files. `CLAUDE.md` is therefore the single canonical file. If this repo is ever cloned onto a case-sensitive filesystem (Linux CI, most Docker containers, a case-sensitive APFS volume), a `Claude.md` symlink to `CLAUDE.md` can be added there safely with no drift risk.

---

## Purpose

A web application that helps readers understand difficult scholarly works (philosophy, monographs, research articles) by automatically generating an interactive "critical edition": an annotated reader that surfaces explicit citations, implicit intellectual context, and secondary literature, and turns that into a personalized, priority-ranked reading roadmap. Serves both researchers working deeply in an established field and readers entering a field for the first time. Not a substitute for reading primary sources — every AI-generated claim carries confidence and provenance rather than being presented as settled scholarship.

Full product definition, worked examples (Heidegger, Vico), and the complete requirement inventory: [`docs/architecture/plan.md`](./docs/architecture/plan.md) §1–§2.

## Functional Requirements (summary — full detail in the plan)

- Upload and process scholarly texts (PDF, EPUB, TXT, Markdown in MVP; scanned/OCR PDF and DOCX phase-4-adjacent).
- Reader ("interactive critical edition"): original text + notes, AI- and user-generated annotations, highlights, bookmarks, search, adjustable typography, light/dark/distraction-reduced modes.
- Ten relationship categories for every recommendation (explicit reference, secondary-scholarly recommendation, historical/intellectual context, prerequisite, conceptual influence, disagreement/polemical target, interpretive aid, parallel/comparison, optional extension, AI-inferred), each with explanation, evidence, confidence, provenance, verification status.
- Personalized, dependency-ordered reading roadmap with priority tiers, manual overrides, concise/comprehensive modes, time/depth/expertise filters.
- Personal reading catalogue and knowledge profile (status, understanding ratings 0–100 with labels, chapter/section-level progress).
- Multi-work workspace: tabs, sidebar, split-pane reading across two works.
- **3D knowledge-graph visualizer** (added by explicit user request during planning): per-user, per-work and global, showing works/figures/concepts/traditions, read/unread status, and missing (referenced-but-unacquired) links, with a mandatory accessible table fallback.
- Auth, per-user data isolation, admin tooling, testing, accessibility (WCAG 2.2 AA), and privacy/copyright policy as detailed in the plan.
- **Phase 8 (post-hardening):** build a fully independent educational companion site teaching this project's build, start to end.

Complete, section-by-section requirement inventory (nothing from the original brief dropped): plan §2.

## Architecture and Tech Stack

TypeScript throughout. Next.js (App Router) on Vercel (web UI + CRUD API routes + Auth.js) + a Node worker service on Render (pg-boss consumer: ingestion, OCR, citation extraction, AI relationship classification, bibliographic lookups, roadmap computation) + Supabase (Postgres + `pgvector` + Storage) as the shared system of record. AI: OpenAI + Anthropic behind a common provider-adapter interface, cheapest-tier-first routing. 3D graph: `react-force-graph-3d`. Full stack table, alternatives comparison, and text architecture diagram: plan §5–§8.

**Cost constraint (explicit, drives several choices below):** optimize for lowest cost at current single-user scale, on infra and AI-token spend equally; managed services (Vercel/Supabase/Render) stay as chosen rather than trading for self-hosting. Free tiers used everywhere realistically possible (Vercel Hobby, Supabase free, Sentry free, Resend free). The one recurring paid cost: Render's worker needs at least the ~$7/mo Starter instance, since a persistent job consumer can't run on Render's free (sleep-on-idle) tier — called out explicitly, not hidden. See plan §3/§5.

## Important Design Decisions and Rationale

| Decision | Rationale |
|---|---|
| Vercel + Supabase + Render, not AWS/GCP or self-hosted VPS | User-confirmed: lowest ops burden, still keeps growth headroom |
| Auth.js + own Postgres tables, not a managed auth vendor | Full control over verification/reset flows the brief requires; no vendor lock-in |
| OpenAI + Anthropic multi-provider from day one | User already holds OpenAI credits; wants flexibility, not to pay twice for the same call |
| `pgvector` in existing Postgres, not a dedicated vector DB | Brief explicitly says not to add a separate DB unless clearly justified |
| `graph_edges` generic table + recursive CTEs, not a graph database | Same reasoning; schema still supports a future graph-DB mirror if needed |
| pg-boss on Postgres, not Redis/BullMQ | One fewer service to operate and pay for |
| ScholarLens (github.com/aakashshahani/ScholarLens) — ideas only, zero code reuse | No LICENSE file exists in that repo (`gh api .../license` → 404, `license: null`) despite an MIT badge image with no actual license text; treated as all-rights-reserved |
| 3D knowledge-graph visualizer added, reconciled with "avoid excessive 3D" | That instruction targeted decorative landing-page chrome (explicit contrast with ScholarLens); this is one deliberate, opt-in, restrained data-viz tool behind login, with a mandatory non-3D accessible fallback |
| AI routing defaults to cheapest tier for every task, promoted only on eval-harness evidence | Explicit cost constraint — stricter than a generic cheap/expensive split |

Full rationale for every stack choice, including rejected alternatives: plan §4–§6.

## Current Implementation Status

**Phase 0 — Research & Planning: complete.** Repo created, initial commit pushed, checkpoint tagged. No application code exists yet — Phase 1 has not started.

- Repo: https://github.com/hyderhusainarastu/interactive-critical-edition (private)
- Initial commit: `0b148b6` — "Initial project governance: CLAUDE.md, README, env template, plan"
- Checkpoint tag: `phase-0-complete`

## Completed Tasks

- [x] Full implementation plan written and approved (`docs/architecture/plan.md`).
- [x] ScholarLens inspected via GitHub API; license verdict recorded (no LICENSE file found).
- [x] Filesystem case-sensitivity constraint on `CLAUDE.md`/`Claude.md` verified and documented.
- [x] `git init`, `.gitignore`, `README.md`, `CLAUDE.md`, `.env.example` created and committed (`0b148b6`).
- [x] Private GitHub repo created (`gh repo create --private --source=. --push`), initial commit pushed to `main`.
- [x] `phase-0-complete` tag created and pushed.

## Remaining Tasks (near-term)

- [ ] Phase 1: Next.js scaffold, Tailwind + design tokens, Drizzle schema + first migration, Auth.js credentials + email verification + reset flow, Supabase provisioning, Storage bucket, Sentry, CI.
- [ ] Phases 2–8 per `docs/architecture/plan.md` §23.

## Known Problems and Technical Debt

- None in application code yet — no code exists. This section will track real issues starting Phase 1.
- Documented (not a bug): `CLAUDE.md`/`Claude.md` cannot coexist as separate files on this machine (case-insensitive filesystem) — see the note at the top of this file.
- **Environment gotcha (recorded so it isn't rediscovered the hard way):** plain `git push`/`git ls-remote` over HTTPS hangs indefinitely in this environment because the local `osxkeychain` git credential helper waits on a GUI keychain-unlock prompt that never appears in this sandbox. Workaround: prefix git network commands with `-c credential.helper='!gh auth git-credential'` (uses the already-authenticated `gh` CLI's token instead), e.g. `git -c credential.helper='!gh auth git-credential' push origin main`. `gh` commands themselves (e.g. `gh repo create --push`) are unaffected and work normally.

## Database and API Decisions

- **ORM:** Drizzle ORM + `drizzle-kit` (native `pgvector` column support).
- **Schema:** see plan §9 for the full table list (`users`, `works`, `editions`, `documents`, `authors`, `chapters`/`sections`, `passages`, `footnotes`, `concepts`, `annotations`, `citations`, `bibliographic_records`, `reading_records`, `understanding_ratings`, `reading_roadmaps`, `roadmap_items`, `notes`/`bookmarks`/`highlights`, `collections`, `processing_jobs`, `audit_logs`, `admin_actions`, plus the generic `graph_edges` table). No migrations exist yet.
- **External APIs planned:** OpenAlex (primary bibliographic source), Crossref (DOI resolution), Open Library / Google Books (book metadata), OpenAI + Anthropic (LLM + embeddings), Resend (email), Sentry (errors). None integrated yet.

## Commands

Not yet available — will be filled in as each is implemented in Phase 1 onward. Placeholders:
```
# Install       (Phase 1) pnpm install
# Run (web)     (Phase 1) pnpm --filter web dev
# Run (worker)  (Phase 2) pnpm --filter worker dev
# Test          (Phase 1) pnpm test
# Migrate       (Phase 1) pnpm --filter db migrate
# Build         (Phase 1) pnpm build
# Deploy        (Phase 7) automatic via Vercel/Render on push to main
```

## Credentials, Environment Variables, and External Services

No values are ever stored here or in the repo. Variable **names** live in [`.env.example`](./.env.example): `DATABASE_URL`, `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`, `AUTH_SECRET`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENALEX_POLITE_POOL_EMAIL`, `CROSSREF_POLITE_POOL_EMAIL`, `GOOGLE_BOOKS_API_KEY`, `RESEND_API_KEY`, `SENTRY_DSN`. External services required by Phase 1: Supabase project, Vercel project, GitHub repo (created). Required later: Render service (Phase 2), OpenAI/Anthropic API keys (Phase 4), Resend/Sentry accounts (Phase 1).

## Changelog

- **2026-07-17** — Plan approved. Repo scaffolding started: `git init`, `.gitignore`, `README.md`, `CLAUDE.md`, `.env.example`, `docs/architecture/plan.md` created.
- **2026-07-17** — Phase 0 complete: private GitHub repo `hyderhusainarastu/interactive-critical-edition` created, initial commit `0b148b6` pushed to `main`, checkpoint tag `phase-0-complete` pushed. Discovered and documented the `osxkeychain` credential-helper hang workaround (see Known Problems). Next: begin Phase 1 (Next.js scaffold, auth, CI).

## Resuming Work After a New Claude Code Session

1. Read this file top to bottom — it reflects the actual current state, not the plan's aspirational state.
2. Read `docs/architecture/plan.md` for full architectural detail on whatever you're about to touch.
3. Check `git log --oneline -20` and the most recent tag (`git tag --list`) to see the last completed phase checkpoint.
4. Check "Remaining Tasks" above for the next unchecked item — work top to bottom within the current phase.
5. Before starting new work, confirm the working tree is clean (`git status`) and there's nothing uncommitted from a prior session.
6. After every meaningful step: update this file's Changelog, Completed/Remaining Tasks, and Current Implementation Status, then commit and push. Do not batch multiple days of undocumented work.
7. Never mark a phase complete in this file unless its tests pass and its Definition of Done (plan §23) is actually met.
