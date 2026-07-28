/**
 * Lifecycle-resource bookkeeping for Prototype A — backs the harness
 * bridge's `readLifecycleSnapshot()` (charter §13 bench step 9: mount/
 * unmount leak detection) and charter §14's teardown requirement.
 *
 * `renderer.info` gives real geometry/texture/program counts straight from
 * three.js; timers/observers/listeners this prototype itself registers
 * (ResizeObserver, rAF loop, `webglcontextlost`/`restored`) are tracked
 * explicitly here rather than guessed, since three.js has no built-in
 * count for those.
 */
import type * as THREE from "three";

export class ResourceTracker {
  private timerIds = new Set<number>();
  private observers = new Set<{ disconnect(): void }>();
  private listenerCount = 0;

  trackTimer(id: number): number {
    this.timerIds.add(id);
    return id;
  }

  untrackTimer(id: number): void {
    this.timerIds.delete(id);
  }

  trackObserver(observer: { disconnect(): void }): void {
    this.observers.add(observer);
  }

  untrackObserver(observer: { disconnect(): void }): void {
    this.observers.delete(observer);
  }

  addListener(): void {
    this.listenerCount += 1;
  }

  removeListener(): void {
    this.listenerCount = Math.max(0, this.listenerCount - 1);
  }

  disposeAll(): void {
    for (const id of this.timerIds) cancelAnimationFrame(id);
    this.timerIds.clear();
    for (const observer of this.observers) observer.disconnect();
    this.observers.clear();
    this.listenerCount = 0;
  }

  get activeTimerCount(): number {
    return this.timerIds.size;
  }

  get activeObserverCount(): number {
    return this.observers.size;
  }

  get registeredListenerCount(): number {
    return this.listenerCount;
  }
}

export interface LifecycleSnapshotLike {
  cycle: number;
  geometries: number;
  textures: number;
  programs: number;
  activeWorkers: number;
  activeObservers: number;
  activeTimers: number;
  registeredListeners: number;
}

export type LifecycleCountsLike = Omit<LifecycleSnapshotLike, "cycle">;

/**
 * Reads live counts off a specific renderer/tracker pair, with no `cycle`
 * attached (the caller stamps that on). Deliberately takes the concrete
 * `renderer`/`tracker` objects as plain arguments rather than reading them
 * off a ref — see `readLifecycleAccessor()` below for why that distinction
 * is what makes the corrected two-snapshot lifecycle protocol (Stage 2
 * correction lane) actually work: a ref-based read returns zeros the
 * instant the owning ref is nulled by unrelated cleanup code, which is not
 * the same fact as "the renderer's resources were actually released."
 */
export function readLifecycleCounts(renderer: THREE.WebGLRenderer | null, tracker: ResourceTracker | null): LifecycleCountsLike {
  const info = renderer?.info;
  return {
    geometries: info?.memory.geometries ?? 0,
    textures: info?.memory.textures ?? 0,
    programs: info?.programs?.length ?? 0,
    activeWorkers: 0, // Prototype A does not use Web Workers.
    activeObservers: tracker?.activeObserverCount ?? 0,
    activeTimers: tracker?.activeTimerCount ?? 0,
    registeredListeners: tracker?.registeredListenerCount ?? 0,
  };
}

export function readLifecycleSnapshot(
  renderer: THREE.WebGLRenderer | null,
  tracker: ResourceTracker | null,
  cycle: number,
): LifecycleSnapshotLike {
  return { cycle, ...readLifecycleCounts(renderer, tracker) };
}

/**
 * Captures a closure bound to the CONCRETE `renderer`/`tracker` object
 * references at call time (not the refs that hold them). Calling the
 * returned function again later — after `unmount()` has nulled `fgRef`/
 * `trackerRef` and called `renderer.dispose()`/`tracker.disposeAll()` —
 * still reads real, live values off those same still-referenced JS objects:
 * `dispose()` frees GPU/JS resources and, for a correctly-implemented
 * teardown, drives `renderer.info`'s counts and the tracker's own counts
 * back down; it does not make the objects themselves unreadable. This is
 * what lets one accessor produce both the "mounted-settled" and the
 * "post-unmount" snapshot for the same cycle, with no risk of the second
 * read silently defaulting to a stale/unrelated zero just because some
 * OTHER ref (like `fgRef.current`) was cleared in between.
 */
export function readLifecycleAccessor(renderer: THREE.WebGLRenderer | null, tracker: ResourceTracker | null): () => LifecycleCountsLike {
  return () => readLifecycleCounts(renderer, tracker);
}
