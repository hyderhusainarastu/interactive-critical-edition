import assert from "node:assert/strict";
import {
  EMPTY_FOREIGN_SPAN_INTERACTION,
  foreignSpanTooltipIsOpen,
  updateForeignSpanInteraction,
} from "./foreignSpanInteraction";

let interaction = EMPTY_FOREIGN_SPAN_INTERACTION;

interaction = updateForeignSpanInteraction(interaction, "pointer-enter");
assert.equal(foreignSpanTooltipIsOpen(interaction), true, "hover opens the tooltip");

interaction = updateForeignSpanInteraction(interaction, "pointer-leave");
assert.equal(foreignSpanTooltipIsOpen(interaction), false, "mouse leave closes an unfocused tooltip");

interaction = updateForeignSpanInteraction(interaction, "focus");
assert.equal(foreignSpanTooltipIsOpen(interaction), true, "keyboard focus opens the tooltip");

interaction = updateForeignSpanInteraction(interaction, "pointer-enter");
interaction = updateForeignSpanInteraction(interaction, "pointer-leave");
assert.equal(foreignSpanTooltipIsOpen(interaction), true, "mouse leave does not close while focus remains");

interaction = updateForeignSpanInteraction(interaction, "blur");
assert.equal(foreignSpanTooltipIsOpen(interaction), false, "blur closes after hover has also ended");

console.log("foreignSpanInteraction.test.ts: all assertions passed");
