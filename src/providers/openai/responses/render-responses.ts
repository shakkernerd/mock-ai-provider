import {
  createResponseId,
  createResponseItemId,
  createToolCallId
} from "../../../shared/ids.js";
import { readString, type JsonRecord } from "../../../shared/json.js";
import type { RenderableScriptedResponse, ScriptStep } from "../../../scripts/types.js";

export type OpenAiResponseRenderResult = {
  body: JsonRecord;
  model: string;
  responseType: string;
  finalText: string | null;
  toolCallsEmitted: number;
};

export function renderResponse(
  requestBody: JsonRecord,
  step: ScriptStep & { respond: RenderableScriptedResponse }
): OpenAiResponseRenderResult {
  const model = readString(requestBody, "model") ?? "gpt-mock";
  const response = createBaseResponse({ model, status: "completed" });
  if (step.respond.type === "tool-calls") {
    const output = step.respond.toolCalls.map((toolCall) => {
      const callId = toolCall.id ?? createToolCallId();
      return {
        type: "function_call",
        id: `fc_${callId.slice("call_".length)}`,
        call_id: callId,
        name: toolCall.name,
        arguments: toolCall.arguments,
        status: "completed"
      };
    });
    return {
      model,
      responseType: step.respond.type,
      finalText: null,
      toolCallsEmitted: output.length,
      body: {
        ...response,
        output,
        output_text: ""
      }
    };
  }

  const itemId = createResponseItemId();
  const text = step.respond.text;
  return {
    model,
    responseType: step.respond.type,
    finalText: text,
    toolCallsEmitted: 0,
    body: {
      ...response,
      output: [
        {
          id: itemId,
          type: "message",
          status: "completed",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text,
              annotations: []
            }
          ]
        }
      ],
      output_text: text
    }
  };
}

export function renderResponseStreamEvents(requestBody: JsonRecord, step: ScriptStep & { respond: RenderableScriptedResponse }): {
  events: JsonRecord[];
  result: OpenAiResponseRenderResult;
} {
  const rendered = renderResponse(requestBody, step);
  const response = rendered.body;
  const events: JsonRecord[] = [
    {
      type: "response.created",
      sequence_number: 0,
      response: {
        ...response,
        status: "in_progress",
        output: [],
        output_text: ""
      }
    }
  ];

  if (step.respond.type === "tool-calls") {
    const output = response.output as JsonRecord[];
    for (const [index, item] of output.entries()) {
      events.push({
        type: "response.output_item.added",
        sequence_number: events.length,
        output_index: index,
        item
      });
    }
  } else {
    const item = (response.output as JsonRecord[])[0] as JsonRecord;
    events.push({
      type: "response.output_item.added",
      sequence_number: events.length,
      output_index: 0,
      item: {
        ...item,
        content: []
      }
    });
    const content = splitResponseText(step.respond.text);
    for (const delta of content) {
      events.push({
        type: "response.output_text.delta",
        sequence_number: events.length,
        response_id: response.id,
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        delta
      });
    }
    events.push({
      type: "response.output_text.done",
      sequence_number: events.length,
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      text: step.respond.text,
      logprobs: []
    });
  }

  events.push({
    type: "response.completed",
    sequence_number: events.length,
    response
  });
  return { events, result: rendered };
}

function createBaseResponse(params: { model: string; status: "completed" | "in_progress" }): JsonRecord {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: createResponseId(),
    object: "response",
    created_at: now,
    status: params.status,
    background: false,
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model: params.model,
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: { effort: null, summary: null },
    service_tier: "default",
    store: true,
    temperature: null,
    text: { format: { type: "text" } },
    tool_choice: "auto",
    tools: [],
    top_p: null,
    truncation: "disabled",
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0
    },
    user: null,
    metadata: {}
  };
}

function splitResponseText(text: string): string[] {
  if (text.length === 0) {
    return [""];
  }
  const chunks = text.match(/\S+\s*/g);
  return chunks && chunks.length > 0 ? chunks : [text];
}
