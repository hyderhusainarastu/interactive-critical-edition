# Payments — Provider Choice, Webhook Architecture, Entitlement Schema

**Status:** internal planning document, no code, no accounts created, no SDKs installed. Companion to
`proposals.md` (plan/pricing rationale and the production cost data those numbers are grounded in). This document
covers *how* to take payment and *how the stack would wire it up* — it stops short of writing any code, per the
Workstream K brief.

---

## 1. Provider recommendation: Stripe Checkout + Billing

**Primary recommendation: Stripe**, specifically **Stripe Checkout** (hosted payment page, both `mode:
"subscription"` and `mode: "payment"` for one-time credit-pack purchases) plus **Stripe Billing** (subscription
lifecycle: renewals, plan changes, dunning/retry on failed payments, the customer-facing Billing Portal for
self-serve cancellation/plan-switch/payment-method update).

Why this over building custom card handling: Checkout is a Stripe-hosted page, so **no card data ever touches
Palimnote's servers** — zero PCI scope beyond SAQ A, the lightest compliance tier. That matters specifically for
this project's operating posture: `docs/PROJECT-LOG.md`'s cost constraint already optimizes hard against adding
operational surface area, and a hosted Checkout page is strictly less surface than embedding Stripe Elements or,
worse, handling raw card fields.

Why Stripe over the alternatives, for *this* project specifically:
- Palimnote is a single-owner-operated project at small scale (per the standing "no new subscriptions/signups"
  authorization and the general single-user-scale cost posture) — Stripe's standard pricing (2.9% + $0.30/charge,
  US-domestic) has no monthly minimum and no contract, matching the project's "free tiers everywhere realistic,
  pay only for what's actually used" discipline already applied to Vercel/Supabase/Render.
- Both subscription and one-time (PAYG credit pack) purchases fit naturally in one Checkout integration — the
  hybrid plan model recommended in `proposals.md` §2 doesn't need two separate payment systems.
- Stripe is the payment processor with by far the largest ecosystem/documentation surface, which matters for an
  agent-assisted, cost-conscious build: less time spent reverse-engineering an unusual API.

**What Stripe does *not* do by default, and why that matters:** Stripe is a payment processor, not a merchant of
record (MoR) — Palimnote itself remains the legal seller and is responsible for figuring out sales-tax/VAT
registration and remittance in whatever jurisdictions it owes tax in. Stripe Tax (an add-on, ~0.5% additional
fee) automates the calculation/collection part but not the underlying legal registration obligation. At true
single-owner/early-stage scale this is a real, non-trivial operational and legal burden that a MoR alternative
removes entirely — which is the whole reason the two alternatives below exist as live options, not just
also-rans.

---

## 2. Alternatives: Paddle and Lemon Squeezy (merchant of record)

Both are **merchants of record**: the provider itself is the legal seller, handles global sales-tax/VAT
registration and remittance in every jurisdiction automatically, and issues receipts/invoices in its own name.
The tradeoff is fees and reduced control, in exchange for essentially zero tax-compliance operational burden.

| | Stripe (processor) | Paddle (MoR) | Lemon Squeezy (MoR) |
|---|---|---|---|
| **Tax handling** | Palimnote's own legal responsibility; Stripe Tax add-on automates calculation only, not registration/remittance obligations | Fully handled — Paddle is the seller of record, registers/remits VAT/sales tax globally | Fully handled — same MoR model as Paddle |
| **Fees** | ~2.9% + $0.30/charge (lowest of the three) | ~5% + $0.50/transaction (roughly double Stripe's) | Historically similar to Paddle's range; **verify current rate before committing** — see caveat below |
| **Control / integration depth** | Full API control, largest ecosystem, most integration patterns (webhooks, Elements, Billing Portal, Connect if ever needed) | Full-featured API/webhooks but you operate inside Paddle's checkout/receipt/invoice branding, less flexibility than raw Stripe | Similar constraint profile to Paddle; historically popular specifically with small/indie SaaS for its simplicity |
| **Best fit** | A project willing to own tax compliance (or stay under registration thresholds in every jurisdiction it sells to) in exchange for the lowest fee and most control | A project selling internationally from day one that wants to never think about VAT registration, and can absorb the higher fee | Same use case as Paddle; pick based on then-current fee/feature comparison |

**Diligence caveat, stated honestly rather than guessed past:** this document's knowledge of the payments-provider
landscape has a cutoff, and Lemon Squeezy specifically has undergone real ownership/product changes in the recent
past (an acquisition by Stripe was publicly reported) that could mean its terms, availability as a standalone
product, or fee structure have moved since. **Before committing to either MoR alternative, re-verify its current
status, fee schedule, and whether it's still being sold as an independent product** — don't take this table's
numbers as current without that check at implementation time. This caveat does not apply to the Stripe
recommendation, which is the safer default specifically because it carries the least platform-continuity risk.

**Recommendation stands: start with Stripe Checkout + Billing** given the project's US-based single-owner scale
(tax-registration burden is smaller at this scale than the fee delta), and revisit a MoR migration if/when
international sales volume makes the tax-compliance burden real rather than theoretical.

---

## 3. Webhook architecture, fitted to this stack

The stack is Next.js API routes on Vercel (web) + a pg-boss job consumer on Render (worker) + one shared Postgres
(Supabase). The sketch below follows the same conventions already used throughout `apps/web/src/app/api/*` and
`packages/db/src/queue.ts` — nothing here introduces a new architectural pattern, it reuses the ones the codebase
already has.

### 3.1 Route

`apps/web/src/app/api/billing/webhook/route.ts` — a new Next.js Route Handler, same tree position as
`apps/web/src/app/api/auth/[...nextauth]/route.ts`. Must run on the Node runtime (not Edge) because Stripe
signature verification needs the **raw, unparsed request body** — `request.text()` before any JSON parsing,
exactly the one thing that's different from every other route in the app (all of which parse `formData()` or
JSON directly, e.g. `apps/web/src/app/api/works/upload/route.ts`'s `request.formData()`).

```
POST /api/billing/webhook
  1. rawBody = await request.text()
  2. sig = request.headers.get("stripe-signature")
  3. event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)
     — throws on bad signature; catch → 400 immediately, no DB touched.
  4. idempotency check (see 3.2) against billing_webhook_event
  5. dispatch on event.type (see 3.3)
  6. 200 OK, fast, always — Stripe retries aggressively on non-2xx/timeout.
```

**No `enforceUserRateLimit` on this route.** That limiter (`apps/web/src/lib/apiRateLimit.ts`) is keyed on an
authenticated `userId`, which a webhook caller (Stripe itself) doesn't have — the correct authorization boundary
here is signature verification, not rate limiting. An unsigned or invalidly-signed request gets a cheap, fast 400
with zero DB work, which is itself the abuse mitigation (there's no legitimate anonymous traffic to this route at
all, only Stripe presenting a valid signature).

### 3.2 Idempotency

Stripe **will** redeliver the same event multiple times (network retries, at-least-once delivery is the documented
contract) — the handler must be safe to run twice on the same event. New table `billing_webhook_event` (see §4)
keyed on Stripe's own event id as primary key: insert-first, and if the insert conflicts (event id already
present), return 200 immediately without reprocessing. This is the same idempotent-write shape the codebase
already uses elsewhere for "a request might arrive twice, make the second one a no-op" — e.g.
`foreign_span`'s planned `(documentId, textBlockId, sourceText)` unique constraint with `onConflictDoNothing` (per
this program's Workstream D plan), and `planReprocess()`'s `reuse` branch in `packages/db/src/queue.ts` for a
duplicate reprocess request.

### 3.3 Event handling — synchronous vs. queued

Most entitlement writes should stay **synchronous, inline in the route handler** — they're single-row Postgres
writes, and correctness has to be immediate (a user who just paid and immediately hits a paywall because their
credit grant hasn't landed yet is a real, bad bug, not a tolerable eventual-consistency window):

- `checkout.session.completed` → grant subscription entitlement or credit-pack credits (`credit_ledger` insert).
- `customer.subscription.updated` / `.deleted` → sync `subscription.status`/`planTier`.
- `invoice.paid` → renew the period's credit allowance.
- `charge.dispute.created` → freeze the account's spendable balance pending resolution.

Anything **slow or non-critical** should instead go through the existing pg-boss queue pattern rather than run
inline and risk the webhook handler timing out (Stripe expects a fast response) — following the exact reasoning
already documented in `packages/db/src/queue.ts` for why `extract-text` and `analyze-work` are separate queues
("a slow or failed analysis must never block the reader"). Concretely: a new `QUEUE_BILLING_RECONCILE` queue,
`createQueue()`-d at worker startup alongside the four existing queues (`getQueue()`'s pattern), consumed by
`apps/worker`, for things like sending a receipt email via the existing mail-provider seam (`ConsoleMailProvider`
fallback / Resend, same as the rest of the app) or reconciling a delayed-arrival-order edge case (Stripe doesn't
strictly guarantee webhook delivery order). The entitlement write itself never waits on this queue — it's for
side effects only.

### 3.4 Client-side surfaces

Two new routes, both simple session-authenticated handlers following the existing `getApiUserId()` /
`requireSession()` convention used throughout `apps/web/src/app/api/*`:

- `POST /api/billing/checkout` — authenticated, creates a Stripe Checkout Session server-side for the requested
  plan/credit-pack `priceId`, returns the redirect URL. Called from the currently-disabled upgrade affordances on
  `plan/page.tsx` (per this program's Workstream G plan — "disabled upgrade affordances + beta disclaimer" is
  exactly the seam this would activate).
- `POST /api/billing/portal` — authenticated, creates a Stripe Billing Portal session for self-serve
  cancel/plan-change/payment-method update, returns the redirect URL. Zero custom billing-management UI needed —
  Stripe's hosted portal covers it.

### 3.5 Environment variables (names only — nothing set, nothing committed)

Following the `.env.example` convention (documented names, no values, values live only in each platform's
encrypted store per the project's existing discipline):

```
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ID_PLUS_MONTHLY=
STRIPE_PRICE_ID_PRO_MONTHLY=
STRIPE_PRICE_ID_CREDIT_PACK_10=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
```

No account was created, no key was requested or generated, and nothing above was added to the real
`.env.example` — this is a naming proposal for when/if the feature is actually built.

---

## 4. Future entitlement schema sketch (additive)

Following the schema conventions already established in `packages/db/src/schema.ts` (uuid PKs via
`.primaryKey().defaultRandom()`, explicit `onDelete` on every FK, indexes on hot filter/join columns, pgEnum for
closed vocabularies) and the project's own migration discipline (D-23-34: any migration a dependent code push
needs must land in production *before or with* that push, never deferred — see `docs/PROJECT-LOG.md` Known
Problems). Every table below is purely additive — no existing table's shape changes except `users` gaining one
nullable/defaulted column, which is the same "additive and reversible" pattern already used for `work.deletedAt`.

```
users:
  + planTier: pgEnum("plan_tier", ["free","plus","pro"]) notNull default "free"
    (nullable-safe rollout: every existing row gets "free" with no behavior
    change until the metering check in proposals.md §2 actually ships)

billing_customer:
  id: uuid PK default random
  userId: uuid notNull unique, references users.id onDelete cascade
  stripeCustomerId: text notNull unique
  createdAt: timestamp notNull defaultNow

subscription:
  id: uuid PK default random
  userId: uuid notNull, references users.id onDelete cascade
  stripeSubscriptionId: text notNull unique
  stripePriceId: text notNull
  planTier: pgEnum("plan_tier", [...])  -- mirrors users.planTier's vocabulary
  status: pgEnum("subscription_status", ["active","past_due","canceled","trialing"])
    -- mirrors Stripe's own subscription status vocabulary directly, no translation layer
  currentPeriodEnd: timestamp notNull
  cancelAtPeriodEnd: boolean notNull default false
  createdAt / updatedAt: timestamp notNull defaultNow
  index (userId)

credit_ledger:
  id: bigint identity PK
    -- bigint identity, not uuid, following the usage_event precedent from this
    -- program's Workstream G/J plan ("highest-write table — no uuid bloat")；
    -- a ledger entry is written on every document processed and every chat
    -- message sent, so it is by construction one of the highest-write tables
  userId: uuid notNull, references users.id onDelete cascade
    -- unlike ai_usage_log.documentId (deliberately NOT cascaded, so cost
    -- history outlives a deleted document), a credit ledger has no such
    -- retention need — it's a live balance, not a historical audit trail of
    -- record, so cascading with the user on account deletion is correct
  delta: integer notNull  -- positive = grant, negative = debit
  reason: pgEnum("credit_reason", [
    "subscription_grant","payg_purchase","document_processing",
    "chat_message","refund","admin_adjustment"
  ])
  relatedDocumentId: uuid  -- no FK, same "outlives the document" pattern as
                           -- ai_usage_log.documentId; nullable
  relatedRunId: uuid       -- same pattern, nullable
  stripeEventId: text      -- nullable; cross-reference to billing_webhook_event
                           -- for grants, absent for usage-driven debits
  createdAt: timestamp notNull defaultNow
  index (userId, createdAt)

billing_webhook_event:
  id: text PK  -- the Stripe event id itself; natural idempotency key
  type: text notNull
  processedAt: timestamp
  createdAt: timestamp notNull defaultNow
```

**Balance computation, flagged as a future tension rather than resolved here:** the simplest correct
implementation of "does this user have enough credits" is `sum(credit_ledger.delta) where userId = ...`, which
is trivially correct but re-sums an ever-growing table on every check. This is the *exact same* "recompute on
demand vs. store a snapshot" tension `docs/PROJECT-LOG.md` already discusses for the reading roadmap
("Roadmap computed on demand each request, not stored as a snapshot ... a persisted snapshot drifts the instant
[state] changes") — recomputing is correct-by-construction and never drifts, at the cost of a full-table
aggregate per check. At credit-ledger's likely per-user row counts (bounded by actual usage, not unbounded like a
page-view event stream) this is very likely fine to leave as a live `sum()` for a long time; a materialized
running-balance column (updated transactionally alongside each ledger insert) is the documented escape hatch if
it ever isn't, exactly mirroring how the roadmap doc frames its own equivalent tradeoff — not built now, named
here so a future session doesn't have to rediscover the tradeoff from scratch.

**Legal-retention open question, stated rather than guessed at:** `billing_customer` above cascades on user
deletion for simplicity, matching most of the schema's user-owned tables. Financial/billing records in some
jurisdictions carry statutory retention requirements that outlive a user's own deletion request — this is a real
open question that needs an actual answer (likely an archive-before-cascade pattern, mirroring
`user_deletion_archive` from this program's Workstream G plan) before any real money moves, not a design decision
this document is positioned to make unilaterally. Flagged here so it isn't silently assumed away.

---

## 5. What this document does not do

No Stripe (or Paddle/Lemon Squeezy) account was created. No SDK (`stripe`, `@paddle/paddle-node-sdk`, etc.) was
installed — `apps/web/package.json` and `pnpm-lock.yaml` are untouched by this work. No code was written under
`apps/web/src/app/api/billing/*` or anywhere else. No secret, key, or connection string appears in this document
or was requested. Everything above is a sketch to build from when the owner decides to proceed, cross-referenced
against the real production cost data in `proposals.md` so the numbers it will eventually be priced against are
grounded rather than guessed.
