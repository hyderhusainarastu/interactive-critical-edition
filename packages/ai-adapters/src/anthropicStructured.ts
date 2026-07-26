import { MAX_RETRIES, type StructuredResult } from "./responses";

/**
 * Anthropic Messages API structured-output client, at parity with
 * `OpenAIResponsesClient` (responses.ts) — same retry budget, same
 * fail-closed-on-malformed-output behavior, same "caller's `validate()`
 * is the only source of truth for a valid result" contract. Anthropic has
 * no JSON-schema response-format flag, so structured output is obtained
 * via forced tool-use instead (plan §33's requirement — a strict schema
 * constrains the shape — is met by the tool's `input_schema`, which the
 * API itself validates before ever returning a `tool_use` block).
 *
 * No vendor SDK — plain fetch, same as the rest of @ice/ai-adapters.
 */

export interface AnthropicStructuredCall<T> {
  model: string;
  system: string;
  /** The user-turn content (Anthropic's Messages API role naming — the
   *  equivalent of OpenAIResponsesClient's `input`). */
  user: string;
  /** JSON Schema for the expected output (object); becomes the forced
   *  tool's `input_schema`. */
  schema: Record<string, unknown>;
  /** Doubles as the tool name — must match Anthropic's tool-name pattern
   *  (letters/digits/underscore/hyphen, <=64 chars). */
  schemaName: string;
  maxOutputTokens?: number;
  /** Validate/normalize the parsed tool input; THROW to reject and trigger a retry. */
  validate: (parsed: unknown) => T;
}

interface AnthropicContentBlock {
  type: string;
  name?: string;
  input?: unknown;
}

export class AnthropicStructuredClient {
  constructor(
    private readonly apiKey: string | undefined = process.env.ANTHROPIC_API_KEY,
    private readonly baseUrl: string = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1",
  ) {}

  /** True when a real key is configured; callers fall back deterministically otherwise. */
  get available(): boolean {
    return Boolean(this.apiKey);
  }

  async call<T>(params: AnthropicStructuredCall<T>): Promise<StructuredResult<T>> {
    if (!this.apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
    const body = {
      model: params.model,
      max_tokens: params.maxOutputTokens ?? 800,
      system: params.system,
      messages: [{ role: "user", content: params.user }],
      // One tool named per call, tool_choice forced to it, so the model
      // cannot reply with free text instead of the structured shape.
      tools: [
        {
          name: params.schemaName,
          description: `Return the requested structured output as ${params.schemaName}.`,
          input_schema: params.schema,
        },
      ],
      tool_choice: { type: "tool", name: params.schemaName },
    };

    let lastError: Error | null = null;
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
          content?: AnthropicContentBlock[];
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        const toolUse = (json.content ?? []).find(
          (block) => block.type === "tool_use" && block.name === params.schemaName,
        );
        if (!toolUse || toolUse.input === undefined) {
          lastError = new Error("model did not return the forced tool_use block");
          continue;
        }
        const data = params.validate(toolUse.input); // throws → retry
        return {
          data,
          model: params.model,
          promptTokens: json.usage?.input_tokens ?? 0,
          completionTokens: json.usage?.output_tokens ?? 0,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // A definitive 4xx is rethrown immediately (no point retrying).
        if (lastError.message.startsWith("Anthropic Messages 4")) throw lastError;
      }
    }
    throw lastError ?? new Error("Anthropic Messages call failed");
  }
}
