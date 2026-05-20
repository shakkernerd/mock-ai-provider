import { readString, type JsonRecord } from "../../shared/json.js";
import { readDefaultImage } from "./media-assets.js";

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
  const model = readString(requestBody, "model") ?? "gpt-image-2";
  const count = readImageCount(requestBody.n);
  const responseFormat = readString(requestBody, "response_format");
  const created = Math.floor(Date.now() / 1000);
  const imageBase64 = readDefaultImage().toString("base64");
  const data = Array.from({ length: count }, () => {
    if (responseFormat === "url") {
      return {
        url: "http://mock-ai-provider.local/media/default-image.png",
        revised_prompt: prompt
      };
    }
    return {
      b64_json: imageBase64,
      revised_prompt: prompt
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
