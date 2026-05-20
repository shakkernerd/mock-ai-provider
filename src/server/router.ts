import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenAiAuthOptions } from "../providers/openai/auth.js";
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
