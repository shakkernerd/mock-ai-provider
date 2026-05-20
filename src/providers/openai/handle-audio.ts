import type { IncomingMessage, ServerResponse } from "node:http";
import { readErrorStatus, readErrorType } from "./errors.js";
import { openAiResponseHeaders } from "./headers.js";
import { renderSpeech } from "./render-audio.js";
import { firstHeader, readRequestBody, readRequestBuffer, writeBinary, writeJson, writeText } from "../../shared/http.js";
import { parseJsonObject } from "../../shared/json.js";
import { parseMultipartForm } from "../../shared/multipart.js";

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

export async function handleOpenAiAudioTranscription(params: {
  req: IncomingMessage;
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
  kind: "transcription" | "translation";
}): Promise<OpenAiAudioRouteResult> {
  let bodyBytes = 0;
  try {
    const body = await readRequestBuffer(params.req);
    bodyBytes = body.length;
    const form = parseMultipartForm(firstHeader(params.req, "content-type"), body);
    const model = form.fields.model;
    if (!model) {
      throw Object.assign(new Error("model must be a non-empty string"), {
        statusCode: 400,
        errorType: "invalid_request_error"
      });
    }
    if (!form.files.file) {
      throw Object.assign(new Error("file is required"), {
        statusCode: 400,
        errorType: "invalid_request_error"
      });
    }
    const responseFormat = form.fields.response_format ?? "json";
    const text = params.kind === "translation"
      ? "Hello from mock AI provider translation."
      : "Hello from mock AI provider transcription.";
    const response = renderAudioTextResponse({
      responseFormat,
      text,
      task: params.kind === "translation" ? "translate" : "transcribe"
    });
    const headers = openAiResponseHeaders({
      requestId: params.requestId,
      receivedAtEpochMs: params.receivedAtEpochMs
    });
    if (typeof response === "string") {
      writeText(params.res, 200, response, headers);
    } else {
      writeJson(params.res, 200, response, headers);
    }
    return {
      status: 200,
      model,
      bodyBytes,
      requestBody: {
        ...form.fields,
        file: form.files.file
      },
      ...(typeof response === "string" ? { responseSummary: { text: response, responseFormat } } : { responseBody: response }),
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
      bodyBytes,
      responseBody,
      errorClass
    };
  }
}

function renderAudioTextResponse(params: {
  responseFormat: string;
  text: string;
  task: "transcribe" | "translate";
}): Record<string, unknown> | string {
  switch (params.responseFormat) {
    case "text":
      return params.text;
    case "srt":
      return `1\n00:00:00,000 --> 00:00:01,000\n${params.text}\n`;
    case "vtt":
      return `WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n${params.text}\n`;
    case "verbose_json":
      return {
        task: params.task,
        language: "english",
        duration: 1,
        text: params.text,
        segments: [
          {
            id: 0,
            seek: 0,
            start: 0,
            end: 1,
            text: params.text,
            tokens: [],
            temperature: 0,
            avg_logprob: 0,
            compression_ratio: 1,
            no_speech_prob: 0
          }
        ],
        usage: { type: "duration", seconds: 1 }
      };
    case "diarized_json":
      return {
        task: params.task,
        duration: 1,
        text: params.text,
        segments: [
          {
            type: "transcript.text.segment",
            id: "seg_001",
            start: 0,
            end: 1,
            text: params.text,
            speaker: "speaker_0"
          }
        ],
        usage: { type: "duration", seconds: 1 }
      };
    case "json":
    default:
      return {
        text: params.text,
        usage: { type: "duration", seconds: 1 }
      };
  }
}
