import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockAiProviderServer } from "../src/server/create-server.js";

describe("OpenAI Completions mock", () => {
  let server: Server | null = null;
  let baseUrl = "";
  let requestLogPath = "";

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mock-ai-provider-completions-"));
    requestLogPath = join(dir, "requests.jsonl");
    server = await createMockAiProviderServer({
      providers: ["openai"],
      requestLogPath,
      script: {
        id: "completion-script",
        steps: [
          {
            id: "completion-final",
            match: { apiSurface: "completions" },
            respond: { type: "final-text", text: "Completion from mock AI provider" }
          }
        ]
      }
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

  it("serves text completions on native and provider-prefixed routes", async () => {
    const payload = {
      model: "gpt-3.5-turbo-instruct",
      prompt: "Write a tagline: ",
      max_tokens: 16,
      echo: true
    };
    const native = await postCompletion("/v1/completions", payload);
    const prefixed = await postCompletion("/openai/v1/completions", payload);

    expect(native.status).toBe(200);
    expect(native.headers.get("openai-version")).toBe("2020-10-01");
    const nativeBody = await native.json() as CompletionBody;
    const prefixedBody = await prefixed.json() as CompletionBody;
    expect(nativeBody.object).toBe("text_completion");
    expect(nativeBody.model).toBe("gpt-3.5-turbo-instruct");
    expect(nativeBody.choices[0]).toMatchObject({
      text: "Write a tagline: Completion from mock AI provider",
      index: 0,
      logprobs: null,
      finish_reason: "stop"
    });
    expect(prefixedBody.choices[0]?.text).toBe("Write a tagline: Completion from mock AI provider");

    const journal = await readJournal(requestLogPath);
    expect(journal.filter((entry) => entry.apiSurface === "completions")).toHaveLength(2);
    expect(journal.find((entry) => entry.path === "/v1/completions")).toMatchObject({
      providerId: "openai",
      apiSurface: "completions",
      model: "gpt-3.5-turbo-instruct",
      status: 200,
      responseType: "final-text",
      finalTextEmitted: "Completion from mock AI provider",
      requestBody: payload,
      responseBody: {
        object: "text_completion",
        choices: [
          {
            text: "Write a tagline: Completion from mock AI provider",
            index: 0,
            logprobs: null,
            finish_reason: "stop"
          }
        ]
      }
    });
  });

  it("streams text completions as data-only SSE", async () => {
    const response = await postCompletion("/v1/completions", {
      model: "gpt-3.5-turbo-instruct",
      prompt: "Stream this",
      stream: true
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain("\"object\":\"text_completion\"");
    expect(text).toContain("\"finish_reason\":\"stop\"");
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
  });

  async function postCompletion(route: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  }
});

type CompletionBody = {
  object: string;
  model: string;
  choices: Array<{
    text: string;
    index: number;
    logprobs: null;
    finish_reason: string;
  }>;
};

async function readJournal(path: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path, "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}
