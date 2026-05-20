import { createServer, type Server } from "node:http";
import { createRequestJournal } from "./request-journal.js";
import { createScriptRuntime, DEFAULT_SCRIPT, loadScript } from "./script-loader.js";
import { routeRequest } from "./router.js";
import type { OpenAiAuthOptions } from "../providers/openai/auth.js";
import { createOpenAiBatchStore, type OpenAiBatchStore } from "../providers/openai/batch-store.js";
import {
  DEFAULT_OPENAI_MODEL_CATALOG,
  loadOpenAiModelCatalog,
  type OpenAiModel
} from "../providers/openai/model-catalog.js";
import { createOpenAiFileStore, type OpenAiFileStore } from "../providers/openai/file-store.js";
import { createOpenAiVideoStore, type OpenAiVideoStore } from "../providers/openai/video-store.js";
import type { MockScript } from "../scripts/types.js";

export type CreateServerOptions = {
  providers: readonly string[];
  scriptPath?: string;
  script?: MockScript;
  requestLogPath: string;
  openAiAuth?: OpenAiAuthOptions;
  openAiModels?: readonly OpenAiModel[];
  openAiModelsPath?: string;
  openAiBatches?: OpenAiBatchStore;
  openAiFiles?: OpenAiFileStore;
  openAiVideos?: OpenAiVideoStore;
};

export async function createMockAiProviderServer(options: CreateServerOptions): Promise<Server> {
  const providers = normalizeProviders(options.providers);
  const script = options.script ?? (options.scriptPath ? await loadScript(options.scriptPath) : DEFAULT_SCRIPT);
  const openAiModels = options.openAiModels
    ?? (options.openAiModelsPath ? await loadOpenAiModelCatalog(options.openAiModelsPath) : DEFAULT_OPENAI_MODEL_CATALOG);
  const runtime = createScriptRuntime(script);
  const journal = createRequestJournal(options.requestLogPath);
  const openAiBatches = options.openAiBatches ?? createOpenAiBatchStore();
  const openAiFiles = options.openAiFiles ?? createOpenAiFileStore();
  const openAiVideos = options.openAiVideos ?? createOpenAiVideoStore();

  return createServer((req, res) => {
    routeRequest(req, res, {
      providers,
      runtime,
      journal,
      openAiAuth: options.openAiAuth ?? { strict: false },
      openAiModels,
      openAiBatches,
      openAiFiles,
      openAiVideos
    }).catch((error: unknown) => {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      }
      res.end(`${JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : "internal server error",
          type: "internal_server_error"
        }
      })}\n`);
    });
  });
}

function normalizeProviders(providers: readonly string[]): string[] {
  const unique = [...new Set(providers.map((provider) => provider.trim()).filter(Boolean))];
  if (unique.length === 0) {
    throw new Error("at least one provider is required");
  }
  for (const provider of unique) {
    if (provider !== "openai") {
      throw new Error(`provider '${provider}' is not implemented in the first milestone`);
    }
  }
  return unique;
}
