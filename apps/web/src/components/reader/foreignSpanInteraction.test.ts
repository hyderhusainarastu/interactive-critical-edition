import { describe, expect, it } from "vitest";
import {
  EMPTY_FOREIGN_SPAN_INTERACTION,
  foreignSpanTooltipIsOpen,
  updateForeignSpanInteraction,
} from "./foreignSpanInteraction";

describe("foreignSpanInteraction", () => {
  // One sequential scenario: each step builds on the interaction state the
  // previous step produced, so these assertions must stay in this order and
  // in a single block.
  it("opens and closes the tooltip across a hover/focus/blur sequence", () => {
    let interaction = EMPTY_FOREIGN_SPAN_INTERACTION;

    interaction = updateForeignSpanInteraction(interaction, "pointer-enter");
    // "hover opens the tooltip"
    expect(foreignSpanTooltipIsOpen(interaction)).toBe(true);

    interaction = updateForeignSpanInteraction(interaction, "pointer-leave");
    // "mouse leave closes an unfocused tooltip"
    expect(foreignSpanTooltipIsOpen(interaction)).toBe(false);

    interaction = updateForeignSpanInteraction(interaction, "focus");
    // "keyboard focus opens the tooltip"
    expect(foreignSpanTooltipIsOpen(interaction)).toBe(true);

    interaction = updateForeignSpanInteraction(interaction, "pointer-enter");
    interaction = updateForeignSpanInteraction(interaction, "pointer-leave");
    // "mouse leave does not close while focus remains"
    expect(foreignSpanTooltipIsOpen(interaction)).toBe(true);

    interaction = updateForeignSpanInteraction(interaction, "blur");
    // "blur closes after hover has also ended"
    expect(foreignSpanTooltipIsOpen(interaction)).toBe(false);
  });
});
