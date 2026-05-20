import type { Server } from "node:http";

export async function listen(server: Server, options: { port: number; host: string }): Promise<{ port: number }> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(formatListenError(error, options));
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.port, options.host);
  });

  const address = server.address();
  return {
    port: typeof address === "object" && address ? address.port : options.port
  };
}

export function installShutdownHandlers(server: Server): void {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      server.close(() => {
        process.exit(0);
      });
    });
  }
}

function formatListenError(error: NodeJS.ErrnoException, options: { port: number; host: string }): Error {
  if (error.code === "EADDRINUSE") {
    return new Error(`port ${options.port} is already in use on ${options.host}`);
  }
  return error;
}
