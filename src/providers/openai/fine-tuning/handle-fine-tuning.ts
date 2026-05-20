import type { IncomingMessage, ServerResponse } from "node:http";
import { openAiErrorBody, readErrorStatus, readErrorType } from "../common/errors.js";
import { openAiResponseHeaders } from "../common/headers.js";
import { readOpenAiPathSuffix } from "../common/paths.js";
import type { OpenAiFineTuningStore } from "./fine-tuning-store.js";
import { readRequestBody, writeJson } from "../../../shared/http.js";
import { parseJsonObject } from "../../../shared/json.js";

export type OpenAiFineTuningRouteResult = {
  status: number;
  model: string | null;
  bodyBytes: number;
  requestBody?: Record<string, unknown>;
  requestBodyRaw?: string;
  responseBody?: unknown;
  errorClass: string | null;
};

export async function routeOpenAiFineTuning(params: {
  req: IncomingMessage;
  res: ServerResponse;
  path: string;
  providers: readonly string[];
  requestId: string;
  receivedAtEpochMs: number;
  fineTuning: OpenAiFineTuningStore;
}): Promise<OpenAiFineTuningRouteResult> {
  let bodyText = "";
  try {
    const suffix = readOpenAiPathSuffix(params.path, params.providers);
    if (!suffix) {
      throw notFoundError("fine-tuning route not found");
    }

    if (params.req.method === "POST" && suffix === "fine_tuning/jobs") {
      bodyText = await readRequestBody(params.req);
      const requestBody = parseJsonObject(bodyText);
      const job = params.fineTuning.create(requestBody);
      return writeSuccess(params, job, bodyText, requestBody, job.model);
    }

    if (params.req.method === "GET" && suffix === "fine_tuning/jobs") {
      const jobs = params.fineTuning.list();
      return writeSuccess(params, {
        object: "list",
        data: jobs,
        has_more: false
      }, bodyText);
    }

    const match = /^fine_tuning\/jobs\/([^/]+)(?:\/(cancel|events|checkpoints))?$/.exec(suffix);
    if (!match) {
      throw notFoundError("fine-tuning route not found");
    }
    const jobId = decodeURIComponent(match[1] ?? "");
    const action = match[2] ?? null;

    if (params.req.method === "GET" && !action) {
      const job = params.fineTuning.retrieve(jobId);
      if (!job) {
        throw notFoundError(`No fine-tuning job found with id '${jobId}'`);
      }
      return writeSuccess(params, job, bodyText, undefined, job.model);
    }

    if (params.req.method === "POST" && action === "cancel") {
      const job = params.fineTuning.cancel(jobId);
      if (!job) {
        throw notFoundError(`No fine-tuning job found with id '${jobId}'`);
      }
      return writeSuccess(params, job, bodyText, undefined, job.model);
    }

    if (params.req.method === "GET" && action === "events") {
      const events = params.fineTuning.listEvents(jobId);
      if (!events) {
        throw notFoundError(`No fine-tuning job found with id '${jobId}'`);
      }
      return writeSuccess(params, {
        object: "list",
        data: events,
        has_more: false
      }, bodyText);
    }

    if (params.req.method === "GET" && action === "checkpoints") {
      const checkpoints = params.fineTuning.listCheckpoints(jobId);
      if (!checkpoints) {
        throw notFoundError(`No fine-tuning job found with id '${jobId}'`);
      }
      return writeSuccess(params, {
        object: "list",
        data: checkpoints,
        has_more: false
      }, bodyText);
    }

    throw notFoundError("fine-tuning route not found");
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

function writeSuccess(
  params: {
    res: ServerResponse;
    requestId: string;
    receivedAtEpochMs: number;
  },
  body: unknown,
  bodyText: string,
  requestBody?: Record<string, unknown>,
  model: string | null = null
): OpenAiFineTuningRouteResult {
  writeJson(params.res, 200, body, openAiResponseHeaders({
    requestId: params.requestId,
    receivedAtEpochMs: params.receivedAtEpochMs
  }));
  return {
    status: 200,
    model,
    bodyBytes: Buffer.byteLength(bodyText),
    ...(requestBody ? { requestBody } : {}),
    responseBody: body,
    errorClass: null
  };
}

function notFoundError(message: string): Error {
  return Object.assign(new Error(message), {
    statusCode: 404,
    errorType: "not_found_error",
    code: "not_found"
  });
}
