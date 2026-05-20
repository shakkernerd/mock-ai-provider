import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let defaultImage: Buffer | null = null;

export function readDefaultImage(): Buffer {
  defaultImage ??= readFileSync(resolve(packageRoot(), "media/default-image.png"));
  return defaultImage;
}

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}
