import type { Server } from "node:http";
export function installShutdown(
  server: Server,
  closeDependencies: () => Promise<void>,
  beginDrain: () => void = () => undefined,
): void {
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    beginDrain();
    const deadline = setTimeout(() => process.exit(1), 10000);
    deadline.unref();
    server.close(() => {
      void closeDependencies()
        .then(() => clearTimeout(deadline))
        .catch(() => {
          process.exitCode = 1;
          clearTimeout(deadline);
        });
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
