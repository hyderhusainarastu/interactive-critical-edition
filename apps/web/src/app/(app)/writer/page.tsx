import { phase12FeatureEnabled } from "@ice/config";
import { notFound } from "next/navigation";
import { WriterProjectsView } from "@/components/writer/WriterProjectsView";
import { requireSession } from "@/lib/auth";
import { listWriterProjects } from "@/lib/writerData";

export default async function WriterPage() {
  if (!phase12FeatureEnabled("writer")) notFound();
  const session = await requireSession();
  return <WriterProjectsView initialProjects={await listWriterProjects(session.user.id)} />;
}
