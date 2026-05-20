import { createChatCompletionId } from "../../shared/ids.js";
import { readString, type JsonRecord } from "../../shared/json.js";
import type { ScriptStep } from "../../scripts/types.js";

export type OpenAiChatRenderResult = {
  body: JsonRecord;
  model: string;
  stream: boolean;
  responseType: string;
  finalText: string | null;
};

export function renderChatCompletion(requestBody: JsonRecord, step: ScriptStep): OpenAiChatRenderResult {
  const model = readString(requestBody, "model") ?? "mock-model";
  const stream = requestBody.stream === true;
  const text = step.respond.text;
  return {
    model,
    stream,
    responseType: step.respond.type,
    finalText: text,
    body: {
      id: createChatCompletionId(),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: text
          },
          finish_reason: "stop"
        }
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    }
  };
}
