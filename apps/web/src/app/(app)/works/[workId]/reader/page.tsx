import Link from "next/link";
import { notFound } from "next/navigation";
import { phase12FeatureEnabled, phase18RagEnabled, phase25FeatureEnabled } from "@ice/config";
import { requireSession } from "@/lib/auth";
import { getUserReaderLevel } from "@/lib/readerLevel";
import { getOwnedDocument } from "@/lib/works";
import { tabDisabledReason } from "@/components/read/workAttention";
import { ReaderShell } from "./ReaderShell";

export default async function ReaderPage({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const session = await requireSession();
  const { workId } = await params;

  const doc = await getOwnedDocument(workId, session.user.id);
  if (!doc) notFound();
  if (doc.processingStatus !== "ready") {
    // Defensive guard only (Stage 4 spec §3.3) — the Reader tab in
    // `WorkContextHeader` is disabled for exactly this condition, so the UI
    // can no longer land here for a not-ready work. A direct URL visit
    // still needs an answer, though: the same disabled-tab explanation
    // instead of a silent bounce back to Details.
    const reason = tabDisabledReason({ status: doc.processingStatus, deletedAt: null });
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <p className="rounded-md border border-[var(--color-border)] px-4 py-3 text-sm text-[var(--color-text-muted)]">
          {reason ?? "The reader isn't available for this work yet."}{" "}
          <Link href={`/works/${workId}`} className="underline">
            View work details
          </Link>
          .
        </p>
      </div>
    );
  }

  const readerLevel = await getUserReaderLevel(session.user.id);
  return (
    <ReaderShell
      workId={workId}
      initialReaderLevel={readerLevel ?? "all"}
      enablePhase12Identity={phase12FeatureEnabled("libraryIdentity")}
      // Phase 16 makes the reliable processed reader the released contract;
      // it no longer hides source/processed labels or author apparatus behind
      // the retired Phase 12 rollout switch.
      enablePhase12Reader
      enablePhase18Rag={phase18RagEnabled()}
      enableReaderClaimLayer={phase25FeatureEnabled("readerClaimLayer")}
      enableEvidenceChips={phase25FeatureEnabled("research")}
      enableAskResearchModes={phase25FeatureEnabled("askResearchModes")}
      writerEnabled={phase12FeatureEnabled("writer")}
    />
  );
}
