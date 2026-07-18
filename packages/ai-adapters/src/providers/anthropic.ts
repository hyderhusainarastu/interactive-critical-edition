import type { LLMCompletionParams, LLMCompletionResult, LLMProvider } from "../types";

/**
 * Anthropic Messages API via plain fetch (no SDK dependency). Anthropic
 * has no JSON-mode flag, so the system prompt instructs a JSON-only
 * reply and the classifier parses defensively. Never called unless
 * ANTHROPIC_API_KEY is present.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  constructor(
    readonly model: string,
    private readonly apiKey: string,
  ) {}

  async complete(params: LLMCompletionParams): Promise<LLMCompletionResult> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: params.maxTokens ?? 400,
        temperature: 0,
        system: `${params.system}\n\nRespond with a single JSON object and nothing else.`,
        messages: [{ role: "user", content: params.prompt }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Anthropic ${res.status}: ${detail.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const text = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");

    return {
      text,
      provider: this.name,
      model: this.model,
      promptTokens: data.usage?.input_tokens ?? 0,
      completionTokens: data.usage?.output_tokens ?? 0,
    };
  }
}
