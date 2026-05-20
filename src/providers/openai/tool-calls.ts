import { createToolCallId } from "../../shared/ids.js";
import type { FunctionToolCall } from "../../scripts/types.js";

export type OpenAiFunctionToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export function renderFunctionToolCalls(toolCalls: readonly FunctionToolCall[]): OpenAiFunctionToolCall[] {
  return toolCalls.map((toolCall) => ({
    id: toolCall.id ?? createToolCallId(),
    type: "function",
    function: {
      name: toolCall.name,
      arguments: toolCall.arguments
    }
  }));
}
