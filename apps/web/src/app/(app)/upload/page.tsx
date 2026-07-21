"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const ACCEPTED_TYPES = ["application/pdf", "application/epub+zip", "text/plain", "text/markdown"];
const MAX_SIZE_BYTES = 50 * 1024 * 1024;
// Base64 expands by 4/3. Keeping the source file at or below 3 MiB keeps
// the JSON request near 4 MiB, safely below Vercel's ~4.5 MiB body ceiling.
const JSON_PROXY_MAX_BYTES = 3 * 1024 * 1024;

/**
 * Real byte-level transfer progress for the primary direct-PUT path (plan
 * §36 11.3) — `fetch` has no upload-progress event, so this is the one
 * primary-path change; the small-file proxy/base64 fallbacks are
 * unaffected and stay on `fetch`. Resolves `false` on any transport
 * failure (mirroring the previous try/catch-around-fetch behavior) so the
 * caller falls through to the proxy path exactly as before.
 */
function putWithProgress(url: string, file: File, onProgress: (loaded: number, total: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
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

export default function UploadPage() {
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    setProgress(null);

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError(
        "Unsupported file type. Phase 2 supports PDF (text-layer), plain text, and Markdown — EPUB and scanned/OCR PDF come in later phases.",
      );
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError("File is too large — the limit is 50MB.");
      return;
    }

    setSubmitting(true);

    try {
      const init = await fetch("/api/works/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, type: file.type, size: file.size }),
      });
      const body = await init.json().catch(() => ({}));
      if (!init.ok) {
        setError(body.error ?? "Upload failed.");
        setSubmitting(false);
        return;
      }
      // Primary: direct PUT to the signed Storage URL (no serverless body
      // limit). Some client environments block cross-origin PUTs to
      // supabase.co entirely, so small files fall back to a same-origin
      // proxy route rather than failing the upload outright. XHR (not
      // fetch) so real byte-level progress is available.
      const stored = await putWithProgress(body.uploadUrl, file, (loaded, total) => setProgress({ loaded, total }));
      if (!stored) {
        const proxyUrl = `/api/works/upload/proxy?workId=${body.workId}&documentId=${body.documentId}`;
        let proxied: Response | null = null;
        try {
          proxied = await fetch(proxyUrl, {
            method: "POST",
            headers: { "content-type": file.type },
            body: file,
          });
        } catch {
          // A small number of client environments block requests whose body
          // is a File/Blob, even to the same origin. The final fallback below
          // sends ordinary JSON, which those environments allow.
        }

        if (proxied && !proxied.ok) {
          const detail = await proxied.json().catch(() => ({}));
          throw new Error(detail.error ?? "Storage upload failed.");
        }

        if (!proxied) {
          if (file.size > JSON_PROXY_MAX_BYTES) {
            throw new Error(
              "Your browser blocked both file upload paths. The JSON fallback supports files up to 3MB.",
            );
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
      router.push(`/works/${body.workId}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Upload failed — check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-12">
      <h1 className="text-3xl font-semibold text-[var(--color-text)]">
        Upload a work
      </h1>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) void handleFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-16 text-center"
        style={{
          borderColor: dragging
            ? "var(--color-accent-ink)"
            : "var(--color-border)",
          background: dragging ? "var(--color-surface)" : "transparent",
        }}
      >
        <p className="text-[var(--color-text)]">
          {submitting
            ? "Uploading…"
            : "Drop a file here, or click to choose one"}
        </p>
        {submitting && progress && progress.total > 0 ? (
          <div className="w-full max-w-xs">
            <progress
              className="w-full"
              value={progress.loaded}
              max={progress.total}
            />
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              {Math.round((progress.loaded / progress.total) * 100)}% ·{" "}
              {(progress.loaded / (1024 * 1024)).toFixed(1)}MB of {(progress.total / (1024 * 1024)).toFixed(1)}MB
            </p>
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">
            PDF, EPUB, TXT, or Markdown — up to 50MB
          </p>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      </div>

      {error && (
        <p className="rounded-md bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-accent-burgundy)]">
          {error}
        </p>
      )}
    </div>
  );
}
