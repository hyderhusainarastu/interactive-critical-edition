import { describe, expect, it } from "vitest";
import {
  EMPTY_ASK_LIBRARY_DEEP_LINK,
  parseAskLibraryDeepLink,
  serializeAskLibraryDeepLink,
  type AskLibraryDeepLinkParams,
} from "./askLibraryDeepLink";

describe("parseAskLibraryDeepLink", () => {
  it("reads all four known params", () => {
    const params = new URLSearchParams({
      mode: "research",
      claimId: "claim-1",
      clusterId: "cluster-2",
      workIdB: "w-9",
    });
    expect(parseAskLibraryDeepLink(params)).toEqual({
      mode: "research",
      claimId: "claim-1",
      clusterId: "cluster-2",
      workIdB: "w-9",
    });
  });

  it("returns the empty shape (all null) when nothing is present", () => {
    expect(parseAskLibraryDeepLink(new URLSearchParams())).toEqual(EMPTY_ASK_LIBRARY_DEEP_LINK);
  });

  it("is tolerant of partial presence — only some of the four keys set", () => {
    const params = new URLSearchParams({ claimId: "claim-1" });
    expect(parseAskLibraryDeepLink(params)).toEqual({
      mode: null,
      claimId: "claim-1",
      clusterId: null,
      workIdB: null,
    });
  });

  it("ignores unrelated params (e.g. a co-mounted GraphUrlState's own keys)", () => {
    const params = new URLSearchParams({
      claimId: "claim-1",
      ctxKind: "work",
      ctxId: "w1",
      view: "3d",
    });
    expect(parseAskLibraryDeepLink(params)).toEqual({
      mode: null,
      claimId: "claim-1",
      clusterId: null,
      workIdB: null,
    });
  });

  it("does not fabricate a mode vocabulary — an arbitrary string round-trips as-is", () => {
    const params = new URLSearchParams({ mode: "some-future-mode-value" });
    expect(parseAskLibraryDeepLink(params).mode).toBe("some-future-mode-value");
  });
});

describe("serializeAskLibraryDeepLink", () => {
  it("round-trips a fully-populated deep link", () => {
    const state: AskLibraryDeepLinkParams = {
      mode: "ordinary",
      claimId: "claim-1",
      clusterId: "cluster-2",
      workIdB: "w-9",
    };
    expect(parseAskLibraryDeepLink(serializeAskLibraryDeepLink(state))).toEqual(state);
  });

  it("round-trips the empty shape to an empty URLSearchParams", () => {
    const params = serializeAskLibraryDeepLink(EMPTY_ASK_LIBRARY_DEEP_LINK);
    expect([...params.keys()]).toEqual([]);
  });

  it("never mutates a caller-provided URLSearchParams — always returns a new instance", () => {
    const existing = new URLSearchParams({ foo: "bar" });
    const result = serializeAskLibraryDeepLink({ mode: "research", claimId: null, clusterId: null, workIdB: null });
    expect(result).not.toBe(existing);
    expect(existing.has("mode")).toBe(false);
  });

  it("round-trips a partial deep link, preserving nulls as absent keys", () => {
    const state: AskLibraryDeepLinkParams = { mode: null, claimId: "claim-1", clusterId: null, workIdB: null };
    const params = serializeAskLibraryDeepLink(state);
    expect(params.has("mode")).toBe(false);
    expect(params.has("clusterId")).toBe(false);
    expect(params.has("workIdB")).toBe(false);
    expect(parseAskLibraryDeepLink(params)).toEqual(state);
  });
});
