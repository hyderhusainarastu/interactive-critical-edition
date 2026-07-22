import type { ConsistencyMismatch } from "../types";
import type { ConsistencySnapshot } from "../snapshot";

/**
 * Check 8 — RAG citation anchor (plan §20.7 bullet 8).
 *
 * Every `rag_message_citation` is a hard FK to the exact retrieved
 * `rag_chunk` (schema's own doc comment). The one thing the FK graph cannot
 * itself prevent is an OWNERSHIP disagreement: `rag_chunk.user_id` should
 * always equal the owning conversation's `user_id` for every chunk a
 * message ever cites — retrieval is explicitly owner-scoped SQL (Phase 18),
 * so a citation whose chunk belongs to a different user would mean one
 * owner's answer cites another owner's private content. This is exactly the
 * cross-user leak this project's per-user isolation discipline exists to
 * prevent, so it is CRITICAL severity.
 *
 * There is no safe repair that keeps the citation (there is no "correct"
 * chunk to repoint it to — that would be guessing which of the CORRECT
 * owner's chunks the answer actually meant). The only safe repair is to
 * retract the invalid citation link itself; the underlying chunk and
 * message are untouched.
 */
export function checkRagCitationAnchor(snapshot: ConsistencySnapshot): ConsistencyMismatch[] {
  const mismatches: ConsistencyMismatch[] = [];
  const chunkOwner = new Map(snapshot.ragChunks.map((c) => [c.id, c.userId]));
  const conversationOwner = new Map(snapshot.ragConversations.map((c) => [c.id, c.userId]));
  const conversationByMessage = new Map(snapshot.ragMessages.map((m) => [m.id, m.conversationId]));

  for (const citation of snapshot.ragMessageCitations) {
    const chunkUserId = chunkOwner.get(citation.chunkId);
    if (chunkUserId === undefined) {
      // rag_chunk FK is ON DELETE CASCADE — should be unreachable.
      mismatches.push({
        checkId: "rag-citation-anchor",
        entityType: "rag_message_citation",
        entityId: citation.id,
        description: "rag_message_citation references a rag_chunk row that no longer exists.",
        severity: "critical",
        evidence: { chunkId: citation.chunkId },
        repair: { kind: "delete", table: "rag_message_citation", id: citation.id, reason: "Cited chunk no longer exists; the citation cannot point anywhere real." },
      });
      continue;
    }

    const conversationId = conversationByMessage.get(citation.messageId);
    const messageOwnerId = conversationId ? conversationOwner.get(conversationId) : undefined;
    if (messageOwnerId === undefined) continue; // dangling message/conversation — not this check's job

    if (chunkUserId !== messageOwnerId) {
      mismatches.push({
        checkId: "rag-citation-anchor",
        entityType: "rag_message_citation",
        entityId: citation.id,
        description: "rag_message_citation cites a rag_chunk owned by a different user than the answering conversation's owner.",
        severity: "critical",
        evidence: { chunkOwnerId: chunkUserId, conversationOwnerId: messageOwnerId },
        repair: {
          kind: "delete",
          table: "rag_message_citation",
          id: citation.id,
          reason: "No chunk this owner is actually entitled to can be safely substituted; retracting the invalid citation rather than guessing a replacement.",
        },
      });
    }
  }

  return mismatches;
}
