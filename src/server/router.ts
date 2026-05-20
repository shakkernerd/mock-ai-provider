import type { IncomingMessage, ServerResponse } from "node:http";
import { handleOpenAiChatCompletions } from "../providers/openai/routes.js";
import { createRequestId } from "../shared/ids.js";
import { firstHeader, requestPath, writeJson } from "../shared/http.js";
import { durationMs, nowTimestamp } from "../shared/time.js";
import type { RequestJournal, RequestJournalEntry } from "./request-journal.js";
import type { ScriptRuntime } from "../scripts/types.js";

export type RouterOptions = {
  providers: readonly string[];
  runtime: ScriptRuntime;
  journal: RequestJournal;
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
    const result = await handleOpenAiChatCompletions({
      req,
      res,
      runtime: options.runtime,
      requestId
    });
    appendJournal({
      providerId: "openai",
      apiSurface: "chat.completions",
      model: result.model,
      stream: result.stream,
      status: result.status,
      matchedScriptStep: result.matchedScriptStep,
      responseType: result.responseType,
      toolCallsEmitted: 0,
      finalTextEmitted: result.finalText,
      errorClass: result.errorClass,
      bodyBytes: result.bodyBytes,
      ...(result.requestBody ? { requestBody: result.requestBody } : {}),
      ...(result.requestBodyRaw ? { requestBodyRaw: result.requestBodyRaw } : {})
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
