/**
 * Prototype A registration point — `App.tsx`'s router imports
 * `createProtoAHandle` from this exact path (`./prototypes/protoA`), so
 * this file stays a thin forwarder to the real implementation rather than
 * moving `App.tsx`'s import (a shared file the bakeoff program rules say
 * not to touch from a single-prototype lane, and which Prototype B's lane
 * mounts through independently). The real scene logic — geometry/color per
 * charter §10, camera per §11, labels, picking/selection/filter/resize,
 * lifecycle teardown — lives in `src/protoA/` (`GraphScene.tsx` +
 * supporting modules), not here.
 */
export { createProtoAHandle } from "../../protoA";
