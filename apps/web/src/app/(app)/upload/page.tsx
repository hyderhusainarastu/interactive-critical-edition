"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const ACCEPTED_TYPES = ["application/pdf", "application/epub+zip", "text/plain", "text/markdown"];
const MAX_SIZE_BYTES = 50 * 1024 * 1024;

export default function UploadPage() {
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);

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
      // proxy route rather than failing the upload outright.
      let stored = false;
      try {
        const direct = await fetch(body.uploadUrl, {
          method: "PUT",
          headers: { "content-type": file.type, "x-upsert": "false" },
          body: file,
        });
        stored = direct.ok;
      } catch {
        stored = false;
      }
      if (!stored) {
        const proxied = await fetch(
          `/api/works/upload/proxy?workId=${body.workId}&documentId=${body.documentId}`,
          { method: "POST", headers: { "content-type": file.type }, body: file },
        );
        if (!proxied.ok) {
          const detail = await proxied.json().catch(() => ({}));
          throw new Error(detail.error ?? "Storage upload failed.");
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
        <p className="text-sm text-[var(--color-text-muted)]">
          PDF, EPUB, TXT, or Markdown — up to 50MB
        </p>
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
