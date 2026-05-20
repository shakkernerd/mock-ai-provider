import { createFineTuningEventId, createFineTuningJobId } from "../../../shared/ids.js";
import { isRecord, readString, type JsonRecord } from "../../../shared/json.js";

export type OpenAiFineTuningJob = {
  id: string;
  object: "fine_tuning.job";
  created_at: number;
  finished_at: number | null;
  model: string;
  fine_tuned_model: string | null;
  organization_id: string;
  result_files: string[];
  status: "validating_files" | "cancelled";
  validation_file: string | null;
  training_file: string;
  hyperparameters: JsonRecord;
  trained_tokens: number | null;
  error: null;
  integrations: unknown[];
  seed: number | null;
  estimated_finish: number | null;
};

export type OpenAiFineTuningStore = {
  create(requestBody: JsonRecord): OpenAiFineTuningJob;
  list(): OpenAiFineTuningJob[];
  retrieve(id: string): OpenAiFineTuningJob | null;
  cancel(id: string): OpenAiFineTuningJob | null;
  listEvents(id: string): JsonRecord[] | null;
  listCheckpoints(id: string): JsonRecord[] | null;
};

export function createOpenAiFineTuningStore(): OpenAiFineTuningStore {
  const jobs = new Map<string, OpenAiFineTuningJob>();
  return {
    create(requestBody) {
      const job = createFineTuningJob(requestBody);
      jobs.set(job.id, job);
      return job;
    },
    list() {
      return [...jobs.values()].sort((left, right) => right.created_at - left.created_at);
    },
    retrieve(id) {
      return jobs.get(id) ?? null;
    },
    cancel(id) {
      const job = jobs.get(id);
      if (!job) {
        return null;
      }
      const cancelled = {
        ...job,
        status: "cancelled",
        finished_at: Math.floor(Date.now() / 1000)
      } satisfies OpenAiFineTuningJob;
      jobs.set(id, cancelled);
      return cancelled;
    },
    listEvents(id) {
      const job = jobs.get(id);
      if (!job) {
        return null;
      }
      return [
        {
          id: createFineTuningEventId(),
          object: "fine_tuning.job.event",
          created_at: job.created_at,
          level: "info",
          message: "Mock fine-tuning job created.",
          type: "message",
          data: null
        }
      ];
    },
    listCheckpoints(id) {
      return jobs.has(id) ? [] : null;
    }
  };
}

function createFineTuningJob(requestBody: JsonRecord): OpenAiFineTuningJob {
  const model = readString(requestBody, "model");
  const trainingFile = readString(requestBody, "training_file");
  if (!model) {
    throw new Error("model must be a non-empty string");
  }
  if (!trainingFile) {
    throw new Error("training_file must be a non-empty string");
  }
  const now = Math.floor(Date.now() / 1000);
  const seed = requestBody.seed;
  return {
    id: createFineTuningJobId(),
    object: "fine_tuning.job",
    created_at: now,
    finished_at: null,
    model,
    fine_tuned_model: null,
    organization_id: "org-mock",
    result_files: [],
    status: "validating_files",
    validation_file: readString(requestBody, "validation_file") ?? null,
    training_file: trainingFile,
    hyperparameters: isRecord(requestBody.hyperparameters) ? requestBody.hyperparameters : {},
    trained_tokens: null,
    error: null,
    integrations: Array.isArray(requestBody.integrations) ? requestBody.integrations : [],
    seed: typeof seed === "number" && Number.isInteger(seed) ? seed : null,
    estimated_finish: null
  };
}
