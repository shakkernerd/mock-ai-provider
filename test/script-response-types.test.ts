import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createMockAiProviderServer } from "../src/server/create-server.js";

let server: Server | null = null;

describe("script response types", () => {
  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => error ? reject(error) : resolve());
      });
      server = null;
    }
  });

  it("serves scripted delay, error, malformed, and timeout responses", async () => {
    const { baseUrl } = await startScriptedServer({
      id: "response-types",
      steps: [
        {
          id: "delayed",
          respond: {
            type: "delay",
            ms: 1,
            then: { type: "final-text", text: "delayed text" }
          }
        },
        {
          id: "rate-limit",
          respond: {
            type: "error",
            status: 429,
            message: "scripted rate limit",
            errorType: "rate_limit_error",
            code: "rate_limit_exceeded"
          }
        },
        {
          id: "bad-json",
          respond: {
            type: "malformed",
            status: 200,
            body: "{not-json"
          }
        },
        {
          id: "timeout",
          respond: { type: "timeout" }
        }
      ]
    });

    const delayed = await chat(baseUrl, "first");
    expect(delayed.status).toBe(200);
    expect((await delayed.json()).choices[0].message.content).toBe("delayed text");

    const error = await chat(baseUrl, "second");
    expect(error.status).toBe(429);
    expect(await error.json()).toMatchObject({
      error: {
        message: "scripted rate limit",
        type: "rate_limit_error",
        code: "rate_limit_exceeded"
      }
    });

    const malformed = await chat(baseUrl, "third");
    expect(malformed.status).toBe(200);
    expect(await malformed.text()).toBe("{not-json");

    const timeout = await chat(baseUrl, "fourth");
    expect(timeout.status).toBe(408);
    expect(await timeout.json()).toMatchObject({
      error: {
        type: "timeout_error",
        code: "timeout"
      }
    });
  });
});

async function startScriptedServer(script: Record<string, unknown>): Promise<{ baseUrl: string }> {
  const dir = await mkdtemp(join(tmpdir(), "mock-ai-provider-script-responses-"));
  const scriptPath = join(dir, "script.json");
  await writeFile(scriptPath, JSON.stringify(script), "utf8");
  server = await createMockAiProviderServer({
    providers: ["openai"],
    scriptPath,
    requestLogPath: join(dir, "requests.jsonl")
  });
  await new Promise<void>((resolve) => {
    server?.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address !== "object") {
    throw new Error("server did not bind to a TCP port");
  }
  return { baseUrl: `http://127.0.0.1:${address.port}` };
}

function chat(baseUrl: string, content: string): Promise<Response> {
  return fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.5",
      messages: [{ role: "user", content }]
    })
  });
}
