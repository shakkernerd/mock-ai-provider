import { createUploadId, createUploadPartId } from "../../../shared/ids.js";
import { readString, type JsonRecord } from "../../../shared/json.js";
import type { OpenAiFileObject, OpenAiFileStore } from "../files/file-store.js";

export type OpenAiUploadObject = {
  id: string;
  object: "upload";
  bytes: number;
  created_at: number;
  expires_at: number;
  filename: string;
  purpose: string;
  status: "pending" | "completed" | "cancelled";
};

export type OpenAiUploadPart = {
  id: string;
  object: "upload.part";
  created_at: number;
  upload_id: string;
};

type StoredUpload = {
  object: OpenAiUploadObject;
  mimeType: string;
  parts: Map<string, Buffer>;
};

export type OpenAiUploadStore = {
  create(requestBody: JsonRecord): OpenAiUploadObject;
  addPart(uploadId: string, content: Buffer): OpenAiUploadPart | null;
  complete(uploadId: string, partIds: readonly string[], files: OpenAiFileStore): OpenAiFileObject | null;
  cancel(uploadId: string): OpenAiUploadObject | null;
};

export function createOpenAiUploadStore(): OpenAiUploadStore {
  const uploads = new Map<string, StoredUpload>();
  return {
    create(requestBody) {
      const upload = createUpload(requestBody);
      uploads.set(upload.object.id, upload);
      return upload.object;
    },
    addPart(uploadId, content) {
      const upload = uploads.get(uploadId);
      if (!upload || upload.object.status !== "pending") {
        return null;
      }
      const part = {
        id: createUploadPartId(),
        object: "upload.part",
        created_at: Math.floor(Date.now() / 1000),
        upload_id: uploadId
      } satisfies OpenAiUploadPart;
      upload.parts.set(part.id, content);
      return part;
    },
    complete(uploadId, partIds, files) {
      const upload = uploads.get(uploadId);
      if (!upload || upload.object.status !== "pending") {
        return null;
      }
      const content = Buffer.concat(partIds.map((partId) => {
        const part = upload.parts.get(partId);
        if (!part) {
          throw new Error(`upload part '${partId}' was not found`);
        }
        return part;
      }));
      upload.object.status = "completed";
      return files.create({
        filename: upload.object.filename,
        purpose: upload.object.purpose,
        content,
        contentType: upload.mimeType
      }).object;
    },
    cancel(uploadId) {
      const upload = uploads.get(uploadId);
      if (!upload || upload.object.status !== "pending") {
        return null;
      }
      upload.object.status = "cancelled";
      return upload.object;
    }
  };
}

function createUpload(requestBody: JsonRecord): StoredUpload {
  const filename = readString(requestBody, "filename");
  const purpose = readString(requestBody, "purpose");
  const mimeType = readString(requestBody, "mime_type");
  const bytes = requestBody.bytes;
  if (!filename) {
    throw new Error("filename must be a non-empty string");
  }
  if (!purpose) {
    throw new Error("purpose must be a non-empty string");
  }
  if (!mimeType) {
    throw new Error("mime_type must be a non-empty string");
  }
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 0) {
    throw new Error("bytes must be a non-negative integer");
  }
  const now = Math.floor(Date.now() / 1000);
  return {
    object: {
      id: createUploadId(),
      object: "upload",
      bytes,
      created_at: now,
      expires_at: now + 3600,
      filename,
      purpose,
      status: "pending"
    },
    mimeType,
    parts: new Map()
  };
}
