/**
 * Item 3's a11y requirement: "Live-region announce major transitions
 * (running→complete) politely." A single persistent, visually-hidden
 * `role="status"`/`aria-live="polite"` node — screen readers only announce a
 * change when the CONTENT of an already-present live region changes, so the
 * node itself must never unmount/remount (unlike the visible status text
 * elsewhere on these pages, which does come and go).
 */
export function LiveAnnouncer({ message }: { message: string }) {
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}
