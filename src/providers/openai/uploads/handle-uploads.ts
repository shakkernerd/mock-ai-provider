import type { IncomingMessage, ServerResponse } from "node:http";
import { openAiErrorBody, readErrorStatus, readErrorType } from "../common/errors.js";
import { openAiResponseHeaders } from "../common/headers.js";
import { readOpenAiPathSuffix } from "../common/paths.js";
import type { OpenAiFileStore } from "../files/file-store.js";
import type { OpenAiUploadStore } from "./upload-store.js";
import { firstHeader, readRequestBody, readRequestBuffer, writeJson } from "../../../shared/http.js";
import { parseJsonObject } from "../../../shared/json.js";
import { parseMultipartForm } from "../../../shared/multipart.js";

export type OpenAiUploadsRouteResult = {
  status: number;
  model: null;
  bodyBytes: number;
  requestBody?: Record<string, unknown>;
  requestBodyRaw?: string;
  responseBody?: unknown;
  errorClass: string | null;
};

export async function routeOpenAiUploads(params: {
  req: IncomingMessage;
  res: ServerResponse;
  path: string;
  providers: readonly string[];
  requestId: string;
  receivedAtEpochMs: number;
  uploads: OpenAiUploadStore;
  files: OpenAiFileStore;
}): Promise<OpenAiUploadsRouteResult> {
  let bodyText = "";
  let bodyBytes = 0;
  try {
    const suffix = readOpenAiPathSuffix(params.path, params.providers);
    if (!suffix) {
      throw notFoundError("upload route not found");
    }

    if (params.req.method === "POST" && suffix === "uploads") {
      bodyText = await readRequestBody(params.req);
      bodyBytes = Buffer.byteLength(bodyText);
      const requestBody = parseJsonObject(bodyText);
      const upload = params.uploads.create(requestBody);
      return writeSuccess(params, upload, bodyBytes, requestBody);
    }

    const match = /^uploads\/([^/]+)\/(parts|complete|cancel)$/.exec(suffix);
    if (!match) {
      throw notFoundError("upload route not found");
    }
    const uploadId = decodeURIComponent(match[1] ?? "");
    const action = match[2];

    if (params.req.method === "POST" && action === "parts") {
      const body = await readRequestBuffer(params.req);
      bodyBytes = body.length;
      const form = parseMultipartForm(firstHeader(params.req, "content-type"), body, { includeFileContents: true });
      const file = form.files.data;
      if (!file?.content) {
        throw Object.assign(new Error("data file part is required"), { statusCode: 400, errorType: "invalid_request_error" });
      }
      const part = params.uploads.addPart(uploadId, file.content);
      if (!part) {
        throw notFoundError(`No pending upload found with id '${uploadId}'`);
      }
      return writeSuccess(params, part, bodyBytes, {
        data: {
          name: file.name,
          filename: file.filename,
          contentType: file.contentType,
          byteLength: file.byteLength
        }
      });
    }

    if (params.req.method === "POST" && action === "complete") {
      bodyText = await readRequestBody(params.req);
      bodyBytes = Buffer.byteLength(bodyText);
      const requestBody = parseJsonObject(bodyText);
      const partIds = readPartIds(requestBody.part_ids);
      const file = params.uploads.complete(uploadId, partIds, params.files);
      if (!file) {
        throw notFoundError(`No pending upload found with id '${uploadId}'`);
      }
      return writeSuccess(params, file, bodyBytes, requestBody);
    }

    if (params.req.method === "POST" && action === "cancel") {
      const upload = params.uploads.cancel(uploadId);
      if (!upload) {
        throw notFoundError(`No pending upload found with id '${uploadId}'`);
      }
      return writeSuccess(params, upload, bodyBytes);
    }

    throw notFoundError("upload route not found");
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
      bodyBytes,
      ...(bodyText ? { requestBodyRaw: bodyText } : {}),
      responseBody,
      errorClass
    };
  }
}

function writeSuccess(
  params: {
    res: ServerResponse;
    requestId: string;
    receivedAtEpochMs: number;
  },
  body: unknown,
  bodyBytes: number,
  requestBody?: Record<string, unknown>
): OpenAiUploadsRouteResult {
  writeJson(params.res, 200, body, openAiResponseHeaders({
    requestId: params.requestId,
    receivedAtEpochMs: params.receivedAtEpochMs
  }));
  return {
    status: 200,
    model: null,
    bodyBytes,
    ...(requestBody ? { requestBody } : {}),
    responseBody: body,
    errorClass: null
  };
}

function readPartIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((partId) => typeof partId === "string" && partId.length > 0)) {
    throw new Error("part_ids must be a non-empty array of strings");
  }
  return value as string[];
}

function notFoundError(message: string): Error {
  return Object.assign(new Error(message), {
    statusCode: 404,
    errorType: "not_found_error",
    code: "not_found"
  });
}
