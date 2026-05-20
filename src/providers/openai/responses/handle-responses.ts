import type { IncomingMessage, ServerResponse } from "node:http";
import { openAiErrorBody, readErrorStatus, readErrorType } from "../common/errors.js";
import { openAiResponseHeaders } from "../common/headers.js";
import { readOpenAiPathSuffix } from "../common/paths.js";
import type { OpenAiResponseStore } from "./response-store.js";
import { renderResponse, renderResponseStreamEvents } from "./render-responses.js";
import { isRenderableStep, isTerminalStep, resolveScriptStep, writeTerminalScriptResponse } from "../common/scripted-response.js";
import { corsHeaders, readRequestBody, writeJson } from "../../../shared/http.js";
import { parseJsonObject, readString } from "../../../shared/json.js";
import { writeSseDone, writeSseJson } from "../../../shared/sse.js";
import type { ScriptRuntime } from "../../../scripts/types.js";

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
  responseBody?: unknown;
  responseSummary?: unknown;
  errorClass: string | null;
};

export async function handleOpenAiResponses(params: {
  req: IncomingMessage;
  res: ServerResponse;
  path: string;
  providers: readonly string[];
  runtime: ScriptRuntime;
  requestId: string;
  receivedAtEpochMs: number;
  responses: OpenAiResponseStore;
}): Promise<OpenAiResponsesRouteResult> {
  let bodyText = "";
  try {
    const suffix = readOpenAiPathSuffix(params.path, params.providers);
    if (suffix !== "responses") {
      return handleStoredResponseRoute({ ...params, suffix: suffix ?? "" });
    }
    if (params.req.method !== "POST") {
      throw notFoundError("response route not found");
    }
    bodyText = await readRequestBody(params.req);
    const requestBody = parseJsonObject(bodyText);
    const step = params.runtime.nextStep({
      apiSurface: "responses",
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
      const rendered = renderResponseStreamEvents(requestBody, resolvedStep);
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
      params.responses.save(requestBody, rendered.result.body);
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
        responseSummary: {
          stream: true,
          eventTypes: rendered.events.map((event) => event.type),
          responseType: rendered.result.responseType,
          finalText: rendered.result.finalText,
          toolCallsEmitted: rendered.result.toolCallsEmitted
        },
        errorClass: null
      };
    }

    const rendered = renderResponse(requestBody, resolvedStep);
    writeJson(params.res, 200, rendered.body, headers);
    params.responses.save(requestBody, rendered.body);
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

function handleStoredResponseRoute(params: {
  req: IncomingMessage;
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
  responses: OpenAiResponseStore;
  suffix: string;
}): OpenAiResponsesRouteResult {
  const match = /^responses\/([^/]+)(?:\/(cancel|input_items))?$/.exec(params.suffix);
  if (!match) {
    throw notFoundError("response route not found");
  }
  const responseId = decodeURIComponent(match[1] ?? "");
  const action = match[2] ?? null;
  const headers = openAiResponseHeaders({
    requestId: params.requestId,
    receivedAtEpochMs: params.receivedAtEpochMs
  });

  if (params.req.method === "GET" && !action) {
    const stored = params.responses.retrieve(responseId);
    if (!stored) {
      throw notFoundError(`No response found with id '${responseId}'`);
    }
    writeJson(params.res, 200, stored.body, headers);
    return storedResponseResult(stored.body);
  }

  if (params.req.method === "DELETE" && !action) {
    const deleted = params.responses.delete(responseId);
    if (!deleted) {
      throw notFoundError(`No response found with id '${responseId}'`);
    }
    const body = {
      id: responseId,
      object: "response.deleted",
      deleted: true
    };
    writeJson(params.res, 200, body, headers);
    return storedResponseResult(body);
  }

  if (params.req.method === "POST" && action === "cancel") {
    const body = params.responses.cancel(responseId);
    if (!body) {
      throw notFoundError(`No response found with id '${responseId}'`);
    }
    writeJson(params.res, 200, body, headers);
    return storedResponseResult(body);
  }

  if (params.req.method === "GET" && action === "input_items") {
    const items = params.responses.inputItems(responseId);
    if (!items) {
      throw notFoundError(`No response found with id '${responseId}'`);
    }
    const body = {
      object: "list",
      data: items,
      first_id: items[0]?.id ?? null,
      last_id: items.at(-1)?.id ?? null,
      has_more: false
    };
    writeJson(params.res, 200, body, headers);
    return storedResponseResult(body);
  }

  throw notFoundError("response route not found");
}

function storedResponseResult(body: unknown): OpenAiResponsesRouteResult {
  return {
    status: 200,
    model: typeof body === "object" && body !== null && "model" in body && typeof body.model === "string" ? body.model : null,
    stream: false,
    matchedScriptStep: null,
    responseType: "stored",
    finalText: null,
    toolCallsEmitted: 0,
    bodyBytes: 0,
    responseBody: body,
    errorClass: null
  };
}

function notFoundError(message: string): Error {
  return Object.assign(new Error(message), {
    statusCode: 404,
    errorType: "not_found_error",
    code: "not_found"
  });
}
