import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockAiProviderServer } from "../src/server/create-server.js";

describe("admin routes", () => {
  let server: Server | null = null;
  let baseUrl = "";

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mock-ai-provider-admin-"));
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

  it("lists and resets provider request journal entries", async () => {
    await fetch(`${baseUrl}/v1/models`);
    await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.5", messages: [{ role: "user", content: "hello" }] })
    });

    const listResponse = await fetch(`${baseUrl}/admin/requests?limit=1`);
    expect(listResponse.status).toBe(200);
    const list = await listResponse.json() as { object: string; data: Array<{ path: string; requestBody?: unknown }> };
    expect(list.object).toBe("list");
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({
      path: "/v1/chat/completions",
      requestBody: {
        messages: [{ role: "user", content: "hello" }]
      }
    });

    const resetResponse = await fetch(`${baseUrl}/admin/reset`, { method: "POST" });
    expect(resetResponse.status).toBe(200);
    expect(await resetResponse.json()).toMatchObject({ ok: true, requestCount: 0 });

    const afterResetResponse = await fetch(`${baseUrl}/admin/requests`);
    expect(await afterResetResponse.json()).toMatchObject({ object: "list", data: [] });
  });
});
