import type { IncomingMessage, ServerResponse } from "node:http";
import { openAiResponseHeaders } from "./headers.js";
import { firstHeader, writeJson } from "../../../shared/http.js";

export type OpenAiAuthOptions = {
  strict: boolean;
  apiKey?: string;
};

export type OpenAiAuthResult = {
  ok: boolean;
  status?: number;
  errorClass?: string;
};

export function enforceOpenAiAuth(params: {
  req: IncomingMessage;
  res: ServerResponse;
  requestId: string;
  receivedAtEpochMs: number;
  auth: OpenAiAuthOptions;
}): OpenAiAuthResult {
  if (!params.auth.strict) {
    return { ok: true };
  }
  const authorization = firstHeader(params.req, "authorization");
  const token = readBearerToken(authorization);
  if (!token || (params.auth.apiKey && token !== params.auth.apiKey)) {
    writeJson(params.res, 401, {
      error: {
        message: "Incorrect API key provided.",
        type: "invalid_request_error",
        param: null,
        code: "invalid_api_key"
      }
    }, openAiResponseHeaders({
      requestId: params.requestId,
      receivedAtEpochMs: params.receivedAtEpochMs
    }));
    return {
      ok: false,
      status: 401,
      errorClass: "invalid_request_error"
    };
  }
  return { ok: true };
}

function readBearerToken(authorization: string | undefined): string | null {
  if (!authorization) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match ? match[1] ?? null : null;
}
