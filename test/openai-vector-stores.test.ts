import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockAiProviderServer } from "../src/server/create-server.js";

describe("OpenAI Vector Stores mock", () => {
  let server: Server | null = null;
  let baseUrl = "";
  let requestLogPath = "";

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mock-ai-provider-vector-stores-"));
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

  it("creates, lists, updates, searches, attaches files, and deletes vector stores", async () => {
    const createPayload = {
      name: "Docs",
      file_ids: ["file-1", "file-2"],
      metadata: { source: "test" }
    };
    const createdResponse = await jsonRequest("POST", "/v1/vector_stores", createPayload);
    expect(createdResponse.status).toBe(200);
    const created = await createdResponse.json() as VectorStoreBody;
    expect(created).toMatchObject({
      object: "vector_store",
      name: "Docs",
      status: "completed",
      file_counts: {
        completed: 2,
        total: 2
      },
      metadata: { source: "test" }
    });

    const listResponse = await jsonRequest("GET", "/openai/v1/vector_stores");
    expect(listResponse.status).toBe(200);
    const list = await listResponse.json() as { data: VectorStoreBody[]; has_more: boolean };
    expect(list.data.map((store) => store.id)).toContain(created.id);
    expect(list.has_more).toBe(false);

    const updateResponse = await jsonRequest("POST", `/v1/vector_stores/${created.id}`, {
      name: "Updated docs",
      metadata: { source: "updated" }
    });
    expect(updateResponse.status).toBe(200);
    const updated = await updateResponse.json() as VectorStoreBody;
    expect(updated.name).toBe("Updated docs");
    expect(updated.metadata).toEqual({ source: "updated" });

    const searchResponse = await jsonRequest("POST", `/v1/vector_stores/${created.id}/search`, {
      query: "launch notes"
    });
    expect(searchResponse.status).toBe(200);
    await expect(searchResponse.json()).resolves.toMatchObject({
      object: "vector_store.search_results.page",
      search_query: "launch notes",
      data: [],
      has_more: false
    });

    const attachFileResponse = await jsonRequest("POST", `/v1/vector_stores/${created.id}/files`, {
      file_id: "file-abc123",
      attributes: { section: "launch" }
    });
    expect(attachFileResponse.status).toBe(200);
    await expect(attachFileResponse.json()).resolves.toMatchObject({
      id: "file-abc123",
      object: "vector_store.file",
      vector_store_id: created.id,
      status: "completed",
      last_error: null,
      attributes: { section: "launch" }
    });

    const listFilesResponse = await jsonRequest("GET", `/openai/v1/vector_stores/${created.id}/files`);
    expect(listFilesResponse.status).toBe(200);
    await expect(listFilesResponse.json()).resolves.toMatchObject({
      object: "list",
      data: [
        {
          id: "file-abc123",
          object: "vector_store.file"
        }
      ],
      has_more: false
    });

    const updateFileResponse = await jsonRequest("POST", `/v1/vector_stores/${created.id}/files/file-abc123`, {
      attributes: { section: "updated" }
    });
    expect(updateFileResponse.status).toBe(200);
    await expect(updateFileResponse.json()).resolves.toMatchObject({
      id: "file-abc123",
      attributes: { section: "updated" }
    });

    const contentResponse = await jsonRequest("GET", `/v1/vector_stores/${created.id}/files/file-abc123/content`);
    expect(contentResponse.status).toBe(200);
    await expect(contentResponse.json()).resolves.toEqual({
      object: "vector_store.file_content.page",
      data: [],
      has_more: false,
      next_page: null
    });

    const deleteFileResponse = await jsonRequest("DELETE", `/v1/vector_stores/${created.id}/files/file-abc123`);
    expect(deleteFileResponse.status).toBe(200);
    await expect(deleteFileResponse.json()).resolves.toEqual({
      id: "file-abc123",
      object: "vector_store.file.deleted",
      deleted: true
    });

    const batchResponse = await jsonRequest("POST", `/v1/vector_stores/${created.id}/file_batches`, {
      file_ids: ["file-batch-1", "file-batch-2"]
    });
    expect(batchResponse.status).toBe(200);
    const batch = await batchResponse.json() as {
      id: string;
      object: string;
      status: string;
      file_counts: Record<string, number>;
    };
    expect(batch).toMatchObject({
      object: "vector_store.file_batch",
      status: "completed",
      file_counts: {
        completed: 2,
        total: 2
      }
    });

    const batchFilesResponse = await jsonRequest("GET", `/v1/vector_stores/${created.id}/file_batches/${batch.id}/files`);
    expect(batchFilesResponse.status).toBe(200);
    await expect(batchFilesResponse.json()).resolves.toMatchObject({
      object: "list",
      data: [
        { id: "file-batch-1", object: "vector_store.file" },
        { id: "file-batch-2", object: "vector_store.file" }
      ],
      has_more: false
    });

    const cancelBatchResponse = await jsonRequest("POST", `/v1/vector_stores/${created.id}/file_batches/${batch.id}/cancel`);
    expect(cancelBatchResponse.status).toBe(200);
    await expect(cancelBatchResponse.json()).resolves.toMatchObject({
      id: batch.id,
      object: "vector_store.file_batch",
      status: "cancelled"
    });

    const deleteResponse = await jsonRequest("DELETE", `/v1/vector_stores/${created.id}`);
    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toEqual({
      id: created.id,
      object: "vector_store.deleted",
      deleted: true
    });

    const retrieveAfterDelete = await jsonRequest("GET", `/v1/vector_stores/${created.id}`);
    expect(retrieveAfterDelete.status).toBe(404);

    const journal = await readJournal(requestLogPath);
    expect(journal.filter((entry) => entry.apiSurface === "vector_stores")).toHaveLength(14);
    expect(journal.find((entry) => entry.path === "/v1/vector_stores")).toMatchObject({
      providerId: "openai",
      apiSurface: "vector_stores",
      status: 200,
      responseType: "vector_store",
      requestBody: createPayload,
      responseBody: {
        object: "vector_store",
        name: "Docs"
      }
    });
  });

  async function jsonRequest(method: string, route: string, body?: unknown): Promise<Response> {
    return fetch(`${baseUrl}${route}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  }
});

type VectorStoreBody = {
  id: string;
  object: "vector_store";
  name: string | null;
  status: string;
  file_counts: Record<string, number>;
  metadata: Record<string, unknown>;
};

async function readJournal(path: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path, "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}
