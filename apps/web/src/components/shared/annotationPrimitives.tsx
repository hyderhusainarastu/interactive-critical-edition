/**
 * Shared annotation presentation primitives (Phase 22.1, plan §22.2).
 *
 * The landing page's Reader/Annotations showcase is the frozen visual
 * contract (Phase 19.4) the authenticated surfaces are being brought into
 * parity with in Phases 22.2–22.4. These components are the landing
 * depiction's markup moved VERBATIM out of `apps/web/src/app/page.tsx`
 * (class lists unchanged; only the color, which was already an inline
 * `var(...)` value, is parameterized) so both sides render annotation
 * visuals from one module instead of two divergent copies.
 *
 * Rules honored here (plan §22.2):
 * - No hooks, no client directive — usable from the server-rendered
 *   landing page and from "use client" panels alike.
 * - Category color always travels with a glyph + label (never color
 *   alone, plan §20); colors are `var(--color-accent-*)` tokens.
 * - Pixel stability of the landing page is proven by the Docker-run
 *   `landing-contract.spec.ts` screenshots, not asserted.
 */

/**
 * In-text annotation marker — the same `.reader-annotation-marker` CSS
 * class the real Reader's DOM-applied markers use (`highlightDom.ts`),
 * colored via the `--reader-annotation-color` custom property. For
 * React-rendered contexts (the landing showcase today; any future
 * React-rendered marker). Decorative by default (`aria-hidden`) — the
 * real Reader's interactive markers carry their own accessible labeling.
 */
export function AnnotationMarker({
  colorVar,
  children,
}: {
  /** CSS custom-property name, e.g. `--color-accent-green`. */
  colorVar: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className="reader-annotation-marker"
      style={{ "--reader-annotation-color": `var(${colorVar})` } as React.CSSProperties}
      aria-hidden
    >
      {children}
    </span>
  );
}

/**
 * The filled circular category glyph (the "❋ in a colored circle" of the
 * landing's annotation card). Base classes are the landing card's
 * verbatim; panel call sites append `shrink-0` (their pre-existing
 * addition) via `className`.
 */
export function CategoryGlyph({
  colorVar,
  glyph,
  className,
}: {
  colorVar: string;
  glyph: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={
        "inline-flex h-5 w-5 items-center justify-center rounded-full text-[0.7rem] font-bold text-[var(--color-background)]" +
        (className ? ` ${className}` : "")
      }
      style={{ background: `var(${colorVar})` }}
    >
      {glyph}
    </span>
  );
}

/**
 * The annotation card's header row: category glyph + category label in
 * the category color + right-aligned confidence. Verbatim from the
 * landing card's first row (the label color moves from a Tailwind
 * arbitrary-value class to an inline style because the color is now a
 * parameter — computed styles are identical).
 */
export function RelationBadge({
  colorVar,
  glyph,
  label,
  confidence,
}: {
  colorVar: string;
  glyph: string;
  label: string;
  /** Right-aligned confidence text, e.g. "High · 82%". Omit to hide. */
  confidence?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <CategoryGlyph colorVar={colorVar} glyph={glyph} />
      <span className="font-semibold" style={{ color: `var(${colorVar})` }}>
        {label}
      </span>
      {confidence != null && <span className="ml-auto text-[var(--color-text-muted)]">{confidence}</span>}
    </div>
  );
}

/**
 * The landing's annotation detail card: relation badge row, target-work
 * title, and a small muted explanation/provenance line. This is the
 * §22.2 "annotation summary card" presentation contract the authenticated
 * annotation cards converge toward in Phase 22.4.
 */
export function AnnotationSummaryCard({
  colorVar,
  glyph,
  label,
  confidence,
  title,
  note,
  className,
}: {
  colorVar: string;
  glyph: string;
  label: string;
  confidence?: React.ReactNode;
  title: React.ReactNode;
  note: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        "rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3" +
        (className ? ` ${className}` : "")
      }
    >
      <RelationBadge colorVar={colorVar} glyph={glyph} label={label} confidence={confidence} />
      <p className="mt-2 text-sm font-medium text-[var(--color-text)]">{title}</p>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">{note}</p>
    </div>
  );
}

/**
 * The §22.2 "confidence/provenance treatment": the standardized
 * "Source: … · confidence NN% · provenance: …" sentence the annotation
 * panels render under an expanded annotation. Text-node layout matches
 * `EditionAnnotationsPanel`'s pre-existing line exactly (single-line JSX
 * so no whitespace differences); font-size/margin stay at the call site
 * via `className` until Phase 22.4 unifies them deliberately.
 */
export function EvidenceLine({
  source,
  confidencePercent,
  provenance,
  className,
}: {
  source: React.ReactNode;
  confidencePercent: number;
  provenance: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={"text-[var(--color-text-muted)]" + (className ? ` ${className}` : "")}>
      Source: {source} · confidence {confidencePercent}% · provenance: {provenance}
    </p>
  );
}
