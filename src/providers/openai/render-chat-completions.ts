import { createChatCompletionId } from "../../shared/ids.js";
import { readString, type JsonRecord } from "../../shared/json.js";
import type { RenderableScriptedResponse, ScriptStep } from "../../scripts/types.js";
import { renderFunctionToolCalls } from "./tool-calls.js";

export type OpenAiChatRenderResult = {
  body: JsonRecord;
  model: string;
  stream: boolean;
  responseType: string;
  finalText: string | null;
  toolCallsEmitted: number;
};

export function renderChatCompletion(
  requestBody: JsonRecord,
  step: ScriptStep & { respond: RenderableScriptedResponse }
): OpenAiChatRenderResult {
  const model = readString(requestBody, "model") ?? "mock-model";
  const stream = requestBody.stream === true;
  const id = createChatCompletionId();
  const created = Math.floor(Date.now() / 1000);
  if (step.respond.type === "tool-calls") {
    return {
      model,
      stream,
      responseType: step.respond.type,
      finalText: null,
      toolCallsEmitted: step.respond.toolCalls.length,
      body: {
        id,
        object: "chat.completion",
        created,
        model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: renderFunctionToolCalls(step.respond.toolCalls)
            },
            finish_reason: "tool_calls"
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
  const text = step.respond.text;
  return {
    model,
    stream,
    responseType: step.respond.type,
    finalText: text,
    toolCallsEmitted: 0,
    body: {
      id,
      object: "chat.completion",
      created,
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
