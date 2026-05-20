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

export function createVideoId(): string {
  return `video_${randomUUID().replaceAll("-", "")}`;
}

export function createFileId(): string {
  return `file-${randomUUID().replaceAll("-", "")}`;
}

export function createBatchId(): string {
  return `batch_${randomUUID().replaceAll("-", "")}`;
}

export function createModerationId(): string {
  return `modr-${randomUUID().replaceAll("-", "")}`;
}

export function createCompletionId(): string {
  return `cmpl-${randomUUID().replaceAll("-", "")}`;
}

export function createVectorStoreId(): string {
  return `vs_${randomUUID().replaceAll("-", "")}`;
}

export function createVectorStoreFileBatchId(): string {
  return `vsfb_${randomUUID().replaceAll("-", "")}`;
}

export function createUploadId(): string {
  return `upload_${randomUUID().replaceAll("-", "")}`;
}

export function createUploadPartId(): string {
  return `part_${randomUUID().replaceAll("-", "")}`;
}
