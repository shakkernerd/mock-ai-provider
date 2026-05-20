export type Timestamp = {
  iso: string;
  epochMs: number;
};

export function nowTimestamp(): Timestamp {
  const epochMs = Date.now();
  return {
    iso: new Date(epochMs).toISOString(),
    epochMs
  };
}

export function durationMs(startEpochMs: number, endEpochMs = Date.now()): number {
  return Math.max(0, endEpochMs - startEpochMs);
}
