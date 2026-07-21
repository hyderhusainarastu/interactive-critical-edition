import { notFound } from "next/navigation";
import { phase12FeatureEnabled } from "@ice/config";
import { defaultRouteForReaderLevel } from "@ice/curriculum";
import { requireSession } from "@/lib/auth";
import { getUserReaderLevel } from "@/lib/readerLevel";
import { getOwnedDocument } from "@/lib/works";
import { CurriculumView } from "./CurriculumView";

export default async function CurriculumPage({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const session = await requireSession();
  const { workId } = await params;

  const doc = await getOwnedDocument(workId, session.user.id);
  if (!doc) notFound();

  // Default route from the reader's saved global level (plan §34.4 9.6);
  // picking a different route on the page is a view filter only and never
  // writes back to the profile — same rule 9.4 established for reader levels.
  const readerLevel = await getUserReaderLevel(session.user.id);

  return (
    <CurriculumView
      workId={workId}
      title={doc.title}
      initialRoute={defaultRouteForReaderLevel(readerLevel)}
      initialReaderLevel={readerLevel ?? "all"}
      enablePhase12Identity={phase12FeatureEnabled("libraryIdentity")}
    />
  );
}
