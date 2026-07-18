import Link from "next/link";
import { db, documents, works } from "@ice/db";
import { desc, eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth";
import { STATUS_COLOR, STATUS_LABEL } from "@/lib/status";

export default async function DashboardPage() {
  const session = await requireSession();
  const userId = session.user.id;

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
    .where(eq(works.userId, userId))
    .orderBy(desc(works.createdAt));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold text-[var(--color-text)]">
          Your library
        </h1>
        <Link
          href="/upload"
          className="rounded-md bg-[var(--color-accent-ink)] px-4 py-2 text-sm text-[var(--color-background)]"
        >
          Upload a work
        </Link>
      </div>

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
