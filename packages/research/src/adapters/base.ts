import type { AdapterResult, ProviderName, ProviderStatus, RawResource } from "../types";

export interface FetchJsonResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** Present when the request threw (network error / timeout). */
  error?: string;
}

/** Timeout-bounded JSON fetch that never throws — a network error or non-2xx
 *  becomes `{ ok:false }`, so adapters classify it into an honest status. */
export async function fetchJson<T>(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<FetchJsonResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const res = await fetch(url, { headers: opts.headers, signal: controller.signal });
    if (!res.ok) return { ok: false, status: res.status, data: null };
    const data = (await res.json()) as T;
    return { ok: true, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

export interface AttemptBody {
  resources: RawResource[];
  rateLimited?: boolean;
  unavailable?: boolean;
  /** The request could not complete (network error / timeout) — distinct from
   *  `unavailable`, where the provider responded but not usefully. */
  failed?: boolean;
  /** Diagnostic message for a failed/unavailable attempt (stored honestly). */
  error?: string;
  inspectionDepth?: number;
}

/**
 * Wrap a provider search in a `ProviderAttempt`. The body reports resources and
 * (optionally) that it was rate-limited/unavailable; any throw becomes a
 * `failed` attempt with the error message. This is what guarantees every
 * provider — success or not — leaves an auditable record (plan §33).
 */
export async function runAttempt(
  provider: ProviderName,
  queries: string[],
  body: () => Promise<AttemptBody>,
): Promise<AdapterResult> {
  const start = Date.now();
  try {
    const r = await body();
    const status: ProviderStatus = r.failed
      ? "failed"
      : r.rateLimited
        ? "rate_limited"
        : r.unavailable
          ? "unavailable"
          : "queried";
    return {
      attempt: {
        provider,
        status,
        queries,
        resultCount: r.resources.length,
        inspectionDepth: r.inspectionDepth ?? 0,
        latencyMs: Date.now() - start,
        ...(r.error ? { error: r.error } : {}),
      },
      resources: r.resources,
    };
  } catch (err) {
    return {
      attempt: {
        provider,
        status: "failed",
        queries,
        resultCount: 0,
        inspectionDepth: 0,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      },
      resources: [],
    };
  }
}

/** A disabled adapter still records that it was NOT consulted (no silent skip). */
export function disabledAttempt(provider: ProviderName): AdapterResult {
  return {
    attempt: { provider, status: "disabled", queries: [], resultCount: 0, inspectionDepth: 0, latencyMs: 0 },
    resources: [],
  };
}

/** Rebuild abstract text from OpenAlex's inverted index (metadata excerpt). */
export function reconstructInvertedAbstract(index: Record<string, number[]> | null | undefined): string | null {
  if (!index) return null;
  const positions: string[] = [];
  for (const [word, locs] of Object.entries(index)) for (const loc of locs) positions[loc] = word;
  const text = positions.filter(Boolean).join(" ").trim();
  return text ? text.slice(0, 600) : null;
}

export function userAgent(email?: string): string {
  return `InteractiveCriticalEdition/0.1 (${email ?? "https://github.com/hyderhusainarastu/interactive-critical-edition"})`;
}
