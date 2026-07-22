import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createVerifiedTestUser, deleteTestUser } from "./helpers";

const EMAIL = `e2e-writer-${Date.now()}@example.com`;
const SECOND_EMAIL = `e2e-writer-other-${Date.now()}@example.com`;
const PASSWORD = "password123";

async function login(page: import("@playwright/test").Page, email = EMAIL) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Writer mode", () => {
  test.beforeAll(async () => {
    await createVerifiedTestUser(EMAIL, PASSWORD);
    await createVerifiedTestUser(SECOND_EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
    await deleteTestUser(SECOND_EMAIL);
  });

  test("creates an autosaved draft, imports BibTeX, restores revisions, and exports", async ({ page }) => {
    await login(page);
    await page.goto("/writer");
    await expect(page.getByRole("heading", { name: "Writer" })).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept("Essay on attention"));
    await page.getByRole("button", { name: "New project" }).click();
    await page.waitForURL("**/writer/*");
    const draft = page.getByLabel("Draft").last();
    await draft.fill("A recoverable argument about reading.");
    await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 10_000 });
    await page.getByLabel("Citation import format").selectOption("bibtex");
    await page.getByLabel("Citation metadata").fill("@book{hooks, title={Teaching to Transgress}, author={hooks, bell}, year={1994}, publisher={Routledge}}");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Teaching to Transgress")).toBeVisible();
    await page.getByRole("button", { name: "Insert" }).click();
    await expect(draft).toContainText("(hooks)");
    await expect(page.getByRole("button", { name: "Restore" }).first()).toBeVisible();

    const docxDownload = page.waitForEvent("download");
    await page.getByRole("link", { name: "DOCX" }).click();
    const docx = await docxDownload;
    expect(await docx.suggestedFilename()).toMatch(/\.docx$/);
    const docxPath = await docx.path();
    expect(docxPath).not.toBeNull();
    expect((await readFile(docxPath!)).subarray(0, 2).toString()).toBe("PK");
    const pdfDownload = page.waitForEvent("download");
    await page.getByRole("link", { name: "PDF" }).click();
    const pdf = await pdfDownload;
    expect(await pdf.suggestedFilename()).toMatch(/\.pdf$/);
    const pdfPath = await pdf.path();
    expect(pdfPath).not.toBeNull();
    expect((await readFile(pdfPath!)).subarray(0, 4).toString()).toBe("%PDF");
  });

  test("makes the desktop Library-source sidebar resizer keyboard-operable", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page);
    await page.goto("/writer");
    page.once("dialog", (dialog) => dialog.accept("Keyboard-resizable project"));
    await page.getByRole("button", { name: "New project" }).click();
    await page.waitForURL("**/writer/*");

    const sidebar = page.getByRole("complementary", { name: "Library source sidebar" });
    const resizer = page.getByRole("separator", { name: "Resize Library source sidebar" });
    await expect(resizer).toHaveAttribute("aria-orientation", "vertical");
    await expect(resizer).toHaveAttribute("aria-valuenow", "280");

    await resizer.focus();
    await page.keyboard.press("ArrowRight");
    await expect(resizer).toHaveAttribute("aria-valuenow", "300");
    await expect(sidebar).toHaveCSS("width", "300px");
    await page.keyboard.press("Home");
    await expect(resizer).toHaveAttribute("aria-valuenow", "220");
    await page.keyboard.press("End");
    await expect(resizer).toHaveAttribute("aria-valuenow", "460");
  });

  test("does not disclose another user's project through writer APIs", async ({ browser }) => {
    const owner = await browser.newPage();
    await login(owner);
    await owner.goto("/writer");
    pageOnceDialog(owner, "Private project");
    await owner.getByRole("button", { name: "New project" }).click();
    await owner.waitForURL("**/writer/*");
    const projectId = new URL(owner.url()).pathname.split("/").at(-1)!;
    const unconfirmedArchive = await owner.request.patch(`/api/writer/projects/${projectId}`, { data: { archived: true } });
    expect(unconfirmedArchive.status()).toBe(400);
    owner.once("dialog", (dialog) => dialog.accept());
    await owner.getByRole("button", { name: "Archive" }).click();
    await owner.waitForURL((url) => url.pathname === "/writer");
    await owner.getByRole("button", { name: "Show archived projects" }).click();
    await expect(owner.getByRole("heading", { name: "Archived projects" })).toBeVisible();
    await owner.getByRole("button", { name: "Restore project" }).click();
    await expect(owner.getByRole("link", { name: "Private project" })).toBeVisible();
    await owner.close();

    const other = await browser.newPage();
    await login(other, SECOND_EMAIL);
    const response = await other.request.get(`/api/writer/projects/${projectId}`);
    expect(response.status()).toBe(404);
    await other.close();
  });
});

function pageOnceDialog(page: import("@playwright/test").Page, value: string) {
  page.once("dialog", (dialog) => dialog.accept(value));
}
