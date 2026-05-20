import { randomUUID } from "node:crypto";

export function createRequestId(): string {
  return `req_${randomUUID().replaceAll("-", "")}`;
}

export function createChatCompletionId(): string {
  return `chatcmpl_${randomUUID().replaceAll("-", "")}`;
}

export function createToolCallId(): string {
  return `call_${randomUUID().replaceAll("-", "")}`;
}

export function createResponseId(): string {
  return `resp_${randomUUID().replaceAll("-", "")}`;
}

export function createResponseItemId(): string {
  return `msg_${randomUUID().replaceAll("-", "")}`;
}

export function createEventId(): string {
  return `event_${randomUUID().replaceAll("-", "")}`;
}
