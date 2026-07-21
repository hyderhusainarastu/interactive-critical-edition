/**
 * Error-reporting seam (plan §22). One entry point both the web app and
 * the worker call when something fails. Follows the same adapter+fallback
 * pattern as the mail and AI providers: if a real monitoring backend is
 * configured it goes there, otherwise errors are logged locally in a
 * structured form — never swallowed silently.
 *
 * The web app additionally forwards captured errors through its dormant
 * `@sentry/nextjs` integration when a DSN exists. This shared package stays
 * dependency-light for the worker and always preserves a structured platform
 * log trail (Vercel / Render).
 */

export interface ErrorContext {
  /** Where the error happened, e.g. "worker.analyzeWork" or "api.upload". */
  scope: string;
  /** Any extra structured detail (ids, status) — no secrets, no user content. */
  [key: string]: unknown;
}

let externalErrorReporter: ((error: Error, context: ErrorContext) => void) | undefined;

/** Runtime adapters (the worker's dormant Sentry client) register here without
 * forcing monitoring dependencies into every package that uses the logger. */
export function setExternalErrorReporter(reporter: ((error: Error, context: ErrorContext) => void) | undefined): void {
  externalErrorReporter = reporter;
}

export function reportError(error: unknown, context: ErrorContext): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const record = {
    level: "error" as const,
    ts: new Date().toISOString(),
    message: err.message,
    stack: err.stack,
    ...context,
  };

  console.error("[reportError]", JSON.stringify(record));
  externalErrorReporter?.(err, context);
}

/** Operational metrics are structured, content-free records rather than logs
 * that accidentally contain source text, user prompts, or secrets. */
export function reportEvent(event: string, context: Record<string, unknown> = {}): void {
  console.info("[operationalEvent]", JSON.stringify({
    level: "info",
    ts: new Date().toISOString(),
    event,
    ...context,
  }));
}
