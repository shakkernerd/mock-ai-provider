import type { IncomingMessage, ServerResponse } from "node:http";
import { openAiErrorBody, readErrorStatus, readErrorType } from "./errors.js";
import { openAiResponseHeaders } from "./headers.js";
import { writeChatCompletionStream } from "./render-chat-completion-stream.js";
import { renderChatCompletion } from "./render-chat-completions.js";
import { isRenderableStep, isTerminalStep, resolveScriptStep, writeTerminalScriptResponse } from "./scripted-response.js";
import { readRequestBody, writeJson } from "../../shared/http.js";
import { parseJsonObject, readString } from "../../shared/json.js";
import type { ScriptRuntime } from "../../scripts/types.js";

export type OpenAiRouteResult = {
  status: number;
  model: string | null;
  stream: boolean | null;
  matchedScriptStep: string | null;
  responseType: string | null;
  finalText: string | null;
  toolCallsEmitted: number;
  bodyBytes: number;
  requestBody?: Record<string, unknown>;
  requestBodyRaw?: string;
  responseBody?: unknown;
  responseSummary?: unknown;
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
    const step = params.runtime.nextStep({
      apiSurface: "chat.completions",
      model: readString(requestBody, "model") ?? null,
      requestBody
    });
    const headers = openAiResponseHeaders({
      requestId: params.requestId,
      receivedAtEpochMs: params.receivedAtEpochMs
    });
    const resolvedStep = await resolveScriptStep(step);
    if (isTerminalStep(resolvedStep)) {
      const terminal = writeTerminalScriptResponse({
        res: params.res,
        response: resolvedStep.respond,
        headers
      });
      return {
        status: terminal.status,
        model: readString(requestBody, "model") ?? null,
        stream: requestBody.stream === true,
        matchedScriptStep: step.id ?? null,
        responseType: terminal.responseType,
        finalText: null,
        toolCallsEmitted: 0,
        bodyBytes: Buffer.byteLength(bodyText),
        requestBody,
        ...(terminal.responseBody ? { responseBody: terminal.responseBody } : {}),
        ...(terminal.responseSummary ? { responseSummary: terminal.responseSummary } : {}),
        errorClass: terminal.errorClass
      };
    }
    if (!isRenderableStep(resolvedStep)) {
      throw new Error("script response did not resolve to a renderable response");
    }
    if (requestBody.stream === true) {
      const rendered = writeChatCompletionStream({
        res: params.res,
        requestBody,
        step: resolvedStep,
        headers
      });
      return {
        status: 200,
        model: rendered.model,
        stream: rendered.stream,
        matchedScriptStep: step.id ?? null,
        responseType: rendered.responseType,
        finalText: rendered.finalText,
        toolCallsEmitted: rendered.toolCallsEmitted,
        bodyBytes: Buffer.byteLength(bodyText),
        requestBody,
        responseSummary: {
          stream: true,
          done: true,
          responseType: rendered.responseType,
          finalText: rendered.finalText,
          toolCallsEmitted: rendered.toolCallsEmitted
        },
        errorClass: null
      };
    }

    const rendered = renderChatCompletion(requestBody, resolvedStep);
    writeJson(params.res, 200, rendered.body, headers);
    return {
      status: 200,
      model: rendered.model,
      stream: rendered.stream,
      matchedScriptStep: step.id ?? null,
      responseType: rendered.responseType,
      finalText: rendered.finalText,
      toolCallsEmitted: rendered.toolCallsEmitted,
      bodyBytes: Buffer.byteLength(bodyText),
      requestBody,
      responseBody: rendered.body,
      errorClass: null
    };
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
      stream: null,
      matchedScriptStep: null,
      responseType: null,
      finalText: null,
      toolCallsEmitted: 0,
      bodyBytes: Buffer.byteLength(bodyText),
      ...(bodyText ? { requestBodyRaw: bodyText } : {}),
      responseBody,
      errorClass
    };
  }
}
