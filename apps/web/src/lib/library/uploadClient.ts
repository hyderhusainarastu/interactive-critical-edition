/**
 * Shared browser-side helpers for the secure upload pipeline (plan §20.4:
 * "reuse the existing secure upload pipeline ... do not build a parallel
 * upload path"). Extracted from `apps/(app)/upload/page.tsx`'s inline
 * implementations so a second client entry point — the Library detail
 * page's "Upload source text" attach flow — can drive the exact same
 * `/api/works/upload/init` → signed PUT (with a same-origin proxy/JSON
 * fallback) → `/api/works/upload/complete` sequence without re-deriving it,
 * rather than inventing a second transport. `upload/page.tsx` itself is left
 * untouched here (its own batch-specific state machine stays put) to avoid
 * risking its existing, passing E2E coverage.
 */

/**
 * Real byte-level transfer progress for the primary direct-PUT path. `fetch`
 * has no upload-progress event, so XHR is deliberately limited to this leg.
 */
export function putWithProgress(url: string, file: File, onProgress: (loaded: number, total: number) => void): Promise<boolean> {
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

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file for upload."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Could not encode the file for upload."));
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

export async function sha256(file: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
