import type { ServerResponse } from "node:http";
import { createChatCompletionId } from "../../shared/ids.js";
import { readString, type JsonRecord } from "../../shared/json.js";
import { writeSseDone, writeSseJson } from "../../shared/sse.js";
import type { ScriptStep } from "../../scripts/types.js";
import { renderFunctionToolCalls } from "./tool-calls.js";

export type OpenAiChatStreamResult = {
  model: string;
  stream: true;
  responseType: string;
  finalText: string | null;
  toolCallsEmitted: number;
};

export function writeChatCompletionStream(params: {
  res: ServerResponse;
  requestBody: JsonRecord;
  step: ScriptStep;
  headers: Record<string, string>;
}): OpenAiChatStreamResult {
  const model = readString(params.requestBody, "model") ?? "mock-model";
  const id = createChatCompletionId();
  const created = Math.floor(Date.now() / 1000);
  const includeUsage = readIncludeUsage(params.requestBody);

  params.res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    "connection": "keep-alive",
    ...params.headers
  });

  writeSseJson(params.res, {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: { role: "assistant" },
        finish_reason: null
      }
    ],
    usage: null
  });

  if (params.step.respond.type === "tool-calls") {
    for (const [index, toolCall] of renderFunctionToolCalls(params.step.respond.toolCalls).entries()) {
      writeSseJson(params.res, {
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index,
                  id: toolCall.id,
                  type: toolCall.type,
                  function: toolCall.function
                }
              ]
            },
            finish_reason: null
          }
        ],
        usage: null
      });
    }

    writeFinalChunk({
      res: params.res,
      id,
      created,
      model,
      finishReason: "tool_calls",
      includeUsage
    });
    return {
      model,
      stream: true,
      responseType: params.step.respond.type,
      finalText: null,
      toolCallsEmitted: params.step.respond.toolCalls.length
    };
  }

  const text = params.step.respond.text;
  for (const content of splitStreamText(text)) {
    writeSseJson(params.res, {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        {
          index: 0,
          delta: { content },
          finish_reason: null
        }
      ],
      usage: null
    });
  }

  writeFinalChunk({
    res: params.res,
    id,
    created,
    model,
    finishReason: "stop",
    includeUsage
  });

  return {
    model,
    stream: true,
    responseType: params.step.respond.type,
    finalText: text,
    toolCallsEmitted: 0
  };
}

function writeFinalChunk(params: {
  res: ServerResponse;
  id: string;
  created: number;
  model: string;
  finishReason: "stop" | "tool_calls";
  includeUsage: boolean;
}): void {
  writeSseJson(params.res, {
    id: params.id,
    object: "chat.completion.chunk",
    created: params.created,
    model: params.model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: params.finishReason
      }
    ],
    usage: null
  });

  if (params.includeUsage) {
    writeSseJson(params.res, {
      id: params.id,
      object: "chat.completion.chunk",
      created: params.created,
      model: params.model,
      choices: [],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    });
  }

  writeSseDone(params.res);
  params.res.end();
}

function readIncludeUsage(requestBody: JsonRecord): boolean {
  const streamOptions = requestBody.stream_options;
  return typeof streamOptions === "object"
    && streamOptions !== null
    && !Array.isArray(streamOptions)
    && (streamOptions as Record<string, unknown>).include_usage === true;
}

function splitStreamText(text: string): string[] {
  if (text.length === 0) {
    return [""];
  }
  const chunks = text.match(/\S+\s*/g);
  return chunks && chunks.length > 0 ? chunks : [text];
}
