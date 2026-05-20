import type { ServerResponse } from "node:http";

export function writeSseJson(res: ServerResponse, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function writeSseDone(res: ServerResponse): void {
  res.write("data: [DONE]\n\n");
}
