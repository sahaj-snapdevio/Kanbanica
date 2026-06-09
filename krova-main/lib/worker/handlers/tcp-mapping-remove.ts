import { eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import {
  allocatedPorts,
  cubes,
  lifecycleLogs,
  tcpPortMappings,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { triggerEvent } from "@/lib/pusher";
import { connectToServer, removeTcpPortForward } from "@/lib/ssh";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildTcpMappingPayload } from "@/lib/webhook-payloads";
import { JobLogger } from "@/lib/worker/job-log";
import type { TcpMappingRemovePayload } from "@/lib/worker/job-types";

async function handleTcpMappingRemoveJob(
  job: Job<TcpMappingRemovePayload>
): Promise<void> {
  const { mappingId, cubeId, serverId, hostPort, cubeInternalIp } = job.data;
  const log = new JobLogger(job.id, "tcp-mapping.remove", "cube", cubeId);
  console.log(
    `[tcp-mapping-remove] starting for hostPort=${hostPort} cubeId=${cubeId}`
  );
  await log.info(`Removing TCP mapping host:${hostPort}`);

  // 1. Load mapping — idempotent check
  const mapping = await db.query.tcpPortMappings.findFirst({
    where: eq(tcpPortMappings.id, mappingId),
  });
  if (!mapping) {
    console.log(
      `[tcp-mapping-remove] mapping ${mappingId} not found, skipping`
    );
    return;
  }

  let client: Awaited<ReturnType<typeof connectToServer>>["client"] | null =
    null;

  try {
    // 2. Load server and connect
    const result = await connectToServer(serverId);
    client = result.client;

    // 3. Remove iptables rules
    await removeTcpPortForward(
      client,
      hostPort,
      cubeInternalIp,
      mapping.cubePort
    );

    // 4. Delete the mapping record (clears FK to allocated_ports)
    await db.delete(tcpPortMappings).where(eq(tcpPortMappings.id, mappingId));

    // 5. Free the allocated port
    if (mapping.allocatedPortId) {
      await db
        .delete(allocatedPorts)
        .where(eq(allocatedPorts.id, mapping.allocatedPortId));
    }

    // 6. Write lifecycle log
    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `TCP port mapping removed: host port ${hostPort}`,
    });

    // 7. Fire Pusher event
    await triggerEvent(`private-cube-${cubeId}`, "tcp-mapping.update", {
      mappingId,
      hostPort,
      status: "removed",
    });

    audit({
      action: "tcp_mapping.remove_complete",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cubeId,
      description: `TCP port mapping removed: hostPort=${hostPort}`,
      metadata: { hostPort, cubeId },
      source: "worker",
    });

    const [cube] = await db
      .select({ spaceId: cubes.spaceId })
      .from(cubes)
      .where(eq(cubes.id, cubeId))
      .limit(1);
    if (cube?.spaceId) {
      dispatchWebhookEvent(cube.spaceId, "tcp_mapping.removed", {
        mapping: buildTcpMappingPayload(mapping),
      });
    }

    console.log(
      `[tcp-mapping-remove] completed hostPort=${hostPort} cubeId=${cubeId}`
    );
    await log.info(`TCP mapping host:${hostPort} removed`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[tcp-mapping-remove] failed hostPort=${hostPort}:`, err);
    await log.error(`TCP mapping remove failed: ${reason}`);
    throw err;
  } finally {
    client?.end();
  }
}

export async function handleTcpMappingRemove(
  jobs: Job<TcpMappingRemovePayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleTcpMappingRemoveJob(job);
  }
}
