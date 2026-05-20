import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const REDACTED = "[redacted]";

export type RequestJournalEntry = {
  schemaVersion: "mock-ai-provider.request.v1";
  requestId: string;
  clientRequestId?: string;
  providerId: string | null;
  apiSurface: string | null;
  method: string;
  path: string;
  model: string | null;
  stream: boolean | null;
  receivedAt: string;
  receivedAtEpochMs: number;
  respondedAt: string;
  respondedAtEpochMs: number;
  durationMs: number;
  status: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  matchedScriptStep: string | null;
  responseType: string | null;
  toolCallsEmitted: number;
  finalTextEmitted: string | null;
  errorClass: string | null;
  bodyBytes: number;
  requestBody?: unknown;
  requestBodyRaw?: string;
  responseBody?: unknown;
  responseSummary?: unknown;
};

export type RequestJournal = {
  append(entry: RequestJournalEntry): void;
  list(options?: { limit?: number }): readonly RequestJournalEntry[];
  reset(): void;
  count(): number;
};

export function createRequestJournal(path: string): RequestJournal {
  mkdirSync(dirname(path), { recursive: true });
  const entries: RequestJournalEntry[] = [];
  return {
    append(entry) {
      const redacted = redactJournalEntry(entry);
      entries.push(redacted);
      appendFileSync(path, `${JSON.stringify(redacted)}\n`, "utf8");
    },
    list(options = {}) {
      const limit = options.limit;
      if (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0) {
        return entries;
      }
      return entries.slice(-limit);
    },
    reset() {
      entries.length = 0;
      writeFileSync(path, "", "utf8");
    },
    count() {
      return entries.length;
    }
  };
}

function redactJournalEntry(entry: RequestJournalEntry): RequestJournalEntry {
  return redactValue(entry) as RequestJournalEntry;
}

function redactValue(value: unknown, key?: string): unknown {
  if (key && isSensitiveKey(key)) {
    if (typeof value === "string" && value === "present") {
      return value;
    }
    return REDACTED;
  }
  if (typeof value === "string") {
    return key === "requestBodyRaw" ? redactRawText(value) : value;
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  const output: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    output[entryKey] = redactValue(entryValue, entryKey);
  }
  return output;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized === "authorization"
    || normalized === "proxyauthorization"
    || normalized === "apikey"
    || normalized === "token"
    || normalized === "accesstoken"
    || normalized === "refreshtoken"
    || normalized === "idtoken"
    || normalized === "clientsecret"
    || normalized === "privatekey"
    || normalized === "password"
    || normalized === "passwd"
    || normalized === "credential"
    || normalized.endsWith("apikey")
    || normalized.endsWith("token")
    || normalized.includes("secret")
    || normalized.includes("password")
    || normalized.includes("privatekey")
    || normalized.includes("credential");
}

function redactRawText(value: string): string {
  return value
    .replace(/((?:authorization|proxy-authorization)["']?\s*[:=]\s*["']?)Bearer\s+[^"',\s}]+/gi, `$1Bearer ${REDACTED}`)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`)
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|password|secret|token)["']?\s*[:=]\s*["']?)([^"',\s}]+)/gi, `$1${REDACTED}`);
}
