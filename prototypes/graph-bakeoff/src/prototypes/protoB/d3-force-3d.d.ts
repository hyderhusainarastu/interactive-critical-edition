/**
 * Minimal local ambient typings for `d3-force-3d` (charter §13's offline
 * layout pre-pass — see `layout.ts`). Upstream ships no `.d.ts` and there is
 * no `@types/d3-force-3d` package; rather than adding an untyped `@ts-
 * ignore` at every call site, this declares just the fluent surface
 * `layout.ts` actually calls, scoped to this prototype only.
 */
declare module "d3-force-3d" {
  export interface SimulationNodeDatum3d {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }

  export interface SimulationLinkDatum3d<NodeDatum> {
    source: string | NodeDatum;
    target: string | NodeDatum;
  }

  export interface Simulation<N extends SimulationNodeDatum3d> {
    tick(iterations?: number): Simulation<N>;
    stop(): Simulation<N>;
    restart(): Simulation<N>;
    nodes(): N[];
    nodes(nodes: N[]): Simulation<N>;
    force(name: string): unknown;
    force(name: string, force: unknown): Simulation<N>;
    alpha(value: number): Simulation<N>;
  }

  export function forceSimulation<N extends SimulationNodeDatum3d>(nodes: N[], numDimensions?: number): Simulation<N>;

  export interface ForceLink<N, L> {
    (alpha: number): void;
    id(fn: (node: N) => string): ForceLink<N, L>;
    distance(value: number | ((link: L) => number)): ForceLink<N, L>;
    strength(value: number | ((link: L) => number)): ForceLink<N, L>;
  }

  export function forceLink<N extends SimulationNodeDatum3d, L extends SimulationLinkDatum3d<N>>(
    links: L[],
  ): ForceLink<N, L>;

  export interface ForceManyBody<N> {
    (alpha: number): void;
    strength(value: number | ((node: N) => number)): ForceManyBody<N>;
  }

  export function forceManyBody<N extends SimulationNodeDatum3d>(): ForceManyBody<N>;

  export interface ForceCenter<N> {
    (alpha: number): void;
  }

  export function forceCenter<N extends SimulationNodeDatum3d>(x?: number, y?: number, z?: number): ForceCenter<N>;

  export interface ForceCollide<N> {
    (alpha: number): void;
    radius(value: number | ((node: N) => number)): ForceCollide<N>;
  }

  export function forceCollide<N extends SimulationNodeDatum3d>(radius?: number): ForceCollide<N>;
}
