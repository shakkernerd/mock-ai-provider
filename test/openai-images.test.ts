import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockAiProviderServer } from "../src/server/create-server.js";

describe("OpenAI Images mock", () => {
  let server: Server | null = null;
  let baseUrl = "";
  let requestLogPath = "";

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mock-ai-provider-images-"));
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

  it("serves base64 image generations", async () => {
    const payload = {
      model: "gpt-image-2",
      prompt: "A tiny generated fixture image.",
      n: 2
    };
    const response = await fetch(`${baseUrl}/v1/images/generations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("openai-version")).toBe("2020-10-01");
    const body = await response.json() as {
      created: number;
      data: Array<{ b64_json: string; revised_prompt: string }>;
    };
    expect(body.created).toEqual(expect.any(Number));
    expect(body.data).toHaveLength(2);
    expect(Buffer.from(body.data[0]?.b64_json ?? "", "base64").subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(body.data[0]?.revised_prompt).toBe(payload.prompt);

    const journal = await readJournal(requestLogPath);
    expect(journal.find((entry) => entry.path === "/v1/images/generations")).toMatchObject({
      providerId: "openai",
      apiSurface: "images.generations",
      model: "gpt-image-2",
      status: 200,
      responseType: "image",
      requestBody: payload,
      responseBody: {
        data: [
          { revised_prompt: payload.prompt },
          { revised_prompt: payload.prompt }
        ]
      }
    });
  });

  it("serves url image generations when requested", async () => {
    const response = await fetch(`${baseUrl}/openai/v1/images/generations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt: "A tiny generated fixture image.",
        response_format: "url"
      })
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: Array<{ url: string }>;
    };
    expect(body.data[0]?.url).toBe("http://mock-ai-provider.local/media/default-image.png");
  });

  it("rejects missing prompts", async () => {
    const response = await fetch(`${baseUrl}/v1/images/generations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-2" })
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
