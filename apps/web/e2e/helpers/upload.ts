import type { Page } from "@playwright/test";

/**
 * Drives a single-file upload through the real `/upload` batch UI and
 * returns the resulting work id. Phase 14 replaced the old "upload
 * redirects straight to `/works/<id>`" flow with a batch-status list that
 * never navigates away on its own — the user clicks an "Open work" link
 * once the file reaches `queued_for_processing` — but three older,
 * manual-only Phase 3/4/5 specs (`reader`, `annotations`, `roadmap`) still
 * assumed the pre-Phase-14 redirect and were silently failing every run
 * since (`page.waitForURL` timing out after 2 minutes with no useful
 * signal beyond "navigation never happened"). Found and fixed during the
 * Phase 19 user-journey audit (D-19-5) — extracted here once rather than
 * patched three times so a future upload-UI change only needs updating in
 * one place.
 */
export async function uploadOneFileViaUI(page: Page, filePath: string): Promise<string> {
  await page.goto("/upload");
  await page.getByLabel("Choose files to upload").setInputFiles(filePath);
  const openWork = page.locator("[data-upload-item]").getByRole("link", { name: "Open work" });
  await openWork.waitFor({ state: "visible", timeout: 45000 });
  const href = await openWork.getAttribute("href");
  if (!href) throw new Error("Open work link had no href");
  await page.goto(href);
  return href.split("/works/")[1];
}

/**
 * Uploads one file via the real UI, then handles the metadata-review step
 * — but that step is conditional, not guaranteed: `apps/worker/src/index.ts`
 * (`autoReady`) skips straight to `ready` whenever extraction's title
 * confidence is high (>=0.9) and a title was detected, which a clean
 * "Title on its own line" fixture reliably triggers. Older manual-only
 * specs (`reader`, `annotations`, `roadmap`) assumed the confirm form
 * always appears, so under pipeline v2 (this project's actual production
 * pipeline — local dev defaults to the legacy v1, see the Phase 19
 * environment-drift finding, D-19-6) they'd hang waiting for a form that
 * had already been skipped. Races both outcomes rather than assuming one.
 */
export async function uploadAndConfirmViaUI(page: Page, filePath: string, title: string): Promise<string> {
  const workId = await uploadOneFileViaUI(page, filePath);
  const confirmForm = page.getByText("Confirm or correct");
  const openReaderLink = page.getByRole("link", { name: "Open reader" });
  // Generous: under pipeline v2+, `handleEditionExtraction` runs the ENTIRE
  // pipeline (extraction, GROBID, a live multi-provider research pass,
  // classification) as one job BEFORE the document ever reaches
  // needs_review/ready — confirmed by reading apps/worker/src/index.ts,
  // where analyzeEditionRun() (the expensive stage) runs before the
  // autoReady decision. So "Confirm or correct" (or its auto-ready
  // bypass — see this function's own doc comment) can legitimately take
  // well over a minute to appear, not because anything is slow/broken but
  // because that is the real, current shape of the v2+ pipeline — a
  // genuine behavior change from v1's old "confirm fast, analyze in the
  // background" split (D-19-6).
  await Promise.race([
    confirmForm.waitFor({ timeout: 150000 }),
    openReaderLink.waitFor({ timeout: 150000 }),
  ]).catch(() => {});
  if (await confirmForm.isVisible()) {
    await page.locator('input[name="title"]').fill(title);
    await page.getByRole("button", { name: "Confirm and add to library" }).click();
  }
  await openReaderLink.waitFor({ timeout: 30000 });
  return workId;
}
