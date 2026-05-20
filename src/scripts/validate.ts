import { isRecord, readString } from "../shared/json.js";
import type { FunctionToolCall, MockScript, RenderableScriptedResponse, ScriptStep, ScriptStepMatch } from "./types.js";

export function validateScript(value: unknown): MockScript {
  if (!isRecord(value)) {
    throw new Error("script must be a JSON object");
  }
  const id = readString(value, "id") ?? "mock-script";
  const stepsValue = value.steps;
  if (!Array.isArray(stepsValue) || stepsValue.length === 0) {
    throw new Error("script.steps must be a non-empty array");
  }
  return {
    id,
    steps: stepsValue.map(validateStep)
  };
}

function validateStep(value: unknown, index: number): ScriptStep {
  if (!isRecord(value)) {
    throw new Error(`script.steps[${index}] must be an object`);
  }
  const respond = value.respond;
  if (!isRecord(respond)) {
    throw new Error(`script.steps[${index}].respond must be an object`);
  }
  const type = readString(respond, "type");
  const id = readString(value, "id");
  const match = validateMatch(value.match, index);
  const base = {
    ...(id ? { id } : {}),
    ...(match ? { match } : {})
  };
  if (type === "final-text") {
    const text = readString(respond, "text");
    if (text === undefined) {
      throw new Error(`script.steps[${index}].respond.text must be a string`);
    }
    return {
      ...base,
      respond: {
        type,
        text
      }
    };
  }
  if (type === "tool-calls") {
    return {
      ...base,
      respond: {
        type,
        toolCalls: validateToolCalls(respond.toolCalls, index)
      }
    };
  }
  if (type === "error") {
    const message = readString(respond, "message");
    if (!message) {
      throw new Error(`script.steps[${index}].respond.message must be a non-empty string`);
    }
    return {
      ...base,
      respond: {
        type,
        message,
        ...readOptionalStatus(respond, index),
        ...readOptionalRespondString(respond, "errorType"),
        ...readOptionalRespondString(respond, "param"),
        ...readOptionalRespondString(respond, "code")
      }
    };
  }
  if (type === "delay") {
    const ms = readNonNegativeInteger(respond.ms, `script.steps[${index}].respond.ms`);
    const then = validateRenderableResponse(respond.then, index);
    return { ...base, respond: { type, ms, then } };
  }
  if (type === "malformed") {
    const body = readString(respond, "body");
    if (body === undefined) {
      throw new Error(`script.steps[${index}].respond.body must be a string`);
    }
    return {
      ...base,
      respond: {
        type,
        body,
        ...readOptionalStatus(respond, index),
        ...readOptionalRespondString(respond, "contentType")
      }
    };
  }
  if (type === "timeout") {
    return {
      ...base,
      respond: {
        type,
        ...(respond.ms === undefined ? {} : { ms: readNonNegativeInteger(respond.ms, `script.steps[${index}].respond.ms`) })
      }
    };
  }
  throw new Error(`script.steps[${index}].respond.type must be a supported response type`);
}

function validateRenderableResponse(value: unknown, stepIndex: number): RenderableScriptedResponse {
  if (!isRecord(value)) {
    throw new Error(`script.steps[${stepIndex}].respond.then must be an object`);
  }
  const type = readString(value, "type");
  if (type === "final-text") {
    const text = readString(value, "text");
    if (text === undefined) {
      throw new Error(`script.steps[${stepIndex}].respond.then.text must be a string`);
    }
    return { type, text };
  }
  if (type === "tool-calls") {
    return {
      type,
      toolCalls: validateToolCalls(value.toolCalls, stepIndex)
    };
  }
  throw new Error(`script.steps[${stepIndex}].respond.then.type must be "final-text" or "tool-calls"`);
}

function validateMatch(value: unknown, stepIndex: number): ScriptStepMatch | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`script.steps[${stepIndex}].match must be an object`);
  }
  const requestIndex = value.requestIndex;
  if (requestIndex !== undefined && (typeof requestIndex !== "number" || !Number.isInteger(requestIndex) || requestIndex < 0)) {
    throw new Error(`script.steps[${stepIndex}].match.requestIndex must be a non-negative integer`);
  }
  const body = value.body;
  if (body !== undefined && !isRecord(body)) {
    throw new Error(`script.steps[${stepIndex}].match.body must be an object`);
  }
  return {
    ...(typeof requestIndex === "number" ? { requestIndex } : {}),
    ...readOptionalMatchString(value, "apiSurface"),
    ...readOptionalMatchString(value, "model"),
    ...(body ? { body } : {}),
    ...(typeof value.hasToolResult === "boolean" ? { hasToolResult: value.hasToolResult } : {}),
    ...readOptionalMatchString(value, "toolResultName"),
    ...readOptionalMatchString(value, "priorToolCallName")
  };
}

function readOptionalMatchString(value: Record<string, unknown>, key: string): Record<string, string> {
  const raw = value[key];
  if (raw === undefined) {
    return {};
  }
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error(`match.${key} must be a non-empty string`);
  }
  return { [key]: raw };
}

function readOptionalRespondString(value: Record<string, unknown>, key: string): Record<string, string> {
  const raw = value[key];
  if (raw === undefined) {
    return {};
  }
  if (typeof raw !== "string") {
    throw new Error(`respond.${key} must be a string`);
  }
  return { [key]: raw };
}

function readOptionalStatus(value: Record<string, unknown>, stepIndex: number): { status?: number } {
  if (value.status === undefined) {
    return {};
  }
  return { status: readStatus(value.status, `script.steps[${stepIndex}].respond.status`) };
}

function readStatus(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 100 || value > 599) {
    throw new Error(`${label} must be an HTTP status code`);
  }
  return value;
}

function readNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function validateToolCalls(value: unknown, stepIndex: number): FunctionToolCall[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`script.steps[${stepIndex}].respond.toolCalls must be a non-empty array`);
  }
  return value.map((toolCall, index) => {
    if (!isRecord(toolCall)) {
      throw new Error(`script.steps[${stepIndex}].respond.toolCalls[${index}] must be an object`);
    }
    const id = readString(toolCall, "id");
    const name = readString(toolCall, "name");
    const args = readString(toolCall, "arguments");
    if (!name) {
      throw new Error(`script.steps[${stepIndex}].respond.toolCalls[${index}].name must be a non-empty string`);
    }
    if (args === undefined) {
      throw new Error(`script.steps[${stepIndex}].respond.toolCalls[${index}].arguments must be a string`);
    }
    return {
      ...(id ? { id } : {}),
      name,
      arguments: args
    };
  });
}
