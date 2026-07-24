import assert from "node:assert/strict";
import { canPlaySound, playSound } from "./sound";

// Server/test execution has no WebAudio; calls must stay safe and silent.
assert.equal(canPlaySound(true), false);
assert.doesNotThrow(() => playSound("click"));
assert.doesNotThrow(() => playSound("send", false));
console.log("sound.test.ts: all assertions passed");
