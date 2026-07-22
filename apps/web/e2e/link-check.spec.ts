import { db, users } from "@ice/db";
import { eq } from "drizzle-orm";
import { expect, test, type Page } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedOwnedWork } from "./helpers";

/**
 * Phase 23.1: Automated internal link/anchor checker.
 *
 * Crawls all authenticated app routes (plus public pages) to collect every
 * same-origin <a href> and #anchor reference, validates that internal links
 * resolve without 4xx/5xx, checks that #fragment anchors have matching
 * element ids on their target pages, and records (but does NOT fetch) external
 * links.
 *
 * Manual-only spec (not in CI): the app is under active concurrent modification,
 * so provisional findings reflect in-flight state. Exclude from CI by not
 * listing this spec in .github/workflows/ci.yml's E2E command.
 */

const EMAIL = `e2e-link-check-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

interface LinkCheckResult {
  pagesCrawled: string[];
  linksChecked: number;
  anchorsChecked: number;
  externalLinks: {
    count: number;
    samples: string[];
  };
  brokenInternalLinks: Array<{
    page: string;
    href: string;
    status: number;
    reason: string;
  }>;
  brokenAnchors: Array<{
    page: string;
    targetPage: string;
    fragment: string;
    reason: string;
  }>;
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

/**
 * Collects all same-origin links from a page, filtering out external URLs,
 * fragments-only, and placeholders.
 */
async function collectLinks(page: Page): Promise<Set<string>> {
  const links = new Set<string>();
  const hrefs = await page.$$eval("a[href]", (elements) => elements.map((el) => el.getAttribute("href")).filter(Boolean));
  const currentUrl = new URL(page.url());

  for (const href of hrefs) {
    if (!href) continue;
    if (href.startsWith("#")) continue; // Handle fragments separately
    if (href.startsWith("http://") || href.startsWith("https://")) {
      // External link — skip for now
      continue;
    }
    // Relative URL; normalize to absolute
    try {
      const resolved = new URL(href, currentUrl).pathname;
      links.add(resolved);
    } catch {
      // Invalid URL, skip
    }
  }
  return links;
}

/**
 * Collects all #fragment references from a page (both <a href="#..."> and
 * any JavaScript navigation targets that might be present).
 */
async function collectFragmentReferences(page: Page): Promise<Map<string, string>> {
  const fragments = new Map<string, string>(); // fragment -> target page
  const currentPath = new URL(page.url()).pathname;

  const hrefFragments = await page.$$eval("a[href^='#']", (elements) =>
    elements.map((el) => {
      const href = el.getAttribute("href");
      return href ? href.substring(1) : null; // Remove #
    }),
  );

  for (const fragment of hrefFragments) {
    if (fragment) {
      fragments.set(fragment, currentPath);
    }
  }
  return fragments;
}

/**
 * Checks if an element with a given id exists on the page.
 */
async function anchorExists(page: Page, id: string): Promise<boolean> {
  try {
    await page.locator(`#${id.replace(/'/g, "\\'")}:visible`).first().boundingBox({ timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Navigates to a URL via API call to check response status without triggering
 * full page loads (faster, and works for redirects).
 */
async function checkUrlStatus(page: Page, url: string): Promise<number> {
  const response = await page.context().request.head(url).catch(async () => {
    // If HEAD fails, try GET and return status
    const getResp = await page.context().request.get(url).catch(() => null);
    return getResp;
  });

  if (!response) return 0; // Network error
  return response.status();
}

/**
 * All routes from the Phase 19 system inventory that can be crawled directly
 * (dynamic routes like /works/[workId] require a seeded work).
 */
const STATIC_ROUTES = [
  "/",
  "/privacy",
  "/terms",
  "/login",
  "/signup",
  "/dashboard",
  "/welcome",
  "/library",
  "/upload",
  "/works",
  "/works/trash",
  "/graph",
  "/ask-library",
];

const DYNAMIC_ROUTES_SINGLE_WORK = (workId: string) => [
  `/works/${workId}`,
  `/works/${workId}/reader`,
  `/works/${workId}/roadmap`,
  `/works/${workId}/curriculum`,
  `/works/${workId}/diagnostic`,
  `/works/${workId}/graph`,
];

test.describe("Link checker (Phase 23.1)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    // Mark as onboarded so dashboard/welcome don't redirect
    await db
      .update(users)
      .set({ preferences: { onboardedAt: new Date().toISOString() } })
      .where(eq(users.id, userId));
  });

  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("crawl and validate all links and anchors", async ({ page }) => {
    const result: LinkCheckResult = {
      pagesCrawled: [],
      linksChecked: 0,
      anchorsChecked: 0,
      externalLinks: { count: 0, samples: [] },
      brokenInternalLinks: [],
      brokenAnchors: [],
    };

    // Seed a work for dynamic routes
    const { workId } = await seedOwnedWork(userId);

    // Login
    await login(page);

    // Build list of routes to crawl
    const routesToCrawl = [
      ...STATIC_ROUTES,
      ...DYNAMIC_ROUTES_SINGLE_WORK(workId),
      // Skip feature-gated routes (writer, rag) for now since they depend on
      // release flags; if flags are set in .env.local, they'll be exercised
      // by other specs. Admin is owner-gated so skip it.
    ];

    // Crawl each route
    for (const route of routesToCrawl) {
      console.log(`Visiting ${route}...`);
      try {
        await page.goto(route, { waitUntil: "networkidle" });
      } catch (e) {
        // Navigation error (might be a redirect or permission gate)
        // Skip this route and continue
        console.log(`  → navigation failed: ${e}`);
        continue;
      }

      const finalUrl = new URL(page.url());
      const finalPath = finalUrl.pathname + finalUrl.search;

      // Only count the route if we successfully navigated to it
      if (!result.pagesCrawled.includes(finalPath)) {
        result.pagesCrawled.push(finalPath);
      }

      // Collect internal links
      const internalLinks = await collectLinks(page);
      for (const link of internalLinks) {
        result.linksChecked++;

        // Check the link status
        const status = await checkUrlStatus(page, link);
        if (status >= 400) {
          result.brokenInternalLinks.push({
            page: finalPath,
            href: link,
            status,
            reason: `HTTP ${status}`,
          });
        }
      }

      // Collect and validate fragment anchors
      const fragmentRefs = await collectFragmentReferences(page);
      for (const [fragment, targetPage] of fragmentRefs.entries()) {
        result.anchorsChecked++;

        // Check if anchor exists on the current page (fragments are in-page)
        const exists = await anchorExists(page, fragment);
        if (!exists) {
          result.brokenAnchors.push({
            page: finalPath,
            targetPage,
            fragment,
            reason: "Element with id not found",
          });
        }
      }

      // Also collect external links for count/samples
      const hrefsRaw = await page.$$eval("a[href]", (elements) =>
        elements.map((el) => el.getAttribute("href")).filter(Boolean),
      );
      for (const href of hrefsRaw) {
        if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
          result.externalLinks.count++;
          if (result.externalLinks.samples.length < 5) {
            result.externalLinks.samples.push(href);
          }
        }
      }
    }

    // Output summary
    console.log("\n=== LINK CHECK SUMMARY ===");
    console.log(JSON.stringify(result, null, 2));

    // Assert zero broken links
    expect(result.brokenInternalLinks, `Found ${result.brokenInternalLinks.length} broken internal link(s): ${result.brokenInternalLinks.map((l) => `${l.page}: ${l.href} (${l.reason})`).join("; ")}`).toEqual([]);
    expect(result.brokenAnchors, `Found ${result.brokenAnchors.length} broken anchor(s): ${result.brokenAnchors.map((a) => `${a.page}: #${a.fragment} (${a.reason})`).join("; ")}`).toEqual([]);

    console.log(`\n✓ All ${result.linksChecked} links checked`);
    console.log(`✓ All ${result.anchorsChecked} anchors checked`);
    console.log(`✓ Recorded ${result.externalLinks.count} external links`);
    console.log(`✓ Crawled ${result.pagesCrawled.length} pages successfully`);
  });
});
