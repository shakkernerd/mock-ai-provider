import type { ServerResponse } from "node:http";
import { findOpenAiModel, OPENAI_MODEL_CATALOG } from "./model-catalog.js";
import { writeJson } from "../../shared/http.js";

export type OpenAiModelsRouteResult = {
  status: number;
  model: string | null;
  bodyBytes: number;
  errorClass: string | null;
};

export function handleOpenAiModels(params: {
  res: ServerResponse;
  requestId: string;
  modelId?: string;
}): OpenAiModelsRouteResult {
  if (params.modelId) {
    const model = findOpenAiModel(params.modelId);
    if (!model) {
      writeJson(params.res, 404, {
        error: {
          message: `The model '${params.modelId}' does not exist or you do not have access to it.`,
          type: "invalid_request_error",
          param: "model",
          code: "model_not_found"
        }
      }, {
        "x-request-id": params.requestId
      });
      return {
        status: 404,
        model: params.modelId,
        bodyBytes: 0,
        errorClass: "invalid_request_error"
      };
    }

    writeJson(params.res, 200, model, {
      "x-request-id": params.requestId
    });
    return {
      status: 200,
      model: model.id,
      bodyBytes: 0,
      errorClass: null
    };
  }

  writeJson(params.res, 200, {
    object: "list",
    data: OPENAI_MODEL_CATALOG
  }, {
    "x-request-id": params.requestId
  });
  return {
    status: 200,
    model: null,
    bodyBytes: 0,
    errorClass: null
  };
}
