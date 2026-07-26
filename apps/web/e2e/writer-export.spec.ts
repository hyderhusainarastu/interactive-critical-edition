import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser } from "./helpers";

/**
 * Phase 29.3 (reverse-direction ScholarLens port): the BibTeX/RIS/APA/Chicago
 * citation export endpoint and its Writer UI picker, alongside the existing
 * DOCX/PDF document export covered in `writer.spec.ts`. Kept as its own
 * spec file (rather than extending `writer.spec.ts` in place) since it
 * exercises a distinct route and a distinct set of format-specific payload
 * assertions that would otherwise bloat that file's single "creates ...
 * and exports" test.
 */

const EMAIL = `e2e-writer-export-${Date.now()}@example.com`;
const OTHER_EMAIL = `e2e-writer-export-other-${Date.now()}@example.com`;
const PASSWORD = "password123";

async function login(page: import("@playwright/test").Page, email = EMAIL) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

async function newProject(page: import("@playwright/test").Page, title: string): Promise<string> {
  await page.goto("/writer");
  page.once("dialog", (dialog) => dialog.accept(title));
  await page.getByRole("button", { name: "New project" }).click();
  await page.waitForURL("**/writer/*");
  return new URL(page.url()).pathname.split("/").at(-1)!;
}

test.describe("Writer citation export", () => {
  test.beforeAll(async () => {
    await createVerifiedTestUser(EMAIL, PASSWORD);
    await createVerifiedTestUser(OTHER_EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
    await deleteTestUser(OTHER_EMAIL);
  });

  test("exports a real citation in all four formats with the correct content-type and payload", async ({ page }) => {
    await login(page);
    const projectId = await newProject(page, "Export-format project");

    await page.getByLabel("Citation import format").selectOption("bibtex");
    await page
      .getByLabel("Citation metadata")
      .fill(
        "@article{roochnik, title={Vice and the Voluntary}, author={Roochnik, David}, year={2007}, journal={The Review of Metaphysics}, doi={10.2307/20130382}}",
      );
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Vice and the Voluntary")).toBeVisible();

    const bibtex = await page.request.get(`/api/writer/projects/${projectId}/citations/export?format=bibtex`);
    expect(bibtex.status()).toBe(200);
    expect(bibtex.headers()["content-type"]).toContain("application/x-bibtex");
    expect(bibtex.headers()["content-disposition"]).toContain(".bib");
    const bibtexBody = await bibtex.text();
    expect(bibtexBody).toContain("@article{");
    expect(bibtexBody).toContain("title = {Vice and the Voluntary}");
    expect(bibtexBody).toContain("journal = {The Review of Metaphysics}");
    expect(bibtexBody).toContain("doi = {10.2307/20130382}");

    const ris = await page.request.get(`/api/writer/projects/${projectId}/citations/export?format=ris`);
    expect(ris.status()).toBe(200);
    expect(ris.headers()["content-type"]).toContain("application/x-research-info-systems");
    expect(ris.headers()["content-disposition"]).toContain(".ris");
    const risBody = await ris.text();
    expect(risBody).toContain("TY  - JOUR");
    expect(risBody).toContain("AU  - Roochnik, David");
    expect(risBody).toContain("ER  - ");

    const apa = await page.request.get(`/api/writer/projects/${projectId}/citations/export?format=apa`);
    expect(apa.status()).toBe(200);
    expect(apa.headers()["content-type"]).toContain("text/plain");
    expect(apa.headers()["content-disposition"]).toContain(".txt");
    expect(await apa.text()).toContain("Roochnik, D. (2007). Vice and the Voluntary.");

    const chicago = await page.request.get(`/api/writer/projects/${projectId}/citations/export?format=chicago`);
    expect(chicago.status()).toBe(200);
    expect(chicago.headers()["content-type"]).toContain("text/plain");
    expect(await chicago.text()).toContain("Roochnik, David 2007. “Vice and the Voluntary.”");

    const badFormat = await page.request.get(`/api/writer/projects/${projectId}/citations/export?format=nonsense`);
    expect(badFormat.status()).toBe(400);
  });

  test("returns an empty payload for a project with no citations, not an error", async ({ page }) => {
    await login(page);
    const projectId = await newProject(page, "Citation-free project");

    const response = await page.request.get(`/api/writer/projects/${projectId}/citations/export?format=bibtex`);
    expect(response.status()).toBe(200);
    expect(await response.text()).toBe("");
  });

  test("the Writer UI's format picker downloads the selected format", async ({ page }) => {
    await login(page);
    await newProject(page, "Picker download project");
    await page.getByLabel("Citation import format").selectOption("bibtex");
    await page.getByLabel("Citation metadata").fill("@book{hooks, title={Teaching to Transgress}, author={hooks, bell}, year={1994}, publisher={Routledge}}");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Teaching to Transgress")).toBeVisible();

    await page.getByLabel("Citation export format").selectOption("apa");
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export" }).click();
    const file = await download;
    expect(await file.suggestedFilename()).toMatch(/\.txt$/);
  });

  test("does not disclose another user's citations through the export endpoint (404, not 403)", async ({ page }) => {
    await login(page);
    const projectId = await newProject(page, "Private export project");
    await page.getByLabel("Citation import format").selectOption("bibtex");
    await page.getByLabel("Citation metadata").fill("@book{secret, title={A Private Citation}, author={Doe, Jane}, year={2021}, publisher={Nobody}}");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("A Private Citation")).toBeVisible();

    const otherPage = await page.context().browser()!.newPage();
    await login(otherPage, OTHER_EMAIL);
    const response = await otherPage.request.get(`/api/writer/projects/${projectId}/citations/export?format=bibtex`);
    expect(response.status()).toBe(404);
    await otherPage.close();
  });
});
