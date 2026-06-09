/**
 * Stuck-session reaper cron for `cube_terminal_sessions`.
 *
 * Why this exists:
 *   The cube.terminal-bridge handler wraps its main flow in
 *   try/catch/finally so finalize ALWAYS runs and the row never gets
 *   stuck in `running` — for any *software* failure path. There is one
 *   class of failure that bypass that net entirely: SIGKILL on the
 *   worker process (OOM, Docker stop -t 0, manual `kill -9`, host
 *   crash). The Node process never gets a chance to execute its finally
 *   block, so the row sits at `status='running'` indefinitely. A second
 *   bridge job for the same session can't run (singletonKey-collide on
 *   the sessionId), and the row counts toward the user's
 *   MAX_CONCURRENT_ACTIVE_PER_USER cap.
 *
 *   This reaper is the catch-all that handles those orphans. It runs
 *   every 5 minutes and transitions:
 *     - `running`  rows older than TERMINAL_SESSION_HARD_MS → `expired`
 *     - `pending`  rows older than 5 minutes                → `failed`
 *
 *   Reasoning for the `pending` sweep: a pending row that hasn't been
 *   claimed in 5 min means the worker was down when the session was
 *   created, OR pg-boss is wedged, OR a singletonKey-collision somehow
 *   blocked it. Either way, the customer's browser has long since
 *   given up; clean the row so MAX_CONCURRENT_ACTIVE_PER_USER doesn't
 *   permanently lock them out.
 *
 * Idempotency: pure UPDATE…WHERE…RETURNING; re-running on the same row
 * is a no-op because the second pass sees a terminal status.
 *
 * Audit: each reaped row writes a system audit-log entry so operators
 * can see how often / why this fires. If it fires frequently the worker
 * is crashing too often and needs investigation.
 */

import { and, eq, lt } from "drizzle-orm";
import { TERMINAL_SESSION_HARD_MS } from "@/config/platform";
import { cubeTerminalSessions } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

/** Pending rows older than this are reaped as `failed`. */
const PENDING_GRACE_MS = 5 * 60 * 1000;

export async function handleTerminalSessionReaper(): Promise<void> {
  const hardCutoff = new Date(Date.now() - TERMINAL_SESSION_HARD_MS);
  const pendingCutoff = new Date(Date.now() - PENDING_GRACE_MS);

  // Reap stuck `running` rows. The hard cutoff matches the bridge's own
  // hard-timeout — any row past it must have leaked because the bridge
  // process died without finalize.
  const reapedRunning = await db
    .update(cubeTerminalSessions)
    .set({
      status: "expired",
      endReason: "reaper_orphaned_running",
      endedAt: new Date(),
    })
    .where(
      and(
        eq(cubeTerminalSessions.status, "running"),
        lt(cubeTerminalSessions.startedAt, hardCutoff)
      )
    )
    .returning({
      id: cubeTerminalSessions.id,
      cubeId: cubeTerminalSessions.cubeId,
      spaceId: cubeTerminalSessions.spaceId,
    });

  // Reap stuck `pending` rows that no bridge ever claimed.
  const reapedPending = await db
    .update(cubeTerminalSessions)
    .set({
      status: "failed",
      endReason: "reaper_never_claimed",
      endedAt: new Date(),
    })
    .where(
      and(
        eq(cubeTerminalSessions.status, "pending"),
        lt(cubeTerminalSessions.createdAt, pendingCutoff)
      )
    )
    .returning({
      id: cubeTerminalSessions.id,
      cubeId: cubeTerminalSessions.cubeId,
      spaceId: cubeTerminalSessions.spaceId,
    });

  if (reapedRunning.length === 0 && reapedPending.length === 0) {
    return;
  }

  console.log(
    `[terminal-session-reaper] reaped ${reapedRunning.length} orphaned running + ${reapedPending.length} never-claimed pending`
  );

  // Audit each reap so operators can correlate frequent reaping with worker
  // crashes or pg-boss outages.
  for (const row of reapedRunning) {
    audit({
      action: "cube.terminal_session_reaped",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: row.cubeId,
      spaceId: row.spaceId,
      description: `Reaped orphaned running terminal session (>${TERMINAL_SESSION_HARD_MS / 1000 / 60}m old)`,
      metadata: {
        sessionId: row.id,
        reason: "orphaned_running",
      },
      source: "worker",
    });
  }
  for (const row of reapedPending) {
    audit({
      action: "cube.terminal_session_reaped",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: row.cubeId,
      spaceId: row.spaceId,
      description: `Reaped never-claimed pending terminal session (>${PENDING_GRACE_MS / 1000 / 60}m old)`,
      metadata: {
        sessionId: row.id,
        reason: "never_claimed",
      },
      source: "worker",
    });
  }

  // Best-effort cap on listing — used to keep the audit/log tail small
  // even if a worker disaster left hundreds of orphans.
  // (No-op if reapedRunning + reapedPending stays under ~50; we log
  // anyway because operators want to see the magnitude.)
  const totalReaped = reapedRunning.length + reapedPending.length;
  if (totalReaped > 50) {
    console.warn(
      `[terminal-session-reaper] LARGE BATCH: ${totalReaped} rows reaped in one sweep — investigate worker stability`
    );
  }
}
