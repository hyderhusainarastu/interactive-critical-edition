import { useEffect, useRef, useState } from "react";
import { FIXTURE_NAMES, isFixtureName, loadFixture } from "./fixtures";
import type { FixtureName } from "./fixtures/types";
import type { GraphPrototypeHandle } from "./types/prototype";
import type { PrototypeId } from "./types/prototype";
import { clearHarnessBridge, registerHarnessBridge } from "./bench/harnessBridge";
import { BENCH_PROTOCOL, type LifecycleSnapshot, type LifecycleSnapshotPair } from "./bench/types";
import { createProtoAHandle } from "./prototypes/protoA";

/**
 * `GraphPrototypeHandle` (the frozen shared bench contract) has no slot for
 * the bench's `getNodeScreenPosition`/`isHighlightConfirmed`/
 * `readLifecycleSnapshot` — see `src/protoA/index.tsx`'s `ProtoAHandle` and
 * `src/prototypes/protoB/index.tsx`'s `ProtoBHandle`, which both implement
 * this exact superset already. This type/guard let the router read those
 * three real accessors off whichever concrete handle is actually mounted,
 * without either prototype's module importing across the isolation
 * boundary into the other, and without this shared file importing either
 * prototype's own extended-handle type (it only needs the shape).
 */
interface BenchInstrumentedHandle extends GraphPrototypeHandle {
  getNodeScreenPosition(nodeId: string): { x: number; y: number } | null;
  isHighlightConfirmed(nodeId: string): boolean;
  readLifecycleSnapshot(cycle: number): LifecycleSnapshot;
  /** Stage 2 correction-lane addition — see `src/protoA/lifecycle.ts`'s
   * `readLifecycleAccessor()` doc comment for why this is a distinct method
   * from `readLifecycleSnapshot` rather than a parameter on it. */
  captureLifecycleAccessor(): (() => Omit<LifecycleSnapshot, "cycle">) | null;
}

function isBenchInstrumented(handle: GraphPrototypeHandle): handle is BenchInstrumentedHandle {
  const candidate = handle as Partial<BenchInstrumentedHandle>;
  return (
    typeof candidate.getNodeScreenPosition === "function" &&
    typeof candidate.isHighlightConfirmed === "function" &&
    typeof candidate.readLifecycleSnapshot === "function" &&
    typeof candidate.captureLifecycleAccessor === "function"
  );
}

function readQueryParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

function isPrototypeId(value: string | null): value is PrototypeId {
  return value === "a" || value === "b";
}

/**
 * Stage 2 CORRECTION lane, rule 9 enforcement: the corrected bakeoff
 * decision (see docs/audits/graph-renderer-bakeoff.md's Correction
 * addendum) selected Prototype A; Prototype B's implementation
 * (`src/prototypes/protoB/`) has been removed from this branch (still
 * recoverable from git history, commit `1f26096`). `PrototypeId` itself
 * is left as `"a" | "b"` (still used structurally by
 * `src/bench/runner.ts`/`scripts/run-bench.ts`/`e2e/bench.spec.ts` — see
 * the addendum's §C.7 scope note), so this throws a clear, documented
 * error instead of either silently importing a module that no longer
 * exists (which would break typecheck) or silently falling back to
 * Prototype A for a `"b"` request (which would misreport what was
 * actually mounted).
 */
function createHandle(id: PrototypeId): GraphPrototypeHandle {
  if (id === "b") {
    throw new Error(
      "Prototype B was removed per charter §13 rule 9 after the Stage 2 correction lane's re-decision " +
        "(docs/audits/graph-renderer-bakeoff.md's Correction addendum selected Prototype A). " +
        "Prototype B remains recoverable from git history (commit 1f26096).",
    );
  }
  return createProtoAHandle();
}

const EMPTY_LIFECYCLE_SNAPSHOT_FOR = (cycle: number): LifecycleSnapshot => ({
  cycle,
  geometries: 0,
  textures: 0,
  programs: 0,
  activeWorkers: 0,
  activeObservers: 0,
  activeTimers: 0,
  registeredListeners: 0,
});

/**
 * Window-level control surface for the charter §13 bench step 9 lifecycle
 * check (20 mount/unmount cycles, compared for leaked geometries/textures/
 * programs/workers/observers/timers/listeners). `App.tsx`'s own mount
 * effect only ever mounts once per `(proto, fixture)` query-param pair (by
 * design — this is a router, not a re-orchestrator), so there was
 * previously no way for the bench driver to run repeated in-page mount/
 * unmount cycles without a full page reload per cycle, which would reset
 * the WebGL renderer's own `renderer.info` counters every time and defeat
 * the leak check entirely (always reading a fresh zero, never able to
 * observe accumulation across cycles). `remountCycle()` fixes that
 * minimal gap: it tears down the currently mounted handle and mounts a
 * fresh one into the same container, in the same page/renderer-info
 * session, and returns the resource snapshot taken the instant before
 * that teardown — the last live reading of what that cycle's mount was
 * holding. (Both prototypes null their internal API ref on `unmount()`,
 * so a snapshot taken strictly *after* `unmount()` returns would always
 * read all-zero — no signal at all; the pre-teardown reading is the
 * closest honest measurement of "did the previous cycle's resources
 * actually get released" that these prototypes' current instrumentation
 * supports, and growth in that number cycle-over-cycle is exactly the
 * leak signature the charter's decision rule cares about.)
 */
interface LifecycleControl {
  remountCycle(cycle: number): Promise<LifecycleSnapshot>;
}

/**
 * Corrected v2 lifecycle control surface (Stage 2 CORRECTION lane,
 * 2026-07-27/28). `remountCycle()` above reads whichever mount happens to
 * be "current" at an ambiguous instant relative to that mount's own first
 * rendered frame and relative to the NEXT cycle's teardown — see
 * `docs/audits/graph-renderer-bakeoff.md`'s Correction addendum for the
 * full diagnosis (Prototype A's per-cycle reads alternated between the
 * settled-mounted numbers and all-zero, not because of a leak, but because
 * nothing guaranteed a frame had actually rendered by read time, and the
 * read was of a *different* mount than the one about to be torn down).
 *
 * `runCorrectedCycle()` fixes this by making each cycle fully
 * self-contained and unambiguous:
 *   1. Unmount whatever's currently mounted (harmless no-op on the very
 *      first call, when only the router's own initial auto-mount exists).
 *   2. Mount a fresh handle, wait for "interactive".
 *   3. Settle: wait `LIFECYCLE_MOUNT_SETTLE_FRAMES` real animation frames
 *      (guarantees actual `renderer.render()` calls have happened, not
 *      just that the scene *reported* ready) plus a fixed
 *      `LIFECYCLE_MOUNT_SETTLE_MS` buffer.
 *   4. Capture a **live, non-cached** accessor bound to this mount's
 *      concrete renderer/tracker objects (`captureLifecycleAccessor()` —
 *      see `src/protoA/lifecycle.ts`), and read it: `mountedSettled`.
 *   5. Unmount.
 *   6. Settle: wait `LIFECYCLE_UNMOUNT_SETTLE_MS`.
 *   7. Re-invoke the SAME accessor (not a fresh one) — a genuine
 *      "did this mount's resources actually return to rest" reading,
 *      immune to any OTHER ref being nulled by unrelated cleanup code:
 *      `postUnmount`.
 * Both readings are real-time; neither is fabricated or interpolated.
 */
interface LifecycleControlV2 {
  runCorrectedCycle(cycle: number): Promise<LifecycleSnapshotPair>;
}

declare global {
  interface Window {
    __graphBakeoffLifecycle?: LifecycleControl;
    __graphBakeoffLifecycleV2?: LifecycleControlV2;
  }
}

/** Waits through `count` real `requestAnimationFrame` callbacks. Used only
 * by the corrected v2 lifecycle protocol to guarantee actual render passes
 * have happened before reading `renderer.info`, rather than trusting that
 * a scene's own "interactive" report implies a frame was already drawn. */
function waitAnimationFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let remaining = count;
    function tick() {
      remaining -= 1;
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const EMPTY_LIFECYCLE_COUNTS: Omit<LifecycleSnapshot, "cycle"> = {
  geometries: 0,
  textures: 0,
  programs: 0,
  activeWorkers: 0,
  activeObservers: 0,
  activeTimers: 0,
  registeredListeners: 0,
};

/**
 * Entry page for the isolated renderer-bakeoff harness. Routes
 * `?proto=a|b&fixture=<name>` to the matching prototype + frozen fixture,
 * mounts it via the shared `GraphPrototypeHandle` interface, and registers
 * the window-level harness bridge the Playwright bench driver polls for.
 *
 * This is deliberately just a router + mount point — no bakeoff UI chrome,
 * no comparison view, no scoring. See `docs/handoffs/...` (future) for the
 * bakeoff report; this app exists to be driven by the bench runner and by
 * a human spot-checking a single prototype+fixture combination.
 */
export function App() {
  const [protoParam] = useState(() => readQueryParam("proto"));
  const [fixtureParam] = useState(() => readQueryParam("fixture"));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<GraphPrototypeHandle | null>(null);
  const [status, setStatus] = useState<"idle" | "mounting" | "ready" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isPrototypeId(protoParam)) {
      setStatus("error");
      setErrorMessage(`Missing or invalid ?proto= — expected "a" or "b", got ${JSON.stringify(protoParam)}.`);
      return;
    }
    if (!isFixtureName(fixtureParam)) {
      setStatus("error");
      setErrorMessage(
        `Missing or invalid ?fixture= — expected one of ${FIXTURE_NAMES.join(", ")}, got ${JSON.stringify(fixtureParam)}.`,
      );
      return;
    }
    if (!containerRef.current) return;

    const prototypeId = protoParam;
    const fixtureName: FixtureName = fixtureParam;
    const fixture = loadFixture(fixtureName);
    let cancelled = false;

    function mountOnce(handle: GraphPrototypeHandle): Promise<void> {
      return handle
        .mount(containerRef.current!, fixture, {
          onPayloadReceived: () => {
            const bridge = window.__graphBakeoffHarness;
            if (bridge) bridge.payloadReceivedAtMs = performance.now();
          },
          onInteractive: () => {
            if (cancelled) return;
            const bridge = window.__graphBakeoffHarness;
            if (bridge) bridge.interactiveAtMs = performance.now();
            setStatus("ready");
          },
        })
        .then(() => {
          if (cancelled) return;
          // Real per-prototype accessors when the mounted handle implements
          // the bench-instrumented superset (both Prototype A and B do —
          // see the module doc comment above); an all-zero/never-confirmed
          // fallback otherwise, so an intentionally minimal future prototype
          // still boots instead of throwing, but is never silently measured
          // as if it were instrumented.
          const instrumented = isBenchInstrumented(handle) ? handle : null;
          registerHarnessBridge({
            ready: true,
            prototypeId,
            fixtureName,
            fixtureContentHash: fixture.contentHash,
            handle,
            getNodeScreenPosition: (nodeId) => instrumented?.getNodeScreenPosition(nodeId) ?? null,
            isHighlightConfirmed: (nodeId) => instrumented?.isHighlightConfirmed(nodeId) ?? false,
            readLifecycleSnapshot: (cycle) => instrumented?.readLifecycleSnapshot(cycle) ?? EMPTY_LIFECYCLE_SNAPSHOT_FOR(cycle),
            payloadReceivedAtMs: null,
            interactiveAtMs: null,
          });
        });
    }

    const initialHandle = createHandle(prototypeId);
    handleRef.current = initialHandle;
    setStatus("mounting");

    mountOnce(initialHandle).catch((err: unknown) => {
      if (cancelled) return;
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    });

    window.__graphBakeoffLifecycle = {
      async remountCycle(cycle: number): Promise<LifecycleSnapshot> {
        const current = handleRef.current;
        const instrumented = current && isBenchInstrumented(current) ? current : null;
        const snapshot = instrumented?.readLifecycleSnapshot(cycle) ?? EMPTY_LIFECYCLE_SNAPSHOT_FOR(cycle);
        current?.unmount();
        clearHarnessBridge();
        const fresh = createHandle(prototypeId);
        handleRef.current = fresh;
        setStatus("mounting");
        await mountOnce(fresh);
        return snapshot;
      },
    };

    window.__graphBakeoffLifecycleV2 = {
      async runCorrectedCycle(cycle: number): Promise<LifecycleSnapshotPair> {
        // 1. Clean slate — unmount whatever's currently mounted. On the
        // very first call this is the router's own initial auto-mount
        // (above); on every later call it's a no-op, since step 5 below
        // always unmounts before this function returns.
        handleRef.current?.unmount();
        handleRef.current = null;
        clearHarnessBridge();

        // 2. Fresh mount, wait for "interactive".
        const handle = createHandle(prototypeId);
        handleRef.current = handle;
        setStatus("mounting");
        await mountOnce(handle);

        // 3. Settle: real rendered frames + a fixed buffer, so the
        // mounted-settled read isn't racing the first draw call.
        await waitAnimationFrames(BENCH_PROTOCOL.LIFECYCLE_MOUNT_SETTLE_FRAMES);
        await delay(BENCH_PROTOCOL.LIFECYCLE_MOUNT_SETTLE_MS);

        // 4. Live, non-cached accessor bound to THIS mount's concrete
        // renderer/tracker objects — safe to call again after unmount.
        const instrumented = isBenchInstrumented(handle) ? handle : null;
        const accessor = instrumented?.captureLifecycleAccessor() ?? (() => EMPTY_LIFECYCLE_COUNTS);
        const mountedSettled: LifecycleSnapshot = { cycle, ...accessor() };

        // 5. Unmount.
        handle.unmount();
        clearHarnessBridge();
        handleRef.current = null;

        // 6. Settle: fixed delay for any deferred/async teardown to finish.
        await delay(BENCH_PROTOCOL.LIFECYCLE_UNMOUNT_SETTLE_MS);

        // 7. Re-invoke the SAME accessor — a genuine post-disposal reading.
        const postUnmount: LifecycleSnapshot = { cycle, ...accessor() };

        return { cycle, mountedSettled, postUnmount };
      },
    };

    return () => {
      cancelled = true;
      clearHarnessBridge();
      delete window.__graphBakeoffLifecycle;
      delete window.__graphBakeoffLifecycleV2;
      handleRef.current?.unmount();
      handleRef.current = null;
    };
  }, [protoParam, fixtureParam]);

  if (status === "error") {
    return (
      <div style={{ color: "#E0A3AC", fontFamily: "sans-serif", padding: 24 }}>
        <h1>Graph bakeoff harness — configuration error</h1>
        <p>{errorMessage}</p>
        <p>
          Try, e.g.: <code>?proto=a&amp;fixture=fixture-24</code>
        </p>
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", width: "100vw", background: "#0B1020" }}>
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} data-status={status} />
    </div>
  );
}
