import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIResponsesClient, safetyIdentifierFor } from "./responses";

function mockResponse(status: number, jsonText: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ output_text: jsonText, usage: { input_tokens: 10, output_tokens: 5 } }),
    text: async () => jsonText,
  };
}

const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };

describe("OpenAIResponsesClient", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("is unavailable without a key and throws if called", async () => {
    const client = new OpenAIResponsesClient(undefined);
    expect(client.available).toBe(false);
    await expect(
      client.call({ model: "m", system: "s", input: "i", schema, schemaName: "t", validate: (x) => x }),
    ).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it("returns validated data and usage on a good structured response", async () => {
    global.fetch = vi.fn(async () => mockResponse(200, JSON.stringify({ ok: true }))) as unknown as typeof fetch;
    const client = new OpenAIResponsesClient("sk-test");
    const res = await client.call({
      model: "gpt-5.4-nano",
      system: "s",
      input: "i",
      schema,
      schemaName: "t",
      validate: (x) => x as { ok: boolean },
    });
    expect(res.data).toEqual({ ok: true });
    expect(res.promptTokens).toBe(10);
    expect(res.completionTokens).toBe(5);
  });

  it("retries when validate() rejects, then succeeds", async () => {
    let call = 0;
    global.fetch = vi.fn(async () => {
      call++;
      return mockResponse(200, JSON.stringify(call < 2 ? { ok: "not-a-bool" } : { ok: true }));
    }) as unknown as typeof fetch;
    const client = new OpenAIResponsesClient("sk-test");
    const res = await client.call({
      model: "m",
      system: "s",
      input: "i",
      schema,
      schemaName: "t",
      validate: (x) => {
        if (typeof (x as { ok: unknown }).ok !== "boolean") throw new Error("invented shape");
        return x as { ok: boolean };
      },
    });
    expect(res.data).toEqual({ ok: true });
    expect(call).toBe(2);
  });

  it("fails closed after exhausting retries on persistently invalid output", async () => {
    global.fetch = vi.fn(async () => mockResponse(200, "not json at all")) as unknown as typeof fetch;
    const client = new OpenAIResponsesClient("sk-test");
    await expect(
      client.call({ model: "m", system: "s", input: "i", schema, schemaName: "t", validate: (x) => x }),
    ).rejects.toThrow(/valid JSON/);
    expect((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3); // initial + 2 retries
  });

  it("does not retry a definitive 4xx", async () => {
    global.fetch = vi.fn(async () => mockResponse(400, "bad request")) as unknown as typeof fetch;
    const client = new OpenAIResponsesClient("sk-test");
    await expect(
      client.call({ model: "m", system: "s", input: "i", schema, schemaName: "t", validate: (x) => x }),
    ).rejects.toThrow(/400/);
    expect((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("derives a stable, non-reversible safety identifier", () => {
    const a = safetyIdentifierFor("user-123");
    expect(a).toHaveLength(32);
    expect(a).toBe(safetyIdentifierFor("user-123"));
    expect(a).not.toContain("user-123");
  });
});
