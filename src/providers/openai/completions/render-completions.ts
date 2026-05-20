import { createCompletionId } from "../../../shared/ids.js";
import { readString, type JsonRecord } from "../../../shared/json.js";
import type { FinalTextResponse, ScriptStep } from "../../../scripts/types.js";

export type OpenAiCompletionRenderResult = {
  body: JsonRecord;
  model: string;
  stream: boolean;
  responseType: string;
  finalText: string;
  toolCallsEmitted: 0;
};

export function renderCompletion(
  requestBody: JsonRecord,
  step: ScriptStep & { respond: FinalTextResponse }
): OpenAiCompletionRenderResult {
  const model = readString(requestBody, "model") ?? "gpt-3.5-turbo-instruct";
  const text = step.respond.text;
  const choices = renderChoices(requestBody, text);
  const body = {
    id: createCompletionId(),
    object: "text_completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices,
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    }
  };
  return {
    body,
    model,
    stream: requestBody.stream === true,
    responseType: step.respond.type,
    finalText: text,
    toolCallsEmitted: 0
  };
}

function renderChoices(requestBody: JsonRecord, text: string): Array<{
  text: string;
  index: number;
  logprobs: null;
  finish_reason: "stop";
}> {
  const promptCount = readPromptCount(requestBody.prompt);
  const n = readChoiceCount(requestBody.n);
  const totalChoices = Math.max(1, promptCount * n);
  return Array.from({ length: totalChoices }, (_, index) => ({
    text: requestBody.echo === true ? `${readEchoPrompt(requestBody.prompt)}${text}` : text,
    index,
    logprobs: null,
    finish_reason: "stop"
  }));
}

function readPromptCount(prompt: unknown): number {
  if (Array.isArray(prompt) && prompt.every((item) => typeof item === "string")) {
    return prompt.length;
  }
  return 1;
}

function readChoiceCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return 1;
  }
  return Math.min(value, 128);
}

function readEchoPrompt(prompt: unknown): string {
  if (typeof prompt === "string") {
    return prompt;
  }
  if (Array.isArray(prompt) && prompt.every((item) => typeof item === "string")) {
    return prompt.join("");
  }
  return "";
}
