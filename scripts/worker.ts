import { existsSync } from "fs";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
} else if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

async function main() {
  // Validate env vars before starting — fail fast on missing config
  await import("@/lib/env");

  const { startWorker, stopWorker } = await import("@/lib/worker/boss");

  console.log("Starting background worker...");
  await startWorker();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      console.log(`[worker] received ${signal} again, already draining — ignoring`);
      return;
    }
    shuttingDown = true;
    console.log(`[worker] received ${signal} — draining in-flight jobs`);
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
