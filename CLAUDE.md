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
| JWT session strategy + `users.sessionVersion` counter, not database sessions | Auth.js v5's Credentials provider requires JWT sessions — DB sessions only auto-wire for OAuth-adapter flows. Revocability (deviation from plan §14's literal wording) is achieved by checking `sessionVersion` in the `jwt` callback on every request and incrementing it to invalidate all outstanding JWTs (used on password reset); verified working end-to-end in Phase 1a testing. |
| Colima + Docker CLI for local Postgres, not Docker Desktop | No GUI first-run dialogs to accept — this session/sandbox can't interact with them |
| Node 24 (Active LTS), not the Homebrew-default Node 26 (Current) | More predictable support on Vercel/Render; explicit `brew uninstall node && brew install node@24` swap, pinned via `.node-version` and `package.json#engines` |
| `packages/ai-adapters`, `ingestion`, `bibliographic`, `ui` not yet scaffolded | Deliberate deviation from the plan's Phase-1 "empty-but-wired" wording — creating unused stub packages ahead of the phase that needs them is premature scaffolding; each is created when its phase starts (ui in Phase 3, the rest in Phase 4) |

Full rationale for every stack choice, including rejected alternatives: plan §4–§6.

## Current Implementation Status

**Phase 0 — Research & Planning: complete. Phase 1 (Foundation, local + deployed): complete.** Phases 2–8 not started.

- Repo: https://github.com/hyderhusainarastu/interactive-critical-edition (private)
- Checkpoint tags: `phase-0-complete`, `phase-1a-complete`, `phase-1-complete`
- **Production:** https://interactive-critical-edition.vercel.app (Vercel project `interactive-critical-edition` under team `interactive-critical-edition-cli`, `orgId: team_YkskgkZCyT0CUnxpL2ScKrvE`, `projectId: prj_WagoBYEk4PNHN4AusHklxIok0FCR`)
- **Database:** Supabase project `interactive-critical-edition` (ref `vlrzvwswippuaitmrujz`, org `jkcecpjinqwpwxfvuylf`, region `us-east-1`), `pgvector` enabled, Phase 1 migrations applied.
- Auth (signup → email verification → login → protected route → password reset → session revocation) verified working end-to-end **twice**: against local Postgres (2026-07-17) and again against the real production deployment + real Supabase DB (2026-07-18) — both via actual HTTP requests, not just typecheck.

## Completed Tasks

**Phase 0:**
- [x] Full implementation plan written and approved (`docs/architecture/plan.md`).
- [x] ScholarLens inspected via GitHub API; license verdict recorded (no LICENSE file found).
- [x] Filesystem case-sensitivity constraint on `CLAUDE.md`/`Claude.md` verified and documented.
- [x] `git init`, `.gitignore`, `README.md`, `CLAUDE.md`, `.env.example` created and committed (`0b148b6`).
- [x] Private GitHub repo created (`gh repo create --private --source=. --push`), initial commit pushed to `main`.
- [x] `phase-0-complete` tag created and pushed.

**Phase 1a (local foundation):**
- [x] Toolchain bootstrapped on this machine: Node 24 LTS, pnpm via Corepack, Colima + Docker CLI + `docker-compose` plugin (see Known Problems for setup gotchas).
- [x] Repo-local git identity set (`git config --local`, not `--global`).
- [x] pnpm monorepo scaffold: root `package.json`/`pnpm-workspace.yaml`, `apps/web` (Next.js App Router + Tailwind v4 + warm-palette design tokens per plan §19), `packages/db` (Drizzle ORM).
- [x] Local Postgres + pgvector via `docker-compose.yml` (Colima runtime).
- [x] Drizzle schema (Phase 1 scope: `user`/`account`/`session`/`verification_token`/`password_reset_token`) + 2 migrations applied locally.
- [x] Auth.js v5 wired: Credentials provider, bcrypt hashing, `DrizzleAdapter`, JWT sessions + `sessionVersion` revocation (see Design Decisions).
- [x] Signup, email verification, login, password reset flows — pages + server actions + API routes, all tested live against the local dev server (not just typechecked).
- [x] `MailProvider` adapter: `ResendMailProvider` / `ConsoleMailProvider` fallback (verified the console fallback logs a working link when `RESEND_API_KEY` is unset).
- [x] Protected `/dashboard` page (server-side `auth()` check, verified redirects unauthenticated requests to `/login`).
- [x] GitHub Actions CI (`.github/workflows/ci.yml`): lint, typecheck, test, build, against an ephemeral Postgres service container — no external secrets required.
- [x] `phase-1a-complete` tag.

**Phase 1b (real Supabase + Vercel):**
- [x] Supabase org + project created via CLI (personal access token), `pgvector` enabled, Phase 1 migrations applied and verified against the real DB.
- [x] Vercel project created and linked; **Root Directory set to `apps/web`** via the API (see Known Problems — this is required for a pnpm monorepo, `vercel link`/`vercel --prod` from the subdirectory alone silently uploads only that subtree and loses pnpm-workspace context).
- [x] Production env vars set (`DATABASE_URL` = Supabase transaction pooler :6543, `DIRECT_URL` = Supabase direct :5432, `AUTH_SECRET` = freshly generated, distinct from the local dev one, `AUTH_URL`/`NEXT_PUBLIC_APP_URL` = the assigned `*.vercel.app` domain).
- [x] Deployed to production; full auth flow (signup/verify/login/dashboard) re-verified live against https://interactive-critical-edition.vercel.app and the real Supabase DB.
- [x] Test user cleaned up from the production DB after verification.
- [x] `phase-1-complete` tag.

## Remaining Tasks (near-term)

- [ ] Phase 2 (Upload and Library) per `docs/architecture/plan.md` §23.
- [ ] Phases 3–8 per `docs/architecture/plan.md` §23.
- [ ] Not yet built, deferred to their owning phase: `packages/ai-adapters`, `packages/ingestion`, `packages/bibliographic`, `packages/ui`, `apps/worker`, Sentry wiring, centralized middleware-based route protection (currently per-page `auth()` checks — fine for the one protected page that exists, revisit once Phase 2 adds several).
- [ ] Supabase Storage bucket not yet created (needed starting Phase 2 for uploads).
- [ ] GitHub↔Vercel Git integration not yet connected — current deploys are CLI-triggered (`vercel --prod`), not automatic on push. Connect via the Vercel dashboard (Project Settings → Git) when convenient, or continue deploying manually per phase checkpoint.

## Known Problems and Technical Debt

- Documented (not a bug): `CLAUDE.md`/`Claude.md` cannot coexist as separate files on this machine (case-insensitive filesystem) — see the note at the top of this file.
- **Git push hangs (environment gotcha):** plain `git push`/`git ls-remote` over HTTPS hangs indefinitely because the system-level `osxkeychain` git credential helper (`/opt/homebrew/etc/gitconfig`) waits on a GUI keychain-unlock prompt that never appears in this sandbox. Workaround: `git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin main` — **both** `-c` flags are required: `credential.helper` is a cumulative list-type config, so `-c credential.helper='!gh auth git-credential'` alone just *adds* a helper without removing the system-level `osxkeychain` entry, which still runs first and hangs (or returns a stale/wrong token). The first `-c credential.helper=` (empty value) clears the inherited list; the second one then adds only the `gh`-backed helper. `gh` commands (e.g. `gh repo create --push`) are unaffected by any of this.
- **Pushing changes to `.github/workflows/*.yml` needs the `workflow` OAuth scope**, which `gh`'s default token doesn't have. One-time fix: `gh auth refresh -h github.com -s workflow` (interactive — opens a device-code browser approval). Without it, the push is rejected with "refusing to allow an OAuth App to create or update workflow ... without workflow scope", even though the same push works for every other file.
- **`docker compose` plugin isn't found by default after `brew install docker-compose`:** Homebrew's Docker CLI doesn't look in `/opt/homebrew/lib/docker/cli-plugins` unless told to. Fix (already applied, `~/.docker/config.json`): add `"cliPluginsExtraDirs": ["/opt/homebrew/lib/docker/cli-plugins"]`.
- **`supabase login` / `vercel login` need a TTY this sandbox doesn't have** (device-code/browser callback flows fail with e.g. `LegacyLoginMissingTokenError`). Workaround used: generate a personal access token from each dashboard (Supabase: Account Settings → Access Tokens; Vercel: Account Settings → Tokens) and pass it per-command as `SUPABASE_ACCESS_TOKEN=... supabase ...` / `VERCEL_TOKEN=... vercel ...`, never via an interactive login step.
- **pnpm's global bin dir isn't on PATH by default** (`pnpm add -g` fails with "configured global bin directory ... is not in PATH"). One-time fix: `pnpm setup` (writes `~/.zshrc`), but since this environment's Bash tool doesn't source shell rc files between commands, every command needing a pnpm-global binary (e.g. `vercel`) must still `export PNPM_HOME="$HOME/Library/pnpm"; export PATH="$PNPM_HOME/bin:$PATH"` inline.
- **Vercel + pnpm monorepo: deploying from the app subdirectory silently breaks the build.** Running `vercel link`/`vercel --prod` from inside `apps/web` uploads only that subtree, so Vercel never sees the root `pnpm-lock.yaml`/`pnpm-workspace.yaml` and falls back to `npm install` (which then fails on the workspace-only `@ice/db` dependency). Fix: set the Vercel project's **Root Directory** to `apps/web` (no CLI flag for this — used `vercel project update` first, which lacks a root-directory option, then the REST API: `PATCH /v9/projects/:id?teamId=...` with `{"rootDirectory":"apps/web"}`), then deploy **from the repo root** so the whole monorepo — including the root lockfile — gets uploaded and Vercel `cd`s into Root Directory to build.
- **Vercel REST API calls need the *actual* `orgId`, not a value hand-transcribed from a JWT.** A `PATCH` to `/v9/projects/:id?teamId=...` returned "Not authorized" using a `teamId` misread from the `VERCEL_OIDC_TOKEN` payload (visually similar-looking ID, one character off). The authoritative value is in `.vercel/project.json` (`orgId`) written locally by `vercel link` — use that, not a manually parsed token.
- **The Supabase DB password is auto-generated and not recoverable** — it was generated with `openssl rand` during project creation and passed straight to `supabase projects create --db-password`; Supabase never displays a project's DB password again after creation (by design). It was surfaced to the user once, out-of-band, right after creation. If it's ever needed again and lost, reset it via Supabase Dashboard → Project Settings → Database → Reset Database Password, then update `DATABASE_URL`/`DIRECT_URL` in Vercel (`vercel env rm` + `vercel env add`) and redeploy.
- **pnpm blocks postinstall scripts by default:** new dependencies with native/build postinstall steps (seen so far: `sharp`, `unrs-resolver`, `esbuild`) need explicit approval or `pnpm install` aborts with `ERR_PNPM_IGNORED_BUILDS`. Approve in `pnpm-workspace.yaml` under `allowBuilds:` (not `package.json#pnpm` — that field is no longer read by this pnpm version). Review each new one on its merits before approving; all three approved so far are well-known, trusted build tools.
- **No middleware-based route protection yet** — Edge middleware can't use our Postgres-backed `sessionVersion` check (`postgres.js` needs Node's TCP stack, unavailable at the Edge). Current mitigation: every protected page calls `auth()` server-side directly (Server Components run in the Node runtime). Fine for the single protected page that exists now; revisit (likely a route-group layout, or a Node-runtime middleware config) once Phase 2 adds more.
- No AI-provider or bibliographic-API integrations exist yet (Phase 4).
- Trivial, non-blocking CI annotation: `pnpm/action-setup@v4` is flagged by GitHub as targeting a deprecated Node 20 runner internally (it still runs fine, forced onto Node 24). Bump to a newer major when one addresses this.

## Database and API Decisions

- **ORM:** Drizzle ORM + `drizzle-kit` (native `pgvector` column support).
- **Full domain schema:** see plan §9 for the eventual table list — rolls in incrementally, one migration set per phase, never all at once.
- **Phase 1 schema (built, migrated locally):** `user` (includes `password_hash`, `session_version` beyond the Auth.js default shape), `account`, `session`, `verification_token`, `password_reset_token`. Two migrations: `0000_luxuriant_risque.sql` (initial tables), `0001_mighty_kylun.sql` (added `session_version`).
- **`@auth/drizzle-adapter` quirk (recorded so it isn't rediscovered):** its `AdapterAccount` type requires specific snake_case JS object keys on the `account` table definition (`refresh_token`, `access_token`, `expires_at`, `token_type`, `id_token`, `session_state` — matching OAuth2 spec field names), not the camelCase Drizzle convention used elsewhere. This is a TS-level object-key requirement only; the actual DB column names are unaffected either way.
- **External APIs planned:** OpenAlex, Crossref, Open Library/Google Books, OpenAI + Anthropic, Resend, Sentry. None integrated yet beyond Resend (mail adapter built, untested against a real API key — console fallback verified in both local and production testing instead).
- **Production database is live**: Supabase project `interactive-critical-edition` (ref `vlrzvwswippuaitmrujz`), Phase 1 migrations applied and verified. Local dev intentionally still targets local Docker Postgres, not Supabase, to avoid burning free-tier quota/connections on routine dev work — this is a deliberate separation, not an oversight.

## Commands

```sh
# Local dev environment (one-time)
brew install node@24 && brew link --overwrite node@24
corepack enable && corepack prepare pnpm@latest --activate
brew install colima docker docker-compose && colima start
# then add "cliPluginsExtraDirs": ["/opt/homebrew/lib/docker/cli-plugins"] to ~/.docker/config.json

# Day to day
pnpm install
docker compose up -d postgres
pnpm --filter @ice/db db:migrate
pnpm dev                       # apps/web on http://localhost:3000

pnpm -r lint
pnpm -r typecheck
pnpm -r test                   # no-ops until Phase 4 adds Vitest
pnpm --filter web build

pnpm --filter @ice/db db:generate   # after editing packages/db/src/schema.ts
pnpm --filter @ice/db db:migrate
pnpm --filter @ice/db db:studio

# Deploy (manual — Git integration not yet connected, see Remaining Tasks)
export PNPM_HOME="$HOME/Library/pnpm" && export PATH="$PNPM_HOME/bin:$PATH"   # if `vercel` isn't found
cd apps/web && VERCEL_TOKEN=<token> vercel link --yes --project interactive-critical-edition   # one-time per machine
cd ../..  # deploy must run from repo ROOT, not apps/web — see Known Problems
VERCEL_TOKEN=<token> vercel --prod --yes

# Run a migration against the real production DB (direct connection, not the pooler)
# get the DB password from your own records / reset via Supabase dashboard if lost
cd packages/db && DATABASE_URL="postgresql://postgres:<url-encoded-password>@db.vlrzvwswippuaitmrujz.supabase.co:5432/postgres" pnpm db:migrate

# Push (see Known Problems re: osxkeychain hang — both -c flags required)
git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin main
```
Deploy: live at https://interactive-critical-edition.vercel.app, currently via manual `vercel --prod` (see above) — GitHub↔Vercel Git integration not yet connected, so pushes to `main` do not auto-deploy yet.

## Credentials, Environment Variables, and External Services

No values are ever stored here or in the repo. Variable **names** live in [`.env.example`](./.env.example): `DATABASE_URL`, `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`, `AUTH_SECRET`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENALEX_POLITE_POOL_EMAIL`, `CROSSREF_POLITE_POOL_EMAIL`, `GOOGLE_BOOKS_API_KEY`, `RESEND_API_KEY`, `SENTRY_DSN`. Local dev values (non-secret, local-only) live in `apps/web/.env.local` and `packages/db/.env`, both gitignored; production values live only in Vercel's encrypted env var store (`vercel env ls production` to review, values not retrievable in plaintext via CLI once set). External services now provisioned: GitHub repo, Supabase project, Vercel project. Still needed: Render service (Phase 2), OpenAI/Anthropic API keys (Phase 4), a real Resend account (optional — console fallback works without it), Sentry (not yet wired at all), a Supabase Storage bucket (Phase 2).

## Changelog

- **2026-07-17** — Plan approved. Repo scaffolding started: `git init`, `.gitignore`, `README.md`, `CLAUDE.md`, `.env.example`, `docs/architecture/plan.md` created.
- **2026-07-17** — Phase 0 complete: private GitHub repo `hyderhusainarastu/interactive-critical-edition` created, initial commit `0b148b6` pushed to `main`, checkpoint tag `phase-0-complete` pushed. Discovered and documented the `osxkeychain` credential-helper hang workaround.
- **2026-07-17** — User requested a 3D knowledge-graph visualizer and an independent educational companion site (Phase 8); both folded into the plan (`docs/architecture/plan.md` §9/§16/§17/§19/§20/§23/§31) before implementation began.
- **2026-07-17** — User set an explicit cost constraint (optimize both infra and AI-token spend equally at single-user scale, managed services over self-hosting); folded into plan §3/§5/§11.
- **2026-07-17** — Phase 1a complete: bootstrapped a bare machine (Node, pnpm, Colima/Docker) from scratch; scaffolded the pnpm monorepo; built and live-tested the full auth flow (signup/verify/login/reset/session-revocation/logout) against local Postgres; added CI, fixed a `setup-node`/pnpm step-ordering bug, confirmed green on GitHub (run `29629412095`). Repo-local git identity set. Several environment gotchas discovered and documented (see Known Problems), including a correction to the credential-helper workaround itself and the `workflow` OAuth scope requirement for pushing CI files.
- **2026-07-18** — Phase 1b complete (with the user providing Supabase/Vercel personal access tokens, since both CLIs' interactive login flows need a TTY this environment doesn't have): created the Supabase org+project via CLI, enabled `pgvector`, applied and verified Phase 1 migrations against the real DB. Created and linked the Vercel project; hit and fixed a real monorepo deploy bug (deploying from `apps/web` alone loses the pnpm-workspace root context and Vercel falls back to `npm install`, which fails) by setting Root Directory via the REST API and redeploying from the repo root. Set production env vars (fresh `AUTH_SECRET`, Supabase pooler/direct connection strings, production `AUTH_URL`). Deployed to production and re-verified the full auth flow live against https://interactive-critical-edition.vercel.app and the real Supabase DB; cleaned up the test account afterward. Tagged `phase-1-complete`. Next: Phase 2 (Upload and Library).

## Resuming Work After a New Claude Code Session

1. Read this file top to bottom — it reflects the actual current state, not the plan's aspirational state.
2. Read `docs/architecture/plan.md` for full architectural detail on whatever you're about to touch.
3. Check `git log --oneline -20` and the most recent tag (`git tag --list`) to see the last completed phase checkpoint.
4. Check "Remaining Tasks" above for the next unchecked item — work top to bottom within the current phase.
5. Before starting new work, confirm the working tree is clean (`git status`) and there's nothing uncommitted from a prior session.
6. After every meaningful step: update this file's Changelog, Completed/Remaining Tasks, and Current Implementation Status, then commit and push. Do not batch multiple days of undocumented work.
7. Never mark a phase complete in this file unless its tests pass and its Definition of Done (plan §23) is actually met.
