import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockAiProviderServer } from "../src/server/create-server.js";

describe("OpenAI Moderations mock", () => {
  let server: Server | null = null;
  let baseUrl = "";
  let requestLogPath = "";

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mock-ai-provider-moderations-"));
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

  it("serves OpenAI-shaped moderation results on native and provider-prefixed routes", async () => {
    const payload = {
      model: "omni-moderation-latest",
      input: [
        { type: "text", text: "Launch the feature today." },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }
      ]
    };
    const native = await postModeration("/v1/moderations", payload);
    const prefixed = await postModeration("/openai/v1/moderations", payload);

    expect(native.status).toBe(200);
    expect(native.headers.get("openai-version")).toBe("2020-10-01");
    const nativeBody = await native.json() as ModerationBody;
    const prefixedBody = await prefixed.json() as ModerationBody;
    expect(nativeBody.model).toBe("omni-moderation-latest");
    expect(prefixedBody.model).toBe("omni-moderation-latest");
    expect(nativeBody.results).toHaveLength(2);
    expect(nativeBody.results[0]).toMatchObject({
      flagged: false,
      categories: {
        harassment: false,
        "self-harm": false,
        violence: false
      },
      category_scores: {
        harassment: 0,
        "self-harm": 0,
        violence: 0
      },
      category_applied_input_types: {
        harassment: ["text"],
        "self-harm": ["text"],
        violence: ["text"]
      }
    });
    expect(nativeBody.results[1]?.category_applied_input_types).toMatchObject({
      harassment: [],
      "self-harm": ["image"],
      violence: ["image"]
    });

    const journal = await readJournal(requestLogPath);
    expect(journal.filter((entry) => entry.apiSurface === "moderations")).toHaveLength(2);
    expect(journal.find((entry) => entry.path === "/v1/moderations")).toMatchObject({
      providerId: "openai",
      apiSurface: "moderations",
      model: "omni-moderation-latest",
      status: 200,
      responseType: "moderation",
      requestBody: payload,
      responseBody: {
        model: "omni-moderation-latest",
        results: [
          { flagged: false },
          { flagged: false }
        ]
      }
    });
  });

  it("rejects invalid moderation input with OpenAI-style errors", async () => {
    const response = await postModeration("/v1/moderations", {
      model: "omni-moderation-latest",
      input: []
    });

    expect(response.status).toBe(400);
    const body = await response.json() as { error: { type: string; message: string } };
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toContain("input must be a non-empty string or array");
  });

  async function postModeration(route: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  }
});

type ModerationBody = {
  model: string;
  results: Array<{
    flagged: boolean;
    categories: Record<string, boolean>;
    category_scores: Record<string, number>;
    category_applied_input_types: Record<string, string[]>;
  }>;
};

async function readJournal(path: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path, "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}
