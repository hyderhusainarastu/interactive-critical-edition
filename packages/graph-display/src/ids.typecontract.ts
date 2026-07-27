/**
 * Compile-time contract test (charter §9: "Add contract tests proving
 * canonical and display models cannot be confused").
 *
 * This file asserts nothing at runtime — every check below is a
 * `// @ts-expect-error` line that only has meaning to `tsc`. It is checked
 * by `pnpm --filter @ice/graph-display typecheck` (this package's
 * `tsconfig.json` includes all of `src/**\/*.ts`), NOT by `vitest run` —
 * vitest's default include glob is `*.test.ts`/`*.spec.ts`, and this file
 * deliberately does not match either, so it is never executed, only
 * type-checked. If branding is ever accidentally removed from `ids.ts`
 * (e.g. `DisplayNodeId` collapses back to a plain `string`), every
 * `@ts-expect-error` below stops being an error and `tsc --noEmit` FAILS
 * with "Unused '@ts-expect-error' directive" — that failure IS the proof
 * the contract held before the regression.
 */

import {
  toCanonicalLinkId,
  toCanonicalNodeId,
  toDisplayLinkId,
  toDisplayNodeId,
  type CanonicalLinkId,
  type CanonicalNodeId,
  type DisplayLinkId,
  type DisplayNodeId,
} from "./ids";

// A DisplayNodeId cannot be assigned directly to a CanonicalNodeId-typed
// binding without going through a constructor — even though both are
// `string` at runtime, the brands make them structurally distinct types.
const displayNodeId: DisplayNodeId = toDisplayNodeId("work:abc");
// @ts-expect-error DisplayNodeId is not assignable to CanonicalNodeId.
const wrongAsCanonical: CanonicalNodeId = displayNodeId;
void wrongAsCanonical;

// ...and the reverse.
const canonicalNodeId: CanonicalNodeId = toCanonicalNodeId("work:abc");
// @ts-expect-error CanonicalNodeId is not assignable to DisplayNodeId.
const wrongAsDisplay: DisplayNodeId = canonicalNodeId;
void wrongAsDisplay;

// A raw, unbranded string literal is not assignable to either branded id
// type without going through the constructor function.
// @ts-expect-error a bare string is not assignable to DisplayNodeId.
const rawStringAsDisplay: DisplayNodeId = "work:abc";
void rawStringAsDisplay;

// Node-id brands and link-id brands are ALSO mutually exclusive, not just
// "display vs. canonical" — a DisplayLinkId cannot silently stand in for a
// DisplayNodeId (the exact bug class this contract exists to prevent:
// `DisplayLink.source`/`.target` are `DisplayNodeId`, `DisplayLink.id` is a
// `DisplayLinkId`, and confusing the two would be an easy, silent mistake
// without branding).
const displayLinkId: DisplayLinkId = toDisplayLinkId("work:abc|cites|work:def");
// @ts-expect-error DisplayLinkId is not assignable to DisplayNodeId.
const linkIdAsNodeId: DisplayNodeId = displayLinkId;
void linkIdAsNodeId;

const canonicalLinkId: CanonicalLinkId = toCanonicalLinkId("edge:1");
// @ts-expect-error CanonicalLinkId is not assignable to CanonicalNodeId.
const canonicalLinkAsNodeId: CanonicalNodeId = canonicalLinkId;
void canonicalLinkAsNodeId;

// Sanity: the constructor functions themselves DO produce the expected
// branded type with no error, so the negative checks above are testing the
// brand, not a broken constructor.
const okDisplay: DisplayNodeId = toDisplayNodeId("work:abc");
const okCanonical: CanonicalNodeId = toCanonicalNodeId("work:abc");
void okDisplay;
void okCanonical;
