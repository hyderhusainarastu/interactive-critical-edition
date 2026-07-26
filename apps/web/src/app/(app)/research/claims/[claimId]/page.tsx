import { phase25FeatureEnabled } from "@ice/config";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClaimCorrectionExtras } from "@/components/research/ClaimCorrectionExtras";
import { ResearchCorrectionControls } from "@/components/research/ResearchCorrectionControls";
import { requireSession } from "@/lib/auth";
import { getResearchClaimDetail, listProjectIdsForWork } from "@/lib/research/claims";

const NATURE_LABEL: Record<string, string> = {
  empirical: "Empirical",
  textual: "Textual",
  interpretive: "Interpretive",
  historical: "Historical",
  conceptual: "Conceptual",
  normative: "Normative",
  definitional: "Definitional",
  methodological: "Methodological",
};
const ANCHOR_LABEL: Record<string, string> = { anchored: "Anchored to its original passage", rebound: "Re-matched after reprocessing", unanchored: "Anchor lost after reprocessing" };
const DIMENSION_LABEL: Record<string, string> = { evidence_strength: "Evidence strength", textual_support: "Textual support" };
const ORIGIN_LABEL: Record<string, string> = { excerpt: "the claim's own excerpt", block: "the claim's anchored passage", footnote: "a nearby footnote", citation: "a resolved citation" };

export default async function ResearchClaimPermalinkPage({ params }: { params: Promise<{ claimId: string }> }) {
  if (!phase25FeatureEnabled("research")) notFound();
  const session = await requireSession();
  const { claimId } = await params;
  const claim = await getResearchClaimDetail(session.user.id, claimId);
  if (!claim) notFound();
  const projectIds = claim.workId ? await listProjectIdsForWork(session.user.id, claim.workId) : [];
  const backProjectId = projectIds[0] ?? null;

  return (
    <article className="mx-auto max-w-3xl px-4 py-8 sm:px-6" aria-labelledby="research-claim-title">
      <p className="text-sm font-medium text-[var(--color-accent)]">
        <Link href="/research" className="underline">Research</Link>
        {backProjectId ? (
          <>
            {" "}/ <Link href={`/research/${backProjectId}/claims`} className="underline">Claims</Link>
          </>
        ) : null}
      </p>
      <h1 id="research-claim-title" className="mt-1 font-serif text-2xl font-semibold">{claim.claimText}</h1>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="app-control rounded-full border border-[var(--color-border)] px-2 py-0.5">{NATURE_LABEL[claim.claimNature] ?? claim.claimNature}</span>
        <span className="app-control rounded-full border border-[var(--color-border)] px-2 py-0.5">Confidence: {claim.confidence}</span>
        <span className="app-control rounded-full border border-[var(--color-border)] px-2 py-0.5">{claim.section}</span>
        {claim.workTitle && <span className="app-control rounded-full border border-[var(--color-border)] px-2 py-0.5">{claim.workTitle}</span>}
      </div>

      {/* Excerpt — a literal, re-verified substring of the source text
          (never paraphrased or repaired, plan §Pipeline "zero-tolerance"). */}
      <section className="app-card app-panel-enter mt-6 rounded-lg p-4" aria-labelledby="research-claim-excerpt-title">
        <div className="flex items-center justify-between gap-3">
          <h2 id="research-claim-excerpt-title" className="font-serif text-lg font-semibold">Supporting excerpt</h2>
          {claim.excerptVerified && <span className="app-control rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs">Passage verified</span>}
        </div>
        <blockquote className="mt-2 border-l-2 border-[var(--color-accent)] pl-3 text-sm italic">{claim.supportingExcerpt}</blockquote>
        {claim.workId && claim.hasReaderAnchor && (
          <Link href={`/works/${claim.workId}/reader`} className="app-control app-press mt-3 inline-block rounded border border-[var(--color-border)] px-3 py-1.5 text-sm">
            Open in reader
          </Link>
        )}
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          {claim.sourceScope === "abstract" ? "Drawn from an imported record's abstract — no full text was available." : ANCHOR_LABEL[claim.anchorState] ?? claim.anchorState}
        </p>
      </section>

      {/* Provenance — everything the DB actually records for this claim,
          nothing invented (`research_claim` stores prompt version + a
          self-reported confidence label, not a per-claim model/provider
          column — see the schema's own doc comment). */}
      <section className="app-card app-panel-enter mt-6 rounded-lg p-4" aria-labelledby="research-claim-provenance-title">
        <h2 id="research-claim-provenance-title" className="font-serif text-lg font-semibold">Provenance</h2>
        <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Prompt version</dt>
            <dd className="mt-0.5">{claim.promptVersion}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Confidence</dt>
            <dd className="mt-0.5 capitalize">{claim.confidence}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Verification</dt>
            <dd className="mt-0.5 capitalize">{claim.verificationStatus.replace(/_/g, " ")}</dd>
          </div>
        </dl>
      </section>

      {/* Review affordances (Phase 29.2): verify/dispute/hide/restore + a
          per-object revision history, and the claim-only edit/reclassify/
          split/merge actions. `applyResearchCorrection` is the only
          mutation path these controls ever call. */}
      <section className="app-card app-panel-enter mt-6 rounded-lg p-4" aria-labelledby="claim-review-title">
        <h2 id="claim-review-title" className="font-serif text-lg font-semibold">Review</h2>
        <div className="mt-2">
          <ResearchCorrectionControls objectType="claim" objectId={claim.id} verificationStatus={claim.verificationStatus} hidden={claim.hidden} />
        </div>
      </section>
      <ClaimCorrectionExtras
        claimId={claim.id}
        claimText={claim.claimText}
        supportingExcerpt={claim.supportingExcerpt}
        claimNature={claim.claimNature}
        anchorState={claim.anchorState}
      />

      {claim.scores.length > 0 && (
        <section className="app-card app-panel-enter mt-6 rounded-lg p-4" aria-labelledby="research-claim-scores-title">
          <h2 id="research-claim-scores-title" className="font-serif text-lg font-semibold">Scores</h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">Two independent dimensions — never averaged or compared against each other.</p>
          <ul className="mt-2 space-y-3">
            {claim.scores.map((score, index) => (
              <li key={`${score.dimension}-${index}`} className="rounded border border-[var(--color-border)] p-3 text-sm">
                <p className="font-medium">{DIMENSION_LABEL[score.dimension] ?? score.dimension}: <span className="capitalize">{score.label}</span> ({score.score.toFixed(2)})</p>
                {score.tier && <p className="mt-1 text-[var(--color-text-muted)]">Tier: {score.tier}</p>}
                {Array.isArray(score.signals) && score.signals.length > 0 && (
                  <ul className="mt-1 list-inside list-disc text-[var(--color-text-muted)]">
                    {(score.signals as string[]).map((signal, i) => <li key={i}>{signal}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {claim.loci.length > 0 && (
        <section className="app-card app-panel-enter mt-6 rounded-lg p-4" aria-labelledby="research-claim-loci-title">
          <h2 id="research-claim-loci-title" className="font-serif text-lg font-semibold">Loci</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {claim.loci.map((locus, index) => (
              <li key={`${locus.locusKey}-${index}`}>
                <span className="font-medium">{locus.rawLocus ?? locus.locusKey}</span>
                <span className="text-[var(--color-text-muted)]"> — from {ORIGIN_LABEL[locus.origin] ?? locus.origin}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
