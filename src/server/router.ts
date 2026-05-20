import type { IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import type { OpenAiAuthOptions } from "../providers/openai/auth.js";
import type { OpenAiBatchStore } from "../providers/openai/batch-store.js";
import type { OpenAiFileStore } from "../providers/openai/file-store.js";
import type { OpenAiModel } from "../providers/openai/model-catalog.js";
import { routeOpenAiRequest } from "../providers/openai/routes.js";
import type { OpenAiVideoStore } from "../providers/openai/video-store.js";
import { createRequestId } from "../shared/ids.js";
import { firstHeader, readRequestBody, requestPath, writeJson, writeNoContent } from "../shared/http.js";
import { parseJsonObject } from "../shared/json.js";
import { durationMs, nowTimestamp } from "../shared/time.js";
import { validateScript } from "../scripts/validate.js";
import type { RequestJournal, RequestJournalEntry } from "./request-journal.js";
import type { ScriptRuntime } from "../scripts/types.js";

export type RouterOptions = {
  providers: readonly string[];
  runtime: ScriptRuntime;
  journal: RequestJournal;
  openAiAuth: OpenAiAuthOptions;
  openAiModels: readonly OpenAiModel[];
  openAiBatches: OpenAiBatchStore;
  openAiFiles: OpenAiFileStore;
  openAiVideos: OpenAiVideoStore;
};

export async function routeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: RouterOptions
): Promise<void> {
  const received = nowTimestamp();
  const path = requestPath(req);
  const requestId = createRequestId();
  const clientRequestId = firstHeader(req, "x-client-request-id");
  const responseHeaders = captureResponseHeaders(res);

  const appendJournal = (partial: Omit<RequestJournalEntry, "schemaVersion" | "requestId" | "clientRequestId" | "method" | "path" | "receivedAt" | "receivedAtEpochMs" | "respondedAt" | "respondedAtEpochMs" | "durationMs">) => {
    const responded = nowTimestamp();
    options.journal.append({
      schemaVersion: "mock-ai-provider.request.v1",
      requestId,
      ...(clientRequestId ? { clientRequestId } : {}),
      method: req.method ?? "GET",
      path,
      receivedAt: received.iso,
      receivedAtEpochMs: received.epochMs,
      respondedAt: responded.iso,
      respondedAtEpochMs: responded.epochMs,
      durationMs: durationMs(received.epochMs, responded.epochMs),
      requestHeaders: summarizeRequestHeaders(req.headers),
      responseHeaders: summarizeResponseHeaders(responseHeaders()),
      ...partial
    });
  };

  if (req.method === "OPTIONS") {
    writeNoContent(res, 204, { "x-request-id": requestId });
    appendJournal(emptyJournalFields({ status: 204 }));
    return;
  }

  if (req.method === "GET" && path === "/health") {
    writeJson(res, 200, { ok: true }, { "x-request-id": requestId });
    appendJournal(emptyJournalFields({ status: 200 }));
    return;
  }

  if (req.method === "GET" && path === "/status") {
    writeJson(res, 200, {
      ok: true,
      providers: options.providers,
      scriptId: options.runtime.script.id,
      requestCount: options.journal.count()
    }, { "x-request-id": requestId });
    appendJournal(emptyJournalFields({ status: 200 }));
    return;
  }

  if (req.method === "GET" && path === "/admin/requests") {
    const limit = readPositiveIntegerQuery(req, "limit");
    writeJson(res, 200, {
      object: "list",
      data: options.journal.list(limit ? { limit } : {})
    }, { "x-request-id": requestId });
    return;
  }

  if (req.method === "POST" && path === "/admin/reset") {
    options.journal.reset();
    writeJson(res, 200, {
      ok: true,
      requestCount: 0
    }, { "x-request-id": requestId });
    return;
  }

  if (req.method === "POST" && path === "/admin/script") {
    try {
      const script = validateScript(parseJsonObject(await readRequestBody(req)));
      options.runtime.replaceScript(script);
      writeJson(res, 200, {
        ok: true,
        scriptId: script.id,
        steps: script.steps.length
      }, { "x-request-id": requestId });
    } catch (error) {
      writeJson(res, 400, {
        error: {
          message: error instanceof Error ? error.message : "invalid script",
          type: "invalid_request_error",
          param: "script",
          code: "invalid_script"
        }
      }, { "x-request-id": requestId });
    }
    return;
  }

  const openAiMatch = await routeOpenAiRequest({
    req,
    res,
    path,
    requestId,
    receivedAtEpochMs: received.epochMs,
    options: {
      providers: options.providers,
      runtime: options.runtime,
      auth: options.openAiAuth,
      models: options.openAiModels,
      batches: options.openAiBatches,
      files: options.openAiFiles,
      videos: options.openAiVideos
    }
  });
  if (openAiMatch.handled) {
    if (openAiMatch.journal) {
      appendJournal(openAiMatch.journal);
    }
    return;
  }

  writeJson(res, 404, {
    error: {
      message: `route not found: ${req.method ?? "GET"} ${path}`,
      type: "not_found_error"
    }
  }, { "x-request-id": requestId });
  appendJournal(emptyJournalFields({ status: 404, errorClass: "not_found_error" }));
}

function summarizeRequestHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const summary: Record<string, string> = {};
  for (const name of ["authorization", "content-type", "openai-organization", "openai-project", "x-client-request-id"]) {
    const value = firstHeaderValue(headers[name]);
    if (!value) {
      continue;
    }
    summary[name] = name === "authorization" ? "present" : value;
  }
  return summary;
}

function summarizeResponseHeaders(headers: OutgoingHttpHeaders): Record<string, string> {
  const summary: Record<string, string> = {};
  for (const name of [
    "content-type",
    "x-request-id",
    "openai-processing-ms",
    "openai-version",
    "x-ratelimit-limit-requests",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-reset-requests",
    "x-ratelimit-limit-tokens",
    "x-ratelimit-remaining-tokens",
    "x-ratelimit-reset-tokens"
  ]) {
    const value = firstHeaderValue(headers[name]);
    if (value) {
      summary[name] = value;
    }
  }
  return summary;
}

function captureResponseHeaders(res: ServerResponse): () => OutgoingHttpHeaders {
  let captured: OutgoingHttpHeaders = {};
  const writeHead = res.writeHead.bind(res);
  res.writeHead = ((statusCode: number, statusMessage?: string | OutgoingHttpHeaders, headers?: OutgoingHttpHeaders) => {
    const nextHeaders = typeof statusMessage === "object" && statusMessage !== null ? statusMessage : headers;
    captured = {
      ...captured,
      ...normalizeOutgoingHeaders(nextHeaders ?? {})
    };
    return typeof statusMessage === "string"
      ? writeHead(statusCode, statusMessage, headers)
      : writeHead(statusCode, statusMessage);
  }) as typeof res.writeHead;
  return () => captured;
}

function normalizeOutgoingHeaders(headers: OutgoingHttpHeaders): OutgoingHttpHeaders {
  const normalized: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    normalized[name.toLowerCase()] = value;
  }
  return normalized;
}

function firstHeaderValue(value: string | number | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value === undefined ? undefined : String(value);
}

function readPositiveIntegerQuery(req: IncomingMessage, name: string): number | undefined {
  const raw = new URL(req.url ?? "/", "http://mock-ai-provider.local").searchParams.get(name);
  if (!raw) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function emptyJournalFields(params: { status: number; errorClass?: string | null }) {
  return {
    providerId: null,
    apiSurface: null,
    model: null,
    stream: null,
    status: params.status,
    matchedScriptStep: null,
    responseType: null,
    toolCallsEmitted: 0,
    finalTextEmitted: null,
    errorClass: params.errorClass ?? null,
    bodyBytes: 0
  };
}
