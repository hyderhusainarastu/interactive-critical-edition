import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getOwnedDocument } from "@/lib/works";
import { getLibrary } from "@/lib/library";
import { tabDisabledReason } from "@/components/read/workAttention";
import { SourcesView } from "./SourcesView";

/**
 * Sources tab (Stage 4 read spec §3.4) — the credibility/provenance surface
 * the charter lists as its own persistent tab, parallel in rank to Roadmap/
 * Curriculum, reachable without opening the Reader. Deliberately reuses
 * `getLibrary()` (`@/lib/library`, existing/unchanged) rather than a new
 * dedicated route or a hand-rolled duplicate of its resource_role ->
 * learning_resource -> credibility join — the spec's own file plan called
 * for a new `/api/works/:id/sources` route, but `apps/web/src/app/api/**`
 * is outside this lane's file ownership (see the Stage 4 program rules);
 * fetching directly in this server component reaches the identical data
 * without that route.
 */
export default async function SourcesPage({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const session = await requireSession();
  const { workId } = await params;

  const doc = await getOwnedDocument(workId, session.user.id);
  if (!doc) notFound();

  if (doc.processingStatus !== "ready") {
    const reason = tabDisabledReason({ status: doc.processingStatus, deletedAt: null });
    return (
      <div className="mx-auto max-w-3xl px-6 py-12">
        <p className="rounded-md border border-[var(--color-border)] px-4 py-3 text-sm text-[var(--color-text-muted)]">
          {reason ?? "Sources aren't available for this work yet."}{" "}
          <Link href={`/works/${workId}`} className="underline">
            View work details
          </Link>
          .
        </p>
      </div>
    );
  }

  const library = await getLibrary(session.user.id);
  const items = library.items.filter((item) => item.recommendedFor.some((recommendation) => recommendation.workId === workId));

  return <SourcesView title={doc.title} items={items} />;
}
