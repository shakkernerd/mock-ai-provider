#!/usr/bin/env node
import { parseArgs } from "node:util";
import { createMockAiProviderServer } from "./server/create-server.js";

async function main(argv: string[]): Promise<void> {
  const command = argv[0];
  if (command !== "serve") {
    printUsage();
    process.exitCode = command ? 1 : 0;
    return;
  }

  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      providers: { type: "string" },
      script: { type: "string" },
      port: { type: "string", default: "31337" },
      "request-log": { type: "string" },
      "strict-auth": { type: "boolean" },
      "api-key": { type: "string" },
      help: { type: "boolean", short: "h" }
    },
    allowPositionals: false
  });

  if (values.help) {
    printUsage();
    return;
  }

  const providers = requiredString(values.providers, "--providers").split(",");
  const scriptPath = optionalString(values.script);
  const requestLogPath = optionalString(values["request-log"]) ?? ".mock-ai-provider/requests.jsonl";
  const port = parsePort(requiredString(values.port, "--port"));
  const apiKey = optionalString(values["api-key"]);
  const server = await createMockAiProviderServer({
    providers,
    ...(scriptPath ? { scriptPath } : {}),
    requestLogPath,
    openAiAuth: {
      strict: values["strict-auth"] === true,
      ...(apiKey ? { apiKey } : {})
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", resolve);
  });

  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  process.stdout.write(`${JSON.stringify({
    ok: true,
    providers,
    host: "127.0.0.1",
    port: boundPort,
    baseUrl: `http://127.0.0.1:${boundPort}`,
    script: scriptPath
      ? {
          source: "file",
          path: scriptPath
        }
      : {
          source: "default",
          description: "built-in default final text"
        },
    requestLog: requestLogPath,
    auth: {
      strict: values["strict-auth"] === true,
      apiKeyConfigured: Boolean(apiKey)
    }
  })}\n`);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("--port must be an integer from 0 to 65535");
  }
  return port;
}

function printUsage(): void {
  process.stdout.write([
    "Usage:",
    "  mock-ai-provider serve --providers openai [--script <path>] [--port <number|0>] [--request-log <path>] [--strict-auth] [--api-key <key>]",
    ""
  ].join("\n"));
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
