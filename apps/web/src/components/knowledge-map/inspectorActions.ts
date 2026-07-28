/**
 * The charter §12 inspector action map (spec §3), resolved as pure data —
 * no fetch calls here, only the decision of WHICH real endpoint (if any)
 * backs a given action for a given selected node/link, verified against
 * each candidate route's actual handler per spec §3's own citations. Kept
 * separate from `InspectorDrawer.tsx` so the resolution logic (which is
 * the part most likely to get subtly wrong — guessing an id shape, wiring
 * the wrong object type) is unit-testable without React/DOM.
 *
 * The one rule every function here follows: never guess. An action is only
 * ever `available` when the id shape it needs is REAL data already on the
 * node/link/context (charter §12 "Never render a button that only
 * pretends to work") — everything else returns an honest `unavailable`
 * entry with a specific reason, per spec §3's own "documented gap, not a
 * guess" posture.
 */
import type { SourceEntityKind } from "@ice/graph-display";
import type { GraphNode } from "../graph/types";
import type { KnowledgeMapDisplayLink, KnowledgeMapDisplayNode } from "./adapter";

// ---------------------------------------------------------------------
// Destination (charter §12 "Open ..." rows)
// ---------------------------------------------------------------------

export type ResolvedDestination = { href: string } | { unavailableReason: string } | null;

function firstOwnedWorkId(associatedWorkIds: readonly string[] | undefined): string | null {
  if (!associatedWorkIds) return null;
  const first = associatedWorkIds.find((id) => id.startsWith("work:"));
  return first ? first.slice("work:".length) : null;
}

/**
 * `displayNode.destination` is always the first choice (it is only ever
 * populated from a confirmed real route — `buildGraph()`/`resolveContextRoot.ts`).
 * When it's null, this constructs a route only for the id shapes that are
 * genuinely resolvable from `sourceEntity` alone (spec §3: "constructed
 * routes from known id fields for the rest ... claim/debate/chamber/
 * project ids are already carried on the synthesized `DisplayNode`'s
 * `sourceEntity`") — for kinds where the real route needs an id this node
 * doesn't carry (a debate/hypothesis/gap reached as a plain neighbor of a
 * work, with no project id anywhere on the contract), this returns an
 * honest unavailable reason rather than a route that would 404.
 */
export function resolveDestination(displayNode: KnowledgeMapDisplayNode, canonicalNode: GraphNode | null): ResolvedDestination {
  if (displayNode.destination) return { href: displayNode.destination };

  const sourceEntity = displayNode.sourceEntity;
  if (!sourceEntity) return null; // an aggregate/synthetic node has no "open" concept at all

  if (sourceEntity.kind === "research_claim") return { href: `/research/claims/${sourceEntity.id}` };
  if (sourceEntity.kind === "research_project") return { href: `/research/${sourceEntity.id}` };

  if (sourceEntity.kind === "text_block") {
    // A section belongs to exactly one of the reader's own works — real
    // Reader passage anchoring doesn't exist today (see
    // `resolveContextRoot.ts`'s own doc comment, which already
    // investigated this), so this links to that work's whole Reader, never
    // a fabricated anchor.
    const ownedWorkId = firstOwnedWorkId(canonicalNode?.associatedWorkIds);
    return ownedWorkId ? { href: `/works/${ownedWorkId}/reader` } : { unavailableReason: "This passage's owning work isn't open here yet." };
  }

  if (sourceEntity.kind === "debate_cluster" || sourceEntity.kind === "research_hypothesis" || sourceEntity.kind === "research_gap") {
    // The real routes for these are project-scoped
    // (`/research/[projectId]/debates/[clusterId]`, per `resolveContextRoot.ts`),
    // and a project id isn't carried on the canonical contract for a node
    // reached as a plain graph neighbor — never guess it.
    return { unavailableReason: "Open this from its research project — a direct link isn't available from here yet." };
  }

  return { unavailableReason: "No destination is available for this node yet." };
}

// ---------------------------------------------------------------------
// Node-level scholarly actions: Verify / Dispute / Edit / Reclassify /
// Add evidence / Request reprocessing (charter §12)
// ---------------------------------------------------------------------

export type CorrectionObjectType = "claim" | "relationship" | "cluster" | "chamber" | "hypothesis" | "gap";

/** `apps/web/src/app/api/research/corrections/route.ts`'s own `objectType`
 *  enum, mapped from the display contract's `SourceEntityKind` — see that
 *  route's schema for the authoritative list this must stay in sync with. */
const CORRECTION_OBJECT_TYPE_BY_SOURCE_ENTITY: Partial<Record<SourceEntityKind, CorrectionObjectType>> = {
  research_claim: "claim",
  claim_relationship: "relationship",
  debate_cluster: "cluster",
  research_hypothesis: "hypothesis",
  research_gap: "gap",
};

export interface ScholarlyActionRequest {
  url: string;
  method: "POST" | "PATCH";
  /** The base request body — a caller merging in a user-entered `reason`
   *  (Dispute) or `changes` (Edit/Reclassify) spreads its own fields on top
   *  of this, never replaces it. */
  body: Record<string, unknown>;
}

export interface ScholarlyAction {
  id: string;
  label: string;
  request: ScholarlyActionRequest;
  /** Dispute needs a short reason before submit (charter §6 "inline
   *  validation", spec §3) — an accessible inline field, never
   *  `window.prompt`. */
  requiresReason?: boolean;
  /** Edit/Reclassify/Add-evidence need caller-supplied field values before
   *  submit — named here so the drawer knows which inputs to render. */
  requiresFields?: ("claimText" | "supportingExcerpt" | "claimNature")[];
}

export interface UnavailableScholarlyAction {
  id: string;
  label: string;
  reason: string;
}

export interface NodeScholarlyActions {
  available: ScholarlyAction[];
  unavailable: UnavailableScholarlyAction[];
}

const CORRECTIONS_URL = "/api/research/corrections";

export function resolveNodeScholarlyActions(displayNode: KnowledgeMapDisplayNode): NodeScholarlyActions {
  const available: ScholarlyAction[] = [];
  const unavailable: UnavailableScholarlyAction[] = [];

  const sourceEntity = displayNode.sourceEntity;
  const objectType = sourceEntity ? CORRECTION_OBJECT_TYPE_BY_SOURCE_ENTITY[sourceEntity.kind] : undefined;

  if (objectType && sourceEntity) {
    available.push(
      {
        id: "verify",
        label: "Verify",
        request: { url: CORRECTIONS_URL, method: "POST", body: { objectType, objectId: sourceEntity.id, action: "verified" } },
      },
      {
        id: "dispute",
        label: "Dispute",
        requiresReason: true,
        request: { url: CORRECTIONS_URL, method: "POST", body: { objectType, objectId: sourceEntity.id, action: "disputed" } },
      },
    );

    if (objectType === "claim") {
      available.push(
        {
          id: "edit",
          label: "Edit claim text",
          requiresFields: ["claimText"],
          request: { url: CORRECTIONS_URL, method: "POST", body: { objectType, objectId: sourceEntity.id, action: "edited" } },
        },
        {
          id: "reclassify",
          label: "Reclassify",
          requiresFields: ["claimNature"],
          request: { url: CORRECTIONS_URL, method: "POST", body: { objectType, objectId: sourceEntity.id, action: "reclassified" } },
        },
        {
          // Spec §3: reuses the SAME `edited` mechanism as Edit (the
          // corrections API has no separate "add a second evidence item"
          // concept) — the copy says "Update supporting excerpt," never
          // "Add evidence," so it never implies a multi-evidence list this
          // app doesn't have.
          id: "update-excerpt",
          label: "Update supporting excerpt",
          requiresFields: ["supportingExcerpt"],
          request: { url: CORRECTIONS_URL, method: "POST", body: { objectType, objectId: sourceEntity.id, action: "edited" } },
        },
      );
    } else {
      unavailable.push(
        { id: "edit", label: "Edit", reason: "Editing isn't supported for this type yet." },
        { id: "reclassify", label: "Reclassify", reason: "Reclassifying isn't supported for this type yet." },
      );
    }
  } else {
    unavailable.push(
      { id: "verify", label: "Verify", reason: "This isn't a research object that can be verified." },
      { id: "dispute", label: "Dispute", reason: "This isn't a research object that can be disputed." },
    );
  }

  if (sourceEntity?.kind === "work") {
    available.push({
      id: "reprocess",
      label: "Request reprocessing",
      request: { url: `/api/works/${sourceEntity.id}/reprocess`, method: "POST", body: {} },
    });
  } else {
    unavailable.push({ id: "reprocess", label: "Request reprocessing", reason: "Reprocessing only applies to your own uploaded works." });
  }

  return { available, unavailable };
}

// ---------------------------------------------------------------------
// Link-level actions: Remove a relationship / Mark uncertain (charter §12)
// ---------------------------------------------------------------------

export interface LinkAction {
  request: ScholarlyActionRequest;
}
export interface UnavailableLinkAction {
  reason: string;
}

export interface ResolvedLinkActions {
  removeRelationship: LinkAction | UnavailableLinkAction;
  markUncertain: LinkAction | UnavailableLinkAction;
}

/**
 * `rootWorkId` is only meaningful (non-null) when the current context is a
 * `"work"` context — a passage annotation belongs to exactly one document,
 * and the currently-open work IS that document's owner in every case this
 * step's data flow can reach (§2.2 scope note: context-scoped synthesis
 * for other context kinds isn't built yet).
 */
export function resolveLinkActions(link: KnowledgeMapDisplayLink, rootWorkId: string | null): ResolvedLinkActions {
  // "Remove a relationship" (spec §3): only applies to a `claim_relationship`
  // row surfaced as an edge inside a debate/claim expansion — this
  // adapter step (§2.2) doesn't synthesize those edges yet, so this is
  // honestly always unavailable today, not a guess at an endpoint whose
  // real shape isn't reachable from here.
  const removeRelationship: LinkAction | UnavailableLinkAction = {
    reason: "This relationship was generated during analysis and can't be edited here yet.",
  };

  // "Mark uncertain" (spec §3): a passage-annotation-sourced edge's
  // `provenance.relationId` IS the `passage_annotation.id` (the display
  // contract mirrors the canonical `GraphLink.provenance` shape verbatim —
  // see `types.ts`'s own doc comment) — realistically scoped to
  // passage-annotation-sourced edges in practice, per spec §3's own note.
  const relationId = link.provenance?.relationId ?? null;
  const markUncertain: LinkAction | UnavailableLinkAction =
    relationId && rootWorkId
      ? {
          request: {
            url: `/api/works/${rootWorkId}/reader/passage-annotations/${relationId}`,
            method: "PATCH",
            body: { verificationStatus: "disputed" },
          },
        }
      : { reason: "This relationship has no owner-scoped annotation to mark uncertain here." };

  return { removeRelationship, markUncertain };
}

// ---------------------------------------------------------------------
// Reading status / mastery (charter §12)
// ---------------------------------------------------------------------

export type ReadingStatusTarget =
  | { kind: "roadmap-item"; url: string; bibId: string }
  | { kind: "library-status"; url: string; resourceId: string }
  | null;

/**
 * Spec §3: "The inspector picks whichever endpoint matches the node's own
 * id shape ... never guesses; a node with neither shape ... simply does
 * not render reading-status controls." A `bibliographic_record`-backed
 * node is the one shape this step resolves with full confidence (the
 * `bibId` IS `sourceEntity.id`, and `rootWorkId` scopes the roadmap the
 * rating is recorded against). A `research_resource`-backed node is
 * DELIBERATELY left unresolved here — `adapter.ts`'s own doc comment
 * records that an `external:source:` id can back either a
 * `research_resource` OR a `learning_resource` row via the same
 * `normalized_key`, and the two are different primary keys; guessing which
 * one `/api/library/[resourceId]/status` expects risks writing a rating
 * against the wrong row, which is worse than not offering the control.
 */
export function resolveReadingStatusTarget(displayNode: KnowledgeMapDisplayNode, rootWorkId: string | null): ReadingStatusTarget {
  if (displayNode.sourceEntity?.kind === "bibliographic_record" && rootWorkId) {
    return { kind: "roadmap-item", url: `/api/works/${rootWorkId}/roadmap/item`, bibId: displayNode.sourceEntity.id };
  }
  return null;
}

// ---------------------------------------------------------------------
// Cited-only work (charter §12's closing paragraph)
// ---------------------------------------------------------------------

export interface CitedOnlyInfo {
  /** Owned work ids (no `work:` prefix) that cite/reference this record —
   *  `GraphNode.associatedWorkIds` is already exactly "which of the
   *  reader's own uploads this node is directly associated with", computed
   *  server-side (`lib/graph.ts`) — reused verbatim, never re-derived from
   *  link traversal here. */
  citingWorkIds: string[];
}

/**
 * `"missing"` is this project's own already-established definition of
 * "referenced but not acquired" (see PROJECT-LOG's Design Decisions row:
 * "'Missing link' = a referenced bibliographic_record with no owned work
 * matching it") — reused directly rather than re-deriving a second
 * definition of "cited-only" from `destination`/`uploaded` fields.
 */
export function resolveCitedOnlyInfo(canonicalNode: GraphNode | null): CitedOnlyInfo | null {
  if (!canonicalNode || canonicalNode.state !== "missing") return null;
  const citingWorkIds = (canonicalNode.associatedWorkIds ?? [])
    .filter((id) => id.startsWith("work:"))
    .map((id) => id.slice("work:".length));
  return { citingWorkIds };
}
