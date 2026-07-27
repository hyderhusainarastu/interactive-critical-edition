import { phase25FeatureEnabled } from "@ice/config";
import { notFound } from "next/navigation";
import { CorpusView } from "@/components/research/CorpusView";
import { requireSession } from "@/lib/auth";
import { listCorpusItemsForProject } from "@/lib/research/corpus";
import { listResearchJobRequestsForProject } from "@/lib/research/jobs";
import { getOwnedResearchProject } from "@/lib/research/projects";

/** `/research/[projectId]/corpus` (Phase 30 fix lane): the previously
 *  unbuilt half of Phase 28's corpus-import surface — 28.1 built the
 *  project/claims pages and 28.2 built the worker/service side
 *  (`research_corpus_item`, `import_corpus` job handler), but no page ever
 *  read or wrote either. Import jobs (`jobType: "import_corpus"`) and this
 *  page's own "Extract claims" (`jobType: "extract_claims"`, scoped to a
 *  corpus item) both run async on the worker, so `initialJobRequests` is
 *  filtered to those two job types — the view polls them (Item 1(b), fix
 *  lane) so an import or extraction's real output appears automatically
 *  once the job completes, not only on the next full page load. */
export default async function ResearchProjectCorpusPage({ params }: { params: Promise<{ projectId: string }> }) {
  if (!phase25FeatureEnabled("research")) notFound();
  const session = await requireSession();
  const { projectId } = await params;
  const project = await getOwnedResearchProject(session.user.id, projectId, true);
  if (!project) notFound();
  const [items, jobRequests] = await Promise.all([
    listCorpusItemsForProject(session.user.id, projectId),
    listResearchJobRequestsForProject(session.user.id, projectId),
  ]);
  if (items === null) notFound();
  return (
    <CorpusView
      project={project}
      initialItems={items}
      initialImportJobs={jobRequests.filter((r) => r.jobType === "import_corpus" || r.jobType === "extract_claims")}
    />
  );
}
