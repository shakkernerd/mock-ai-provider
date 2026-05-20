import { describe, expect, it } from "vitest";
import { createScriptRuntime } from "../src/server/script-loader.js";
import { validateScript } from "../src/scripts/validate.js";

describe("script runtime", () => {
  it("matches steps by request metadata and body fields", () => {
    const runtime = createScriptRuntime(validateScript({
      id: "matched-script",
      steps: [
        {
          id: "fallback",
          respond: { type: "final-text", text: "fallback" }
        },
        {
          id: "model-match",
          match: {
            apiSurface: "chat.completions",
            model: "gpt-5.5",
            body: {
              "metadata.test_case": "match-me"
            }
          },
          respond: { type: "final-text", text: "matched" }
        }
      ]
    }));

    const step = runtime.nextStep({
      apiSurface: "chat.completions",
      model: "gpt-5.5",
      requestBody: {
        model: "gpt-5.5",
        metadata: { test_case: "match-me" }
      }
    });

    expect(step.id).toBe("model-match");
  });

  it("matches tool-result follow-up requests using prior tool-call names", () => {
    const runtime = createScriptRuntime(validateScript({
      id: "tool-loop",
      steps: [
        {
          id: "call-tool",
          respond: {
            type: "tool-calls",
            toolCalls: [{ id: "call_lookup", name: "lookup", arguments: "{}" }]
          }
        },
        {
          id: "tool-result",
          match: {
            hasToolResult: true,
            priorToolCallName: "lookup"
          },
          respond: { type: "final-text", text: "done" }
        }
      ]
    }));

    expect(runtime.nextStep({
      apiSurface: "chat.completions",
      model: "gpt-5.5",
      requestBody: { model: "gpt-5.5", messages: [{ role: "user", content: "lookup" }] }
    }).id).toBe("call-tool");

    expect(runtime.nextStep({
      apiSurface: "chat.completions",
      model: "gpt-5.5",
      requestBody: {
        model: "gpt-5.5",
        messages: [{ role: "tool", tool_call_id: "call_lookup", content: "result" }]
      }
    }).id).toBe("tool-result");
  });
});
