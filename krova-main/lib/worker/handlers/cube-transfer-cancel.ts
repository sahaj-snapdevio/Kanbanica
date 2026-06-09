/**
 * Cancel an in-progress cube transfer.
 *
 * Called after the API sets transferState="cancelling". Does best-effort
 * cleanup so the cube is left in a clean, usable state:
 *
 * 1. SSH to destination — kill Firecracker process (if any), remove the cube
 *    directory, clean up TAP device.
 * 2. Free any allocated_ports rows the transfer created on the destination.
 * 3. SSH to source — if the transfer had reached the cutover point and slept
 *    the source (transferState was "finalizing" when cancel was requested),
 *    wake the VM so the customer's cube comes back online.
 * 4. Reset transfer columns: transferState="failed", clear destination server
 *    and start time.
 */

import { and, eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import {
  cubes,
  domainMappings,
  lifecycleLogs,
  servers,
  sshKeys,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { triggerCubeLifecycleEvent } from "@/lib/pusher";
import { repointCubeDomainsToServer } from "@/lib/server/cube-domain";
import { revertMappingsToSourceServer } from "@/lib/server/ports";
import {
  createSshConnection,
  decryptPrivateKey,
  execCommand,
  removeCustomDomainRoute,
} from "@/lib/ssh";
import { wakeCube } from "@/lib/ssh/firecracker";
import { jailRoot } from "@/lib/ssh/jailer";
import { JobLogger } from "@/lib/worker/job-log";
import type { CubeTransferCancelPayload } from "@/lib/worker/job-types";
import { JOB_NAMES } from "@/lib/worker/job-types";

async function handleCubeTransferCancelJob(
  job: Job<CubeTransferCancelPayload>
): Promise<void> {
  const {
    cubeId,
    spaceId,
    sourceServerId,
    destinationServerId,
    previousTransferState,
    cubeStatusAtCancel,
    actorId,
    actorEmail,
  } = job.data;
  const log = new JobLogger(
    job.id,
    JOB_NAMES.CUBE_TRANSFER_CANCEL,
    "cube",
    cubeId
  );

  await log.info(`Transfer cancel initiated by ${actorEmail}`);

  const cube = await db.query.cubes.findFirst({ where: eq(cubes.id, cubeId) });
  if (!cube) {
    await log.error("Cube not found — nothing to clean up");
    return;
  }

  // Decide whether the source VM needs to be woken back up.
  //
  // The source is slept ONLY at the cutover step (cube-transfer.ts step 8b)
  // when `transferState` was already `finalizing`. So wake the source IFF
  // the transfer had reached `finalizing` AND the cube was `sleeping` at
  // the moment of cancel — that combination uniquely identifies the
  // "running pre-transfer → slept for cutover" path.
  //
  // The cancel API captures both `previousTransferState` and
  // `cubeStatusAtCancel` inside the same transaction that flipped
  // `transferState` to `cancelling`, so these two fields are guaranteed
  // consistent with each other. Without them we'd have to fall back to a
  // brittle heuristic that incorrectly wakes cubes the customer had
  // intentionally put to sleep before the transfer started (see audit H4,
  // 2026-05-24).
  //
  // Backwards compat: jobs enqueued before this payload extension existed
  // fall back to the old `cube.status === "sleeping" && transferState ===
  // "cancelling"` heuristic. The fallback over-wakes (the bug we're fixing)
  // but never leaves a customer's running cube offline.
  const shouldWakeSource =
    previousTransferState !== undefined && cubeStatusAtCancel !== undefined
      ? previousTransferState === "finalizing" &&
        cubeStatusAtCancel === "sleeping"
      : cube.status === "sleeping" && cube.transferState === "cancelling";

  // Step 8 of the transfer re-points each active custom domain's Cloudflare
  // origin to the DESTINATION before the flip (make-before-break). A cancel
  // that reached `finalizing` may have done so — restore those origins to the
  // source (the cube stays there) and drop the orphaned destination routes,
  // or the domain would resolve to the destination cube we're tearing down.
  // Only `finalizing` can have re-pointed; earlier states never touch routing.
  // Idempotent + best-effort, so over-running on a pre-re-point cancel is safe.
  const shouldRevertDomainRouting = previousTransferState === "finalizing";
  const activeDomains = shouldRevertDomainRouting
    ? await db
        .select({
          domain: domainMappings.domain,
          cloudflareHostnameId: domainMappings.cloudflareHostnameId,
        })
        .from(domainMappings)
        .where(
          and(
            eq(domainMappings.cubeId, cubeId),
            eq(domainMappings.status, "active")
          )
        )
    : [];

  // ── 1. Clean up destination ─────────────────────────────────────────────
  const destId = destinationServerId ?? cube.transferDestinationServerId;
  if (destId) {
    await log.step("Clean up destination server", async () => {
      const destServer = await db.query.servers.findFirst({
        where: eq(servers.id, destId),
      });
      if (!destServer) {
        await log.warn(
          "Destination server not found in DB — skipping SSH cleanup"
        );
        return;
      }

      const sshKey = await db.query.sshKeys.findFirst({
        where: eq(sshKeys.id, destServer.sshKeyId),
      });
      if (!sshKey) {
        await log.warn(
          "SSH key not found for destination server — skipping SSH cleanup"
        );
        return;
      }

      let dstClient: import("ssh2").Client | null = null;
      try {
        dstClient = await createSshConnection(
          destServer.publicIp,
          destServer.sshPort,
          decryptPrivateKey(sshKey.encryptedPrivateKey, env.APP_SECRET)
        );

        // Kill Firecracker process if it was started. This is a teardown of a
        // FRESHLY-created destination cube during a cancel — the destination's
        // actual on-host launch mode is not reliably reflected by the DB row at
        // this moment, so probe BOTH pid paths (jailed chroot first, then the
        // legacy bare path) per Pattern C. With JAILER_ENABLED=false the jailed
        // path simply doesn't exist and the second probe (the legacy path) is
        // byte-identical to the prior hardcoded command.
        await execCommand(
          dstClient,
          `PID=$(cat ${jailRoot(cubeId)}/firecracker.pid 2>/dev/null || cat /var/lib/krova/cubes/${cubeId}/firecracker.pid 2>/dev/null) && [ -n "$PID" ] && kill -9 "$PID" 2>/dev/null || true`,
          10_000
        ).catch(() => {});

        // Clean up TAP device
        await execCommand(
          dstClient,
          `IP=$(cat /var/lib/krova/cubes/${cubeId}/ip.txt 2>/dev/null | tr -d ' \\n\\r') && [ -n "$IP" ] && OCTET=$(echo "$IP" | cut -d. -f4) && [ -n "$OCTET" ] && ip link del "fc$OCTET" 2>/dev/null || true`,
          10_000
        ).catch(() => {});

        // Remove the cube directory AND the jail chroot. A jailed destination
        // boot lives at <JAILER_CHROOT_BASE>/firecracker/<id>/ (rootfs/kernel
        // hardlinked in) — wiping only /var/lib/krova/cubes/<id> left that
        // chroot orphaned on disk after a cancel. jailRoot(id) ends in `/root`;
        // strip it to get the chroot dir. Both rm'd in one command — the jail
        // path simply doesn't exist for a bare cube (no-op).
        const jailChrootDir = jailRoot(cubeId).replace(/\/root$/, "");
        await execCommand(
          dstClient,
          `rm -rf /var/lib/krova/cubes/${cubeId} ${jailChrootDir}`,
          60_000
        );

        await log.info(
          `Removed cube directory + jail chroot on destination ${destServer.hostname}`
        );

        // Drop the orphaned destination Caddy routes the transfer added in
        // step 8 (make-before-break). 404-tolerant — a no-op if never added.
        for (const d of activeDomains) {
          await removeCustomDomainRoute(dstClient, d.domain).catch(() => {});
        }
      } catch (err) {
        await log.warn(
          `SSH cleanup on destination failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        dstClient?.end();
      }
    });

    // Restore port allocations to the source, then free the destination's.
    // Transfer step 8 re-points each mapping's host_port + allocated_port_id
    // onto a DESTINATION allocation; a bare `delete WHERE server_id = destId`
    // would CASCADE-DELETE those mappings (allocated_port_id is onDelete:
    // cascade), leaving the cube — which stays on the source after a cancel —
    // with no SSH endpoint. revertMappingsToSourceServer re-points the mappings
    // back to a source allocation FIRST, then deletes the destination rows.
    // Idempotent + a no-op when the cancel happened before step 8 re-pointed.
    await log.step(
      "Restore source port allocations + free destination",
      async () => {
        await db.transaction((tx) =>
          revertMappingsToSourceServer(tx, cubeId, sourceServerId, destId)
        );
      }
    );
  }

  // Restore Cloudflare origins to the SOURCE — deliberately at TOP LEVEL, NOT
  // nested under the `if (destId)` destination-cleanup guard above. This is a
  // pure Cloudflare API call (no host dependency) and is the critical step
  // that brings the customer's custom domain back to the live source cube. It
  // MUST run whenever a `finalizing`-stage cancel may have re-pointed origins
  // to the destination — regardless of whether `destId` resolved. Previously
  // this lived inside the `if (destId)` block, so a null `destId` skipped it
  // entirely and stranded the customer's domain on the torn-down destination
  // (Rule 57; 2026-05-29 audit). Idempotent + 404-tolerant, so over-running on
  // a pre-re-point cancel is safe.
  if (shouldRevertDomainRouting && activeDomains.length > 0) {
    await log.step("Restore custom-domain origins to source", async () => {
      await repointCubeDomainsToServer(activeDomains, sourceServerId);
    });
  }

  // ── 2. Wake source if it was slept for cutover ──────────────────────────
  if (shouldWakeSource) {
    await log.step("Wake source cube (was paused for cutover)", async () => {
      const srcServer = await db.query.servers.findFirst({
        where: eq(servers.id, sourceServerId),
      });
      if (!srcServer) {
        await log.warn("Source server not found — cannot wake cube");
        return;
      }

      const sshKey = await db.query.sshKeys.findFirst({
        where: eq(sshKeys.id, srcServer.sshKeyId),
      });
      if (!sshKey) {
        await log.warn(
          "SSH key not found for source server — cannot wake cube"
        );
        return;
      }

      let srcClient: import("ssh2").Client | null = null;
      try {
        srcClient = await createSshConnection(
          srcServer.publicIp,
          srcServer.sshPort,
          decryptPrivateKey(sshKey.encryptedPrivateKey, env.APP_SECRET)
        );
        await wakeCube(srcClient, cubeId, cube.launchMode);

        await db
          .update(cubes)
          .set({
            status: "running",
            lastBilledAt: new Date(),
            lastStartedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(cubes.id, cubeId), eq(cubes.status, "sleeping")));

        await log.info("Source cube woken — back online");
      } catch (err) {
        await log.warn(
          `Wake source failed (non-fatal — cube may need manual wake): ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        srcClient?.end();
      }
    });
  }

  // ── 3. Reset transfer state ─────────────────────────────────────────────
  await log.step("Reset transfer state", async () => {
    await db
      .update(cubes)
      .set({
        transferState: "failed",
        transferDestinationServerId: null,
        transferStartedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(cubes.id, cubeId));
  });

  await db.insert(lifecycleLogs).values({
    entityType: "cube",
    entityId: cubeId,
    message: `Transfer cancelled by ${actorEmail}. Destination cleaned up; source cube ${shouldWakeSource ? "woken" : "unchanged"}.`,
  });

  // Notify the UI of the updated state
  const finalCube = await db.query.cubes.findFirst({
    where: eq(cubes.id, cubeId),
  });
  if (finalCube) {
    await triggerCubeLifecycleEvent(cubeId, spaceId, {
      status: finalCube.status,
      transferState: "failed",
    });
  }

  audit({
    action: "cube.transfer_cancelled",
    category: "cube",
    actorType: "admin",
    actorId,
    entityType: "cube",
    entityId: cubeId,
    spaceId,
    description: `Transfer cancelled by ${actorEmail}. Destination ${destId ?? "none"} cleaned up.`,
    metadata: {
      destinationServerId: destId,
      sourceServerId,
      sourceWoken: shouldWakeSource,
    },
    source: "worker",
  });

  await log.info("Transfer cancel complete");
}

export async function handleCubeTransferCancel(
  jobs: Job<CubeTransferCancelPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleCubeTransferCancelJob(job);
  }
}
