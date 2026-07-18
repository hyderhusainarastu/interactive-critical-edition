/**
 * Error-reporting seam (plan §22). One entry point both the web app and
 * the worker call when something fails. Follows the same adapter+fallback
 * pattern as the mail and AI providers: if a real monitoring backend is
 * configured it goes there, otherwise errors are logged locally in a
 * structured form — never swallowed silently.
 *
 * Sentry is intentionally NOT a hard dependency (it needs a DSN + account
 * this project doesn't have provisioned). When one exists, the drop-in is:
 * `import * as Sentry from "@sentry/node"` (or `@sentry/nextjs`), init it
 * once at process start, and call `Sentry.captureException(error, { extra:
 * context })` in the marked spot below. Until then the fallback keeps a
 * complete, structured error trail in the platform logs (Vercel / Render).
 */

export interface ErrorContext {
  /** Where the error happened, e.g. "worker.analyzeWork" or "api.upload". */
  scope: string;
  /** Any extra structured detail (ids, status) — no secrets, no user content. */
  [key: string]: unknown;
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

  const dsn = process.env.SENTRY_DSN;
  if (dsn) {
    // --- Drop-in point for Sentry.captureException(err, { extra: context }).
    // Kept as a structured log until @sentry/* is wired, so a configured
    // DSN never means errors vanish into an un-called SDK.
    console.error("[reportError:sentry-configured]", JSON.stringify(record));
    return;
  }

  console.error("[reportError]", JSON.stringify(record));
}
