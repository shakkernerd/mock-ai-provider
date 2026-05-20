import type { IncomingMessage, ServerResponse } from "node:http";
import { readErrorStatus, readErrorType } from "./errors.js";
import { openAiResponseHeaders } from "./headers.js";
import { readDefaultVideo } from "./media-assets.js";
import type { OpenAiVideoStore } from "./video-store.js";
import { firstHeader, readRequestBuffer, writeBinary, writeJson } from "../../shared/http.js";
import { parseJsonObject, readString } from "../../shared/json.js";
import { parseMultipartForm } from "../../shared/multipart.js";

export type OpenAiVideosRouteResult = {
  status: number;
  model: string | null;
  bodyBytes: number;
  requestBody?: Record<string, unknown>;
  responseBody?: unknown;
  responseSummary?: unknown;
  errorClass: string | null;
};

export async function handleOpenAiCreateVideo(params: {
  req: IncomingMessage;
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
  videos: OpenAiVideoStore;
}): Promise<OpenAiVideosRouteResult> {
  let bodyBytes = 0;
  try {
    const body = await readRequestBuffer(params.req);
    bodyBytes = body.length;
    const request = parseVideoCreateRequest(firstHeader(params.req, "content-type"), body);
    const job = params.videos.create(request);
    writeJson(params.res, 200, job, openAiResponseHeaders({
      requestId: params.requestId,
      receivedAtEpochMs: params.receivedAtEpochMs
    }));
    return {
      status: 200,
      model: job.model,
      bodyBytes,
      requestBody: request,
      responseBody: job,
      errorClass: null
    };
  } catch (error) {
    return writeVideoError({
      error,
      bodyBytes,
      res: params.res,
      requestId: params.requestId,
      receivedAtEpochMs: params.receivedAtEpochMs
    });
  }
}

export function handleOpenAiListVideos(params: {
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
  videos: OpenAiVideoStore;
}): OpenAiVideosRouteResult {
  const responseBody = {
    object: "list",
    data: params.videos.list()
  };
  writeJson(params.res, 200, responseBody, openAiResponseHeaders({
    requestId: params.requestId,
    receivedAtEpochMs: params.receivedAtEpochMs
  }));
  return {
    status: 200,
    model: null,
    bodyBytes: 0,
    responseBody,
    errorClass: null
  };
}

export function handleOpenAiRetrieveVideo(params: {
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
  videos: OpenAiVideoStore;
  videoId: string;
}): OpenAiVideosRouteResult {
  const job = params.videos.get(params.videoId);
  if (!job) {
    return writeVideoError({
      error: Object.assign(new Error(`Video '${params.videoId}' was not found.`), {
        statusCode: 404,
        errorType: "not_found_error"
      }),
      bodyBytes: 0,
      res: params.res,
      requestId: params.requestId,
      receivedAtEpochMs: params.receivedAtEpochMs
    });
  }
  writeJson(params.res, 200, job, openAiResponseHeaders({
    requestId: params.requestId,
    receivedAtEpochMs: params.receivedAtEpochMs
  }));
  return {
    status: 200,
    model: job.model,
    bodyBytes: 0,
    responseBody: job,
    errorClass: null
  };
}

export function handleOpenAiVideoContent(params: {
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
  videos: OpenAiVideoStore;
  videoId: string;
}): OpenAiVideosRouteResult {
  const job = params.videos.get(params.videoId);
  if (!job) {
    return writeVideoError({
      error: Object.assign(new Error(`Video '${params.videoId}' was not found.`), {
        statusCode: 404,
        errorType: "not_found_error"
      }),
      bodyBytes: 0,
      res: params.res,
      requestId: params.requestId,
      receivedAtEpochMs: params.receivedAtEpochMs
    });
  }
  const body = readDefaultVideo();
  writeBinary(params.res, 200, body, {
    ...openAiResponseHeaders({
      requestId: params.requestId,
      receivedAtEpochMs: params.receivedAtEpochMs
    }),
    "content-type": "video/mp4"
  });
  return {
    status: 200,
    model: job.model,
    bodyBytes: 0,
    responseSummary: {
      binary: true,
      mediaType: "video",
      byteLength: body.length,
      videoId: job.id
    },
    errorClass: null
  };
}

export function handleOpenAiDeleteVideo(params: {
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
  videos: OpenAiVideoStore;
  videoId: string;
}): OpenAiVideosRouteResult {
  const job = params.videos.delete(params.videoId);
  if (!job) {
    return writeVideoError({
      error: Object.assign(new Error(`Video '${params.videoId}' was not found.`), {
        statusCode: 404,
        errorType: "not_found_error",
        code: "video_not_found",
        param: "video_id"
      }),
      bodyBytes: 0,
      res: params.res,
      requestId: params.requestId,
      receivedAtEpochMs: params.receivedAtEpochMs
    });
  }
  writeJson(params.res, 200, job, openAiResponseHeaders({
    requestId: params.requestId,
    receivedAtEpochMs: params.receivedAtEpochMs
  }));
  return {
    status: 200,
    model: job.model,
    bodyBytes: 0,
    responseBody: job,
    errorClass: null
  };
}

function parseVideoCreateRequest(contentType: string | undefined, body: Buffer): {
  model: string;
  prompt: string;
  size: string;
  seconds: string;
  quality: string;
} {
  if ((contentType ?? "").toLowerCase().includes("multipart/form-data")) {
    const form = parseMultipartForm(contentType, body);
    return normalizeVideoCreateFields(form.fields);
  }
  const value = parseJsonObject(body.toString("utf8"));
  return normalizeVideoCreateFields(value);
}

function normalizeVideoCreateFields(fields: Record<string, unknown>): {
  model: string;
  prompt: string;
  size: string;
  seconds: string;
  quality: string;
} {
  const prompt = readString(fields, "prompt");
  if (!prompt) {
    throw Object.assign(new Error("prompt must be a non-empty string"), {
      statusCode: 400,
      errorType: "invalid_request_error"
    });
  }
  const model = readString(fields, "model") ?? "sora-2";
  const size = readString(fields, "size") ?? "720x1280";
  const seconds = readString(fields, "seconds") ?? "4";
  const quality = readString(fields, "quality") ?? "standard";
  assertAllowed({ field: "model", value: model, allowed: ["sora-2", "sora-2-pro"] });
  assertAllowed({ field: "seconds", value: seconds, allowed: ["4", "8", "12"] });
  assertAllowed({ field: "size", value: size, allowed: ["720x1280", "1280x720", "1024x1792", "1792x1024"] });
  return { model, prompt, size, seconds, quality };
}

function assertAllowed(params: { field: string; value: string; allowed: readonly string[] }): void {
  if (!params.allowed.includes(params.value)) {
    throw Object.assign(new Error(`${params.field} must be one of: ${params.allowed.join(", ")}`), {
      statusCode: 400,
      errorType: "invalid_request_error",
      param: params.field,
      code: "invalid_value"
    });
  }
}

function writeVideoError(params: {
  error: unknown;
  bodyBytes: number;
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
}): OpenAiVideosRouteResult {
  const status = readErrorStatus(params.error);
  const errorClass = readErrorType(params.error) ?? "invalid_request_error";
  const responseBody = {
    error: {
      message: params.error instanceof Error ? params.error.message : "request failed",
      type: errorClass,
      param: readErrorString(params.error, "param"),
      code: readErrorString(params.error, "code")
    }
  };
  writeJson(params.res, status, responseBody, openAiResponseHeaders({
    requestId: params.requestId,
    receivedAtEpochMs: params.receivedAtEpochMs
  }));
  return {
    status,
    model: null,
    bodyBytes: params.bodyBytes,
    responseBody,
    errorClass
  };
}

function readErrorString(error: unknown, property: string): string | null {
  if (typeof error !== "object" || error === null || !(property in error)) {
    return null;
  }
  const value = (error as Record<string, unknown>)[property];
  return typeof value === "string" ? value : null;
}
