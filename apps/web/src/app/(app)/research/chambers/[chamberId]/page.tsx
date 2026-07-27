import { phase25FeatureEnabled } from "@ice/config";
import { notFound } from "next/navigation";
import { CREDIBILITY_DIMENSIONS, CREDIBILITY_DIMENSION_LABEL } from "@/components/graph/types";
import { ResearchBreadcrumb } from "@/components/research/ResearchBreadcrumb";
import { ResearchCorrectionControls } from "@/components/research/ResearchCorrectionControls";
import { requireSession } from "@/lib/auth";
import { getEvidenceChamberView, type ChamberPositionClaimView, type PositionSourceCredibility } from "@/lib/research/chambers";

const STANCE_LABEL: Record<string, string> = { high: "High", medium: "Medium", low: "Low" };
const SCORE_DIMENSION_LABEL: Record<string, string> = { evidence_strength: "Evidence strength", textual_support: "Textual support" };
const SCORE_LABEL_TEXT: Record<string, string> = { strong: "Strong", moderate: "Moderate", weak: "Weak" };

/** The `factLine` precedent from `GraphInspector.tsx`, duplicated in
 *  miniature — `creator`/`popularity` are displayed facts, never scored
 *  (plan §33), so this only ever formats, never ranks or aggregates them. */
function factLine(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("name" in record || "identity" in record) {
      const name = record.name ?? record.identity;
      const corroboration = record.corroboration ?? record.corroboratedBy ?? record.basis;
      return corroboration ? `${name} (${corroboration})` : String(name);
    }
    if ("value" in record) {
      const unit = record.unit ? ` ${record.unit}` : "";
      const provider = record.provider ? ` — ${record.provider}` : "";
      return `${record.value}${unit}${provider}`;
    }
  }
  return null;
}

function SourceCredibilityCard({ credibility }: { credibility: PositionSourceCredibility }) {
  const creatorFact = factLine(credibility.creator);
  const popularityFact = factLine(credibility.popularity);
  return (
    <div className="mt-3 rounded border border-[var(--color-border)] p-3 text-xs">
      <p className="text-sm font-medium">Position-level source credibility — {credibility.workTitle}</p>
      <p className="mt-1 text-[var(--color-text-muted)]">
        {credibility.authority ? `Authority ${credibility.authority}` : "Authority unassessed"} · credibility {Math.round(credibility.score * 100)}%
      </p>
      <ul className="mt-2 space-y-1">
        {CREDIBILITY_DIMENSIONS.map((dimension) => {
          const value = credibility[dimension];
          if (value == null) return null;
          return (
            <li key={dimension} className="flex items-center justify-between gap-2">
              <span>{CREDIBILITY_DIMENSION_LABEL[dimension]}</span>
              <span className="font-mono">{Math.round(value * 100)}%</span>
            </li>
          );
        })}
      </ul>
      {credibility.peerReviewed != null && <p className="mt-2">{credibility.peerReviewed ? "Peer reviewed" : "Not peer reviewed"}</p>}
      {credibility.rationale && <blockquote className="mt-2 border-l-2 border-[var(--color-border)] pl-2 italic text-[var(--color-text-muted)]">“{credibility.rationale}”</blockquote>}
      {creatorFact && <p className="mt-2">Creator: {creatorFact}</p>}
      {popularityFact && <p className="mt-1">Popularity: {popularityFact}</p>}
    </div>
  );
}

function ClaimScores({ claim }: { claim: ChamberPositionClaimView }) {
  if (claim.scores.length === 0) return null;
  return (
    <ul className="mt-2 space-y-2">
      {claim.scores.map((score, index) => (
        <li key={`${score.dimension}-${index}`} className="rounded border border-[var(--color-border)] p-2 text-xs">
          <p className="font-medium">
            Claim-level {SCORE_DIMENSION_LABEL[score.dimension] ?? score.dimension}: {SCORE_LABEL_TEXT[score.label] ?? score.label} ({score.score.toFixed(2)})
          </p>
          {score.tier && <p className="mt-1 text-[var(--color-text-muted)]">Tier: {score.tier}</p>}
          {Array.isArray(score.signals) && score.signals.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-[var(--color-text-muted)]">
              {(score.signals as string[]).map((signal, i) => <li key={i}>{signal}</li>)}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

export default async function EvidenceChamberPage({ params }: { params: Promise<{ chamberId: string }> }) {
  if (!phase25FeatureEnabled("research")) notFound();
  const session = await requireSession();
  const { chamberId } = await params;
  const chamber = await getEvidenceChamberView(session.user.id, chamberId);
  if (!chamber) notFound();

  return (
    <article className="mx-auto max-w-3xl px-4 py-8 sm:px-6" aria-labelledby="evidence-chamber-title">
      <ResearchBreadcrumb
        items={[
          { label: "Research", href: "/research" },
          { label: chamber.projectTitle, href: `/research/${chamber.projectId}` },
          { label: "Debates", href: `/research/${chamber.projectId}/debates` },
          { label: chamber.clusterName, href: `/research/${chamber.projectId}/debates/${chamber.clusterId}` },
          { label: "Evidence chamber" },
        ]}
      />
      <h1 id="evidence-chamber-title" className="mt-1 font-serif text-2xl font-semibold">{chamber.question}</h1>
      <p className="mt-2 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Evidence Chamber — a neutral map of this disagreement, not a ruling on it</p>

      {/* Review affordances (Phase 29.2): verify/dispute/hide/restore the
          chamber as a whole, plus its revision history. */}
      <section className="app-card app-panel-enter mt-4 rounded-lg p-4" aria-labelledby="chamber-review-title">
        <h2 id="chamber-review-title" className="font-serif text-lg font-semibold">Review</h2>
        <div className="mt-2">
          <ResearchCorrectionControls objectType="chamber" objectId={chamber.id} verificationStatus={chamber.verificationStatus} hidden={chamber.hidden} />
        </div>
      </section>

      {/* The chamber's own structured comparison — every brief field, none omitted. */}
      <section className="app-card app-panel-enter mt-6 rounded-lg p-4" aria-labelledby="chamber-shared-ground-title">
        <h2 id="chamber-shared-ground-title" className="font-serif text-lg font-semibold">Shared ground</h2>
        <p className="mt-2 text-sm">{chamber.sharedGround}</p>
      </section>

      <section className="app-card app-panel-enter mt-4 rounded-lg p-4" aria-labelledby="chamber-divergence-title">
        <h2 id="chamber-divergence-title" className="font-serif text-lg font-semibold">Point of divergence</h2>
        <p className="mt-2 text-sm">{chamber.pointOfDivergence}</p>
      </section>

      <section className="app-card app-panel-enter mt-4 rounded-lg p-4" aria-labelledby="chamber-reconciliation-title">
        <h2 id="chamber-reconciliation-title" className="font-serif text-lg font-semibold">Possible reconciliation</h2>
        <p className="mt-2 text-sm">{chamber.possibleReconciliation}</p>
      </section>

      <section className="app-card app-panel-enter mt-4 rounded-lg p-4" aria-labelledby="chamber-unresolved-title">
        <h2 id="chamber-unresolved-title" className="font-serif text-lg font-semibold">Unresolved question</h2>
        <p className="mt-2 text-sm">{chamber.unresolvedQuestion}</p>
      </section>

      <section className="app-card app-panel-enter mt-4 rounded-lg p-4" aria-labelledby="chamber-missing-evidence-title">
        <h2 id="chamber-missing-evidence-title" className="font-serif text-lg font-semibold">Missing evidence</h2>
        <p className="mt-2 text-sm">{chamber.missingEvidence}</p>
      </section>

      <section className="app-card app-panel-enter mt-4 rounded-lg p-4" aria-labelledby="chamber-next-action-title">
        <h2 id="chamber-next-action-title" className="font-serif text-lg font-semibold">Next action</h2>
        <p className="mt-2 text-sm">{chamber.nextAction}</p>
      </section>

      {/* Positions — rendered in ordinal order, never re-sorted by any score
          (plan §Schema "positions render in ordinal order"; no field named
          winner/verdict/stronger exists anywhere on this page's data). */}
      <section className="mt-8" aria-labelledby="chamber-positions-title">
        <h2 id="chamber-positions-title" className="font-serif text-xl font-semibold">Positions</h2>
        {chamber.positions.length === 0 && (
          <p className="app-empty app-mount mt-3 rounded-lg p-4 text-sm text-[var(--color-text-muted)]">
            This chamber has no distinct positions on record — every claim in its debate converged on shared ground with
            nothing to contrast.
          </p>
        )}
        <ol className="app-reveal-stagger mt-3 space-y-4">
          {chamber.positions.map((position) => (
            <li key={position.id} className="app-mount app-card rounded-lg border border-[var(--color-border)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-serif text-lg font-semibold">{position.label}</h3>
                <span className="app-control rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs">
                  Stance confidence: {STANCE_LABEL[position.stanceConfidenceLabel] ?? position.stanceConfidenceLabel}
                </span>
              </div>
              <p className="mt-2 text-sm">{position.summary}</p>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="uppercase tracking-wide text-[var(--color-text-muted)]">Method</dt>
                  <dd className="mt-0.5">{position.method}</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wide text-[var(--color-text-muted)]">Scope</dt>
                  <dd className="mt-0.5">{position.scope}</dd>
                </div>
              </dl>

              {position.sourceCredibility && <SourceCredibilityCard credibility={position.sourceCredibility} />}

              <div className="mt-3">
                <h4 className="text-sm font-medium">Grounding claims</h4>
                <ul className="mt-2 space-y-3">
                  {position.claims.map((claim) => (
                    <li key={claim.id} className="rounded border border-[var(--color-border)] p-3 text-sm">
                      <blockquote className="border-l-2 border-[var(--color-accent)] pl-2 italic">{claim.excerpt}</blockquote>
                      {claim.workTitle && <p className="mt-1 text-xs text-[var(--color-text-muted)]">{claim.workTitle}</p>}
                      <ClaimScores claim={claim} />
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Provenance — mandatory, per the Evidence Chamber contract. */}
      <section className="app-card app-panel-enter mt-6 rounded-lg p-4" aria-labelledby="chamber-provenance-title">
        <h2 id="chamber-provenance-title" className="font-serif text-lg font-semibold">Provenance</h2>
        <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Provider</dt>
            <dd className="mt-0.5">{chamber.provider}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Model</dt>
            <dd className="mt-0.5">{chamber.model}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Prompt version</dt>
            <dd className="mt-0.5">{chamber.promptVersion}</dd>
          </div>
        </dl>
      </section>
    </article>
  );
}
