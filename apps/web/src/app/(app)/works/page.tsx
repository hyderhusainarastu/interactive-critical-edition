import Link from "next/link";
import { db, documents, works } from "@ice/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import { STATUS_COLOR, STATUS_LABEL } from "@/lib/status";
import { PageHeader } from "@/components/app/PageHeader";

/**
 * Your uploads (plan §34.4 9.5) — this used to be `/dashboard`'s whole
 * content. Split out so `/dashboard` can become a lighter cross-cutting
 * overview and `/library` can hold the (separate) recommended-sources list.
 */
export default async function WorksPage() {
  const session = await requireSession();
  const userId = session.user.id;

  const prefs = await getUserPreferences(userId);
  if (!prefs.onboardedAt) redirect("/welcome");

  const library = await db
    .select({
      workId: works.id,
      title: works.title,
      authorName: works.authorName,
      status: documents.processingStatus,
      documentId: documents.id,
    })
    .from(works)
    .leftJoin(documents, eq(documents.workId, works.id))
    .where(and(eq(works.userId, userId), isNull(works.deletedAt)))
    .orderBy(desc(works.createdAt));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <PageHeader
        title="Uploaded works"
        description="Your uploaded source files and their current processing state."
        actions={<>
          <Link
            href="/works/trash"
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)]"
          >
            Trash
          </Link>
          <Link
            href="/graph"
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)]"
          >
            Visualization
          </Link>
          <Link
            href="/upload"
            className="rounded-md bg-[var(--color-accent-ink)] px-4 py-2 text-sm text-[var(--color-background)]"
          >
            Upload a work
          </Link>
        </>}
      />

      {library.length === 0 ? (
        <p className="text-[var(--color-text-muted)]">
          Nothing uploaded yet.{" "}
          <Link href="/upload" className="underline">
            Upload your first work
          </Link>{" "}
          to get started.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
          {library.map((item) => (
            <li key={item.workId}>
              <Link
                href={`/works/${item.workId}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-[var(--color-surface)]"
              >
                <span>
                  <span className="font-medium text-[var(--color-text)]">
                    {item.title}
                  </span>
                  {item.authorName && (
                    <span className="text-[var(--color-text-muted)]">
                      {" "}
                      — {item.authorName}
                    </span>
                  )}
                </span>
                <span
                  className="text-sm font-medium"
                  style={{ color: item.status ? STATUS_COLOR[item.status] : undefined }}
                >
                  {item.status ? STATUS_LABEL[item.status] : "—"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
