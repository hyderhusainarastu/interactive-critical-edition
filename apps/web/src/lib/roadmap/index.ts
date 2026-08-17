/**
 * `@/lib/roadmap` names this domain's core module, which now sits beside its
 * siblings in this folder. This file exists only so that specifier keeps
 * resolving to it -- 2 files import it, and `@/lib/roadmap/roadmap` would
 * stutter for no benefit.
 *
 * It is not a general barrel: every other module in this folder is
 * deep-imported, matching the convention lib/research/ and lib/writer/
 * already set, so each import says where its symbol actually lives.
 */
export * from "./roadmap";
