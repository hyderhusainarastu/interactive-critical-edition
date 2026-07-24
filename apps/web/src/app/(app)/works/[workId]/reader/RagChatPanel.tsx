"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadOrCreateRagConversation, ragJsonFetch } from "@/lib/ragConversationClient";

type Citation = { chunkId: string; ordinal: number; href: string; label: string; sourceType: "uploaded" | "open_access"; license?: string };
// Sub-phase 22.9b (plan §3.4): one quiet, collapsed line per chat-inferred
// competency update, rendered under the assistant message it arrived with.
type CompetencyLevel = "unfamiliar" | "struggling" | "partial" | "familiar" | "strong";
type CompetencyNotice = {
  signalId: string;
  targetKind: "concept" | "work";
  targetId: string;
  label: string;
  level: CompetencyLevel;
  quote: string;
  previousScore: number | null;
  newScore: number;
};
type Message = { id: string; role: "user" | "assistant"; content: string; citations: Citation[]; createdAt: string; latencyMs: number | null; competencyNotices?: CompetencyNotice[] };

function conversationStorageKey(contextWorkId?: string | null) {
  return `palimnote:rag-conversation:${contextWorkId ?? "library"}`;
}

/** Human, non-jargon copy for the one failure this panel can still show
 * after the self-heal below: the fresh-conversation create itself failed
 * (network/outage), not a stale pointer — there's genuinely nothing to
 * retry automatically, so a labelled Retry action is offered instead. Never
 * surfaces a raw server string like "Not found". */
const CONVERSATION_UNAVAILABLE_MESSAGE = "Chat could not be started right now.";
const CONVERSATION_HEALED_NOTICE = "Your last conversation was no longer available, so a new one was started.";
const QUESTION_RETRY_NOTICE = "That conversation was no longer available, so a new one was started. Your question is still here — press Ask to send it.";

export function RagChatPanel({
  id,
  contextWorkId = null,
  onClose,
  presentation = "drawer",
  widthPx,
  dialogLabel = "Library-grounded Socratic chat",
}: {
  /** Stable DOM id so a trigger button elsewhere can `aria-controls` this panel. */
  id?: string;
  contextWorkId?: string | null;
  onClose?: () => void;
  presentation?: "drawer" | "page";
  /** Desktop-only drawer width override (e.g. from a resizable sidebar wrapper); ignored below the `md` breakpoint, which always renders full-width. */
  widthPx?: number;
  /**
   * D-22-20: this panel is mounted as a `dialog` from two independent
   * disclosures — the Reader's own contextual drawer and the shell-level
   * global sidebar (`GlobalRagSidebar`) — and both can be open at once on a
   * Reader route. With one shared, unparameterized label both instances
   * resolved to the same accessible name, exactly the ambiguity D-19-14/15/
   * 18/19 already established every other reader-shell disclosure must
   * avoid. Callers now pass a name unique to their own instance; the
   * original shared label remains the default for the standalone
   * `/ask-library` page, where only one instance can ever be open.
   */
  dialogLabel?: string;
}) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState("");
  const [pendingCitations, setPendingCitations] = useState<Citation[]>([]);
  const [error, setError] = useState<string | null>(null);
  // True only when the panel has genuinely nothing to show but a Retry
  // affordance — the stored-pointer self-heal already failed AND the
  // fresh-conversation create also failed. Distinct from `error`, which can
  // be shown alongside a perfectly usable, already-open conversation (e.g.
  // an in-conversation answer failure).
  const [conversationUnavailable, setConversationUnavailable] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Matches the FootnoteModal/PreferencesMenu/MobileDrawer precedent
  // (D-19-18/19/20): a dialog-presentation instance takes initial focus
  // on mount. Since this component is always conditionally mounted fresh
  // when opened (never toggled via a hidden/visible style), an
  // empty-dependency mount effect is the right shape here, same as those.
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Owner-blocking production defect fix (2026-07-23): a conversation id
  // persisted in localStorage can stop resolving server-side (the owning
  // account was deleted, e.g. by test-account cleanup sharing the same
  // production origin/browser) long after it was stored. Previously the
  // resulting 404 was shown verbatim and the panel — textarea and Ask both
  // gated on `!conversationId` — stayed permanently disabled for that
  // storage key, on every page sharing it. `loadOrCreateRagConversation`
  // treats "stored id no longer resolves" exactly like "no id was stored":
  // it clears the stale pointer and transparently creates a fresh
  // conversation, the same request the true first-run path already makes.
  // Only a failure of THAT fresh create is allowed to surface.
  const initializeConversation = useCallback(async (signal: { cancelled: boolean }) => {
    // No setState before the first `await` here — a synchronous setState
    // call in an effect body trips this codebase's own set-state-in-effect
    // rule (see RoadmapView/LibraryView precedent), so every state update
    // below happens only after the request resolves, same as those.
    try {
      const result = await loadOrCreateRagConversation<Message>({
        getStoredConversationId: () => window.localStorage.getItem(conversationStorageKey(contextWorkId)),
        setStoredConversationId: (id) => window.localStorage.setItem(conversationStorageKey(contextWorkId), id),
        clearStoredConversationId: () => window.localStorage.removeItem(conversationStorageKey(contextWorkId)),
        fetchConversation: (id) => ragJsonFetch(`/api/rag/conversations/${id}`),
        createConversation: () => ragJsonFetch("/api/rag/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contextWorkId }),
        }),
      });
      if (signal.cancelled) return;
      setConversationId(result.conversationId);
      setMessages(result.messages);
      setConversationUnavailable(false);
      setError(result.healedStalePointer ? CONVERSATION_HEALED_NOTICE : null);
    } catch {
      // Only a failure of the fresh create itself lands here (a non-404
      // failure resolving a stored id propagates too, treated the same
      // way — there is genuinely no conversation to show either way).
      if (signal.cancelled) return;
      setConversationId(null);
      setError(CONVERSATION_UNAVAILABLE_MESSAGE);
      setConversationUnavailable(true);
    }
  }, [contextWorkId]);

  // Fetch-on-mount whose setState calls all happen post-`await` inside
  // `initializeConversation` (see its own comment above); same documented
  // exception this codebase already uses in
  // EditionAnnotationsPanel/LibraryView/WorkspacePreferencesProvider.
  useEffect(() => {
    const signal = { cancelled: false };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void initializeConversation(signal);
    return () => { signal.cancelled = true; };
  }, [initializeConversation]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, pending]);

  /** Raw "start a fresh conversation" request, shared by the explicit "＋
   * New conversation" button and the mid-session self-heal below. Throws on
   * failure rather than swallowing it — each caller decides its own
   * messaging for that case. */
  const startFreshConversation = useCallback(async () => {
    const created = await ragJsonFetch<{ conversation: { id: string } }>("/api/rag/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contextWorkId }),
    });
    window.localStorage.setItem(conversationStorageKey(contextWorkId), created.conversation.id);
    setConversationId(created.conversation.id);
    setMessages([]);
    setPending("");
    setPendingCitations([]);
    return created.conversation.id;
  }, [contextWorkId]);

  async function createConversation() {
    try {
      await startFreshConversation();
      setError(null);
      setConversationUnavailable(false);
    } catch {
      setError(CONVERSATION_UNAVAILABLE_MESSAGE);
      setConversationUnavailable(true);
    }
  }

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    const question = draft.trim();
    if (!question || !conversationId || pending) return;
    setPending("");
    setPendingCitations([]);
    setError(null);
    try {
      const response = await fetch(`/api/rag/conversations/${conversationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question }),
      });
      if (response.status === 404) {
        // The conversation vanished server-side mid-session — same failure
        // class as the mount-time stale pointer. Self-heal by starting a
        // fresh conversation, but deliberately do NOT auto-resend: the
        // typed question stays exactly where it is (`draft` is untouched)
        // so the user can just press Ask again, rather than risking a
        // silent double-send on a flaky connection.
        try {
          await startFreshConversation();
          setError(QUESTION_RETRY_NOTICE);
        } catch {
          setConversationId(null);
          setError(CONVERSATION_UNAVAILABLE_MESSAGE);
          setConversationUnavailable(true);
        }
        return;
      }
      if (!response.ok || !response.body) throw new Error((await response.json().catch(() => ({})))?.error ?? "Could not answer that question.");
      setDraft("");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      // Plain local accumulator, not React state: competency events (if
      // any) always arrive before `done`, and the final assistant message
      // id isn't known until `done` itself, so there is nothing useful to
      // render mid-stream — this just carries them across to attach to the
      // message once it exists.
      let competencyNotices: CompetencyNotice[] = [];
      const processEvent = (raw: string) => {
        const eventName = raw.match(/^event: ([^\n]+)/m)?.[1];
        const data = raw.match(/^data: (.+)$/m)?.[1];
        if (!eventName || !data) return;
        const value = JSON.parse(data) as Message | Citation | CompetencyNotice | { text: string } | { message: Message };
        if (eventName === "user") setMessages((existing) => [...existing, value as Message]);
        if (eventName === "delta") setPending((existing) => existing + (value as { text: string }).text);
        if (eventName === "citation") setPendingCitations((existing) => [...existing, value as Citation]);
        if (eventName === "competency") competencyNotices = [...competencyNotices, value as CompetencyNotice];
        if (eventName === "done") {
          const message = (value as { message: Message }).message;
          setMessages((existing) => [...existing, competencyNotices.length ? { ...message, competencyNotices } : message]);
          setPending("");
          setPendingCitations([]);
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        events.forEach(processEvent);
        if (done) break;
      }
    } catch (askError) {
      setPending("");
      setPendingCitations([]);
      setError(askError instanceof Error ? askError.message : "Could not answer that question.");
    }
  }

  const isDrawer = presentation === "drawer";
  const scopeLabel = contextWorkId ? "Current work" : "Entire Library";

  return (
    <section
      id={id}
      className={isDrawer
        // `top-14 bottom-0` (not `inset-y-0`) so the drawer starts below the
        // app shell's sticky header (`min-h-14`) rather than painting over
        // it — found while adding D-22-20's dual-dialog regression test:
        // with `inset-y-0`, this panel's own z-40 sat above the header's
        // z-30, visually covering the header row (including the OTHER RAG
        // entry point's own trigger button) whenever this drawer was open,
        // so a mouse user physically could not reach it. `max-md:top-auto`
        // still overrides this for the mobile bottom-sheet presentation.
        ? "app-panel-enter fixed top-14 bottom-0 end-0 z-40 flex w-[min(26rem,100vw)] flex-col border-s border-[var(--color-border)] bg-[var(--color-background)] shadow-2xl md:w-[var(--rag-sidebar-width,min(26rem,100vw))] max-md:inset-x-0 max-md:top-auto max-md:max-h-[78vh] max-md:w-full max-md:rounded-t-xl"
        : "flex min-h-[min(46rem,calc(100vh-12rem))] w-full flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] shadow-sm"}
      style={isDrawer && widthPx ? { ["--rag-sidebar-width" as string]: `${widthPx}px` } : undefined}
      aria-label={dialogLabel}
      role={isDrawer ? "dialog" : "region"}
      aria-modal={isDrawer ? true : undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape" && onClose) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] p-4">
        <div>
          {/* Visual-only restyle to the landing's Ask Library depiction
              (docs "ui-overhaul-spec.md" §3.3): a small burgundy eyebrow
              above the existing heading, matching the depiction's
              "GROUNDED IN YOUR OWN LIBRARY" kicker. No new user-facing copy
              beyond that existing depiction string; heading text, the
              description, and the "Scope: ..." string are unchanged. */}
          <p className="text-[9px] font-bold uppercase tracking-[.13em] text-[var(--color-accent-burgundy)]">Grounded in your own library</p>
          <h2 className="mt-1 font-serif text-lg font-semibold">Ask your Library</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">Answers use eligible sources only and link to the passage they cite.</p>
          <p className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Scope: {scopeLabel}</p>
        </div>
        <div className="flex gap-1"><button type="button" className="app-control app-icon-button" aria-label="New conversation" data-tooltip="New conversation" onClick={() => void createConversation()}>＋</button>{onClose && <button ref={closeButtonRef} type="button" className="app-control app-icon-button" aria-label="Close chat" onClick={onClose}>×</button>}</div>
      </header>
      {/* Phase 23.2 (D-23-x): a chat transcript is exactly the case
          WAI-ARIA's `log` role exists for — new entries append over time
          and the order is meaningful. `role="log"` already implies
          `aria-live="polite"`; the explicit attribute is kept for clarity
          and because this was already relied on before the role existed. */}
      <div ref={scrollRef} role="log" className="min-h-0 flex-1 overflow-y-auto p-4" aria-live="polite">
        {!messages.length && !pending && <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm text-[var(--color-text-muted)]">Ask about an argument, term, or passage. If your eligible Library does not support an answer, chat will say so rather than guess.</p>}
        <ol className="flex flex-col gap-3">{messages.map((message) => <MessageCard key={message.id} message={message} />)}</ol>
        {pending && <MessageCard message={{ id: "pending", role: "assistant", content: pending, citations: pendingCitations, createdAt: new Date().toISOString(), latencyMs: null }} />}
        {error && (
          <div className="mt-3">
            <p className="text-sm text-[var(--color-accent-burgundy)]">{error}</p>
            {conversationUnavailable && (
              <button
                type="button"
                className="app-control mt-2 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm"
                onClick={() => void initializeConversation({ cancelled: false })}
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>
      <form onSubmit={ask} className="border-t border-[var(--color-border)] p-3">
        <label className="sr-only" htmlFor="rag-question">Ask a question about your Library</label>
        <textarea id="rag-question" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} rows={3} placeholder="What does this passage mean?" className="app-control w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm" disabled={!conversationId || Boolean(pending)} />
        <div className="mt-2 flex items-center justify-between gap-3"><span className="text-xs text-[var(--color-text-muted)]">Socratic, source-linked, and owner-scoped.</span><button type="submit" disabled={!draft.trim() || !conversationId || Boolean(pending)} className="app-control rounded-md bg-[var(--color-accent-ink)] px-3 py-1.5 text-sm text-[var(--color-background)] disabled:opacity-50">{pending ? "Thinking…" : "Ask"}</button></div>
      </form>
    </section>
  );
}

/**
 * Visual-only restyle to the landing's Ask Library depiction (docs
 * "ui-overhaul-spec.md" §3.3): each turn gets a left accent bar keyed by
 * role/state, matching the depiction's `.chat-ask`/`.chat-answer`/
 * `.chat-empty` convention — ink for the reader's own turn, green for a
 * substantiated answer, umber for the explicit no-evidence fallback (the
 * only case an assistant turn ever has zero citations, per `@ice/rag`'s
 * `fallbackSocraticAnswer`). Applied via inline `borderInlineStart` rather
 * than a Tailwind border-side utility so it layers cleanly over the
 * existing whole-border/background classes below without a specificity
 * fight over border-color.
 */
function turnAccentColor(message: Message): string {
  if (message.role === "user") return "var(--color-accent-ink)";
  return message.citations.length > 0 ? "var(--color-accent-green)" : "var(--color-accent-umber)";
}

function MessageCard({ message }: { message: Message }) {
  const noEvidence = message.role === "assistant" && message.citations.length === 0;
  return (
    <li
      className={`rounded-lg p-3 text-sm ${message.role === "user" ? "ms-7 bg-[var(--color-surface)]" : "me-3 border border-[var(--color-border)]"} ${noEvidence ? "bg-[var(--color-surface-sunken)]" : ""}`}
      style={{ borderInlineStart: `3px solid ${turnAccentColor(message)}` }}
    >
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{message.role === "user" ? "You" : "Library companion"}</p>
      <p className={`whitespace-pre-wrap leading-6 ${noEvidence ? "text-[var(--color-accent-umber)]" : ""}`}>{message.content}</p>
      {message.citations.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {message.citations.map((citation) => (
            <li key={citation.chunkId} className="flex items-start gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-2 text-xs">
              <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-green)] font-serif text-[10px] text-white">§</span>
              <span className="min-w-0">
                <a href={citation.href} className="block truncate font-serif text-xs font-semibold underline" target={citation.sourceType === "open_access" ? "_blank" : undefined} rel={citation.sourceType === "open_access" ? "noreferrer" : undefined}>[{citation.ordinal + 1}] {citation.label}</a>
                <span className="block text-[10px] text-[var(--color-text-muted)]">{citation.sourceType === "uploaded" ? "Your upload" : "Open-access source"}{citation.license ? ` · ${citation.license}` : ""}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {message.role === "assistant" && message.competencyNotices?.length ? <CompetencyNoticeList notices={message.competencyNotices} /> : null}
    </li>
  );
}

const COMPETENCY_LEVEL_LABEL: Record<CompetencyLevel, string> = {
  unfamiliar: "unfamiliar",
  struggling: "struggling",
  partial: "partially familiar",
  familiar: "familiar",
  strong: "strongly familiar",
};

/**
 * Quiet, progressive-disclosure notice (plan §3.4): one collapsed line per
 * update, max 3 (the server already caps at 3; `.slice` here is just a
 * defensive belt-and-suspenders match). Deliberately says only "based on
 * what you said" — no "AI"/"model"/"detected" wording anywhere in this
 * component, per the owner's site-wide display-language directive.
 */
function CompetencyNoticeList({ notices }: { notices: CompetencyNotice[] }) {
  if (!notices.length) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1 border-t border-[var(--color-border)] pt-2 text-xs">
      {notices.slice(0, 3).map((notice) => <CompetencyNoticeItem key={notice.signalId} notice={notice} />)}
    </ul>
  );
}

function CompetencyNoticeItem({ notice }: { notice: CompetencyNotice }) {
  const [expanded, setExpanded] = useState(false);
  const [undone, setUndone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const undoneRef = useRef<HTMLLIElement>(null);

  // D-23-x: a successful undo swaps this whole list item's content —
  // including the "Undo" button the user just activated — for static text.
  // Without this, the browser silently drops focus to <body> the instant
  // that button unmounts, exactly the focus-loss failure mode this
  // codebase's other Phase 19/22 disclosure fixes exist to prevent. Matches
  // the FootnoteModal/RagChatPanel-close precedent: an effect that only
  // ever calls `.focus()` (no `setState`), so it doesn't trip the
  // synchronous-setState-in-effect lint rule.
  useEffect(() => {
    if (undone) undoneRef.current?.focus();
  }, [undone]);

  async function undo() {
    if (busy) return;
    setBusy(true);
    setUndoError(null);
    try {
      const response = await fetch(`/api/rag/competency-signals/${notice.signalId}/undo`, { method: "POST" });
      if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.error ?? "Could not undo that update.");
      setUndone(true);
    } catch (error) {
      setUndoError(error instanceof Error ? error.message : "Could not undo that update.");
    } finally {
      setBusy(false);
    }
  }

  if (undone) {
    return <li ref={undoneRef} tabIndex={-1} className="text-[var(--color-text-muted)] outline-none">Undone: “{notice.label}” marking removed.</li>;
  }

  return (
    <li>
      <button
        type="button"
        className="app-control text-start underline decoration-dotted underline-offset-2"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        Noted: “{notice.label}” marked {COMPETENCY_LEVEL_LABEL[notice.level]} — based on what you said · {expanded ? "hide" : "details"}
      </button>
      {expanded && (
        <div className="app-panel-enter mt-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-xs">
          <p>Your words: “{notice.quote}”</p>
          <p className="mt-1 text-[var(--color-text-muted)]">
            {notice.previousScore === null ? "Was: no record" : `Was: ${notice.previousScore}/100`} → Now: {COMPETENCY_LEVEL_LABEL[notice.level]} ({notice.newScore}/100)
          </p>
          <p className="mt-1 text-[var(--color-text-muted)]">
            Applies to: {notice.targetKind === "concept" ? "your concept map" : "your reading roadmap"}.
          </p>
          <button type="button" className="app-control mt-2 underline disabled:opacity-50" onClick={() => void undo()} disabled={busy}>
            {busy ? "Undoing…" : "Undo"}
          </button>
          {undoError && <p className="mt-1 text-[var(--color-accent-burgundy)]">{undoError}</p>}
        </div>
      )}
    </li>
  );
}
