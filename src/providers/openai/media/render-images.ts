import { readString, type JsonRecord } from "../../../shared/json.js";
import { readDefaultImage } from "./assets.js";

export type OpenAiImageRenderResult = {
  body: JsonRecord;
  model: string;
  imageCount: number;
};

export function renderImageGeneration(requestBody: JsonRecord): OpenAiImageRenderResult {
  const prompt = readString(requestBody, "prompt");
  if (!prompt) {
    throw Object.assign(new Error("prompt must be a non-empty string"), {
      statusCode: 400,
      errorType: "invalid_request_error"
    });
  }
  return renderImageResponse({
    requestBody,
    prompt,
    defaultModel: "gpt-image-2",
    defaultResponseFormat: "b64_json"
  });
}

export function renderImageEdit(requestBody: JsonRecord): OpenAiImageRenderResult {
  const prompt = readString(requestBody, "prompt");
  if (!prompt) {
    throw Object.assign(new Error("prompt must be a non-empty string"), {
      statusCode: 400,
      errorType: "invalid_request_error"
    });
  }
  return renderImageResponse({
    requestBody,
    prompt,
    defaultModel: "gpt-image-2",
    defaultResponseFormat: "b64_json"
  });
}

export function renderImageVariation(requestBody: JsonRecord): OpenAiImageRenderResult {
  return renderImageResponse({
    requestBody,
    prompt: readString(requestBody, "prompt") ?? "Mock AI Provider image variation",
    defaultModel: "dall-e-2",
    defaultResponseFormat: "url"
  });
}

function renderImageResponse(params: {
  requestBody: JsonRecord;
  prompt: string;
  defaultModel: string;
  defaultResponseFormat: "b64_json" | "url";
}): OpenAiImageRenderResult {
  const model = readString(params.requestBody, "model") ?? params.defaultModel;
  const count = readImageCount(params.requestBody.n);
  const responseFormat = readString(params.requestBody, "response_format") ?? params.defaultResponseFormat;
  const created = Math.floor(Date.now() / 1000);
  const imageBase64 = readDefaultImage().toString("base64");
  const data = Array.from({ length: count }, () => {
    if (responseFormat === "url") {
      return {
        url: "http://mock-ai-provider.local/media/default-image.png",
        revised_prompt: params.prompt
      };
    }
    return {
      b64_json: imageBase64,
      revised_prompt: params.prompt
    };
  });

  return {
    model,
    imageCount: count,
    body: {
      created,
      data
    }
  };
}

function readImageCount(value: unknown): number {
  if (value === undefined || value === null) {
    return 1;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 10) {
    throw Object.assign(new Error("n must be an integer from 1 to 10"), {
      statusCode: 400,
      errorType: "invalid_request_error"
    });
  }
  return value;
}
