"use client";

import { useEffect, useRef, useState } from "react";

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

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.error ?? "Request failed");
  return response.json();
}

export function RagChatPanel({
  id,
  contextWorkId = null,
  onClose,
  presentation = "drawer",
  widthPx,
}: {
  /** Stable DOM id so a trigger button elsewhere can `aria-controls` this panel. */
  id?: string;
  contextWorkId?: string | null;
  onClose?: () => void;
  presentation?: "drawer" | "page";
  /** Desktop-only drawer width override (e.g. from a resizable sidebar wrapper); ignored below the `md` breakpoint, which always renders full-width. */
  widthPx?: number;
}) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState("");
  const [pendingCitations, setPendingCitations] = useState<Citation[]>([]);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const stored = window.localStorage.getItem(conversationStorageKey(contextWorkId));
        if (stored) {
          const view = await jsonFetch<{ conversation: { id: string }; messages: Message[] }>(`/api/rag/conversations/${stored}`);
          if (!cancelled) {
            setConversationId(view.conversation.id);
            setMessages(view.messages);
          }
          return;
        }
        const created = await jsonFetch<{ conversation: { id: string } }>("/api/rag/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contextWorkId }),
        });
        window.localStorage.setItem(conversationStorageKey(contextWorkId), created.conversation.id);
        if (!cancelled) setConversationId(created.conversation.id);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not open conversation.");
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [contextWorkId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, pending]);

  async function createConversation() {
    const created = await jsonFetch<{ conversation: { id: string } }>("/api/rag/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contextWorkId }),
    });
    window.localStorage.setItem(conversationStorageKey(contextWorkId), created.conversation.id);
    setConversationId(created.conversation.id);
    setMessages([]);
    setPending("");
    setPendingCitations([]);
    setError(null);
  }

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    const question = draft.trim();
    if (!question || !conversationId || pending) return;
    setDraft("");
    setPending("");
    setPendingCitations([]);
    setError(null);
    try {
      const response = await fetch(`/api/rag/conversations/${conversationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question }),
      });
      if (!response.ok || !response.body) throw new Error((await response.json().catch(() => ({})))?.error ?? "Could not answer that question.");
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
        ? "fixed inset-y-0 end-0 z-40 flex w-[min(26rem,100vw)] flex-col border-s border-[var(--color-border)] bg-[var(--color-background)] shadow-2xl md:w-[var(--rag-sidebar-width,min(26rem,100vw))] max-md:inset-x-0 max-md:top-auto max-md:max-h-[78vh] max-md:w-full max-md:rounded-t-xl"
        : "flex min-h-[min(46rem,calc(100vh-12rem))] w-full flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] shadow-sm"}
      style={isDrawer && widthPx ? { ["--rag-sidebar-width" as string]: `${widthPx}px` } : undefined}
      aria-label="Library-grounded Socratic chat"
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
          <h2 className="font-serif text-lg font-semibold">Ask your Library</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">Answers use eligible sources only and link to the passage they cite.</p>
          <p className="mt-1 text-xs font-medium text-[var(--color-text-muted)]">Scope: {scopeLabel}</p>
        </div>
        <div className="flex gap-1"><button type="button" className="app-icon-button" aria-label="New conversation" data-tooltip="New conversation" onClick={() => void createConversation()}>＋</button>{onClose && <button ref={closeButtonRef} type="button" className="app-icon-button" aria-label="Close chat" onClick={onClose}>×</button>}</div>
      </header>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4" aria-live="polite">
        {!messages.length && !pending && <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm text-[var(--color-text-muted)]">Ask about an argument, term, or passage. If your eligible Library does not support an answer, chat will say so rather than guess.</p>}
        <ol className="flex flex-col gap-3">{messages.map((message) => <MessageCard key={message.id} message={message} />)}</ol>
        {pending && <MessageCard message={{ id: "pending", role: "assistant", content: pending, citations: pendingCitations, createdAt: new Date().toISOString(), latencyMs: null }} />}
        {error && <p className="mt-3 text-sm text-[var(--color-accent-burgundy)]">{error}</p>}
      </div>
      <form onSubmit={ask} className="border-t border-[var(--color-border)] p-3">
        <label className="sr-only" htmlFor="rag-question">Ask a question about your Library</label>
        <textarea id="rag-question" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} rows={3} placeholder="What does this passage mean?" className="w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm" disabled={!conversationId || Boolean(pending)} />
        <div className="mt-2 flex items-center justify-between gap-3"><span className="text-xs text-[var(--color-text-muted)]">Socratic, source-linked, and owner-scoped.</span><button type="submit" disabled={!draft.trim() || !conversationId || Boolean(pending)} className="rounded-md bg-[var(--color-accent-ink)] px-3 py-1.5 text-sm text-[var(--color-background)] disabled:opacity-50">{pending ? "Thinking…" : "Ask"}</button></div>
      </form>
    </section>
  );
}

function MessageCard({ message }: { message: Message }) {
  return <li className={`rounded-lg p-3 text-sm ${message.role === "user" ? "ms-7 bg-[var(--color-surface)]" : "me-3 border border-[var(--color-border)]"}`}><p className="mb-1 text-xs font-medium text-[var(--color-text-muted)]">{message.role === "user" ? "You" : "Library companion"}</p><p className="whitespace-pre-wrap leading-6">{message.content}</p>{message.citations.length > 0 && <ul className="mt-2 flex flex-col gap-1 border-t border-[var(--color-border)] pt-2 text-xs">{message.citations.map((citation) => <li key={citation.chunkId}><a href={citation.href} className="underline" target={citation.sourceType === "open_access" ? "_blank" : undefined} rel={citation.sourceType === "open_access" ? "noreferrer" : undefined}>[{citation.ordinal + 1}] {citation.label}</a>{citation.license && <span className="text-[var(--color-text-muted)]"> · {citation.license}</span>}</li>)}</ul>}{message.role === "assistant" && message.competencyNotices?.length ? <CompetencyNoticeList notices={message.competencyNotices} /> : null}</li>;
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
    return <li className="text-[var(--color-text-muted)]">Undone: “{notice.label}” marking removed.</li>;
  }

  return (
    <li>
      <button
        type="button"
        className="text-start underline decoration-dotted underline-offset-2"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        Noted: “{notice.label}” marked {COMPETENCY_LEVEL_LABEL[notice.level]} — based on what you said · {expanded ? "hide" : "details"}
      </button>
      {expanded && (
        <div className="mt-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-xs">
          <p>Your words: “{notice.quote}”</p>
          <p className="mt-1 text-[var(--color-text-muted)]">
            {notice.previousScore === null ? "Was: no record" : `Was: ${notice.previousScore}/100`} → Now: {COMPETENCY_LEVEL_LABEL[notice.level]} ({notice.newScore}/100)
          </p>
          <p className="mt-1 text-[var(--color-text-muted)]">
            Applies to: {notice.targetKind === "concept" ? "your concept map" : "your reading roadmap"}.
          </p>
          <button type="button" className="mt-2 underline disabled:opacity-50" onClick={() => void undo()} disabled={busy}>
            {busy ? "Undoing…" : "Undo"}
          </button>
          {undoError && <p className="mt-1 text-[var(--color-accent-burgundy)]">{undoError}</p>}
        </div>
      )}
    </li>
  );
}
