/**
 * @ice/graph-display — pure, exhaustively-tested display/render contract
 * for the Knowledge Map rebuild (charter §8/§9, "Stage 3 DISPLAY-ADAPTER
 * lane"). Zero runtime dependencies, zero renderer code, zero React —
 * every export here is a plain function or type over plain data.
 *
 * See the package README for type-provenance reasoning (why `DisplayKind`
 * is generic instead of importing `apps/web`'s `NodeType`, and why
 * `CanonicalEdgeFamily`/`UNDIRECTED_EDGE_VALUES` are small mirrored
 * constants instead).
 */

export * from "./ids";
export * from "./kinds";
export * from "./layers";
export * from "./state";
export * from "./types";
export * from "./bands";
export * from "./families";
export * from "./disclosure";
export * from "./validate";
export * from "./omission";
export * from "./urlState";
export * from "./urlStateCodec";
export * from "./reconstruct";
export * from "./legacyGraphUrl";
