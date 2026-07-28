"use client";

import { useEffect, useRef } from "react";

const CHANNEL_NAME = "palimnote-writer";

export interface DocumentSavedMessage {
  documentId: string;
  updatedAt: string;
}

/**
 * Stage 6 spec §4.3: whether an incoming same-browser broadcast should
 * surface as a cross-tab conflict in THIS tab — only when it names the
 * document currently open here, and only when this tab itself has
 * unsaved-or-unconfirmed local edits (`status !== "Saved"`). No
 * sender-identity check is needed: `BroadcastChannel` never delivers a
 * tab's own posted messages back to itself (a browser-API guarantee, not
 * something this module has to re-implement). Pure predicate, unit-tested
 * the same plain-function way as `panels/panelState.ts`'s `toggleWidePanel`
 * (see that file's own comment on why).
 */
export function shouldShowCrossTabConflict(message: DocumentSavedMessage, activeDocumentId: string | undefined, status: string): boolean {
  if (!activeDocumentId || message.documentId !== activeDocumentId) return false;
  return status !== "Saved";
}

/**
 * Stage 6 spec §4.3: a same-browser, cross-tab conflict signal built on the
 * native `BroadcastChannel` API — no new dependency. Explicit, stated
 * limitation (not silently solved): this detects only same-browser,
 * multi-tab conflicts. Two different browsers/devices editing the same
 * document is not detectable without a server-side `expectedUpdatedAt`
 * contract, which is flagged in the spec as a follow-up outside this lane's
 * file ownership (touches the PATCH route and `writerData.ts`).
 *
 * `activeDocumentId`/`status`/`onConflict` are read through refs updated on
 * every render rather than as effect dependencies, so the one `BroadcastChannel`
 * this hook opens is created once per mount and always sees the latest
 * values — reopening the channel on every keystroke would risk missing a
 * message during the brief close/reopen gap for no benefit.
 */
export function useDocumentBroadcast({
  activeDocumentId,
  status,
  onConflict,
}: {
  activeDocumentId: string | undefined;
  status: string;
  onConflict: (message: DocumentSavedMessage) => void;
}) {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const activeDocumentIdRef = useRef(activeDocumentId);
  const statusRef = useRef(status);
  const onConflictRef = useRef(onConflict);

  // Refs are written in an effect, never during render (React's own rule —
  // a ref mutated while rendering can't be relied on to reflect that render's
  // values by the time anything else reads it). This effect's only job is
  // keeping the three refs current; the channel-subscription effect below
  // reads them, not `activeDocumentId`/`status`/`onConflict` directly, so it
  // can stay mount-once (see that effect's own comment on why).
  useEffect(() => {
    activeDocumentIdRef.current = activeDocumentId;
    statusRef.current = status;
    onConflictRef.current = onConflict;
  }, [activeDocumentId, status, onConflict]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<DocumentSavedMessage>) => {
      if (shouldShowCrossTabConflict(event.data, activeDocumentIdRef.current, statusRef.current)) {
        onConflictRef.current(event.data);
      }
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, []);

  function postSaved(documentId: string) {
    const message: DocumentSavedMessage = { documentId, updatedAt: new Date().toISOString() };
    channelRef.current?.postMessage(message);
  }

  return { postSaved };
}
