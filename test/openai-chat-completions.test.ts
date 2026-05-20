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
        messages: [{ role: "user", content: "Hello" }]
      })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toMatch(/^req_/);
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
