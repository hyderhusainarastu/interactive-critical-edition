import assert from "node:assert/strict";
import { matchClaimToBlock } from "./researchClaims";

const claim = (quote: string | null, prefix: string | null = null, suffix: string | null = null) => ({
  id: "claim-1",
  quote,
  prefix,
  suffix,
});

assert.deepEqual(
  matchClaimToBlock(claim("reason subordinated"), [
    { id: "a", text: "No match here." },
    { id: "b", text: "Irwin reads vice as reason subordinated to antecedent inclination." },
  ]),
  { claimId: "claim-1", blockId: "b", offset: 20 },
);

// Exactly one matching block is required — two or more equally plausible
// matches must stay sidebar-only rather than guessing between them.
assert.equal(
  matchClaimToBlock(claim("same phrase"), [
    { id: "a", text: "The same phrase appears here." },
    { id: "b", text: "The same phrase appears there." },
    { id: "c", text: "Unrelated text with no match." },
  ]),
  null,
);

assert.equal(matchClaimToBlock(claim("missing"), [{ id: "a", text: "Different text." }]), null);
assert.equal(matchClaimToBlock(claim(null), [{ id: "a", text: "Any text." }]), null);
