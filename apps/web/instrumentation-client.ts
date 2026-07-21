import * as Sentry from "@sentry/nextjs";

// Dormant by default: a missing DSN does not initialize a network client.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}
