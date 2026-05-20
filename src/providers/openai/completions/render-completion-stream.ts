import type { ServerResponse } from "node:http";
import { createCompletionId } from "../../../shared/ids.js";
import { corsHeaders } from "../../../shared/http.js";
import { readString, type JsonRecord } from "../../../shared/json.js";
import { writeSseDone, writeSseJson } from "../../../shared/sse.js";
import type { FinalTextResponse, ScriptStep } from "../../../scripts/types.js";

export type OpenAiCompletionStreamResult = {
  model: string;
  stream: true;
  responseType: string;
  finalText: string;
  toolCallsEmitted: 0;
};

export function writeCompletionStream(params: {
  res: ServerResponse;
  requestBody: JsonRecord;
  step: ScriptStep & { respond: FinalTextResponse };
  headers: Record<string, string>;
}): OpenAiCompletionStreamResult {
  const model = readString(params.requestBody, "model") ?? "gpt-3.5-turbo-instruct";
  const id = createCompletionId();
  const created = Math.floor(Date.now() / 1000);
  const text = params.step.respond.text;

  params.res.writeHead(200, {
    ...corsHeaders(),
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    "connection": "keep-alive",
    ...params.headers
  });

  for (const chunkText of splitStreamText(text)) {
    writeSseJson(params.res, {
      id,
      object: "text_completion",
      created,
      model,
      choices: [
        {
          text: chunkText,
          index: 0,
          logprobs: null,
          finish_reason: null
        }
      ]
    });
  }

  writeSseJson(params.res, {
    id,
    object: "text_completion",
    created,
    model,
    choices: [
      {
        text: "",
        index: 0,
        logprobs: null,
        finish_reason: "stop"
      }
    ]
  });
  writeSseDone(params.res);
  params.res.end();

  return {
    model,
    stream: true,
    responseType: params.step.respond.type,
    finalText: text,
    toolCallsEmitted: 0
  };
}

function splitStreamText(text: string): string[] {
  if (text.length === 0) {
    return [""];
  }
  const chunks = text.match(/.{1,12}(?:\s|$)/gu)?.map((chunk) => chunk.trimStart()).filter(Boolean);
  return chunks && chunks.length > 0 ? chunks : [text];
}
