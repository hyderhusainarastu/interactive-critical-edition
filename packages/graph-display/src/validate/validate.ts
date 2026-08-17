/**
 * Structural invariants and validation (charter §9 "Adapter invariants" /
 * TESTS item 5). Two concerns:
 *
 *  1. Structural diagnostics over an already-built `DisplayNode`/
 *     `DisplayLink` set: duplicate ids, dangling endpoints, self-links,
 *     parallel links. ("Unsupported direction" is validated per-edge in
 *     `families.ts`'s `validateLinkDirection`, since it needs the
 *     underlying `edgeType` a `DisplayLink` alone does not carry — see that
 *     module's doc comment.)
 *  2. Canonical-input immutability: freeze a canonical payload before
 *     handing it to adapter code, so a mutation attempt throws immediately
 *     (strict-mode `TypeError`) instead of silently corrupting data a
 *     renderer, inspector, and accessible table all still expect to read.
 */

import type { DisplayLink, DisplayNode } from "./types";

export type GraphDiagnosticSeverity = "error" | "warning";

export type GraphDiagnosticCode =
  | "duplicate_node_id"
  | "duplicate_link_id"
  | "dangling_source"
  | "dangling_target"
  | "self_link"
  | "parallel_link";

export interface GraphDiagnostic {
  code: GraphDiagnosticCode;
  severity: GraphDiagnosticSeverity;
  message: string;
  nodeId?: string;
  linkId?: string;
}

/**
 * Structural validation over a display node/link set. Pure, read-only —
 * never mutates `nodes`/`links`. Returns every diagnostic found (does not
 * stop at the first); an empty array means the graph is structurally
 * sound. `error`-severity diagnostics describe data that cannot be rendered
 * correctly (a dangling edge, a duplicate id); `warning`-severity
 * diagnostics describe data that is legitimate but worth a renderer
 * knowing about (parallel links between the same pair, which happen
 * legitimately — see this module's own doc comment — and typically need
 * visual bundling/offset).
 */
export function validateDisplayGraph(nodes: readonly DisplayNode[], links: readonly DisplayLink[]): GraphDiagnostic[] {
  const diagnostics: GraphDiagnostic[] = [];

  const seenNodeIds = new Set<string>();
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (seenNodeIds.has(node.id)) {
      diagnostics.push({
        code: "duplicate_node_id",
        severity: "error",
        message: `Duplicate DisplayNode id "${node.id}".`,
        nodeId: node.id,
      });
    }
    seenNodeIds.add(node.id);
    nodeIds.add(node.id);
  }

  const seenLinkIds = new Set<string>();
  const pairCounts = new Map<string, number>();
  for (const link of links) {
    if (seenLinkIds.has(link.id)) {
      diagnostics.push({
        code: "duplicate_link_id",
        severity: "error",
        message: `Duplicate DisplayLink id "${link.id}".`,
        linkId: link.id,
      });
    }
    seenLinkIds.add(link.id);

    if (!nodeIds.has(link.source)) {
      diagnostics.push({
        code: "dangling_source",
        severity: "error",
        message: `Link "${link.id}" source "${link.source}" is not in the node set.`,
        linkId: link.id,
        nodeId: link.source,
      });
    }
    if (!nodeIds.has(link.target)) {
      diagnostics.push({
        code: "dangling_target",
        severity: "error",
        message: `Link "${link.id}" target "${link.target}" is not in the node set.`,
        linkId: link.id,
        nodeId: link.target,
      });
    }
    if (link.source === link.target) {
      diagnostics.push({
        code: "self_link",
        severity: "error",
        message: `Link "${link.id}" connects "${link.source}" to itself.`,
        linkId: link.id,
        nodeId: link.source,
      });
      continue; // A self-link has no meaningful "pair" to also check for parallels.
    }

    // Parallel-link detection: same unordered pair appearing on more than
    // one link id. Legitimate (two different relationship families can
    // connect the same two nodes) — flagged as a warning, for a renderer
    // to bundle/offset, not rejected.
    const pairKey = [link.source, link.target].sort().join("|");
    pairCounts.set(pairKey, (pairCounts.get(pairKey) ?? 0) + 1);
  }

  for (const [pairKey, count] of pairCounts) {
    if (count > 1) {
      const [a, b] = pairKey.split("|");
      diagnostics.push({
        code: "parallel_link",
        severity: "warning",
        message: `${count} links connect "${a}" and "${b}" — a renderer should bundle/offset them.`,
        nodeId: a,
      });
    }
  }

  return diagnostics;
}

export class CanonicalMutationError extends Error {
  constructor(detail: string) {
    super(`Canonical payload was mutated: ${detail}`);
    this.name = "CanonicalMutationError";
  }
}

/**
 * Recursively `Object.freeze` a value (charter §9: "freeze in dev/test and
 * assert"). Handles plain objects and arrays; leaves anything already
 * frozen alone (idempotent, safe to call more than once); does not attempt
 * to freeze exotic objects (`Map`/`Set`/class instances with getters) since
 * the canonical payload this is meant for is plain JSON-shaped data.
 * Returns the same reference for chaining, e.g.
 * `const frozen = deepFreeze(structuredClone(canonicalPayload));`.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/**
 * Assert a (deep-frozen, per `deepFreeze`) canonical payload is still
 * byte-identical to a snapshot taken before an adapter call — a second,
 * independent immutability check that does not rely on `deepFreeze`
 * actually having caught every mutation path (e.g. a mutation via a
 * non-strict-mode function, or a property added before freezing). Compares
 * via `JSON.stringify`, which is sufficient for the plain JSON-shaped
 * canonical payloads this package consumes.
 */
export function assertNotMutated(current: unknown, snapshotJson: string, detail = "value"): void {
  if (JSON.stringify(current) !== snapshotJson) {
    throw new CanonicalMutationError(detail);
  }
}
