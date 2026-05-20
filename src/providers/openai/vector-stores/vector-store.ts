import { createVectorStoreFileBatchId, createVectorStoreId } from "../../../shared/ids.js";
import { isRecord, readString, type JsonRecord } from "../../../shared/json.js";

export type OpenAiVectorStore = {
  id: string;
  object: "vector_store";
  created_at: number;
  usage_bytes: number;
  last_active_at: number;
  name: string | null;
  status: "completed";
  file_counts: {
    in_progress: number;
    completed: number;
    cancelled: number;
    failed: number;
    total: number;
  };
  metadata: JsonRecord;
  expires_after: JsonRecord | null;
  expires_at: number | null;
};

export type OpenAiVectorStoreFile = {
  id: string;
  object: "vector_store.file";
  usage_bytes: number;
  created_at: number;
  vector_store_id: string;
  status: "completed";
  last_error: null;
  chunking_strategy: JsonRecord;
  attributes: JsonRecord;
};

export type OpenAiVectorStoreFileBatch = {
  id: string;
  object: "vector_store.file_batch";
  created_at: number;
  vector_store_id: string;
  status: "completed" | "cancelled";
  file_counts: OpenAiVectorStore["file_counts"];
};

export type OpenAiVectorStoreStore = {
  create(requestBody: JsonRecord): OpenAiVectorStore;
  update(id: string, requestBody: JsonRecord): OpenAiVectorStore | null;
  retrieve(id: string): OpenAiVectorStore | null;
  delete(id: string): boolean;
  list(): OpenAiVectorStore[];
  attachFile(vectorStoreId: string, requestBody: JsonRecord): OpenAiVectorStoreFile | null;
  updateFile(vectorStoreId: string, fileId: string, requestBody: JsonRecord): OpenAiVectorStoreFile | null;
  retrieveFile(vectorStoreId: string, fileId: string): OpenAiVectorStoreFile | null;
  deleteFile(vectorStoreId: string, fileId: string): boolean | null;
  listFiles(vectorStoreId: string): OpenAiVectorStoreFile[] | null;
  createFileBatch(vectorStoreId: string, requestBody: JsonRecord): OpenAiVectorStoreFileBatch | null;
  retrieveFileBatch(vectorStoreId: string, batchId: string): OpenAiVectorStoreFileBatch | null;
  cancelFileBatch(vectorStoreId: string, batchId: string): OpenAiVectorStoreFileBatch | null;
  listFileBatchFiles(vectorStoreId: string, batchId: string): OpenAiVectorStoreFile[] | null;
};

export function createOpenAiVectorStoreStore(): OpenAiVectorStoreStore {
  const stores = new Map<string, OpenAiVectorStore>();
  const filesByStore = new Map<string, Map<string, OpenAiVectorStoreFile>>();
  const batchesByStore = new Map<string, Map<string, OpenAiVectorStoreFileBatch>>();
  return {
    create(requestBody) {
      const created = createVectorStore(requestBody);
      stores.set(created.id, created);
      return created;
    },
    update(id, requestBody) {
      const current = stores.get(id);
      if (!current) {
        return null;
      }
      const updated = {
        ...current,
        ...readOptionalPatch(requestBody),
        last_active_at: Math.floor(Date.now() / 1000)
      };
      stores.set(id, updated);
      return updated;
    },
    retrieve(id) {
      return stores.get(id) ?? null;
    },
    delete(id) {
      filesByStore.delete(id);
      batchesByStore.delete(id);
      return stores.delete(id);
    },
    list() {
      return [...stores.values()].sort((left, right) => right.created_at - left.created_at);
    },
    attachFile(vectorStoreId, requestBody) {
      const store = stores.get(vectorStoreId);
      if (!store) {
        return null;
      }
      const fileId = readString(requestBody, "file_id");
      if (!fileId) {
        throw new Error("file_id must be a non-empty string");
      }
      const file = createVectorStoreFile(vectorStoreId, requestBody, fileId);
      readFileMap(filesByStore, vectorStoreId).set(fileId, file);
      refreshFileCounts(store, filesByStore.get(vectorStoreId)?.size ?? 0);
      return file;
    },
    updateFile(vectorStoreId, fileId, requestBody) {
      const file = filesByStore.get(vectorStoreId)?.get(fileId);
      if (!file) {
        return null;
      }
      const updated = {
        ...file,
        ...(requestBody.attributes !== undefined ? { attributes: readMetadata(requestBody.attributes) } : {})
      };
      filesByStore.get(vectorStoreId)?.set(fileId, updated);
      return updated;
    },
    retrieveFile(vectorStoreId, fileId) {
      return filesByStore.get(vectorStoreId)?.get(fileId) ?? null;
    },
    deleteFile(vectorStoreId, fileId) {
      const store = stores.get(vectorStoreId);
      if (!store) {
        return null;
      }
      const deleted = filesByStore.get(vectorStoreId)?.delete(fileId) ?? false;
      refreshFileCounts(store, filesByStore.get(vectorStoreId)?.size ?? 0);
      return deleted;
    },
    listFiles(vectorStoreId) {
      if (!stores.has(vectorStoreId)) {
        return null;
      }
      return [...(filesByStore.get(vectorStoreId)?.values() ?? [])]
        .sort((left, right) => right.created_at - left.created_at);
    },
    createFileBatch(vectorStoreId, requestBody) {
      const store = stores.get(vectorStoreId);
      if (!store) {
        return null;
      }
      const fileIds = readFileIds(requestBody.file_ids);
      for (const fileId of fileIds) {
        readFileMap(filesByStore, vectorStoreId).set(fileId, createVectorStoreFile(vectorStoreId, requestBody, fileId));
      }
      refreshFileCounts(store, filesByStore.get(vectorStoreId)?.size ?? 0);
      const batch = {
        id: createVectorStoreFileBatchId(),
        object: "vector_store.file_batch",
        created_at: Math.floor(Date.now() / 1000),
        vector_store_id: vectorStoreId,
        status: "completed",
        file_counts: { ...store.file_counts }
      } satisfies OpenAiVectorStoreFileBatch;
      readBatchMap(batchesByStore, vectorStoreId).set(batch.id, batch);
      return batch;
    },
    retrieveFileBatch(vectorStoreId, batchId) {
      return batchesByStore.get(vectorStoreId)?.get(batchId) ?? null;
    },
    cancelFileBatch(vectorStoreId, batchId) {
      const batch = batchesByStore.get(vectorStoreId)?.get(batchId);
      if (!batch) {
        return null;
      }
      const cancelled = { ...batch, status: "cancelled" as const };
      batchesByStore.get(vectorStoreId)?.set(batchId, cancelled);
      return cancelled;
    },
    listFileBatchFiles(vectorStoreId, batchId) {
      if (!batchesByStore.get(vectorStoreId)?.has(batchId)) {
        return null;
      }
      return [...(filesByStore.get(vectorStoreId)?.values() ?? [])]
        .sort((left, right) => right.created_at - left.created_at);
    }
  };
}

function createVectorStore(requestBody: JsonRecord): OpenAiVectorStore {
  const createdAt = Math.floor(Date.now() / 1000);
  const fileIds = Array.isArray(requestBody.file_ids)
    ? requestBody.file_ids.filter((value): value is string => typeof value === "string")
    : [];
  return {
    id: createVectorStoreId(),
    object: "vector_store",
    created_at: createdAt,
    usage_bytes: 0,
    last_active_at: createdAt,
    name: readString(requestBody, "name") ?? null,
    status: "completed",
    file_counts: {
      in_progress: 0,
      completed: fileIds.length,
      cancelled: 0,
      failed: 0,
      total: fileIds.length
    },
    metadata: readMetadata(requestBody.metadata),
    expires_after: readNullableRecord(requestBody.expires_after),
    expires_at: null
  };
}

function createVectorStoreFile(vectorStoreId: string, requestBody: JsonRecord, fileId: string): OpenAiVectorStoreFile {
  return {
    id: fileId,
    object: "vector_store.file",
    usage_bytes: 0,
    created_at: Math.floor(Date.now() / 1000),
    vector_store_id: vectorStoreId,
    status: "completed",
    last_error: null,
    chunking_strategy: isRecord(requestBody.chunking_strategy) ? requestBody.chunking_strategy : { type: "auto" },
    attributes: readMetadata(requestBody.attributes)
  };
}

function readFileMap(
  filesByStore: Map<string, Map<string, OpenAiVectorStoreFile>>,
  vectorStoreId: string
): Map<string, OpenAiVectorStoreFile> {
  let files = filesByStore.get(vectorStoreId);
  if (!files) {
    files = new Map();
    filesByStore.set(vectorStoreId, files);
  }
  return files;
}

function readBatchMap(
  batchesByStore: Map<string, Map<string, OpenAiVectorStoreFileBatch>>,
  vectorStoreId: string
): Map<string, OpenAiVectorStoreFileBatch> {
  let batches = batchesByStore.get(vectorStoreId);
  if (!batches) {
    batches = new Map();
    batchesByStore.set(vectorStoreId, batches);
  }
  return batches;
}

function readFileIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string" && item.length > 0)) {
    throw new Error("file_ids must be a non-empty array of strings");
  }
  return value as string[];
}

function refreshFileCounts(store: OpenAiVectorStore, completed: number): void {
  store.file_counts = {
    in_progress: 0,
    completed,
    cancelled: 0,
    failed: 0,
    total: completed
  };
}

function readOptionalPatch(requestBody: JsonRecord): Partial<OpenAiVectorStore> {
  return {
    ...(requestBody.name === null || typeof requestBody.name === "string" ? { name: requestBody.name } : {}),
    ...(requestBody.metadata !== undefined ? { metadata: readMetadata(requestBody.metadata) } : {}),
    ...(requestBody.expires_after !== undefined ? { expires_after: readNullableRecord(requestBody.expires_after) } : {})
  };
}

function readMetadata(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function readNullableRecord(value: unknown): JsonRecord | null {
  if (value === null || value === undefined) {
    return null;
  }
  return isRecord(value) ? value : null;
}
