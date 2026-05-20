import { readString, type JsonRecord } from "../../shared/json.js";
import { normalizeAudioFormat, readDefaultAudio } from "./media-assets.js";

const SUPPORTED_SPEECH_FORMATS = new Set(["mp3", "opus", "aac", "flac", "wav", "pcm"]);

export type OpenAiSpeechRenderResult = {
  body: Buffer;
  model: string;
  responseFormat: string;
  contentType: string;
  responseSummary: Record<string, unknown>;
};

export function renderSpeech(requestBody: JsonRecord): OpenAiSpeechRenderResult {
  const model = readString(requestBody, "model");
  if (!model) {
    throw Object.assign(new Error("model must be a non-empty string"), {
      statusCode: 400,
      errorType: "invalid_request_error"
    });
  }
  const input = readString(requestBody, "input");
  if (!input) {
    throw Object.assign(new Error("input must be a non-empty string"), {
      statusCode: 400,
      errorType: "invalid_request_error"
    });
  }
  const voice = readString(requestBody, "voice");
  if (!voice) {
    throw Object.assign(new Error("voice must be a non-empty string"), {
      statusCode: 400,
      errorType: "invalid_request_error"
    });
  }
  const responseFormat = normalizeAudioFormat(readString(requestBody, "response_format") ?? "mp3");
  if (!SUPPORTED_SPEECH_FORMATS.has(responseFormat)) {
    throw Object.assign(new Error("response_format must be one of mp3, opus, aac, flac, wav, or pcm"), {
      statusCode: 400,
      errorType: "invalid_request_error"
    });
  }

  const body = readDefaultAudio(responseFormat);
  return {
    body,
    model,
    responseFormat,
    contentType: contentTypeForAudioFormat(responseFormat),
    responseSummary: {
      binary: true,
      mediaType: "audio",
      responseFormat,
      byteLength: body.length,
      input,
      voice
    }
  };
}

function contentTypeForAudioFormat(format: string): string {
  switch (format) {
    case "aac":
      return "audio/aac";
    case "flac":
      return "audio/flac";
    case "opus":
      return "audio/ogg";
    case "pcm":
      return "audio/pcm";
    case "wav":
      return "audio/wav";
    default:
      return "audio/mpeg";
  }
}
