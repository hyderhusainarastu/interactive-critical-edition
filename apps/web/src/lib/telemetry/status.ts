import type { processingStatusEnum } from "@ice/db";

type ProcessingStatus = (typeof processingStatusEnum.enumValues)[number];

export const STATUS_LABEL: Record<ProcessingStatus, string> = {
  uploaded: "Queued",
  processing: "Processing…",
  needs_review: "Needs review",
  ready: "Ready",
  failed: "Failed",
};

export const STATUS_COLOR: Record<ProcessingStatus, string> = {
  uploaded: "var(--color-text-muted)",
  processing: "var(--color-accent-ink)",
  // Not --color-highlight: that token is tuned for decorative/translucent
  // uses and fails WCAG AA (~2.99:1) as literal text on the page
  // background. --color-status-highlight-text is a darkened gold verified
  // >=4.5:1 in both themes, added for exactly this use (globals.css).
  needs_review: "var(--color-status-highlight-text)",
  ready: "var(--color-accent-green)",
  failed: "var(--color-accent-burgundy)",
};
