import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRequestJournal } from "../src/server/request-journal.js";

describe("request journal", () => {
  it("writes one JSON object per line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mock-ai-provider-journal-"));
    const path = join(dir, "requests.jsonl");
    const journal = createRequestJournal(path);

    journal.append({
      schemaVersion: "mock-ai-provider.request.v1",
      requestId: "req_test",
      clientRequestId: "client-test",
      providerId: "openai",
      apiSurface: "chat.completions",
      method: "POST",
      path: "/v1/chat/completions",
      model: "gpt-mock",
      stream: false,
      receivedAt: "2026-05-20T00:00:00.000Z",
      receivedAtEpochMs: 0,
      respondedAt: "2026-05-20T00:00:00.001Z",
      respondedAtEpochMs: 1,
      durationMs: 1,
      status: 200,
      matchedScriptStep: "first-final",
      responseType: "final-text",
      toolCallsEmitted: 0,
      finalTextEmitted: "ok",
      errorClass: null,
      bodyBytes: 2
    });

    const lines = (await readFile(path, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      schemaVersion: "mock-ai-provider.request.v1",
      requestId: "req_test",
      clientRequestId: "client-test"
    });
    expect(journal.count()).toBe(1);
    expect(journal.list()).toHaveLength(1);
    journal.reset();
    expect(journal.count()).toBe(0);
    expect(journal.list()).toHaveLength(0);
    expect(await readFile(path, "utf8")).toBe("");
  });

  it("redacts secret-shaped journal fields before storing or writing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mock-ai-provider-journal-redact-"));
    const path = join(dir, "requests.jsonl");
    const journal = createRequestJournal(path);

    journal.append({
      schemaVersion: "mock-ai-provider.request.v1",
      requestId: "req_secret",
      providerId: "openai",
      apiSurface: "chat.completions",
      method: "POST",
      path: "/v1/chat/completions",
      model: "gpt-mock",
      stream: false,
      receivedAt: "2026-05-20T00:00:00.000Z",
      receivedAtEpochMs: 0,
      respondedAt: "2026-05-20T00:00:00.001Z",
      respondedAtEpochMs: 1,
      durationMs: 1,
      status: 200,
      requestHeaders: {
        authorization: "present",
        "proxy-authorization": "Bearer proxy-key",
        "x-client-request-id": "client-test"
      },
      matchedScriptStep: "first-final",
      responseType: "final-text",
      toolCallsEmitted: 0,
      finalTextEmitted: "ok",
      errorClass: null,
      bodyBytes: 2,
      requestBody: {
        model: "gpt-mock",
        max_tokens: 100,
        metadata: {
          apiKey: "sk-live",
          access_token: "oauth-token",
          nested: {
            clientSecret: "client-secret"
          }
        },
        messages: [
          {
            role: "user",
            content: "hello"
          }
        ]
      },
      requestBodyRaw: "{\"apiKey\":\"sk-live\",\"message\":\"hello\",\"authorization\":\"Bearer raw-key\"}"
    });

    const stored = journal.list()[0] as {
      requestHeaders: Record<string, string>;
      requestBody: {
        max_tokens: number;
        metadata: {
          apiKey: string;
          access_token: string;
          nested: { clientSecret: string };
        };
      };
      requestBodyRaw: string;
    };
    expect(stored.requestHeaders.authorization).toBe("present");
    expect(stored.requestHeaders["proxy-authorization"]).toBe("[redacted]");
    expect(stored.requestHeaders["x-client-request-id"]).toBe("client-test");
    expect(stored.requestBody.max_tokens).toBe(100);
    expect(stored.requestBody.metadata.apiKey).toBe("[redacted]");
    expect(stored.requestBody.metadata.access_token).toBe("[redacted]");
    expect(stored.requestBody.metadata.nested.clientSecret).toBe("[redacted]");
    expect(stored.requestBodyRaw).toContain("\"apiKey\":\"[redacted]\"");
    expect(stored.requestBodyRaw).toContain("\"authorization\":\"Bearer [redacted]\"");

    const text = await readFile(path, "utf8");
    expect(text).not.toContain("sk-live");
    expect(text).not.toContain("oauth-token");
    expect(text).not.toContain("client-secret");
    expect(text).not.toContain("raw-key");
    expect(text).not.toContain("proxy-key");
  });
});
