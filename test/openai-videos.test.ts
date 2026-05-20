import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockAiProviderServer } from "../src/server/create-server.js";

describe("OpenAI Videos mock", () => {
  let server: Server | null = null;
  let baseUrl = "";
  let requestLogPath = "";

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mock-ai-provider-videos-"));
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

  it("creates, lists, retrieves, and downloads video jobs", async () => {
    const form = new FormData();
    form.set("model", "sora-2");
    form.set("prompt", "Show the MIP logo moving gently.");
    form.set("seconds", "4");
    form.set("size", "1280x720");
    const createResponse = await fetch(`${baseUrl}/v1/videos`, {
      method: "POST",
      body: form
    });

    expect(createResponse.status).toBe(200);
    const created = await createResponse.json() as {
      id: string;
      object: string;
      model: string;
      status: string;
      progress: number;
      prompt: string;
    };
    expect(created).toMatchObject({
      object: "video",
      model: "sora-2",
      status: "completed",
      progress: 100,
      prompt: "Show the MIP logo moving gently."
    });

    const listResponse = await fetch(`${baseUrl}/v1/videos`);
    expect(listResponse.status).toBe(200);
    const list = await listResponse.json() as { object: string; data: Array<{ id: string }> };
    expect(list).toMatchObject({
      object: "list",
      data: [{ id: created.id }]
    });

    const retrieveResponse = await fetch(`${baseUrl}/openai/v1/videos/${created.id}`);
    expect(retrieveResponse.status).toBe(200);
    expect(await retrieveResponse.json()).toMatchObject({ id: created.id, status: "completed" });

    const contentResponse = await fetch(`${baseUrl}/v1/videos/${created.id}/content`);
    expect(contentResponse.status).toBe(200);
    expect(contentResponse.headers.get("content-type")).toBe("video/mp4");
    const content = Buffer.from(await contentResponse.arrayBuffer());
    expect(content.subarray(4, 8).toString("ascii")).toBe("ftyp");

    const journal = await readJournal(requestLogPath);
    expect(journal.find((entry) => entry.path === "/v1/videos" && entry.method === "POST")).toMatchObject({
      providerId: "openai",
      apiSurface: "videos",
      model: "sora-2",
      responseType: "video",
      requestBody: {
        prompt: "Show the MIP logo moving gently.",
        seconds: "4",
        size: "1280x720"
      },
      responseBody: {
        id: created.id,
        object: "video",
        status: "completed"
      }
    });
    expect(journal.find((entry) => entry.path === `/v1/videos/${created.id}/content`)).toMatchObject({
      responseSummary: {
        binary: true,
        mediaType: "video",
        videoId: created.id
      }
    });
  });

  it("rejects missing prompts", async () => {
    const response = await fetch(`${baseUrl}/v1/videos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "sora-2" })
    });

    expect(response.status).toBe(400);
    const body = await response.json() as { error: { type: string; message: string } };
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toContain("prompt");
  });
});

async function readJournal(path: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path, "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}
