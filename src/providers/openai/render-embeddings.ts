import { createHash } from "node:crypto";
import { readString, type JsonRecord } from "../../shared/json.js";

export type OpenAiEmbeddingsRenderResult = {
  body: JsonRecord;
  model: string;
  inputCount: number;
};

export function renderEmbeddings(requestBody: JsonRecord): OpenAiEmbeddingsRenderResult {
  const model = readString(requestBody, "model") ?? "text-embedding-3-small";
  const inputs = readEmbeddingInputs(requestBody.input);
  const dimensions = readDimensions(requestBody.dimensions, model);
  const encodingFormat = readString(requestBody, "encoding_format") ?? "float";
  if (encodingFormat !== "float" && encodingFormat !== "base64") {
    throw Object.assign(new Error("encoding_format must be 'float' or 'base64'"), {
      statusCode: 400,
      errorType: "invalid_request_error"
    });
  }

  return {
    model,
    inputCount: inputs.length,
    body: {
      object: "list",
      data: inputs.map((input, index) => ({
        object: "embedding",
        index,
        embedding: encodingFormat === "base64"
          ? encodeEmbeddingBase64(createEmbeddingVector(input, dimensions))
          : createEmbeddingVector(input, dimensions)
      })),
      model,
      usage: {
        prompt_tokens: estimatePromptTokens(inputs),
        total_tokens: estimatePromptTokens(inputs)
      }
    }
  };
}

function readEmbeddingInputs(value: unknown): string[] {
  if (typeof value === "string") {
    if (value.length === 0) {
      throw Object.assign(new Error("input must not be empty"), {
        statusCode: 400,
        errorType: "invalid_request_error"
      });
    }
    return [value];
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw Object.assign(new Error("input must be a string or non-empty array"), {
      statusCode: 400,
      errorType: "invalid_request_error"
    });
  }
  return value.map((item, index) => {
    if (typeof item === "string") {
      if (item.length === 0) {
        throw Object.assign(new Error(`input[${index}] must not be empty`), {
          statusCode: 400,
          errorType: "invalid_request_error"
        });
      }
      return item;
    }
    if (Array.isArray(item) && item.every((token) => Number.isInteger(token))) {
      return item.join(" ");
    }
    throw Object.assign(new Error(`input[${index}] must be a string or token array`), {
      statusCode: 400,
      errorType: "invalid_request_error"
    });
  });
}

function readDimensions(value: unknown, model: string): number {
  if (value === undefined || value === null) {
    return model === "text-embedding-3-large" ? 3072 : 1536;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 3072) {
    throw Object.assign(new Error("dimensions must be an integer from 1 to 3072"), {
      statusCode: 400,
      errorType: "invalid_request_error"
    });
  }
  return value;
}

function createEmbeddingVector(input: string, dimensions: number): number[] {
  const vector: number[] = [];
  let block = 0;
  while (vector.length < dimensions) {
    const digest = createHash("sha256").update(input).update(":").update(String(block)).digest();
    for (const byte of digest) {
      vector.push(Number(((byte / 127.5) - 1).toFixed(6)));
      if (vector.length === dimensions) {
        break;
      }
    }
    block += 1;
  }
  return vector;
}

function encodeEmbeddingBase64(vector: readonly number[]): string {
  const buffer = Buffer.allocUnsafe(vector.length * 4);
  vector.forEach((value, index) => {
    buffer.writeFloatLE(value, index * 4);
  });
  return buffer.toString("base64");
}

function estimatePromptTokens(inputs: readonly string[]): number {
  return inputs.reduce((total, input) => total + Math.max(1, Math.ceil(input.length / 4)), 0);
}
