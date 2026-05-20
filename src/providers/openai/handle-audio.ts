import type { IncomingMessage, ServerResponse } from "node:http";
import { readErrorStatus, readErrorType } from "./errors.js";
import { openAiResponseHeaders } from "./headers.js";
import { renderSpeech } from "./render-audio.js";
import { readRequestBody, writeBinary, writeJson } from "../../shared/http.js";
import { parseJsonObject } from "../../shared/json.js";

export type OpenAiAudioRouteResult = {
  status: number;
  model: string | null;
  bodyBytes: number;
  requestBody?: Record<string, unknown>;
  requestBodyRaw?: string;
  responseBody?: unknown;
  responseSummary?: unknown;
  errorClass: string | null;
};

export async function handleOpenAiSpeech(params: {
  req: IncomingMessage;
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
}): Promise<OpenAiAudioRouteResult> {
  let bodyText = "";
  try {
    bodyText = await readRequestBody(params.req);
    const requestBody = parseJsonObject(bodyText);
    const rendered = renderSpeech(requestBody);
    writeBinary(params.res, 200, rendered.body, {
      ...openAiResponseHeaders({
        requestId: params.requestId,
        receivedAtEpochMs: params.receivedAtEpochMs
      }),
      "content-type": rendered.contentType
    });
    return {
      status: 200,
      model: rendered.model,
      bodyBytes: Buffer.byteLength(bodyText),
      requestBody,
      responseSummary: rendered.responseSummary,
      errorClass: null
    };
  } catch (error) {
    const status = readErrorStatus(error);
    const errorClass = readErrorType(error) ?? "invalid_request_error";
    const responseBody = {
      error: {
        message: error instanceof Error ? error.message : "request failed",
        type: errorClass
      }
    };
    writeJson(params.res, status, responseBody, openAiResponseHeaders({
      requestId: params.requestId,
      receivedAtEpochMs: params.receivedAtEpochMs
    }));
    return {
      status,
      model: null,
      bodyBytes: Buffer.byteLength(bodyText),
      ...(bodyText ? { requestBodyRaw: bodyText } : {}),
      responseBody,
      errorClass
    };
  }
}
