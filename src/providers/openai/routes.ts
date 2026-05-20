import type { IncomingMessage, ServerResponse } from "node:http";
import { openAiResponseHeaders } from "./headers.js";
import { writeChatCompletionStream } from "./render-chat-completion-stream.js";
import { renderChatCompletion } from "./render-chat-completions.js";
import { readRequestBody, writeJson } from "../../shared/http.js";
import { parseJsonObject } from "../../shared/json.js";
import type { ScriptRuntime } from "../../scripts/types.js";

export type OpenAiRouteResult = {
  status: number;
  model: string | null;
  stream: boolean | null;
  matchedScriptStep: string | null;
  responseType: string | null;
  finalText: string | null;
  bodyBytes: number;
  requestBody?: Record<string, unknown>;
  requestBodyRaw?: string;
  errorClass: string | null;
};

export async function handleOpenAiChatCompletions(params: {
  req: IncomingMessage;
  res: ServerResponse;
  runtime: ScriptRuntime;
  requestId: string;
  receivedAtEpochMs: number;
}): Promise<OpenAiRouteResult> {
  let bodyText = "";
  try {
    bodyText = await readRequestBody(params.req);
    const requestBody = parseJsonObject(bodyText);
    const step = params.runtime.nextStep();
    const headers = openAiResponseHeaders({
      requestId: params.requestId,
      receivedAtEpochMs: params.receivedAtEpochMs
    });
    if (requestBody.stream === true) {
      const rendered = writeChatCompletionStream({
        res: params.res,
        requestBody,
        step,
        headers
      });
      return {
        status: 200,
        model: rendered.model,
        stream: rendered.stream,
        matchedScriptStep: step.id ?? null,
        responseType: rendered.responseType,
        finalText: rendered.finalText,
        bodyBytes: Buffer.byteLength(bodyText),
        requestBody,
        errorClass: null
      };
    }

    const rendered = renderChatCompletion(requestBody, step);
    writeJson(params.res, 200, rendered.body, headers);
    return {
      status: 200,
      model: rendered.model,
      stream: rendered.stream,
      matchedScriptStep: step.id ?? null,
      responseType: rendered.responseType,
      finalText: rendered.finalText,
      bodyBytes: Buffer.byteLength(bodyText),
      requestBody,
      errorClass: null
    };
  } catch (error) {
    const status = readErrorStatus(error);
    const errorClass = readErrorType(error) ?? "invalid_request_error";
    writeJson(params.res, status, {
      error: {
        message: error instanceof Error ? error.message : "request failed",
        type: errorClass
      }
    }, openAiResponseHeaders({
      requestId: params.requestId,
      receivedAtEpochMs: params.receivedAtEpochMs
    }));
    return {
      status,
      model: null,
      stream: null,
      matchedScriptStep: null,
      responseType: null,
      finalText: null,
      bodyBytes: Buffer.byteLength(bodyText),
      ...(bodyText ? { requestBodyRaw: bodyText } : {}),
      errorClass
    };
  }
}

function readErrorStatus(error: unknown): number {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const value = (error as { statusCode?: unknown }).statusCode;
    if (typeof value === "number" && Number.isInteger(value)) {
      return value;
    }
  }
  return 400;
}

function readErrorType(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "errorType" in error) {
    const value = (error as { errorType?: unknown }).errorType;
    return typeof value === "string" ? value : null;
  }
  return null;
}
