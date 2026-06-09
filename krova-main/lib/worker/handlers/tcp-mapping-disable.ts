import { and, eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import { lifecycleLogs, tcpPortMappings } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { triggerEvent } from "@/lib/pusher";
import { connectToServer, removeTcpPortForward } from "@/lib/ssh";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildTcpMappingPayload } from "@/lib/webhook-payloads";
import { JobLogger } from "@/lib/worker/job-log";
import type { TcpMappingDisablePayload } from "@/lib/worker/job-types";

/**
 * Remove the iptables DNAT/MASQUERADE rules for a TCP mapping but keep the
 * mapping row, its allocated port, and any whitelisted CIDRs intact. Used to
 * let customers temporarily disable SSH (or future TCP) exposure without
 * losing their allocated host port.
 */
async function handleTcpMappingDisableJob(
  job: Job<TcpMappingDisablePayload>
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

  const log = new JobLogger(job.id, "tcp-mapping.disable", "cube", cubeId);
  console.log(
    `[tcp-mapping-disable] starting for hostPort=${hostPort} cubeId=${cubeId}`
  );
  await log.info(`Disabling TCP mapping host:${hostPort}`);

  const mapping = await db.query.tcpPortMappings.findFirst({
    where: eq(tcpPortMappings.id, mappingId),
  });
  if (!mapping) {
    console.log(
      `[tcp-mapping-disable] mapping ${mappingId} not found, skipping`
    );
    return;
  }

  // Idempotent: if already disabled, skip.
  if (mapping.status === "disabled") {
    console.log(
      `[tcp-mapping-disable] mapping ${mappingId} already disabled, skipping`
    );
    return;
  }

  if (mapping.status !== "active") {
    console.log(
      `[tcp-mapping-disable] mapping ${mappingId} not active (status=${mapping.status}), skipping`
    );
    return;
  }

  const { client } = await connectToServer(serverId);

  try {
    await removeTcpPortForward(client, hostPort, cubeInternalIp, cubePort);

    const [updated] = await db
      .update(tcpPortMappings)
      .set({ status: "disabled", updatedAt: new Date() })
      .where(
        and(
          eq(tcpPortMappings.id, mappingId),
          eq(tcpPortMappings.status, "active")
        )
      )
      .returning({ id: tcpPortMappings.id });

    if (!updated) {
      console.log(
        `[tcp-mapping-disable] mapping ${mappingId} no longer active after iptables removal`
      );
      return;
    }

    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: mapping.isSsh
        ? `SSH access disabled (host port ${hostPort} no longer exposed)`
        : `TCP port mapping disabled: host port ${hostPort}`,
    });

    await triggerEvent(`private-cube-${cubeId}`, "tcp-mapping.update", {
      mappingId,
      hostPort,
      status: "disabled",
    });

    audit({
      action: mapping.isSsh
        ? "tcp_mapping.ssh_disable_complete"
        : "tcp_mapping.disable_complete",
      category: "tcp_mapping",
      actorType: actorId ? "user" : "system",
      actorId: actorId ?? null,
      actorEmail: actorEmail ?? null,
      entityType: "tcp_mapping",
      entityId: mappingId,
      spaceId,
      description: mapping.isSsh
        ? `SSH exposure disabled on host port ${hostPort}`
        : `TCP mapping disabled on host port ${hostPort}`,
      metadata: { cubeId, mappingId, hostPort, cubePort, isSsh: mapping.isSsh },
      source: "worker",
    });

    dispatchWebhookEvent(spaceId, "tcp_mapping.updated", {
      mapping: buildTcpMappingPayload({ ...mapping, status: "disabled" }),
      change: { kind: "disabled" },
    });

    console.log(
      `[tcp-mapping-disable] completed hostPort=${hostPort} cubeId=${cubeId}`
    );
    await log.info(`TCP mapping host:${hostPort} disabled`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[tcp-mapping-disable] failed hostPort=${hostPort}:`, err);
    await log.error(`TCP mapping disable failed: ${reason}`);
    throw err;
  } finally {
    client.end();
  }
}

export async function handleTcpMappingDisable(
  jobs: Job<TcpMappingDisablePayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleTcpMappingDisableJob(job);
  }
}
