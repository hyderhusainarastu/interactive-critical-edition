import type { CitationSourceInput, ExtractedAuthorApparatus } from "@ice/ingestion";

/**
 * Stage 1 (cheap, deterministic) input assembly for citation extraction:
 * source-aware body/apparatus text becomes the query set that
 * `extractCitationMentions` scans. Pulled out of `analyzeEditionRun` as a
 * pure function (no DB) specifically so the D-20-91 exclusion below is
 * independently unit-testable without a database.
 */
export function buildStructuralCitationSources(input: {
  bodyBlocks?: { id: string; text: string; pageIndex?: number; blockOrder?: number }[];
  apparatus?: ExtractedAuthorApparatus[];
}): CitationSourceInput[] {
  return [
    ...(input.bodyBlocks ?? []).map((block) => ({
      sourceType: "inline" as const,
      text: block.text,
      textBlockId: block.id,
      pageIndex: block.pageIndex ?? null,
      blockOrder: block.blockOrder ?? null,
      parserConfidence: 0.82,
    })),
    ...(input.apparatus ?? []).flatMap((entry): CitationSourceInput[] => {
      const sourceType = entry.kind === "bibliography_entry"
        ? "bibliography"
        : entry.kind === "footnote"
          ? "footnote"
          : entry.kind === "endnote"
            ? "endnote"
            : null;
      if (!sourceType) return [];
      // D-20-91: a recovered endnote (GROBID's own structural pass produced
      // no trace of it — see `endnoteRecovery.ts`) must never seed citation
      // extraction. GROBID's independent `<biblStruct>`/"reference" pass
      // already recovers this same era of citation's *bibliographic*
      // content on its own, unaffected by this gap (see D-20-89's module
      // comment); there is no cross-representation identity check that
      // could tell "endnote #14, text-layer form" and "reference block #9,
      // GROBID biblStruct form" are the same work before both reach
      // resolution, so admitting the recovered copy here would duplicate a
      // paid metadata-resolution enqueue and a Library entry for a work
      // citation resolution already reaches through the other path.
      // Precision over recall: the recovered block still reaches every
      // reader-facing surface untouched (docFootnotes, textBlocks,
      // documentApparatus) — only this one paid, dedup-fragile pipeline
      // excludes it.
      if (sourceType === "endnote" && entry.recovered) return [];
      const scope = entry.scope as { pageIndex?: number; blockOrder?: number };
      return [{
        sourceType,
        text: entry.text,
        textBlockId: entry.textBlockId,
        pageIndex: scope.pageIndex ?? null,
        blockOrder: scope.blockOrder ?? null,
        marker: entry.marker,
        parserConfidence: entry.source === "structure" ? 0.98 : 0.65,
      }];
    }),
  ];
}
