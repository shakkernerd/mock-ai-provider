import { readFile } from "node:fs/promises";
import { parseJsonObject } from "../shared/json.js";
import { validateScript } from "../scripts/validate.js";
import type { MockScript, ScriptRuntime, ScriptStep } from "../scripts/types.js";

export const DEFAULT_SCRIPT: MockScript = {
  id: "default",
  steps: [
    {
      id: "default-final",
      respond: {
        type: "final-text",
        text: "Hello from mock AI provider"
      }
    }
  ]
};

export async function loadScript(path: string): Promise<MockScript> {
  const text = await readFile(path, "utf8");
  return validateScript(parseJsonObject(text));
}

export function createScriptRuntime(script: MockScript): ScriptRuntime {
  let currentScript = script;
  let requestIndex = 0;
  const priorToolCallNames = new Set<string>();
  return {
    get script() {
      return currentScript;
    },
    replaceScript(nextScript) {
      currentScript = nextScript;
      requestIndex = 0;
      priorToolCallNames.clear();
    },
    nextStep(context): ScriptStep {
      const step = selectStep({
        script: currentScript,
        requestIndex,
        priorToolCallNames,
        context
      });
      requestIndex += 1;
      if (step.respond.type === "tool-calls") {
        for (const toolCall of step.respond.toolCalls) {
          priorToolCallNames.add(toolCall.name);
        }
      }
      return step;
    }
  };
}

function selectStep(params: {
  script: MockScript;
  requestIndex: number;
  priorToolCallNames: ReadonlySet<string>;
  context: {
    apiSurface: string;
    model?: string | null;
    requestBody: Record<string, unknown>;
  };
}): ScriptStep {
  const matched = params.script.steps.find((step) => step.match && matchesStep(step, params));
  if (matched) {
    return matched;
  }
  const step = params.script.steps[Math.min(params.requestIndex, params.script.steps.length - 1)];
  if (!step) {
    throw new Error("script has no steps");
  }
  return step;
}

function matchesStep(
  step: ScriptStep,
  params: {
    requestIndex: number;
    priorToolCallNames: ReadonlySet<string>;
    context: {
      apiSurface: string;
      model?: string | null;
      requestBody: Record<string, unknown>;
    };
  }
): boolean {
  const match = step.match;
  if (!match) {
    return false;
  }
  if (match.requestIndex !== undefined && match.requestIndex !== params.requestIndex) {
    return false;
  }
  if (match.apiSurface !== undefined && match.apiSurface !== params.context.apiSurface) {
    return false;
  }
  if (match.model !== undefined && match.model !== params.context.model) {
    return false;
  }
  if (match.hasToolResult !== undefined && match.hasToolResult !== hasToolResult(params.context.requestBody)) {
    return false;
  }
  if (match.priorToolCallName !== undefined && !params.priorToolCallNames.has(match.priorToolCallName)) {
    return false;
  }
  if (match.toolResultName !== undefined && !hasToolResultName(params.context.requestBody, match.toolResultName, params.priorToolCallNames)) {
    return false;
  }
  return !match.body || Object.entries(match.body).every(([path, expected]) => readPath(params.context.requestBody, path) === expected);
}

function readPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    return (current as Record<string, unknown>)[key];
  }, value);
}

function hasToolResult(body: Record<string, unknown>): boolean {
  return readChatToolResults(body).length > 0 || readResponseToolOutputs(body).length > 0;
}

function hasToolResultName(body: Record<string, unknown>, name: string, priorToolCallNames: ReadonlySet<string>): boolean {
  return readChatToolResults(body).some((result) => result.name === name)
    || readResponseToolOutputs(body).some((result) => result.name === name)
    || (hasToolResult(body) && priorToolCallNames.has(name));
}

function readChatToolResults(body: Record<string, unknown>): Array<{ name?: string }> {
  const messages = body.messages;
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages
    .filter((message): message is Record<string, unknown> => Boolean(message) && typeof message === "object" && !Array.isArray(message))
    .filter((message) => message.role === "tool")
    .map((message) => (typeof message.name === "string" ? { name: message.name } : {}));
}

function readResponseToolOutputs(body: Record<string, unknown>): Array<{ name?: string }> {
  const input = body.input;
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .filter((item) => item.type === "function_call_output")
    .map((item) => (typeof item.name === "string" ? { name: item.name } : {}));
}
