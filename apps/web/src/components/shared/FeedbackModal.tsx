"use client";

import { useEffect, useId, useRef, useState } from "react";
import { canPlaySound, playSound } from "@/lib/sound";
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  normalizeWorkspacePreferences,
  WORKSPACE_PREFERENCES_STORAGE_KEY,
} from "@/lib/workspacePreferences";
import { FEEDBACK_BODY_MAX, FEEDBACK_CATEGORIES, type FeedbackCategory } from "@/lib/feedback";

/**
 * Workstream J (v.5): the feedback mechanism.
 *
 * `FeedbackModal` is a singleton dialog mounted once in `AppFooter`
 * (signed-in) and once in `SiteFooter` (public) — see those files. It never
 * opens itself; ANY trigger anywhere in the tree can open it by dispatching
 * the `palimnote:open-feedback` window CustomEvent, exactly the decoupled
 * pattern `CommandPalette.tsx` already uses for
 * `palimnote:open-command-palette`. This is what lets Lane G's profile-menu
 * "Feedback" item open the same modal without importing it or holding any
 * of its state — it just fires the event.
 *
 * `FeedbackTrigger` is the plain button both footers render; it does
 * nothing but dispatch that event, so it and the modal never need to know
 * about each other directly.
 */

const OPEN_EVENT = "palimnote:open-feedback";

const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  bug: "Bug",
  idea: "Idea",
  praise: "Praise",
  other: "Other",
};

function readLocalPreferences() {
  try {
    const raw = localStorage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY);
    return normalizeWorkspacePreferences(raw ? JSON.parse(raw) : DEFAULT_WORKSPACE_PREFERENCES);
  } catch {
    return DEFAULT_WORKSPACE_PREFERENCES;
  }
}

export function FeedbackTrigger({
  className = "app-control",
  children = "Feedback",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-sound="click"
      data-feedback-trigger
      className={className}
      onClick={(event) => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: event.currentTarget }))}
    >
      {children}
    </button>
  );
}

type SubmitStatus = "idle" | "submitting" | "success" | "error";

/**
 * @param authenticated Whether the viewer already has a session — gates the
 * optional email field (a signed-in submitter's account is identity enough;
 * an anonymous one needs a way to be reached back).
 */
export function FeedbackModal({ authenticated }: { authenticated: boolean }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [body, setBody] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — see the hidden field below
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyFieldId = useId();
  const emailFieldId = useId();
  const websiteFieldId = useId();
  const countId = useId();

  function resetForm() {
    setCategory(null);
    setBody("");
    setEmail("");
    setWebsite("");
    setStatus("idle");
    setErrorMessage(null);
  }

  function close() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<HTMLElement | undefined>).detail;
      triggerRef.current = detail instanceof HTMLElement
        ? detail
        : document.activeElement instanceof HTMLElement ? document.activeElement : null;
      resetForm();
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function trapFocus(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")]
      // The `tabIndex !== -1` check (beyond the hidden/zero-rect filter
      // CommandPalette's/MobileDrawer's identical query already has) is
      // required here specifically: the honeypot `input[name=website]`
      // below matches `input:not([disabled])` in the selector above despite
      // its explicit `tabIndex={-1}` — without this, Shift+Tab from the
      // close button would wrap the trap onto the invisible honeypot field
      // instead of a real one, since it comes right before the (often
      // disabled, and therefore query-excluded) submit button in DOM order.
      .filter((element) => !element.hidden && element.tabIndex !== -1 && element.getClientRects().length > 0);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!category || body.trim().length === 0 || status === "submitting") return;
    setStatus("submitting");
    setErrorMessage(null);
    const preferences = readLocalPreferences();
    const soundReady = canPlaySound(preferences.soundEnabled, !preferences.motionEnabled);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          body,
          email: !authenticated && email.trim() ? email.trim() : undefined,
          path: window.location.pathname,
          website,
        }),
      });
      if (response.status === 429) {
        setStatus("error");
        setErrorMessage("You've sent a few messages recently — please try again in a bit.");
        if (soundReady) playSound("error");
        return;
      }
      if (!response.ok) throw new Error(`feedback submit failed with status ${response.status}`);
      setStatus("success");
      if (soundReady) playSound("success");
    } catch {
      setStatus("error");
      setErrorMessage("Your feedback could not be sent. Please try again.");
      if (soundReady) playSound("error");
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/35 p-4 sm:p-8" role="presentation" onMouseDown={close}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="app-panel-enter mx-auto mt-[8vh] w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] p-5 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={trapFocus}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="font-serif text-lg font-semibold text-[var(--color-text)]">Share feedback</h2>
          <button ref={closeButtonRef} type="button" className="app-control app-icon-button" aria-label="Close feedback form" onClick={close}>×</button>
        </div>

        {status === "success" ? (
          <div className="mt-4" role="status">
            <p className="text-sm text-[var(--color-text)]">Thank you — your note has been sent.</p>
            <button type="button" data-sound="click" className="app-control mt-4 min-h-11 rounded-md border border-[var(--color-border)] px-4 text-sm" onClick={close}>Close</button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-4 flex flex-col gap-4" noValidate>
            <div role="group" aria-label="Feedback category" className="flex flex-wrap gap-2">
              {FEEDBACK_CATEGORIES.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={category === value}
                  data-sound="click"
                  onClick={() => setCategory(value)}
                  className={`app-control app-press min-h-11 min-w-11 rounded-full border px-4 text-sm ${category === value ? "app-selected border-[var(--color-accent-ink)] bg-[var(--color-surface)] font-medium text-[var(--color-text)]" : "border-[var(--color-border)] text-[var(--color-text-muted)]"}`}
                >
                  {CATEGORY_LABEL[value]}
                </button>
              ))}
            </div>

            <div>
              <label htmlFor={bodyFieldId} className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">What&apos;s on your mind?</label>
              <textarea
                id={bodyFieldId}
                required
                rows={5}
                maxLength={FEEDBACK_BODY_MAX}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                aria-describedby={countId}
                className="app-control mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-2.5 text-sm text-[var(--color-text)]"
              />
              <p id={countId} className="mt-1 text-right text-xs text-[var(--color-text-muted)]">{body.length.toLocaleString()} / {FEEDBACK_BODY_MAX.toLocaleString()}</p>
            </div>

            {!authenticated && (
              <div>
                <label htmlFor={emailFieldId} className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Email (optional, so we can reply)</label>
                <input
                  id={emailFieldId}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="app-control mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-2.5 text-sm text-[var(--color-text)]"
                />
              </div>
            )}

            {/* Honeypot (plan §J): hidden from sighted users and assistive
                tech alike — a real visitor can never see, tab to, or fill
                this field, so any non-blank value on submit is treated as a
                bot signal by api/feedback/route.ts (fake success, no
                insert). Visually hidden via clip, not `display:none` /
                `hidden`, so a scripted form-filler that ignores CSS still
                encounters and fills a real, submittable input. */}
            <div aria-hidden="true" style={{ position: "absolute", width: 1, height: 1, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}>
              <label htmlFor={websiteFieldId}>Website</label>
              <input
                id={websiteFieldId}
                name="website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
            </div>

            {status === "error" && errorMessage && (
              <p role="alert" className="text-sm text-[var(--color-accent-burgundy)]">{errorMessage}</p>
            )}

            <button
              type="submit"
              data-sound="send"
              disabled={!category || body.trim().length === 0 || status === "submitting"}
              className="app-control min-h-11 rounded-md bg-[var(--color-accent-ink)] px-4 text-sm font-medium text-[var(--color-background)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === "submitting" ? "Sending…" : "Send feedback"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
