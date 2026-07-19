"use client";

import { useMemo, useState } from "react";

type Authority = "A" | "B" | "C" | "D" | "E";
type Agreement = "strong" | "contested" | "mixed" | "insufficient";

export interface EditionClaim {
  id: string;
  text: string;
  claimType: "factual" | "interpretive" | "inferred";
  agreement: Agreement;
  confidence: number;
  evidence: Array<{ stance: string; quote: string | null; resourceId: string | null }>;
}

export interface EditionResource {
  id: string;
  title: string;
  url: string | null;
  provider: string;
  resourceType: string;
  doi: string | null;
  year: number | null;
  authors: unknown;
  inspectionDepth: number;
  credibility: {
    authority: Authority | null;
    agreement: Agreement | null;
    relevance: number | null;
    evidenceStrength: number | null;
    inspectionDepth: number;
    score: number;
    rationale: string | null;
  } | null;
}

export interface EditionPayload {
  run: { version: number; structureState: "full" | "limited"; note: string | null; status: string; stage: string | null };
  cost: { aiCostUsd: number; degraded: boolean; saturationNote: string | null };
  pages: Array<{ id: string; pageIndex: number; text: string | null; isOcr: boolean; extractionConfidence: number | null }>;
  blocks: Array<{ id: string; pageId: string; blockOrder: number; kind: string; text: string }>;
  authorialNotes: Array<{ id: string; marker: string; text: string }>;
  generatedNotes: Array<{
    id: string;
    noteType: string;
    body: string;
    confidence: number;
    evidence: { quote: string | null; resourceId: string | null } | null;
    claims: EditionClaim[];
  }>;
  resources: EditionResource[];
  relations: Array<{ id: string; resourceId: string | null; relatedResourceId: string | null; relationType: string; depth: number; importance: number | null }>;
  providerReports: Array<{ provider: string; status: string; resultCount: number; inspectionDepth: number; latencyMs: number; error: string | null }>;
}

const AUTHORITY_LABEL: Record<Authority, string> = {
  A: "A · peer-reviewed / primary",
  B: "B · reputable scholarship",
  C: "C · credible web",
  D: "D · general web / video",
  E: "E · unverified / social",
};
const AGREEMENT_LABEL: Record<Agreement, string> = {
  strong: "strong agreement",
  contested: "contested",
  mixed: "mixed evidence",
  insufficient: "insufficient corroboration",
};

function AuthorityBadge({ authority }: { authority: Authority | null }) {
  if (!authority) return null;
  const color = authority === "A" || authority === "B" ? "var(--color-accent-green)" : authority === "C" ? "var(--color-accent-ink)" : "var(--color-border)";
  return (
    <span className="inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium" style={{ borderColor: color }} title={AUTHORITY_LABEL[authority]}>
      {AUTHORITY_LABEL[authority]}
    </span>
  );
}

function ClaimTypeBadge({ type }: { type: EditionClaim["claimType"] }) {
  const label = type === "factual" ? "factual" : type === "inferred" ? "AI-inferred" : "interpretive";
  return <span className="rounded bg-[var(--color-bg)] px-1.5 py-0.5 text-xs text-[var(--color-text-muted)]">{label}</span>;
}

function ClaimView({ claim }: { claim: EditionClaim }) {
  const [open, setOpen] = useState(false);
  const supporting = claim.evidence.filter((e) => e.stance === "supports" && e.quote);
  const contradicting = claim.evidence.filter((e) => e.stance === "contradicts" && e.quote);
  const hasEvidence = supporting.length > 0 || contradicting.length > 0;
  return (
    <li className="rounded border border-[var(--color-border)] p-2">
      <div className="flex flex-wrap items-center gap-2">
        <ClaimTypeBadge type={claim.claimType} />
        <span className="text-xs text-[var(--color-text-muted)]">{AGREEMENT_LABEL[claim.agreement]}</span>
        <span className="ml-auto text-xs text-[var(--color-text-muted)]">{Math.round(claim.confidence * 100)}%</span>
      </div>
      <p className="mt-1">{claim.text}</p>
      {hasEvidence && (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-1 text-xs underline">
          {open ? "Hide evidence" : `Evidence (${supporting.length + contradicting.length})`}
        </button>
      )}
      {open && hasEvidence && (
        // Competing interpretations side by side when both sides exist.
        <div className={`mt-2 grid gap-2 ${contradicting.length ? "sm:grid-cols-2" : "grid-cols-1"}`}>
          {supporting.length > 0 && (
            <div>
              <p className="text-xs font-medium text-[var(--color-accent-green)]">Supporting</p>
              <ul className="mt-1 flex flex-col gap-1">
                {supporting.map((e, i) => <li key={i} className="border-l-2 border-[var(--color-accent-green)] pl-2 text-xs italic">“{e.quote}”</li>)}
              </ul>
            </div>
          )}
          {contradicting.length > 0 && (
            <div>
              <p className="text-xs font-medium text-[var(--color-accent-ink)]">Contradicting</p>
              <ul className="mt-1 flex flex-col gap-1">
                {contradicting.map((e, i) => <li key={i} className="border-l-2 border-[var(--color-accent-ink)] pl-2 text-xs italic">“{e.quote}”</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** Published-run reader: authorial (source) notes and AI-generated editorial
 * material are visibly distinct; every generated claim exposes its source-
 * grounded evidence, credibility, and agreement (plan §33 §3.4). */
export function EditionReader({ edition }: { edition: EditionPayload }) {
  const [pageIndex, setPageIndex] = useState(0);
  const page = edition.pages[pageIndex];
  const pageBlocks = useMemo(
    () => edition.blocks.filter((block) => block.pageId === page?.id).sort((a, b) => a.blockOrder - b.blockOrder),
    [edition.blocks, page?.id],
  );
  const resourceById = useMemo(() => new Map(edition.resources.map((r) => [r.id, r])), [edition.resources]);

  return (
    <section aria-label="Published critical edition" className="mx-auto max-w-[72ch]">
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
        <strong>Edition v{edition.run.version}</strong>
        <span>{edition.run.structureState === "full" ? "Structured extraction" : "Structure-limited"}</span>
        <span className="text-[var(--color-text-muted)]">AI cost ${Number(edition.cost.aiCostUsd).toFixed(4)}</span>
        {edition.cost.degraded && <span className="rounded bg-[var(--color-bg)] px-1.5 py-0.5 text-xs" title={edition.cost.saturationNote ?? "Research stopped early"}>degraded</span>}
        {page && (
          <>
            <span className="ml-auto">Page {page.pageIndex + 1} / {edition.pages.length}</span>
            <button type="button" disabled={pageIndex === 0} onClick={() => setPageIndex((i) => i - 1)} className="disabled:opacity-40">← Prev</button>
            <button type="button" disabled={pageIndex >= edition.pages.length - 1} onClick={() => setPageIndex((i) => i + 1)} className="disabled:opacity-40">Next →</button>
          </>
        )}
      </div>
      {edition.run.note && <p className="mb-5 rounded-md border border-[var(--color-border)] p-3 text-sm text-[var(--color-text-muted)]">{edition.run.note}</p>}

      {page && (
        <article className="flex flex-col gap-4 leading-[1.7] text-[var(--color-text)]">
          {(pageBlocks.length ? pageBlocks : [{ id: "fallback", kind: "body", text: page.text ?? "" }]).map((block) => {
            if (block.kind === "title") return <h1 key={block.id} className="font-serif text-3xl font-semibold">{block.text}</h1>;
            if (block.kind === "header") return <h2 key={block.id} className="mt-4 font-serif text-xl font-semibold">{block.text}</h2>;
            if (block.kind === "footnote") return <aside key={block.id} className="border-l-2 border-[var(--color-accent-ink)] pl-3 text-sm">{block.text}</aside>;
            return <p key={block.id} className="whitespace-pre-wrap">{block.text}</p>;
          })}
        </article>
      )}

      {edition.authorialNotes.length > 0 && (
        <section className="mt-8 border-t border-[var(--color-border)] pt-4">
          <h2 className="font-semibold">Author’s notes <span className="text-xs font-normal text-[var(--color-text-muted)]">(from the source text)</span></h2>
          <ol className="mt-2 flex flex-col gap-2 text-sm">
            {edition.authorialNotes.map((note) => <li key={note.id}><sup>{note.marker}</sup> {note.text}</li>)}
          </ol>
        </section>
      )}

      {edition.generatedNotes.length > 0 && (
        <section className="mt-8 rounded-md border-2 border-dashed border-[var(--color-accent-green)] bg-[var(--color-surface)] p-4">
          <h2 className="font-semibold">AI-generated critical notes</h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Generated research aids, not settled scholarship. Every claim shows its source-grounded evidence, authority, and agreement — verify against the primary sources.
          </p>
          <ul className="mt-3 flex flex-col gap-4 text-sm">
            {edition.generatedNotes.map((note) => {
              const src = note.evidence?.resourceId ? resourceById.get(note.evidence.resourceId) : null;
              return (
                <li key={note.id} className="border-t border-[var(--color-border)] pt-3 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-[var(--color-bg)] px-1.5 py-0.5 text-xs">{note.noteType.replace(/_/g, " ")}</span>
                    {src?.credibility?.authority && <AuthorityBadge authority={src.credibility.authority} />}
                    <span className="ml-auto text-xs text-[var(--color-text-muted)]">{Math.round(note.confidence * 100)}% confidence</span>
                  </div>
                  <p className="mt-1.5">{note.body}</p>
                  {src && (
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      Source: {src.url ? <a className="underline" href={src.url} target="_blank" rel="noreferrer">{src.title}</a> : src.title} · {src.provider} · inspection depth {src.inspectionDepth}
                    </p>
                  )}
                  {note.claims.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-2">
                      {note.claims.map((claim) => <ClaimView key={claim.id} claim={claim} />)}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {edition.resources.length > 0 && (
        <section className="mt-8 border-t border-[var(--color-border)] pt-4">
          <h2 className="font-semibold">Sources consulted <span className="text-xs font-normal text-[var(--color-text-muted)]">({edition.resources.length})</span></h2>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {edition.resources.map((resource) => (
              <li key={resource.id} className="flex flex-wrap items-center gap-2">
                {resource.url ? <a className="underline" href={resource.url} target="_blank" rel="noreferrer">{resource.title}</a> : resource.title}
                <span className="text-xs text-[var(--color-text-muted)]">· {resource.provider}{resource.year ? ` · ${resource.year}` : ""}</span>
                {resource.credibility?.authority && <AuthorityBadge authority={resource.credibility.authority} />}
                {resource.credibility?.agreement && <span className="text-xs text-[var(--color-text-muted)]">{AGREEMENT_LABEL[resource.credibility.agreement]}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {edition.providerReports.length > 0 && (
        <section className="mt-8 border-t border-[var(--color-border)] pt-4">
          <h2 className="font-semibold">Provider reports <span className="text-xs font-normal text-[var(--color-text-muted)]">(what was consulted)</span></h2>
          <ul className="mt-2 flex flex-wrap gap-2 text-xs">
            {edition.providerReports.map((report) => (
              <li key={report.provider} className="rounded border border-[var(--color-border)] px-2 py-1" title={report.error ?? undefined}>
                <span className="font-medium">{report.provider}</span> · {report.status} · {report.resultCount} results
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
