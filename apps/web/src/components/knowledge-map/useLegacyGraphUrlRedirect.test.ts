import assert from "node:assert/strict";
import { shouldAttemptLegacyTranslation } from "./useLegacyGraphUrlRedirect";

/** `npx tsx apps/web/src/components/knowledge-map/useLegacyGraphUrlRedirect.test.ts`
 *  — covers the pure layer only, per this file's own doc comment on why
 *  the React-binding layer is not unit-tested here. */

assert.equal(shouldAttemptLegacyTranslation(new URLSearchParams()), true, "bare /graph is a legacy-translation candidate");
assert.equal(shouldAttemptLegacyTranslation(new URLSearchParams("layout=explore")), true, "old param present, no ctxKind");
assert.equal(shouldAttemptLegacyTranslation(new URLSearchParams("ctxKind=work&ctxId=w1")), false, "new-format URL is never re-translated");
assert.equal(shouldAttemptLegacyTranslation(new URLSearchParams("ctxKind=work")), false, "ctxKind alone is enough to skip, even without ctxId");

console.log("shouldAttemptLegacyTranslation: OK");
console.log("useLegacyGraphUrlRedirect.test.ts: all assertions passed");
