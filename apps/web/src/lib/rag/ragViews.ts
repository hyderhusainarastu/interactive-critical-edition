import { isResearchMode, type RagAnchor, type ResearchMode } from "@ice/rag";

export type RagCitationView = {
  chunkId: string;
  ordinal: number;
  href: string;
  label: string;
  sourceType: "uploaded" | "open_access";
  pageIndex?: number;
  license?: string;
};

/** Phase 28.6: a research-mode answer's claim citation, parallel to
 *  `RagCitationView` above but for `research_claim` rows cited via the
 *  CLAIM_N label rather than a `rag_chunk`. Deep-links to the permalink page
 *  Phase 28.3 already ships (`/research/claims/[claimId]`). */
export type RagClaimCitationView = {
  claimId: string;
  ordinal: number;
  href: string;
  label: string;
  claimNature: string;
};

export type RagMessageView = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** `null` means `socratic` — matches `rag_message.mode`'s own NULL
   *  convention (see the schema doc comment). */
  mode: ResearchMode | null;
  citations: RagCitationView[];
  claimCitations: RagClaimCitationView[];
  createdAt: string;
  latencyMs: number | null;
};

export function messageView(
  message: { id: string; role: "user" | "assistant"; content: string; mode?: string | null; createdAt: Date; latencyMs: number | null },
  citations: RagCitationView[] = [],
  claimCitations: RagClaimCitationView[] = [],
): RagMessageView {
  const mode = message.mode && isResearchMode(message.mode) ? message.mode : null;
  return { id: message.id, role: message.role, content: message.content, mode, citations, claimCitations, createdAt: message.createdAt.toISOString(), latencyMs: message.latencyMs };
}

export function citationView(chunk: { id: string; anchor: unknown; sourceType: "uploaded" | "open_access"; sourceUrl: string | null; license: string | null; workTitle: string }, ordinal: number): RagCitationView {
  const anchor = chunk.anchor as RagAnchor;
  return {
    chunkId: chunk.id,
    ordinal,
    href: anchor.href || chunk.sourceUrl || "#",
    label: anchor.kind === "reader"
      ? `${chunk.workTitle}${typeof anchor.pageIndex === "number" ? ` · page ${anchor.pageIndex + 1}` : ""}`
      : `${chunk.workTitle} · open-access source`,
    sourceType: chunk.sourceType,
    ...(typeof anchor.pageIndex === "number" ? { pageIndex: anchor.pageIndex } : {}),
    ...(chunk.license ? { license: chunk.license } : {}),
  };
}

/** `claimText` is truncated for display — the full text is one click away
 *  on the permalink page (`/research/claims/[claimId]`, Phase 28.3), so this
 *  chip only needs to be a legible pointer, not the whole claim. */
export function claimCitationView(claim: { id: string; claimText: string; claimNature: string; workTitle: string }, ordinal: number): RagClaimCitationView {
  const truncated = claim.claimText.length > 110 ? `${claim.claimText.slice(0, 107)}…` : claim.claimText;
  return { claimId: claim.id, ordinal, href: `/research/claims/${claim.id}`, label: `${claim.workTitle} — ${truncated}`, claimNature: claim.claimNature };
}
