import { phase12FeatureEnabled, phase25FeatureEnabled } from "@ice/config";
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
  // Phase 28.5: the Evidence panel is its own independently addressable
  // flag (`requireWriterEvidenceApiUser`'s doc comment) — the panel simply
  // doesn't render (not a broken/erroring one) while it's off.
  return (
    <WriterEditor
      project={workspace.project}
      initialDocuments={workspace.documents}
      initialCitations={workspace.citations}
      evidenceEnabled={phase25FeatureEnabled("writerEvidence")}
    />
  );
}
