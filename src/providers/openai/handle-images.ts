import type { IncomingMessage, ServerResponse } from "node:http";
import { openAiErrorBody, readErrorStatus, readErrorType } from "./errors.js";
import { openAiResponseHeaders } from "./headers.js";
import { renderImageEdit, renderImageGeneration, renderImageVariation } from "./render-images.js";
import { firstHeader, readRequestBody, readRequestBuffer, writeJson } from "../../shared/http.js";
import { parseJsonObject } from "../../shared/json.js";
import { parseMultipartForm } from "../../shared/multipart.js";

export type OpenAiImagesRouteResult = {
  status: number;
  model: string | null;
  bodyBytes: number;
  requestBody?: Record<string, unknown>;
  requestBodyRaw?: string;
  responseBody?: unknown;
  errorClass: string | null;
};

export async function handleOpenAiImageGeneration(params: {
  req: IncomingMessage;
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
}): Promise<OpenAiImagesRouteResult> {
  let bodyText = "";
  try {
    bodyText = await readRequestBody(params.req);
    const requestBody = parseJsonObject(bodyText);
    const rendered = renderImageGeneration(requestBody);
    writeJson(params.res, 200, rendered.body, openAiResponseHeaders({
      requestId: params.requestId,
      receivedAtEpochMs: params.receivedAtEpochMs
    }));
    return {
      status: 200,
      model: rendered.model,
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
      bodyBytes: Buffer.byteLength(bodyText),
      ...(bodyText ? { requestBodyRaw: bodyText } : {}),
      responseBody,
      errorClass
    };
  }
}

export async function handleOpenAiImageMultipart(params: {
  req: IncomingMessage;
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
  kind: "edit" | "variation";
}): Promise<OpenAiImagesRouteResult> {
  let bodyBytes = 0;
  try {
    const body = await readRequestBuffer(params.req);
    bodyBytes = body.length;
    const form = parseMultipartForm(firstHeader(params.req, "content-type"), body);
    if (!form.files.image) {
      throw Object.assign(new Error("image is required"), {
        statusCode: 400,
        errorType: "invalid_request_error"
      });
    }
    const requestBody = {
      ...form.fields,
      image: form.files.image,
      ...(form.files.mask ? { mask: form.files.mask } : {})
    };
    const rendered = params.kind === "edit"
      ? renderImageEdit(requestBody)
      : renderImageVariation(requestBody);
    writeJson(params.res, 200, rendered.body, openAiResponseHeaders({
      requestId: params.requestId,
      receivedAtEpochMs: params.receivedAtEpochMs
    }));
    return {
      status: 200,
      model: rendered.model,
      bodyBytes,
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
      bodyBytes,
      responseBody,
      errorClass
    };
  }
}
