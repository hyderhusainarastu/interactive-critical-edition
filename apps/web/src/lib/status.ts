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
  needs_review: "var(--color-highlight)",
  ready: "var(--color-accent-green)",
  failed: "var(--color-accent-burgundy)",
};
