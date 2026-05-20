import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockAiProviderServer } from "../src/server/create-server.js";

describe("OpenAI Responses mock", () => {
  let server: Server | null = null;
  let baseUrl = "";
  let requestLogPath = "";

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mock-ai-provider-responses-"));
    const scriptPath = join(dir, "script.json");
    requestLogPath = join(dir, "requests.jsonl");
    await writeFile(scriptPath, JSON.stringify({
      id: "responses-script",
      steps: [
        {
          id: "responses-final",
          respond: { type: "final-text", text: "Hello from Responses." }
        },
        {
          id: "responses-tool",
          respond: {
            type: "tool-calls",
            toolCalls: [
              {
                id: "call_lookup",
                name: "lookup_order",
                arguments: "{\"order_id\":\"123\"}"
              }
            ]
          }
        }
      ]
    }), "utf8");
    server = await createMockAiProviderServer({
      providers: ["openai"],
      scriptPath,
      requestLogPath
    });
    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address !== "object") {
      throw new Error("server did not bind to a TCP port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => error ? reject(error) : resolve());
      });
      server = null;
    }
  });

  it("serves final text Responses objects", async () => {
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.5",
        input: "Say hello."
      })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("openai-version")).toBe("2020-10-01");
    const body = await response.json() as {
      object: string;
      status: string;
      model: string;
      output_text: string;
      output: Array<{ type: string; role: string; content: Array<{ type: string; text: string }> }>;
    };
    expect(body).toMatchObject({
      object: "response",
      status: "completed",
      model: "gpt-5.5",
      output_text: "Hello from Responses."
    });
    expect(body.output[0]).toMatchObject({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Hello from Responses." }]
    });

    const journal = await readJournal(requestLogPath);
    expect(journal.find((entry) => entry.path === "/v1/responses")).toMatchObject({
      providerId: "openai",
      apiSurface: "responses",
      model: "gpt-5.5",
      status: 200,
      responseType: "final-text",
      finalTextEmitted: "Hello from Responses."
    });
  });

  it("serves function calls from Responses", async () => {
    await fetch(`${baseUrl}/openai/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.5",
        input: "Consume the first scripted response."
      })
    });

    const response = await fetch(`${baseUrl}/openai/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.5",
        input: "Look up an order.",
        tools: [{ type: "function", name: "lookup_order" }]
      })
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      output: Array<{
        type: string;
        call_id: string;
        name: string;
        arguments: string;
      }>;
    };
    expect(body.output[0]).toMatchObject({
      type: "function_call",
      call_id: "call_lookup",
      name: "lookup_order",
      arguments: "{\"order_id\":\"123\"}"
    });
  });

  it("streams Responses text events", async () => {
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.5",
        stream: true,
        input: "Say hello."
      })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain("data: [DONE]");
    const events = readSseEvents(text);
    expect(events[0]).toMatchObject({ type: "response.created" });
    expect(events.find((event) => event.type === "response.output_text.delta")).toMatchObject({
      type: "response.output_text.delta",
      delta: expect.any(String)
    });
    expect(events.find((event) => event.type === "response.output_text.done")).toMatchObject({
      type: "response.output_text.done",
      text: "Hello from Responses."
    });
    expect(events.find((event) => event.type === "response.completed")).toMatchObject({
      type: "response.completed",
      response: {
        status: "completed",
        output_text: "Hello from Responses."
      }
    });
  });
});

async function readJournal(path: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path, "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

function readSseEvents(text: string): Array<Record<string, unknown>> {
  return text
    .split("\n\n")
    .filter((event) => event.startsWith("data: ") && event !== "data: [DONE]")
    .map((event) => JSON.parse(event.slice("data: ".length)) as Record<string, unknown>);
}
