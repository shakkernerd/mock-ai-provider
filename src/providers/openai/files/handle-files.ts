import type { IncomingMessage, ServerResponse } from "node:http";
import { openAiErrorBody, readErrorStatus, readErrorType } from "../common/errors.js";
import { openAiResponseHeaders } from "../common/headers.js";
import type { OpenAiFileStore } from "./file-store.js";
import { firstHeader, readRequestBuffer, writeBinary, writeJson } from "../../../shared/http.js";
import { parseMultipartForm } from "../../../shared/multipart.js";

export type OpenAiFilesRouteResult = {
  status: number;
  model: null;
  bodyBytes: number;
  requestBody?: Record<string, unknown>;
  responseBody?: unknown;
  responseSummary?: unknown;
  errorClass: string | null;
};

export async function routeOpenAiFiles(params: {
  req: IncomingMessage;
  res: ServerResponse;
  path: string;
  requestId: string;
  receivedAtEpochMs: number;
  files: OpenAiFileStore;
}): Promise<OpenAiFilesRouteResult> {
  if (params.req.method === "POST" && (params.path === "/v1/files" || params.path === "/openai/v1/files")) {
    return handleOpenAiUploadFile(params);
  }
  if (params.req.method === "GET" && (params.path === "/v1/files" || params.path === "/openai/v1/files")) {
    return handleOpenAiListFiles(params);
  }
  const fileId = readOpenAiFileId(params.path);
  if (params.req.method === "GET" && fileId && params.path.endsWith("/content")) {
    return handleOpenAiFileContent({ ...params, fileId });
  }
  if (params.req.method === "DELETE" && fileId) {
    return handleOpenAiDeleteFile({ ...params, fileId });
  }
  if (params.req.method === "GET" && fileId) {
    return handleOpenAiRetrieveFile({ ...params, fileId });
  }
  return handleOpenAiRetrieveFile({ ...params, fileId: "" });
}

export async function handleOpenAiUploadFile(params: {
  req: IncomingMessage;
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
  files: OpenAiFileStore;
}): Promise<OpenAiFilesRouteResult> {
  let bodyBytes = 0;
  try {
    const body = await readRequestBuffer(params.req);
    bodyBytes = body.length;
    const form = parseMultipartForm(firstHeader(params.req, "content-type"), body, { includeFileContents: true });
    const file = form.files.file;
    const purpose = form.fields.purpose;
    if (!file?.content) {
      throw Object.assign(new Error("file is required"), { statusCode: 400, errorType: "invalid_request_error" });
    }
    if (!purpose) {
      throw Object.assign(new Error("purpose is required"), { statusCode: 400, errorType: "invalid_request_error" });
    }
    const stored = params.files.create({
      filename: file.filename ?? "file",
      purpose,
      content: file.content,
      contentType: file.contentType
    });
    writeJson(params.res, 200, stored.object, openAiResponseHeaders({
      requestId: params.requestId,
      receivedAtEpochMs: params.receivedAtEpochMs
    }));
    return {
      status: 200,
      model: null,
      bodyBytes,
      requestBody: {
        purpose,
        file: withoutContent(file)
      },
      responseBody: stored.object,
      errorClass: null
    };
  } catch (error) {
    return writeFileError({ error, bodyBytes, res: params.res, requestId: params.requestId, receivedAtEpochMs: params.receivedAtEpochMs });
  }
}

export function handleOpenAiListFiles(params: {
  req: IncomingMessage;
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
  files: OpenAiFileStore;
}): OpenAiFilesRouteResult {
  const purpose = new URL(params.req.url ?? "/", "http://mock-ai-provider.local").searchParams.get("purpose");
  const data = params.files.list({ purpose });
  const responseBody = {
    object: "list",
    data,
    first_id: data[0]?.id ?? null,
    last_id: data.at(-1)?.id ?? null,
    has_more: false
  };
  writeJson(params.res, 200, responseBody, openAiResponseHeaders({
    requestId: params.requestId,
    receivedAtEpochMs: params.receivedAtEpochMs
  }));
  return { status: 200, model: null, bodyBytes: 0, responseBody, errorClass: null };
}

export function handleOpenAiRetrieveFile(params: {
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
  files: OpenAiFileStore;
  fileId: string;
}): OpenAiFilesRouteResult {
  const file = params.files.get(params.fileId);
  if (!file) {
    return fileNotFound(params);
  }
  writeJson(params.res, 200, file.object, openAiResponseHeaders({
    requestId: params.requestId,
    receivedAtEpochMs: params.receivedAtEpochMs
  }));
  return { status: 200, model: null, bodyBytes: 0, responseBody: file.object, errorClass: null };
}

export function handleOpenAiFileContent(params: {
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
  files: OpenAiFileStore;
  fileId: string;
}): OpenAiFilesRouteResult {
  const file = params.files.get(params.fileId);
  if (!file) {
    return fileNotFound(params);
  }
  writeBinary(params.res, 200, file.content, {
    ...openAiResponseHeaders({
      requestId: params.requestId,
      receivedAtEpochMs: params.receivedAtEpochMs
    }),
    "content-type": file.contentType
  });
  return {
    status: 200,
    model: null,
    bodyBytes: 0,
    responseSummary: {
      binary: true,
      byteLength: file.content.length,
      fileId: file.object.id
    },
    errorClass: null
  };
}

export function handleOpenAiDeleteFile(params: {
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
  files: OpenAiFileStore;
  fileId: string;
}): OpenAiFilesRouteResult {
  const file = params.files.delete(params.fileId);
  if (!file) {
    return fileNotFound(params);
  }
  const responseBody = { id: file.id, object: "file", deleted: true };
  writeJson(params.res, 200, responseBody, openAiResponseHeaders({
    requestId: params.requestId,
    receivedAtEpochMs: params.receivedAtEpochMs
  }));
  return { status: 200, model: null, bodyBytes: 0, responseBody, errorClass: null };
}

function fileNotFound(params: {
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
  fileId: string;
}): OpenAiFilesRouteResult {
  return writeFileError({
    error: Object.assign(new Error(`File '${params.fileId}' was not found.`), {
      statusCode: 404,
      errorType: "not_found_error",
      param: "file_id",
      code: "file_not_found"
    }),
    bodyBytes: 0,
    res: params.res,
    requestId: params.requestId,
    receivedAtEpochMs: params.receivedAtEpochMs
  });
}

function writeFileError(params: {
  error: unknown;
  bodyBytes: number;
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
}): OpenAiFilesRouteResult {
  const status = readErrorStatus(params.error);
  const errorClass = readErrorType(params.error) ?? "invalid_request_error";
  const responseBody = openAiErrorBody(params.error);
  writeJson(params.res, status, responseBody, openAiResponseHeaders({
    requestId: params.requestId,
    receivedAtEpochMs: params.receivedAtEpochMs
  }));
  return { status, model: null, bodyBytes: params.bodyBytes, responseBody, errorClass };
}

function withoutContent(file: { name: string; filename: string | null; contentType: string | null; byteLength: number }): Record<string, unknown> {
  return {
    name: file.name,
    filename: file.filename,
    contentType: file.contentType,
    byteLength: file.byteLength
  };
}

function readOpenAiFileId(path: string): string | undefined {
  const prefix = path.startsWith("/openai/") ? "/openai/v1/files/" : "/v1/files/";
  if (!path.startsWith(prefix)) {
    return undefined;
  }
  const raw = path.slice(prefix.length).replace(/\/content$/, "");
  return raw.length > 0 ? decodeURIComponent(raw) : undefined;
}
