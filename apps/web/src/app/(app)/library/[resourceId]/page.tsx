import { db, documents, learningResources, resourceRoles, works } from "@ice/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/app/PageHeader";
import { SOURCE_TYPE_LABEL } from "@/lib/librarySearch";
import { LibrarySourceAttach } from "./LibrarySourceAttach";

/**
 * Library entry detail (plan §20.4). A `learning_resource` recommended for
 * one of the reader's own works has no owned document of its own — this is
 * the surface that offers "Upload source text" for exactly that case, and
 * otherwise honestly explains why the option isn't offered (full text
 * already owned, or this entry has no established canonical identity to
 * check against).
 *
 * Owner scoping mirrors `getLibrary()` (`lib/library.ts`, owned by 20.6):
 * `learning_resource` rows are a shared catalog, not per-user secrets, but
 * this detail page is reached only from a user's own Library, so a
 * resource with no `resource_role` pointing at one of the caller's owned
 * work identities 404s exactly like any other cross-account lookup.
 */
export default async function LibraryItemPage({
  params,
}: {
  params: Promise<{ resourceId: string }>;
}) {
  const session = await requireSession();
  const { resourceId } = await params;

  const [resource] = await db
    .select()
    .from(learningResources)
    .where(eq(learningResources.id, resourceId))
    .limit(1);
  if (!resource) notFound();

  const ownedWorks = await db
    .select({ id: works.id, workIdentityId: works.workIdentityId })
    .from(works)
    .where(and(eq(works.userId, session.user.id), isNull(works.deletedAt)));
  const ownedIdentityIds = [...new Set(ownedWorks.map((w) => w.workIdentityId).filter((id): id is string => id !== null))];
  if (!ownedIdentityIds.length) notFound();

  const [role] = await db
    .select({ id: resourceRoles.id })
    .from(resourceRoles)
    .where(and(eq(resourceRoles.learningResourceId, resourceId), inArray(resourceRoles.workIdentityId, ownedIdentityIds)))
    .limit(1);
  if (!role) notFound();

  // Eligibility (plan §20.4: "show the option only when no eligible full
  // text exists"): does the caller already own a non-deleted work, WITH a
  // document, sharing this resource's own canonical identity? A resource
  // with no established identity yet can't be checked this way — treated
  // as eligible, same as a brand-new discovery with nothing to compare
  // against.
  let existingOwned: { workId: string; title: string } | null = null;
  if (resource.workIdentityId) {
    const [existing] = await db
      .select({ workId: works.id, title: works.title })
      .from(works)
      .innerJoin(documents, eq(documents.workId, works.id))
      .where(and(eq(works.userId, session.user.id), eq(works.workIdentityId, resource.workIdentityId), isNull(works.deletedAt)))
      .limit(1);
    existingOwned = existing ?? null;
  }

  const authors = Array.isArray(resource.authors) ? (resource.authors as string[]) : [];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-12">
      <div>
        <p className="text-sm text-[var(--color-text-muted)]">Library entry</p>
        <PageHeader
          title={resource.title}
          description={
            <>
              {authors.length > 0 && <span>{authors.join(", ")} · </span>}
              {resource.year != null && <span>{resource.year} · </span>}
              <span>{SOURCE_TYPE_LABEL[resource.resourceType] ?? resource.resourceType}</span>
            </>
          }
        />
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm sm:grid-cols-2">
        {resource.venue && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Venue</dt>
            <dd className="text-[var(--color-text)]">{resource.venue}</dd>
          </div>
        )}
        {resource.doi && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">DOI</dt>
            <dd className="text-[var(--color-text)]">{resource.doi}</dd>
          </div>
        )}
        {resource.isbn && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">ISBN</dt>
            <dd className="text-[var(--color-text)]">{resource.isbn}</dd>
          </div>
        )}
        {resource.url && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Source</dt>
            <dd>
              <a href={resource.url} target="_blank" rel="noreferrer" className="text-[var(--color-text)] underline">
                {resource.url}
              </a>
            </dd>
          </div>
        )}
      </dl>

      {existingOwned ? (
        <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-text-muted)]">
          You already have the full text of this work in your Library —{" "}
          <Link href={`/works/${existingOwned.workId}`} className="underline">
            open &ldquo;{existingOwned.title}&rdquo;
          </Link>
          .
        </p>
      ) : (
        <LibrarySourceAttach resourceId={resource.id} resourceTitle={resource.title} />
      )}
    </div>
  );
}
