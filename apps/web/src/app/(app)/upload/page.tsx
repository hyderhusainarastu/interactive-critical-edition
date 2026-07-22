"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { useScrollReveal } from "@/hooks/useScrollReveal";

const ACCEPTED_TYPES = ["application/pdf", "application/epub+zip", "text/plain", "text/markdown"];
const MAX_SIZE_BYTES = 50 * 1024 * 1024;
// Base64 expands by 4/3. Keeping the source file at or below 3 MiB keeps
// the JSON request near 4 MiB, safely below Vercel's ~4.5 MiB body ceiling.
const JSON_PROXY_MAX_BYTES = 3 * 1024 * 1024;

type BatchState = "queued" | "uploading" | "awaiting_duplicate" | "queued_for_processing" | "skipped" | "failed";
type BatchItem = {
  id: string;
  file: File;
  state: BatchState;
  progress: { loaded: number; total: number } | null;
  error: string | null;
  workId: string | null;
  duplicate: { workId: string; title: string } | null;
};
type UploadResult =
  | { kind: "complete"; workId: string }
  | { kind: "duplicate"; workId: string; title: string };

/**
 * Real byte-level transfer progress for the primary direct-PUT path. `fetch`
 * has no upload-progress event, so XHR is deliberately limited to this leg;
 * the same-origin proxy and small JSON fallback retain their existing fetch
 * behavior.
 */
function putWithProgress(url: string, file: File, onProgress: (loaded: number, total: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.send(file);
  });
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file for upload."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Could not read the file for upload."));
        return;
      }
      const comma = reader.result.indexOf(",");
      if (comma < 0) {
        reject(new Error("Could not encode the file for upload."));
        return;
      }
      resolve(reader.result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

async function sha256(file: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fileSizeLabel(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export default function UploadPage() {
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropzoneRef = useScrollReveal<HTMLDivElement>();
  const batchStatusRef = useScrollReveal<HTMLElement>();
  const duplicateResolvers = useRef(new Map<string, (resolution: "add_edition" | "skip") => void>());

  function updateItem(id: string, patch: Partial<BatchItem>) {
    setBatchItems((previous) => previous.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  async function uploadFile(
    file: File,
    duplicateResolution: "add_edition" | undefined,
    onProgress: (loaded: number, total: number) => void,
  ): Promise<UploadResult> {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      throw new Error("Unsupported file type. Palimnote accepts PDF, EPUB, plain text, and Markdown.");
    }
    if (file.size > MAX_SIZE_BYTES) throw new Error("File is too large — the limit is 50MB.");
    if (file.size === 0) throw new Error("File is empty.");

    const contentHash = await sha256(file);
    const init = await fetch("/api/works/upload/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, type: file.type, size: file.size, contentHash, duplicateResolution }),
    });
    const body = await init.json().catch(() => ({}));
    if (!init.ok) throw new Error(body.error ?? "Upload failed.");
    if (body.duplicate) return { kind: "duplicate", workId: body.duplicate.workId, title: body.duplicate.title };

    // Primary: direct PUT to the signed Storage URL. Some client environments
    // block cross-origin PUTs, so retain the established same-origin proxy and
    // JSON fallbacks instead of failing a file simply because its first route
    // is unavailable.
    const stored = await putWithProgress(body.uploadUrl, file, onProgress);
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
    return { kind: "complete", workId: body.workId };
  }

  async function processBatch(entries: BatchItem[]) {
    setSubmitting(true);
    for (const entry of entries) {
      updateItem(entry.id, { state: "uploading", progress: null, error: null, duplicate: null });
      try {
        let result = await uploadFile(entry.file, undefined, (loaded, total) => updateItem(entry.id, { progress: { loaded, total } }));
        if (result.kind === "duplicate") {
          updateItem(entry.id, { state: "awaiting_duplicate", duplicate: { workId: result.workId, title: result.title } });
          const resolution = await new Promise<"add_edition" | "skip">((resolve) => duplicateResolvers.current.set(entry.id, resolve));
          duplicateResolvers.current.delete(entry.id);
          if (resolution === "skip") {
            updateItem(entry.id, { state: "skipped", progress: null });
            continue;
          }
          updateItem(entry.id, { state: "uploading", duplicate: null, progress: null });
          result = await uploadFile(entry.file, "add_edition", (loaded, total) => updateItem(entry.id, { progress: { loaded, total } }));
          if (result.kind === "duplicate") throw new Error("This duplicate could not be resolved. Please try the file again later.");
        }
        updateItem(entry.id, { state: "queued_for_processing", workId: result.workId, progress: null });
      } catch (error) {
        updateItem(entry.id, {
          state: "failed",
          progress: null,
          error: error instanceof Error ? error.message : "Upload failed — check your connection and try again.",
        });
      }
    }
    setSubmitting(false);
  }

  function beginBatch(files: File[]) {
    if (submitting || files.length === 0) return;
    const entries = files.map((file, index): BatchItem => ({
      id: `${Date.now()}-${index}-${file.name}`,
      file,
      state: "queued",
      progress: null,
      error: null,
      workId: null,
      duplicate: null,
    }));
    setBatchItems(entries);
    void processBatch(entries);
  }

  function resolveDuplicate(id: string, resolution: "add_edition" | "skip") {
    duplicateResolvers.current.get(id)?.(resolution);
  }

  const activeItem = batchItems.find((item) => item.state === "uploading" || item.state === "awaiting_duplicate");
  const completedCount = batchItems.filter((item) => item.state === "queued_for_processing" || item.state === "skipped" || item.state === "failed").length;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-12">
      <PageHeader title="Upload works" description="Add one or more PDF, EPUB, plain text, or Markdown files for private processing." />

      <div
        ref={dropzoneRef}
        onDragOver={(event) => { event.preventDefault(); if (!submitting) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          beginBatch(Array.from(event.dataTransfer.files));
        }}
        onClick={() => { if (!submitting) inputRef.current?.click(); }}
        role="button"
        tabIndex={submitting ? -1 : 0}
        aria-disabled={submitting}
        onKeyDown={(event) => {
          if (!submitting && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        className="app-reveal flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-16 text-center transition-colors hover:border-[var(--color-accent-umber)] focus-visible:border-[var(--color-accent-ink)]"
        style={{
          borderColor: dragging ? "var(--color-accent-ink)" : "var(--color-border)",
          background: dragging ? "var(--color-surface)" : "transparent",
          cursor: submitting ? "wait" : "pointer",
        }}
      >
        <p className="text-[var(--color-text)]">
          {submitting ? `Working through ${batchItems.length} files…` : "Drop files here, or click to choose them"}
        </p>
        <p className="text-sm text-[var(--color-text-muted)]">PDF, EPUB, TXT, or Markdown — up to 50MB each</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_TYPES.join(",")}
          aria-label="Choose files to upload"
          className="hidden"
          onChange={(event) => {
            beginBatch(Array.from(event.target.files ?? []));
            event.currentTarget.value = "";
          }}
        />
      </div>

      {batchItems.length > 0 && (
        <section ref={batchStatusRef} aria-labelledby="batch-status-heading" className="app-reveal rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="batch-status-heading" className="font-serif text-lg font-semibold">Batch status</h2>
            <p className="text-xs text-[var(--color-text-muted)]" aria-live="polite">{completedCount} of {batchItems.length} resolved{activeItem ? ` · ${activeItem.file.name}` : ""}</p>
          </div>
          <ol className="mt-3 flex flex-col gap-2">
            {batchItems.map((item) => (
              <li key={item.id} data-upload-item={item.file.name} className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="font-medium text-[var(--color-text)]">{item.file.name}</span>
                  <BatchStateLabel item={item} />
                </div>
                {item.state === "uploading" && item.progress && item.progress.total > 0 && (
                  <div className="mt-2">
                    <progress className="w-full" value={item.progress.loaded} max={item.progress.total} />
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">{Math.round((item.progress.loaded / item.progress.total) * 100)}% · {fileSizeLabel(item.progress.loaded)} of {fileSizeLabel(item.progress.total)}</p>
                  </div>
                )}
                {item.state === "awaiting_duplicate" && item.duplicate && (
                  <div className="mt-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-xs">
                    <p><strong>{item.duplicate.title}</strong> is already among your uploaded works. Choose whether this file is another edition before Palimnote continues the batch.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Link href={`/works/${item.duplicate.workId}`} className="rounded border border-[var(--color-border)] px-2 py-1">Open existing</Link>
                      <button type="button" className="rounded border border-[var(--color-border)] px-2 py-1" onClick={() => resolveDuplicate(item.id, "skip")}>Skip this file</button>
                      <button type="button" className="rounded bg-[var(--color-accent-ink)] px-2 py-1 text-[var(--color-background)]" onClick={() => resolveDuplicate(item.id, "add_edition")}>Add as another edition</button>
                    </div>
                  </div>
                )}
                {item.error && <p className="mt-2 text-xs text-[var(--color-accent-burgundy)]">{item.error}</p>}
                {item.state === "queued_for_processing" && item.workId && <p className="mt-1 text-xs text-[var(--color-text-muted)]">Private processing has been queued. <Link href={`/works/${item.workId}`} className="underline">Open work</Link></p>}
              </li>
            ))}
          </ol>
          {!submitting && completedCount === batchItems.length && (
            <p className="mt-3 text-sm text-[var(--color-text-muted)]"><Link href="/works" className="underline">View uploaded works</Link> to follow processing progress.</p>
          )}
        </section>
      )}
    </div>
  );
}

function BatchStateLabel({ item }: { item: BatchItem }) {
  const labels: Record<BatchState, string> = {
    queued: "Waiting",
    uploading: "Uploading privately",
    awaiting_duplicate: "Decision needed",
    queued_for_processing: "Queued for processing",
    skipped: "Skipped",
    failed: "Needs attention",
  };
  return <span className="text-xs text-[var(--color-text-muted)]">{labels[item.state]}</span>;
}
