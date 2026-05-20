import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockAiProviderServer } from "../src/server/create-server.js";

describe("OpenAI Embeddings mock", () => {
  let server: Server | null = null;
  let baseUrl = "";
  let requestLogPath = "";

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mock-ai-provider-embeddings-"));
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

  it("serves deterministic float embeddings on native and provider-prefixed routes", async () => {
    const payload = {
      model: "text-embedding-3-small",
      input: ["alpha", "beta"],
      dimensions: 8,
      encoding_format: "float"
    };
    const first = await postEmbedding("/v1/embeddings", payload);
    const second = await postEmbedding("/openai/v1/embeddings", payload);

    expect(first.status).toBe(200);
    expect(first.headers.get("openai-version")).toBe("2020-10-01");
    const firstBody = await first.json() as EmbeddingsBody;
    const secondBody = await second.json() as EmbeddingsBody;
    expect(firstBody).toEqual(secondBody);
    expect(firstBody).toMatchObject({
      object: "list",
      model: "text-embedding-3-small",
      data: [
        { object: "embedding", index: 0 },
        { object: "embedding", index: 1 }
      ],
      usage: { total_tokens: expect.any(Number) }
    });
    expect(firstBody.data[0]?.embedding).toHaveLength(8);
    expect(firstBody.data[0]?.embedding).not.toEqual(firstBody.data[1]?.embedding);

    const journal = await readJournal(requestLogPath);
    expect(journal.filter((entry) => entry.apiSurface === "embeddings")).toHaveLength(2);
    expect(journal.find((entry) => entry.path === "/v1/embeddings")).toMatchObject({
      providerId: "openai",
      apiSurface: "embeddings",
      model: "text-embedding-3-small",
      status: 200,
      responseType: "embedding",
      requestBody: payload,
      responseBody: {
        object: "list",
        data: [
          { object: "embedding", index: 0 },
          { object: "embedding", index: 1 }
        ]
      }
    });
  });

  it("serves base64 embeddings", async () => {
    const response = await postEmbedding("/v1/embeddings", {
      model: "text-embedding-3-small",
      input: "alpha",
      dimensions: 4,
      encoding_format: "base64"
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: Array<{ embedding: string }>;
    };
    expect(typeof body.data[0]?.embedding).toBe("string");
    expect(Buffer.from(body.data[0]?.embedding ?? "", "base64")).toHaveLength(16);
  });

  it("rejects invalid embedding requests with OpenAI-style errors", async () => {
    const response = await postEmbedding("/v1/embeddings", {
      model: "text-embedding-3-small",
      input: "",
      dimensions: 8
    });

    expect(response.status).toBe(400);
    const body = await response.json() as { error: { type: string; message: string } };
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toContain("input must not be empty");
  });

  async function postEmbedding(route: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  }
});

type EmbeddingsBody = {
  object: string;
  model: string;
  data: Array<{
    object: string;
    index: number;
    embedding: number[];
  }>;
  usage: {
    total_tokens: number;
  };
};

async function readJournal(path: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path, "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}
