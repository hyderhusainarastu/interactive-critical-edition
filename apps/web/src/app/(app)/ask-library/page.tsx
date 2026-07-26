import { notFound } from "next/navigation";
import { phase18RagEnabled, phase25FeatureEnabled } from "@ice/config";
import { isResearchMode } from "@ice/rag";
import { PageHeader } from "@/components/app/PageHeader";
import { requireSession } from "@/lib/auth";
import { RagChatPanel } from "../works/[workId]/reader/RagChatPanel";

/**
 * The dedicated Phase 18 destination makes the owner-scoped Library chat
 * discoverable without requiring a reader toolbar. A conversation created
 * here has no work hint; retrieval is still limited to the signed-in owner's
 * eligible Library, as documented by the RAG schema and retrieval layer.
 *
 * Phase 28.6: `searchParams` (`?mode=find_counterarguments&claimId=...` etc.)
 * are the deep-link seed a future surface (the reader's Claims tab, the
 * graph debate layer) can use to open this page straight into a specific
 * research-mode scope — see `RagChatPanel`'s `initial*` prop doc comments.
 * An unrecognized/absent `mode` degrades to the plain socratic default,
 * never an error.
 */
export default async function AskLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; claimId?: string; clusterId?: string; workIdB?: string }>;
}) {
  await requireSession();
  if (!phase18RagEnabled()) notFound();
  const params = await searchParams;
  const askResearchModesEnabled = phase25FeatureEnabled("askResearchModes");
  const initialMode = askResearchModesEnabled && isResearchMode(params.mode) ? params.mode : undefined;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <PageHeader
        title="Ask your Library"
        description="A Socratic companion grounded only in your eligible Library sources. Every answer links to the passage it cites. Conversations here also help Palimnote gauge your familiarity with each topic, so explanations and your roadmap match your level."
      />
      <div className="mt-6">
        <RagChatPanel
          presentation="page"
          enableResearchModes={askResearchModesEnabled}
          initialMode={initialMode}
          initialClaimId={params.claimId}
          initialClusterId={params.clusterId}
          initialWorkIdB={params.workIdB}
        />
      </div>
    </div>
  );
}
