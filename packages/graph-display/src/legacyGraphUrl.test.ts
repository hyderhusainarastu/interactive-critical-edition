import { describe, expect, it } from "vitest";
import { toDisplayNodeId } from "./ids";
import type { LegacyTranslationValidators } from "./legacyGraphUrl";
import { translateLegacyGraphUrl } from "./legacyGraphUrl";

const KNOWN_WORK_IDS = new Set(["w1", "w2", "w3"]);
const KNOWN_SELECTED_IDS = new Set(["node-1"]);

const permissiveValidators: LegacyTranslationValidators = {
  checkWorkId: (id) => (KNOWN_WORK_IDS.has(id) ? null : "not_found"),
  checkSelectedId: (id) => (KNOWN_SELECTED_IDS.has(String(id)) ? null : "unauthorized"),
};

function p(init: Record<string, string | string[]>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(init)) {
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v);
    } else {
      params.set(key, value);
    }
  }
  return params;
}

describe("compat table row: layout=explore", () => {
  it("with no anchor at all -> context chooser, preferred view 3d", () => {
    const result = translateLegacyGraphUrl(p({ layout: "explore" }), permissiveValidators);
    expect(result.kind).toBe("chooser");
    if (result.kind === "chooser") {
      expect(result.chooserFor).toBe("context");
      expect(result.notice).toBeNull();
      expect(result.partial.view).toBe("3d");
    }
  });

  it("combined with a single valid pinnedWork -> a ready state anchored to that work, view=3d", () => {
    const result = translateLegacyGraphUrl(p({ layout: "explore", pinnedWork: "work:w1" }), permissiveValidators);
    expect(result.kind).toBe("state");
    if (result.kind === "state") {
      expect(result.state.context).toEqual({ kind: "work", id: "w1" });
      expect(result.state.view).toBe("3d");
    }
  });
});

describe("compat table row: explicit layout=roadmap, or roadmapRoot under the old implicit default", () => {
  it("explicit layout=roadmap with one valid root -> redirect", () => {
    const result = translateLegacyGraphUrl(p({ layout: "roadmap", roadmapRoot: "work:w1" }), permissiveValidators);
    expect(result.kind).toBe("redirect");
    if (result.kind === "redirect") expect(result.to).toBe("/works/w1/roadmap");
  });

  it("no explicit layout, but roadmapRoot present (old implicit default) with one valid root -> redirect", () => {
    const result = translateLegacyGraphUrl(p({ roadmapRoot: "work:w1" }), permissiveValidators);
    expect(result.kind).toBe("redirect");
    if (result.kind === "redirect") expect(result.to).toBe("/works/w1/roadmap");
  });

  it("layout=explore explicitly overrides an accompanying roadmapRoot's implicit-default interpretation", () => {
    // layout is explicitly "explore", not absent — so this is NOT "the old
    // implicit default" case; roadmapRoot alone shouldn't force a Roadmap
    // redirect out from under an explicit Explore choice.
    const result = translateLegacyGraphUrl(p({ layout: "explore", roadmapRoot: "work:w1" }), permissiveValidators);
    expect(result.kind).not.toBe("redirect");
  });
});

describe("compat table row: one valid roadmapRoot", () => {
  it("redirects to /works/<id>/roadmap, preserving readerLevel/stage/readingThread state", () => {
    const params = p({
      roadmapRoot: "work:w2",
      readerLevel: "advanced",
      stage: "evaluation",
      readingThread: "1",
    });
    const result = translateLegacyGraphUrl(params, permissiveValidators);
    expect(result.kind).toBe("redirect");
    if (result.kind === "redirect") {
      const url = new URL(result.to, "https://example.test");
      expect(url.pathname).toBe("/works/w2/roadmap");
      expect(url.searchParams.get("readerLevel")).toBe("advanced");
      expect(url.searchParams.get("stage")).toBe("evaluation");
      expect(url.searchParams.get("readingThread")).toBe("1");
    }
  });

  it("accepts a roadmapRoot value with no work: prefix too (defensive, never throws)", () => {
    const result = translateLegacyGraphUrl(p({ roadmapRoot: "w1" }), permissiveValidators);
    expect(result.kind).toBe("redirect");
    if (result.kind === "redirect") expect(result.to).toBe("/works/w1/roadmap");
  });
});

describe("compat table row: multiple valid roadmapRoot values", () => {
  it("opens a roadmapRoots chooser with all valid roots preselected", () => {
    const result = translateLegacyGraphUrl(
      p({ roadmapRoot: ["work:w1", "work:w2"] }),
      permissiveValidators,
    );
    expect(result.kind).toBe("chooser");
    if (result.kind === "chooser") {
      expect(result.chooserFor).toBe("roadmapRoots");
      expect(result.candidateRoots.sort()).toEqual(["w1", "w2"]);
      expect(result.notice).toBeNull();
    }
  });
});

describe("compat table row: invalid or absent roadmap root in an explicit legacy Roadmap URL", () => {
  it("layout=roadmap with no roadmapRoot at all -> chooser with an explanatory notice", () => {
    const result = translateLegacyGraphUrl(p({ layout: "roadmap" }), permissiveValidators);
    expect(result.kind).toBe("chooser");
    if (result.kind === "chooser") {
      expect(result.chooserFor).toBe("roadmapRoots");
      expect(result.candidateRoots).toEqual([]);
      expect(result.notice).not.toBeNull();
    }
  });

  it("layout=roadmap with only an invalid/junk roadmapRoot -> chooser with a notice, and the junk id is reported omitted", () => {
    const result = translateLegacyGraphUrl(
      p({ layout: "roadmap", roadmapRoot: "work:not-a-real-work-uuid" }),
      permissiveValidators,
    );
    expect(result.kind).toBe("chooser");
    if (result.kind === "chooser") {
      expect(result.notice).not.toBeNull();
      expect(result.omitted).toEqual([
        { value: "work:not-a-real-work-uuid", reason: "not_found", source: "roadmapRoot" },
      ]);
    }
  });
});

describe("compat table row: repeated pinnedWork", () => {
  it("one valid value -> an anchored work context state", () => {
    const result = translateLegacyGraphUrl(p({ pinnedWork: "work:w3" }), permissiveValidators);
    expect(result.kind).toBe("state");
    if (result.kind === "state") {
      expect(result.state.context).toEqual({ kind: "work", id: "w3" });
    }
  });

  it("multiple valid values -> a preselected pinnedWork chooser, never a silent pick", () => {
    const result = translateLegacyGraphUrl(p({ pinnedWork: ["work:w1", "work:w3"] }), permissiveValidators);
    expect(result.kind).toBe("chooser");
    if (result.kind === "chooser") {
      expect(result.chooserFor).toBe("pinnedWork");
      expect(result.candidateRoots.sort()).toEqual(["w1", "w3"]);
    }
  });

  it("every pinnedWork value invalid -> falls through to the general context chooser, reporting each omission", () => {
    const result = translateLegacyGraphUrl(p({ pinnedWork: "work:ghost-id" }), permissiveValidators);
    expect(result.kind).toBe("chooser");
    if (result.kind === "chooser") {
      expect(result.chooserFor).toBe("context");
      expect(result.omitted).toEqual([{ value: "work:ghost-id", reason: "not_found", source: "pinnedWork" }]);
    }
  });
});

describe("compat table row: readingThread=1", () => {
  it("restores the reading-path focus state", () => {
    const result = translateLegacyGraphUrl(p({ readingThread: "1", pinnedWork: "work:w1" }), permissiveValidators);
    expect(result.kind).toBe("state");
    if (result.kind === "state") expect(result.state.focus).toBe("readingPath");
  });

  it("takes precedence over an accompanying focusMode", () => {
    const result = translateLegacyGraphUrl(
      p({ readingThread: "1", focusMode: "full", pinnedWork: "work:w1" }),
      permissiveValidators,
    );
    if (result.kind === "state") expect(result.state.focus).toBe("readingPath");
  });
});

describe("compat table row: focusMode values", () => {
  const cases: Array<[string, string]> = [
    ["focus", "neighborhood"],
    ["expand", "expand2"],
    ["full", "all"],
    ["concepts", "concepts"],
  ];

  for (const [legacy, expected] of cases) {
    it(`focusMode=${legacy} -> focus=${expected}`, () => {
      const result = translateLegacyGraphUrl(p({ focusMode: legacy, pinnedWork: "work:w1" }), permissiveValidators);
      expect(result.kind).toBe("state");
      if (result.kind === "state") expect(result.state.focus).toBe(expected);
    });
  }

  it("an unrecognized focusMode value falls back to the default focus and is reported omitted", () => {
    const result = translateLegacyGraphUrl(p({ focusMode: "orbit-mode" }), permissiveValidators);
    expect(result.kind).toBe("chooser");
    if (result.kind === "chooser") {
      expect(result.partial.focus).toBe("all");
      expect(result.omitted).toContainEqual({ value: "orbit-mode", reason: "invalid", source: "focusMode" });
    }
  });
});

describe("compat table row: selected", () => {
  it("restores an authorized/visible selection", () => {
    const result = translateLegacyGraphUrl(p({ selected: "node-1" }), permissiveValidators);
    expect(result.kind).toBe("chooser");
    if (result.kind === "chooser") expect(String(result.partial.selectedId)).toBe("node-1");
  });

  it("announces (via omitted) why an unauthorized/invisible selection was dropped, rather than restoring it", () => {
    const result = translateLegacyGraphUrl(p({ selected: "some-junk-node-id" }), permissiveValidators);
    expect(result.kind).toBe("chooser");
    if (result.kind === "chooser") {
      expect(result.partial.selectedId).toBeNull();
      expect(result.omitted).toContainEqual({ value: "some-junk-node-id", reason: "unauthorized", source: "selected" });
    }
  });
});

describe("compat table row: filter params translate losslessly", () => {
  it("carries every known filter key through unchanged", () => {
    const filterParams = {
      search: "vico",
      state: "unread",
      type: "concept",
      authority: "A",
      provider: "crossref",
      relation: "cites",
      credibilityBand: "high",
      associatedWork: "w1",
      stage: "evaluation",
      readerLevel: "advanced",
      conceptKind: "doctrine",
    };
    const result = translateLegacyGraphUrl(p(filterParams), permissiveValidators);
    expect(result.kind).toBe("chooser");
    if (result.kind === "chooser") expect(result.partial.filters).toEqual(filterParams);
  });
});

describe("bare /graph (no legacy markers at all)", () => {
  it("opens the context chooser with no notice — the new intended default, not an error", () => {
    const result = translateLegacyGraphUrl(new URLSearchParams(), permissiveValidators);
    expect(result.kind).toBe("chooser");
    if (result.kind === "chooser") {
      expect(result.chooserFor).toBe("context");
      expect(result.notice).toBeNull();
      expect(result.candidateRoots).toEqual([]);
      expect(result.omitted).toEqual([]);
    }
  });
});

describe("malformed and hostile inputs — must never throw", () => {
  it("junk (non-uuid-shaped) roadmapRoot values are simply reported invalid, not thrown", () => {
    expect(() =>
      translateLegacyGraphUrl(p({ roadmapRoot: ["'; DROP TABLE works; --", "../../etc/passwd"] }), permissiveValidators),
    ).not.toThrow();
    const result = translateLegacyGraphUrl(
      p({ roadmapRoot: ["'; DROP TABLE works; --", "../../etc/passwd"] }),
      permissiveValidators,
    );
    expect(result.kind).toBe("chooser");
    if (result.kind === "chooser") expect(result.omitted).toHaveLength(2);
  });

  it("an empty selected value is treated as no selection, not an id to look up", () => {
    const result = translateLegacyGraphUrl(p({ selected: "" }), permissiveValidators);
    expect(result.kind).toBe("chooser");
    if (result.kind === "chooser") {
      expect(result.partial.selectedId).toBeNull();
      expect(result.omitted).toEqual([]);
    }
  });

  it("mixed legacy + new-style params: legacy translation still runs correctly and ignores the new-style params it doesn't own", () => {
    const params = p({ layout: "explore", pinnedWork: "work:w1" });
    // New-URL-state-shaped params mixed in — legacyGraphUrl.ts has no
    // knowledge of ctxKind/ctxId/expand/layer and must not be confused by
    // their presence.
    params.set("ctxKind", "claim");
    params.set("ctxId", "some-claim-id");
    params.append("expand", "e1");
    params.append("layer", "evidence");
    const result = translateLegacyGraphUrl(params, permissiveValidators);
    expect(result.kind).toBe("state");
    if (result.kind === "state") {
      // The legacy pinnedWork anchor wins — ctxKind/ctxId are not part of
      // this module's vocabulary at all.
      expect(result.state.context).toEqual({ kind: "work", id: "w1" });
      expect(result.state.expansionTrail).toEqual([]);
    }
  });

  it("a very large repeated roadmapRoot set (well past any realistic cap) is still processed without throwing", () => {
    const many = Array.from({ length: 200 }, (_, i) => `work:junk-${i}`);
    expect(() => translateLegacyGraphUrl(p({ roadmapRoot: many }), permissiveValidators)).not.toThrow();
    const result = translateLegacyGraphUrl(p({ roadmapRoot: many }), permissiveValidators);
    expect(result.kind).toBe("chooser");
    if (result.kind === "chooser") {
      expect(result.chooserFor).toBe("roadmapRoots");
      expect(result.omitted).toHaveLength(200);
    }
  });

  it("garbage/unrecognized top-level params alongside real ones never throw and are simply ignored", () => {
    const params = p({ pinnedWork: "work:w1" });
    params.set("layout", "🚀");
    params.set("foo[bar]", "baz");
    expect(() => translateLegacyGraphUrl(params, permissiveValidators)).not.toThrow();
  });
});

describe("toDisplayNodeId sanity (used indirectly by translateSelected)", () => {
  it("wraps a raw string without throwing for any input", () => {
    expect(() => toDisplayNodeId("anything at all — 日本語 / 🔥 / ' OR 1=1")).not.toThrow();
  });
});
