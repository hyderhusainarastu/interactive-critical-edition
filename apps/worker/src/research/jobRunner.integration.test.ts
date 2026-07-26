import { db, researchJobRequests, users } from "@ice/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { runResearchJob } from "./jobRunner";

/**
 * Integration test for the `runResearchJob` confirmation guard (defense in
 * depth — see `jobRunner.ts`). Skipped when DATABASE_URL is unset, matching
 * every other `*.integration.test.ts` file's convention.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

async function seedJobRequest(input: { requiresConfirmation: boolean; confirmedAt: Date | null }) {
  const [user] = await db.insert(users).values({ email: `jr-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  const [request] = await db
    .insert(researchJobRequests)
    .values({
      userId: user.id,
      jobType: "extract_claims",
      scope: {},
      idempotencyKey: crypto.randomUUID(),
      status: "planned",
      requiresConfirmation: input.requiresConfirmation,
      confirmedAt: input.confirmedAt,
    })
    .returning({ id: researchJobRequests.id });
  return { userId: user.id, requestId: request.id };
}

describe.skipIf(!hasDb)("runResearchJob confirmation guard (integration)", () => {
  const cleanupUsers: string[] = [];
  afterEach(async () => {
    while (cleanupUsers.length) await db.delete(users).where(eq(users.id, cleanupUsers.pop()!));
  });

  it("refuses to run and marks the request failed when requiresConfirmation is true and confirmedAt is null — the handler is never invoked", async () => {
    const { userId, requestId } = await seedJobRequest({ requiresConfirmation: true, confirmedAt: null });
    cleanupUsers.push(userId);

    let handlerInvoked = false;
    await runResearchJob(requestId, async () => {
      handlerInvoked = true;
      return { coverage: "full" as const };
    });

    expect(handlerInvoked).toBe(false);
    const [request] = await db.select().from(researchJobRequests).where(eq(researchJobRequests.id, requestId));
    expect(request.status).toBe("failed");
    expect(request.error).toBe("awaiting confirmation");
    expect(request.actualCostUsd).toBe(0);
  });

  it("runs normally once confirmedAt is set on a requiresConfirmation request — the guard does not block a legitimately confirmed job", async () => {
    const { userId, requestId } = await seedJobRequest({ requiresConfirmation: true, confirmedAt: new Date() });
    cleanupUsers.push(userId);

    let handlerInvoked = false;
    await runResearchJob(requestId, async () => {
      handlerInvoked = true;
      return { coverage: "full" as const };
    });

    expect(handlerInvoked).toBe(true);
    const [request] = await db.select().from(researchJobRequests).where(eq(researchJobRequests.id, requestId));
    expect(request.status).toBe("complete");
  });

  it("runs normally when requiresConfirmation is false, regardless of confirmedAt", async () => {
    const { userId, requestId } = await seedJobRequest({ requiresConfirmation: false, confirmedAt: null });
    cleanupUsers.push(userId);

    let handlerInvoked = false;
    await runResearchJob(requestId, async () => {
      handlerInvoked = true;
      return { coverage: "full" as const };
    });

    expect(handlerInvoked).toBe(true);
    const [request] = await db.select().from(researchJobRequests).where(eq(researchJobRequests.id, requestId));
    expect(request.status).toBe("complete");
  });
});
