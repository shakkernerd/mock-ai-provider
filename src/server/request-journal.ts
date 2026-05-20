import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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
      entries.push(entry);
      appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
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
