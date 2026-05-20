import { createBatchId } from "../../shared/ids.js";

export type OpenAiBatchObject = {
  id: string;
  object: "batch";
  endpoint: string;
  errors: null;
  input_file_id: string;
  completion_window: string;
  status: "completed" | "cancelling";
  output_file_id: string | null;
  error_file_id: string | null;
  created_at: number;
  in_progress_at: number;
  expires_at: number;
  finalizing_at: number | null;
  completed_at: number | null;
  failed_at: null;
  expired_at: null;
  cancelling_at: number | null;
  cancelled_at: null;
  request_counts: {
    total: number;
    completed: number;
    failed: number;
  };
  metadata: Record<string, unknown> | null;
};

export type OpenAiBatchStore = {
  create(params: {
    inputFileId: string;
    endpoint: string;
    completionWindow: string;
    metadata?: Record<string, unknown> | null;
  }): OpenAiBatchObject;
  list(): readonly OpenAiBatchObject[];
  get(id: string): OpenAiBatchObject | null;
  cancel(id: string): OpenAiBatchObject | null;
};

export function createOpenAiBatchStore(): OpenAiBatchStore {
  const batches: OpenAiBatchObject[] = [];
  return {
    create(params) {
      const now = Math.floor(Date.now() / 1000);
      const batch: OpenAiBatchObject = {
        id: createBatchId(),
        object: "batch",
        endpoint: params.endpoint,
        errors: null,
        input_file_id: params.inputFileId,
        completion_window: params.completionWindow,
        status: "completed",
        output_file_id: null,
        error_file_id: null,
        created_at: now,
        in_progress_at: now,
        expires_at: now + 24 * 60 * 60,
        finalizing_at: now,
        completed_at: now,
        failed_at: null,
        expired_at: null,
        cancelling_at: null,
        cancelled_at: null,
        request_counts: { total: 0, completed: 0, failed: 0 },
        metadata: params.metadata ?? null
      };
      batches.unshift(batch);
      return batch;
    },
    list() {
      return batches;
    },
    get(id) {
      return batches.find((batch) => batch.id === id) ?? null;
    },
    cancel(id) {
      const batch = batches.find((candidate) => candidate.id === id);
      if (!batch) {
        return null;
      }
      batch.status = "cancelling";
      batch.cancelling_at = Math.floor(Date.now() / 1000);
      batch.completed_at = null;
      batch.finalizing_at = null;
      return batch;
    }
  };
}
