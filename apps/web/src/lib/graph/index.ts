/**
 * `@/lib/graph` names this domain's core module, which now sits beside its
 * siblings in this folder. This file exists only so that specifier keeps
 * resolving to it -- 3 files import it, and none of them should have to
 * care that the builder itself lives in `./build`.
 *
 * It is not a general barrel: every other module in this folder is
 * deep-imported, matching the convention lib/research/ and lib/writer/
 * already set, so each import says where its symbol actually lives.
 */
export { buildGraph } from "./build";

// The node/edge shapes are the ONE shared graph contract (plan §21.1),
// declared in `@/components/graph/types` and consumed identically by this
// builder, the 3D scene, the accessible table, the inspector, and the
// filters. This module deliberately declares no parallel copies.
export type { GraphLink, GraphNode, GraphPayload, NodeState, NodeType } from "@/components/graph/types";
