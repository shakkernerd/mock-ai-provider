import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockAiProviderServer } from "../src/server/create-server.js";

describe("OpenAI Models mock", () => {
  let server: Server | null = null;
  let baseUrl = "";
  let requestLogPath = "";

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mock-ai-provider-models-"));
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

  it("lists models on the native and provider-prefixed OpenAI routes", async () => {
    for (const route of ["/v1/models", "/openai/v1/models"]) {
      const response = await fetch(`${baseUrl}${route}`, {
        headers: { "x-client-request-id": `client-${route}` }
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("x-request-id")).toMatch(/^req_/);
      expect(response.headers.get("openai-processing-ms")).toMatch(/^\d+$/);
      expect(response.headers.get("openai-version")).toBe("2020-10-01");
      expect(response.headers.get("x-ratelimit-limit-tokens")).toBe("100000000");
      const body = await response.json() as {
        object: string;
        data: Array<{ id: string; object: string; owned_by: string }>;
      };
      expect(body.object).toBe("list");
      expect(body.data).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "gpt-mock",
          object: "model",
          owned_by: "mock-ai-provider"
        }),
        expect.objectContaining({
          id: "gpt-5.2",
          object: "model",
          owned_by: "openai"
        }),
        expect.objectContaining({
          id: "gpt-5.5",
          object: "model",
          owned_by: "openai"
        }),
        expect.objectContaining({
          id: "gpt-5.5-pro",
          object: "model",
          owned_by: "openai"
        }),
        expect.objectContaining({
          id: "gpt-5.4-mini",
          object: "model",
          owned_by: "openai"
        })
      ]));
    }

    const journal = await readJournal(requestLogPath);
    expect(journal.filter((entry) => entry.apiSurface === "models")).toHaveLength(2);
    expect(journal.find((entry) => entry.path === "/v1/models")).toMatchObject({
      providerId: "openai",
      apiSurface: "models",
      status: 200,
      model: null,
      responseType: "model"
    });
  });

  it("retrieves an individual model", async () => {
    const response = await fetch(`${baseUrl}/v1/models/gpt-5.5`);

    expect(response.status).toBe(200);
    const body = await response.json() as {
      id: string;
      object: string;
      created: number;
      owned_by: string;
    };
    expect(body).toEqual({
      id: "gpt-5.5",
      object: "model",
      created: expect.any(Number),
      owned_by: "openai"
    });

    const journal = await readJournal(requestLogPath);
    expect(journal.find((entry) => entry.path === "/v1/models/gpt-5.5")).toMatchObject({
      providerId: "openai",
      apiSurface: "models",
      status: 200,
      model: "gpt-5.5"
    });
  });

  it("returns an OpenAI-style not-found error for unknown models", async () => {
    const response = await fetch(`${baseUrl}/openai/v1/models/not-real`);

    expect(response.status).toBe(404);
    expect(response.headers.get("openai-processing-ms")).toMatch(/^\d+$/);
    const body = await response.json() as {
      error: { type: string; code: string; param: string };
    };
    expect(body.error).toMatchObject({
      type: "invalid_request_error",
      code: "model_not_found",
      param: "model"
    });

    const journal = await readJournal(requestLogPath);
    expect(journal.find((entry) => entry.path === "/openai/v1/models/not-real")).toMatchObject({
      providerId: "openai",
      apiSurface: "models",
      status: 404,
      model: "not-real",
      errorClass: "invalid_request_error"
    });
  });
});

async function readJournal(path: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path, "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}
