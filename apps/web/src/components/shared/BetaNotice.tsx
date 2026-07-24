/**
 * Temporary owner-requested beta contact notice (2026-07-23), shown on the
 * login and signup pages while `BETA_TESTING_MODE` is on. Remove alongside
 * `isBetaTestingMode()` once the beta period ends.
 */
export function BetaNotice() {
  return (
    <p
      role="note"
      className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text)]"
    >
      Beta testing — contact Hyder Arastu for access:{" "}
      <a href="mailto:harastu@usf.edu" className="underline" aria-label="Email Hyder Arastu">
        Email Hyder Arastu
      </a>{" "}
      or{" "}
      <a
        href="https://www.linkedin.com/in/hyderhusainarastu"
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
        aria-label="Hyder Arastu on LinkedIn"
      >
        Hyder Arastu on LinkedIn
      </a>
      .
    </p>
  );
}
