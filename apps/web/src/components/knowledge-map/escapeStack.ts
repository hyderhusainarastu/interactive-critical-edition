/**
 * Pure ordering for Escape's "close the topmost transient UI first"
 * behavior (charter §11 "Escape closes transient UI before clearing
 * persistent context", spec §4.2's ordered stack: "open filter drawer >
 * open Help > open orientation menu > InspectorDrawer"). The orientation
 * menu is its own self-contained transient surface
 * (`KnowledgeMapToolbar.tsx`'s "More" menu already closes itself on
 * Escape via `useDialogEscape`), so it never needs to appear in this
 * workspace-level stack — only the three surfaces `KnowledgeMapWorkspace`
 * itself owns are ordered here.
 */
export interface WorkspaceTransientUiState {
  filtersOpen: boolean;
  helpOpen: boolean;
  inspectorOpen: boolean;
}

export type WorkspaceTransientUiKind = "filters" | "help" | "inspector";

/** `null` means nothing transient is open — the caller is then in the
 *  "second Escape clears persistent context" branch. */
export function topmostTransientUiKind(state: WorkspaceTransientUiState): WorkspaceTransientUiKind | null {
  if (state.filtersOpen) return "filters";
  if (state.helpOpen) return "help";
  if (state.inspectorOpen) return "inspector";
  return null;
}
