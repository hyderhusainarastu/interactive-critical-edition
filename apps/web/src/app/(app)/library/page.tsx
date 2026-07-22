import { requireSession } from "@/lib/auth";
import { getLibrary } from "@/lib/library";
import { getUserReaderLevel } from "@/lib/readerLevel";
import { LibraryView } from "./LibraryView";

/**
 * The Library (plan §34.4 9.5): every source the research pipeline has
 * recommended for one of the reader's own works, separate from `/works`
 * (the reader's own uploads). Sources appear only after analysis, while every
 * active upload remains available as a focus target — see `getLibrary`.
 */
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string | string[]; q?: string | string[] }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const requestedSearch = typeof params.q === "string" ? params.q : undefined;
  const library = await getLibrary(session.user.id, { search: requestedSearch });
  // Default-scope to the reader's saved global level (plan §10/§35.2, bringing
  // Library in line with Roadmap/Curriculum's established pattern); null
  // (never chosen) falls back to "all", same as Roadmap's own default.
  const readerLevel = await getUserReaderLevel(session.user.id);
  const requestedFocus = typeof params.focus === "string" ? params.focus : undefined;
  const initialFocusWorkId = requestedFocus && library.works.some((work) => work.id === requestedFocus)
    ? requestedFocus
    : (library.works[0]?.id ?? "");

  return (
    <LibraryView
      initialItems={library.items}
      initialWorks={library.works}
      initialFocusWorkId={initialFocusWorkId}
      initialReaderLevel={readerLevel ?? "all"}
      initialSearch={requestedSearch ?? ""}
      enablePhase12Identity={phase12FeatureEnabled("libraryIdentity")}
    />
  );
}
import { phase12FeatureEnabled } from "@ice/config";
