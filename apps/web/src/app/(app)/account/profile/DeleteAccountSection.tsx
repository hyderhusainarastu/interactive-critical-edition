"use client";

import { useActionState, useState } from "react";
import { deleteAccountAction, type DeleteAccountState } from "@/lib/accountActions";

const INITIAL_STATE: DeleteAccountState = { status: "idle" };

/**
 * Danger-zone card: collapsed by default → expand reveals the exact
 * explanation the privacy page already gives for deletion → email-match +
 * fresh-password confirmation → a submit that's client-gated (typed email
 * matches the account's own, password non-empty) but never client-VALIDATED
 * — the real check is the server action's `bcrypt.compare`, so a wrong
 * password always reaches the same generic error this renders.
 */
export function DeleteAccountSection({ email }: { email: string }) {
  const [expanded, setExpanded] = useState(false);
  const [typedEmail, setTypedEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, formAction, pending] = useActionState(deleteAccountAction, INITIAL_STATE);

  const canSubmit = typedEmail.trim().toLowerCase() === email.toLowerCase() && password.length > 0 && !pending;

  return (
    <section className="app-card rounded-lg border-[var(--color-accent-burgundy)] p-5" aria-labelledby="delete-account-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="delete-account-heading" className="font-serif text-lg font-semibold text-[var(--color-accent-burgundy)]">Delete account</h2>
        {!expanded && (
          <button type="button" className="app-control rounded-md border border-[var(--color-accent-burgundy)] px-3 py-1.5 text-sm text-[var(--color-accent-burgundy)]" onClick={() => setExpanded(true)}>
            Delete my account
          </button>
        )}
      </div>

      {expanded && (
        <div className="app-panel-enter mt-4 flex flex-col gap-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            You may delete your account at any time. Deletion removes your uploaded files, extracted text,
            annotations, notes, conversations, and derived workspace data — not just your sign-in record. This
            cannot be undone.
          </p>
          <p className="text-sm text-[var(--color-text-muted)]">
            We may retain a content-free aggregate record after deletion — including basic account identifiers
            (your name and email) — so platform totals remain accurate, such as when the account was created and
            deleted and aggregate document or activity counts. It does not preserve uploaded text, notes, or
            conversation transcripts.
          </p>

          <form action={formAction} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm text-[var(--color-text)]">
              Type your email ({email}) to confirm
              <input
                name="email"
                type="email"
                autoComplete="off"
                value={typedEmail}
                onChange={(event) => setTypedEmail(event.target.value)}
                className="app-control rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-[var(--color-text)]">
              Current password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="app-control rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2"
              />
            </label>

            <div className="flex items-center gap-3">
              <button type="submit" disabled={!canSubmit} className="app-control rounded-md border border-[var(--color-accent-burgundy)] bg-[var(--color-accent-burgundy)] px-4 py-2 text-sm text-[var(--color-background)] disabled:cursor-not-allowed disabled:opacity-50">
                {pending ? "Deleting…" : "Permanently delete my account"}
              </button>
              <button type="button" className="app-control text-sm text-[var(--color-text-muted)] underline" onClick={() => setExpanded(false)}>
                Cancel
              </button>
            </div>

            {(state.status === "error" || state.status === "storage_abort") && (
              <p role="alert" className="text-sm text-[var(--color-accent-burgundy)]">{state.message}</p>
            )}
          </form>
        </div>
      )}
    </section>
  );
}
