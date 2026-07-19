import { createHash } from "node:crypto";

/**
 * OpenAI Responses API client with structured (JSON-schema) outputs (plan §33).
 * Every model call goes through here: a strict JSON schema constrains the shape,
 * the output is parsed and passed to a caller `validate()` that rejects invented
 * data (titles/authors/URLs/quotes it can't corroborate). A malformed or invalid
 * output is retried at most twice, then the call fails closed (the caller treats
 * a failure as "no result", never as fabricated content).
 *
 * No vendor SDK — plain fetch, same as the rest of @ice/ai-adapters.
 */

export interface StructuredCall<T> {
  model: string;
  system: string;
  input: string;
  /** JSON Schema for the expected output (object). */
  schema: Record<string, unknown>;
  schemaName: string;
  /** Privacy-preserving per-user identifier for OpenAI safety systems. */
  safetyIdentifier?: string;
  maxOutputTokens?: number;
  /** Validate/normalize parsed JSON; THROW to reject and trigger a retry. */
  validate: (parsed: unknown) => T;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

/** Stable, non-reversible per-user id for `safety_identifier` (never the raw id). */
export function safetyIdentifierFor(userId: string): string {
  return createHash("sha256").update(`ice:${userId}`).digest("hex").slice(0, 32);
}

function extractOutputText(resp: unknown): string {
  const r = resp as { output_text?: unknown; output?: { content?: { type?: string; text?: string }[] }[] };
  if (typeof r.output_text === "string" && r.output_text.length > 0) return r.output_text;
  for (const item of r.output ?? []) {
    for (const c of item.content ?? []) {
      if (c.type === "output_text" && typeof c.text === "string") return c.text;
    }
  }
  return "";
}

export const MAX_RETRIES = 2;

export class OpenAIResponsesClient {
  constructor(
    private readonly apiKey: string | undefined = process.env.OPENAI_API_KEY,
    private readonly baseUrl: string = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  ) {}

  /** True when a real key is configured; callers fall back deterministically otherwise. */
  get available(): boolean {
    return Boolean(this.apiKey);
  }

  async call<T>(params: StructuredCall<T>): Promise<StructuredResult<T>> {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY not configured");
    const body = {
      model: params.model,
      input: [
        { role: "system", content: params.system },
        { role: "user", content: params.input },
      ],
      text: {
        format: {
          type: "json_schema",
          name: params.schemaName,
          schema: params.schema,
          strict: true,
        },
      },
      max_output_tokens: params.maxOutputTokens ?? 800,
      ...(params.safetyIdentifier ? { safety_identifier: params.safetyIdentifier } : {}),
    };

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}/responses`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          // 4xx (except 429) won't get better on retry — fail fast.
          if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            throw new Error(`OpenAI Responses ${res.status}: ${(await res.text()).slice(0, 300)}`);
          }
          lastError = new Error(`OpenAI Responses HTTP ${res.status}`);
          continue;
        }
        const json = (await res.json()) as { usage?: { input_tokens?: number; output_tokens?: number } };
        const text = extractOutputText(json);
        if (!text) {
          lastError = new Error("empty model output");
          continue;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          lastError = new Error("model output was not valid JSON");
          continue;
        }
        const data = params.validate(parsed); // throws → retry
        return {
          data,
          model: params.model,
          promptTokens: json.usage?.input_tokens ?? 0,
          completionTokens: json.usage?.output_tokens ?? 0,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // A definitive 4xx is rethrown immediately (no point retrying).
        if (lastError.message.startsWith("OpenAI Responses 4")) throw lastError;
      }
    }
    throw lastError ?? new Error("OpenAI Responses call failed");
  }
}
