import { randomUUID } from "node:crypto";

export function createRequestId(): string {
  return `req_${randomUUID().replaceAll("-", "")}`;
}

export function createChatCompletionId(): string {
  return `chatcmpl_${randomUUID().replaceAll("-", "")}`;
}
