import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockAiProviderServer } from "../src/server/create-server.js";

describe("OpenAI Audio transcriptions mock", () => {
  let server: Server | null = null;
  let baseUrl = "";
  let requestLogPath = "";

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mock-ai-provider-transcriptions-"));
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

  it("serves JSON transcriptions from multipart uploads", async () => {
    const form = new FormData();
    form.set("model", "gpt-4o-transcribe");
    form.set("file", new Blob([Buffer.from("mock-audio")], { type: "audio/wav" }), "speech.wav");
    const response = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
      method: "POST",
      body: form
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { text: string; usage: { type: string } };
    expect(body).toEqual({
      text: "Hello from mock AI provider transcription.",
      usage: { type: "duration", seconds: 1 }
    });

    const journal = await readJournal(requestLogPath);
    expect(journal.find((entry) => entry.path === "/v1/audio/transcriptions")).toMatchObject({
      providerId: "openai",
      apiSurface: "audio.transcriptions",
      model: "gpt-4o-transcribe",
      status: 200,
      responseType: "transcription",
      requestBody: {
        model: "gpt-4o-transcribe",
        file: {
          filename: "speech.wav",
          contentType: "audio/wav"
        }
      },
      responseBody: {
        text: "Hello from mock AI provider transcription."
      }
    });
  });

  it("serves text translations from multipart uploads", async () => {
    const form = new FormData();
    form.set("model", "whisper-1");
    form.set("response_format", "text");
    form.set("file", new Blob([Buffer.from("mock-audio")], { type: "audio/wav" }), "speech.wav");
    const response = await fetch(`${baseUrl}/openai/v1/audio/translations`, {
      method: "POST",
      body: form
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("Hello from mock AI provider translation.");
  });

  it("rejects missing audio files", async () => {
    const form = new FormData();
    form.set("model", "gpt-4o-transcribe");
    const response = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
      method: "POST",
      body: form
    });

    expect(response.status).toBe(400);
    const body = await response.json() as { error: { message: string } };
    expect(body.error.message).toContain("file");
  });
});

async function readJournal(path: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path, "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}
