/**
 * Re-export only — the real implementation lives at
 * `packages/graph-display/src/camera.ts` (spec §1.3: camera math is pure,
 * zero-React, zero-renderer data over plain data, exactly the kind of
 * thing `@ice/graph-display` already commits to as its charter, and the
 * bakeoff module's own doc comment is explicit that "later, the real
 * Knowledge Map rebuild" must consume exactly the same module the bakeoff
 * prototypes were judged against — one implementation, never a copy).
 *
 * A plain `export * from "@ice/graph-display"` (the package's single-entry
 * barrel) rather than a subpath import (`@ice/graph-display/camera`) —
 * the package has no `exports` map declaring that subpath, so it would not
 * resolve under this workspace's module resolution; the barrel already
 * re-exports everything `camera.ts` defines (`packages/graph-display/src/index.ts`),
 * so this file only needs the one, always-resolvable import.
 */
export * from "@ice/graph-display";
