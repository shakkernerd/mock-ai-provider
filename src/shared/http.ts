import type { IncomingMessage, ServerResponse } from "node:http";

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export async function readRequestBody(
  req: IncomingMessage,
  maxBytes = DEFAULT_MAX_BODY_BYTES
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw Object.assign(new Error("request body too large"), { statusCode: 413 });
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readRequestBuffer(
  req: IncomingMessage,
  maxBytes = DEFAULT_MAX_BODY_BYTES
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw Object.assign(new Error("request body too large"), { statusCode: 413 });
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function writeJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  const payload = `${JSON.stringify(body)}\n`;
  res.writeHead(statusCode, {
    ...corsHeaders(),
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(payload)),
    ...headers
  });
  res.end(payload);
}

export function writeNoContent(
  res: ServerResponse,
  statusCode: number,
  headers: Record<string, string> = {}
): void {
  res.writeHead(statusCode, {
    ...corsHeaders(),
    ...headers
  });
  res.end();
}

export function writeBinary(
  res: ServerResponse,
  statusCode: number,
  body: Buffer,
  headers: Record<string, string> = {}
): void {
  res.writeHead(statusCode, {
    ...corsHeaders(),
    "content-length": String(body.length),
    ...headers
  });
  res.end(body);
}

export function writeText(
  res: ServerResponse,
  statusCode: number,
  body: string,
  headers: Record<string, string> = {}
): void {
  const payload = Buffer.from(body, "utf8");
  res.writeHead(statusCode, {
    ...corsHeaders(),
    "content-type": "text/plain; charset=utf-8",
    "content-length": String(payload.length),
    ...headers
  });
  res.end(payload);
}

export function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "DELETE,GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-client-request-id",
    "access-control-expose-headers": [
      "x-request-id",
      "openai-processing-ms",
      "openai-version",
      "x-ratelimit-limit-requests",
      "x-ratelimit-limit-tokens",
      "x-ratelimit-remaining-requests",
      "x-ratelimit-remaining-tokens",
      "x-ratelimit-reset-requests",
      "x-ratelimit-reset-tokens"
    ].join(", ")
  };
}

export function requestPath(req: IncomingMessage): string {
  const rawUrl = req.url ?? "/";
  return new URL(rawUrl, "http://mock-ai-provider.local").pathname;
}

export function firstHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" ? value : undefined;
}
