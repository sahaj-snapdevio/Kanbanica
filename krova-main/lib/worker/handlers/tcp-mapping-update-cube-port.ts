/**
 * Atomically migrate the SSH mapping's `cubePort` from `oldCubePort` to
 * `newCubePort` on the bare-metal host: delete the OLD iptables DNAT rule,
 * add the NEW one, then flip the DB row to `active`.
 *
 * This handler replaces a previous "enqueue REMOVE then enqueue ADD" flow
 * that was structurally broken:
 *   - REMOVE deletes the mapping row + frees the allocated_port, leaving
 *     ADD nothing to act on; ADD short-circuits when the row is missing.
 *   - The DB row was updated to the NEW port BEFORE REMOVE fired, so
 *     REMOVE's lookup of `mapping.cubePort` returned the NEW port and tried
 *     to delete a rule that didn't exist while the OLD rule remained
 *     forever as an orphan.
 *   - pg-boss doesn't guarantee FIFO across distinct queues, so ADD could
 *     even fire BEFORE REMOVE.
 *
 * Doing the entire swap in ONE handler eliminates the race window. Both
 * `addTcpPortForward` and `removeTcpPortForward` are already idempotent
 * via the `iptables -C` check-then-act wrappers in `lib/ssh/network.ts`,
 * so a retry of this whole handler is safe: removing an already-gone rule
 * no-ops, and adding an already-present rule no-ops.
 *
 * The handler's contract:
 *   1. Connect to the cube's server.
 *   2. `removeTcpPortForward(hostPort, internalIp, oldCubePort)` — drop
 *      the OLD DNAT + MASQUERADE rules.
 *   3. `addTcpPortForward(hostPort, internalIp, newCubePort, cidrs)` —
 *      install the NEW DNAT + MASQUERADE rules, preserving the whitelist.
 *   4. Update `tcp_port_mappings.cubePort = newCubePort, status = 'active'`
 *      conditionally on the row still being `pending`. If a concurrent
 *      action flipped the row to anything else (deleted, disabled, etc.),
 *      we leave the row alone and the iptables swap stands.
 *
 * Customer-facing impact during the swap: a brief outage on external SSH
 * while the OLD rule is gone and the NEW rule isn't installed yet — both
 * iptables operations run on a single SSH connection, so the window is
 * sub-second under normal conditions.
 */

import { and, eq } from "drizzle-orm";
import type { JobWithMetadata } from "pg-boss";
import type { Client } from "ssh2";
import { cubes, lifecycleLogs, tcpPortMappings } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { triggerEvent } from "@/lib/pusher";
import {
  addTcpPortForward,
  connectToServer,
  removeTcpPortForward,
} from "@/lib/ssh";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildTcpMappingPayload } from "@/lib/webhook-payloads";
import { JobLogger } from "@/lib/worker/job-log";
import type { TcpMappingUpdateCubePortPayload } from "@/lib/worker/job-types";

async function handleJob(
  job: JobWithMetadata<TcpMappingUpdateCubePortPayload>
): Promise<void> {
  const {
    mappingId,
    cubeId,
    serverId,
    hostPort,
    cubeInternalIp,
    oldCubePort,
    newCubePort,
    whitelistedCidrs,
    actorId,
    actorEmail,
  } = job.data;

  const log = new JobLogger(
    job.id,
    "tcp-mapping.update-cube-port",
    "cube",
    cubeId
  );

  console.log(
    `[tcp-mapping-update-cube-port] starting mapping=${mappingId} ${oldCubePort} → ${newCubePort}`
  );
  await log.info(
    `Swapping SSH iptables rule: host:${hostPort} → ${cubeInternalIp}:${oldCubePort} ⇒ ${newCubePort}`
  );

  // Defensive: if the mapping row was deleted (cube delete in flight, etc.)
  // there's nothing to swap. The OLD rule will be cleaned up by the cube
  // delete handler.
  const mapping = await db.query.tcpPortMappings.findFirst({
    where: eq(tcpPortMappings.id, mappingId),
  });
  if (!mapping) {
    console.log(
      `[tcp-mapping-update-cube-port] mapping ${mappingId} no longer exists, skipping`
    );
    await log.warn("Mapping row no longer exists, skipping swap");
    return;
  }

  // Idempotent short-circuit on retry: the row may already be active with
  // the new port (from a successful prior run that crashed after the iptables
  // swap but before reporting completion).
  if (mapping.cubePort === newCubePort && mapping.status === "active") {
    console.log(
      `[tcp-mapping-update-cube-port] mapping ${mappingId} already at ${newCubePort}, skipping`
    );
    await log.info("Mapping already at the new port, nothing to do");
    return;
  }

  let clientForCleanup: Client | undefined;

  try {
    const { client } = await connectToServer(serverId);
    clientForCleanup = client;

    await log.step(
      `Remove old SSH DNAT host:${hostPort} → ${cubeInternalIp}:${oldCubePort}`,
      async () => {
        await removeTcpPortForward(
          client,
          hostPort,
          cubeInternalIp,
          oldCubePort
        );
      }
    );

    await log.step(
      `Add new SSH DNAT host:${hostPort} → ${cubeInternalIp}:${newCubePort}`,
      async () => {
        await addTcpPortForward(
          client,
          hostPort,
          cubeInternalIp,
          newCubePort,
          whitelistedCidrs
        );
      }
    );

    // Flip the row to active conditionally. Concurrent state (cube delete,
    // mapping remove) may have already mutated it — in that case the
    // iptables rules we just installed will be cleaned up by whichever
    // handler owns that flow.
    const [updated] = await db
      .update(tcpPortMappings)
      .set({
        cubePort: newCubePort,
        status: "active",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tcpPortMappings.id, mappingId),
          eq(tcpPortMappings.status, "pending")
        )
      )
      .returning({ id: tcpPortMappings.id });

    if (!updated) {
      console.log(
        `[tcp-mapping-update-cube-port] mapping ${mappingId} no longer pending — iptables swap left in place, DB not touched`
      );
      await log.warn(
        "Mapping row no longer pending after iptables swap; leaving DB state to the concurrent owner"
      );
      return;
    }

    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `SSH internal port updated: ${oldCubePort} → ${newCubePort} (host:${hostPort})`,
    });

    await triggerEvent(`private-cube-${cubeId}`, "tcp-mapping.update", {
      mappingId,
      cubePort: newCubePort,
      hostPort,
      status: "active",
      whitelistedIps: whitelistedCidrs,
    });

    audit({
      action: "tcp_mapping.update_cube_port_complete",
      category: "tcp_mapping",
      actorType: actorId ? "user" : "system",
      actorId: actorId ?? undefined,
      actorEmail: actorEmail ?? undefined,
      entityType: "tcp_mapping",
      entityId: mappingId,
      description: `SSH cube port swapped from ${oldCubePort} to ${newCubePort} on host:${hostPort}`,
      metadata: {
        cubeId,
        mappingId,
        hostPort,
        oldCubePort,
        newCubePort,
      },
      source: "worker",
    });

    const [cube] = await db
      .select({ spaceId: cubes.spaceId })
      .from(cubes)
      .where(eq(cubes.id, cubeId))
      .limit(1);
    if (cube?.spaceId) {
      dispatchWebhookEvent(cube.spaceId, "tcp_mapping.updated", {
        mapping: buildTcpMappingPayload(
          { ...mapping, cubePort: newCubePort, status: "active" },
          whitelistedCidrs
        ),
        change: { kind: "cube_port", from: oldCubePort, to: newCubePort },
      });
    }

    console.log(
      `[tcp-mapping-update-cube-port] completed mapping=${mappingId} ${oldCubePort} → ${newCubePort}`
    );
    await log.info(
      `SSH iptables rule swapped: host:${hostPort} → ${cubeInternalIp}:${newCubePort}`
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[tcp-mapping-update-cube-port] failed mapping=${mappingId}:`,
      err
    );
    await log.error(`SSH port swap failed: ${reason}`);

    // Final-attempt recovery. The PATCH endpoint set the row to `pending`
    // before enqueue, and a `pending` row makes the SSH-port endpoint return
    // 409 — so a host that stays unreachable across all retries would lock the
    // customer out of EVER changing the SSH port again. On the FINAL attempt,
    // restore the row to active+oldCubePort (the swap didn't complete) so the
    // gate clears and the customer can retry. A connect failure never touched
    // the OLD iptables rule, so SSH still works on the old port; a partial-swap
    // failure leaves SSH degraded but the reachability cron surfaces it and a
    // retried change re-runs the idempotent swap. Only touch a still-`pending`
    // row so we don't clobber a concurrent change.
    // pg-boss v12: retryCount/retryLimit come off JobWithMetadata (this queue
    // is registered with `includeMetadata: true` in boss.ts) — no hardcoded
    // limit to keep in sync with QUEUE_OPTIONS.
    const retryCount = job.retryCount;
    const retryLimit = job.retryLimit;
    if (retryCount >= retryLimit) {
      await db
        .update(tcpPortMappings)
        .set({ cubePort: oldCubePort, status: "active", updatedAt: new Date() })
        .where(
          and(
            eq(tcpPortMappings.id, mappingId),
            eq(tcpPortMappings.status, "pending")
          )
        )
        .catch(() => {});
      await log.warn(
        `SSH port swap failed after ${retryLimit + 1} attempts — reverted the mapping to active on port ${oldCubePort} so it can be retried`
      );
      return;
    }

    // Re-throw so pg-boss schedules a retry per the queue's retryLimit.
    // The iptables wrappers are check-then-act, so the next attempt
    // safely re-tries whichever step blew up without dirtying the host.
    throw err;
  } finally {
    clientForCleanup?.end();
  }
}

export async function handleTcpMappingUpdateCubePort(
  jobs: JobWithMetadata<TcpMappingUpdateCubePortPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleJob(job);
  }
}
