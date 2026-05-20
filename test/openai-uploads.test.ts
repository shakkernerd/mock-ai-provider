import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockAiProviderServer } from "../src/server/create-server.js";

describe("OpenAI Uploads mock", () => {
  let server: Server | null = null;
  let baseUrl = "";
  let requestLogPath = "";

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mock-ai-provider-uploads-"));
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

  it("creates multipart uploads, adds parts, completes to a file, and exposes the file content", async () => {
    const content = "hello from upload parts\n";
    const uploadResponse = await postJson("/v1/uploads", {
      filename: "large.jsonl",
      purpose: "assistants",
      bytes: Buffer.byteLength(content),
      mime_type: "application/jsonl"
    });
    expect(uploadResponse.status).toBe(200);
    const upload = await uploadResponse.json() as { id: string; object: string; status: string };
    expect(upload).toMatchObject({
      object: "upload",
      status: "pending"
    });

    const form = new FormData();
    form.set("data", new Blob([content], { type: "application/jsonl" }), "part-1.jsonl");
    const partResponse = await fetch(`${baseUrl}/v1/uploads/${upload.id}/parts`, {
      method: "POST",
      body: form
    });
    expect(partResponse.status).toBe(200);
    const part = await partResponse.json() as { id: string; object: string; upload_id: string };
    expect(part).toMatchObject({
      object: "upload.part",
      upload_id: upload.id
    });

    const completeResponse = await postJson(`/v1/uploads/${upload.id}/complete`, {
      part_ids: [part.id]
    });
    expect(completeResponse.status).toBe(200);
    const file = await completeResponse.json() as {
      id: string;
      object: string;
      filename: string;
      purpose: string;
      bytes: number;
    };
    expect(file).toMatchObject({
      object: "file",
      filename: "large.jsonl",
      purpose: "assistants",
      bytes: Buffer.byteLength(content)
    });

    const contentResponse = await fetch(`${baseUrl}/openai/v1/files/${file.id}/content`);
    expect(contentResponse.status).toBe(200);
    expect(await contentResponse.text()).toBe(content);

    const journal = await readJournal(requestLogPath);
    expect(journal.filter((entry) => entry.apiSurface === "uploads")).toHaveLength(3);
    expect(journal.find((entry) => entry.path === `/v1/uploads/${upload.id}/parts`)).toMatchObject({
      apiSurface: "uploads",
      responseType: "upload",
      requestBody: {
        data: {
          filename: "part-1.jsonl",
          byteLength: Buffer.byteLength(content)
        }
      }
    });
    expect(JSON.stringify(journal)).not.toContain(content);
  });

  async function postJson(route: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  }
});

async function readJournal(path: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path, "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}
