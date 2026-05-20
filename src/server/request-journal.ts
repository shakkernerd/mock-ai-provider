import { mkdirSync, appendFileSync } from "node:fs";
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
};

export function createRequestJournal(path: string): RequestJournal {
  mkdirSync(dirname(path), { recursive: true });
  return {
    append(entry) {
      appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
    }
  };
}
