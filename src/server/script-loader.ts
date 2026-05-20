import { readFile } from "node:fs/promises";
import { parseJsonObject } from "../shared/json.js";
import { validateScript } from "../scripts/validate.js";
import type { MockScript, ScriptRuntime, ScriptStep } from "../scripts/types.js";

export async function loadScript(path: string): Promise<MockScript> {
  const text = await readFile(path, "utf8");
  return validateScript(parseJsonObject(text));
}

export function createScriptRuntime(script: MockScript): ScriptRuntime {
  let requestIndex = 0;
  return {
    script,
    nextStep(): ScriptStep {
      const step = script.steps[Math.min(requestIndex, script.steps.length - 1)];
      requestIndex += 1;
      if (!step) {
        throw new Error("script has no steps");
      }
      return step;
    }
  };
}
