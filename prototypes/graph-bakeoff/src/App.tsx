import { useEffect, useRef, useState } from "react";
import { FIXTURE_NAMES, isFixtureName, loadFixture } from "./fixtures";
import type { FixtureName } from "./fixtures/types";
import type { GraphPrototypeHandle } from "./types/prototype";
import type { PrototypeId } from "./types/prototype";
import { clearHarnessBridge, registerHarnessBridge } from "./bench/harnessBridge";
import type { LifecycleSnapshot } from "./bench/types";
import { createProtoAHandle } from "./prototypes/protoA";
import { createProtoBHandle } from "./prototypes/protoB";

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
}

function isBenchInstrumented(handle: GraphPrototypeHandle): handle is BenchInstrumentedHandle {
  const candidate = handle as Partial<BenchInstrumentedHandle>;
  return (
    typeof candidate.getNodeScreenPosition === "function" &&
    typeof candidate.isHighlightConfirmed === "function" &&
    typeof candidate.readLifecycleSnapshot === "function"
  );
}

function readQueryParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

function isPrototypeId(value: string | null): value is PrototypeId {
  return value === "a" || value === "b";
}

function createHandle(id: PrototypeId): GraphPrototypeHandle {
  return id === "a" ? createProtoAHandle() : createProtoBHandle();
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

declare global {
  interface Window {
    __graphBakeoffLifecycle?: LifecycleControl;
  }
}

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

    return () => {
      cancelled = true;
      clearHarnessBridge();
      delete window.__graphBakeoffLifecycle;
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
