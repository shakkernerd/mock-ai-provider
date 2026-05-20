import type { IncomingMessage, ServerResponse } from "node:http";
import { readErrorStatus, readErrorType } from "./errors.js";
import { openAiResponseHeaders } from "./headers.js";
import { renderResponse, renderResponseStreamEvents } from "./render-responses.js";
import { corsHeaders, readRequestBody, writeJson } from "../../shared/http.js";
import { parseJsonObject } from "../../shared/json.js";
import { writeSseDone, writeSseJson } from "../../shared/sse.js";
import type { ScriptRuntime } from "../../scripts/types.js";

export type OpenAiResponsesRouteResult = {
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
  errorClass: string | null;
};

export async function handleOpenAiResponses(params: {
  req: IncomingMessage;
  res: ServerResponse;
  runtime: ScriptRuntime;
  requestId: string;
  receivedAtEpochMs: number;
}): Promise<OpenAiResponsesRouteResult> {
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
      const rendered = renderResponseStreamEvents(requestBody, step);
      params.res.writeHead(200, {
        ...corsHeaders(),
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "connection": "keep-alive",
        ...headers
      });
      for (const event of rendered.events) {
        writeSseJson(params.res, event);
      }
      writeSseDone(params.res);
      params.res.end();
      return {
        status: 200,
        model: rendered.result.model,
        stream: true,
        matchedScriptStep: step.id ?? null,
        responseType: rendered.result.responseType,
        finalText: rendered.result.finalText,
        toolCallsEmitted: rendered.result.toolCallsEmitted,
        bodyBytes: Buffer.byteLength(bodyText),
        requestBody,
        errorClass: null
      };
    }

    const rendered = renderResponse(requestBody, step);
    writeJson(params.res, 200, rendered.body, headers);
    return {
      status: 200,
      model: rendered.model,
      stream: false,
      matchedScriptStep: step.id ?? null,
      responseType: rendered.responseType,
      finalText: rendered.finalText,
      toolCallsEmitted: rendered.toolCallsEmitted,
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
      toolCallsEmitted: 0,
      bodyBytes: Buffer.byteLength(bodyText),
      ...(bodyText ? { requestBodyRaw: bodyText } : {}),
      errorClass
    };
  }
}
