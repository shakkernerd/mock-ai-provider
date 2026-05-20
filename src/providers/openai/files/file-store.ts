import { createFileId } from "../../../shared/ids.js";

export type OpenAiFileObject = {
  id: string;
  object: "file";
  bytes: number;
  created_at: number;
  expires_at: number | null;
  filename: string;
  purpose: string;
  status: "processed";
  status_details: null;
};

export type OpenAiStoredFile = {
  object: OpenAiFileObject;
  content: Buffer;
  contentType: string;
};

export type OpenAiFileStore = {
  create(params: {
    filename: string;
    purpose: string;
    content: Buffer;
    contentType?: string | null;
  }): OpenAiStoredFile;
  list(params?: { purpose?: string | null }): readonly OpenAiFileObject[];
  get(id: string): OpenAiStoredFile | null;
  delete(id: string): OpenAiFileObject | null;
};

export function createOpenAiFileStore(): OpenAiFileStore {
  const files = new Map<string, OpenAiStoredFile>();
  return {
    create(params) {
      const now = Math.floor(Date.now() / 1000);
      const file: OpenAiStoredFile = {
        object: {
          id: createFileId(),
          object: "file",
          bytes: params.content.length,
          created_at: now,
          expires_at: null,
          filename: params.filename,
          purpose: params.purpose,
          status: "processed",
          status_details: null
        },
        content: params.content,
        contentType: params.contentType ?? "application/octet-stream"
      };
      files.set(file.object.id, file);
      return file;
    },
    list(params = {}) {
      const all = [...files.values()].map((file) => file.object).reverse();
      return params.purpose ? all.filter((file) => file.purpose === params.purpose) : all;
    },
    get(id) {
      return files.get(id) ?? null;
    },
    delete(id) {
      const file = files.get(id);
      if (!file) {
        return null;
      }
      files.delete(id);
      return file.object;
    }
  };
}
