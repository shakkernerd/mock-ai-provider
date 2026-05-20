import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let defaultImage: Buffer | null = null;
let defaultVideo: Buffer | null = null;
const defaultAudio = new Map<string, Buffer>();

export function readDefaultImage(): Buffer {
  defaultImage ??= readFileSync(resolve(packageRoot(), "media/default-image.png"));
  return defaultImage;
}

export function readDefaultAudio(format: string): Buffer {
  const normalized = normalizeAudioFormat(format);
  const cached = defaultAudio.get(normalized);
  if (cached) {
    return cached;
  }
  const audio = readFileSync(resolve(packageRoot(), `media/default-audio.${normalized}`));
  defaultAudio.set(normalized, audio);
  return audio;
}

export function readDefaultVideo(): Buffer {
  defaultVideo ??= readFileSync(resolve(packageRoot(), "media/default-video.mp4"));
  return defaultVideo;
}

export function normalizeAudioFormat(format: string): string {
  return format === "mpeg" ? "mp3" : format;
}

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
}
