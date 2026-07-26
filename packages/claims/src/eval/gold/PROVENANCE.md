# Gold Set Provenance

## Origin

The empirical relationship-pair and search-query gold sets in this directory originate from **ScholarLens**, a scholarly claim-assessment framework created by Aakash Shahani, who is now a collaborator on Palimnote.

**License basis.** The ScholarLens source tree (`/Users/hyderhusainarastu/Project/scholarlens_src`) contains no `LICENSE` file — only a README badge advertising an MIT license, which, per this project's own Phase-0 zero-copy discipline (a badge with no accompanying license text is not itself a license grant), is not relied on as the authorization. The actual authorization basis for using these gold sets in Palimnote is the project owner's explicit declaration, made 2026-07-25 in the project session and recorded in the program plan of record (`docs/architecture/scholarlens-integration-plan.md`, Context section): the owner has acquired a full license to ScholarLens from its creator, who is collaborating on the Palimnote upgrade. The README's MIT badge corroborates the author's intent but is not, by itself, the license grant this project relies on.

**Follow-up (owner action item).** Obtaining this grant in a durable written form — either directly from the author, or by the author adding a `LICENSE` file to the ScholarLens repository — is recommended so the authorization basis no longer depends on an undocumented verbal/session-recorded declaration. Tracked in `docs/PROJECT-LOG.md`'s Remaining Tasks.

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
