import { describe, expect, it } from "vitest";
import { emptySnapshot } from "../snapshot";
import { checkRagCitationAnchor } from "./ragCitationAnchor";

describe("checkRagCitationAnchor", () => {
  it("reports nothing when the cited chunk belongs to the same user as the answering conversation", () => {
    const snapshot = {
      ...emptySnapshot(),
      ragChunks: [{ id: "chunk1", userId: "user-a" }],
      ragConversations: [{ id: "conv1", userId: "user-a" }],
      ragMessages: [{ id: "msg1", conversationId: "conv1" }],
      ragMessageCitations: [{ id: "cite1", messageId: "msg1", chunkId: "chunk1" }],
    };
    expect(checkRagCitationAnchor(snapshot)).toEqual([]);
  });

  it("detects and repairs (retracts) a cross-user citation as critical", () => {
    const snapshot = {
      ...emptySnapshot(),
      ragChunks: [{ id: "chunk1", userId: "user-b" }],
      ragConversations: [{ id: "conv1", userId: "user-a" }],
      ragMessages: [{ id: "msg1", conversationId: "conv1" }],
      ragMessageCitations: [{ id: "cite1", messageId: "msg1", chunkId: "chunk1" }],
    };
    const mismatches = checkRagCitationAnchor(snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].severity).toBe("critical");
    expect(mismatches[0].repair).toEqual({ kind: "delete", table: "rag_message_citation", id: "cite1", reason: expect.any(String) });
  });

  it("detects and repairs a citation pointing at a chunk that no longer exists", () => {
    const snapshot = {
      ...emptySnapshot(),
      ragConversations: [{ id: "conv1", userId: "user-a" }],
      ragMessages: [{ id: "msg1", conversationId: "conv1" }],
      ragMessageCitations: [{ id: "cite1", messageId: "msg1", chunkId: "ghost-chunk" }],
    };
    const mismatches = checkRagCitationAnchor(snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].repair?.kind).toBe("delete");
  });

  it("skips ownership comparison (does not false-positive) when the message/conversation itself is dangling", () => {
    const snapshot = {
      ...emptySnapshot(),
      ragChunks: [{ id: "chunk1", userId: "user-a" }],
      ragMessageCitations: [{ id: "cite1", messageId: "ghost-msg", chunkId: "chunk1" }],
    };
    expect(checkRagCitationAnchor(snapshot)).toEqual([]);
  });
});
