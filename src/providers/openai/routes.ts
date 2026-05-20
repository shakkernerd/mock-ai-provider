import type { IncomingMessage, ServerResponse } from "node:http";
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
  errorClass: string | null;
};

export async function handleOpenAiChatCompletions(params: {
  req: IncomingMessage;
  res: ServerResponse;
  runtime: ScriptRuntime;
  requestId: string;
}): Promise<OpenAiRouteResult> {
  let bodyText = "";
  try {
    bodyText = await readRequestBody(params.req);
    const requestBody = parseJsonObject(bodyText);
    const step = params.runtime.nextStep();
    const rendered = renderChatCompletion(requestBody, step);
    writeJson(params.res, 200, rendered.body, {
      "x-request-id": params.requestId
    });
    return {
      status: 200,
      model: rendered.model,
      stream: rendered.stream,
      matchedScriptStep: step.id ?? null,
      responseType: rendered.responseType,
      finalText: rendered.finalText,
      bodyBytes: Buffer.byteLength(bodyText),
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
    }, {
      "x-request-id": params.requestId
    });
    return {
      status,
      model: null,
      stream: null,
      matchedScriptStep: null,
      responseType: null,
      finalText: null,
      bodyBytes: Buffer.byteLength(bodyText),
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
