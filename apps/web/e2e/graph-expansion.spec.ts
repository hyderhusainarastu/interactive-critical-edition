import { db, processingRuns, workClaims } from "@ice/db";
import { eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedWorkWithGraphData } from "./helpers";

const EMAIL = `e2e-graph-expansion-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Cross-library graph API guardrails", () => {
  test.beforeAll(async () => { userId = await createVerifiedTestUser(EMAIL, PASSWORD); });
  test.afterAll(async () => { await deleteTestUser(EMAIL); });

  test("accepts exactly one idempotent paid request and rate-limits repeated submission", async ({ page }) => {
    const source = await seedWorkWithGraphData(userId);
    const target = await seedWorkWithGraphData(userId);
    const [sourceRun] = await db.select({ id: processingRuns.id }).from(processingRuns).where(eq(processingRuns.documentId, source.documentId)).limit(1);
    const [targetRun] = await db.select({ id: processingRuns.id }).from(processingRuns).where(eq(processingRuns.documentId, target.documentId)).limit(1);
    await db.insert(workClaims).values([
      { runId: sourceRun.id, workId: source.workId, claim: "The argument connects form, life, and ethical inquiry.", claimType: "argument", supportingExcerpt: "The soul is the form of a natural body having life potentially.", confidence: 0.9 },
      { runId: targetRun.id, workId: target.workId, claim: "The argument compares form, life, and ethical inquiry.", claimType: "argument", supportingExcerpt: "The soul is the form of a natural body having life potentially.", confidence: 0.9 },
    ]);

    await login(page);
    const key = "e2e-graph-expansion-idempotency";
    const first = await page.request.post("/api/graph/expansion", {
      headers: { "Idempotency-Key": key },
      data: { workId: source.workId, candidates: 1, confirmEstimatedCost: false },
    });
    expect(first.status()).toBe(202);
    const duplicate = await page.request.post("/api/graph/expansion", {
      headers: { "Idempotency-Key": key },
      data: { workId: source.workId, candidates: 1, confirmEstimatedCost: false },
    });
    expect(duplicate.status()).toBe(202);
    expect((await duplicate.json()).idempotent).toBe(true);

    for (let index = 0; index < 10; index += 1) {
      const response = await page.request.post("/api/graph/expansion", {
        headers: { "Idempotency-Key": key },
        data: { workId: source.workId, candidates: 1, confirmEstimatedCost: false },
      });
      expect(response.status()).toBe(202);
    }
    const limited = await page.request.post("/api/graph/expansion", {
      headers: { "Idempotency-Key": key },
      data: { workId: source.workId, candidates: 1, confirmEstimatedCost: false },
    });
    expect(limited.status()).toBe(429);
    expect(limited.headers()["retry-after"]).toBeTruthy();
  });
});
