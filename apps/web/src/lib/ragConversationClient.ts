/**
 * Owner-blocking production defect (2026-07-23): `RagChatPanel` persists its
 * conversation id in `localStorage`, keyed only by display scope
 * (`palimnote:rag-conversation:${contextWorkId ?? "library"}`), not by user
 * or account lifetime. Once that pointer stops resolving server-side — the
 * conversation's owning account was deleted (test-account cleanup, a shared
 * browser used across disposable QA accounts on the same production origin,
 * etc.) — the panel's mount effect caught the resulting 404, stored the raw
 * "Not found" string as `error`, and never fell back to creating a fresh
 * conversation the way the true first-run path already does. `conversationId`
 * stayed null forever, which permanently disabled the textarea/Ask button
 * (both gated on `!conversationId`) for that storage key on every page that
 * shares it — read as "intermittent across pages" because only the pages
 * sharing the poisoned key were affected, not because the failure itself was
 * intermittent.
 *
 * This module makes the stored-id lookup and the first-run creation the
 * SAME code path: a 404 while resolving a stored id is treated exactly like
 * "no id was stored" rather than a fatal error. Only a failure of the
 * fresh create itself is allowed to propagate to the caller, which is the
 * one case where the panel legitimately has nothing to show but a retry
 * affordance. Kept dependency-injected and framework-free so it can be
 * exercised by a plain `tsx` assertion script — this repo has no web-side
 * Vitest wiring (see `apps/web/src/lib/*.test.ts` for the established
 * pattern: import `node:assert/strict`, run via
 * `pnpm --filter web exec tsx <path>`).
 */

export class RagApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RagApiError";
    this.status = status;
  }
}

/** Same shape `fetch`/`jsonFetch` already used, now attaching the real HTTP
 *  status so callers can distinguish "gone" (404, self-healable) from any
 *  other failure (network error, 401, 500 — never silently papered over). */
export async function ragJsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}));
    const message = (body as { error?: string } | null)?.error ?? "Request failed";
    throw new RagApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}

export function isRagNotFound(error: unknown): error is RagApiError {
  return error instanceof RagApiError && error.status === 404;
}

export interface RagConversationLoadDeps<TMessage> {
  getStoredConversationId(): string | null;
  setStoredConversationId(id: string): void;
  clearStoredConversationId(): void;
  fetchConversation(id: string): Promise<{ conversation: { id: string }; messages: TMessage[] }>;
  createConversation(): Promise<{ conversation: { id: string } }>;
}

export interface RagConversationLoadResult<TMessage> {
  conversationId: string;
  messages: TMessage[];
  /** True when a stale/invalid stored pointer was discarded and a fresh
   *  conversation created transparently in its place — callers can use this
   *  to decide whether a quiet "started a new conversation" notice is worth
   *  showing, without ever surfacing the raw server error. */
  healedStalePointer: boolean;
}

/**
 * Resolves the panel's conversation on mount (or on an explicit retry):
 * tries a stored id first; if the server reports it gone (404), the stale
 * pointer is cleared and a fresh conversation is created in its place,
 * exactly like the true first-run path. A non-404 failure (network error,
 * 401, 500, …) is never treated as "gone" — it propagates untouched so the
 * caller doesn't quietly discard a conversation the server actually still
 * has, and a failure of the fresh create itself always propagates too.
 */
export async function loadOrCreateRagConversation<TMessage>(
  deps: RagConversationLoadDeps<TMessage>,
): Promise<RagConversationLoadResult<TMessage>> {
  const stored = deps.getStoredConversationId();
  if (stored) {
    try {
      const view = await deps.fetchConversation(stored);
      return { conversationId: view.conversation.id, messages: view.messages, healedStalePointer: false };
    } catch (error) {
      if (!isRagNotFound(error)) throw error;
      deps.clearStoredConversationId();
    }
  }
  const created = await deps.createConversation();
  deps.setStoredConversationId(created.conversation.id);
  return { conversationId: created.conversation.id, messages: [], healedStalePointer: stored !== null };
}
