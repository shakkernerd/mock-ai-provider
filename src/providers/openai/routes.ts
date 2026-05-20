import type { IncomingMessage, ServerResponse } from "node:http";
import { enforceOpenAiAuth, type OpenAiAuthOptions } from "./auth.js";
import type { OpenAiBatchStore } from "./batch-store.js";
import { routeOpenAiBatches } from "./handle-batches.js";
import { handleOpenAiAudioTranscription, handleOpenAiSpeech } from "./handle-audio.js";
import { handleOpenAiChatCompletions } from "./handle-chat-completions.js";
import { handleOpenAiEmbeddings } from "./handle-embeddings.js";
import { routeOpenAiFiles } from "./handle-files.js";
import { handleOpenAiImageGeneration, handleOpenAiImageMultipart } from "./handle-images.js";
import { handleOpenAiModels } from "./handle-models.js";
import { handleOpenAiResponses } from "./handle-responses.js";
import { routeOpenAiVideos } from "./handle-videos.js";
import type { OpenAiModel } from "./model-catalog.js";
import type { OpenAiFileStore } from "./file-store.js";
import type { OpenAiVideoStore } from "./video-store.js";
import type { RequestJournalEntry } from "../../server/request-journal.js";
import type { ScriptRuntime } from "../../scripts/types.js";

export type OpenAiRoutesOptions = {
  providers: readonly string[];
  runtime: ScriptRuntime;
  auth: OpenAiAuthOptions;
  models: readonly OpenAiModel[];
  batches: OpenAiBatchStore;
  files: OpenAiFileStore;
  videos: OpenAiVideoStore;
};

export type OpenAiRouteMatch = {
  handled: boolean;
  journal?: OpenAiJournalFields;
};

export type OpenAiJournalFields = Omit<
  RequestJournalEntry,
  "schemaVersion"
    | "requestId"
    | "clientRequestId"
    | "method"
    | "path"
    | "receivedAt"
    | "receivedAtEpochMs"
    | "respondedAt"
    | "respondedAtEpochMs"
    | "durationMs"
>;

export async function routeOpenAiRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  path: string;
  requestId: string;
  receivedAtEpochMs: number;
  options: OpenAiRoutesOptions;
}): Promise<OpenAiRouteMatch> {
  if (!isOpenAiPath(params.path, params.options.providers)) {
    return { handled: false };
  }

  const authJournal = authorizeOpenAiRequest(params);
  if (authJournal) {
    return { handled: true, journal: authJournal };
  }

  const { req, res, path, requestId, receivedAtEpochMs, options } = params;

  if (req.method === "POST" && isOpenAiChatCompletionsPath(path, options.providers)) {
    const result = await handleOpenAiChatCompletions({
      req,
      res,
      runtime: options.runtime,
      requestId,
      receivedAtEpochMs
    });
    return { handled: true, journal: routeResultJournal("chat.completions", result) };
  }

  if (req.method === "POST" && isOpenAiEmbeddingsPath(path, options.providers)) {
    const result = await handleOpenAiEmbeddings({ req, res, requestId, receivedAtEpochMs });
    return {
      handled: true,
      journal: routeResultJournal("embeddings", {
        ...result,
        stream: false,
        matchedScriptStep: null,
        responseType: "embedding",
        finalText: null,
        toolCallsEmitted: 0
      })
    };
  }

  if (isOpenAiBatchesPath(path, options.providers)) {
    const result = await routeOpenAiBatches({
      req,
      res,
      path,
      requestId,
      receivedAtEpochMs,
      batches: options.batches
    });
    return {
      handled: true,
      journal: routeResultJournal("batches", {
        ...result,
        stream: false,
        matchedScriptStep: null,
        responseType: "batch",
        finalText: null,
        toolCallsEmitted: 0
      })
    };
  }

  if (req.method === "POST" && isOpenAiImagePath(path, options.providers)) {
    const result = path.endsWith("/edits") || path.endsWith("/variations")
      ? await handleOpenAiImageMultipart({
          req,
          res,
          requestId,
          receivedAtEpochMs,
          kind: path.endsWith("/edits") ? "edit" : "variation"
        })
      : await handleOpenAiImageGeneration({ req, res, requestId, receivedAtEpochMs });
    return {
      handled: true,
      journal: routeResultJournal(openAiImageSurface(path), {
        ...result,
        stream: false,
        matchedScriptStep: null,
        responseType: "image",
        finalText: null,
        toolCallsEmitted: 0
      })
    };
  }

  if (isOpenAiFilesPath(path, options.providers)) {
    const result = await routeOpenAiFiles({
      req,
      res,
      path,
      requestId,
      receivedAtEpochMs,
      files: options.files
    });
    return {
      handled: true,
      journal: routeResultJournal("files", {
        ...result,
        stream: false,
        matchedScriptStep: null,
        responseType: "file",
        finalText: null,
        toolCallsEmitted: 0
      })
    };
  }

  if (req.method === "POST" && isOpenAiSpeechPath(path, options.providers)) {
    const result = await handleOpenAiSpeech({ req, res, requestId, receivedAtEpochMs });
    return {
      handled: true,
      journal: routeResultJournal("audio.speech", {
        ...result,
        stream: false,
        matchedScriptStep: null,
        responseType: "audio",
        finalText: null,
        toolCallsEmitted: 0
      })
    };
  }

  if (req.method === "POST" && isOpenAiAudioTextPath(path, options.providers)) {
    const kind = path.endsWith("/translations") ? "translation" : "transcription";
    const result = await handleOpenAiAudioTranscription({
      req,
      res,
      requestId,
      receivedAtEpochMs,
      kind
    });
    return {
      handled: true,
      journal: routeResultJournal(`audio.${kind}s`, {
        ...result,
        stream: false,
        matchedScriptStep: null,
        responseType: kind,
        finalText: null,
        toolCallsEmitted: 0
      })
    };
  }

  if (req.method === "POST" && isOpenAiResponsesPath(path, options.providers)) {
    const result = await handleOpenAiResponses({
      req,
      res,
      runtime: options.runtime,
      requestId,
      receivedAtEpochMs
    });
    return { handled: true, journal: routeResultJournal("responses", result) };
  }

  if (isOpenAiVideosPath(path, options.providers)) {
    const result = await routeOpenAiVideos({
      req,
      res,
      path,
      requestId,
      receivedAtEpochMs,
      videos: options.videos
    });
    return {
      handled: true,
      journal: routeResultJournal("videos", {
        ...result,
        stream: false,
        matchedScriptStep: null,
        responseType: "video",
        finalText: null,
        toolCallsEmitted: 0
      })
    };
  }

  if (req.method === "GET" && isOpenAiModelsPath(path, options.providers)) {
    const modelId = readOpenAiModelId(path);
    const result = handleOpenAiModels({
      res,
      requestId,
      receivedAtEpochMs,
      catalog: options.models,
      ...(modelId ? { modelId } : {})
    });
    return {
      handled: true,
      journal: {
        providerId: "openai",
        apiSurface: "models",
        model: result.model,
        stream: null,
        status: result.status,
        matchedScriptStep: null,
        responseType: "model",
        toolCallsEmitted: 0,
        finalTextEmitted: null,
        errorClass: result.errorClass,
        bodyBytes: result.bodyBytes,
        responseBody: result.responseBody
      }
    };
  }

  return { handled: false };
}

function routeResultJournal(
  apiSurface: string,
  result: {
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
  }
): OpenAiJournalFields {
  return {
    providerId: "openai",
    apiSurface,
    model: result.model,
    stream: result.stream,
    status: result.status,
    matchedScriptStep: result.matchedScriptStep,
    responseType: result.responseType,
    toolCallsEmitted: result.toolCallsEmitted,
    finalTextEmitted: result.finalText,
    errorClass: result.errorClass,
    bodyBytes: result.bodyBytes,
    ...(result.requestBody ? { requestBody: result.requestBody } : {}),
    ...(result.requestBodyRaw ? { requestBodyRaw: result.requestBodyRaw } : {}),
    ...(result.responseBody ? { responseBody: result.responseBody } : {}),
    ...(result.responseSummary ? { responseSummary: result.responseSummary } : {})
  };
}

function isOpenAiPath(path: string, providers: readonly string[]): boolean {
  if (path.startsWith("/openai/v1/")) {
    return providers.includes("openai");
  }
  return path.startsWith("/v1/") && providers.length === 1 && providers[0] === "openai";
}

function isOpenAiChatCompletionsPath(path: string, providers: readonly string[]): boolean {
  if (path === "/openai/v1/chat/completions") {
    return providers.includes("openai");
  }
  return path === "/v1/chat/completions" && providers.length === 1 && providers[0] === "openai";
}

function isOpenAiModelsPath(path: string, providers: readonly string[]): boolean {
  if (path === "/openai/v1/models" || path.startsWith("/openai/v1/models/")) {
    return providers.includes("openai");
  }
  if (path === "/v1/models" || path.startsWith("/v1/models/")) {
    return providers.length === 1 && providers[0] === "openai";
  }
  return false;
}

function isOpenAiEmbeddingsPath(path: string, providers: readonly string[]): boolean {
  if (path === "/openai/v1/embeddings") {
    return providers.includes("openai");
  }
  return path === "/v1/embeddings" && providers.length === 1 && providers[0] === "openai";
}

function isOpenAiImagePath(path: string, providers: readonly string[]): boolean {
  if (path === "/openai/v1/images/generations" || path === "/openai/v1/images/edits" || path === "/openai/v1/images/variations") {
    return providers.includes("openai");
  }
  return (path === "/v1/images/generations" || path === "/v1/images/edits" || path === "/v1/images/variations")
    && providers.length === 1
    && providers[0] === "openai";
}

function isOpenAiSpeechPath(path: string, providers: readonly string[]): boolean {
  if (path === "/openai/v1/audio/speech") {
    return providers.includes("openai");
  }
  return path === "/v1/audio/speech" && providers.length === 1 && providers[0] === "openai";
}

function openAiImageSurface(path: string): string {
  if (path.endsWith("/edits")) {
    return "images.edits";
  }
  if (path.endsWith("/variations")) {
    return "images.variations";
  }
  return "images.generations";
}

function isOpenAiAudioTextPath(path: string, providers: readonly string[]): boolean {
  if (path === "/openai/v1/audio/transcriptions" || path === "/openai/v1/audio/translations") {
    return providers.includes("openai");
  }
  return (path === "/v1/audio/transcriptions" || path === "/v1/audio/translations")
    && providers.length === 1
    && providers[0] === "openai";
}

function isOpenAiResponsesPath(path: string, providers: readonly string[]): boolean {
  if (path === "/openai/v1/responses") {
    return providers.includes("openai");
  }
  return path === "/v1/responses" && providers.length === 1 && providers[0] === "openai";
}

function isOpenAiVideosPath(path: string, providers: readonly string[]): boolean {
  if (path === "/openai/v1/videos" || path.startsWith("/openai/v1/videos/")) {
    return providers.includes("openai");
  }
  if (path === "/v1/videos" || path.startsWith("/v1/videos/")) {
    return providers.length === 1 && providers[0] === "openai";
  }
  return false;
}

function isOpenAiFilesPath(path: string, providers: readonly string[]): boolean {
  if (path === "/openai/v1/files" || path.startsWith("/openai/v1/files/")) {
    return providers.includes("openai");
  }
  if (path === "/v1/files" || path.startsWith("/v1/files/")) {
    return providers.length === 1 && providers[0] === "openai";
  }
  return false;
}

function isOpenAiBatchesPath(path: string, providers: readonly string[]): boolean {
  if (path === "/openai/v1/batches" || path.startsWith("/openai/v1/batches/")) {
    return providers.includes("openai");
  }
  if (path === "/v1/batches" || path.startsWith("/v1/batches/")) {
    return providers.length === 1 && providers[0] === "openai";
  }
  return false;
}

function readOpenAiModelId(path: string): string | undefined {
  const prefix = path.startsWith("/openai/") ? "/openai/v1/models/" : "/v1/models/";
  if (!path.startsWith(prefix)) {
    return undefined;
  }
  const modelId = path.slice(prefix.length);
  return modelId.length > 0 ? decodeURIComponent(modelId) : undefined;
}

function authorizeOpenAiRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
  options: OpenAiRoutesOptions;
}): OpenAiJournalFields | null {
  const result = enforceOpenAiAuth({
    req: params.req,
    res: params.res,
    requestId: params.requestId,
    receivedAtEpochMs: params.receivedAtEpochMs,
    auth: params.options.auth
  });
  if (result.ok) {
    return null;
  }
  return {
    providerId: "openai",
    apiSurface: null,
    model: null,
    stream: null,
    status: result.status ?? 401,
    matchedScriptStep: null,
    responseType: null,
    toolCallsEmitted: 0,
    finalTextEmitted: null,
    errorClass: result.errorClass ?? "invalid_request_error",
    bodyBytes: 0
  };
}
