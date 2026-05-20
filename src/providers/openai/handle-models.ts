import type { ServerResponse } from "node:http";
import { openAiResponseHeaders } from "./headers.js";
import { findOpenAiModel, type OpenAiModel } from "./model-catalog.js";
import { writeJson } from "../../shared/http.js";

export type OpenAiModelsRouteResult = {
  status: number;
  model: string | null;
  bodyBytes: number;
  errorClass: string | null;
  responseBody: unknown;
};

export function handleOpenAiModels(params: {
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
  catalog: readonly OpenAiModel[];
  modelId?: string;
}): OpenAiModelsRouteResult {
  const headers = openAiResponseHeaders({
    requestId: params.requestId,
    receivedAtEpochMs: params.receivedAtEpochMs
  });
  if (params.modelId) {
    const model = findOpenAiModel(params.catalog, params.modelId);
    if (!model) {
      const body = {
        error: {
          message: `The model '${params.modelId}' does not exist or you do not have access to it.`,
          type: "invalid_request_error",
          param: "model",
          code: "model_not_found"
        }
      };
      writeJson(params.res, 404, {
        ...body
      }, headers);
      return {
        status: 404,
        model: params.modelId,
        bodyBytes: 0,
        errorClass: "invalid_request_error",
        responseBody: body
      };
    }

    writeJson(params.res, 200, model, headers);
    return {
      status: 200,
      model: model.id,
      bodyBytes: 0,
      errorClass: null,
      responseBody: model
    };
  }

  const body = {
    object: "list",
    data: params.catalog
  };
  writeJson(params.res, 200, body, headers);
  return {
    status: 200,
    model: null,
    bodyBytes: 0,
    errorClass: null,
    responseBody: body
  };
}
