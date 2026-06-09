import { and, eq, ne } from "drizzle-orm";
import type { Job } from "pg-boss";
import {
  allocatedPorts,
  cubeSnapshots,
  cubes,
  domainMappings,
  jobLogs,
  lifecycleLogs,
  memberCubeAssignments,
  tcpPortMappings,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { chargeProratedUsageWithAudit } from "@/lib/cost";
import { db } from "@/lib/db";
import { triggerCubeLifecycleEvent } from "@/lib/pusher";
import { reconcileServerResources } from "@/lib/server/allocate";
import { deregisterCubeCustomHostname } from "@/lib/server/cube-domain";
import { freeJailerUid } from "@/lib/server/jailer-uids";
import { clearNumaNode } from "@/lib/server/numa-nodes";
import {
  connectToServer,
  deleteCube,
  removeCustomDomainRoute,
  removeTcpPortForward,
} from "@/lib/ssh";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildCubeSummary } from "@/lib/webhook-payloads";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JobLogger } from "@/lib/worker/job-log";
import type { CubeDeletePayload } from "@/lib/worker/job-types";
import { JOB_NAMES } from "@/lib/worker/job-types";

async function handleCubeDeleteJob(job: Job<CubeDeletePayload>): Promise<void> {
  const { cubeId, spaceId, serverId } = job.data;
  const log = new JobLogger(job.id, "cube.delete", "cube", cubeId);
  console.log(`[cube-delete] starting for cubeId=${cubeId}`);
  await log.info("Cube deletion started");

  // 1. Load cube and check it's not already deleted
  const [preCube] = await db
    .select()
    .from(cubes)
    .where(and(eq(cubes.id, cubeId), ne(cubes.status, "deleted")))
    .limit(1);
  if (!preCube) {
    console.log(
      `[cube-delete] cube ${cubeId} not found or already deleted, skipping`
    );
    return;
  }

  // 1b. Charge prorated usage BEFORE marking as deleted.
  // chargeProratedUsage uses its own transaction with FOR UPDATE on the cube row,
  // which prevents concurrent hourly billing from double-charging. It also clears
  // lastBilledAt inside the lock window, so even if hourly billing runs between
  // this call and step 1c, it will see lastBilledAt=null and skip the cube.
  //
  // Failure is non-fatal (delete proceeds) but MUST be audit-logged — once the
  // cube is deleted we cannot retroactively bill for it (Fix #3 from billing
  // audit: cube-delete was the only catch block missing the audit row).
  if (preCube.lastBilledAt) {
    await chargeProratedUsageWithAudit(preCube, {
      flow: "delete",
      logPrefix: "[cube-delete]",
      metadata: { serverId },
    });
  }

  // 1c. Atomically claim the cube for deletion. We mark it `stopping`
  //     here (NOT `deleted` — see below) and clear `lastBilledAt` so the
  //     hourly billing cron stops counting it. The flip to `deleted`
  //     happens at the END of the handler, atomically with the
  //     server-resource decrement, so a partial-failure retry can
  //     re-run cleanup steps before the row becomes `deleted` and
  //     causes the early-return at step 1.
  //
  //     Accepting any non-`deleted` status here keeps a retry idempotent
  //     — a row that's already `stopping` (from a prior partial run, or
  //     from the customer-facing endpoint that wrote `stopping` before
  //     enqueueing this job) flows through unchanged.
  const [cube] = await db
    .update(cubes)
    .set({ status: "stopping", lastBilledAt: null, updatedAt: new Date() })
    .where(and(eq(cubes.id, cubeId), ne(cubes.status, "deleted")))
    .returning();
  if (!cube) {
    console.log(
      `[cube-delete] cube ${cubeId} was deleted concurrently, skipping`
    );
    return;
  }

  // 2. Load server and SSH key, open connection
  const { client } = await connectToServer(serverId);
  await log.info(`Connected to server ${serverId}`);

  try {
    // 3. Remove domain mappings: delete each Cloudflare Custom Hostname,
    //    remove the Caddy route(s), then hard-delete all domain rows.
    const allDomains = await db.query.domainMappings.findMany({
      where: eq(domainMappings.cubeId, cubeId),
    });
    if (allDomains.length > 0) {
      await log.info(`Removing ${allDomains.length} domain mapping(s)`);
    }
    for (const mapping of allDomains) {
      if (mapping.cloudflareHostnameId) {
        await deregisterCubeCustomHostname(mapping.cloudflareHostnameId).catch(
          (err) =>
            console.warn(
              `[cube-delete] failed to delete Custom Hostname ${mapping.domain}: ${err}`
            )
        );
      }
      await removeCustomDomainRoute(client, mapping.domain).catch((err) =>
        console.warn(
          `[cube-delete] failed to remove route ${mapping.domain}: ${err}`
        )
      );
    }
    await db.delete(domainMappings).where(eq(domainMappings.cubeId, cubeId));

    // 3b. Remove all TCP port mappings (iptables rules + DB records)
    const allTcpMappings = await db.query.tcpPortMappings.findMany({
      where: eq(tcpPortMappings.cubeId, cubeId),
    });
    for (const mapping of allTcpMappings) {
      if (!cube.internalIp) {
        continue;
      }
      try {
        await removeTcpPortForward(
          client,
          mapping.hostPort,
          cube.internalIp,
          mapping.cubePort
        );
      } catch (err) {
        // Don't silently swallow: a removal that fails (e.g. the host is
        // unreachable at delete time) can leave a stale DNAT for this host
        // port. That is no longer a correctness risk — addTcpPortForward
        // flushes any stale rule when the port is reused — but AUDIT it so the
        // operator can see a leftover rule may exist instead of it vanishing
        // into a console.warn. The delete must still proceed (we cannot block
        // a customer's delete on an unreachable host).
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(
          `[cube-delete] failed to remove TCP mapping host port ${mapping.hostPort}: ${reason}`
        );
        audit({
          action: "cube.port_cleanup_failed",
          category: "cube",
          actorType: "system",
          entityType: "cube",
          entityId: cubeId,
          spaceId,
          description: `Failed to remove iptables DNAT for host port ${mapping.hostPort} during delete — a stale rule may persist on server ${serverId}; it is flushed automatically when the port is next reused.`,
          metadata: {
            serverId,
            hostPort: mapping.hostPort,
            cubePort: mapping.cubePort,
            error: reason,
          },
          source: "worker",
        });
      }
    }

    // 4. Delete all TCP mapping records (clears FK to allocated_ports)
    await db.delete(tcpPortMappings).where(eq(tcpPortMappings.cubeId, cubeId));

    // 5. Delete Cube (kill Firecracker process, remove TAP device, remove disk)
    await log.info("Destroying Firecracker VM, TAP device, and disk");
    await deleteCube(
      client,
      cubeId,
      cube.internalIp ?? undefined,
      cube.launchMode
    ).catch((err) => {
      console.warn(`[cube-delete] failed to delete Cube process/disk: ${err}`);
    });

    // 6. Free all allocated ports for this cube
    await db.delete(allocatedPorts).where(eq(allocatedPorts.cubeId, cubeId));

    // 7. Wipe the cube's restic snapshot repository.
    //
    //    Under restic, every snapshot for this cube lives in a single
    //    per-cube repo on S3 at `<env>/snapshot-repos/<cubeId>/`. The
    //    repo stores deduplicated chunks shared across all snapshots,
    //    so per-snapshot deletion would require running `restic
    //    forget --prune` per snapshot — wasteful when we're tearing
    //    everything down. Instead we enqueue ONE `storage.cleanup`
    //    job per active backend using prefix-sweep mode: each handler
    //    lists everything under `<env>/snapshot-repos/<cubeId>/` and
    //    bulk-deletes. Backends that don't hold this cube's repo
    //    return zero listed objects and complete as a cheap no-op.
    //
    //    We sweep EVERY active backend (not just those referenced by
    //    surviving `cube_snapshots` rows) because:
    //      a) `restic forget --prune` of all snapshots leaves the repo
    //         scaffolding (`config`, `keys/`, `index/`) on S3 even
    //         after the last snapshot row is removed — without the
    //         unconditional sweep, a cube whose user deleted every
    //         snapshot before deleting the cube would leak those
    //         objects forever.
    //      b) `cubes.snapshotRepoPasswordEnc IS NOT NULL` is the
    //         canonical signal that this cube ever had a repo; we
    //         sweep based on it, not on `cube_snapshots`.
    //
    //    Backups are intentionally NOT touched here: a pre-deletion
    //    backup is meant to survive the cube's deletion.
    const snapshotCount = await db
      .select({ id: cubeSnapshots.id })
      .from(cubeSnapshots)
      .where(eq(cubeSnapshots.cubeId, cubeId))
      .then((rows) => rows.length);
    if (cube.snapshotRepoPasswordEnc) {
      const { getResticRepoKeyPrefix } = await import("@/lib/storage/restic");
      const { env: envModule } = await import("@/lib/env");
      const { storageBackends } = await import("@/db/schema");
      const repoPrefix = `${getResticRepoKeyPrefix(cubeId, envModule.NODE_ENV)}/`;
      const activeBackends = await db
        .select({ id: storageBackends.id })
        .from(storageBackends)
        .where(eq(storageBackends.isActive, true));
      for (const { id: storageBackendId } of activeBackends) {
        await enqueueJob(JOB_NAMES.STORAGE_CLEANUP, {
          storagePrefix: repoPrefix,
          storageBackendId,
          reason: `Cube ${cubeId} deleted — wipe restic repo prefix`,
        });
      }
      console.log(
        `[cube-delete] queued repo-prefix sweep on ${activeBackends.length} backend(s) for cubeId=${cubeId} (${snapshotCount} snapshot row(s))`
      );
      await log.info(
        `Queued restic repo wipe across ${activeBackends.length} active backend(s)${snapshotCount > 0 ? ` (${snapshotCount} snapshot row(s))` : ""}`
      );
    } else if (snapshotCount > 0) {
      // Defensive: snapshot rows present but no repo password — should
      // never happen (snapshot.create lazily generates the password
      // before its first restic call), but log it so it's visible if
      // the invariant ever breaks.
      await log.warn(
        `${snapshotCount} snapshot row(s) present but cube has no snapshot repo password — restic chunks cannot be auto-cleaned`
      );
    }
    if (snapshotCount > 0) {
      await db.delete(cubeSnapshots).where(eq(cubeSnapshots.cubeId, cubeId));
    }

    // 8. Remove member cube assignments pointing to this cube
    await db
      .delete(memberCubeAssignments)
      .where(eq(memberCubeAssignments.cubeId, cubeId));

    // 10. Atomic finalization: rebuild server allocation counters + flip
    //     cube to `deleted` in ONE transaction, gated on the cube still
    //     being `stopping`. This is what makes the whole handler retry-safe —
    //     if any prior step threw, we re-enter from the top, re-run
    //     cleanup (every step above is idempotent), and only get here
    //     once. The atomic `RETURNING` on the status flip prevents a
    //     double server-resource decrement: a second arrival sees
    //     status=`deleted` and the UPDATE returns no rows, so the
    //     reconcile is skipped and we exit early without re-emitting
    //     lifecycle/webhook/audit events.
    //
    //     `reconcileServerResources` rebuilds counters from the cube rows
    //     (excluding `deleted`/`error`), which is correct whether the cube
    //     was `running` or `sleeping` when delete was triggered — the prior
    //     cube-sleep handler may have already released this cube's CPU+RAM,
    //     and a manual `srv.allocatedCpus - cube.vcpus` decrement would
    //     over-subtract in that case.
    const finalized = await db.transaction(async (tx) => {
      const [flipped] = await tx
        .update(cubes)
        .set({ status: "deleted", updatedAt: new Date() })
        .where(and(eq(cubes.id, cubeId), eq(cubes.status, "stopping")))
        .returning({ id: cubes.id });
      if (!flipped) {
        return false;
      }
      // Reclaim the per-server jailer uid (null it out) so the lowest-free-uid
      // allocator can reuse it — freeJailerUid was documented as a delete-time
      // call site but was never wired in, so uids leaked monotonically upward
      // on long-lived hosts. NULLs are constraint-distinct, so this is safe
      // under cubes_server_id_jailer_uid_uniq.
      await freeJailerUid(tx, cubeId);
      // L2: drop the NUMA-node assignment (defense-in-depth; the assignNumaNode
      // load tally already excludes deleted cubes, but keep the row honest).
      await clearNumaNode(tx, cubeId);
      await reconcileServerResources(tx, serverId);
      return true;
    });

    if (!finalized) {
      console.log(
        `[cube-delete] cube ${cubeId} already finalized by a concurrent run — skipping lifecycle/audit emission`
      );
      return;
    }

    // 11. Write lifecycle log (status now `deleted` after the atomic flip above)
    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `Cube successfully deleted${snapshotCount > 0 ? ` (${snapshotCount} snapshot(s) cleaned up)` : ""}`,
    });

    // 12. Fire Pusher event + outbound webhooks
    await triggerCubeLifecycleEvent(cubeId, spaceId, { status: "deleted" });
    dispatchWebhookEvent(spaceId, "cube.deleted", {
      cube: buildCubeSummary({ ...cube, status: "deleted" }),
    });

    audit({
      action: "cube.delete_complete",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: "Cube successfully deleted",
      metadata: { serverId, cubeName: cube.name },
      source: "worker",
    });

    console.log(`[cube-delete] completed cubeId=${cubeId}`);
    await log.info("Cube deletion complete");

    // Purge all job_logs for this cube — the cube row is now `deleted` and the
    // detail page is no longer reachable, so live-stream logs serve no purpose.
    // Audit history is preserved separately in `audit_logs` and `lifecycle_logs`.
    // This includes the rows we just wrote in this handler; that's intentional.
    await db
      .delete(jobLogs)
      .where(and(eq(jobLogs.entityType, "cube"), eq(jobLogs.entityId, cubeId)))
      .catch((err) => {
        console.warn(
          `[cube-delete] failed to purge job_logs for cubeId=${cubeId}:`,
          err
        );
      });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[cube-delete] failed cubeId=${cubeId}:`, err);
    await log.error(`Cube deletion failed: ${reason}`);
    throw err;
  } finally {
    client.end();
  }
}

export async function handleCubeDelete(
  jobs: Job<CubeDeletePayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleCubeDeleteJob(job);
  }
}
