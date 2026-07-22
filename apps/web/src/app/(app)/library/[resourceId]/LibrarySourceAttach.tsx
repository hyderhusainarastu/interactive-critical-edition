"use client";

import Link from "next/link";
import { useState } from "react";
import { putWithProgress, readFileAsBase64, sha256 } from "@/lib/uploadClient";

const ACCEPTED_TYPES = ["application/pdf", "application/epub+zip", "text/plain", "text/markdown"];
const MAX_SIZE_BYTES = 50 * 1024 * 1024;
// Base64 expands 3 MiB to 4 MiB, safely under Vercel's ~4.5 MiB request
// ceiling — same reasoning and constant as apps/(app)/upload/page.tsx.
const JSON_PROXY_MAX_BYTES = 3 * 1024 * 1024;

type State = "idle" | "uploading" | "awaiting_duplicate" | "queued" | "failed";

/**
 * "Upload source text" (plan §20.4) for a Library entry that has no owned
 * full text yet. Drives the exact same secure pipeline the batch Upload
 * page uses (`/api/works/upload/init` → signed PUT/proxy → `/complete`),
 * just for one file and passing `learningResourceId` so the server
 * associates the resulting work with this entry's canonical identity
 * instead of starting an unrelated, disconnected upload.
 */
export function LibrarySourceAttach({ resourceId, resourceTitle }: { resourceId: string; resourceTitle: string }) {
  const [state, setState] = useState<State>("idle");
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ workId: string; title: string } | null>(null);
  const [workId, setWorkId] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  async function attempt(file: File, duplicateResolution?: "add_edition") {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      throw new Error("Unsupported file type. Palimnote accepts PDF, EPUB, plain text, and Markdown.");
    }
    if (file.size > MAX_SIZE_BYTES) throw new Error("File is too large — the limit is 50MB.");
    if (file.size === 0) throw new Error("File is empty.");

    const contentHash = await sha256(file);
    const init = await fetch("/api/works/upload/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, type: file.type, size: file.size, contentHash, duplicateResolution, learningResourceId: resourceId }),
    });
    const body = await init.json().catch(() => ({}));
    if (!init.ok) throw new Error(body.error ?? "Upload failed.");
    if (body.duplicate) {
      setDuplicate(body.duplicate);
      setState("awaiting_duplicate");
      return;
    }

    const stored = await putWithProgress(body.uploadUrl, file, (loaded, total) => setProgress({ loaded, total }));
    if (!stored) {
      const proxyUrl = `/api/works/upload/proxy?workId=${body.workId}&documentId=${body.documentId}`;
      let proxied: Response | null = null;
      try {
        proxied = await fetch(proxyUrl, { method: "POST", headers: { "content-type": file.type }, body: file });
      } catch {
        // Some environments also block a File/Blob body to the same origin.
      }
      if (proxied && !proxied.ok) {
        const detail = await proxied.json().catch(() => ({}));
        throw new Error(detail.error ?? "Storage upload failed.");
      }
      if (!proxied) {
        if (file.size > JSON_PROXY_MAX_BYTES) {
          throw new Error("Your browser blocked both file upload paths. The JSON fallback supports files up to 3MB.");
        }
        const encoded = await readFileAsBase64(file);
        const jsonProxy = await fetch(proxyUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ dataBase64: encoded }),
        });
        if (!jsonProxy.ok) {
          const detail = await jsonProxy.json().catch(() => ({}));
          throw new Error(detail.error ?? "Storage upload failed.");
        }
      }
    }

    const complete = await fetch("/api/works/upload/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workId: body.workId, documentId: body.documentId }),
    });
    const completed = await complete.json().catch(() => ({}));
    if (!complete.ok) throw new Error(completed.error ?? "Upload could not be queued.");
    setWorkId(body.workId);
    setState("queued");
  }

  async function handleFile(file: File) {
    setError(null);
    setState("uploading");
    setProgress(null);
    setPendingFile(file);
    try {
      await attempt(file);
    } catch (caught) {
      setState("failed");
      setError(caught instanceof Error ? caught.message : "Upload failed — check your connection and try again.");
    }
  }

  async function resolveDuplicate(resolution: "add_edition" | "cancel") {
    if (resolution === "cancel") {
      setState("idle");
      setDuplicate(null);
      setPendingFile(null);
      return;
    }
    if (!pendingFile) return;
    setState("uploading");
    setDuplicate(null);
    try {
      await attempt(pendingFile, "add_edition");
    } catch (caught) {
      setState("failed");
      setError(caught instanceof Error ? caught.message : "Upload failed — check your connection and try again.");
    }
  }

  if (state === "queued" && workId) {
    return (
      <section aria-labelledby="source-attach-heading" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm">
        <h2 id="source-attach-heading" className="font-serif text-lg font-semibold text-[var(--color-text)]">Upload received</h2>
        <p className="mt-1 text-[var(--color-text-muted)]">
          Private processing has been queued for this source text.{" "}
          <Link href={`/works/${workId}`} className="underline">Follow processing progress</Link>.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="source-attach-heading" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h2 id="source-attach-heading" className="font-serif text-lg font-semibold text-[var(--color-text)]">Upload source text</h2>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        Palimnote has discovered metadata for &ldquo;{resourceTitle}&rdquo; but does not have its full text yet. Upload a
        PDF, EPUB, plain text, or Markdown file (up to 50MB) to add it privately to your own Library — it is stored
        privately and visible only to you.
      </p>

      {state !== "awaiting_duplicate" && (
        <div className="mt-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-background)]" aria-disabled={state === "uploading"}>
            <input
              type="file"
              accept={ACCEPTED_TYPES.join(",")}
              aria-label="Choose file to upload as source text"
              className="hidden"
              disabled={state === "uploading"}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (file) void handleFile(file);
              }}
            />
            {state === "uploading" ? "Uploading…" : "Choose file"}
          </label>
          {state === "uploading" && progress && progress.total > 0 && (
            <div className="mt-2">
              <progress className="w-full" value={progress.loaded} max={progress.total} />
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {Math.round((progress.loaded / progress.total) * 100)}%
              </p>
            </div>
          )}
        </div>
      )}

      {state === "awaiting_duplicate" && duplicate && (
        <div className="mt-3 rounded border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm">
          <p>
            <strong>{duplicate.title}</strong> is already in your Library. Choose how to proceed before this file is
            processed.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link href={`/works/${duplicate.workId}`} className="rounded border border-[var(--color-border)] px-2 py-1">
              Open existing
            </Link>
            <button type="button" className="rounded border border-[var(--color-border)] px-2 py-1" onClick={() => resolveDuplicate("cancel")}>
              Cancel
            </button>
            <button
              type="button"
              className="rounded bg-[var(--color-accent-ink)] px-2 py-1 text-[var(--color-background)]"
              onClick={() => resolveDuplicate("add_edition")}
            >
              Attach as another edition
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-2 text-sm text-[var(--color-accent-burgundy)]" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
