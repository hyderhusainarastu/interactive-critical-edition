import assert from "node:assert/strict";
import { parseReaderBlockHash } from "./readerBlockHash";

assert.equal(parseReaderBlockHash("#block-abc-123"), "abc-123");
assert.equal(parseReaderBlockHash("#block-" + "00000000-0000-0000-0000-000000000001"), "00000000-0000-0000-0000-000000000001");

// No fragment at all, or a fragment for something else entirely.
assert.equal(parseReaderBlockHash(""), null);
assert.equal(parseReaderBlockHash("#something-else"), null);
assert.equal(parseReaderBlockHash("#block"), null);

// Present but empty — names nothing.
assert.equal(parseReaderBlockHash("#block-"), null);

console.log("readerBlockHash.test.ts: all assertions passed");
