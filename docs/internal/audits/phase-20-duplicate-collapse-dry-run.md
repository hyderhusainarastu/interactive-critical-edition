# Phase 20.6 — Duplicate Collapse Dry-Run Report (LOCAL only)

**Date:** 2026-07-22 · **Scope:** the LOCAL development Postgres only, plus a seeded, self-deleting duplicate-rich fixture. **No production database was read or written by this dry run** — the production dry-run (and any production merge) happens at the 20.8 gate under explicit approval, per the plan.

**Generator:** `apps/worker/src/identity/dryRun.ts` — rerunnable at any time with:

```sh
cd apps/worker && pnpm exec tsx --env-file-if-exists=.env src/identity/dryRun.ts
```

The script audits the database via `auditWorkIdentityDuplicates()` (fetch + the pure `planIdentityCollapse()` precedence chain in `packages/research/src/canonicalIdentity.ts`), renders what WOULD merge / WOULD attach / is SUGGESTION-ONLY, and **applies nothing** — it never calls `mergeWorkIdentities`. Merge groups larger than 10 members list their first 10 and state the exact remainder count; the full list is reproducible by re-running the script.

## How to read the three buckets

- **Would merge** — connected by confident precedence-chain evidence only: (1) verified DOI, (2) verified ISBN, (3) canonical provider id, (4) normalized title + primary author + year (including the title-only review fold when exactly one authored match exists), (5) identical uploaded content hash. Each entry names the deterministic winner (most linked uploads → most Library resources → oldest → smallest id) and every row that would be repointed. **The loser `work_identity` row is never deleted**; an applied merge records full reversal state in `work_identity_merge`.
- **Would attach** — review/edition/translation/excerpt records that stay their own rows and display UNDER the canonical entry. Attachment is a display decision, never a data merge.
- **Suggestion only** — bounded fuzzy title similarity, same-title-different-author pairs, and same-title/author-different-year (likely-editions) pairs. These are **never merged automatically** under any circumstances.

## Interpretation of Section 1 (local data as found)

The local database carried **1,134 active `work_identity` rows at run time** (the count moves as concurrent local E2E runs seed and leak rows), almost all of it **orphaned Playwright fixture debris**: E2E helpers create `work_identity` rows with no user FK, and `deleteTestUser` cascades `works`/`documents` but has never cleaned identities, so every seeded identity of every past run has accumulated. This is why all 21 confident merge groups are `title-author-year` groups of byte-identical fixture titles ("Accessible focus" ×37, "Ranking focus" ×37, "Curriculum Sweep Work", …) with 0 uploads and 0 Library resources attached — merging them is semantically correct and completely harmless, though at the 20.8 gate a plain orphan sweep would be an equally valid cleanup for rows nothing references. **No genuine scholarly duplicate exists in local data**, which is expected: the real duplicate risk (canary-10's one-book-five-records) lives in production-shaped research output, and the fixture in Section 2 exists precisely to prove the chain against that shape. All 9 fuzzy pairs are correctly held back as suggestions.

Section 2 proves every precedence rule against a purpose-built fixture (all rows deleted by the script after the audit): DOI duplicates merge under `doi`; identical ISBNs under `isbn`; shared provider ids under `provider-id`; normalized title/author/year duplicates — including a review-derived, author-less identity folding into its unique authored match — under `title-author-year`; identical uploaded bytes under `content-hash`; a review and a 2nd edition ATTACH to their canonical work rather than merging; and near-identical titles ("…" vs "…: An Introduction") stay suggestion-only. One suggestion pairs a fixture row with a pre-existing local debris row ("(unknown)" — outside the fixture's candidate list); that is the fuzzy pass doing its job across whatever data is present.

---

### Section 1 — LOCAL database as found (no fixture)

Identities audited: 1134

#### Would merge (confident evidence only): 21

- **Method: title-author-year** — normalized title/author/year match (accessible focus|irwin)
  - Winner (kept): `066777bf…` "Accessible focus", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `06cb6105…` "Accessible focus", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `08c0b08e…` "Accessible focus", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `144dcc69…` "Accessible focus", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `38c2fd50…` "Accessible focus", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `3fd13c45…` "Accessible focus", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `4204f90a…` "Accessible focus", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `4b4b3350…` "Accessible focus", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `4c89e067…` "Accessible focus", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `5bbf2f07…` "Accessible focus", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `68ada5b7…` "Accessible focus", by irwin, 0 upload(s), 0 Library resource(s)
  - …and 25 more identical-evidence rows (full list via the dry-run script)

- **Method: title-author-year** — normalized title/author/year match (focus ranking|irwin)
  - Winner (kept): `083e9114…` "Ranking focus", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `12f92b0e…` "Ranking focus", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `189fbbc9…` "Ranking focus", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `1da2ff2a…` "Ranking focus", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `27b183b0…` "Ranking focus", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `29fb7d7a…` "Ranking focus", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `332e094b…` "Ranking focus", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `382fa112…` "Ranking focus", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `4961d3ce…` "Ranking focus", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `4c8be89e…` "Ranking focus", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `61b0a394…` "Ranking focus", by irwin, 0 upload(s), 0 Library resource(s)
  - …and 25 more identical-evidence rows (full list via the dry-run script)

- **Method: title-author-year** — normalized title/author/year match (evidence metadata only owning work|irwin)
  - Winner (kept): `1235f17c…` "Owning work for metadata-only evidence", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `1230f966…` "Owning work for metadata-only evidence", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `2e636e3c…` "Owning work for metadata-only evidence", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `3082f23b…` "Owning work for metadata-only evidence", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `400f2b3a…` "Owning work for metadata-only evidence", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `aac861a3…` "Owning work for metadata-only evidence", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `b491d12f…` "Owning work for metadata-only evidence", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `bbfc883d…` "Owning work for metadata-only evidence", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `e22f0ee0…` "Owning work for metadata-only evidence", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `e55126d8…` "Owning work for metadata-only evidence", by irwin, 0 upload(s), 0 Library resource(s)

- **Method: title-author-year** — normalized title/author/year match (curriculum sweep work|irwin)
  - Winner (kept): `12e48614…` "Curriculum Sweep Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `200ab2a0…` "Curriculum Sweep Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `2f26a379…` "Curriculum Sweep Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `37b5783a…` "Curriculum Sweep Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `669fed35…` "Curriculum Sweep Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `9a563bbe…` "Curriculum Sweep Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `9fd48ec3…` "Curriculum Sweep Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `cf0b4de8…` "Curriculum Sweep Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `d263aac8…` "Curriculum Sweep Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `f0c73431…` "Curriculum Sweep Work", by irwin, 0 upload(s), 0 Library resource(s)

- **Method: title-author-year** — normalized title/author/year match (narrower work|irwin)
  - Winner (kept): `1c52fac6…` "A Narrower Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `021d60e1…` "A Narrower Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `05daae03…` "A Narrower Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `0b682d91…` "A Narrower Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `0cdc99e8…` "A Narrower Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `15439335…` "A Narrower Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `1b33ef87…` "A Narrower Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `29247105…` "A Narrower Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `2bb74033…` "A Narrower Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `2d7b4447…` "A Narrower Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `34688e33…` "A Narrower Work", by irwin, 0 upload(s), 0 Library resource(s)
  - …and 38 more identical-evidence rows (full list via the dry-run script)

- **Method: title-author-year** — normalized title/author/year match (first work|irwin); title-only identity folded into its unique authored match (first work)
  - Winner (kept): `26d8a752…` "First Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `0153937b…` "First Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `03cbae19…` "First Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `03eb332a…` "First Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `0aa1f18f…` "First Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `0c020999…` "First Work", no author, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `0c0af78f…` "First Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `0e07a3b9…` "First Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `171f2a22…` "First Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `1904141b…` "First Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `193cb749…` "First Work", by irwin, 0 upload(s), 0 Library resource(s)
  - …and 38 more identical-evidence rows (full list via the dry-run script)

- **Method: title-author-year** — normalized title/author/year match (second work|irwin); title-only identity folded into its unique authored match (second work)
  - Winner (kept): `40ab8e6a…` "Second Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `0c401d6c…` "Second Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `15a32ca3…` "Second Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `1a0eb1f4…` "Second Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `1de418e2…` "Second Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `27a64ad4…` "Second Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `27ffc2ef…` "Second Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `2d351f77…` "Second Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `318b4647…` "Second Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `34d41306…` "Second Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `34f6b43c…` "Second Work", by irwin, 0 upload(s), 0 Library resource(s)
  - …and 38 more identical-evidence rows (full list via the dry-run script)

- **Method: title-author-year** — normalized title/author/year match (analyzed older work|irwin)
  - Winner (kept): `520df0cd…` "Older analyzed work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `070a7169…` "Older analyzed work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `16dd8d28…` "Older analyzed work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `198db32a…` "Older analyzed work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `1b579ed5…` "Older analyzed work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `1b5eac36…` "Older analyzed work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `25011d45…` "Older analyzed work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `2942fab8…` "Older analyzed work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `3901e7c9…` "Older analyzed work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `42b79639…` "Older analyzed work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `45ae63e9…` "Older analyzed work", by irwin, 0 upload(s), 0 Library resource(s)
  - …and 25 more identical-evidence rows (full list via the dry-run script)

- **Method: title-author-year** — normalized title/author/year match (controls ready work|irwin)
  - Winner (kept): `5bbc09e6…` "Ready-work controls", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `0b0c2fc1…` "Ready-work controls", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `0c23bb4a…` "Ready-work controls", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `2013882d…` "Ready-work controls", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `2575a184…` "Ready-work controls", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `699f56bc…` "Ready-work controls", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `6f6bd104…` "Ready-work controls", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `7ffa320c…` "Ready-work controls", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `810ef544…` "Ready-work controls", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `88a1cef6…` "Ready-work controls", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `a6adb139…` "Ready-work controls", by irwin, 0 upload(s), 0 Library resource(s)
  - …and 4 more identical-evidence rows (full list via the dry-run script)

- **Method: title-author-year** — normalized title/author/year match (another paper|irwin)
  - Winner (kept): `90a44b80…` "Another Paper", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `0ab4267f…` "Another Paper", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `726aba31…` "Another Paper", by irwin, 0 upload(s), 0 Library resource(s)

- **Method: title-author-year** — normalized title/author/year match (focus second work|irwin)
  - Winner (kept): `99291459…` "Second Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `35f169b7…` "Second Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `3622db5a…` "Second Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `3f81392e…` "Second Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `73a5a3b8…` "Second Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `79ca3297…` "Second Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `8796dcfe…` "Second Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `b57851e6…` "Second Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `b81232e1…` "Second Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `c3fc2fcc…` "Second Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `e5e90f14…` "Second Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - …and 1 more identical-evidence rows (full list via the dry-run script)

- **Method: title-author-year** — normalized title/author/year match (cited work writer|irwin)
  - Winner (kept): `a2cd7ad6…` "Writer-cited work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `07624943…` "Writer-cited work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `3826eac1…` "Writer-cited work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `5787d9d6…` "Writer-cited work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `857b2b9b…` "Writer-cited work", by irwin, 0 upload(s), 0 Library resource(s)

- **Method: title-author-year** — normalized title/author/year match (fixture search work|irwin)
  - Winner (kept): `a39ad37e…` "Search Fixture Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `005ce9c9…` "Search Fixture Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `01cc5905…` "Search Fixture Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `02a52e41…` "Search Fixture Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `03da8594…` "Search Fixture Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `040f4b4e…` "Search Fixture Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `0459cc01…` "Search Fixture Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `08030fec…` "Search Fixture Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `0a229bbe…` "Search Fixture Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `0a376b4a…` "Search Fixture Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `0b8d220c…` "Search Fixture Work", by irwin, 0 upload(s), 0 Library resource(s)
  - …and 220 more identical-evidence rows (full list via the dry-run script)

- **Method: title-author-year** — normalized title/author/year match (first focus work|irwin)
  - Winner (kept): `ac546604…` "First Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `0165d76b…` "First Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `04888766…` "First Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `170ccf81…` "First Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `5f3c5e5e…` "First Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `6ec1fe72…` "First Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `7262a88f…` "First Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `b8b9f760…` "First Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `c772ad56…` "First Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `dcc634c2…` "First Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `dfb52c56…` "First Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - …and 1 more identical-evidence rows (full list via the dry-run script)

- **Method: title-author-year** — normalized title/author/year match (focus navigable work|irwin)
  - Winner (kept): `b3d81d59…` "Navigable focus work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `046de91e…` "Navigable focus work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `25144930…` "Navigable focus work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `4aea9d26…` "Navigable focus work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `815a395c…` "Navigable focus work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `84c0a9c7…` "Navigable focus work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `9a298a7f…` "Navigable focus work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `a20eafa7…` "Navigable focus work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `cfa57f7e…` "Navigable focus work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `e24243b2…` "Navigable focus work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `e9789b63…` "Navigable focus work", by irwin, 0 upload(s), 0 Library resource(s)
  - …and 1 more identical-evidence rows (full list via the dry-run script)

- **Method: title-author-year** — normalized title/author/year match (reason vice|irwin)
  - Winner (kept): `bcceda0e…` "Vice and Reason", by irwin, 1 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `002c6e1b…` "Vice and Reason", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `00f284bd…` "Vice and Reason", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `021f6209…` "Vice and Reason", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `02356f61…` "Vice and Reason", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `025cdb0d…` "Vice and Reason", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `026e50fc…` "Vice and Reason", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `02714805…` "Vice and Reason", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `029c3c7f…` "Vice and Reason", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `0320475b…` "Vice and Reason", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `0322c392…` "Vice and Reason", by irwin, 0 upload(s), 0 Library resource(s)
  - …and 438 more identical-evidence rows (full list via the dry-run script)

- **Method: title-author-year** — normalized title/author/year match (anchor focus work|irwin)
  - Winner (kept): `ce955910…` "Anchor Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `08dab71b…` "Anchor Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `103b2616…` "Anchor Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `1506dec4…` "Anchor Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `5cca5938…` "Anchor Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `6a833428…` "Anchor Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `992f2928…` "Anchor Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `cadfb7dd…` "Anchor Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `e60249df…` "Anchor Focus Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `e8ff2d0b…` "Anchor Focus Work", by irwin, 0 upload(s), 0 Library resource(s)

- **Method: title-author-year** — normalized title/author/year match (library sweep work|irwin)
  - Winner (kept): `e60b536a…` "Library Sweep Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `40e8b636…` "Library Sweep Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `5a5aaf42…` "Library Sweep Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `5fe936f4…` "Library Sweep Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `65fc8abc…` "Library Sweep Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `6d182250…` "Library Sweep Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `9491cdf9…` "Library Sweep Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `9fa991a7…` "Library Sweep Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `a97d2823…` "Library Sweep Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `ad5e3c9c…` "Library Sweep Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `b8bda5c2…` "Library Sweep Work", by irwin, 0 upload(s), 0 Library resource(s)
  - …and 2 more identical-evidence rows (full list via the dry-run script)

- **Method: title-author-year** — normalized title/author/year match (control inventory work|irwin)
  - Winner (kept): `e875a480…` "Control inventory work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `14869c1c…` "Control inventory work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `15c4d63f…` "Control inventory work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `25eaf496…` "Control inventory work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `2b7e8874…` "Control inventory work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `2e96e251…` "Control inventory work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `38733c40…` "Control inventory work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `3f30e0ab…` "Control inventory work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `5a4ebb27…` "Control inventory work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `5a769e8c…` "Control inventory work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `66aa37b3…` "Control inventory work", by irwin, 0 upload(s), 0 Library resource(s)
  - …and 11 more identical-evidence rows (full list via the dry-run script)

- **Method: title-author-year** — normalized title/author/year match (reviewable work|irwin)
  - Winner (kept): `f1d1991c…` "Reviewable Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `02e980be…` "Reviewable Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `04c017b2…` "Reviewable Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `0985c6e2…` "Reviewable Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `0f466990…` "Reviewable Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `139b34d4…` "Reviewable Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `218f1760…` "Reviewable Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `21ee2e79…` "Reviewable Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `22e202fa…` "Reviewable Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `2bda8d7f…` "Reviewable Work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `305542b2…` "Reviewable Work", by irwin, 0 upload(s), 0 Library resource(s)
  - …and 42 more identical-evidence rows (full list via the dry-run script)

- **Method: title-author-year** — normalized title/author/year match (external link work|irwin)
  - Winner (kept): `fc7a503b…` "External link work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `0c08087f…` "External link work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `0c55a664…` "External link work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `131fe580…` "External link work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `15f9db60…` "External link work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `2d35d0fb…` "External link work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `42660491…` "External link work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `4d09c5a1…` "External link work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `66b5100e…` "External link work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `9f86c9bb…` "External link work", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `de2c6e2e…` "External link work", by irwin, 0 upload(s), 0 Library resource(s)
  - …and 1 more identical-evidence rows (full list via the dry-run script)

#### Would attach (kept as related records, never merged): 0

_None. No review/edition/translation/excerpt records are linked to the audited identities._

#### Suggestion only (never merged automatically): 9

- `26d8a752…` "First Work", by irwin, 0 upload(s), 0 Library resource(s) ↔ `ac546604…` "First Focus Work", by irwin, 0 upload(s), 0 Library resource(s) — similarity 0.667: similar titles by the same author (similarity 0.67) — fuzzy match, suggestion only

- `40ab8e6a…` "Second Work", by irwin, 0 upload(s), 0 Library resource(s) ↔ `99291459…` "Second Focus Work", by irwin, 0 upload(s), 0 Library resource(s) — similarity 0.667: similar titles by the same author (similarity 0.67) — fuzzy match, suggestion only

- `e60b536a…` "Library Sweep Work", by irwin, 0 upload(s), 0 Library resource(s) ↔ `12e48614…` "Curriculum Sweep Work", by irwin, 0 upload(s), 0 Library resource(s) — similarity 0.5: similar titles by the same author (similarity 0.50) — fuzzy match, suggestion only

- `b3d81d59…` "Navigable focus work", by irwin, 0 upload(s), 0 Library resource(s) ↔ `ac546604…` "First Focus Work", by irwin, 0 upload(s), 0 Library resource(s) — similarity 0.5: similar titles by the same author (similarity 0.50) — fuzzy match, suggestion only

- `b3d81d59…` "Navigable focus work", by irwin, 0 upload(s), 0 Library resource(s) ↔ `99291459…` "Second Focus Work", by irwin, 0 upload(s), 0 Library resource(s) — similarity 0.5: similar titles by the same author (similarity 0.50) — fuzzy match, suggestion only

- `b3d81d59…` "Navigable focus work", by irwin, 0 upload(s), 0 Library resource(s) ↔ `ce955910…` "Anchor Focus Work", by irwin, 0 upload(s), 0 Library resource(s) — similarity 0.5: similar titles by the same author (similarity 0.50) — fuzzy match, suggestion only

- `ac546604…` "First Focus Work", by irwin, 0 upload(s), 0 Library resource(s) ↔ `99291459…` "Second Focus Work", by irwin, 0 upload(s), 0 Library resource(s) — similarity 0.5: similar titles by the same author (similarity 0.50) — fuzzy match, suggestion only

- `ac546604…` "First Focus Work", by irwin, 0 upload(s), 0 Library resource(s) ↔ `ce955910…` "Anchor Focus Work", by irwin, 0 upload(s), 0 Library resource(s) — similarity 0.5: similar titles by the same author (similarity 0.50) — fuzzy match, suggestion only

- `99291459…` "Second Focus Work", by irwin, 0 upload(s), 0 Library resource(s) ↔ `ce955910…` "Anchor Focus Work", by irwin, 0 upload(s), 0 Library resource(s) — similarity 0.5: similar titles by the same author (similarity 0.50) — fuzzy match, suggestion only

### Section 2 — seeded duplicate-rich fixture (marker dryrun-1784752421005, deleted after this run)

Identities audited: 14

#### Would merge (confident evidence only): 5

- **Method: doi** — shared DOI 10.1234/dryrun-1784752421005
  - Winner (kept): `553d6280…` "Vice and Reason dryrun-1784752421005", by irwin, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `a4b3d86d…` "Vice and Reason in Aristotle dryrun-1784752421005", by irwin, 0 upload(s), 0 Library resource(s)

- **Method: isbn** — shared ISBN 9780195085600
  - Winner (kept): `dc3467f0…` "Ethics with Aristotle dryrun-1784752421005", by broadie, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `00f26e23…` "Ethics with Aristotle dryrun-1784752421005 (paperback)", by broadie, 0 upload(s), 0 Library resource(s)

- **Method: provider-id** — shared provider id openalex:dryrun-1784752421005
  - Winner (kept): `4dec2f9b…` "Philosophy of Action dryrun-1784752421005", by charles, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `9f289a2b…` "Philosophy of Action dryrun-1784752421005 (reprint)", by charles, 0 upload(s), 0 Library resource(s)

- **Method: title-author-year** — normalized title/author/year match (1784752421005 dryrun ethics nicomachean|aristotle); title-only identity folded into its unique authored match (1784752421005 dryrun ethics nicomachean)
  - Winner (kept): `24efc455…` "The Nicomachean Ethics dryrun-1784752421005", by aristotle, 1999, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `4d40bf7b…` "The Nicomachean Ethics dryrun-1784752421005", no author, 0 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `a322a418…` "Nicomachean Ethics dryrun-1784752421005, The", by aristotle, 1999, 0 upload(s), 0 Library resource(s)

- **Method: content-hash** — identical uploaded content hash dryrun-17847…
  - Winner (kept): `2c0eef1b…` "Uploadwork Alpha dryrun-1784752421005", by irwin, 1 upload(s), 0 Library resource(s)
  - Would merge in (repointed, row retained): `4ecc9808…` "Uploadscan Beta dryrun-1784752421005", no author, 1 upload(s), 0 Library resource(s)

#### Would attach (kept as related records, never merged): 2

- `cf0459e3…` "Commentary Target dryrun-1784752421005", by broadie, 0 upload(s), 3 Library resource(s)
  - review: "Review of Commentary Target dryrun-1784752421005"
  - edition: "Commentary Target dryrun-1784752421005, 2nd edition"

#### Suggestion only (never merged automatically): 2

- `bcceda0e-00da-48b8-9de1-e05e97ff56b6` (unknown) ↔ `553d6280…` "Vice and Reason dryrun-1784752421005", by irwin, 0 upload(s), 0 Library resource(s) — similarity 0.5: similar titles by the same author (similarity 0.50) — fuzzy match, suggestion only

- `dced2a62…` "Aristotle's Ethical Theory dryrun-1784752421005", by hardie, 0 upload(s), 0 Library resource(s) ↔ `d98feb77…` "Aristotle's Ethical Theory dryrun-1784752421005: An Introduction", by hardie, 0 upload(s), 0 Library resource(s) — similarity 0.833: similar titles by the same author (similarity 0.83) — fuzzy match, suggestion only

Fixture cleaned up. No merge was applied by this script.

---

## Reversibility statement

Every applied merge (none was applied here) writes a `work_identity_merge` row (migration `0031`) recording winner, loser, method, evidence, and a `reversal` payload with the exact repointed `works`/`learning_resource`/`resource_role` ids, any displaced conflicting roles (full row copies), and any winner identifier columns backfilled from the loser. `revertWorkIdentityMerge` restores that exact prior state and stamps `revertedAt`, freeing the partial-unique active-loser slot so a corrected re-merge stays possible. This round trip is exercised end-to-end by `apps/worker/src/identity/merge.integration.test.ts` against the real local Postgres.
