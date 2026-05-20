import type { ServerResponse } from "node:http";
import { openAiErrorBody } from "./errors.js";
import type { RenderableScriptedResponse, ScriptStep, TerminalScriptedResponse } from "../../../scripts/types.js";
import { writeJson, writeText } from "../../../shared/http.js";
import { isRecord } from "../../../shared/json.js";

export type ScriptedTerminalResult = {
  status: number;
  responseType: string;
  responseBody?: unknown;
  responseSummary?: unknown;
  errorClass: string | null;
};

export type TerminalScriptStep = ScriptStep & { respond: TerminalScriptedResponse };

export type ScriptStepRequestContext = {
  requestBody: Record<string, unknown>;
};

export async function resolveScriptStep(
  step: ScriptStep,
  context?: ScriptStepRequestContext
): Promise<ScriptStep> {
  if (step.respond.type === "delay") {
    if (step.respond.ms > 0) {
      await sleep(step.respond.ms);
    }
    return {
      ...step,
      respond: renderScriptedResponseTemplates(step.respond.then, context)
    };
  }

  return {
    ...step,
    respond: renderScriptedResponseTemplates(step.respond, context)
  };
}

export function writeTerminalScriptResponse(params: {
  res: ServerResponse;
  response: TerminalScriptedResponse;
  headers: Record<string, string>;
}): ScriptedTerminalResult {
  if (params.response.type === "error" || params.response.type === "timeout") {
    const error = params.response.type === "timeout"
      ? Object.assign(new Error("mock provider scripted timeout"), {
          statusCode: 408,
          errorType: "timeout_error",
          code: "timeout"
        })
      : Object.assign(new Error(params.response.message), {
          statusCode: params.response.status ?? 400,
          errorType: params.response.errorType ?? "invalid_request_error",
          param: params.response.param,
          code: params.response.code
        });
    const body = openAiErrorBody(error);
    writeJson(params.res, params.response.type === "timeout" ? 408 : params.response.status ?? 400, body, params.headers);
    return {
      status: params.response.type === "timeout" ? 408 : params.response.status ?? 400,
      responseType: params.response.type,
      responseBody: body,
      errorClass: body.error.type
    };
  }

  writeText(params.res, params.response.status ?? 200, params.response.body, {
    ...params.headers,
    "content-type": params.response.contentType ?? "application/json; charset=utf-8"
  });
  return {
    status: params.response.status ?? 200,
    responseType: params.response.type,
    responseSummary: {
      malformed: true,
      byteLength: Buffer.byteLength(params.response.body),
      contentType: params.response.contentType ?? "application/json; charset=utf-8"
    },
    errorClass: null
  };
}

export function isRenderableStep(step: ScriptStep | TerminalScriptedResponse): step is ScriptStep & { respond: RenderableScriptedResponse } {
  return "respond" in step && (step.respond.type === "final-text" || step.respond.type === "tool-calls");
}

export function isTerminalStep(step: ScriptStep): step is TerminalScriptStep {
  return step.respond.type === "error" || step.respond.type === "malformed" || step.respond.type === "timeout";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderScriptedResponseTemplates(
  response: ScriptStep["respond"],
  context?: ScriptStepRequestContext
): ScriptStep["respond"] {
  if (response.type === "final-text") {
    return {
      ...response,
      text: renderTemplate(response.text, context)
    };
  }
  if (response.type === "tool-calls") {
    return {
      ...response,
      toolCalls: response.toolCalls.map((toolCall) => ({
        ...toolCall,
        arguments: renderTemplate(toolCall.arguments, context)
      }))
    };
  }
  return response;
}

function renderTemplate(value: string, context?: ScriptStepRequestContext): string {
  if (!value.includes("{{")) {
    return value;
  }
  return value.replace(/\{\{request\.text\.match:([^}]+)\}\}/g, (_match, pattern: string) =>
    firstRequestTextMatch(context?.requestBody, pattern)
  );
}

function firstRequestTextMatch(requestBody: Record<string, unknown> | undefined, pattern: string): string {
  if (!requestBody) {
    return "";
  }
  const requestText = collectRequestText(requestBody).join("\n");
  const regex = new RegExp(pattern, "m");
  const match = regex.exec(requestText);
  if (!match) {
    return "";
  }
  return match[1] ?? match[0];
}

function collectRequestText(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectRequestText);
  }
  if (!isRecord(value)) {
    return [];
  }
  return Object.values(value).flatMap(collectRequestText);
}
