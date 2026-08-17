export interface ForeignSpanInteraction {
  hovered: boolean;
  focused: boolean;
}

export type ForeignSpanInteractionEvent =
  | "pointer-enter"
  | "pointer-leave"
  | "focus"
  | "blur";

export const EMPTY_FOREIGN_SPAN_INTERACTION: ForeignSpanInteraction = {
  hovered: false,
  focused: false,
};

export function updateForeignSpanInteraction(
  current: ForeignSpanInteraction,
  event: ForeignSpanInteractionEvent,
): ForeignSpanInteraction {
  switch (event) {
    case "pointer-enter":
      return { ...current, hovered: true };
    case "pointer-leave":
      return { ...current, hovered: false };
    case "focus":
      return { ...current, focused: true };
    case "blur":
      return { ...current, focused: false };
  }
}

export function foreignSpanTooltipIsOpen(interaction: ForeignSpanInteraction): boolean {
  return interaction.hovered || interaction.focused;
}
