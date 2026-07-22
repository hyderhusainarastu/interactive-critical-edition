import { db, documents, learningResources, resourceRoles, workIdentities, works } from "@ice/db";
import { eq, inArray } from "drizzle-orm";
import { auditWorkIdentityDuplicates, renderIdentityAuditReport } from "./merge";

/**
 * Phase 20.6 one-time DRY-RUN report generator. Run locally with:
 *
 *   cd apps/worker && pnpm exec tsx --env-file-if-exists=.env src/identity/dryRun.ts
 *
 * Section 1 audits the LOCAL database exactly as found. Section 2 seeds a
 * deliberately duplicate-rich fixture (every precedence-chain rule
 * represented), audits again, prints only the fixture-related findings, and
 * deletes every seeded row. NOTHING is merged — this script never calls
 * `mergeWorkIdentities` and performs no production reads or writes of any
 * kind (plan §20.6: the production dry-run belongs to the 20.8 gate).
 */

async function seedFixture() {
  const marker = `dryrun-${Date.now()}`;
  const identityIds: string[] = [];
  const resourceIds: string[] = [];
  const workIds: string[] = [];
  const userIdRow = await db.select({ id: works.userId }).from(works).limit(1);
  const userId = userIdRow[0]?.id ?? null;

  const identity = async (over: Partial<typeof workIdentities.$inferInsert> & { workKey: string }) => {
    const [row] = await db
      .insert(workIdentities)
      .values({ canonicalTitle: "fixture", evidence: marker, ...over })
      .returning({ id: workIdentities.id });
    identityIds.push(row.id);
    return row.id;
  };

  // Rule 1 — DOI duplicates (different titles, same verified DOI).
  await identity({ workKey: `work:${marker}:doi-a`, canonicalTitle: `Vice and Reason ${marker}`, authorSurname: "irwin", doi: `10.1234/${marker}` });
  await identity({ workKey: `work:${marker}:doi-b`, canonicalTitle: `Vice and Reason in Aristotle ${marker}`, authorSurname: "irwin", doi: `10.1234/${marker}` });

  // Rule 2 — identical ISBN.
  await identity({ workKey: `work:${marker}:isbn-a`, canonicalTitle: `Ethics with Aristotle ${marker}`, authorSurname: "broadie", isbn: "9780195085600" });
  await identity({ workKey: `work:${marker}:isbn-b`, canonicalTitle: `Ethics with Aristotle ${marker} (paperback)`, authorSurname: "broadie", isbn: "9780195085600" });

  // Rule 3 — canonical external provider id.
  await identity({ workKey: `work:${marker}:ext-a`, canonicalTitle: `Philosophy of Action ${marker}`, authorSurname: "charles", externalId: `openalex:${marker}` });
  await identity({ workKey: `work:${marker}:ext-b`, canonicalTitle: `Philosophy of Action ${marker} (reprint)`, authorSurname: "charles", externalId: `openalex:${marker}` });

  // Rule 4 — normalized title + author + year (and a review-derived
  // title-only identity that folds into its unique authored match).
  await identity({ workKey: `work:${marker}:tay-a`, canonicalTitle: `The Nicomachean Ethics ${marker}`, authorSurname: "aristotle", year: 1999 });
  await identity({ workKey: `work:${marker}:tay-b`, canonicalTitle: `Nicomachean Ethics ${marker}, The`, authorSurname: "aristotle", year: 1999 });
  await identity({ workKey: `work:${marker}:tay-review`, canonicalTitle: `The Nicomachean Ethics ${marker}`, authorSurname: null });

  // Rule 5 — same uploaded bytes under two identities (needs works+documents).
  if (userId) {
    const hashA = await identity({ workKey: `work:${marker}:hash-a`, canonicalTitle: `Uploadwork Alpha ${marker}`, authorSurname: "irwin" });
    const hashB = await identity({ workKey: `work:${marker}:hash-b`, canonicalTitle: `Uploadscan Beta ${marker}`, authorSurname: null });
    for (const identityId of [hashA, hashB]) {
      const [work] = await db.insert(works).values({ userId, title: `${marker} upload`, workIdentityId: identityId }).returning({ id: works.id });
      workIds.push(work.id);
      await db.insert(documents).values({
        userId,
        workId: work.id,
        storagePath: `${userId}/${work.id}/${marker}.pdf`,
        originalFilename: `${marker}.pdf`,
        mimeType: "application/pdf",
        fileSize: 10,
        processingStatus: "ready",
        contentHash: `${marker}-samebytes`,
      });
    }
  }

  // Rule 6 — fuzzy similarity: suggestion only, never merged.
  await identity({ workKey: `work:${marker}:fuzzy-a`, canonicalTitle: `Aristotle's Ethical Theory ${marker}`, authorSurname: "hardie" });
  await identity({ workKey: `work:${marker}:fuzzy-b`, canonicalTitle: `Aristotle's Ethical Theory ${marker}: An Introduction`, authorSurname: "hardie" });

  // Attachment shape: one canonical identity whose Library records include a
  // review and an edition — attached, never merged.
  const attachTarget = await identity({ workKey: `work:${marker}:attach`, canonicalTitle: `Commentary Target ${marker}`, authorSurname: "broadie" });
  for (const [index, record] of ([
    { title: `Commentary Target ${marker}`, workRole: "primary" },
    { title: `Review of Commentary Target ${marker}`, workRole: "review" },
    { title: `Commentary Target ${marker}, 2nd edition`, workRole: "edition" },
  ] as const).entries()) {
    const [resource] = await db
      .insert(learningResources)
      .values({
        workIdentityId: attachTarget,
        workRole: record.workRole,
        title: record.title,
        normalizedKey: `${marker}:attach:${index}`,
        resourceType: "book",
        provider: "crossref",
        authors: ["Sarah Broadie"],
      })
      .returning({ id: learningResources.id });
    resourceIds.push(resource.id);
  }

  return { marker, identityIds, resourceIds, workIds, contentHashSeeded: Boolean(userId) };
}

async function cleanupFixture(fixture: Awaited<ReturnType<typeof seedFixture>>) {
  if (fixture.resourceIds.length) {
    await db.delete(resourceRoles).where(inArray(resourceRoles.learningResourceId, fixture.resourceIds));
    await db.delete(learningResources).where(inArray(learningResources.id, fixture.resourceIds));
  }
  for (const workId of fixture.workIds) {
    await db.delete(documents).where(eq(documents.workId, workId));
    await db.delete(works).where(eq(works.id, workId));
  }
  if (fixture.identityIds.length) await db.delete(workIdentities).where(inArray(workIdentities.id, fixture.identityIds));
}

async function main() {
  const before = await auditWorkIdentityDuplicates();
  console.log(renderIdentityAuditReport(before, "Section 1 — LOCAL database as found (no fixture)"));

  const fixture = await seedFixture();
  try {
    const withFixture = await auditWorkIdentityDuplicates();
    // Only fixture-related rows: every fixture identity id, plus any group
    // that includes one.
    const fixtureIds = new Set(fixture.identityIds);
    const scoped = {
      candidates: withFixture.candidates.filter((c) => fixtureIds.has(c.id)),
      plan: {
        merges: withFixture.plan.merges.filter((m) => fixtureIds.has(m.winnerId) || m.loserIds.some((id) => fixtureIds.has(id))),
        suggestions: withFixture.plan.suggestions.filter((s) => fixtureIds.has(s.leftId) || fixtureIds.has(s.rightId)),
        fuzzyTruncated: withFixture.plan.fuzzyTruncated,
      },
    };
    console.log("");
    console.log(renderIdentityAuditReport(scoped, `Section 2 — seeded duplicate-rich fixture (marker ${fixture.marker}, deleted after this run)`));
    if (!fixture.contentHashSeeded) {
      console.log("\n_Note: no existing user row was available, so the content-hash (rule 5) fixture pair was skipped in this run._");
    }
  } finally {
    await cleanupFixture(fixture);
  }
  console.log("\nFixture cleaned up. No merge was applied by this script.");
  process.exit(0);
}

void main();
