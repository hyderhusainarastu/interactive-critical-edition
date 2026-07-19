import type { LLMCompletionParams, LLMCompletionResult, LLMProvider } from "../types";

/**
 * OpenAI Chat Completions via plain fetch (no SDK dependency — see
 * types.ts). Uses JSON mode so the classifier can parse a structured
 * response reliably. Never called unless OPENAI_API_KEY is present; the
 * factory in ../index.ts falls back to the heuristic classifier when it
 * isn't.
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  constructor(
    readonly model: string,
    private readonly apiKey: string,
  ) {}

  async complete(params: LLMCompletionParams): Promise<LLMCompletionResult> {
    // GPT-5 family / reasoning models reject `max_tokens` (need
    // `max_completion_tokens`) and any non-default `temperature`. Older chat
    // models (gpt-4o-mini) take the deterministic temperature:0 + max_tokens.
    const isReasoning = /^(gpt-5|o\d)/.test(this.model);
    const body: Record<string, unknown> = {
      model: this.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.prompt },
      ],
    };
    if (isReasoning) {
      // Leave headroom for reasoning tokens so the JSON output isn't truncated.
      body.max_completion_tokens = params.maxTokens ? Math.max(params.maxTokens, 1024) : 1024;
    } else {
      body.temperature = 0;
      body.max_tokens = params.maxTokens ?? 400;
    }
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    return {
      text: data.choices?.[0]?.message?.content ?? "",
      provider: this.name,
      model: this.model,
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    };
  }
}
