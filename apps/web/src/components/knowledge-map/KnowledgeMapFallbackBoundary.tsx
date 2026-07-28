"use client";

/**
 * Charter §14 fallback boundary (spec §5) — the direct fix for the
 * baseline's most severe finding (a WebGL failure used to leave the page
 * with zero graph content anywhere). Distinguishes three failure modes,
 * each with its own honest message, and hands control back to the caller
 * (`KnowledgeMapWorkspace.tsx`) to render the real semantic (List/2D) view
 * in every case — this component never renders graph content itself, it
 * only decides WHETHER the 3D scene mounts and WHY it currently doesn't.
 *
 * 1. **WebGL genuinely unavailable** — probed via a throwaway canvas in a
 *    mount-time effect, well before the real `<ForceGraph3D>` (loaded via
 *    `next/dynamic({ ssr: false })`, an inherently async module load) ever
 *    gets a chance to mount and attempt a real context (spec §5.1); the
 *    probe deliberately does NOT run synchronously in this component's own
 *    initial render (see the `reason` state's own doc comment for why —
 *    short version: `document` doesn't exist during SSR, so probing there
 *    would produce a result that can legitimately disagree with the
 *    client's first render and trigger a hydration mismatch). Either way,
 *    the baseline total-failure (mount attempted, canvas silently produces
 *    nothing, page shows a generic "could not load" screen) cannot recur.
 * 2. **`webglcontextlost` mid-session** (spec §5.2) — `KnowledgeMapScene.tsx`
 *    already does the real DOM listener wiring (`event.preventDefault()`,
 *    cancels its rAF loop) and simply calls the `onContextLost` callback
 *    this boundary hands it; this boundary's only job is to switch away
 *    from 3D and expose a Retry. Per the charter's own explicit either/or,
 *    this spec picks "remain in the semantic fallback until the user
 *    activates Retry" (never auto-reinitializes on `webglcontextrestored`)
 *    — see spec §5.2's reasoning for why that's the more conservative,
 *    provably-correct choice.
 * 3. **Any other mount-time throw** — a real React error boundary
 *    (`componentDidCatch`, necessarily a class — no hooks-only equivalent)
 *    around the scene's own mount point specifically, not the whole
 *    workspace tree, so Toolbar/FilterRail/InspectorDrawer/List/2D keep
 *    working even when only the 3D mount throws.
 *
 * On Retry: re-probes WebGL (a truly-unavailable browser doesn't
 * magically gain WebGL between retries, so Retry still shows the honest
 * "unavailable" message rather than silently trying again forever), then
 * — if available — remounts the scene FRESH under a new key (spec §5.2:
 * "unmounts and remounts KnowledgeMapScene.tsx fresh (not 'resume the dead
 * one')"). Because `children` is a render-prop closing over the caller's
 * OWN current state (context/view/selection/layers/filters/expansion),
 * the fresh mount automatically picks up whatever changed while 3D was
 * down — no separate frozen-at-loss-time snapshot needs to be threaded
 * through this component.
 */
import { Component, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

export type FallbackReason = "webgl-unavailable" | "context-lost" | "scene-error";

export interface FallbackState {
  reason: FallbackReason;
  message: string;
  retry: () => void;
  /** False only for `webgl-unavailable` — there is nothing to retry when
   *  the browser genuinely can't do WebGL (charter: "Provide a visible
   *  Retry where retry is meaningful"). */
  retryMeaningful: boolean;
}

export interface SceneMountHandlers {
  onContextLost: () => void;
  onContextRestored: () => void;
  onInteractive: () => void;
}

export interface KnowledgeMapFallbackBoundaryProps {
  /** Renders the real 3D scene, given the handlers it must wire into
   *  `KnowledgeMapScene`'s own `onContextLost`/`onContextRestored`/
   *  `onInteractive` props. Only called while 3D is actually active. */
  children: (handlers: SceneMountHandlers) => ReactNode;
  /** Renders the semantic fallback (List/2D + a banner) whenever 3D isn't
   *  active. This boundary stays render-agnostic about what "the semantic
   *  view" looks like — the caller owns that, since it already owns the
   *  List/2D components and the caller's own last-chosen non-3D view
   *  preference (spec §5.1: "never silently forcing 2D over List or vice
   *  versa"). */
  renderFallback: (state: FallbackState) => ReactNode;
  /** Reported whenever whether the 3D scene is actually mounted changes —
   *  lets the caller (the toolbar's Focus/Fit/Home controls specifically)
   *  know not to offer camera actions a scene that isn't really there
   *  can't perform, without this boundary needing to know anything about
   *  toolbars. */
  onActiveChange?: (active: boolean) => void;
}

/** Probes WebGL availability via a throwaway, never-attached canvas — the
 *  same technique the Stage 0 baseline audit's own live reproduction used
 *  (spec §5.1), reused here to prove the fix rather than just asserting it.
 *  Exported so `--disable-gpu`/`getContext` override tests (spec §7.3) can
 *  call it directly without mounting a component. */
export function probeWebglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    return Boolean(gl);
  } catch {
    return false;
  }
}

export function messageForReason(reason: FallbackReason): string {
  if (reason === "webgl-unavailable") return "3D view isn’t available in this browser. Showing the List view instead.";
  if (reason === "context-lost") return "The 3D view lost its graphics context. Showing the List view instead.";
  return "The 3D view hit an unexpected error. Showing the List view instead.";
}

interface SceneCrashBoundaryProps {
  onError: () => void;
  children: ReactNode;
}
interface SceneCrashBoundaryState {
  hasError: boolean;
}

/** The real React error boundary (spec §5.3) — wraps ONLY the scene's
 *  render-prop output, so a throw here never takes down the toolbar/rail/
 *  inspector/tray siblings this boundary's own parent also renders. */
class SceneCrashBoundary extends Component<SceneCrashBoundaryProps, SceneCrashBoundaryState> {
  state: SceneCrashBoundaryState = { hasError: false };
  static getDerivedStateFromError(): SceneCrashBoundaryState {
    return { hasError: true };
  }
  componentDidCatch(): void {
    this.props.onError();
  }
  render() {
    // Once caught, render nothing from this subtree — the parent reacts to
    // `onError` by not attempting to render this boundary again until a
    // fresh Retry supplies a new `key`.
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export function KnowledgeMapFallbackBoundary({ children, renderFallback, onActiveChange }: KnowledgeMapFallbackBoundaryProps) {
  // Starts `null` (optimistic — "try the scene") on BOTH the server render
  // and the client's very first render, deliberately NOT probing WebGL in
  // this initializer. `KnowledgeMapScene` is mounted via `next/dynamic`
  // with `ssr: false` (`KnowledgeMapWorkspace.tsx`), which itself renders
  // nothing during SSR and during the client's pre-hydration-settle pass
  // regardless of `reason` — so starting `null` here produces IDENTICAL
  // (empty) output on server and first client render, avoiding a
  // hydration mismatch that probing `document`-dependent WebGL
  // availability inside a `useState` initializer would otherwise cause
  // (server has no `document` at all; a same-tick client probe could
  // legitimately disagree with what the server assumed). The real probe
  // runs in the effect below instead — still well before `next/dynamic`'s
  // own async module load resolves and the real `<ForceGraph3D>` would
  // ever get a chance to call `getContext`, so "never actually attempt a
  // real WebGL context when unavailable" still holds in practice.
  const [reason, setReason] = useState<FallbackReason | null>(null);
  // Bumped on every real Retry so `SceneCrashBoundary` (and the scene
  // inside it) mounts as a genuinely fresh instance — never "resume the
  // dead one" (spec §5.2).
  const [mountKey, setMountKey] = useState(0);

  useEffect(() => {
    // Mount-time probe only — a later real per-session WebGL loss is
    // handled entirely by `onContextLost` below, not by re-running this.
    if (!probeWebglAvailable()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReason("webgl-unavailable");
    }
  }, []);

  const active = reason === null;
  useEffect(() => {
    onActiveChange?.(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const retry = useCallback(() => {
    if (!probeWebglAvailable()) {
      setReason("webgl-unavailable");
      return;
    }
    setReason(null);
    setMountKey((key) => key + 1);
  }, []);

  const onContextLost = useCallback(() => setReason("context-lost"), []);
  // Deliberate no-op (spec §5.2's chosen half of the charter's either/or):
  // `webglcontextrestored` firing does NOT auto-reinitialize the scene —
  // the user must press the visible Retry control this boundary's fallback
  // banner exposes.
  const onContextRestored = useCallback(() => {}, []);
  const onInteractive = useCallback(() => {}, []);

  const handlers = useMemo<SceneMountHandlers>(() => ({ onContextLost, onContextRestored, onInteractive }), [onContextLost, onContextRestored, onInteractive]);

  if (reason !== null) {
    return <>{renderFallback({ reason, message: messageForReason(reason), retry, retryMeaningful: reason !== "webgl-unavailable" })}</>;
  }

  return (
    <SceneCrashBoundary key={mountKey} onError={() => setReason("scene-error")}>
      {children(handlers)}
    </SceneCrashBoundary>
  );
}
