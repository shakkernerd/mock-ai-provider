import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenAiBatchStore } from "./batch-store.js";
import { openAiErrorBody, readErrorStatus, readErrorType } from "./errors.js";
import { openAiResponseHeaders } from "./headers.js";
import { readRequestBody, writeJson } from "../../shared/http.js";
import { isRecord, parseJsonObject, readString } from "../../shared/json.js";

export type OpenAiBatchesRouteResult = {
  status: number;
  model: null;
  bodyBytes: number;
  requestBody?: Record<string, unknown>;
  requestBodyRaw?: string;
  responseBody?: unknown;
  errorClass: string | null;
};

export async function routeOpenAiBatches(params: {
  req: IncomingMessage;
  res: ServerResponse;
  path: string;
  requestId: string;
  receivedAtEpochMs: number;
  batches: OpenAiBatchStore;
}): Promise<OpenAiBatchesRouteResult> {
  if (params.req.method === "POST" && (params.path === "/v1/batches" || params.path === "/openai/v1/batches")) {
    return handleOpenAiCreateBatch(params);
  }
  if (params.req.method === "GET" && (params.path === "/v1/batches" || params.path === "/openai/v1/batches")) {
    return handleOpenAiListBatches(params);
  }
  const batchId = readOpenAiBatchId(params.path);
  if (params.req.method === "POST" && batchId && params.path.endsWith("/cancel")) {
    return handleOpenAiCancelBatch({ ...params, batchId });
  }
  if (params.req.method === "GET" && batchId) {
    return handleOpenAiRetrieveBatch({ ...params, batchId });
  }
  return handleOpenAiRetrieveBatch({ ...params, batchId: "" });
}

export async function handleOpenAiCreateBatch(params: {
  req: IncomingMessage;
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
  batches: OpenAiBatchStore;
}): Promise<OpenAiBatchesRouteResult> {
  let bodyText = "";
  try {
    bodyText = await readRequestBody(params.req);
    const requestBody = parseJsonObject(bodyText);
    const inputFileId = requireString(requestBody, "input_file_id");
    const endpoint = requireString(requestBody, "endpoint");
    const completionWindow = requireString(requestBody, "completion_window");
    const metadata = isRecord(requestBody.metadata) ? requestBody.metadata : null;
    const batch = params.batches.create({ inputFileId, endpoint, completionWindow, metadata });
    writeJson(params.res, 200, batch, openAiResponseHeaders({
      requestId: params.requestId,
      receivedAtEpochMs: params.receivedAtEpochMs
    }));
    return {
      status: 200,
      model: null,
      bodyBytes: Buffer.byteLength(bodyText),
      requestBody,
      responseBody: batch,
      errorClass: null
    };
  } catch (error) {
    return writeBatchError({ error, bodyBytes: Buffer.byteLength(bodyText), bodyText, res: params.res, requestId: params.requestId, receivedAtEpochMs: params.receivedAtEpochMs });
  }
}

export function handleOpenAiListBatches(params: {
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
  batches: OpenAiBatchStore;
}): OpenAiBatchesRouteResult {
  const data = params.batches.list();
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

export function handleOpenAiRetrieveBatch(params: {
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
  batches: OpenAiBatchStore;
  batchId: string;
}): OpenAiBatchesRouteResult {
  const batch = params.batches.get(params.batchId);
  if (!batch) {
    return batchNotFound(params);
  }
  writeJson(params.res, 200, batch, openAiResponseHeaders({
    requestId: params.requestId,
    receivedAtEpochMs: params.receivedAtEpochMs
  }));
  return { status: 200, model: null, bodyBytes: 0, responseBody: batch, errorClass: null };
}

export function handleOpenAiCancelBatch(params: {
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
  batches: OpenAiBatchStore;
  batchId: string;
}): OpenAiBatchesRouteResult {
  const batch = params.batches.cancel(params.batchId);
  if (!batch) {
    return batchNotFound(params);
  }
  writeJson(params.res, 200, batch, openAiResponseHeaders({
    requestId: params.requestId,
    receivedAtEpochMs: params.receivedAtEpochMs
  }));
  return { status: 200, model: null, bodyBytes: 0, responseBody: batch, errorClass: null };
}

function requireString(value: Record<string, unknown>, key: string): string {
  const result = readString(value, key);
  if (!result) {
    throw Object.assign(new Error(`${key} must be a non-empty string`), {
      statusCode: 400,
      errorType: "invalid_request_error",
      param: key,
      code: "missing_required_parameter"
    });
  }
  return result;
}

function batchNotFound(params: {
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
  batchId: string;
}): OpenAiBatchesRouteResult {
  return writeBatchError({
    error: Object.assign(new Error(`Batch '${params.batchId}' was not found.`), {
      statusCode: 404,
      errorType: "not_found_error",
      param: "batch_id",
      code: "batch_not_found"
    }),
    bodyBytes: 0,
    bodyText: "",
    res: params.res,
    requestId: params.requestId,
    receivedAtEpochMs: params.receivedAtEpochMs
  });
}

function writeBatchError(params: {
  error: unknown;
  bodyBytes: number;
  bodyText: string;
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
}): OpenAiBatchesRouteResult {
  const status = readErrorStatus(params.error);
  const errorClass = readErrorType(params.error) ?? "invalid_request_error";
  const responseBody = openAiErrorBody(params.error);
  writeJson(params.res, status, responseBody, openAiResponseHeaders({
    requestId: params.requestId,
    receivedAtEpochMs: params.receivedAtEpochMs
  }));
  return {
    status,
    model: null,
    bodyBytes: params.bodyBytes,
    ...(params.bodyText ? { requestBodyRaw: params.bodyText } : {}),
    responseBody,
    errorClass
  };
}

function readOpenAiBatchId(path: string): string | undefined {
  const prefix = path.startsWith("/openai/") ? "/openai/v1/batches/" : "/v1/batches/";
  if (!path.startsWith(prefix)) {
    return undefined;
  }
  const raw = path.slice(prefix.length).replace(/\/cancel$/, "");
  return raw.length > 0 ? decodeURIComponent(raw) : undefined;
}
