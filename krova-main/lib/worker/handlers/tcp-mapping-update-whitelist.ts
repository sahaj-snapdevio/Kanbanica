import { eq } from "drizzle-orm";
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
import { connectToServer, updateTcpWhitelist } from "@/lib/ssh";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildTcpMappingPayload } from "@/lib/webhook-payloads";
import { JobLogger } from "@/lib/worker/job-log";
import type { TcpMappingUpdateWhitelistPayload } from "@/lib/worker/job-types";

async function handleTcpMappingUpdateWhitelistJob(
  job: Job<TcpMappingUpdateWhitelistPayload>
): Promise<void> {
  const { mappingId, cubeId, serverId, hostPort, whitelistedCidrs } = job.data;
  const log = new JobLogger(
    job.id,
    "tcp-mapping.update-whitelist",
    "cube",
    cubeId
  );
  console.log(
    `[tcp-mapping-whitelist] starting for hostPort=${hostPort} cubeId=${cubeId}`
  );
  await log.info(
    `Updating whitelist for host:${hostPort} (${whitelistedCidrs.length} CIDR${whitelistedCidrs.length === 1 ? "" : "s"})`
  );

  // 1. Load mapping — idempotent check
  const mapping = await db.query.tcpPortMappings.findFirst({
    where: eq(tcpPortMappings.id, mappingId),
  });
  if (mapping?.status !== "active") {
    console.log(
      `[tcp-mapping-whitelist] mapping ${mappingId} not active, skipping`
    );
    return;
  }

  // Load the cube's internal IP — the whitelist FORWARD rules match the
  // POST-DNAT packet (cubeInternalIp + cubePort), not the host port.
  const [cubeRow] = await db
    .select({ internalIp: cubes.internalIp })
    .from(cubes)
    .where(eq(cubes.id, cubeId))
    .limit(1);
  if (!cubeRow?.internalIp) {
    throw new Error(
      `Cannot update whitelist for cube ${cubeId}: no internal IP on record`
    );
  }

  // 2. Load server and connect
  const { client } = await connectToServer(serverId);

  try {
    // 3. Update iptables whitelist rules (match the cube address + port)
    await updateTcpWhitelist(
      client,
      hostPort,
      cubeRow.internalIp,
      mapping.cubePort,
      whitelistedCidrs
    );

    // 4. Write lifecycle log
    const msg =
      whitelistedCidrs.length > 0
        ? `TCP port ${hostPort} whitelist updated: ${whitelistedCidrs.join(", ")}`
        : `TCP port ${hostPort} whitelist cleared (publicly accessible)`;
    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: msg,
    });

    // 5. Load current whitelist for response
    const whitelist = await db.query.tcpMappingWhitelistedIps.findMany({
      where: eq(tcpMappingWhitelistedIps.mappingId, mappingId),
    });

    // 6. Fire Pusher event
    await triggerEvent(`private-cube-${cubeId}`, "tcp-mapping.update", {
      mappingId,
      hostPort,
      status: "active",
      whitelistedIps: whitelist.map((w) => w.cidr),
    });

    audit({
      action: "tcp_mapping.whitelist_updated",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cubeId,
      description:
        whitelistedCidrs.length > 0
          ? `TCP port ${hostPort} whitelist updated`
          : `TCP port ${hostPort} whitelist cleared`,
      metadata: { hostPort, whitelistedCidrs },
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
          mapping,
          whitelist.map((w) => w.cidr)
        ),
        change: { kind: "whitelist" },
      });
    }

    console.log(
      `[tcp-mapping-whitelist] completed hostPort=${hostPort} cubeId=${cubeId}`
    );
    await log.info(`Whitelist for host:${hostPort} updated`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[tcp-mapping-whitelist] failed hostPort=${hostPort}:`, err);
    await log.error(`Whitelist update failed: ${reason}`);
    throw err;
  } finally {
    client.end();
  }
}

export async function handleTcpMappingUpdateWhitelist(
  jobs: Job<TcpMappingUpdateWhitelistPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleTcpMappingUpdateWhitelistJob(job);
  }
}
