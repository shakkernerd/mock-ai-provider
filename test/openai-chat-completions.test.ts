import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createMockAiProviderServer } from "../src/server/create-server.js";

describe("OpenAI Chat Completions mock", () => {
  let server: Server | null = null;
  let baseUrl = "";
  let requestLogPath = "";

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mock-ai-provider-"));
    const scriptPath = join(dir, "script.json");
    requestLogPath = join(dir, "requests.jsonl");
    await writeFile(scriptPath, JSON.stringify({
      id: "chat-final",
      steps: [
        {
          id: "first-final",
          respond: {
            type: "final-text",
            text: "Hello from the mock provider."
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

  it("serves health and native OpenAI chat completions", async () => {
    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-key",
        "content-type": "application/json",
        "x-client-request-id": "client-request-1"
      },
      body: JSON.stringify({
        model: "gpt-mock",
        messages: [
          { role: "system", content: "You are a strict assistant." },
          { role: "user", content: "Hello" }
        ]
      })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toMatch(/^req_/);
    expect(response.headers.get("openai-processing-ms")).toMatch(/^\d+$/);
    expect(response.headers.get("openai-version")).toBe("2020-10-01");
    expect(response.headers.get("x-ratelimit-limit-requests")).toBe("1000000");
    expect(response.headers.get("x-ratelimit-remaining-requests")).toBe("999999");
    const body = await response.json() as {
      object: string;
      choices: Array<{ message: { role: string; content: string } }>;
    };
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0]?.message).toEqual({
      role: "assistant",
      content: "Hello from the mock provider."
    });

    const journal = await readJournal(requestLogPath);
    const providerEntry = journal.find((entry) => entry.path === "/v1/chat/completions");
    expect(providerEntry).toMatchObject({
      providerId: "openai",
      apiSurface: "chat.completions",
      model: "gpt-mock",
      status: 200,
      clientRequestId: "client-request-1",
      responseType: "final-text",
      finalTextEmitted: "Hello from the mock provider."
    });
    expect(providerEntry?.requestBody).toMatchObject({
      model: "gpt-mock",
      messages: [
        { role: "system", content: "You are a strict assistant." },
        { role: "user", content: "Hello" }
      ]
    });
    expect(providerEntry?.responseBody).toMatchObject({
      object: "chat.completion",
      choices: [
        {
          message: {
            role: "assistant",
            content: "Hello from the mock provider."
          }
        }
      ]
    });
  });

  it("serves provider-prefixed OpenAI chat completions", async () => {
    const response = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-mock",
        messages: [{ role: "user", content: "Hello" }]
      })
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    expect(body.choices[0]?.message.content).toBe("Hello from the mock provider.");
  });

  it("streams OpenAI chat completion chunks", async () => {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-mock",
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: "user", content: "Hello" }]
      })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("openai-version")).toBe("2020-10-01");
    const streamText = await response.text();
    expect(streamText).toContain("data: [DONE]");
    const events = readSseEvents(streamText);
    expect(events[0]).toMatchObject({
      object: "chat.completion.chunk",
      choices: [{ delta: { role: "assistant" } }]
    });
    const content = events
      .flatMap((event) => event.choices as Array<{ delta?: { content?: string } }>)
      .map((choice) => choice.delta?.content ?? "")
      .join("");
    expect(content).toBe("Hello from the mock provider.");
    expect(events.at(-1)).toMatchObject({
      object: "chat.completion.chunk",
      choices: [],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    });

    const journal = await readJournal(requestLogPath);
    expect(journal.find((entry) => entry.path === "/v1/chat/completions" && entry.stream === true)).toMatchObject({
      providerId: "openai",
      apiSurface: "chat.completions",
      model: "gpt-mock",
      status: 200,
      responseType: "final-text",
      finalTextEmitted: "Hello from the mock provider.",
      responseSummary: {
        stream: true,
        done: true,
        finalText: "Hello from the mock provider."
      }
    });
  });

  it("uses the built-in script when no script path is provided", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mock-ai-provider-default-script-"));
    const defaultServer = await createMockAiProviderServer({
      providers: ["openai"],
      requestLogPath: join(dir, "requests.jsonl")
    });
    try {
      await new Promise<void>((resolve) => {
        defaultServer.listen(0, "127.0.0.1", resolve);
      });
      const address = defaultServer.address();
      if (!address || typeof address !== "object") {
        throw new Error("server did not bind to a TCP port");
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-mock",
          messages: [{ role: "user", content: "Hello" }]
        })
      });

      expect(response.status).toBe(200);
      const body = await response.json() as {
        choices: Array<{ message: { content: string } }>;
      };
      expect(body.choices[0]?.message.content).toBe("Hello from mock AI provider");
    } finally {
      await new Promise<void>((resolve, reject) => {
        defaultServer.close((error) => error ? reject(error) : resolve());
      });
    }
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
