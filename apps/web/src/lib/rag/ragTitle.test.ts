import { describe, expect, it } from "vitest";
import { deriveRagConversationTitle } from "@/lib/rag/ragTitle";

/**
 * Workstream E (plan §4). Run via `pnpm --filter web exec tsx <path>` — same
 * framework-free convention as `ragConversationClient.test.ts`/`sound.test.ts`.
 */

describe("deriveRagConversationTitle", () => {
  it("uses a short question verbatim", () => {
    const title = deriveRagConversationTitle("New conversation", "What is akrasia?");
    expect(title).toBe("What is akrasia?");
  });

  it("replaces the default title on the first question, trimming surrounding whitespace", () => {
    const title = deriveRagConversationTitle("New conversation", "  How does passion relate to decision?  ");
    expect(title).toBe("How does passion relate to decision?");
  });

  it("never overwrites an already-set title — a conversation only titles itself once, from its first question", () => {
    const title = deriveRagConversationTitle("How does passion relate to decision?", "A completely different second question that is long enough to matter");
    expect(title).toBe("How does passion relate to decision?");
  });

  it("truncates a long question at a word boundary", () => {
    const question = "What does Aristotle mean when he says that vice remains a state on which a person decides, even though the vicious act on passion?";
    const title = deriveRagConversationTitle("New conversation", question);
    expect(title.length <= 61, `expected <= 61 chars (60 + ellipsis), got ${title.length}`).toBeTruthy();
    // "a truncated title ends with an ellipsis"
    expect(title.endsWith("…")).toBeTruthy();
    // "the boundary cut trims trailing whitespace before the ellipsis"
    expect(!title.slice(0, -1).endsWith(" ")).toBeTruthy();
    // "the truncated title is a real prefix of the question"
    expect(question.startsWith(title.slice(0, -1))).toBeTruthy();
  });

  it("hard-cuts a long question that has no early word boundary", () => {
    // A single 80-character run with no spaces at all — no word boundary
    // exists anywhere, so this must fall back to a hard cut rather than
    // either returning the untruncated question or throwing.
    const question = "a".repeat(80);
    const title = deriveRagConversationTitle("New conversation", question);
    expect(title).toBe(`${"a".repeat(60)}…`);
  });

  it("does not truncate a question exactly at the limit — it needs no ellipsis", () => {
    const question = "a".repeat(60);
    const title = deriveRagConversationTitle("New conversation", question);
    expect(title).toBe(question);
  });

  it("truncates a question one character over the limit", () => {
    const question = `${"a".repeat(59)} b`; // 61 chars, one word boundary right before the limit
    const title = deriveRagConversationTitle("New conversation", question);
    expect(title).toBe(`${"a".repeat(59)}…`);
  });
});
