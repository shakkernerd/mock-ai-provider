export function openAiResponseHeaders(params: {
  requestId: string;
  receivedAtEpochMs: number;
}): Record<string, string> {
  return {
    "x-request-id": params.requestId,
    "openai-processing-ms": String(Math.max(0, Date.now() - params.receivedAtEpochMs)),
    "openai-version": "2020-10-01",
    "x-ratelimit-limit-requests": "1000000",
    "x-ratelimit-limit-tokens": "100000000",
    "x-ratelimit-remaining-requests": "999999",
    "x-ratelimit-remaining-tokens": "99999999",
    "x-ratelimit-reset-requests": "0s",
    "x-ratelimit-reset-tokens": "0s"
  };
}
