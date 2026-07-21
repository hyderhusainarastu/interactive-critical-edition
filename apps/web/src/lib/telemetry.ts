import * as Sentry from "@sentry/nextjs";
import { reportError, type ErrorContext } from "@ice/observability";

/** Structured error telemetry without request bodies, source text, or secrets. */
export function reportWebError(error: unknown, context: ErrorContext): void {
  reportError(error, context);
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(error, { extra: context });
  }
}
