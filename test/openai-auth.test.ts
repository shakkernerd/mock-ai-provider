import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createMockAiProviderServer } from "../src/server/create-server.js";

describe("OpenAI auth modes", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => error ? reject(error) : resolve());
      });
      server = null;
    }
  });

  it("allows OpenAI routes without auth by default", async () => {
    const { baseUrl } = await startServer({ strict: false });

    const response = await fetch(`${baseUrl}/v1/models`);

    expect(response.status).toBe(200);
  });

  it("can require a matching bearer token", async () => {
    const { baseUrl, requestLogPath } = await startServer({ strict: true, apiKey: "test-key" });

    const missing = await fetch(`${baseUrl}/v1/models`);
    expect(missing.status).toBe(401);
    expect(missing.headers.get("x-request-id")).toMatch(/^req_/);
    expect(await missing.json()).toMatchObject({
      error: {
        type: "invalid_request_error",
        code: "invalid_api_key"
      }
    });

    const authorized = await fetch(`${baseUrl}/v1/models`, {
      headers: { authorization: "Bearer test-key" }
    });
    expect(authorized.status).toBe(200);

    const journal = await readJournal(requestLogPath);
    expect(journal.find((entry) => entry.status === 401)).toMatchObject({
      providerId: "openai",
      status: 401,
      errorClass: "invalid_request_error"
    });
  });

  async function startServer(auth: { strict: boolean; apiKey?: string }): Promise<{
    baseUrl: string;
    requestLogPath: string;
  }> {
    const dir = await mkdtemp(join(tmpdir(), "mock-ai-provider-auth-"));
    const requestLogPath = join(dir, "requests.jsonl");
    server = await createMockAiProviderServer({
      providers: ["openai"],
      requestLogPath,
      openAiAuth: auth
    });
    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address !== "object") {
      throw new Error("server did not bind to a TCP port");
    }
    return {
      baseUrl: `http://127.0.0.1:${address.port}`,
      requestLogPath
    };
  }
});

async function readJournal(path: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path, "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}
