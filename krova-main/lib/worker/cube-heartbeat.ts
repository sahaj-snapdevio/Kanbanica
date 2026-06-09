import { eq } from "drizzle-orm";
import { cubes } from "@/db/schema";
import { db } from "@/lib/db";

/**
 * Pulses `cubes.updatedAt` at a regular interval while async work runs.
 *
 * `cube.stale-check` (lib/worker/handlers/cube-stale-check.ts) marks any
 * cube in `pending|booting|stopping` whose `updatedAt` is older than
 * 10 minutes as stuck, then enqueues `cube.delete`. Handlers doing long
 * storage backend transfers (backup-create's compress+upload, backup-redeploy's
 * download+decompress) can legitimately keep the cube in one of those
 * statuses for >10 minutes on multi-GB rootfs, so they must heartbeat to
 * avoid being killed mid-flight (which races with `cube.delete` and
 * `rm -rf`s the in-flight rootfs file — see commit history).
 *
 * Pulse interval is 2 minutes — comfortably under the 10-minute stale
 * threshold so a single missed pulse (transient DB error) still leaves
 * >5 minutes of grace.
 */
export async function withCubeHeartbeat<T>(
  cubeId: string,
  fn: () => Promise<T>
): Promise<T> {
  const PULSE_INTERVAL_MS = 2 * 60 * 1000;
  const interval = setInterval(() => {
    db.update(cubes)
      .set({ updatedAt: new Date() })
      .where(eq(cubes.id, cubeId))
      .catch(() => {
        // Best-effort. The next pulse will retry; stale-check tolerates
        // one missed pulse within its 10-minute window.
      });
  }, PULSE_INTERVAL_MS);
  try {
    return await fn();
  } finally {
    clearInterval(interval);
  }
}
