import { and, eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import {
  cubes,
  lifecycleLogs,
  tcpMappingWhitelistedIps,
  tcpPortMappings,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { triggerEvent } from "@/lib/pusher";
import { addTcpPortForward, connectToServer } from "@/lib/ssh";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildTcpMappingPayload } from "@/lib/webhook-payloads";
import { JobLogger } from "@/lib/worker/job-log";
import type { TcpMappingAddPayload } from "@/lib/worker/job-types";

async function handleTcpMappingAddJob(
  job: Job<TcpMappingAddPayload>
): Promise<void> {
  const {
    mappingId,
    cubeId,
    serverId,
    cubePort,
    hostPort,
    cubeInternalIp,
    whitelistedCidrs,
  } = job.data;
  const log = new JobLogger(job.id, "tcp-mapping.add", "cube", cubeId);
  console.log(
    `[tcp-mapping-add] starting for cubePort=${cubePort} hostPort=${hostPort} cubeId=${cubeId}`
  );
  await log.info(
    `Adding TCP mapping host:${hostPort} → ${cubeInternalIp}:${cubePort}`
  );

  // 1. Load mapping — idempotent check
  const mapping = await db.query.tcpPortMappings.findFirst({
    where: eq(tcpPortMappings.id, mappingId),
  });
  if (!mapping) {
    console.log(`[tcp-mapping-add] mapping ${mappingId} not found, skipping`);
    return;
  }
  if (mapping.status !== "pending") {
    console.log(
      `[tcp-mapping-add] mapping ${mappingId} not pending (status=${mapping.status}), skipping`
    );
    return;
  }

  // 2. Load server and connect
  const { client } = await connectToServer(serverId);

  try {
    // 3. Add iptables rules
    await addTcpPortForward(
      client,
      hostPort,
      cubeInternalIp,
      cubePort,
      whitelistedCidrs
    );

    // 4. Update mapping status (conditional: only if still pending)
    const [updated] = await db
      .update(tcpPortMappings)
      .set({ status: "active", updatedAt: new Date() })
      .where(
        and(
          eq(tcpPortMappings.id, mappingId),
          eq(tcpPortMappings.status, "pending")
        )
      )
      .returning({ id: tcpPortMappings.id });

    if (!updated) {
      console.log(
        `[tcp-mapping-add] mapping ${mappingId} no longer pending after iptables setup, skipping`
      );
      return;
    }

    // 5. Write lifecycle log
    const label = mapping.label ? ` (${mapping.label})` : "";
    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `TCP port ${cubePort} mapped to host port ${hostPort}${label}`,
    });

    // 6. Load whitelist for response
    const whitelist = await db.query.tcpMappingWhitelistedIps.findMany({
      where: eq(tcpMappingWhitelistedIps.mappingId, mappingId),
    });

    // 7. Fire Pusher event
    await triggerEvent(`private-cube-${cubeId}`, "tcp-mapping.update", {
      mappingId,
      cubePort,
      hostPort,
      label: mapping.label,
      status: "active",
      whitelistedIps: whitelist.map((w) => w.cidr),
    });

    audit({
      action: "tcp_mapping.add_complete",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cubeId,
      description: `TCP port mapping added: cubePort=${cubePort} hostPort=${hostPort}`,
      metadata: { cubePort, hostPort, cubeId },
      source: "worker",
    });

    const [cube] = await db
      .select({ spaceId: cubes.spaceId })
      .from(cubes)
      .where(eq(cubes.id, cubeId))
      .limit(1);
    if (cube?.spaceId) {
      dispatchWebhookEvent(cube.spaceId, "tcp_mapping.added", {
        mapping: buildTcpMappingPayload(
          { ...mapping, status: "active" },
          whitelist.map((w) => w.cidr)
        ),
      });
    }

    console.log(
      `[tcp-mapping-add] completed cubePort=${cubePort} hostPort=${hostPort} cubeId=${cubeId}`
    );
    await log.info(
      `TCP mapping host:${hostPort} → ${cubeInternalIp}:${cubePort} active`
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[tcp-mapping-add] failed cubePort=${cubePort}:`, err);
    await log.error(`TCP mapping add failed: ${reason}`);

    // Clean up the failed mapping and free the allocated port so the user can retry
    if (mapping) {
      const { allocatedPorts } = await import("@/db/schema");
      await db
        .transaction(async (tx) => {
          await tx
            .delete(tcpPortMappings)
            .where(eq(tcpPortMappings.id, mappingId));
          if (mapping.allocatedPortId) {
            await tx
              .delete(allocatedPorts)
              .where(eq(allocatedPorts.id, mapping.allocatedPortId));
          }
        })
        .catch((cleanupErr) => {
          console.error("[tcp-mapping-add] cleanup failed:", cleanupErr);
        });
    }

    await db
      .insert(lifecycleLogs)
      .values({
        entityType: "cube",
        entityId: cubeId,
        message: `TCP mapping :${cubePort} failed: ${err instanceof Error ? err.message : String(err)}`,
      })
      .catch(() => {});

    // Don't rethrow — mapping is cleaned up, no point retrying
  } finally {
    client.end();
  }
}

export async function handleTcpMappingAdd(
  jobs: Job<TcpMappingAddPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleTcpMappingAddJob(job);
  }
}
