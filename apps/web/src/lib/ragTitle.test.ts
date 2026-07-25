import assert from "node:assert/strict";
import { deriveRagConversationTitle } from "./ragTitle";

/**
 * Workstream E (plan §4). Run via `pnpm --filter web exec tsx <path>` — same
 * framework-free convention as `ragConversationClient.test.ts`/`sound.test.ts`.
 */

function testShortQuestionUsedVerbatim() {
  const title = deriveRagConversationTitle("New conversation", "What is akrasia?");
  assert.equal(title, "What is akrasia?");
}

function testDefaultTitleIsReplacedOnFirstQuestion() {
  const title = deriveRagConversationTitle("New conversation", "  How does passion relate to decision?  ");
  assert.equal(title, "How does passion relate to decision?", "surrounding whitespace is trimmed");
}

function testAlreadySetTitleIsNeverOverwritten() {
  const title = deriveRagConversationTitle("How does passion relate to decision?", "A completely different second question that is long enough to matter");
  assert.equal(title, "How does passion relate to decision?", "a conversation only titles itself once, from its first question");
}

function testLongQuestionTruncatesAtWordBoundary() {
  const question = "What does Aristotle mean when he says that vice remains a state on which a person decides, even though the vicious act on passion?";
  const title = deriveRagConversationTitle("New conversation", question);
  assert.ok(title.length <= 61, `expected <= 61 chars (60 + ellipsis), got ${title.length}`);
  assert.ok(title.endsWith("…"), "a truncated title ends with an ellipsis");
  assert.ok(!title.slice(0, -1).endsWith(" "), "the boundary cut trims trailing whitespace before the ellipsis");
  assert.ok(question.startsWith(title.slice(0, -1)), "the truncated title is a real prefix of the question");
}

function testLongQuestionWithNoEarlyWordBoundaryHardCuts() {
  // A single 80-character run with no spaces at all — no word boundary
  // exists anywhere, so this must fall back to a hard cut rather than
  // either returning the untruncated question or throwing.
  const question = "a".repeat(80);
  const title = deriveRagConversationTitle("New conversation", question);
  assert.equal(title, `${"a".repeat(60)}…`);
}

function testExactlyAtLimitIsNotTruncated() {
  const question = "a".repeat(60);
  const title = deriveRagConversationTitle("New conversation", question);
  assert.equal(title, question, "a question exactly at the limit needs no ellipsis");
}

function testOneOverLimitTruncates() {
  const question = `${"a".repeat(59)} b`; // 61 chars, one word boundary right before the limit
  const title = deriveRagConversationTitle("New conversation", question);
  assert.equal(title, `${"a".repeat(59)}…`);
}

function main() {
  testShortQuestionUsedVerbatim();
  testDefaultTitleIsReplacedOnFirstQuestion();
  testAlreadySetTitleIsNeverOverwritten();
  testLongQuestionTruncatesAtWordBoundary();
  testLongQuestionWithNoEarlyWordBoundaryHardCuts();
  testExactlyAtLimitIsNotTruncated();
  testOneOverLimitTruncates();
  console.log("ragTitle.test.ts: all assertions passed");
}

main();
