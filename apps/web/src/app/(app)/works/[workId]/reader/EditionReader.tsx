"use client";

import { useMemo, useState } from "react";
import { CredibilityMeter } from "@/components/CredibilityMeter";
import { CATEGORY_META } from "./annotationMeta";
import type { RelationshipCategory } from "./types";

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

/** How a record relates to the work it belongs to. */
export type RecordRole = "primary" | "review" | "edition" | "translation" | "excerpt";

/** One work, with the records that describe it attached rather than repeated. */
export interface EditionWork {
  key: string;
  title: string;
  authorSurname: string | null;
  primary: EditionResource;
  related: Array<{ id: string; title: string; role: RecordRole; evidence: string | null; url: string | null; provider: string }>;
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
  /** Canonical work identity (migration 0014); null for pre-0014 rows. */
  work: {
    key: string;
    role: RecordRole;
    canonicalTitle: string | null;
    authorSurname: string | null;
    evidence: string | null;
  } | null;
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

/** What KIND of note a passage annotation is making about the passage itself
 *  — distinct from `relationship`, which describes how a cited/related source
 *  bears on the work (plan §34.4 9.3). */
export type PassageAnnotationType = "context" | "clarification" | "connection" | "critique" | "definition";
export type ReaderLevel = "beginner" | "undergraduate" | "advanced" | "research";

export interface EditionPassageAnnotation {
  id: string;
  textBlockId: string | null;
  isWholeWork: boolean;
  quote: string | null;
  summary: string;
  explanation: string;
  annotationType: PassageAnnotationType;
  relationship: RelationshipCategory;
  relatedResourceId: string | null;
  readerLevel: ReaderLevel | null;
  confidence: number;
}

export interface EditionPayload {
  run: { version: number; structureState: "full" | "limited"; note: string | null; status: string; stage: string | null };
  cost: {
    aiCostUsd: number;
    degraded: boolean;
    saturationNote: string | null;
    /** Per-module actual cost behind the single total above (plan §34.4 9.7). */
    breakdown: Array<{ stage: string | null; task: string; costUsd: number; calls: number; promptTokens: number; completionTokens: number }>;
  };
  pages: Array<{ id: string; pageIndex: number; text: string | null; isOcr: boolean; extractionConfidence: number | null }>;
  blocks: Array<{ id: string; pageId: string; blockOrder: number; kind: string; text: string }>;
  authorialNotes: Array<{ id: string; marker: string; text: string }>;
  /** Anchored to a real text_block_id — never a fabricated one (DB-enforced). */
  passageAnnotations: EditionPassageAnnotation[];
  /** No single passage applies; always rendered under the literal label
   *  "Whole-work guidance" (plan §34.4 9.3), never mixed with the anchored ones. */
  wholeWorkGuidance: EditionPassageAnnotation[];
  generatedNotes: Array<{
    id: string;
    noteType: string;
    body: string;
    confidence: number;
    evidence: { quote: string | null; resourceId: string | null } | null;
    claims: EditionClaim[];
  }>;
  /** Every record, unchanged — nothing is hidden from the payload. */
  resources: EditionResource[];
  /**
   * The same records grouped into WORKS, which is what the Library lists. A
   * book, a review of it and its second edition are three real records but one
   * work; `related` keeps the others visible, attached to the work.
   */
  works: EditionWork[];
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
const PASSAGE_TYPE_LABEL: Record<PassageAnnotationType, string> = {
  context: "Context",
  clarification: "Clarification",
  connection: "Connection",
  critique: "Critique",
  definition: "Definition",
};
const READER_LEVEL_LABEL: Record<ReaderLevel, string> = {
  beginner: "Beginner",
  undergraduate: "Undergraduate",
  advanced: "Advanced",
  research: "Research",
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

/** A passage-anchored explanatory note (plan §34.4 9.3): summary always
 *  visible, explanation expandable, never claiming an anchor it doesn't have —
 *  `isWholeWork` items are rendered separately, under the literal label
 *  "Whole-work guidance", by the caller (never passed here mixed in). */
function PassageAnnotationNote({
  note,
  resourceById,
}: {
  note: EditionPassageAnnotation;
  resourceById: Map<string, EditionResource>;
}) {
  const [open, setOpen] = useState(false);
  const relatedResource = note.relatedResourceId ? resourceById.get(note.relatedResourceId) : undefined;
  const category = CATEGORY_META[note.relationship];
  return (
    <li className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-[var(--color-bg)] px-1.5 py-0.5 text-xs font-medium">{PASSAGE_TYPE_LABEL[note.annotationType]}</span>
        {category && (
          <span
            className="rounded px-1.5 py-0.5 text-xs font-medium"
            style={{ color: `var(${category.colorVar})` }}
            title={category.gloss}
          >
            {category.glyph} {category.label}
          </span>
        )}
        {note.readerLevel && <span className="text-xs text-[var(--color-text-muted)]">{READER_LEVEL_LABEL[note.readerLevel]}</span>}
        <span className="ml-auto text-xs text-[var(--color-text-muted)]">{Math.round(note.confidence * 100)}% confidence</span>
      </div>
      <p className="mt-1">{note.summary}</p>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-1 text-xs underline">
        {open ? "Hide explanation" : "Read more"}
      </button>
      {open && (
        <div className="mt-2 border-t border-[var(--color-border)] pt-2">
          <p>{note.explanation}</p>
          {note.quote && <p className="mt-1.5 border-l-2 border-[var(--color-border)] pl-2 text-xs italic text-[var(--color-text-muted)]">“{note.quote}”</p>}
          {relatedResource && (
            <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">
              Related source:{" "}
              {relatedResource.url ? (
                <a href={relatedResource.url} target="_blank" rel="noopener noreferrer" className="underline">
                  {relatedResource.title}
                </a>
              ) : (
                relatedResource.title
              )}
            </p>
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
  const passageAnnotationsByBlock = useMemo(() => {
    const map = new Map<string, EditionPassageAnnotation[]>();
    for (const a of edition.passageAnnotations) {
      if (!a.textBlockId) continue;
      const list = map.get(a.textBlockId) ?? [];
      list.push(a);
      map.set(a.textBlockId, list);
    }
    return map;
  }, [edition.passageAnnotations]);

  return (
    <section aria-label="Published critical edition" className="mx-auto max-w-[72ch]">
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
        <strong>Edition v{edition.run.version}</strong>
        <span>{edition.run.structureState === "full" ? "Structured extraction" : "Structure-limited"}</span>
        {edition.cost.breakdown.length > 0 ? (
          <details className="text-[var(--color-text-muted)]">
            <summary className="cursor-pointer">AI cost ${Number(edition.cost.aiCostUsd).toFixed(4)}</summary>
            <ul className="mt-1 flex flex-col gap-0.5 text-xs">
              {edition.cost.breakdown.map((b, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>{b.stage ?? b.task}</span>
                  <span>${b.costUsd.toFixed(4)} · {b.calls} call{b.calls === 1 ? "" : "s"}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <span className="text-[var(--color-text-muted)]">AI cost ${Number(edition.cost.aiCostUsd).toFixed(4)}</span>
        )}
        {/* `degraded` is set only when the run crossed its cost soft cap
         *  (see `overSoftCap()` in apps/worker/src/analyze.ts) — it never
         *  means anything else, so the default tooltip names the cause
         *  rather than a generic "stopped early". */}
        {edition.cost.degraded && <span className="rounded bg-[var(--color-bg)] px-1.5 py-0.5 text-xs" title={edition.cost.saturationNote ?? "Research stopped early — cost limit reached"}>degraded</span>}
        {page && (
          <>
            <span className="ml-auto">Page {page.pageIndex + 1} / {edition.pages.length}</span>
            <button type="button" disabled={pageIndex === 0} onClick={() => setPageIndex((i) => i - 1)} className="disabled:opacity-40">← Prev</button>
            <button type="button" disabled={pageIndex >= edition.pages.length - 1} onClick={() => setPageIndex((i) => i + 1)} className="disabled:opacity-40">Next →</button>
          </>
        )}
      </div>
      {edition.run.note && <p className="mb-5 rounded-md border border-[var(--color-border)] p-3 text-sm text-[var(--color-text-muted)]">{edition.run.note}</p>}

      {edition.wholeWorkGuidance.length > 0 && (
        <section aria-label="Whole-work guidance" className="mb-5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <h2 className="text-sm font-semibold">Whole-work guidance</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            True of this work as a whole — no single passage captures it, so it carries no page/block anchor.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {edition.wholeWorkGuidance.map((note) => <PassageAnnotationNote key={note.id} note={note} resourceById={resourceById} />)}
          </ul>
        </section>
      )}

      {page && (
        <article className="flex flex-col gap-4 leading-[1.7] text-[var(--color-text)]">
          {(pageBlocks.length ? pageBlocks : [{ id: "fallback", kind: "body", text: page.text ?? "" }]).map((block) => {
            const blockNotes = passageAnnotationsByBlock.get(block.id);
            if (block.kind === "title") return <h1 key={block.id} className="font-serif text-3xl font-semibold">{block.text}</h1>;
            if (block.kind === "header") return <h2 key={block.id} className="mt-4 font-serif text-xl font-semibold">{block.text}</h2>;
            if (block.kind === "footnote") return <aside key={block.id} className="border-l-2 border-[var(--color-accent-ink)] pl-3 text-sm">{block.text}</aside>;
            return (
              <div key={block.id}>
                <p className="whitespace-pre-wrap">{block.text}</p>
                {blockNotes && blockNotes.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-2 border-l-2 border-[var(--color-accent-green)] pl-3">
                    {blockNotes.map((note) => <PassageAnnotationNote key={note.id} note={note} resourceById={resourceById} />)}
                  </ul>
                )}
              </div>
            );
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
          <h2 className="font-semibold">
            Sources consulted{" "}
            <span className="text-xs font-normal text-[var(--color-text-muted)]">
              ({edition.works.length} work{edition.works.length === 1 ? "" : "s"}
              {edition.resources.length !== edition.works.length ? `, ${edition.resources.length} records` : ""})
            </span>
          </h2>
          {/* One entry per WORK. A book, a review of it and its second edition
              are three real records but one work, and repeating the same book
              five times makes the list unusable. Related records stay visible,
              attached to the work rather than listed beside it. */}
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {edition.works.map((work) => {
              const resource = work.primary;
              return (
                <li key={work.key} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {resource.url ? <a className="underline" href={resource.url} target="_blank" rel="noreferrer">{work.title}</a> : work.title}
                    <span className="text-xs text-[var(--color-text-muted)]">· {resource.provider}{resource.year ? ` · ${resource.year}` : ""}</span>
                    {resource.credibility?.authority && <AuthorityBadge authority={resource.credibility.authority} />}
                    {resource.credibility?.score != null && <CredibilityMeter score={resource.credibility.score} />}
                    {resource.credibility?.agreement && <span className="text-xs text-[var(--color-text-muted)]">{AGREEMENT_LABEL[resource.credibility.agreement]}</span>}
                  </div>
                  {work.related.length > 0 && (
                    <ul className="ml-4 flex flex-col gap-0.5 border-l border-[var(--color-border)] pl-3 text-xs text-[var(--color-text-muted)]">
                      {work.related.map((rel) => (
                        <li key={rel.id} title={rel.evidence ?? undefined}>
                          <span className="capitalize">{rel.role}</span>:{" "}
                          {rel.url ? <a className="underline" href={rel.url} target="_blank" rel="noreferrer">{rel.title}</a> : rel.title}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
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
