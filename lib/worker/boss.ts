import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";
import { ensureJobQueues } from "@/lib/worker/ensure-queues";
import { JOB_NAMES } from "@/lib/worker/job-types";

export const boss = new PgBoss(env.DATABASE_URL);

let initialized = false;

async function initializeBoss(): Promise<void> {
  if (initialized) return;

  boss.on("error", (error) => {
    console.error("[worker] pg-boss error", error);
  });

  await ensureJobQueues(boss);
  initialized = true;
}

async function startBossWithRetry(maxRetries = 10): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await boss.start();
      console.log("[worker] pg-boss started");
      return;
    } catch (err) {
      console.error(
        `[worker] pg-boss start failed (attempt ${attempt}/${maxRetries}):`,
        err instanceof Error ? err.message : err
      );
      if (attempt === maxRetries) {
        throw new Error(`pg-boss failed to start after ${maxRetries} attempts`);
      }
      const delay = Math.min(2000 * 2 ** (attempt - 1), 30_000);
      console.log(`[worker] retrying in ${delay / 1000}s...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

export async function startWorker(): Promise<void> {
  await startBossWithRetry();
  await initializeBoss();

  const { handleSendEmail } = await import("@/lib/worker/handlers/send-email");
  const { handleWorkspaceDelete } = await import("@/lib/worker/handlers/workspace-delete");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await boss.work(JOB_NAMES.SEND_EMAIL, { includeMetadata: true }, handleSendEmail as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await boss.work(JOB_NAMES.WORKSPACE_DELETE, { includeMetadata: true }, handleWorkspaceDelete as any);

  // ── Recurring cron schedules ──────────────────────────────────────────────
  // Add cron jobs here as your app grows, e.g.:
  // await boss.schedule(JOB_NAMES.REPORT_GENERATE, "0 9 * * 1"); // Mondays 09:00

  console.log("[worker] all handlers registered");
}

const SHUTDOWN_TIMEOUT_MS = 30 * 1000;

export async function stopWorker(timeoutMs = SHUTDOWN_TIMEOUT_MS): Promise<void> {
  console.log(`[worker] shutting down (graceful, timeout=${timeoutMs / 1000}s)...`);
  await boss.stop({ graceful: true, timeout: timeoutMs, close: true });
  console.log("[worker] stopped");
}

export async function enqueue<T extends object>(
  jobName: string,
  data: T,
  options?: Parameters<typeof boss.send>[2]
): Promise<string | null> {
  return boss.send(jobName, data, options);
}
