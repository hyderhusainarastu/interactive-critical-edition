import type { Page } from "@playwright/test";

/**
 * The shared 44x44 CSS-pixel touch-target audit (`accessibility-sweep.spec.ts`'s
 * own `auditTouchTargets`, factored out here — D-25-10 — so the research
 * workspace specs that needed it (monitors, corrections, corpus) don't each
 * duplicate the DOM-measurement logic). See that file's own doc comment for
 * the full rationale on every exclusion below; this is byte-identical logic,
 * just relocated to a shared helper — plus one addition: a brief settle
 * wait, found while writing the research-workspace coverage this move was
 * for. `min-h-11`'s rendered box occasionally measures a hair under 44 CSS
 * px on the very first post-navigation paint — before the
 * `--app-font-scale` custom property finishes resolving — then settles at
 * exactly 44px within a frame or two. Reproducible flake (~1 in 3 runs
 * without it), not a sizing bug: every spec's own local axe `scan()`
 * helper already waits 300ms before scanning for the same class of reason.
 *
 * `rootSelector` (new, D-25-10) scopes the audit to one subtree instead of
 * the whole document — for a page that legitimately mixes a region this
 * caller just fixed with OTHER, pre-existing controls outside that caller's
 * own scope (e.g. the hypotheses page's compact, deliberately-dense review
 * chips sit alongside an unrelated "Generate hypotheses" button this task
 * never touched) — so a test can assert its own fix's invariant without
 * also asserting something it was never asked to fix.
 */
export async function auditTouchTargets(
  page: Page,
  rootSelector?: string,
): Promise<{ tag: string; label: string; width: number; height: number }[]> {
  await page.waitForTimeout(300);
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate((selector) => {
    const MIN = 44;
    const root = selector ? document.querySelector(selector) : document;
    if (!root) return [];
    const isInlineProse = (el: Element) => {
      const parent = el.parentElement;
      return el.tagName === "A" && !!parent && ["P", "LI", "SPAN"].includes(parent.tagName);
    };
    const isInlineTextMarker = (el: Element) =>
      el.classList.contains("reader-footnote-marker") || el.classList.contains("reader-annotation-marker");
    const isInClosedDetails = (el: Element) => {
      const details = el.closest("details");
      return !!details && !details.open && el.tagName !== "SUMMARY";
    };
    const ACCEPTED_DENSE_REGION_SELECTOR = [
      "[data-dense-controls]",
      "[data-graph-roadmap-progress]",
      "[data-graph-stage]",
      '[aria-label="Accessible graph browser"]',
      '[aria-label="Edition sidebar"]',
    ].join(", ");
    const isAcceptedDenseRegion = (el: Element) => !!el.closest(ACCEPTED_DENSE_REGION_SELECTOR);
    const candidates = Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"], summary'));
    const violations: { tag: string; label: string; width: number; height: number }[] = [];
    for (const el of candidates) {
      if (el.closest('[aria-hidden="true"]')) continue;
      if ((el as HTMLButtonElement).disabled) continue;
      if (el.closest('[role="separator"]')) continue;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue; // not actually rendered
      if (isInlineProse(el) || isInlineTextMarker(el) || isInClosedDetails(el) || isAcceptedDenseRegion(el)) continue;
      if (rect.width < MIN || rect.height < MIN) {
        violations.push({
          tag: el.tagName.toLowerCase(),
          label: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    }
    return violations;
  }, rootSelector);
}
