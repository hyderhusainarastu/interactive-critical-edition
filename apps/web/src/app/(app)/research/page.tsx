import { phase25FeatureEnabled } from "@ice/config";
import { notFound } from "next/navigation";
import { ResearchProjectsView } from "@/components/research/ResearchProjectsView";
import { requireSession } from "@/lib/auth";
import { listResearchProjects } from "@/lib/research/projects";

export default async function ResearchPage() {
  if (!phase25FeatureEnabled("research")) notFound();
  const session = await requireSession();
  return <ResearchProjectsView initialProjects={await listResearchProjects(session.user.id)} />;
}
