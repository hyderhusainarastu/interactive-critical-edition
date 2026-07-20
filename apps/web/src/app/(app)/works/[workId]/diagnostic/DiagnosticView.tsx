"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Phase 9.4 (plan §34.4): the optional, skippable per-work diagnostic. Asks
 * a self-assessment question per concept the work presupposes/discusses
 * (extracted by the v3 pipeline) rather than an LLM-graded fact quiz — see
 * the API route's doc comment for why. Entirely skippable: nothing here
 * blocks reading the work, and answering none of it just leaves the
 * reader's mastery at the "global level" fallback (packages/research's
 * `defaultMasteryForReaderLevel`).
 */

type Assessment = "never" | "heard" | "basics" | "explain";

const ASSESSMENT_OPTIONS: { value: Assessment; label: string }[] = [
  { value: "never", label: "Never encountered it" },
  { value: "heard", label: "Heard of it" },
  { value: "basics", label: "Understand the basics" },
  { value: "explain", label: "Could explain it to someone else" },
];

// Mirrors the API route's SELF_ASSESSMENT_SCHEMA scores, used only to
// pre-select the closest option for a concept already assessed elsewhere
// (e.g. an explicit rating) — never sent back as-is, since re-submitting
// always goes through the assessment label, not a raw score.
const SCORE_TO_ASSESSMENT = (score: number): Assessment => {
  if (score < 15) return "never";
  if (score < 45) return "heard";
  if (score < 70) return "basics";
  return "explain";
};

interface ConceptItem {
  id: string;
  slug: string;
  kind: string;
  label: string;
  summary: string | null;
  role: string | null;
}

interface DiagnosticResponse {
  concepts: ConceptItem[];
  existingMastery: { conceptId: string; score: number; source: string }[];
}

export function DiagnosticView({ workId, title }: { workId: string; title: string }) {
  const [data, setData] = useState<DiagnosticResponse | null>(null);
  const [answers, setAnswers] = useState<Record<string, Assessment>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<number | null>(null);

  useEffect(() => {
    let ignore = false;
    fetch(`/api/works/${workId}/diagnostic`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to load diagnostic");
        return res.json() as Promise<DiagnosticResponse>;
      })
      .then((d) => {
        if (ignore) return;
        setData(d);
        const preset: Record<string, Assessment> = {};
        for (const m of d.existingMastery) preset[m.conceptId] = SCORE_TO_ASSESSMENT(m.score);
        setAnswers(preset);
      })
      .catch((e) => {
        if (!ignore) setError(e instanceof Error ? e.message : "Failed to load diagnostic");
      });
    return () => {
      ignore = true;
    };
  }, [workId]);

  const handleSubmit = async () => {
    if (!data) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        answers: data.concepts
          .filter((c) => answers[c.id])
          .map((c) => ({ conceptId: c.id, assessment: answers[c.id] })),
      };
      const res = await fetch(`/api/works/${workId}/diagnostic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to save");
      const result = (await res.json()) as { written: number };
      setSubmitted(result.written);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-1 flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
        <Link href={`/works/${workId}`} className="underline">
          ← {title}
        </Link>
      </div>
      <h1 className="mb-1 font-serif text-2xl font-semibold text-[var(--color-text)]">Concept check</h1>
      <p className="mb-6 max-w-xl text-sm text-[var(--color-text-muted)]">
        A quick, optional self-assessment of the concepts this work presupposes or discusses — entirely skippable,
        and it never changes what you can read, only how the roadmap defaults for you. Answer only the ones you have
        an opinion on.
      </p>

      {error && <p className="mb-4 text-[var(--color-accent-burgundy)]">{error}</p>}
      {!data && !error && <p className="text-[var(--color-text-muted)]">Loading…</p>}

      {data && data.concepts.length === 0 && (
        <p className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
          No concepts have been extracted for this work yet — there&rsquo;s nothing to diagnose against. This
          appears once analysis has run under the current pipeline.
        </p>
      )}

      {data && data.concepts.length > 0 && submitted === null && (
        <>
          <ol className="flex flex-col gap-5">
            {data.concepts.map((c) => (
              <li key={c.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <p className="font-medium text-[var(--color-text)]">{c.label}</p>
                {c.summary && <p className="mt-1 text-sm text-[var(--color-text-muted)]">{c.summary}</p>}
                <fieldset className="mt-3 flex flex-col gap-2">
                  <legend className="sr-only">How familiar are you with {c.label}?</legend>
                  {ASSESSMENT_OPTIONS.map((opt) => (
                    <label key={opt.value} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`concept-${c.id}`}
                        value={opt.value}
                        checked={answers[c.id] === opt.value}
                        onChange={() => setAnswers((prev) => ({ ...prev, [c.id]: opt.value }))}
                      />
                      {opt.label}
                    </label>
                  ))}
                </fieldset>
              </li>
            ))}
          </ol>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="rounded-md bg-[var(--color-accent-ink)] px-5 py-2.5 text-sm font-medium text-[var(--color-background)] disabled:opacity-60"
            >
              {submitting ? "Saving…" : "Save"}
            </button>
            <Link href={`/works/${workId}`} className="rounded-md border border-[var(--color-border)] px-5 py-2.5 text-sm text-[var(--color-text)]">
              Skip for now
            </Link>
          </div>
        </>
      )}

      {submitted !== null && (
        <p className="rounded-md border border-[var(--color-accent-green)] px-3 py-2 text-sm text-[var(--color-text)]">
          Saved — {submitted} concept{submitted === 1 ? "" : "s"} assessed.{" "}
          <Link href={`/works/${workId}`} className="underline">
            Back to the work
          </Link>
        </p>
      )}
    </div>
  );
}
