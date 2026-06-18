import { existsSync } from "node:fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

async function main() {
  await import("@/lib/env");
  const { startWorker, stopWorker } = await import("@/lib/worker/boss");

  console.log("Starting KANBANICA background worker...");
  await startWorker();

  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`[worker] received ${signal}; draining jobs`);
    await stopWorker();
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  console.error("Worker failed to start:", error);
  process.exit(1);
});
