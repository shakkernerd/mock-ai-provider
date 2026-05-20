import type { IncomingMessage, ServerResponse } from "node:http";
import { readErrorStatus, readErrorType } from "./errors.js";
import { openAiResponseHeaders } from "./headers.js";
import { renderEmbeddings } from "./render-embeddings.js";
import { readRequestBody, writeJson } from "../../shared/http.js";
import { parseJsonObject } from "../../shared/json.js";

export type OpenAiEmbeddingsRouteResult = {
  status: number;
  model: string | null;
  bodyBytes: number;
  requestBody?: Record<string, unknown>;
  requestBodyRaw?: string;
  errorClass: string | null;
};

export async function handleOpenAiEmbeddings(params: {
  req: IncomingMessage;
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
}): Promise<OpenAiEmbeddingsRouteResult> {
  let bodyText = "";
  try {
    bodyText = await readRequestBody(params.req);
    const requestBody = parseJsonObject(bodyText);
    const rendered = renderEmbeddings(requestBody);
    writeJson(params.res, 200, rendered.body, openAiResponseHeaders({
      requestId: params.requestId,
      receivedAtEpochMs: params.receivedAtEpochMs
    }));
    return {
      status: 200,
      model: rendered.model,
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
      bodyBytes: Buffer.byteLength(bodyText),
      ...(bodyText ? { requestBodyRaw: bodyText } : {}),
      errorClass
    };
  }
}
