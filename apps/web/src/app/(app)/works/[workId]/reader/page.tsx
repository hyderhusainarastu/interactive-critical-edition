import { notFound, redirect } from "next/navigation";
import { phase12FeatureEnabled, phase18RagEnabled, phase25FeatureEnabled } from "@ice/config";
import { requireSession } from "@/lib/auth";
import { getUserReaderLevel } from "@/lib/readerLevel";
import { getOwnedDocument } from "@/lib/works";
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
    redirect(`/works/${workId}`);
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
    />
  );
}
