import type { IncomingMessage, ServerResponse } from "node:http";
import { openAiErrorBody, readErrorStatus, readErrorType } from "../common/errors.js";
import { openAiResponseHeaders } from "../common/headers.js";
import { readOpenAiPathSuffix } from "../common/paths.js";
import type { OpenAiVectorStoreStore } from "./vector-store.js";
import { readRequestBody, writeJson } from "../../../shared/http.js";
import { parseJsonObject } from "../../../shared/json.js";

export type OpenAiVectorStoresRouteResult = {
  status: number;
  model: string | null;
  bodyBytes: number;
  requestBody?: Record<string, unknown>;
  requestBodyRaw?: string;
  responseBody?: unknown;
  errorClass: string | null;
};

export async function routeOpenAiVectorStores(params: {
  req: IncomingMessage;
  res: ServerResponse;
  path: string;
  providers: readonly string[];
  requestId: string;
  receivedAtEpochMs: number;
  vectorStores: OpenAiVectorStoreStore;
}): Promise<OpenAiVectorStoresRouteResult> {
  let bodyText = "";
  try {
    const suffix = readOpenAiPathSuffix(params.path, params.providers);
    if (!suffix) {
      throw notFoundError("vector store route not found");
    }

    if (params.req.method === "GET" && suffix === "vector_stores") {
      const stores = params.vectorStores.list();
      return writeSuccess(params, {
        object: "list",
        data: stores,
        first_id: stores[0]?.id ?? null,
        last_id: stores.at(-1)?.id ?? null,
        has_more: false
      }, bodyText);
    }

    if (params.req.method === "POST" && suffix === "vector_stores") {
      bodyText = await readRequestBody(params.req);
      const requestBody = parseJsonObject(bodyText);
      const created = params.vectorStores.create(requestBody);
      return writeSuccess(params, created, bodyText, requestBody);
    }

    const fileMatch = /^vector_stores\/([^/]+)\/files(?:\/([^/]+)(?:\/content)?)?$/.exec(suffix);
    if (fileMatch) {
      const vectorStoreId = decodeURIComponent(fileMatch[1] ?? "");
      const fileId = fileMatch[2] ? decodeURIComponent(fileMatch[2]) : null;
      return await routeVectorStoreFiles({
        ...params,
        vectorStoreId,
        fileId,
        bodyText
      });
    }

    const match = /^vector_stores\/([^/]+)(?:\/(search))?$/.exec(suffix);
    if (!match) {
      throw notFoundError("vector store route not found");
    }
    const vectorStoreId = decodeURIComponent(match[1] ?? "");
    const action = match[2];

    if (params.req.method === "GET" && !action) {
      const store = params.vectorStores.retrieve(vectorStoreId);
      if (!store) {
        throw notFoundError(`No vector store found with id '${vectorStoreId}'`);
      }
      return writeSuccess(params, store, bodyText);
    }

    if (params.req.method === "POST" && !action) {
      bodyText = await readRequestBody(params.req);
      const requestBody = parseJsonObject(bodyText);
      const store = params.vectorStores.update(vectorStoreId, requestBody);
      if (!store) {
        throw notFoundError(`No vector store found with id '${vectorStoreId}'`);
      }
      return writeSuccess(params, store, bodyText, requestBody);
    }

    if (params.req.method === "DELETE" && !action) {
      const deleted = params.vectorStores.delete(vectorStoreId);
      if (!deleted) {
        throw notFoundError(`No vector store found with id '${vectorStoreId}'`);
      }
      return writeSuccess(params, {
        id: vectorStoreId,
        object: "vector_store.deleted",
        deleted: true
      }, bodyText);
    }

    if (params.req.method === "POST" && action === "search") {
      bodyText = await readRequestBody(params.req);
      const requestBody = parseJsonObject(bodyText);
      const store = params.vectorStores.retrieve(vectorStoreId);
      if (!store) {
        throw notFoundError(`No vector store found with id '${vectorStoreId}'`);
      }
      return writeSuccess(params, {
        object: "vector_store.search_results.page",
        search_query: requestBody.query ?? null,
        data: [],
        has_more: false,
        next_page: null
      }, bodyText, requestBody);
    }

    throw notFoundError("vector store route not found");
  } catch (error) {
    const status = readErrorStatus(error);
    const errorClass = readErrorType(error) ?? "invalid_request_error";
    const responseBody = openAiErrorBody(error);
    writeJson(params.res, status, responseBody, openAiResponseHeaders({
      requestId: params.requestId,
      receivedAtEpochMs: params.receivedAtEpochMs
    }));
    return {
      status,
      model: null,
      bodyBytes: Buffer.byteLength(bodyText),
      ...(bodyText ? { requestBodyRaw: bodyText } : {}),
      responseBody,
      errorClass
    };
  }
}

async function routeVectorStoreFiles(params: {
  req: IncomingMessage;
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
  vectorStores: OpenAiVectorStoreStore;
  vectorStoreId: string;
  fileId: string | null;
  bodyText: string;
}): Promise<OpenAiVectorStoresRouteResult> {
  let bodyText = params.bodyText;

  if (params.req.method === "GET" && !params.fileId) {
    const files = params.vectorStores.listFiles(params.vectorStoreId);
    if (!files) {
      throw notFoundError(`No vector store found with id '${params.vectorStoreId}'`);
    }
    return writeSuccess(params, {
      object: "list",
      data: files,
      first_id: files[0]?.id ?? null,
      last_id: files.at(-1)?.id ?? null,
      has_more: false
    }, bodyText);
  }

  if (params.req.method === "POST" && !params.fileId) {
    bodyText = await readRequestBody(params.req);
    const requestBody = parseJsonObject(bodyText);
    const file = params.vectorStores.attachFile(params.vectorStoreId, requestBody);
    if (!file) {
      throw notFoundError(`No vector store found with id '${params.vectorStoreId}'`);
    }
    return writeSuccess(params, file, bodyText, requestBody);
  }

  if (!params.fileId) {
    throw notFoundError("vector store file route not found");
  }

  if (params.req.method === "GET") {
    const file = params.vectorStores.retrieveFile(params.vectorStoreId, params.fileId);
    if (!file) {
      throw notFoundError(`No vector store file found with id '${params.fileId}'`);
    }
    return writeSuccess(params, file, bodyText);
  }

  if (params.req.method === "POST") {
    bodyText = await readRequestBody(params.req);
    const requestBody = parseJsonObject(bodyText);
    const file = params.vectorStores.updateFile(params.vectorStoreId, params.fileId, requestBody);
    if (!file) {
      throw notFoundError(`No vector store file found with id '${params.fileId}'`);
    }
    return writeSuccess(params, file, bodyText, requestBody);
  }

  if (params.req.method === "DELETE") {
    const deleted = params.vectorStores.deleteFile(params.vectorStoreId, params.fileId);
    if (deleted === null) {
      throw notFoundError(`No vector store found with id '${params.vectorStoreId}'`);
    }
    if (!deleted) {
      throw notFoundError(`No vector store file found with id '${params.fileId}'`);
    }
    return writeSuccess(params, {
      id: params.fileId,
      object: "vector_store.file.deleted",
      deleted: true
    }, bodyText);
  }

  throw notFoundError("vector store file route not found");
}

function writeSuccess(
  params: {
    res: ServerResponse;
    requestId: string;
    receivedAtEpochMs: number;
  },
  body: unknown,
  bodyText: string,
  requestBody?: Record<string, unknown>
): OpenAiVectorStoresRouteResult {
  writeJson(params.res, 200, body, openAiResponseHeaders({
    requestId: params.requestId,
    receivedAtEpochMs: params.receivedAtEpochMs
  }));
  return {
    status: 200,
    model: null,
    bodyBytes: Buffer.byteLength(bodyText),
    ...(requestBody ? { requestBody } : {}),
    responseBody: body,
    errorClass: null
  };
}

function notFoundError(message: string): Error {
  return Object.assign(new Error(message), {
    statusCode: 404,
    errorType: "invalid_request_error",
    code: "not_found"
  });
}
