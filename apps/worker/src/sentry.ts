import * as Sentry from "@sentry/node";
import { setExternalErrorReporter } from "@ice/observability";

// Dormant unless the operator supplies a DSN. Worker errors are still emitted
// as structured Render logs either way; no source text or secret is attached.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
  setExternalErrorReporter((error, context) => {
    Sentry.captureException(error, { extra: context });
  });
}
