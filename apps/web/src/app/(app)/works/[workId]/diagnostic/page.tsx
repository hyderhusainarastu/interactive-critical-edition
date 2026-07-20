import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getOwnedDocument } from "@/lib/works";
import { DiagnosticView } from "./DiagnosticView";

export default async function DiagnosticPage({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const session = await requireSession();
  const { workId } = await params;

  const doc = await getOwnedDocument(workId, session.user.id);
  if (!doc) notFound();

  return <DiagnosticView workId={workId} title={doc.title} />;
}
