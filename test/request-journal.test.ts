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
  });
});
