import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockAiProviderServer } from "../src/server/create-server.js";

describe("OpenAI Chat Completions tool calls", () => {
  let server: Server | null = null;
  let baseUrl = "";
  let requestLogPath = "";

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mock-ai-provider-tools-"));
    const scriptPath = join(dir, "script.json");
    requestLogPath = join(dir, "requests.jsonl");
    await writeFile(scriptPath, JSON.stringify({
      id: "tool-call-script",
      steps: [
        {
          id: "weather-tool",
          respond: {
            type: "tool-calls",
            toolCalls: [
              {
                id: "call_weather",
                name: "get_weather",
                arguments: "{\"location\":\"London\"}"
              }
            ]
          }
        }
      ]
    }), "utf8");
    server = await createMockAiProviderServer({
      providers: ["openai"],
      scriptPath,
      requestLogPath
    });
    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address !== "object") {
      throw new Error("server did not bind to a TCP port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => error ? reject(error) : resolve());
      });
      server = null;
    }
  });

  it("returns scripted OpenAI function tool calls", async () => {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-mock",
        messages: [{ role: "user", content: "Check the weather in London." }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              parameters: { type: "object" }
            }
          }
        ]
      })
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      choices: Array<{
        finish_reason: string;
        message: {
          content: string | null;
          tool_calls: Array<{
            id: string;
            type: string;
            function: { name: string; arguments: string };
          }>;
        };
      }>;
    };
    expect(body.choices[0]?.finish_reason).toBe("tool_calls");
    expect(body.choices[0]?.message).toMatchObject({
      content: null,
      tool_calls: [
        {
          id: "call_weather",
          type: "function",
          function: {
            name: "get_weather",
            arguments: "{\"location\":\"London\"}"
          }
        }
      ]
    });

    const journal = await readJournal(requestLogPath);
    expect(journal.find((entry) => entry.path === "/v1/chat/completions")).toMatchObject({
      providerId: "openai",
      apiSurface: "chat.completions",
      matchedScriptStep: "weather-tool",
      responseType: "tool-calls",
      toolCallsEmitted: 1,
      finalTextEmitted: null
    });
  });

  it("streams scripted OpenAI function tool calls", async () => {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-mock",
        stream: true,
        messages: [{ role: "user", content: "Check the weather in London." }],
        tools: [{ type: "function", function: { name: "get_weather" } }]
      })
    });

    expect(response.status).toBe(200);
    const events = readSseEvents(await response.text());
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        choices: [
          expect.objectContaining({
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_weather",
                  type: "function",
                  function: {
                    name: "get_weather",
                    arguments: "{\"location\":\"London\"}"
                  }
                }
              ]
            },
            finish_reason: null
          })
        ]
      }),
      expect.objectContaining({
        choices: [
          expect.objectContaining({
            delta: {},
            finish_reason: "tool_calls"
          })
        ]
      })
    ]));
  });
});

async function readJournal(path: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path, "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

function readSseEvents(text: string): Array<Record<string, unknown>> {
  return text
    .split("\n\n")
    .filter((event) => event.startsWith("data: ") && event !== "data: [DONE]")
    .map((event) => JSON.parse(event.slice("data: ".length)) as Record<string, unknown>);
}
