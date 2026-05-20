import type { IncomingMessage, ServerResponse } from "node:http";
import { enforceOpenAiAuth, type OpenAiAuthOptions } from "./common/auth.js";
import { isOpenAiProviderPath, matchesOpenAiPath, readOpenAiPathSuffix } from "./common/paths.js";
import type { OpenAiBatchStore } from "./batches/batch-store.js";
import { routeOpenAiBatches } from "./batches/handle-batches.js";
import { handleOpenAiAudioTranscription, handleOpenAiSpeech } from "./media/handle-audio.js";
import { handleOpenAiChatCompletions } from "./chat/handle-chat-completions.js";
import { handleOpenAiCompletions } from "./completions/handle-completions.js";
import { handleOpenAiEmbeddings } from "./embeddings/handle-embeddings.js";
import { routeOpenAiFiles } from "./files/handle-files.js";
import { handleOpenAiImageGeneration, handleOpenAiImageMultipart } from "./media/handle-images.js";
import { handleOpenAiModels } from "./models/handle-models.js";
import { handleOpenAiModeration } from "./moderations/handle-moderations.js";
import { handleOpenAiResponses } from "./responses/handle-responses.js";
import { routeOpenAiVideos } from "./media/handle-videos.js";
import { routeOpenAiUploads } from "./uploads/handle-uploads.js";
import { routeOpenAiVectorStores } from "./vector-stores/handle-vector-stores.js";
import type { OpenAiModel } from "./models/model-catalog.js";
import type { OpenAiFileStore } from "./files/file-store.js";
import type { OpenAiVideoStore } from "./media/video-store.js";
import type { OpenAiUploadStore } from "./uploads/upload-store.js";
import type { OpenAiVectorStoreStore } from "./vector-stores/vector-store.js";
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
  uploads: OpenAiUploadStore;
  vectorStores: OpenAiVectorStoreStore;
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
  if (!isOpenAiProviderPath(params.path, params.options.providers)) {
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

  if (req.method === "POST" && isOpenAiCompletionsPath(path, options.providers)) {
    const result = await handleOpenAiCompletions({
      req,
      res,
      runtime: options.runtime,
      requestId,
      receivedAtEpochMs
    });
    return { handled: true, journal: routeResultJournal("completions", result) };
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

  if (req.method === "POST" && isOpenAiModerationsPath(path, options.providers)) {
    const result = await handleOpenAiModeration({ req, res, requestId, receivedAtEpochMs });
    return {
      handled: true,
      journal: routeResultJournal("moderations", {
        ...result,
        stream: false,
        matchedScriptStep: null,
        responseType: "moderation",
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

  if (isOpenAiUploadsPath(path, options.providers)) {
    const result = await routeOpenAiUploads({
      req,
      res,
      path,
      providers: options.providers,
      requestId,
      receivedAtEpochMs,
      uploads: options.uploads,
      files: options.files
    });
    return {
      handled: true,
      journal: routeResultJournal("uploads", {
        ...result,
        stream: false,
        matchedScriptStep: null,
        responseType: "upload",
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

  if (isOpenAiVectorStoresPath(path, options.providers)) {
    const result = await routeOpenAiVectorStores({
      req,
      res,
      path,
      providers: options.providers,
      requestId,
      receivedAtEpochMs,
      vectorStores: options.vectorStores
    });
    return {
      handled: true,
      journal: routeResultJournal("vector_stores", {
        ...result,
        stream: false,
        matchedScriptStep: null,
        responseType: "vector_store",
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

function isOpenAiChatCompletionsPath(path: string, providers: readonly string[]): boolean {
  return matchesOpenAiPath({ path, providers, exact: ["chat/completions"] });
}

function isOpenAiCompletionsPath(path: string, providers: readonly string[]): boolean {
  return matchesOpenAiPath({ path, providers, exact: ["completions"] });
}

function isOpenAiModelsPath(path: string, providers: readonly string[]): boolean {
  return matchesOpenAiPath({ path, providers, exact: ["models"], prefix: ["models/"] });
}

function isOpenAiEmbeddingsPath(path: string, providers: readonly string[]): boolean {
  return matchesOpenAiPath({ path, providers, exact: ["embeddings"] });
}

function isOpenAiModerationsPath(path: string, providers: readonly string[]): boolean {
  return matchesOpenAiPath({ path, providers, exact: ["moderations"] });
}

function isOpenAiImagePath(path: string, providers: readonly string[]): boolean {
  return matchesOpenAiPath({
    path,
    providers,
    exact: ["images/generations", "images/edits", "images/variations"]
  });
}

function isOpenAiSpeechPath(path: string, providers: readonly string[]): boolean {
  return matchesOpenAiPath({ path, providers, exact: ["audio/speech"] });
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
  return matchesOpenAiPath({ path, providers, exact: ["audio/transcriptions", "audio/translations"] });
}

function isOpenAiResponsesPath(path: string, providers: readonly string[]): boolean {
  return matchesOpenAiPath({ path, providers, exact: ["responses"] });
}

function isOpenAiVideosPath(path: string, providers: readonly string[]): boolean {
  return matchesOpenAiPath({ path, providers, exact: ["videos"], prefix: ["videos/"] });
}

function isOpenAiFilesPath(path: string, providers: readonly string[]): boolean {
  return matchesOpenAiPath({ path, providers, exact: ["files"], prefix: ["files/"] });
}

function isOpenAiUploadsPath(path: string, providers: readonly string[]): boolean {
  return matchesOpenAiPath({ path, providers, exact: ["uploads"], prefix: ["uploads/"] });
}

function isOpenAiVectorStoresPath(path: string, providers: readonly string[]): boolean {
  return matchesOpenAiPath({ path, providers, exact: ["vector_stores"], prefix: ["vector_stores/"] });
}

function isOpenAiBatchesPath(path: string, providers: readonly string[]): boolean {
  return matchesOpenAiPath({ path, providers, exact: ["batches"], prefix: ["batches/"] });
}

function readOpenAiModelId(path: string): string | undefined {
  const suffix = readOpenAiPathSuffix(path, ["openai"]);
  const prefix = "models/";
  if (!suffix?.startsWith(prefix)) {
    return undefined;
  }
  const modelId = suffix.slice(prefix.length);
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
