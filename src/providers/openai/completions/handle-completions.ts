import type { IncomingMessage, ServerResponse } from "node:http";
import { openAiErrorBody, readErrorStatus, readErrorType } from "../common/errors.js";
import { openAiResponseHeaders } from "../common/headers.js";
import { isTerminalStep, resolveScriptStep, writeTerminalScriptResponse } from "../common/scripted-response.js";
import { writeCompletionStream } from "./render-completion-stream.js";
import { renderCompletion } from "./render-completions.js";
import { readRequestBody, writeJson } from "../../../shared/http.js";
import { parseJsonObject, readString } from "../../../shared/json.js";
import type { ScriptRuntime, ScriptStep } from "../../../scripts/types.js";

export type OpenAiCompletionRouteResult = {
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

export async function handleOpenAiCompletions(params: {
  req: IncomingMessage;
  res: ServerResponse;
  runtime: ScriptRuntime;
  requestId: string;
  receivedAtEpochMs: number;
}): Promise<OpenAiCompletionRouteResult> {
  let bodyText = "";
  try {
    bodyText = await readRequestBody(params.req);
    const requestBody = parseJsonObject(bodyText);
    const step = params.runtime.nextStep({
      apiSurface: "completions",
      model: readString(requestBody, "model") ?? null,
      requestBody
    });
    const headers = openAiResponseHeaders({
      requestId: params.requestId,
      receivedAtEpochMs: params.receivedAtEpochMs
    });
    const resolvedStep = await resolveScriptStep(step, { requestBody });
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

    const finalStep = requireFinalTextStep(resolvedStep);
    if (requestBody.stream === true) {
      const rendered = writeCompletionStream({
        res: params.res,
        requestBody,
        step: finalStep,
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
          finalText: rendered.finalText
        },
        errorClass: null
      };
    }

    const rendered = renderCompletion(requestBody, finalStep);
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

function requireFinalTextStep(step: ScriptStep): ScriptStep & { respond: { type: "final-text"; text: string } } {
  if (step.respond.type !== "final-text") {
    throw new Error("Completions only supports final-text scripted responses");
  }
  return step as ScriptStep & { respond: { type: "final-text"; text: string } };
}
