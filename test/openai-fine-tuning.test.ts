import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockAiProviderServer } from "../src/server/create-server.js";

describe("OpenAI Fine-tuning mock", () => {
  let server: Server | null = null;
  let baseUrl = "";
  let requestLogPath = "";

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mock-ai-provider-fine-tuning-"));
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

  it("creates, lists, retrieves, polls, and cancels fine-tuning jobs", async () => {
    const payload = {
      model: "gpt-4.1-mini",
      training_file: "file-train",
      hyperparameters: { n_epochs: 1 }
    };
    const createResponse = await postJson("/v1/fine_tuning/jobs", payload);
    expect(createResponse.status).toBe(200);
    const job = await createResponse.json() as { id: string; object: string; status: string; model: string };
    expect(job).toMatchObject({
      object: "fine_tuning.job",
      status: "validating_files",
      model: "gpt-4.1-mini"
    });

    const listResponse = await fetch(`${baseUrl}/openai/v1/fine_tuning/jobs`);
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      object: "list",
      data: [{ id: job.id }],
      has_more: false
    });

    const retrieveResponse = await fetch(`${baseUrl}/v1/fine_tuning/jobs/${job.id}`);
    expect(retrieveResponse.status).toBe(200);
    await expect(retrieveResponse.json()).resolves.toMatchObject({
      id: job.id,
      training_file: "file-train"
    });

    const eventsResponse = await fetch(`${baseUrl}/v1/fine_tuning/jobs/${job.id}/events`);
    expect(eventsResponse.status).toBe(200);
    await expect(eventsResponse.json()).resolves.toMatchObject({
      object: "list",
      data: [{ object: "fine_tuning.job.event", level: "info" }]
    });

    const checkpointsResponse = await fetch(`${baseUrl}/v1/fine_tuning/jobs/${job.id}/checkpoints`);
    expect(checkpointsResponse.status).toBe(200);
    await expect(checkpointsResponse.json()).resolves.toEqual({
      object: "list",
      data: [],
      has_more: false
    });

    const cancelResponse = await postJson(`/v1/fine_tuning/jobs/${job.id}/cancel`, {});
    expect(cancelResponse.status).toBe(200);
    await expect(cancelResponse.json()).resolves.toMatchObject({
      id: job.id,
      status: "cancelled"
    });

    const journal = await readJournal(requestLogPath);
    expect(journal.filter((entry) => entry.apiSurface === "fine_tuning.jobs")).toHaveLength(6);
    expect(journal.find((entry) => entry.path === "/v1/fine_tuning/jobs")).toMatchObject({
      providerId: "openai",
      apiSurface: "fine_tuning.jobs",
      model: "gpt-4.1-mini",
      requestBody: payload,
      responseBody: {
        object: "fine_tuning.job",
        training_file: "file-train"
      }
    });
  });

  async function postJson(route: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  }
});

async function readJournal(path: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path, "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}
