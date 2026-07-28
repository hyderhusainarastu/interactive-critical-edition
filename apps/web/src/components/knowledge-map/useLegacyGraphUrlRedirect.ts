/**
 * On-mount legacy `/graph` URL translation (charter §9 "Legacy graph URL
 * compatibility", spec §1.1's `useLegacyGraphUrlRedirect.ts` row). Calls
 * `@ice/graph-display`'s `translateLegacyGraphUrl` against the current
 * `URLSearchParams` and performs the `redirect` case via `router.replace`,
 * rewrites the address bar to the new `ctxKind`/`ctxId` format for the
 * `state` case, and leaves the `chooser` case for the caller
 * (`KnowledgeMapWorkspace.tsx`) to render. One hook, one call site, so
 * legacy translation runs exactly once per navigation — this file owns NO
 * translation logic of its own, only the binding layer around
 * `translateLegacyGraphUrl`/`buildGraphUrlHref`.
 *
 * Same two-layer split as `useGraphUrlState.ts`/`useKnowledgeMapCamera.ts`:
 * `shouldAttemptLegacyTranslation` is pure and unit-tested
 * (`useLegacyGraphUrlRedirect.test.ts`); the hook itself needs a real
 * Next.js router context and is covered by the charter §16 Playwright
 * suite (`knowledge-map-legacy-urls.spec.ts`, spec §7.3), a later step's
 * deliverable.
 */
"use client";
import { useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { translateLegacyGraphUrl, type LegacyGraphUrlTranslation, type LegacyTranslationValidators } from "@ice/graph-display";
import { buildGraphUrlHref } from "./useGraphUrlState";

/** A new-format URL always carries `ctxKind` (`urlStateCodec.ts`'s
 *  `CTX_KIND_PARAM`) — once present, this hook must never re-run legacy
 *  translation against it (a value like `ctxKind=work` was never a legacy
 *  param and has no legacy meaning to translate). This is also what stops
 *  the hook from re-triggering after `KnowledgeMapWorkspace` establishes a
 *  new-format URL itself (e.g. from a `ContextChooser` selection or this
 *  same hook's own `state`-case rewrite below) — the next render sees
 *  `ctxKind` present and skips straight past. */
export function shouldAttemptLegacyTranslation(params: URLSearchParams): boolean {
  return !params.has("ctxKind");
}

/**
 * `enabled` is false while the caller is still loading the owner-scoped
 * identifiers used by its validators. Translating a saved bookmark before
 * that data arrives can turn a deleted/foreign `roadmapRoot` into a route
 * redirect, losing the charter-required explanatory chooser state forever.
 */
export function useLegacyGraphUrlRedirect(validators: LegacyTranslationValidators, enabled = true): LegacyGraphUrlTranslation | null {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const translation = useMemo<LegacyGraphUrlTranslation | null>(() => {
    if (!enabled) return null;
    if (!shouldAttemptLegacyTranslation(searchParams)) return null;
    return translateLegacyGraphUrl(searchParams, validators);
  }, [enabled, searchParams, validators]);

  useEffect(() => {
    if (translation === null) return;
    if (translation.kind === "redirect") {
      router.replace(translation.to);
      return;
    }
    if (translation.kind === "state") {
      // Rewrite the address bar to the new format immediately — a legacy
      // bookmark keeps working (never a broken link), and lands the user on
      // the canonical new-format URL rather than perpetuating the old one.
      router.replace(buildGraphUrlHref(pathname, translation.state));
      return;
    }
    // "chooser": no navigation. KnowledgeMapWorkspace renders ContextChooser
    // using `translation.partial`/`translation.notice`/`translation.candidateRoots`.
  }, [translation, router, pathname]);

  return translation;
}
