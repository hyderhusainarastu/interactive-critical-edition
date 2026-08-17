import { describe, expect, it } from "vitest";
import { topmostTransientUiKind } from "./escapeStack";

describe("topmostTransientUiKind", () => {
  it("returns null when nothing transient is open", () => {
    expect(topmostTransientUiKind({ filtersOpen: false, helpOpen: false, inspectorOpen: false })).toBe(null);
  });

  it("filters wins over everything", () => {
    expect(topmostTransientUiKind({ filtersOpen: true, helpOpen: true, inspectorOpen: true })).toBe("filters");
  });

  it("help wins over inspector", () => {
    expect(topmostTransientUiKind({ filtersOpen: false, helpOpen: true, inspectorOpen: true })).toBe("help");
  });

  it("inspector is the last resort", () => {
    expect(topmostTransientUiKind({ filtersOpen: false, helpOpen: false, inspectorOpen: true })).toBe("inspector");
  });
});
