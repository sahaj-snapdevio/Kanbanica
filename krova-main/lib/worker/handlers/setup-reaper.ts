/**
 * Periodic auto-recovery for setup phases stuck at `setupStatus="running"`.
 *
 * If the worker process dies mid-handler (OOM, crash, deploy), the row stays
 * at "running" forever. pg-boss expires the job internally but doesn't
 * touch our DB. Operator would otherwise have to manually reset the row.
 *
 * This reaper runs every 5 minutes and flips any setupStatus="running" row
 * whose setupStartedAt is older than STALE_THRESHOLD_MS to "failed" with a
 * clear message + audit log + Pusher notify.
 */

import { and, eq, lt } from "drizzle-orm";
import * as schema from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { triggerEvent } from "@/lib/pusher";

// 1 hour — chosen to comfortably exceed the longest expected legitimate phase
// (server.pull-images: expireInSeconds=3600). If a phase is genuinely
// running for >1h without progress, it's wedged.
const STALE_THRESHOLD_MS = 60 * 60 * 1000;

export async function handleSetupReaper(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

  const stuck = await db
    .select({
      id: schema.servers.id,
      hostname: schema.servers.hostname,
      setupPhase: schema.servers.setupPhase,
      setupStartedAt: schema.servers.setupStartedAt,
    })
    .from(schema.servers)
    .where(
      and(
        eq(schema.servers.setupStatus, "running"),
        lt(schema.servers.setupStartedAt, cutoff)
      )
    );

  if (stuck.length === 0) {
    return;
  }

  for (const s of stuck) {
    const ageMs = s.setupStartedAt
      ? Date.now() - s.setupStartedAt.getTime()
      : 0;
    const message = `Phase "${s.setupPhase}" was stuck running for ${Math.round(ageMs / 60_000)} minutes — likely worker crash or network drop. Auto-reset by reaper. Inspect job_logs for last activity, then retry.`;

    await db
      .update(schema.servers)
      .set({
        setupStatus: "failed",
        setupError: message,
        setupStartedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.servers.id, s.id));

    await triggerEvent(`private-server-${s.id}`, "setup.update", {
      serverId: s.id,
    });

    audit({
      action: "server.setup.reaped",
      category: "server",
      actorType: "system",
      entityType: "server",
      entityId: s.id,
      description: `Reaper reset stuck setup phase for "${s.hostname}" — phase=${s.setupPhase}, age=${Math.round(ageMs / 60_000)}m`,
      metadata: {
        phase: s.setupPhase,
        ageMs,
      },
      source: "worker",
    });

    console.log(
      `[setup-reaper] reset stuck phase for ${s.hostname} (${s.id}, phase=${s.setupPhase}, age=${ageMs}ms)`
    );
  }
}
