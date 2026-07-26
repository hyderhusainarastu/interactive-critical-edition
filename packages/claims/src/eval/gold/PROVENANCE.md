# Gold Set Provenance

## Origin

The empirical relationship-pair and search-query gold sets in this directory originate from **ScholarLens**, an open-source scholarly claim-assessment framework by Aakash Shahani (MIT license). ScholarLens was made available to this project with the author's explicit written permission; Shahani is now a collaborator on Palimnote.

## Per-File Inventory

| Filename | Source Path | SHA-256 | Date | Purpose |
|----------|-------------|---------|------|---------|
| `relationshipPairs.empirical.json` | `/scholarlens_src/eval/gold_claims.json` | `f1dcb8756ff8b7e38cce65781bcc84f997ebd2adb38ef88771a7c6a5b4fdcbf0` | 2026-07-25 | Gold-standard relationship pairs (42 annotated pairs: 12 support, 12 nuance, 9 contradiction, 9 unrelated); used for evaluating relationship classification accuracy |
| `searchQueries.json` | `/scholarlens_src/eval/gold_search.json` | `4fa7cd3dc990a72ea17c56953a5fa5305a61a34d17de978d7bd04019abbf9a2e` | 2026-07-25 | Search query fixtures; retained for future search-evaluation retrofit; currently unused |

## Palimnote-Authored Drafts

The following files in this package are Palimnote-authored domain-specific drafts, not derived from ScholarLens, and are pending owner ratification:

- `relationshipPairs.humanities.json` — humanities-domain relationship classification gold set
- `retrievalNegatives.json` — hard-negative retrieval cases for dense-embedding evaluation
- `claimNature.json` — claim-type classification fixtures

These will be reconciled against Palimnote's own scholarly-claim taxonomy once ownership and licensing are finalized.
