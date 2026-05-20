import { isRecord, readString, type JsonRecord } from "../shared/json.js";
import type { MockScript, ScriptStep } from "./types.js";

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
  if (type !== "final-text") {
    throw new Error(`script.steps[${index}].respond.type must be "final-text"`);
  }
  const text = readString(respond, "text");
  if (text === undefined) {
    throw new Error(`script.steps[${index}].respond.text must be a string`);
  }
  const id = readString(value, "id");
  return {
    ...(id ? { id } : {}),
    respond: {
      type,
      text
    }
  };
}
