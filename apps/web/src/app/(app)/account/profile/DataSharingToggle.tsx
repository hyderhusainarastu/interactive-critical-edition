"use client";

import { useId, useState, useTransition } from "react";
import { updateDataSharingAction } from "@/lib/accountActions";
import { useToast } from "@/components/app/ToastProvider";

/**
 * Copy here is kept byte-for-byte identical to `/privacy`'s "Research data
 * sharing is your choice" section so the toggle never says something the
 * policy page doesn't already promise (see `docs/PROJECT-LOG.md`'s privacy
 * copy audit note for this workstream).
 */
export function DataSharingToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const inputId = useId();

  function onChange(next: boolean) {
    const previous = enabled;
    setEnabled(next);
    startTransition(async () => {
      const result = await updateDataSharingAction(next);
      if (!result.ok) {
        setEnabled(previous);
        toast("Your data-sharing preference couldn't be saved.", "error");
      }
    });
  }

  return (
    <section className="app-card rounded-lg p-5" aria-labelledby="data-sharing-heading">
      <h2 id="data-sharing-heading" className="font-serif text-lg font-semibold text-[var(--color-text)]">Research data sharing is your choice</h2>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
        You can explicitly opt in to share activity with the Palimnote team for research concerning pedagogy and
        research practices. The option is off by default. If you opt in, the research view may include the titles
        of works you upload, activity and usage patterns, and your reading-companion conversation histories.
      </p>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
        You can revoke permission at any time from your profile. Turning it off stops future content-level research
        access. Your account continues to work whether you share or not.
      </p>
      <label htmlFor={inputId} className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-4 text-sm text-[var(--color-text)]">
        <span>Share my activity for research</span>
        <input id={inputId} type="checkbox" checked={enabled} disabled={pending} onChange={(event) => onChange(event.target.checked)} />
      </label>
    </section>
  );
}
