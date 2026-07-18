import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
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

  return <ReaderShell workId={workId} />;
}
