import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("../sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("../sentry.edge.config");
}

/** Lets Next.js forward framework-level request failures when Sentry is enabled. */
export const onRequestError = Sentry.captureRequestError;
