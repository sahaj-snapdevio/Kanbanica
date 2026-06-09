import { existsSync } from "fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

async function main() {
  // Validate environment variables before starting the worker — fail fast on missing/invalid config
  await import("@/lib/env");

  const { startWorker, stopWorker } = await import("@/lib/worker/boss");

  console.log("Starting Krova background worker...");
  await startWorker();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      console.log(
        `[worker] received ${signal} again, already draining — ignoring`
      );
      return;
    }
    shuttingDown = true;
    console.log(
      `[worker] received ${signal} — draining in-flight jobs (no new jobs will be picked up)`
    );
    try {
      await stopWorker();
      console.log("[worker] graceful shutdown complete");
      process.exit(0);
    } catch (err) {
      console.error("[worker] graceful shutdown failed:", err);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});
