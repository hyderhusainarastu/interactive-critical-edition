/**
 * A 3-band (not continuous-gradient) credibility indicator, shown
 * alongside — not replacing — the letter-grade AuthorityBadge (plan §36
 * 11.2). Three discrete bands avoid implying a precision the underlying
 * `credibility.score` doesn't have. Never color alone: a text label
 * always accompanies the bar (same WCAG discipline as CATEGORY_META).
 */
type CredibilityBand = "critical" | "warning" | "good";

const BAND_META: Record<CredibilityBand, { label: string; colorVar: string }> = {
  critical: { label: "Low credibility", colorVar: "--color-credibility-critical" },
  warning: { label: "Mixed credibility", colorVar: "--color-credibility-warning" },
  good: { label: "Good credibility", colorVar: "--color-accent-green" },
};

function bandForScore(score: number): CredibilityBand {
  if (score >= 0.7) return "good";
  if (score >= 0.4) return "warning";
  return "critical";
}

export function CredibilityMeter({ score, className }: { score: number; className?: string }) {
  const band = bandForScore(score);
  const meta = BAND_META[band];
  const filled = band === "good" ? 3 : band === "warning" ? 2 : 1;

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className ?? ""}`}
      title={`${meta.label} (${Math.round(score * 100)}%)`}
    >
      <span className="inline-flex items-center gap-0.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-3 rounded-sm"
            style={{ background: i < filled ? `var(${meta.colorVar})` : "var(--color-border)" }}
          />
        ))}
      </span>
      <span className="text-xs text-[var(--color-text-muted)]">{meta.label}</span>
    </span>
  );
}
