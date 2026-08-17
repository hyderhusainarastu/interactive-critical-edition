import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { canPlaySound, playSound } from "@/lib/sound";

describe("sound", () => {
  // Server/test execution has no WebAudio; calls must stay safe and silent.
  it("stays safe and silent when there is no WebAudio", () => {
    expect(canPlaySound(true)).toBe(false);
    assert.doesNotThrow(() => playSound("click"));
    assert.doesNotThrow(() => playSound("send", false));
  });
});
