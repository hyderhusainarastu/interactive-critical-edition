import { MAX_RETRIES } from "./responses";

/**
 * Anthropic raw-text ("Return ONLY valid JSON") client — RAW-TEXT-VALIDATED
 * mode, promoted to production by the moderator's gate decision
 * (2026-07-26, `docs/eval/research-claims/spike-25-5c-output-mode.md`,
 * "Moderator decision" section).
 *
 * Why this exists instead of always using `AnthropicStructuredClient`
 * (forced tool-use): three judge spikes (Phase 25.5, 25.5b, 25.5c) measured
 * every structured tool-use config against `packages/claims`'s quality
 * gates (`src/eval/gates.ts`) and none ever cleared all three — the closest,
 * 25.5c's Cell 1 (reasoning-first schema), missed pooled macro-F1 by 0.017
 * (0.733 vs. the 0.75 gate). The one config that cleared every gate in that
 * same spike was claude-haiku-4-5, the BASELINE judge prompt, called via
 * this exact raw-text shape: pooled macroF1 0.752 (>=0.75), kappa 0.650
 * (>=0.60), contradiction recall 1.000 (>=0.66) on the 42-pair empirical
 * gold set, and macroF1 0.795/kappa 0.688/contradictionRecall 1.000
 * (PROVISIONAL) on the 36-pair humanities set.
 *
 * Why shipping this deviation from "structured output everywhere" is safe:
 * the spike's own eval-only fence-strip/parse/retry path is hardened here
 * into a real production client with the SAME guarantee every other
 * @ice/ai-adapters structured client makes — a malformed or invalid output
 * is retried up to `MAX_RETRIES` times and, on exhaustion, the call returns
 * a typed failure rather than throwing or ever returning invented data. The
 * caller's `validate()` callback is the same post-parse validation
 * `AnthropicStructuredClient`/`OpenAIResponsesClient` both rely on for
 * closed-enum outputs (e.g. `validateJudgeResponse`) — for a schema whose
 * every field is a closed enum or a bounded string, `validate()` after
 * `JSON.parse` enforces the same shape a JSON-schema/forced-tool-use gate
 * would have enforced up front, just one step later in the pipeline. A
 * production caller that skips a pair on failure (never fabricates a
 * verdict) gets exactly the same fail-closed contract as the structured
 * clients, with none of the measured tool-use quality cost.
 *
 * No vendor SDK — plain fetch, same as the rest of @ice/ai-adapters.
 */

export interface AnthropicTextJsonCall<T> {
  model: string;
  system: string;
  /** The user-turn content. Must itself instruct the model to return only
   *  JSON (e.g. the judge prompt's own "Return ONLY valid JSON... No
   *  preamble, no markdown fences." trailer) — this client does not inject
   *  that instruction on the caller's behalf, so the prompt stays the
   *  single source of truth for what the model is asked to produce. */
  user: string;
  maxOutputTokens?: number;
  /** Validate/normalize the parsed JSON; THROW to reject and trigger a retry. */
  validate: (parsed: unknown) => T;
}

export type AnthropicTextJsonResult<T> =
  | {
      ok: true;
      data: T;
      model: string;
      promptTokens: number;
      completionTokens: number;
    }
  | {
      ok: false;
      /** Human-readable reason retries were exhausted (parse or validation failure). */
      error: string;
      model: string;
      promptTokens: number;
      completionTokens: number;
    };

/** Strips a single leading/trailing ```/```json markdown fence, if present. */
function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export class AnthropicTextJsonClient {
  constructor(
    private readonly apiKey: string | undefined = process.env.ANTHROPIC_API_KEY,
    private readonly baseUrl: string = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1",
  ) {}

  /** True when a real key is configured; callers fall back deterministically otherwise. */
  get available(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Calls the Anthropic Messages API with a plain (non-tool-use) message,
   * parses the response as JSON (fence-stripped first), and runs the
   * caller's `validate()`. Retries the whole call up to `MAX_RETRIES`
   * times on either a parse failure or a `validate()` rejection. On
   * exhaustion this returns `{ ok: false, ... }` — it does NOT throw and
   * it never fabricates a result; the caller is expected to skip the
   * pair/candidate on `ok: false`.
   *
   * A missing API key or a definitive 4xx (except 429) still throws
   * immediately, matching `AnthropicStructuredClient`/`OpenAIResponsesClient` —
   * those are configuration/request errors, not "the model produced
   * something we can't use", so they aren't folded into the typed-failure
   * path.
   */
  async call<T>(params: AnthropicTextJsonCall<T>): Promise<AnthropicTextJsonResult<T>> {
    if (!this.apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
    const body = {
      model: params.model,
      max_tokens: params.maxOutputTokens ?? 800,
      system: params.system,
      messages: [{ role: "user", content: params.user }],
    };

    let lastError: Error | null = null;
    // Accumulated (not overwritten) across attempts — D-25-5, found by the
    // 26.2b adversarial verification: every attempt that reaches
    // `res.json()` has already been billed by Anthropic for those tokens,
    // whether or not its output goes on to parse/validate. Overwriting on
    // each attempt silently dropped every failed attempt's real spend from
    // the logged usage, undercounting cost on any judge/naming call that
    // needed a retry.
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          // 4xx (except 429) won't get better on retry — fail fast.
          if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            throw new Error(`Anthropic Messages ${res.status}: ${(await res.text()).slice(0, 300)}`);
          }
          lastError = new Error(`Anthropic Messages HTTP ${res.status}`);
          continue;
        }
        const json = (await res.json()) as {
          content?: { type: string; text?: string }[];
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        totalPromptTokens += json.usage?.input_tokens ?? 0;
        totalCompletionTokens += json.usage?.output_tokens ?? 0;
        const text = (json.content ?? [])
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("");

        let parsed: unknown;
        try {
          parsed = JSON.parse(stripMarkdownFences(text));
        } catch {
          lastError = new Error("model output was not valid JSON");
          continue;
        }
        const data = params.validate(parsed); // throws → retry
        return {
          ok: true,
          data,
          model: params.model,
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
        };
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        // A definitive 4xx is rethrown immediately (no point retrying).
        if (e.message.startsWith("Anthropic Messages 4")) throw e;
        lastError = e;
      }
    }

    return {
      ok: false,
      error: lastError?.message ?? "Anthropic Messages call failed",
      model: params.model,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
    };
  }
}
