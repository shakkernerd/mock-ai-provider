import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { listen } from "../src/server/listen.js";

describe("server listen helper", () => {
  it("reports port-in-use errors clearly", async () => {
    const first = createServer((_req, res) => res.end("ok"));
    const second = createServer((_req, res) => res.end("ok"));
    try {
      const bound = await listen(first, { port: 0, host: "127.0.0.1" });
      await expect(listen(second, { port: bound.port, host: "127.0.0.1" }))
        .rejects
        .toThrow(`port ${bound.port} is already in use on 127.0.0.1`);
    } finally {
      await close(first);
      await close(second);
    }
  });
});

async function close(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
