import { phase12FeatureEnabled } from "@ice/config";
import { notFound } from "next/navigation";
import { WriterEditor } from "@/components/writer/WriterEditor";
import { requireSession } from "@/lib/auth";
import { getWriterProjectWorkspace } from "@/lib/writerData";

export default async function WriterProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  if (!phase12FeatureEnabled("writer")) notFound();
  const session = await requireSession();
  const { projectId } = await params;
  const workspace = await getWriterProjectWorkspace(session.user.id, projectId);
  if (!workspace) notFound();
  return <WriterEditor project={workspace.project} initialDocuments={workspace.documents} initialCitations={workspace.citations} />;
}
