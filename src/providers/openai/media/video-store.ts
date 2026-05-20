import { createVideoId } from "../../../shared/ids.js";

export type OpenAiVideoJob = {
  id: string;
  object: "video";
  model: string;
  status: "completed";
  progress: 100;
  created_at: number;
  completed_at: number;
  expires_at: number;
  size: string;
  seconds: string;
  quality: string;
  prompt: string;
  error: null;
};

export type OpenAiVideoStore = {
  create(params: {
    model: string;
    prompt: string;
    size: string;
    seconds: string;
    quality: string;
  }): OpenAiVideoJob;
  list(): readonly OpenAiVideoJob[];
  get(id: string): OpenAiVideoJob | null;
  delete(id: string): OpenAiVideoJob | null;
};

export function createOpenAiVideoStore(): OpenAiVideoStore {
  const jobs: OpenAiVideoJob[] = [];
  return {
    create(params) {
      const now = Math.floor(Date.now() / 1000);
      const job: OpenAiVideoJob = {
        id: createVideoId(),
        object: "video",
        model: params.model,
        status: "completed",
        progress: 100,
        created_at: now,
        completed_at: now,
        expires_at: now + 3600,
        size: params.size,
        seconds: params.seconds,
        quality: params.quality,
        prompt: params.prompt,
        error: null
      };
      jobs.unshift(job);
      return job;
    },
    list() {
      return jobs;
    },
    get(id) {
      return jobs.find((job) => job.id === id) ?? null;
    },
    delete(id) {
      const index = jobs.findIndex((job) => job.id === id);
      if (index < 0) {
        return null;
      }
      const [job] = jobs.splice(index, 1);
      return job ?? null;
    }
  };
}
