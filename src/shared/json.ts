export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseJsonObject(text: string): JsonRecord {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) {
    throw new Error("expected JSON object");
  }
  return parsed;
}

export function readString(value: JsonRecord, key: string): string | undefined {
  const raw = value[key];
  return typeof raw === "string" ? raw : undefined;
}
