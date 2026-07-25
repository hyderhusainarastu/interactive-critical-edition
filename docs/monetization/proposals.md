# Monetization Proposals — Metering, Plans, and Margin

**Status:** internal planning document, no code, no accounts, nothing implemented. Written for Workstream K of the
Palimnote v.5 program. Every number below is either pulled live from the production database (read-only,
`supabase db query --linked`) on 2026-07-25, or explicitly labeled an estimate.

**Why this document can talk about money freely:** the product itself has a deliberate, existing rule — no
user-facing cost figures anywhere in the UI or API responses (see `docs/PROJECT-LOG.md` Design Decisions and the
2026-07-24 "Workstream F — processing cost privacy" changelog entry, which stripped monetary figures from reader
metadata and the graph-expansion API). That rule governs the *product surface*. It says nothing about this
internal document, which exists specifically to reason about costs and prices before any of that reasoning
reaches a user-facing screen. If any of the tiers below ship, the UI must keep expressing usage in the plan's own
unit (documents, credits, chat messages) — never in dollars — matching the precedent already set for the Phase
19–24 program's planned `plan/page.tsx` ("conic-gradient usage meters ... no cost figures").

---

## 1. Metering-unit analysis

Four candidate units, evaluated against the actual cost driver found in production data (§3 below shows the
receipts): AI spend is **not** proportional to file size or page count in any simple way — it is proportional to
how much the research/classification pipeline finds and writes about a document, which in turn is a function of
the document's *citation and reference density* after extraction, not its raw byte size.

| Unit | What it measures | Verdict |
|---|---|---|
| **Uploads** (count of documents) | Nothing about cost. A 5-page pamphlet and a 400-page monograph both count as "1 upload." | Reject as the *sole* unit — but keep as a coarse abuse gate (see §4), because it is the cheapest thing to rate-limit before any paid work starts. |
| **Pages** | Proxy for extraction cost (GROBID/OCR, not logged in `ai_usage_log` since it runs before any billed AI call) but a poor proxy for the AI spend that actually shows up in the ledger. Two 300-page books can differ 10x in downstream AI cost depending on footnote/citation density — a philosophy monograph with hundreds of citations triggers far more `note_synthesis` and `relationship_classification` calls (see §3) than a lightly-annotated novel of the same length. | Reject as primary unit; useful only as a rough free-tier ceiling ("no single document over N pages on Free"). |
| **Post-extraction token count** (of the extracted body text, measured immediately after the free deterministic extraction stage, before any paid AI call runs) | This is available *before* any money is spent, and it correlates with the real driver: more source text → more citations/footnotes discovered → more resources researched → more `note_synthesis`/`relationship_classification`/`passage_annotation_synthesis` calls, each of which is itself priced in tokens. It is legible to a user as "document size" without exposing which model was called or what it cost. | **Recommended primary metering unit.** |
| **AI-call cost passthrough** (meter the literal `estimated_cost_usd` sum per document) | Most accurate to true cost, but (a) directly contradicts the no-cost-figures product rule the instant it's shown to a user, even indirectly via a "you have $X of credit left" framing; (b) ties the customer-facing price to internal model-routing decisions — swapping `gpt-5.4-nano` for a cheaper future model would silently change what a user's plan buys them, which is an internal optimization lever today (`packages/ai-adapters/src/routing.ts`'s cost-first routing) and should stay one; (c) creates a perverse incentive to route users to worse/cheaper models specifically to preserve margin, rather than routing on quality. | Reject as the customer-facing unit. Keep as the *internal* accounting truth that a credit's dollar-cost is checked against (see §3's margin math) — just never surface it directly. |

**Recommendation: meter primarily on post-extraction token count**, expressed to users as document-size tiers or
a credit cost per document (see §2), with page count as a soft free-tier ceiling and literal AI-cost tracked
internally (never shown) as the thing prices are calibrated against. This also composes directly with
infrastructure that already exists: `packages/research/src/discover.ts`'s `makeBudget`/`withinHardCap` pattern
and `graph_expansion_request.hard_cap_usd` already gate a paid pipeline stage by a cost ceiling checked *before*
spending — a plan's per-document credit allotment is the same shape of check, just keyed to a monthly balance
instead of a single request.

---

## 2. Three plan options

### Option A — Tiered subscriptions only
Fixed monthly price per tier (Free / Plus / Pro), each bundling a fixed document-processing allowance and chat
allowance, no overage purchase path (hit the cap, wait for renewal or upgrade).

- *Pro:* simplest to build and to explain; predictable MRR.
- *Con:* a power user who wants to process one large batch this month has no legitimate way to pay more — they
  either upgrade a full tier (often much more than they need) or churn. A student with irregular, bursty usage
  (one paper due, nothing for a month) is overcharged flat-rate.

### Option B — Pay-as-you-go credits only
No subscription; users buy credit packs (e.g. "20 credits for $X") and spend them per document processed / per
chat message, with credits never expiring or expiring on a long horizon.

- *Pro:* purely usage-aligned, zero commitment friction, good for irregular/bursty scholarly workloads (a
  dissertation crunch vs. months of light reading).
- *Con:* no recurring revenue signal to plan infrastructure spend against (Render's worker is the one fixed
  recurring cost the project already carries — see `docs/PROJECT-LOG.md`'s cost constraint — and PAYG-only
  revenue is much lumpier than subscription revenue against that fixed cost); every purchase is a fresh checkout
  friction point.

### Option C — Hybrid (subscription + credit top-ups) — **recommended**
A monthly subscription grants a base allowance of "document credits" (§1's unit, converted to a whole-credit
grant) and chat-message credits, refilled each billing period; unused credits do not roll over indefinitely (a
short grace rollover, e.g. one period, avoids the harshest cliff) but overage is purchasable at any time as a
PAYG credit pack at a slightly worse per-credit rate than the subscription's bundled rate — the standard "plan
gives you a good rate, top-ups cost a bit more" SaaS shape.

**Concrete tier sketch** (all figures below use the credit definition and margin math from §3 — treat the credit
counts as a first pass to be re-tuned once real paid-usage data exists, explicitly flagged as such):

| Tier | Price | Included document credits / mo | Included chat messages / mo | Notes |
|---|---|---|---|---|
| **Free** (beta successor) | $0 | 2 document credits | 30 chat messages | Replaces today's fully-unmetered beta. Storage quota (existing 500MB `USER_STORAGE_QUOTA_BYTES`) still applies. Intended to comfortably cover "try the product on one real document." |
| **Plus** | ~$9/mo | 15 document credits | 300 chat messages | Aimed at a single active reader working through one or two texts at a time. |
| **Pro** | ~$24/mo | 50 document credits | 1,500 chat messages | Aimed at a researcher processing a working library, plus heavier Ask Library usage. |
| **PAYG top-up** | ~$5 per 10-credit pack (any tier, including Free) | — | 10 document credits *or* 200 chat messages (user picks which pool to top up) | Slightly worse per-unit rate than Plus/Pro's bundled rate — the standard incentive to subscribe rather than always top up. |

A "document credit" is spent once, at the point a document finishes its (already-existing) extraction stage and
its post-extraction token count is known — *before* the paid research/classification stages run — using a table
sized off that token count (e.g. 1 credit per N tokens of extracted body text, tiers above N×2, N×4 tokens
consuming 2/4 credits respectively). This mirrors the existing pattern where `apps/worker/src/extraction.ts`
already gates a paid stage with `hardCapUsd: 0.25` right after free extraction completes — a credit check slots
into exactly that seam, and a document over budget can degrade to the existing deterministic fallback path
(`heuristicNote`, the non-AI relationship classifier) rather than being rejected outright, keeping the "never
silently drop functionality" posture the rest of the codebase follows.

---

## 3. Margin math, grounded in real production data

All numbers below are from a live, read-only query against production Supabase (`supabase db query --linked`,
2026-07-25), reading `ai_usage_log` and `processing_run`. **No writes were made.** The query path used throughout:
`supabase db query --linked "<sql>"`, run from this worktree after `supabase link --project-ref
vlrzvwswippuaitmrujz` (a local, read-only CLI credential association — no secret was written to any file).

### 3.1 Aggregate spend (all-time, all phases/canaries)

```
total ai_usage_log rows:     2,588
distinct document_id values: 1        (most historical rows have document_id = NULL — see note below)
distinct run_id values:      4        (same reason)
total logged spend:          $1.949770
```

**Honest caveat on attribution:** `ai_usage_log.document_id` is `ON DELETE SET NULL` by design (cost history
should outlive the document — see `docs/PROJECT-LOG.md` Known Problems), and the project's own discipline is to
purge every canary's documents/works after verification. So the vast majority of historical rows (1,731 of 2,588,
~67%) now have a null `document_id`/`run_id` because the *documents that generated them were deliberately
deleted afterward*, not because they were never attributed. The `task`/`provider`/`model` breakdown below is
still a complete, honest picture of *what kinds of calls cost what* — it just can't be sliced per-surviving-document
beyond the 4 runs that are still linkable.

### 3.2 Cost by task (this is the real shape of the spend)

| Task | Calls | Total USD | Share of total | Avg $/call |
|---|---:|---:|---:|---:|
| `note_synthesis` | 1,087 | $1.578350 | 81.0% | $0.001452 |
| `relationship_classification` | 1,101 | $0.178676 | 9.2% | $0.000162 |
| `passage_annotation_synthesis` | 88 | $0.142920 | 7.3% | $0.001624 |
| `concept_extraction` | 17 | $0.026758 | 1.4% | $0.001574 |
| `query_generation` | 17 | $0.015490 | 0.8% | $0.000911 |
| `socratic_rag_answer` (Ask Library chat) | 9 | $0.005766 | 0.3% | $0.000641 |
| `rag_chunk_embedding` | 256 | $0.000858 | <0.1% | $0.000003 |
| `cross_work_relationship_judgment` | 3 | $0.000602 | <0.1% | $0.000201 |
| `chat_competency_signal` | 1 | $0.000250 | <0.1% | $0.000250 |
| `work_embedding` | 9 | $0.000103 | <0.1% | $0.000011 |

**Reading this:** `note_synthesis` (`apps/worker/src/analyze.ts:2208`, the per-discovered-resource critical-note
prose write-up, one call per resource the research pipeline finds and attaches to a document) is **81% of all
AI spend ever logged.** It runs once per *resource*, not once per *document* — so a document that surfaces 30
citations/related works costs roughly 30x the note-synthesis spend of one that surfaces one. This is the direct
confirmation of §1's reasoning: cost scales with what a document's citation/reference density produces
downstream, not with its raw size, which is exactly why post-extraction token count (a proxy for that density,
known before any paid call) beats page count or upload count as the metering unit.

Chat (`socratic_rag_answer` + `rag_chunk_embedding` + `chat_competency_signal`) is cheap in aggregate so far — a
production chat answer averages **$0.00064**, an embedding call **$0.000003**. That is a thin sample (9 real
chat answers logged in production to date), so the Plus/Pro chat allowances in §2 are sized generously relative
to this cost, not tightly — there is real headroom before chat becomes a margin concern, but it should be
re-measured once the RAG feature has real usage volume.

### 3.3 Cost by model (confirms the cost-first routing is doing its job)

| Provider | Model | Calls | Total USD |
|---|---|---:|---:|
| OpenAI | `gpt-5.4-mini` (the "research" tier, `OPENAI_MODEL_RESEARCH`) | 1,087 | $1.578350 |
| OpenAI | `gpt-5.4-nano` (the "cheap" tier, `OPENAI_MODEL_CHEAP`) | 1,236 | $0.370462 |
| OpenAI | `text-embedding-3-small` | 265 | $0.000960 |

`gpt-5.4-nano` pricing (from `packages/ai-adapters/src/routing.ts`, OpenAI's published rates as of 2026-07):
$0.20/$1.25 per million input/output tokens. `gpt-5.4-mini`: $0.75/$4.50 per million. The mini tier is reserved
for `note_synthesis` specifically (the one task where the router picks `researchModel`, i.e. the mini tier,
rather than the cheap tier) — that single deliberate choice to spend more on the highest-value-per-call task is
what produces 81% of spend concentrating in one task.

### 3.4 Per-document-processing-run cost distribution

This is the number that matters most for pricing a "document credit": what does it cost, end to end, to fully
process one real document through the paid pipeline?

```
n = 4 completed production processing runs with non-zero AI cost
min:    $0.012325
median: $0.204469
p90:    $0.215945
max:    $0.218330
avg:    $0.159898
```

**Statistical honesty:** n=4 is a small sample — production has had exactly four processing runs with logged AI
cost survive to today, because the project's standing discipline is to purge every canary's data after
verification (see `docs/PROJECT-LOG.md`'s Changelog entries for the Brickhouse/Roochnik canaries). The max here
($0.218330) is within rounding of the documented Brickhouse production reprocess canary from the 2026-07-24
changelog entry ($0.21833000, 283 calls) — the two numbers corroborate each other (same run, re-derived from a
live query vs. read from the log), which is a useful cross-check but does not enlarge the sample. **Before
finalizing the credit-to-token conversion table in §2, re-run this query after a real cohort of paying users has
processed documents** — four data points is enough to sanity-check pricing direction, not enough to set it with
confidence.

### 3.5 A first-pass margin model

Given the above, treat **~$0.16–0.22 as the working estimate for "cost to fully process one moderately-cited
document"** (the four-run median/average band), while explicitly flagging that a very citation-dense or very
citation-sparse document can fall well outside that band because of the `note_synthesis` per-resource scaling in
§3.2.

- If a Plus subscriber's $9/mo buys 15 document credits, and a "document credit" is calibrated to roughly one
  moderate document (~$0.16–0.22 of AI cost), the AI-cost floor for that allowance is **$2.40–$3.30/mo** —
  leaving roughly **63–73% gross margin before infra and payment-processor fees** on the subscription price, if
  the subscriber uses their full allowance every month (most won't, which is upside, not downside, for margin —
  but must never be *assumed* when setting the cap, since the cap has to survive a subscriber who does use it
  all).
- Payment-processor fees (Stripe's standard ~2.9% + $0.30 per charge, see `payments.md`) take roughly $0.56 off
  a $9 charge, and infra is a small shared marginal cost per additional active user against the project's
  existing largely-fixed Vercel/Supabase/Render bill (see `docs/PROJECT-LOG.md`'s cost constraint — the one
  recurring paid cost called out there is the Render worker's ~$7/mo Starter instance, which is already paid
  regardless of subscriber count until volume genuinely requires scaling it up).
- **This margin is comfortable at the current small sample, but the whole model should be re-run once real paid
  usage exists** — both because n=4 is thin and because `note_synthesis`'s per-resource scaling means the tail
  (a maximally-cited monograph) could land well above the $0.22 ceiling observed so far. A monitoring hook is
  cheap to add later: alert if any single document's live processing cost exceeds, say, 3x the credit price it
  consumed, which would be the signal that the credit-to-token conversion table needs retuning.

---

## 4. Abuse vectors and mitigations

Every mitigation below is deliberately tied to infrastructure that **already exists** in the codebase, not
hypothetical future work — this is a list of what to wire a plan/credit check into, not a list of new subsystems
to build from scratch.

| Vector | Description | Mitigation (existing infrastructure) |
|---|---|---|
| **Upload spam** | Many small/worthless documents to consume the free tier's document count, or to burn (uncounted) extraction infra without ever reaching the paid stage. | `apps/web/src/app/api/works/upload/route.ts` already enforces `enforceUserRateLimit({ scope: "upload", limit: 20, windowMs: 60 * 60_000 })` (20 uploads/hour/user, DB-backed, `apps/web/src/lib/apiRateLimit.ts`) and a 500MB per-user storage quota (`USER_STORAGE_QUOTA_BYTES`). A plan-tier document-count-per-month check belongs in this same route, checked *before* `enqueueExtractText` — reject or queue-for-upgrade before any worker time is spent, exactly where the existing size/MIME/malware-scan checks already sit. |
| **Chat abuse** | Scripted or rapid-fire Ask Library messages to run up embedding/completion spend, or to scrape research-pipeline output as an unpaid API. | No DB-backed per-user rate limit currently exists on the RAG routes (`apps/web/src/app/api/rag/*`) — this is a real gap, not a "just check the existing limiter" case. Recommend adding `enforceUserRateLimit({ scope: "rag-chat", limit: N, windowMs: 60 * 60_000 })` at the RAG message route, the same call shape already used for uploads and (per the Workstream K plan's own G/J lanes) for `account-delete` and `feedback`. A plan's chat-message credit balance should be checked and decremented in the same request, failing closed with a clear "out of chat messages this period" response before the SSE stream opens (never mid-stream — a partially-billed, partially-refused stream is a worse UX bug than a clean upfront rejection). |
| **Credit fraud** | Multiple free accounts to repeatedly claim Free-tier allowances; promo-code abuse; card-testing/stolen-card purchases; chargeback abuse (spend credits, then dispute the charge). | Registration already requires email verification before real use (Auth.js flow) and is throttled by `apps/web/src/lib/preAuthRateLimit.ts` (per-IP, in-memory, explicitly documented as best-effort/not cluster-wide — the doc's own header says the durable fix is a text-keyed rate-limit table, tracked as a register finding, not yet built — worth revisiting before a paid launch since credit fraud raises the stakes of that known gap). Credit grants must only ever be written from a verified Stripe webhook event (never client-triggered, never optimistic), with idempotent event processing (see `payments.md` §3) so a webhook retry can never double-credit an account. A `charge.dispute.created` webhook should freeze the account's credit balance pending resolution, mirroring how `deletion_cleanup`'s completion-gate invariant (Workstream G plan) treats "don't finish the destructive step until the durable state confirms it's safe." |
| **Job-queue abuse** | Repeated reprocess requests to burn paid worker time without additional payment. | `packages/db/src/queue.ts`'s `planReprocess()` already makes reprocessing a single idempotent command — a queued or genuinely-active run is reused/conflicted rather than duplicated (`ReprocessPlan`'s `reuse`/`conflict` branches), so this vector is already substantially closed at the mechanism level. A plan-tier monthly reprocess-count cap is the one addition worth making, checked alongside the existing `planReprocess` decision. |
| **API scraping** | Automating the existing authenticated routes at just-under-rate-limit volume to extract the research pipeline's output as a free/cheap competing data source. | Layered existing limiters (per-user DB-backed + per-IP in-memory) raise the cost of this non-trivially; no dedicated anti-scraping tooling exists today and none is proposed here — flagged as a "watch, don't pre-build" item, consistent with the project's general posture of building mitigations once a real incident is observed rather than speculatively (see `docs/PROJECT-LOG.md`'s repeated "planned but not started" pattern for infrastructure that hasn't yet had a triggering incident). |

---

## 5. Migration path from the current free beta

**Current state:** `BETA_TESTING_MODE` gates the product today (see `docs/PROJECT-LOG.md` Remaining Tasks:
"Remove temporary beta-testing mode ... when the owner ends the beta"); all usage is unmetered; no billing
infrastructure, no entitlement schema, no user-facing cost or usage figures anywhere.

**Proposed sequence, each step additive and independently revertible:**

1. **Schema first, product unchanged.** Ship the entitlement tables from `payments.md` §4 as a migration applied
   to production *before* any dependent code, following the project's own D-23-34 rule ("any migration that a
   queued/upcoming commit's code depends on must be applied to production before or with the merge push that
   ships that code"). Every existing user defaults to `planTier = 'free'` with the Free-tier allowance from §2 —
   at this stage the product behaves identically to today for everyone, since Free's allowance can be set
   generously enough to match current beta usage patterns, or the metering check can ship in log-only mode first
   (record what *would* have been charged, charge nothing) to validate the credit-cost model against §3's numbers
   before it affects anyone.
2. **Dark-launch billing UI.** Build the Stripe Checkout/Billing-portal flow and the `plan`/`usage` account pages
   behind a flag, verify end-to-end with the standing ≤$1 canary authorization (a real $0–1 test charge, refunded,
   cost-logged — same posture as every other paid canary this project runs), before any user sees it.
3. **Grandfather existing beta accounts.** Every account created before the pricing cutover keeps free access to
   *at least* what they've already been using, for a stated window (e.g. current-usage-equivalent allowance, or a
   flat extended free period) — never retroactively bill for documents already processed under the free beta.
   This is a goodwill/trust decision, not a technical one, and should be made explicitly by the owner rather than
   defaulted.
4. **Advance notice.** Post the beta disclaimer (below) and/or an email notice with a real lead time (30 days is
   a reasonable default for a beta-to-paid transition) before `BETA_TESTING_MODE` is turned off and metering
   becomes real. Reuse the consent-timestamp precedent already planned for Workstream G's `policyAcceptedAt`
   column — a similar `pricingAcceptedAt`/acknowledgment timestamp on first login after the notice period closes
   is a cheap way to prove notice was given, not just sent.
5. **Flip the flag.** `BETA_TESTING_MODE` off; Free tier's real allowance (not an artificially generous
   beta-equivalent one) takes effect for new signups; existing grandfathered accounts continue under their
   commitment from step 3 until it expires.

**Suggested beta disclaimer copy** (for a banner and/or email, to be reviewed and adjusted by the owner before
use — this is a draft, not final product copy):

> Palimnote is currently in a free beta. Usage limits and pricing will be introduced in a future release.
> Beta participants will be notified at least 30 days before any charge applies, and will keep free access to
> everything they've already uploaded and read.

---

## 6. Summary of production queries run (for the record)

All read-only, via `supabase db query --linked "<sql>"` against project `vlrzvwswippuaitmrujz`, 2026-07-25:

1. `select count(*), count(distinct document_id), sum(estimated_cost_usd) from ai_usage_log` → total spend + row
   count (§3.1).
2. `select count(*) filter (where document_id is null), count(*) filter (where document_id is not null) from
   ai_usage_log` → attribution-gap sizing (§3.1).
3. `select task, count(*), sum(estimated_cost_usd), avg(estimated_cost_usd) from ai_usage_log group by task` →
   task breakdown (§3.2).
4. `select provider, model, count(*), sum(estimated_cost_usd) from ai_usage_log group by provider, model` →
   model breakdown (§3.3).
5. `select count(*) filter (where run_id is null), count(*) filter (where run_id is not null) from
   ai_usage_log` → run-id attribution sizing (§3.1).
6. Per-run cost distribution via a `with per_run as (...)` CTE grouping `ai_usage_log` by `run_id` and taking
   `min`/`percentile_cont(0.5)`/`percentile_cont(0.9)`/`max`/`avg` → §3.4's four-run distribution.

No query was denied or failed; nothing here fell back to documented canary costs alone, though §3.4's numbers are
cross-checked against the documented Brickhouse canary cost as a corroboration, not a substitute.
