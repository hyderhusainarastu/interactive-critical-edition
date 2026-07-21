import { requireSession } from "@/lib/auth";
import { getLibrary } from "@/lib/library";
import { getUserReaderLevel } from "@/lib/readerLevel";
import { LibraryView } from "./LibraryView";

/**
 * The Library (plan §34.4 9.5): every source the research pipeline has
 * recommended for one of the reader's own works, separate from `/works`
 * (the reader's own uploads). Populated only once a work has been analyzed
 * under the v3 pipeline — see `getLibrary`'s doc comment.
 */
export default async function LibraryPage() {
  const session = await requireSession();
  const items = await getLibrary(session.user.id);
  // Default-scope to the reader's saved global level (plan §10/§35.2, bringing
  // Library in line with Roadmap/Curriculum's established pattern); null
  // (never chosen) falls back to "all", same as Roadmap's own default.
  const readerLevel = await getUserReaderLevel(session.user.id);

  return (
    <LibraryView
      initialItems={items}
      initialReaderLevel={readerLevel ?? "all"}
      enablePhase12Identity={phase12FeatureEnabled("libraryIdentity")}
    />
  );
}
import { phase12FeatureEnabled } from "@ice/config";
