import { useEffect, useRef, useState } from "react";
import { FIXTURE_NAMES, isFixtureName, loadFixture } from "./fixtures";
import type { FixtureName } from "./fixtures/types";
import type { GraphPrototypeHandle } from "./types/prototype";
import type { PrototypeId } from "./types/prototype";
import { clearHarnessBridge, registerHarnessBridge } from "./bench/harnessBridge";
import { createProtoAHandle } from "./prototypes/protoA";
import { createProtoBHandle } from "./prototypes/protoB";

function readQueryParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

function isPrototypeId(value: string | null): value is PrototypeId {
  return value === "a" || value === "b";
}

function createHandle(id: PrototypeId): GraphPrototypeHandle {
  return id === "a" ? createProtoAHandle() : createProtoBHandle();
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
    const handle = createHandle(prototypeId);
    handleRef.current = handle;

    setStatus("mounting");
    let cancelled = false;

    handle
      .mount(containerRef.current, fixture, {
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
        registerHarnessBridge({
          ready: true,
          prototypeId,
          fixtureName,
          fixtureContentHash: fixture.contentHash,
          handle,
          getNodeScreenPosition: () => null, // wired by the real prototype implementation
          isHighlightConfirmed: () => false, // wired by the real prototype implementation
          readLifecycleSnapshot: (cycle) => ({
            cycle,
            geometries: 0,
            textures: 0,
            programs: 0,
            activeWorkers: 0,
            activeObservers: 0,
            activeTimers: 0,
            registeredListeners: 0,
          }),
          payloadReceivedAtMs: null,
          interactiveAtMs: null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      clearHarnessBridge();
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
