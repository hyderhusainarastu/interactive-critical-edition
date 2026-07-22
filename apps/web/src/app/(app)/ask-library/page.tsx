import { notFound } from "next/navigation";
import { phase18RagEnabled } from "@ice/config";
import { PageHeader } from "@/components/app/PageHeader";
import { requireSession } from "@/lib/auth";
import { RagChatPanel } from "../works/[workId]/reader/RagChatPanel";

/**
 * The dedicated Phase 18 destination makes the owner-scoped Library chat
 * discoverable without requiring a reader toolbar. A conversation created
 * here has no work hint; retrieval is still limited to the signed-in owner's
 * eligible Library, as documented by the RAG schema and retrieval layer.
 */
export default async function AskLibraryPage() {
  await requireSession();
  if (!phase18RagEnabled()) notFound();

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <PageHeader
        title="Ask your Library"
        description="A Socratic companion grounded only in your eligible Library sources. Every answer links to the passage it cites."
      />
      <div className="mt-6">
        <RagChatPanel presentation="page" />
      </div>
    </div>
  );
}
