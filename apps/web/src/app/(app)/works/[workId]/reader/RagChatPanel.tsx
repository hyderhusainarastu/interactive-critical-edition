"use client";

import { Fragment, useCallback, useEffect, useId, useRef, useState } from "react";
import { useWorkspacePreferences } from "@/components/app/WorkspacePreferencesProvider";
import { loadOrCreateRagConversation, ragJsonFetch } from "@/lib/ragConversationClient";
import { canPlaySound, playSound } from "@/lib/sound";
import { useReopenGuard } from "@/hooks/useReopenGuard";

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
// `notFound` is the authoritative Phase 18 signal for whether an assistant
// answer is substantiated (`@ice/rag`'s `SocraticAnswer.notFound`, streamed
// on the SSE `done` event below) — it is NOT persisted on the `rag_message`
// DB row (see `packages/db/src/schema.ts`'s `ragMessages`: content/role/
// tokens/cost only), so it is only ever present on a message completed in
// THIS session. Optional and absent for history loaded from `GET
// /api/rag/conversations/:id`.
type Message = { id: string; role: "user" | "assistant"; content: string; citations: Citation[]; createdAt: string; latencyMs: number | null; competencyNotices?: CompetencyNotice[]; notFound?: boolean };

// Workstream E (plan §4): the `GET /api/rag/conversations` list row shape
// (`listRagConversations` in `ragData.ts`) — deliberately narrower than
// `Message`'s conversation view, since the switcher only ever renders a
// title, a scope, and a recency, never message content.
type ConversationSummary = { id: string; title: string; contextWorkId: string | null; updatedAt: string };

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
  // True from the moment a question is sent until the `done` event (or an
  // error/self-heal) resolves — distinct from `pending`, which stays "" for
  // the whole gap between send and the FIRST streamed delta. Without a
  // separate flag, that gap rendered nothing at all (see `ask()` below and
  // the thinking-indicator render), which is exactly the silence the
  // ink-dot ripple indicator is meant to fill.
  const [streaming, setStreaming] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const historyMenuId = useId();
  // Same switch-bounce / trackpad double-fire guard as `AppShell.tsx`'s
  // menus — see `useReopenGuard`'s doc comment.
  const historyReopenGuard = useReopenGuard();
  const { preferences } = useWorkspacePreferences();
  const soundReady = canPlaySound(preferences.soundEnabled, !preferences.motionEnabled);

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
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: preferences.motionEnabled ? "smooth" : "auto" });
  }, [messages, pending, preferences.motionEnabled]);

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
      closeHistory();
    } catch {
      setError(CONVERSATION_UNAVAILABLE_MESSAGE);
      setConversationUnavailable(true);
    }
  }

  /**
   * Workstream E (plan §4): `GET /api/rag/conversations` already returned
   * this list; nothing consumed it until now. Loaded fresh every time the
   * history menu opens (not cached) so `updatedAt` ordering — and any
   * conversation just started elsewhere on this page — is always current.
   */
  const loadConversations = useCallback(async () => {
    try {
      const result = await ragJsonFetch<{ conversations: ConversationSummary[] }>("/api/rag/conversations");
      setConversations(result.conversations);
      setConversationsError(null);
    } catch {
      setConversationsError("Your earlier conversations could not be loaded.");
    }
  }, []);

  function openHistory() {
    setHistoryOpen(true);
    historyReopenGuard.markOpened();
    void loadConversations();
  }
  function closeHistory() {
    setHistoryOpen(false);
    window.requestAnimationFrame(() => historyTriggerRef.current?.focus());
  }

  /** Switches the active conversation to an existing one picked from the
   * history menu. Persists the pick under THIS panel instance's own storage
   * key (`contextWorkId`-scoped, same as everywhere else in this file) —
   * picking an entire-Library conversation while reading a specific work,
   * say, simply makes that the active chat for this panel going forward,
   * exactly as if the user had asked the first question in it here. */
  async function switchConversation(targetId: string) {
    if (targetId === conversationId) { closeHistory(); return; }
    try {
      const view = await ragJsonFetch<{ conversation: { id: string }; messages: Message[] }>(`/api/rag/conversations/${targetId}`);
      window.localStorage.setItem(conversationStorageKey(contextWorkId), view.conversation.id);
      setConversationId(view.conversation.id);
      setMessages(view.messages);
      setPending("");
      setPendingCitations([]);
      setError(null);
      setConversationUnavailable(false);
      closeHistory();
    } catch {
      setConversationsError("That conversation could not be opened.");
    }
  }

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    const question = draft.trim();
    if (!question || !conversationId || pending) return;
    setPending("");
    setPendingCitations([]);
    setError(null);
    // Covers the gap between send and the first streamed `delta` (see the
    // thinking-indicator render below) — always cleared in `finally`, so
    // every return path (the 404 self-heal's early `return`, a thrown
    // error, or the normal stream-to-completion path) turns it back off.
    setStreaming(true);
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
        const value = JSON.parse(data) as Message | Citation | CompetencyNotice | { text: string } | { message: Message; notFound: boolean };
        if (eventName === "user") setMessages((existing) => [...existing, value as Message]);
        if (eventName === "delta") setPending((existing) => existing + (value as { text: string }).text);
        if (eventName === "citation") setPendingCitations((existing) => [...existing, value as Citation]);
        if (eventName === "competency") competencyNotices = [...competencyNotices, value as CompetencyNotice];
        if (eventName === "done") {
          // The API streams every delta token, THEN citations, THEN this
          // event (see `route.ts`'s `streamAnswer`) — so the trust signal
          // (substantiated vs. no-evidence) is only known for certain here.
          // `notFound` is carried explicitly rather than re-derived from
          // `message.citations.length`, so a `notFound: true` answer that
          // still cites something (finding 2 of the adversarial review)
          // can never be miscolored green.
          const { message, notFound } = value as { message: Message; notFound: boolean };
          setMessages((existing) => [...existing, { ...message, notFound, ...(competencyNotices.length ? { competencyNotices } : {}) }]);
          setPending("");
          setPendingCitations([]);
          if (soundReady) playSound("receive");
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
      if (soundReady) playSound("error");
    } finally {
      setStreaming(false);
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
          {/* Workstream E (plan §3): persistent, non-"AI" disclosure that
              chat participation is also a competency signal — matches the
              sentence added to the `/ask-library` intro and the notice
              detail below. */}
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">Conversations here help Palimnote gauge your familiarity with each topic, so explanations and your roadmap match your level.</p>
          <p className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Scope: {scopeLabel}</p>
        </div>
        <div className="flex gap-1">
          <div className="relative">
            <button
              ref={historyTriggerRef}
              type="button"
              className="app-control app-icon-button"
              aria-label="Conversation history"
              data-tooltip="Conversation history"
              aria-expanded={historyOpen}
              aria-controls={historyMenuId}
              onClick={() => { if (historyOpen) { if (historyReopenGuard.shouldIgnoreClose()) return; closeHistory(); } else { openHistory(); } }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <circle cx="8" cy="8.5" r="6" fill="none" stroke="currentColor" strokeWidth="1.2" />
                <path d="M8 5.2V8.5L10.3 9.9" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
            {historyOpen && (
              <ConversationHistoryMenu
                id={historyMenuId}
                conversations={conversations}
                error={conversationsError}
                activeConversationId={conversationId}
                currentScopeWorkId={contextWorkId}
                onSelect={(pickedId) => void switchConversation(pickedId)}
                onNew={() => void createConversation()}
                onClose={closeHistory}
              />
            )}
          </div>
          <button type="button" className="app-control app-icon-button" aria-label="New conversation" data-tooltip="New conversation" onClick={() => void createConversation()}>＋</button>
          {onClose && <button ref={closeButtonRef} type="button" className="app-control app-icon-button" aria-label="Close chat" onClick={onClose}>×</button>}
        </div>
      </header>
      {/* Phase 23.2 (D-23-x): a chat transcript is exactly the case
          WAI-ARIA's `log` role exists for — new entries append over time
          and the order is meaningful. `role="log"` already implies
          `aria-live="polite"`; the explicit attribute is kept for clarity
          and because this was already relied on before the role existed. */}
      <div ref={scrollRef} role="log" className="min-h-0 flex-1 overflow-y-auto p-4" aria-live="polite">
        {!messages.length && !pending && !streaming && (
          <GreetingCard contextWorkId={contextWorkId} animate={preferences.motionEnabled} onPick={(question) => { setDraft(question); textareaRef.current?.focus(); }} />
        )}
        <ol className="flex flex-col gap-3">
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const showDivider = !previous || dayLabel(previous.createdAt) !== dayLabel(message.createdAt);
            return (
              <Fragment key={message.id}>
                {showDivider && <li aria-hidden="true" className="my-1 text-center text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{dayLabel(message.createdAt)}</li>}
                <MessageCard message={message} />
              </Fragment>
            );
          })}
        </ol>
        {streaming && !pending && <ThinkingIndicator />}
        {pending && <MessageCard message={{ id: "pending", role: "assistant", content: pending, citations: pendingCitations, createdAt: new Date().toISOString(), latencyMs: null }} isPending />}
        {error && (
          <div key={error} className="rag-chat-shake mt-3">
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
        <textarea ref={textareaRef} id="rag-question" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} rows={3} placeholder="What does this passage mean?" className="app-control w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm" disabled={!conversationId || Boolean(pending)} />
        <div className="mt-2 flex items-center justify-between gap-3"><span className="text-xs text-[var(--color-text-muted)]">Socratic, source-linked, and owner-scoped.</span><button type="submit" data-sound="send" disabled={!draft.trim() || !conversationId || Boolean(pending)} className="app-control rounded-md bg-[var(--color-accent-ink)] px-3 py-1.5 text-sm text-[var(--color-background)] disabled:opacity-50">{pending ? "Thinking…" : "Ask"}</button></div>
      </form>
    </section>
  );
}

/** Rendered while a question has been sent but no `delta` token has arrived
 * yet (see `streaming` above) — the gap `pending === ""` alone couldn't
 * distinguish from "nothing asked yet". A decorative ink-dot ripple; the
 * `sr-only` text is what actually informs assistive tech, since the ripple
 * itself is `aria-hidden` and — like every other infinite animation in this
 * codebase (`.beta-badge::after`, `.app-stage-marker`) — is neutralized
 * under both `prefers-reduced-motion` and the app's own `data-motion`
 * toggle without needing its own gating logic here. */
function ThinkingIndicator() {
  return (
    <li className="app-mount me-3 flex items-center gap-2 rounded-lg border border-[var(--color-border)] p-3 text-sm" style={{ borderInlineStart: `3px solid ${TURN_ACCENT.pending}` }}>
      <span aria-hidden="true" className="flex items-center gap-1">
        <span className="rag-chat-dot h-1.5 w-1.5 rounded-full bg-[var(--color-text-muted)]" style={{ animationDelay: "0ms" }} />
        <span className="rag-chat-dot h-1.5 w-1.5 rounded-full bg-[var(--color-text-muted)]" style={{ animationDelay: "150ms" }} />
        <span className="rag-chat-dot h-1.5 w-1.5 rounded-full bg-[var(--color-text-muted)]" style={{ animationDelay: "300ms" }} />
      </span>
      <span className="sr-only">Thinking…</span>
    </li>
  );
}

const SUGGESTED_QUESTIONS_WORK = [
  "What is the central argument of this passage?",
  "How does this respond to earlier thinkers?",
  "What should I read next to understand this?",
];
const SUGGESTED_QUESTIONS_LIBRARY = [
  "What connects the works in my Library?",
  "Where do these authors agree or disagree?",
  "What should I read next?",
];

/** Client-side only, never persisted (plan §1): the moment a real message
 * exists — user or assistant — this stops rendering (see its call site's
 * `!messages.length` guard), so there is nothing here for a server round
 * trip or a DB row to ever get out of sync with. */
function GreetingCard({ contextWorkId, animate, onPick }: { contextWorkId: string | null; animate: boolean; onPick: (question: string) => void }) {
  const greeting = contextWorkId
    ? "I can help you work through this text — ask about an argument, a term, or a passage, and I'll answer using only your Library."
    : "Ask me about an argument, a term, or how your works connect. I'll answer using only your eligible Library, and say plainly when it can't support an answer.";
  const revealed = useTypingReveal(greeting, animate);
  const suggestions = contextWorkId ? SUGGESTED_QUESTIONS_WORK : SUGGESTED_QUESTIONS_LIBRARY;
  return (
    <div className="app-mount me-3 mb-3 rounded-lg border border-[var(--color-border)] p-3 text-sm" style={{ borderInlineStart: `3px solid ${TURN_ACCENT.answered}` }}>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Reading companion</p>
      {/* The animated span is `aria-hidden`; a static `sr-only` twin carries
          the full sentence once, so a screen reader announces it a single
          time rather than on every incremental reveal inside this
          `role="log"` region (each reveal is itself a text mutation, which
          `aria-relevant="additions"` would otherwise re-announce). */}
      <p className="leading-6">
        <span aria-hidden="true">{revealed}{animate && revealed.length < greeting.length && <span className="rag-chat-caret" aria-hidden="true">▍</span>}</span>
        <span className="sr-only">{greeting}</span>
      </p>
      {/* Phase 23.2's 44x44 touch-target floor (self-imposed, above WCAG
          2.5.8's 24px) applies to every real control, greeting chips
          included — `min-h-11` (44px) rather than shrinking the visual
          pill to fit the text. */}
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {suggestions.map((question) => (
          <li key={question}>
            <button type="button" className="app-control inline-flex min-h-11 items-center rounded-full border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-1 text-xs hover:bg-[var(--color-surface-sunken)]" onClick={() => onPick(question)}>{question}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Reveals `text` a few characters at a time when `animate` is true (gated
 * on the workspace motion preference by the caller); otherwise the full
 * text is present from the very first render — never a flash of empty
 * content for a reduced-motion reader. The lazy `useState` initializer
 * (not a synchronous `setState` in the effect body) gives the correct
 * starting value immediately, matching `useNarrowViewport`'s documented
 * "no synchronous setState in an effect body" convention; the interval
 * callback below only ever fires asynchronously. */
function useTypingReveal(text: string, animate: boolean): string {
  const [revealed, setRevealed] = useState(() => (animate ? "" : text));
  useEffect(() => {
    if (!animate) return;
    let index = 0;
    const id = window.setInterval(() => {
      index += 2;
      setRevealed(text.slice(0, index));
      if (index >= text.length) window.clearInterval(id);
    }, 16);
    return () => window.clearInterval(id);
    // `text` is effectively constant for this hook's lifetime (a mounted
    // greeting never changes its own copy); re-running only on `animate`
    // avoids restarting the reveal on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate]);
  return revealed;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

function scopeLabelFor(conversationWorkId: string | null, currentWorkId: string | null): string {
  if (conversationWorkId === null) return "Entire Library";
  if (conversationWorkId === currentWorkId) return "This work";
  return "Another work";
}

function formatUpdatedAt(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Workstream E (plan §4): follows the same convention as `AppShell`'s
 * `PreferencesMenu` — a relative-wrapped trigger with
 * `aria-expanded`/`aria-controls`, an absolutely positioned `role="dialog"`
 * panel with `app-panel-enter`, initial focus on its own close button,
 * Escape closes (stopping propagation so the panel underneath doesn't also
 * treat it as ITS close), and focus returns to the trigger via `rAF` —
 * `closeHistory` (the caller) does that last part, matching
 * `closePreferences`/`closeRag` in `AppShell.tsx`.
 */
function ConversationHistoryMenu({
  id,
  conversations,
  error,
  activeConversationId,
  currentScopeWorkId,
  onSelect,
  onNew,
  onClose,
}: {
  id: string;
  conversations: ConversationSummary[] | null;
  error: string | null;
  activeConversationId: string | null;
  currentScopeWorkId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  return (
    <section
      id={id}
      role="dialog"
      aria-label="Conversation history"
      className="app-panel-enter absolute end-0 top-11 z-40 w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 shadow-xl"
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Conversations</h2>
        <button ref={closeButtonRef} type="button" className="app-control app-icon-button h-7 w-7" aria-label="Close conversation history" onClick={onClose}>×</button>
      </div>
      <button type="button" className="app-control mb-2 min-h-11 w-full rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-start text-xs font-semibold" onClick={onNew}>＋ New conversation</button>
      {error && <p className="mb-2 text-xs text-[var(--color-accent-burgundy)]">{error}</p>}
      {conversations === null && !error && <p className="text-xs text-[var(--color-text-muted)]">Loading…</p>}
      {conversations && conversations.length === 0 && <p className="text-xs text-[var(--color-text-muted)]">No earlier conversations yet.</p>}
      {conversations && conversations.length > 0 && (
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {conversations.map((conversation, index) => (
            <li key={conversation.id} className="app-mount" style={{ animationDelay: `${index * 35}ms` } as React.CSSProperties}>
              <button
                type="button"
                aria-current={conversation.id === activeConversationId ? "true" : undefined}
                className={`app-control min-h-11 w-full rounded-md px-2 py-1.5 text-start text-xs ${conversation.id === activeConversationId ? "bg-[var(--color-surface-sunken)] font-semibold" : "hover:bg-[var(--color-surface-sunken)]"}`}
                onClick={() => onSelect(conversation.id)}
              >
                <span className="block truncate">{conversation.title}</span>
                <span className="mt-0.5 block text-[10px] text-[var(--color-text-muted)]">{scopeLabelFor(conversation.contextWorkId, currentScopeWorkId)} · {formatUpdatedAt(conversation.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type TurnState = "user" | "pending" | "notFound" | "answered";

/**
 * Visual-only restyle to the landing's Ask Library depiction (docs
 * "ui-overhaul-spec.md" §3.3): each turn gets a left accent bar keyed by
 * role/state, matching the depiction's `.chat-ask`/`.chat-answer`/
 * `.chat-empty` convention — ink for the reader's own turn, green for a
 * substantiated answer, umber for the explicit no-evidence fallback.
 *
 * `isPending` (the turn is still streaming, pre-`done`) always wins and
 * renders the neutral `user` treatment: the API streams every delta token
 * BEFORE any citation event and citations before `done` (see
 * `route.ts`'s `streamAnswer`), so a citation-count-based read of an
 * in-flight answer would misrepresent a substantiated answer as
 * "no evidence" for its entire streaming duration. Once a turn is no
 * longer pending, `message.notFound` — the authoritative flag `@ice/rag`
 * computes and the `done` event carries — decides the state, never the
 * citation count, so a `notFound: true` answer that still cites something
 * can't be miscolored green either. `message.notFound` is undefined for
 * message history loaded from the DB (`rag_message` has no persisted
 * `notFound` column, see the `Message` type above) — for THOSE messages
 * only (never a live, in-session turn) the citations-length proxy is used,
 * since it's the only signal available.
 */
function turnState(message: Message, isPending: boolean): TurnState {
  if (message.role === "user") return "user";
  if (isPending) return "pending";
  const noEvidence = message.notFound ?? message.citations.length === 0;
  return noEvidence ? "notFound" : "answered";
}

const TURN_ACCENT: Record<TurnState, string> = {
  user: "var(--color-accent-ink)",
  pending: "var(--color-accent-ink)",
  notFound: "var(--color-accent-umber)",
  answered: "var(--color-accent-green)",
};

function MessageCard({ message, isPending = false }: { message: Message; isPending?: boolean }) {
  const state = turnState(message, isPending);
  return (
    <li
      // `.app-mount` plays a one-shot slide-up/fade entrance exactly once,
      // the moment React actually creates this `<li>`'s DOM node — since
      // each turn keeps the same `key={message.id}` for the rest of its
      // life (see the caller's `messages.map`), it never remounts and so
      // never replays; a freshly appended user or assistant turn is the
      // only thing that ever mounts fresh.
      className={`app-mount rounded-lg p-3 text-sm ${message.role === "user" ? "ms-7 bg-[var(--color-surface)]" : "me-3 border border-[var(--color-border)]"} ${state === "notFound" ? "bg-[var(--color-surface-sunken)]" : ""}`}
      style={{ borderInlineStart: `3px solid ${TURN_ACCENT[state]}` }}
    >
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{message.role === "user" ? "You" : "Library companion"}</p>
      <p className={`whitespace-pre-wrap leading-6 ${state === "notFound" ? "text-[var(--color-accent-umber)]" : ""}`}>
        {message.content}
        {/* Caret shimmer: only while this turn is still streaming (never on
            settled history) and gated the same way as every other
            infinite-loop animation in this file. */}
        {isPending && <span aria-hidden="true" className="rag-chat-caret">▍</span>}
      </p>
      {message.citations.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {message.citations.map((citation) => (
            <li key={citation.chunkId} className="rag-chat-citation-enter flex items-start gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-2 text-xs" style={{ ["--stagger-index" as string]: citation.ordinal }}>
              {/* Contrast fix (adversarial review finding): --color-accent-green
                  flips polarity between themes (dark green in light mode,
                  a pale green in dark mode, both tuned instead for
                  text/border legibility against the page background), so a
                  fixed white glyph fails AA in dark mode (1.97:1, computed).
                  --color-background happens to flip the opposite way each
                  theme needs here — computed 6.90:1 light / 9.14:1 dark,
                  both comfortably above the 4.5:1 floor, no new token
                  required. */}
              <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-green)] font-serif text-[10px] text-[var(--color-background)]">§</span>
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
          {/* Workstream E (plan §3): extends the panel-level competency
              disclosure down to the one place a reader might wonder WHY a
              chat reply just changed something outside the chat itself. */}
          <p className="mt-1 text-[var(--color-text-muted)]">This is one of the small signals used to match explanations and your roadmap to your level.</p>
          <button type="button" className="app-control mt-2 underline disabled:opacity-50" onClick={() => void undo()} disabled={busy}>
            {busy ? "Undoing…" : "Undo"}
          </button>
          {undoError && <p className="mt-1 text-[var(--color-accent-burgundy)]">{undoError}</p>}
        </div>
      )}
    </li>
  );
}
