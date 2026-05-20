import type { IncomingMessage, ServerResponse } from "node:http";
import { enforceOpenAiAuth, type OpenAiAuthOptions } from "../providers/openai/auth.js";
import { handleOpenAiEmbeddings } from "../providers/openai/handle-embeddings.js";
import { handleOpenAiModels } from "../providers/openai/handle-models.js";
import { handleOpenAiResponses } from "../providers/openai/handle-responses.js";
import { handleOpenAiChatCompletions } from "../providers/openai/routes.js";
import type { OpenAiModel } from "../providers/openai/model-catalog.js";
import { createRequestId } from "../shared/ids.js";
import { firstHeader, requestPath, writeJson, writeNoContent } from "../shared/http.js";
import { durationMs, nowTimestamp } from "../shared/time.js";
import type { RequestJournal, RequestJournalEntry } from "./request-journal.js";
import type { ScriptRuntime } from "../scripts/types.js";

export type RouterOptions = {
  providers: readonly string[];
  runtime: ScriptRuntime;
  journal: RequestJournal;
  openAiAuth: OpenAiAuthOptions;
  openAiModels: readonly OpenAiModel[];
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
      scriptId: options.runtime.script.id
    }, { "x-request-id": requestId });
    appendJournal(emptyJournalFields({ status: 200 }));
    return;
  }

  if (req.method === "POST" && isOpenAiChatCompletionsPath(path, options.providers)) {
    if (!authorizeOpenAiRequest({ req, res, requestId, receivedAtEpochMs: received.epochMs, options, appendJournal })) {
      return;
    }
    const result = await handleOpenAiChatCompletions({
      req,
      res,
      runtime: options.runtime,
      requestId,
      receivedAtEpochMs: received.epochMs
    });
    appendJournal({
      providerId: "openai",
      apiSurface: "chat.completions",
      model: result.model,
      stream: result.stream,
      status: result.status,
      matchedScriptStep: result.matchedScriptStep,
      responseType: result.responseType,
      toolCallsEmitted: result.toolCallsEmitted,
      finalTextEmitted: result.finalText,
      errorClass: result.errorClass,
      bodyBytes: result.bodyBytes,
      ...(result.requestBody ? { requestBody: result.requestBody } : {}),
      ...(result.requestBodyRaw ? { requestBodyRaw: result.requestBodyRaw } : {}),
      ...(result.responseBody ? { responseBody: result.responseBody } : {}),
      ...(result.responseSummary ? { responseSummary: result.responseSummary } : {})
    });
    return;
  }

  if (req.method === "POST" && isOpenAiEmbeddingsPath(path, options.providers)) {
    if (!authorizeOpenAiRequest({ req, res, requestId, receivedAtEpochMs: received.epochMs, options, appendJournal })) {
      return;
    }
    const result = await handleOpenAiEmbeddings({
      req,
      res,
      requestId,
      receivedAtEpochMs: received.epochMs
    });
    appendJournal({
      providerId: "openai",
      apiSurface: "embeddings",
      model: result.model,
      stream: false,
      status: result.status,
      matchedScriptStep: null,
      responseType: "embedding",
      toolCallsEmitted: 0,
      finalTextEmitted: null,
      errorClass: result.errorClass,
      bodyBytes: result.bodyBytes,
      ...(result.requestBody ? { requestBody: result.requestBody } : {}),
      ...(result.requestBodyRaw ? { requestBodyRaw: result.requestBodyRaw } : {}),
      ...(result.responseBody ? { responseBody: result.responseBody } : {})
    });
    return;
  }

  if (req.method === "POST" && isOpenAiResponsesPath(path, options.providers)) {
    if (!authorizeOpenAiRequest({ req, res, requestId, receivedAtEpochMs: received.epochMs, options, appendJournal })) {
      return;
    }
    const result = await handleOpenAiResponses({
      req,
      res,
      runtime: options.runtime,
      requestId,
      receivedAtEpochMs: received.epochMs
    });
    appendJournal({
      providerId: "openai",
      apiSurface: "responses",
      model: result.model,
      stream: result.stream,
      status: result.status,
      matchedScriptStep: result.matchedScriptStep,
      responseType: result.responseType,
      toolCallsEmitted: result.toolCallsEmitted,
      finalTextEmitted: result.finalText,
      errorClass: result.errorClass,
      bodyBytes: result.bodyBytes,
      ...(result.requestBody ? { requestBody: result.requestBody } : {}),
      ...(result.requestBodyRaw ? { requestBodyRaw: result.requestBodyRaw } : {}),
      ...(result.responseBody ? { responseBody: result.responseBody } : {}),
      ...(result.responseSummary ? { responseSummary: result.responseSummary } : {})
    });
    return;
  }

  if (req.method === "GET" && isOpenAiModelsPath(path, options.providers)) {
    if (!authorizeOpenAiRequest({ req, res, requestId, receivedAtEpochMs: received.epochMs, options, appendJournal })) {
      return;
    }
    const modelId = readOpenAiModelId(path);
    const result = handleOpenAiModels({
      res,
      requestId,
      receivedAtEpochMs: received.epochMs,
      catalog: options.openAiModels,
      ...(modelId ? { modelId } : {})
    });
    appendJournal({
      providerId: "openai",
      apiSurface: "models",
      model: result.model,
      stream: null,
      status: result.status,
      matchedScriptStep: null,
      responseType: "model",
      toolCallsEmitted: 0,
      finalTextEmitted: null,
      errorClass: result.errorClass,
      bodyBytes: result.bodyBytes,
      responseBody: result.responseBody
    });
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

function isOpenAiChatCompletionsPath(path: string, providers: readonly string[]): boolean {
  if (path === "/openai/v1/chat/completions") {
    return providers.includes("openai");
  }
  return path === "/v1/chat/completions" && providers.length === 1 && providers[0] === "openai";
}

function isOpenAiModelsPath(path: string, providers: readonly string[]): boolean {
  if (path === "/openai/v1/models" || path.startsWith("/openai/v1/models/")) {
    return providers.includes("openai");
  }
  if (path === "/v1/models" || path.startsWith("/v1/models/")) {
    return providers.length === 1 && providers[0] === "openai";
  }
  return false;
}

function isOpenAiEmbeddingsPath(path: string, providers: readonly string[]): boolean {
  if (path === "/openai/v1/embeddings") {
    return providers.includes("openai");
  }
  return path === "/v1/embeddings" && providers.length === 1 && providers[0] === "openai";
}

function isOpenAiResponsesPath(path: string, providers: readonly string[]): boolean {
  if (path === "/openai/v1/responses") {
    return providers.includes("openai");
  }
  return path === "/v1/responses" && providers.length === 1 && providers[0] === "openai";
}

function readOpenAiModelId(path: string): string | undefined {
  const prefix = path.startsWith("/openai/") ? "/openai/v1/models/" : "/v1/models/";
  if (!path.startsWith(prefix)) {
    return undefined;
  }
  const modelId = path.slice(prefix.length);
  return modelId.length > 0 ? decodeURIComponent(modelId) : undefined;
}

function authorizeOpenAiRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
  options: RouterOptions;
  appendJournal: (partial: Omit<RequestJournalEntry, "schemaVersion" | "requestId" | "clientRequestId" | "method" | "path" | "receivedAt" | "receivedAtEpochMs" | "respondedAt" | "respondedAtEpochMs" | "durationMs">) => void;
}): boolean {
  const result = enforceOpenAiAuth({
    req: params.req,
    res: params.res,
    requestId: params.requestId,
    receivedAtEpochMs: params.receivedAtEpochMs,
    auth: params.options.openAiAuth
  });
  if (result.ok) {
    return true;
  }
  params.appendJournal({
    providerId: "openai",
    apiSurface: null,
    model: null,
    stream: null,
    status: result.status ?? 401,
    matchedScriptStep: null,
    responseType: null,
    toolCallsEmitted: 0,
    finalTextEmitted: null,
    errorClass: result.errorClass ?? "invalid_request_error",
    bodyBytes: 0
  });
  return false;
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
