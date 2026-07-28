export type WriterPanelId = "sources" | "citations";

export interface WidePanelState {
  sources: boolean;
  citations: boolean;
}

/** Both default open — preserves the pre-Stage-6 default exactly (see
 * `readStoredWidePanels` in `WriterEditor.tsx`, which falls back to this
 * shape whenever nothing is stored yet or storage is unavailable). */
export const DEFAULT_WIDE_PANEL_STATE: WidePanelState = { sources: true, citations: true };

/**
 * Given which panel a toggle click targets, returns the next wide-mode
 * state — collapsing/expanding one panel never affects the other. Narrow
 * mode does not call this: it goes straight through `useSecondaryPanel`,
 * which already has its own tested reducer (`secondaryPanelReducer`,
 * Stage 1). This function exists so the *wide* toggle-independently rule
 * has one pure, directly-testable place to live, matching this codebase's
 * existing convention of testing interaction logic as plain functions (see
 * `useFocusTrap.test.ts`'s own comment on why).
 */
export function toggleWidePanel(current: WidePanelState, panel: WriterPanelId): WidePanelState {
  return { ...current, [panel]: !current[panel] };
}
