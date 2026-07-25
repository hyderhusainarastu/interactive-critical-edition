/**
 * `d3-force-3d` ships no type declarations and no `@types/d3-force-3d`
 * package exists (verified 2026-07-24). It is already a transitive
 * dependency of `three-forcegraph` (which `react-force-graph-3d` itself
 * depends on) — added as an explicit `apps/web` dependency only so this
 * direct import resolves under pnpm's strict (non-hoisting) node_modules
 * layout, not because the runtime code changed. Only the exports this app
 * actually calls are declared (`forceCollide` for the explore-mode
 * collision force; `forceLink`, added Graph P4, for the mild resource<
 * ->concept clustering force) — their return types match the `ForceFn`
 * shape `react-force-graph-3d`'s own `.d3Force()` accepts (callable with an
 * `(alpha: number) => void` signature, plus chainable configuration
 * methods).
 */
declare module "d3-force-3d" {
  interface D3ForceCollide<NodeDatum = Record<string, unknown>> {
    (alpha: number): void;
    initialize?: (nodes: NodeDatum[], ...args: unknown[]) => void;
    radius(radius: number | ((node: NodeDatum, i: number, nodes: NodeDatum[]) => number)): D3ForceCollide<NodeDatum>;
    strength(strength: number): D3ForceCollide<NodeDatum>;
    iterations(iterations: number): D3ForceCollide<NodeDatum>;
  }

  export function forceCollide<NodeDatum = Record<string, unknown>>(
    radius?: number | ((node: NodeDatum, i: number, nodes: NodeDatum[]) => number),
  ): D3ForceCollide<NodeDatum>;

  interface D3ForceLink<NodeDatum = Record<string, unknown>, LinkDatum = object> {
    (alpha: number): void;
    initialize?: (nodes: NodeDatum[], ...args: unknown[]) => void;
    id(id: (node: NodeDatum, i: number, nodes: NodeDatum[]) => string | number): D3ForceLink<NodeDatum, LinkDatum>;
    strength(strength: number | ((link: LinkDatum, i: number, links: LinkDatum[]) => number)): D3ForceLink<NodeDatum, LinkDatum>;
    distance(distance: number | ((link: LinkDatum, i: number, links: LinkDatum[]) => number)): D3ForceLink<NodeDatum, LinkDatum>;
    links(links: LinkDatum[]): D3ForceLink<NodeDatum, LinkDatum>;
  }

  export function forceLink<NodeDatum = Record<string, unknown>, LinkDatum = object>(
    links?: LinkDatum[],
  ): D3ForceLink<NodeDatum, LinkDatum>;
}
