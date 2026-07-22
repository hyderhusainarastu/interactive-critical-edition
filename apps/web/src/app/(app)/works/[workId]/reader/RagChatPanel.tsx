"use client";

import { useEffect, useRef, useState } from "react";

type Citation = { chunkId: string; ordinal: number; href: string; label: string; sourceType: "uploaded" | "open_access"; license?: string };
type Message = { id: string; role: "user" | "assistant"; content: string; citations: Citation[]; createdAt: string; latencyMs: number | null };

function conversationStorageKey(workId: string) {
  return `palimnote:rag-conversation:${workId}`;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.error ?? "Request failed");
  return response.json();
}

export function RagChatPanel({ workId, onClose }: { workId: string; onClose: () => void }) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState("");
  const [pendingCitations, setPendingCitations] = useState<Citation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const stored = window.localStorage.getItem(conversationStorageKey(workId));
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
          body: JSON.stringify({ contextWorkId: workId }),
        });
        window.localStorage.setItem(conversationStorageKey(workId), created.conversation.id);
        if (!cancelled) setConversationId(created.conversation.id);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not open conversation.");
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [workId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, pending]);

  async function createConversation() {
    const created = await jsonFetch<{ conversation: { id: string } }>("/api/rag/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contextWorkId: workId }),
    });
    window.localStorage.setItem(conversationStorageKey(workId), created.conversation.id);
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
      const processEvent = (raw: string) => {
        const eventName = raw.match(/^event: ([^\n]+)/m)?.[1];
        const data = raw.match(/^data: (.+)$/m)?.[1];
        if (!eventName || !data) return;
        const value = JSON.parse(data) as Message | Citation | { text: string } | { message: Message };
        if (eventName === "user") setMessages((existing) => [...existing, value as Message]);
        if (eventName === "delta") setPending((existing) => existing + (value as { text: string }).text);
        if (eventName === "citation") setPendingCitations((existing) => [...existing, value as Citation]);
        if (eventName === "done") {
          setMessages((existing) => [...existing, (value as { message: Message }).message]);
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

  return (
    <section className="fixed inset-y-0 end-0 z-40 flex w-[min(26rem,100vw)] flex-col border-s border-[var(--color-border)] bg-[var(--color-background)] shadow-2xl max-md:inset-x-0 max-md:top-auto max-md:max-h-[78vh] max-md:w-full max-md:rounded-t-xl" aria-label="Library-grounded Socratic chat" role="dialog" aria-modal="true">
      <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] p-4">
        <div><h2 className="font-serif text-lg font-semibold">Ask your Library</h2><p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">Answers use eligible sources only and link to the passage they cite.</p></div>
        <div className="flex gap-1"><button type="button" className="app-icon-button" aria-label="New conversation" data-tooltip="New conversation" onClick={() => void createConversation()}>＋</button><button type="button" className="app-icon-button" aria-label="Close chat" onClick={onClose}>×</button></div>
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
  return <li className={`rounded-lg p-3 text-sm ${message.role === "user" ? "ms-7 bg-[var(--color-surface)]" : "me-3 border border-[var(--color-border)]"}`}><p className="mb-1 text-xs font-medium text-[var(--color-text-muted)]">{message.role === "user" ? "You" : "Library companion"}</p><p className="whitespace-pre-wrap leading-6">{message.content}</p>{message.citations.length > 0 && <ul className="mt-2 flex flex-col gap-1 border-t border-[var(--color-border)] pt-2 text-xs">{message.citations.map((citation) => <li key={citation.chunkId}><a href={citation.href} className="underline" target={citation.sourceType === "open_access" ? "_blank" : undefined} rel={citation.sourceType === "open_access" ? "noreferrer" : undefined}>[{citation.ordinal + 1}] {citation.label}</a>{citation.license && <span className="text-[var(--color-text-muted)]"> · {citation.license}</span>}</li>)}</ul>}</li>;
}
