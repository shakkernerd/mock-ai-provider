import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockAiProviderServer } from "../src/server/create-server.js";

describe("OpenAI Files mock", () => {
  let server: Server | null = null;
  let baseUrl = "";
  let requestLogPath = "";

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mock-ai-provider-files-"));
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

  it("uploads, lists, retrieves, downloads, and deletes files", async () => {
    const content = "hello from a mock file\n";
    const form = new FormData();
    form.set("purpose", "assistants");
    form.set("file", new Blob([content], { type: "application/jsonl" }), "fixture.jsonl");

    const uploadResponse = await fetch(`${baseUrl}/v1/files`, { method: "POST", body: form });
    expect(uploadResponse.status).toBe(200);
    const uploaded = await uploadResponse.json() as {
      id: string;
      object: string;
      bytes: number;
      filename: string;
      purpose: string;
    };
    expect(uploaded).toMatchObject({
      object: "file",
      bytes: Buffer.byteLength(content),
      filename: "fixture.jsonl",
      purpose: "assistants"
    });

    const listResponse = await fetch(`${baseUrl}/v1/files?purpose=assistants`);
    expect(await listResponse.json()).toMatchObject({
      object: "list",
      data: [{ id: uploaded.id }],
      has_more: false
    });

    const retrieveResponse = await fetch(`${baseUrl}/openai/v1/files/${uploaded.id}`);
    expect(await retrieveResponse.json()).toMatchObject({ id: uploaded.id, filename: "fixture.jsonl" });

    const contentResponse = await fetch(`${baseUrl}/v1/files/${uploaded.id}/content`);
    expect(contentResponse.status).toBe(200);
    expect(await contentResponse.text()).toBe(content);

    const deleteResponse = await fetch(`${baseUrl}/v1/files/${uploaded.id}`, { method: "DELETE" });
    expect(await deleteResponse.json()).toMatchObject({
      id: uploaded.id,
      object: "file",
      deleted: true
    });

    const afterDeleteResponse = await fetch(`${baseUrl}/v1/files/${uploaded.id}`);
    expect(afterDeleteResponse.status).toBe(404);

    const journal = await readJournal(requestLogPath);
    expect(journal.find((entry) => entry.path === "/v1/files" && entry.method === "POST")).toMatchObject({
      apiSurface: "files",
      responseType: "file",
      requestBody: {
        purpose: "assistants",
        file: {
          filename: "fixture.jsonl",
          byteLength: Buffer.byteLength(content)
        }
      }
    });
    expect(JSON.stringify(journal)).not.toContain(content);
  });
});

async function readJournal(path: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path, "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}
