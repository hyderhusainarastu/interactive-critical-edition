/**
 * Thin, generalized wrapper around the polite `aria-live` region pattern
 * `ToastProvider.tsx` already established (redesign-shell-spec.md §5.2), for
 * surfaces that need to announce a state change without rendering a toast.
 * Stage 1 uses this for exactly one thing: announcing rail collapse/expand
 * to screen-reader users. An empty message renders nothing, so mounting this
 * unconditionally is safe.
 */
export function LiveRegion({ message, mode = "polite" }: { message: string; mode?: "polite" | "assertive" }) {
  if (!message) return null;
  return (
    <div className="sr-only" role="status" aria-live={mode} aria-atomic="true">
      {message}
    </div>
  );
}
