/**
 * Phase 28.6: a narrow, client-safe, I/O-free local mirror of `@ice/rag`'s
 * `ResearchMode`/`RESEARCH_MODES`/`RESEARCH_MODE_LABEL` — split out of
 * `RagChatPanel.tsx` into its own plain (non-`"use client"`, non-JSX)
 * module so it can be imported both by that client component AND by a
 * server-safe Vitest unit test with no React/DOM/Node-built-in surface
 * either way.
 *
 * This is NOT imported from `@ice/rag` directly, deliberately: that
 * package's barrel (`src/index.ts`) re-exports `researchModes.ts`'s
 * `createDbResearchModeRepository`, whose dynamic `import("@ice/db")` still
 * gets pulled into the CLIENT bundle's dependency graph for code-splitting
 * purposes even though it's never called there, and `@ice/db` imports
 * `postgres`/`pg-boss`, which use Node built-ins (`tls`, `util/types`) that
 * don't exist in a browser bundle — confirmed as a real `next build`
 * failure before `RagChatPanel.tsx` switched to this local, I/O-free mirror
 * instead. A parity test (`researchModeTaxonomy.test.ts`) keeps this mirror
 * from silently drifting out of sync with `@ice/rag`'s canonical exports.
 */
export const RESEARCH_MODES = ["socratic", "find_counterarguments", "explain_disagreement", "map_debate", "find_support"] as const;
export type ResearchMode = (typeof RESEARCH_MODES)[number];
export const RESEARCH_MODE_LABEL: Record<ResearchMode, string> = {
  socratic: "Socratic",
  find_counterarguments: "Find counterarguments",
  find_support: "Find support",
  explain_disagreement: "Explain disagreement",
  map_debate: "Map the debate",
};
