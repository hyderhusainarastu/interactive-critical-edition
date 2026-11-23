# Gold Set Provenance

## Origin

The empirical relationship-pair and search-query gold sets in this directory originate from **the upstream project**, a scholarly claim-assessment framework created by a third-party author (the dataset's author).

**License basis.** Used with the author's permission; see owner.

## Per-File Inventory

| Filename | Source Path | SHA-256 | Date | Purpose |
|----------|-------------|---------|------|---------|
| `relationshipPairs.empirical.json` | `/scholarlens_src/eval/gold_claims.json` | `f1dcb8756ff8b7e38cce65781bcc84f997ebd2adb38ef88771a7c6a5b4fdcbf0` | 2026-07-25 | Gold-standard relationship pairs (42 annotated pairs: 12 support, 12 nuance, 9 contradiction, 9 unrelated); used for evaluating relationship classification accuracy |
| `searchQueries.json` | `/scholarlens_src/eval/gold_search.json` | `4fa7cd3dc990a72ea17c56953a5fa5305a61a34d17de978d7bd04019abbf9a2e` | 2026-07-25 | Search query fixtures; retained for future search-evaluation retrofit; currently unused |

## Palimnote-Authored Drafts

The following files in this package are Palimnote-authored domain-specific drafts, not derived from ScholarLens:

- `relationshipPairs.humanities.json` — humanities-domain relationship classification gold set
- `retrievalNegatives.json` — hard-negative retrieval cases for dense-embedding evaluation
- `claimNature.json` — claim-type classification fixtures

**Ratification status: ratified.** The owner reviewed the full packet (`docs/eval/research-claims/humanities-ratification-packet.md`) on 2026-07-26 and approved all records as labeled, including the 11 same-work-flagged pairs. Every record in these three files now carries `"provisional": false`. See `RATIFICATION.md` for the ratification record. These remain candidates for reconciliation against Palimnote's own scholarly-claim taxonomy as that taxonomy evolves, but are no longer pending ratification.
