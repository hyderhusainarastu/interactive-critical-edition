import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicStructuredClient } from "./anthropicStructured";

function mockResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function toolUseResponse(name: string, input: unknown) {
  return mockResponse(200, {
    content: [{ type: "tool_use", name, input }],
    usage: { input_tokens: 15, output_tokens: 8 },
  });
}

const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };

describe("AnthropicStructuredClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is unavailable without a key and throws if called", async () => {
    const client = new AnthropicStructuredClient(undefined);
    expect(client.available).toBe(false);
    await expect(
      client.call({ model: "m", system: "s", user: "u", schema, schemaName: "t", validate: (x) => x }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it("parses a forced tool_use block into validated data and usage", async () => {
    global.fetch = vi.fn(async () => toolUseResponse("t", { ok: true })) as unknown as typeof fetch;
    const client = new AnthropicStructuredClient("ak-test");
    const res = await client.call({
      model: "claude-haiku-4-5-20251001",
      system: "s",
      user: "u",
      schema,
      schemaName: "t",
      validate: (x) => x as { ok: boolean },
    });
    expect(res.data).toEqual({ ok: true });
    expect(res.model).toBe("claude-haiku-4-5-20251001");
    expect(res.promptTokens).toBe(15);
    expect(res.completionTokens).toBe(8);
  });

  it("sends a forced tool_choice naming exactly the one tool built from the schema", async () => {
    const fetchMock = vi.fn(async () => toolUseResponse("my_schema", { ok: true })) as unknown as typeof fetch;
    global.fetch = fetchMock;
    const client = new AnthropicStructuredClient("ak-test");
    await client.call({ model: "m", system: "s", user: "u", schema, schemaName: "my_schema", validate: (x) => x });
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse(init.body as string) as {
      tools: { name: string; input_schema: unknown }[];
      tool_choice: { type: string; name: string };
    };
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe("my_schema");
    expect(body.tools[0].input_schema).toEqual(schema);
    expect(body.tool_choice).toEqual({ type: "tool", name: "my_schema" });
    expect((init.headers as Record<string, string>)["anthropic-version"]).toBe("2023-06-01");
  });

  it("retries when validate() rejects, then succeeds", async () => {
    let call = 0;
    global.fetch = vi.fn(async () => {
      call++;
      return toolUseResponse("t", call < 2 ? { ok: "not-a-bool" } : { ok: true });
    }) as unknown as typeof fetch;
    const client = new AnthropicStructuredClient("ak-test");
    const res = await client.call({
      model: "m",
      system: "s",
      user: "u",
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

  it("fails closed after exhausting retries when no tool_use block is returned", async () => {
    global.fetch = vi.fn(async () => mockResponse(200, { content: [{ type: "text", text: "sorry, no." }] })) as unknown as typeof fetch;
    const client = new AnthropicStructuredClient("ak-test");
    await expect(
      client.call({ model: "m", system: "s", user: "u", schema, schemaName: "t", validate: (x) => x }),
    ).rejects.toThrow(/tool_use/);
    expect((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3); // initial + 2 retries
  });

  it("ignores a tool_use block for a different tool name than the one forced", async () => {
    global.fetch = vi.fn(async () => toolUseResponse("some_other_tool", { ok: true })) as unknown as typeof fetch;
    const client = new AnthropicStructuredClient("ak-test");
    await expect(
      client.call({ model: "m", system: "s", user: "u", schema, schemaName: "t", validate: (x) => x }),
    ).rejects.toThrow(/tool_use/);
  });

  it("does not retry a definitive 4xx", async () => {
    global.fetch = vi.fn(async () => mockResponse(400, { error: "bad request" })) as unknown as typeof fetch;
    const client = new AnthropicStructuredClient("ak-test");
    await expect(
      client.call({ model: "m", system: "s", user: "u", schema, schemaName: "t", validate: (x) => x }),
    ).rejects.toThrow(/400/);
    expect((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
});
