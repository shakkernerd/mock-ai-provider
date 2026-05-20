import { createModerationId } from "../../../shared/ids.js";
import { isRecord, readString, type JsonRecord } from "../../../shared/json.js";

const moderationCategories = [
  "harassment",
  "harassment/threatening",
  "hate",
  "hate/threatening",
  "illicit",
  "illicit/violent",
  "self-harm",
  "self-harm/instructions",
  "self-harm/intent",
  "sexual",
  "sexual/minors",
  "violence",
  "violence/graphic"
] as const;

export type OpenAiModerationRender = {
  model: string;
  body: {
    id: string;
    model: string;
    results: Array<{
      flagged: boolean;
      categories: Record<string, boolean>;
      category_scores: Record<string, number>;
      category_applied_input_types: Record<string, string[]>;
    }>;
  };
};

export function renderModeration(requestBody: JsonRecord): OpenAiModerationRender {
  const model = readString(requestBody, "model") ?? "omni-moderation-latest";
  const inputs = readModerationInputs(requestBody.input);
  const body = {
    id: createModerationId(),
    model,
    results: inputs.map((input) => renderModerationResult(input))
  };
  return { model, body };
}

function readModerationInputs(value: unknown): ModerationInput[] {
  if (typeof value === "string") {
    if (value.length === 0) {
      throw new Error("input must not be empty");
    }
    return [{ inputTypes: ["text"] }];
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("input must be a non-empty string or array");
  }

  return value.map(readModerationInput);
}

function readModerationInput(value: unknown): ModerationInput {
  if (typeof value === "string") {
    return { inputTypes: ["text"] };
  }

  if (!isRecord(value)) {
    throw new Error("input array items must be strings or content objects");
  }

  const type = readString(value, "type");
  if (type === "text" || type === "input_text") {
    return { inputTypes: ["text"] };
  }
  if (type === "image" || type === "input_image" || type === "image_url") {
    return { inputTypes: ["image"] };
  }
  throw new Error(`unsupported moderation input type: ${type ?? "unknown"}`);
}

function renderModerationResult(input: ModerationInput): OpenAiModerationRender["body"]["results"][number] {
  const categories: Record<string, boolean> = {};
  const category_scores: Record<string, number> = {};
  const category_applied_input_types: Record<string, string[]> = {};

  for (const category of moderationCategories) {
    categories[category] = false;
    category_scores[category] = 0;
    category_applied_input_types[category] = appliedInputTypes(category, input.inputTypes);
  }

  return {
    flagged: false,
    categories,
    category_scores,
    category_applied_input_types
  };
}

function appliedInputTypes(category: string, inputTypes: readonly string[]): string[] {
  if (inputTypes.includes("image") && imageModerationCategories.has(category)) {
    return ["text", "image"].filter((type) => inputTypes.includes(type));
  }
  return inputTypes.includes("text") ? ["text"] : [];
}

type ModerationInput = {
  inputTypes: readonly string[];
};

const imageModerationCategories = new Set<string>([
  "self-harm",
  "self-harm/instructions",
  "self-harm/intent",
  "sexual",
  "violence",
  "violence/graphic"
]);
