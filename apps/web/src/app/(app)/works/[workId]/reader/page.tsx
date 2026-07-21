import { notFound, redirect } from "next/navigation";
import { phase12FeatureEnabled } from "@ice/config";
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
    />
  );
}
