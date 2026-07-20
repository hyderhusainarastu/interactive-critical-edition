import { requireSession } from "@/lib/auth";
import { getLibrary } from "@/lib/library";
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

  return <LibraryView initialItems={items} />;
}
