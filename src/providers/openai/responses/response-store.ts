import type { JsonRecord } from "../../../shared/json.js";

export type OpenAiStoredResponse = {
  body: JsonRecord;
  inputItems: JsonRecord[];
};

export type OpenAiResponseStore = {
  save(requestBody: JsonRecord, responseBody: JsonRecord): void;
  retrieve(id: string): OpenAiStoredResponse | null;
  delete(id: string): boolean;
  cancel(id: string): JsonRecord | null;
  inputItems(id: string): JsonRecord[] | null;
};

export function createOpenAiResponseStore(): OpenAiResponseStore {
  const responses = new Map<string, OpenAiStoredResponse>();
  return {
    save(requestBody, responseBody) {
      const id = typeof responseBody.id === "string" ? responseBody.id : null;
      if (!id || requestBody.store === false) {
        return;
      }
      responses.set(id, {
        body: responseBody,
        inputItems: readInputItems(requestBody.input)
      });
    },
    retrieve(id) {
      return responses.get(id) ?? null;
    },
    delete(id) {
      return responses.delete(id);
    },
    cancel(id) {
      const stored = responses.get(id);
      if (!stored) {
        return null;
      }
      const cancelled = {
        ...stored.body,
        status: "cancelled"
      };
      responses.set(id, {
        ...stored,
        body: cancelled
      });
      return cancelled;
    },
    inputItems(id) {
      return responses.get(id)?.inputItems ?? null;
    }
  };
}

function readInputItems(input: unknown): JsonRecord[] {
  if (typeof input === "string") {
    return [
      {
        id: "input_0",
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: input
          }
        ]
      }
    ];
  }
  if (Array.isArray(input)) {
    return input.filter((item): item is JsonRecord => item !== null && typeof item === "object" && !Array.isArray(item));
  }
  return [];
}
