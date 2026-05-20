import { readFile } from "node:fs/promises";
import { isRecord, parseJsonObject, readString } from "../../../shared/json.js";

export type OpenAiModel = {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
};

const MODEL_CREATED_AT = 1_735_689_600;

const DEFAULT_MODEL_IDS = [
  "gpt-mock",
  "gpt-5.5",
  "gpt-5.5-2026-04-23",
  "gpt-5.5-pro",
  "gpt-5.4",
  "gpt-5.4-pro",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.2",
  "gpt-5.2-pro",
  "gpt-5.2-codex",
  "gpt-5.1",
  "gpt-5.1-codex",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-audio-1.5",
  "gpt-audio",
  "gpt-audio-mini",
  "gpt-realtime-2",
  "gpt-realtime-translate",
  "gpt-realtime-whisper",
  "gpt-realtime-1.5",
  "gpt-realtime",
  "gpt-realtime-mini",
  "gpt-image-2",
  "gpt-image-1.5",
  "gpt-image-1",
  "gpt-image-1-mini",
  "chatgpt-image-latest",
  "sora-2",
  "sora-2-pro",
  "gpt-4o-mini-tts",
  "gpt-4o-transcribe",
  "gpt-4o-mini-transcribe",
  "gpt-4o-transcribe-diarize",
  "text-embedding-3-small",
  "text-embedding-3-large",
  "text-embedding-ada-002",
  "omni-moderation-latest",
  "whisper-1",
  "tts-1",
  "tts-1-hd"
] as const;

export const DEFAULT_OPENAI_MODEL_CATALOG: readonly OpenAiModel[] = DEFAULT_MODEL_IDS.map((id) => ({
  id,
  object: "model",
  created: MODEL_CREATED_AT,
  owned_by: id === "gpt-mock" ? "mock-ai-provider" : "openai"
}));

export async function loadOpenAiModelCatalog(path: string): Promise<readonly OpenAiModel[]> {
  const text = await readFile(path, "utf8");
  return validateOpenAiModelCatalog(parseJsonObject(text));
}

export function validateOpenAiModelCatalog(value: unknown): readonly OpenAiModel[] {
  if (!isRecord(value) || !Array.isArray(value.models) || value.models.length === 0) {
    throw new Error("models file must be an object with a non-empty models array");
  }
  return value.models.map((item, index) => {
    if (typeof item === "string") {
      return {
        id: item,
        object: "model",
        created: MODEL_CREATED_AT,
        owned_by: "openai"
      };
    }
    if (!isRecord(item)) {
      throw new Error(`models[${index}] must be a string or model object`);
    }
    const id = readString(item, "id");
    if (!id) {
      throw new Error(`models[${index}].id must be a non-empty string`);
    }
    const created = typeof item.created === "number" && Number.isInteger(item.created)
      ? item.created
      : MODEL_CREATED_AT;
    return {
      id,
      object: "model",
      created,
      owned_by: readString(item, "owned_by") ?? "openai"
    };
  });
}

export function findOpenAiModel(catalog: readonly OpenAiModel[], id: string): OpenAiModel | null {
  return catalog.find((model) => model.id === id) ?? null;
}
