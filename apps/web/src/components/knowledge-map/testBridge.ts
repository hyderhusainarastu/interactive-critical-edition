/**
 * A window-level, read-only test hook the Knowledge Map 3D scene registers
 * itself under (spec §7.3: "expose a window-level test hook from the scene
 * for node projected positions — production-safe, read-only"). Modeled on
 * the Stage 2 bakeoff's own `HarnessBridge`
 * (`prototypes/graph-bakeoff/src/bench/harnessBridge.ts`) — same idea
 * (Playwright talks to the page over CDP, not via module imports, so a
 * `window`-level contract is the only way for a Playwright spec to read
 * live renderer state), narrowed to exactly what the charter §16 browser
 * tests need to query.
 *
 * **Why this is production-safe to ship unconditionally** (not gated
 * behind a build flag): every value it exposes is read-only (no setter, no
 * mutation surface) and is either already visible on screen (a node's
 * projected screen position IS where its label/geometry is actually
 * rendered — this hook does not compute anything a user with a screenshot
 * and a ruler couldn't already determine) or is data the client already
 * holds for its own rendering (node ids, visibility, camera pose — none of
 * it reaches across the owner-scoping boundary; `KnowledgeMapScene` only
 * ever receives the ALREADY-owner-scoped `DisplayNode[]`/`DisplayLink[]`
 * selection the workspace fetched for the signed-in user). No auth
 * bypass, no write path, no PII beyond what the page already renders.
 *
 * One instance of this hook exists per SCENE MOUNT (not per app load) —
 * `mountId` increments every time a fresh `KnowledgeMapScene` instance
 * registers, so a Playwright spec can prove "exactly one new mount
 * happened" after a route remount, a List→3D view switch, or a
 * `webglcontextlost`→Retry cycle (spec §7.3's "no duplicate lifecycle
 * resources" / "repeated mount/unmount cleanup" assertions), without this
 * module needing to know anything about WHY a remount happened.
 */

export const KNOWLEDGE_MAP_TEST_HOOK_KEY = "__knowledgeMapTestHook__" as const;

export interface KnowledgeMapTestHook {
  /** Unique per scene mount instance — increments on every fresh mount, is
   *  removed from `window` on unmount. Never reused across mounts. */
  readonly mountId: number;
  /** True once this mount has satisfied the charter's "interactive"
   *  definition (nonzero canvas, root in-frustum-safe, picking enabled) —
   *  mirrors the bakeoff's own `onInteractive` semantics. A plain boolean
   *  field (not a function) so a Playwright `page.waitForFunction` poll
   *  doesn't need a round trip per check. */
  interactive: boolean;
  /** Screen-space (CSS pixel, `graph2ScreenCoords`-derived) position of a
   *  currently-visible node, or `null` if the node doesn't exist or is
   *  currently hidden by the active filters — the same shape and semantics
   *  as `KnowledgeMapSceneApi.getNodeScreenPosition`, just reachable from
   *  outside the React tree. */
  getNodeScreenPosition(nodeId: string): { x: number; y: number } | null;
  /** Every node id currently part of the topology AND passing the active
   *  attribute filter — the numeric "in-frustum" assertions (spec §7.3)
   *  check every id in this list projects inside `[0, width] x [0,
   *  height]`, not just one hand-picked node. */
  getVisibleNodeIds(): string[];
  /** True iff `nodeId` is part of the current topology and passes the
   *  active attribute filter (mirrors the scene's own `isNodeVisible`). */
  isNodeVisible(nodeId: string): boolean;
  getRootNodeId(): string | null;
  getSelectedId(): string | null;
  /** True once the band-Z layout has fully converged (the same "settling"
   *  -> "banded" -> "frozen" state machine `handleEngineStop` drives,
   *  charter §14 "Freeze the force simulation after convergence") — i.e.
   *  once every node's projected screen position has stopped moving on
   *  its own. `interactive` (above) flips much earlier (as soon as the
   *  canvas has mounted and Home has been applied once) and is
   *  deliberately NOT the same signal: a real pointer click computed
   *  from a node's position while the simulation is still actively
   *  moving it can miss by the time the click actually lands, so any
   *  test driving a real click needs THIS, not `interactive`, as its
   *  readiness gate. */
  isLayoutFrozen(): boolean;
  /** World-space camera position/target, in the same Z-up convention
   *  `@ice/graph-display/camera.ts` uses — lets a spec assert Home/Fit/
   *  Focus/reduced-motion behavior numerically instead of by pixel diff. */
  getCameraPose(): { position: readonly [number, number, number]; target: readonly [number, number, number] };
  /** World-space (not screen-projected) x/y/z of a node currently part of
   *  the topology — diagnostic-grade access to the same coordinates
   *  `getNodeScreenPosition` projects, useful for asserting camera framing
   *  independent of any particular pose. */
  getNodeWorldPosition(nodeId: string): { x: number; y: number; z: number } | null;
}

declare global {
  interface Window {
    [KNOWLEDGE_MAP_TEST_HOOK_KEY]?: KnowledgeMapTestHook;
  }
}

let mountCounter = 0;

/** Allocates the next mount id — called once per `KnowledgeMapScene`
 *  component instance (not per render), so it increments exactly once per
 *  real mount regardless of how many times that instance re-renders. */
export function nextKnowledgeMapMountId(): number {
  mountCounter += 1;
  return mountCounter;
}

export function registerKnowledgeMapTestHook(hook: KnowledgeMapTestHook): void {
  if (typeof window === "undefined") return;
  window[KNOWLEDGE_MAP_TEST_HOOK_KEY] = hook;
}

/** Removes the hook only if it still belongs to THIS mount id — an unmount
 *  racing a newer mount's registration (never expected in production React,
 *  but cheap to guard) must never clear a fresher instance's hook out from
 *  under it. */
export function unregisterKnowledgeMapTestHook(mountId: number): void {
  if (typeof window === "undefined") return;
  if (window[KNOWLEDGE_MAP_TEST_HOOK_KEY]?.mountId === mountId) {
    delete window[KNOWLEDGE_MAP_TEST_HOOK_KEY];
  }
}
