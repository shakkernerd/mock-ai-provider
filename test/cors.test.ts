import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockAiProviderServer } from "../src/server/create-server.js";

describe("CORS support", () => {
  let server: Server | null = null;
  let baseUrl = "";

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mock-ai-provider-cors-"));
    server = await createMockAiProviderServer({
      providers: ["openai"],
      requestLogPath: join(dir, "requests.jsonl")
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

  it("answers preflight requests", async () => {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type,x-client-request-id"
      }
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")).toContain("authorization");
    expect(response.headers.get("access-control-expose-headers")).toContain("x-request-id");
  });

  it("exposes OpenAI headers on JSON and streaming responses", async () => {
    const jsonResponse = await fetch(`${baseUrl}/v1/models`);
    expect(jsonResponse.headers.get("access-control-allow-origin")).toBe("*");
    expect(jsonResponse.headers.get("access-control-expose-headers")).toContain("openai-processing-ms");

    const streamResponse = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-mock",
        stream: true,
        messages: [{ role: "user", content: "Hello" }]
      })
    });
    expect(streamResponse.headers.get("access-control-allow-origin")).toBe("*");
    expect(streamResponse.headers.get("access-control-expose-headers")).toContain("x-ratelimit-reset-tokens");
  });
});
