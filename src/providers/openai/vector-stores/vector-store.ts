import { createVectorStoreId } from "../../../shared/ids.js";
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

export type OpenAiVectorStoreStore = {
  create(requestBody: JsonRecord): OpenAiVectorStore;
  update(id: string, requestBody: JsonRecord): OpenAiVectorStore | null;
  retrieve(id: string): OpenAiVectorStore | null;
  delete(id: string): boolean;
  list(): OpenAiVectorStore[];
};

export function createOpenAiVectorStoreStore(): OpenAiVectorStoreStore {
  const stores = new Map<string, OpenAiVectorStore>();
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
      return stores.delete(id);
    },
    list() {
      return [...stores.values()].sort((left, right) => right.created_at - left.created_at);
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
