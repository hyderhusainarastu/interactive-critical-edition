/**
 * Branded (opaque) id types (charter §9 "Add contract tests proving
 * canonical and display models cannot be confused").
 *
 * At runtime a `DisplayNodeId`/`DisplayLinkId` and a `CanonicalNodeId`/
 * `CanonicalLinkId` are just strings — TypeScript brands add zero runtime
 * cost and zero runtime enforcement. What they DO give us is a compile-time
 * guarantee: a `string` (or the wrong brand) cannot be assigned to a
 * `DisplayNodeId`-typed field without going through the constructor
 * functions below, so `DisplayLink.source = someCanonicalNodeId` (a real,
 * easy-to-make bug — passing the canonical `work:<uuid>` id where a display
 * id was expected) is a compile error, not a silent runtime mix-up. See
 * `ids.typecontract.ts` for the actual proof (a `tsc --noEmit`-checked
 * negative-compilation test) and `ids.test.ts` for the runtime-shape
 * documentation of this guarantee's boundary (branding is compile-time
 * only; nothing here rejects a bad string at runtime).
 */

declare const DISPLAY_NODE_ID_BRAND: unique symbol;
declare const DISPLAY_LINK_ID_BRAND: unique symbol;
declare const CANONICAL_NODE_ID_BRAND: unique symbol;
declare const CANONICAL_LINK_ID_BRAND: unique symbol;

export type DisplayNodeId = string & { readonly [DISPLAY_NODE_ID_BRAND]: true };
export type DisplayLinkId = string & { readonly [DISPLAY_LINK_ID_BRAND]: true };
export type CanonicalNodeId = string & { readonly [CANONICAL_NODE_ID_BRAND]: true };
export type CanonicalLinkId = string & { readonly [CANONICAL_LINK_ID_BRAND]: true };

/** The only sanctioned way to mint a `DisplayNodeId` from a raw string. */
export function toDisplayNodeId(raw: string): DisplayNodeId {
  return raw as DisplayNodeId;
}

export function toDisplayLinkId(raw: string): DisplayLinkId {
  return raw as DisplayLinkId;
}

/** Mint a `CanonicalNodeId` from a raw string — the canonical `GraphNode.id`
 *  (`work:<uuid>` / `external:bib:<uuid>` / `external:source:<key>` /
 *  `concept:<uuid>` / `section:<uuid>` / `claim:<uuid>` / `debate:<uuid>`)
 *  read verbatim from the canonical payload, never invented. */
export function toCanonicalNodeId(raw: string): CanonicalNodeId {
  return raw as CanonicalNodeId;
}

export function toCanonicalLinkId(raw: string): CanonicalLinkId {
  return raw as CanonicalLinkId;
}

/** Unwrap a branded id back to a plain string — for logging, DOM
 *  `data-*` attributes, URL state, etc. Always safe (a branded id IS a
 *  string at runtime). */
export function unwrapId(id: DisplayNodeId | DisplayLinkId | CanonicalNodeId | CanonicalLinkId): string {
  return id as string;
}
