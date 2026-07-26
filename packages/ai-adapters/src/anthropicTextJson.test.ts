import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicTextJsonClient } from "./anthropicTextJson";

function mockResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function textResponse(text: string) {
  return mockResponse(200, {
    content: [{ type: "text", text }],
    usage: { input_tokens: 20, output_tokens: 10 },
  });
}

const validate = (parsed: unknown) => {
  const x = parsed as { ok?: unknown };
  if (typeof x.ok !== "boolean") throw new Error("invented shape");
  return x as { ok: boolean };
};

describe("AnthropicTextJsonClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is unavailable without a key and throws if called", async () => {
    const client = new AnthropicTextJsonClient(undefined);
    expect(client.available).toBe(false);
    await expect(client.call({ model: "m", system: "s", user: "u", validate })).rejects.toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it("happy path: parses plain JSON text into validated data and usage", async () => {
    global.fetch = vi.fn(async () => textResponse(JSON.stringify({ ok: true }))) as unknown as typeof fetch;
    const client = new AnthropicTextJsonClient("ak-test");
    const res = await client.call({
      model: "claude-haiku-4-5-20251001",
      system: "s",
      user: "u",
      validate,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual({ ok: true });
      expect(res.model).toBe("claude-haiku-4-5-20251001");
      expect(res.promptTokens).toBe(20);
      expect(res.completionTokens).toBe(10);
    }
    expect((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("strips a markdown JSON fence before parsing", async () => {
    global.fetch = vi.fn(async () =>
      textResponse('```json\n{"ok": true}\n```'),
    ) as unknown as typeof fetch;
    const client = new AnthropicTextJsonClient("ak-test");
    const res = await client.call({ model: "m", system: "s", user: "u", validate });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ ok: true });
  });

  it("strips a bare (no-json-tag) markdown fence before parsing", async () => {
    global.fetch = vi.fn(async () => textResponse('```\n{"ok": true}\n```')) as unknown as typeof fetch;
    const client = new AnthropicTextJsonClient("ak-test");
    const res = await client.call({ model: "m", system: "s", user: "u", validate });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ ok: true });
  });

  it("retries on a JSON parse failure, then succeeds", async () => {
    let call = 0;
    global.fetch = vi.fn(async () => {
      call++;
      return textResponse(call < 2 ? "not json at all" : JSON.stringify({ ok: true }));
    }) as unknown as typeof fetch;
    const client = new AnthropicTextJsonClient("ak-test");
    const res = await client.call({ model: "m", system: "s", user: "u", validate });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ ok: true });
    expect(call).toBe(2);
  });

  it("retries when validate() rejects the parsed JSON, then succeeds", async () => {
    let call = 0;
    global.fetch = vi.fn(async () => {
      call++;
      return textResponse(JSON.stringify(call < 2 ? { ok: "not-a-bool" } : { ok: true }));
    }) as unknown as typeof fetch;
    const client = new AnthropicTextJsonClient("ak-test");
    const res = await client.call({ model: "m", system: "s", user: "u", validate });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ ok: true });
    expect(call).toBe(2);
  });

  it("returns a typed failure (never throws, never fabricates) after exhausting retries", async () => {
    global.fetch = vi.fn(async () => textResponse("still not json")) as unknown as typeof fetch;
    const client = new AnthropicTextJsonClient("ak-test");
    const res = await client.call({ model: "m", system: "s", user: "u", validate });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/not valid JSON/);
      expect(res.model).toBe("m");
    }
    // initial + MAX_RETRIES(2) retries = 3 calls
    expect((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
  });

  it("returns a typed failure after exhausting retries on repeated validation failure", async () => {
    global.fetch = vi.fn(async () => textResponse(JSON.stringify({ ok: "nope" }))) as unknown as typeof fetch;
    const client = new AnthropicTextJsonClient("ak-test");
    const res = await client.call({ model: "m", system: "s", user: "u", validate });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/invented shape/);
    expect((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
  });

  it("does not retry a definitive 4xx — throws immediately", async () => {
    global.fetch = vi.fn(async () => mockResponse(400, { error: "bad request" })) as unknown as typeof fetch;
    const client = new AnthropicTextJsonClient("ak-test");
    await expect(client.call({ model: "m", system: "s", user: "u", validate })).rejects.toThrow(/400/);
    expect((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("retries on a 429 and a 5xx", async () => {
    let call = 0;
    global.fetch = vi.fn(async () => {
      call++;
      if (call === 1) return mockResponse(429, { error: "rate limited" });
      if (call === 2) return mockResponse(500, { error: "server error" });
      return textResponse(JSON.stringify({ ok: true }));
    }) as unknown as typeof fetch;
    const client = new AnthropicTextJsonClient("ak-test");
    const res = await client.call({ model: "m", system: "s", user: "u", validate });
    expect(res.ok).toBe(true);
    expect(call).toBe(3);
  });
});
