/**
 * Integration step "writer-insertion-dialogs" (charter §6 "Write":
 * "Context-preserving insertion from Library, Research, Reader, and
 * Knowledge Map" — the Reader/Knowledge Map half was explicitly deferred by
 * stage6-write-spec.md §11 to "whichever lane owns [this] integration
 * pass"). A cross-ROUTE handoff, not a cross-component one: the user clicks
 * "Insert into Writer" from the Reader's Claims tab or the Knowledge Map
 * inspector, picks/creates a target Writer project, and is navigated to
 * `/writer/[projectId]` — a full route change, so nothing survives in
 * React state across it. `sessionStorage` (not `localStorage`, which would
 * leak the pending insertion to a later, unrelated tab) is the same
 * technique class `WriterEditor.tsx` already uses for its own cross-remount
 * handoff (`activeDocSessionKey`, Stage 6 spec §4.3) — self-cleaning
 * (removed the instant it's read) so a stray reload or an unrelated later
 * visit to the SAME project never replays a stale insertion.
 *
 * Deliberately real, never fabricated content: every caller of
 * `storePendingWriterInsertion` supplies a `quote` that already exists on
 * data that caller is authorized to read (a claim's own
 * `supportingExcerpt`/label) — this module only carries it, never invents
 * it.
 */

export interface WriterInsertionPayload {
  /** Guards against applying a stale/mismatched handoff to the wrong
   *  project — e.g. the user opens a second, unrelated Writer project in
   *  another tab before this handoff is consumed. */
  projectId: string;
  /** The real, already-fetched excerpt to insert. */
  quote: string;
  /** Short, honest description of what the quote is and where it came
   *  from — never a fabricated citation (no invented author/year/DOI). */
  attribution: string;
  /** Where to send the user back to keep the round trip reversible
   *  (charter §16 journey 5: "with reversible navigation") — captured as
   *  the literal `window.location.href` at click time, which already
   *  encodes the Reader's reading position or the Knowledge Map's exact
   *  restorable context/selection/view state (charter §9), so this needs
   *  no bespoke reconstruction logic of its own. */
  sourceHref: string;
  /** Which surface this came from, purely for the post-insertion notice's
   *  own copy ("Inserted from Reader" / "Inserted from Knowledge Map"). */
  sourceLabel: "Reader" | "Knowledge Map";
}

const STORAGE_KEY = "palimnote:writer-insertion";

/**
 * Pure shape/ownership check, factored out so it's directly unit-testable
 * without a `window`/DOM (this codebase's established convention — see
 * `useDocumentBroadcast.ts`'s `shouldShowCrossTabConflict` for the same
 * "extract the pure predicate, test it directly" pattern). Guards against
 * both a malformed stored value (an older payload shape, or storage
 * tampered with by another script) and a stale/mismatched handoff (the
 * payload names a different project than the one currently open).
 */
export function isValidWriterInsertionPayload(candidate: unknown, currentProjectId: string): candidate is WriterInsertionPayload {
  if (!candidate || typeof candidate !== "object") return false;
  const value = candidate as Partial<WriterInsertionPayload>;
  return (
    typeof value.projectId === "string" &&
    value.projectId === currentProjectId &&
    typeof value.quote === "string" &&
    typeof value.attribution === "string" &&
    typeof value.sourceHref === "string" &&
    (value.sourceLabel === "Reader" || value.sourceLabel === "Knowledge Map")
  );
}

/** Best-effort — a `sessionStorage` write failure (private browsing, quota)
 *  just means the handoff silently doesn't happen; the button itself still
 *  navigates, so the user lands on the right project either way, just
 *  without the pre-filled excerpt. Never throws. */
export function storePendingWriterInsertion(payload: WriterInsertionPayload) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* best-effort only */
  }
}

/** Reads and immediately clears the pending handoff — a second call (e.g. a
 *  React effect firing twice under Strict Mode) always returns `null`,
 *  which is the correct "already applied" answer, not an error. Returns
 *  `null` (never applies a stale handoff) when the stored payload names a
 *  different project than the one currently open. */
export function takePendingWriterInsertion(currentProjectId: string): WriterInsertionPayload | null {
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* best-effort only */
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isValidWriterInsertionPayload(parsed, currentProjectId) ? parsed : null;
}

/**
 * Pure formatting — a plain, attributed excerpt string, matching the same
 * plain-text-append mechanic `WriterEditor.tsx`'s own `insertCitation`
 * already uses (this editor is a plain textarea, not a rich ProseMirror
 * view — see that function's own precedent). Deliberately NOT the
 * DB-transactional structured-blockquote mechanism the in-Writer Evidence
 * panel uses (`insertEvidence`), since that requires the target Writer
 * project to already be linked to the SAME Research project the claim came
 * from — a precondition this cross-surface handoff has no way to guarantee
 * (the user may pick or create an unlinked project). This is a documented,
 * deliberate scope choice, not an oversight: a plain, honestly-attributed
 * excerpt that always works, rather than a structured insert that only
 * sometimes would.
 */
export function formatInsertionExcerpt(payload: Pick<WriterInsertionPayload, "quote" | "attribution">): string {
  return `“${payload.quote.trim()}” (${payload.attribution.trim()})`;
}
