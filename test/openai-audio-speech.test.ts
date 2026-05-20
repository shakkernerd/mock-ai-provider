import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockAiProviderServer } from "../src/server/create-server.js";

describe("OpenAI Audio speech mock", () => {
  let server: Server | null = null;
  let baseUrl = "";
  let requestLogPath = "";

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mock-ai-provider-speech-"));
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

  it("serves default mp3 speech bytes", async () => {
    const payload = {
      model: "gpt-4o-mini-tts",
      input: "Hello from speech.",
      voice: "alloy"
    };
    const response = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.subarray(0, 3).toString("ascii")).toBe("ID3");

    const journal = await readJournal(requestLogPath);
    expect(journal.find((entry) => entry.path === "/v1/audio/speech")).toMatchObject({
      providerId: "openai",
      apiSurface: "audio.speech",
      model: "gpt-4o-mini-tts",
      status: 200,
      responseType: "audio",
      requestBody: payload,
      responseSummary: {
        binary: true,
        mediaType: "audio",
        responseFormat: "mp3",
        input: "Hello from speech.",
        voice: "alloy"
      }
    });
  });

  it("serves wav speech bytes when requested", async () => {
    const response = await fetch(`${baseUrl}/openai/v1/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        input: "Hello from speech.",
        voice: "alloy",
        response_format: "wav"
      })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/wav");
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.subarray(0, 4).toString("ascii")).toBe("RIFF");
  });

  it("rejects missing voice", async () => {
    const response = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        input: "Hello from speech."
      })
    });

    expect(response.status).toBe(400);
    const body = await response.json() as { error: { type: string; message: string } };
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toContain("voice");
  });
});

async function readJournal(path: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path, "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}
