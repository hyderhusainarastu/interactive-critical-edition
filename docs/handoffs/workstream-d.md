# Workstream D handoff — reader marginalia and foreign text

## Reader layout

Root cause: `EditionReader` positioned each wide-screen margin note with
`position:absolute; left:calc(100% + 1.25rem)` outside the processed-text
section. The outline and edition sidebars are sibling sticky columns owned by
`ReaderShell`, so no layout track reserved that space. At 1280–1440px the
absolute note could occupy the right rail or be clipped by an ancestor.

The replacement is a container-aware, normal-flow two-column grid per text
block: `minmax(0, 1fr) 13rem`, with a 1.25rem gap. It activates only when the
space remaining after live rails is at least 40rem. Below that, including split
views and multi-rail layouts, the existing inline disclosure is used. Hover
previews are fixed but clamped to the processed-reader region. The explicit
layer order is shell chrome 20, hover/foreign previews 25, selection toolbar
30, narrow modal rails 40.

## Broken-ToUnicode investigation

`packages/ingestion/src/pdfGlyphRecovery.test.ts` generates a lawful PDF from
scratch using the PDF standard's built-in Symbol font and an intentionally
wrong ToUnicode CMap. There is no production text or embedded third-party font.
The text API returns `abg`; the public pdf.js operator list retains display
glyphs `αβγ`. `inspectPdfGlyphRecoveryCandidates()` exposes this narrow case as
`pdfjs_operator_font_char`, confidence 0.85, `automatic:false`.

This is not a general font-shape OCR system. A custom embedded font that exposes
only Latin/PUA `fontChar` data is not recoverable through this seam. Existing
Tesseract OCR remains the preferred free recovery path where its Greek model is
installed (`OCR_LANGUAGE=eng+ell`); GROBID supplies structure but is not an
independent glyph decoder. When neither yields grounded characters, the
untranscribable marker remains.

## Migration 0036 contract for Workstream H

No migration or Drizzle table is included in Workstream D. Current code has no
compile-time or runtime dependency on `foreign_span`; `EditionPayload` has an
optional `foreignSpans` field and renders nothing when it is absent.

H should supply a `foreign_span` table with these columns:

| Column | Required shape |
|---|---|
| `id` | UUID primary key |
| `user_id` | UUID FK `user.id`, cascade; ownership/index |
| `document_id` | UUID FK `document.id`, cascade; index |
| `run_id` | UUID FK `processing_run.id`, cascade |
| `text_block_id` | UUID FK `text_block.id`, cascade; index |
| `source_text` | text, exact stored block substring |
| `original_text` | text, original script; equals source text unless recovered |
| `start_offset`, `end_offset` | integers, UTF-16 offsets; checks `0 <= start < end` |
| `prefix`, `suffix` | text, quote-fingerprint context |
| `script` | `greek\|hebrew\|arabic\|cyrillic\|cjk` |
| `language_hint` | text, script-range hint |
| `language_code`, `language_label` | nullable until validated translation |
| `language_basis` | `script_range\|model_validated\|human_verified` |
| `direction` | `ltr\|rtl` |
| `source_provenance_kind` | `source_text\|ocr_recovery\|pdf_glyph_recovery\|manual` |
| `source_provenance_label` | reader-facing factual label |
| `source_confidence` | real with `0 <= value <= 1` |
| `transcription_status` | `legitimate\|recovered` |
| `transliteration`, `translation` | nullable text until resolved |
| `translation_provenance` | nullable; `machine_translation` for this worker |
| `provider`, `model`, `prompt_version` | nullable model provenance |
| `cache_key` | nullable 64-char SHA-256; indexed |
| `status`, `deferred_reason` | processing state and honest failure reason |
| `created_at`, `updated_at` | timestamps |

Required constraints/indexes:

- unique `(run_id, text_block_id, start_offset, end_offset)`;
- index `(status, run_id)` for pending batches;
- index `cache_key` filtered to resolved rows, allowing reuse without making
  repeated occurrences themselves unique;
- document/user ownership index and repository checks that run/block/document
  belong to the same owner;
- bounds and exact-substring validation before serving a row to the reader.

H then wires two adapters without changing the pure D modules:

1. `apps/web/src/lib/edition.ts` queries only real stored, resolved rows and maps
   them to `EditionPayload.foreignSpans`.
2. The worker repository maps pending/cache/save/log operations from
   `apps/worker/src/foreignText.ts`; each model call writes `ai_usage_log` with
   task `foreign_span_translation`, stage `foreign-text`, and its run/document.

The repository must never enqueue an untranscribable marker as model input.
