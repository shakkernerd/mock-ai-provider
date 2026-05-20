import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockAiProviderServer } from "../src/server/create-server.js";

describe("OpenAI Batches mock", () => {
  let server: Server | null = null;
  let baseUrl = "";
  let requestLogPath = "";

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mock-ai-provider-batches-"));
    requestLogPath = join(dir, "requests.jsonl");
    server = await createMockAiProviderServer({
      providers: ["openai"],
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

  it("creates, lists, retrieves, and cancels batches", async () => {
    const request = {
      input_file_id: "file-input",
      endpoint: "/v1/chat/completions",
      completion_window: "24h",
      metadata: { suite: "mock" }
    };
    const createResponse = await fetch(`${baseUrl}/v1/batches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request)
    });
    expect(createResponse.status).toBe(200);
    const batch = await createResponse.json() as { id: string; object: string; status: string };
    expect(batch).toMatchObject({
      object: "batch",
      status: "completed"
    });

    const listResponse = await fetch(`${baseUrl}/v1/batches`);
    expect(await listResponse.json()).toMatchObject({
      object: "list",
      data: [{ id: batch.id }]
    });

    const retrieveResponse = await fetch(`${baseUrl}/openai/v1/batches/${batch.id}`);
    expect(await retrieveResponse.json()).toMatchObject({
      id: batch.id,
      input_file_id: "file-input",
      endpoint: "/v1/chat/completions"
    });

    const cancelResponse = await fetch(`${baseUrl}/v1/batches/${batch.id}/cancel`, { method: "POST" });
    expect(await cancelResponse.json()).toMatchObject({
      id: batch.id,
      status: "cancelling",
      completed_at: null
    });

    const missingResponse = await fetch(`${baseUrl}/v1/batches/not-real`);
    expect(missingResponse.status).toBe(404);

    const journal = await readJournal(requestLogPath);
    expect(journal.find((entry) => entry.path === "/v1/batches" && entry.method === "POST")).toMatchObject({
      apiSurface: "batches",
      responseType: "batch",
      requestBody: request
    });
  });
});

async function readJournal(path: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path, "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}
