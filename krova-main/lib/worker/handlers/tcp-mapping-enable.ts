import { and, eq, inArray } from "drizzle-orm";
import type { Job } from "pg-boss";
import {
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
import type { TcpMappingEnablePayload } from "@/lib/worker/job-types";

/**
 * Re-add the iptables DNAT/MASQUERADE rules for a previously disabled TCP
 * mapping. Reuses the same allocated host port and any stored whitelisted
 * CIDRs so the customer's connection string is preserved across toggles.
 */
async function handleTcpMappingEnableJob(
  job: Job<TcpMappingEnablePayload>
): Promise<void> {
  const {
    mappingId,
    cubeId,
    spaceId,
    serverId,
    hostPort,
    cubePort,
    cubeInternalIp,
    actorId,
    actorEmail,
  } = job.data;

  const log = new JobLogger(job.id, "tcp-mapping.enable", "cube", cubeId);
  console.log(
    `[tcp-mapping-enable] starting for hostPort=${hostPort} cubeId=${cubeId}`
  );
  await log.info(`Re-enabling TCP mapping host:${hostPort}`);

  const mapping = await db.query.tcpPortMappings.findFirst({
    where: eq(tcpPortMappings.id, mappingId),
  });
  if (!mapping) {
    console.log(
      `[tcp-mapping-enable] mapping ${mappingId} not found, skipping`
    );
    return;
  }

  // Idempotent: if already active, skip.
  if (mapping.status === "active") {
    console.log(
      `[tcp-mapping-enable] mapping ${mappingId} already active, skipping`
    );
    return;
  }

  if (!["disabled", "pending"].includes(mapping.status)) {
    console.log(
      `[tcp-mapping-enable] mapping ${mappingId} in unexpected status=${mapping.status}, skipping`
    );
    return;
  }

  // Load preserved whitelist
  const whitelistRows = await db.query.tcpMappingWhitelistedIps.findMany({
    where: eq(tcpMappingWhitelistedIps.mappingId, mappingId),
  });
  const whitelistedCidrs = whitelistRows.map((r) => r.cidr);

  const { client } = await connectToServer(serverId);

  try {
    await addTcpPortForward(
      client,
      hostPort,
      cubeInternalIp,
      cubePort,
      whitelistedCidrs
    );

    const [updated] = await db
      .update(tcpPortMappings)
      .set({ status: "active", updatedAt: new Date() })
      .where(
        and(
          eq(tcpPortMappings.id, mappingId),
          inArray(tcpPortMappings.status, ["disabled", "pending"])
        )
      )
      .returning({ id: tcpPortMappings.id });

    if (!updated) {
      console.log(
        `[tcp-mapping-enable] mapping ${mappingId} no longer in disabled/pending after iptables add`
      );
      return;
    }

    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: mapping.isSsh
        ? `SSH access enabled (host port ${hostPort} exposed)`
        : `TCP port mapping enabled: host port ${hostPort}`,
    });

    await triggerEvent(`private-cube-${cubeId}`, "tcp-mapping.update", {
      mappingId,
      cubePort,
      hostPort,
      label: mapping.label,
      status: "active",
      whitelistedIps: whitelistedCidrs,
    });

    audit({
      action: mapping.isSsh
        ? "tcp_mapping.ssh_enable_complete"
        : "tcp_mapping.enable_complete",
      category: "tcp_mapping",
      actorType: actorId ? "user" : "system",
      actorId: actorId ?? null,
      actorEmail: actorEmail ?? null,
      entityType: "tcp_mapping",
      entityId: mappingId,
      spaceId,
      description: mapping.isSsh
        ? `SSH exposure re-enabled on host port ${hostPort}`
        : `TCP mapping re-enabled on host port ${hostPort}`,
      metadata: {
        cubeId,
        mappingId,
        hostPort,
        cubePort,
        isSsh: mapping.isSsh,
        whitelistCount: whitelistedCidrs.length,
      },
      source: "worker",
    });

    dispatchWebhookEvent(spaceId, "tcp_mapping.updated", {
      mapping: buildTcpMappingPayload(
        { ...mapping, status: "active" },
        whitelistedCidrs
      ),
      change: { kind: "enabled" },
    });

    console.log(
      `[tcp-mapping-enable] completed hostPort=${hostPort} cubeId=${cubeId}`
    );
    await log.info(`TCP mapping host:${hostPort} re-enabled`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[tcp-mapping-enable] failed hostPort=${hostPort}:`, err);
    await log.error(`TCP mapping enable failed: ${reason}`);
    throw err;
  } finally {
    client.end();
  }
}

export async function handleTcpMappingEnable(
  jobs: Job<TcpMappingEnablePayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleTcpMappingEnableJob(job);
  }
}
