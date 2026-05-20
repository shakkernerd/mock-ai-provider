import type { ServerResponse } from "node:http";
import { createChatCompletionId } from "../../shared/ids.js";
import { readString, type JsonRecord } from "../../shared/json.js";
import { writeSseDone, writeSseJson } from "../../shared/sse.js";
import type { ScriptStep } from "../../scripts/types.js";

export type OpenAiChatStreamResult = {
  model: string;
  stream: true;
  responseType: string;
  finalText: string | null;
};

export function writeChatCompletionStream(params: {
  res: ServerResponse;
  requestBody: JsonRecord;
  step: ScriptStep;
  headers: Record<string, string>;
}): OpenAiChatStreamResult {
  const model = readString(params.requestBody, "model") ?? "mock-model";
  const text = params.step.respond.text;
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

  writeSseJson(params.res, {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop"
      }
    ],
    usage: null
  });

  if (includeUsage) {
    writeSseJson(params.res, {
      id,
      object: "chat.completion.chunk",
      created,
      model,
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

  return {
    model,
    stream: true,
    responseType: params.step.respond.type,
    finalText: text
  };
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
