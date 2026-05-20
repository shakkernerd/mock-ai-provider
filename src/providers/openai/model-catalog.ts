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
  "gpt-image-1.5",
  "gpt-image-1",
  "gpt-image-1-mini",
  "chatgpt-image-latest",
  "sora-2",
  "sora-2-pro",
  "text-embedding-3-small",
  "text-embedding-3-large",
  "text-embedding-ada-002",
  "omni-moderation-latest",
  "whisper-1",
  "tts-1",
  "tts-1-hd"
] as const;

export const OPENAI_MODEL_CATALOG: readonly OpenAiModel[] = DEFAULT_MODEL_IDS.map((id) => ({
  id,
  object: "model",
  created: MODEL_CREATED_AT,
  owned_by: id === "gpt-mock" ? "mock-ai-provider" : "openai"
}));

export function findOpenAiModel(id: string): OpenAiModel | null {
  return OPENAI_MODEL_CATALOG.find((model) => model.id === id) ?? null;
}
