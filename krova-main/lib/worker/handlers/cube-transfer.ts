import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import type { Job } from "pg-boss";
import {
  allocatedPorts,
  cubes,
  domainMappings,
  lifecycleLogs,
  servers,
  sshKeys,
  tcpMappingWhitelistedIps,
  tcpPortMappings,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { chargeProratedUsageWithAudit } from "@/lib/cost";
import { resolveLaunchModeForCube } from "@/lib/cubes/launch-mode";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";
import { getSpaceOwner } from "@/lib/email/helpers";
import { env } from "@/lib/env";
import { ioNicePrefix } from "@/lib/io-nice";
import { triggerCubeLifecycleEvent } from "@/lib/pusher";
import { reconcileServerResources } from "@/lib/server/allocate";
import { serverHasCpuRamRoom } from "@/lib/server/cpu-ram-capacity";
import {
  repointCubeCustomHostname,
  repointCubeDomainsToServer,
} from "@/lib/server/cube-domain";
import {
  cubeIpv4Address,
  cubeIpv6Address,
  octetOf,
} from "@/lib/server/cube-network";
import { serverHasDiskRoom } from "@/lib/server/disk-capacity";
import { assignNumaNode, clearNumaNode } from "@/lib/server/numa-nodes";
import { PORT_RANGE, revertMappingsToSourceServer } from "@/lib/server/ports";
import {
  addCustomDomainRoute,
  connectToServer,
  decryptPrivateKey,
  execCommand,
  guestPing,
  removeCustomDomainRoute,
  writeCubeGuestNetworkConfig,
} from "@/lib/ssh";
import {
  deleteCube,
  sleepCube,
  startCube,
  wakeCube,
} from "@/lib/ssh/firecracker";
import {
  addTcpPortForward,
  allocateInternalOctet,
  removeTcpPortForward,
} from "@/lib/ssh/network";
import { sleep } from "@/lib/utils";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildCubeSummary } from "@/lib/webhook-payloads";
import { withCubeHeartbeat } from "@/lib/worker/cube-heartbeat";
import { JobLogger } from "@/lib/worker/job-log";
import type { CubeTransferPayload } from "@/lib/worker/job-types";

/**
 * Move a Cube from `sourceServerId` to `destinationServerId` while preserving
 * customer state (rootfs, networking, custom domains, TCP forwards).
 *
 * The handler is a sequential, idempotent state machine driven by
 * `cubes.transferState`. Each step advances the state column so a retry
 * resumes from the right place. All destructive actions on the source happen
 * LAST — after the destination cube has been verified healthy.
 *
 * State machine: idle/failed → snapshotting → restoring → finalizing →
 * completed.
 */
async function handleCubeTransferJob(
  job: Job<CubeTransferPayload>
): Promise<void> {
  const {
    cubeId,
    spaceId,
    sourceServerId,
    destinationServerId,
    actorId,
    actorEmail,
  } = job.data;
  const log = new JobLogger(job.id, "cube.transfer", "cube", cubeId);
  console.log(
    `[cube-transfer] starting cubeId=${cubeId} src=${sourceServerId} dst=${destinationServerId}`
  );
  await log.info(
    `Cube transfer started: ${sourceServerId} → ${destinationServerId}`
  );

  // 1. Load cube
  const cube = await db.query.cubes.findFirst({ where: eq(cubes.id, cubeId) });
  if (!cube) {
    throw new Error(`Cube ${cubeId} not found`);
  }

  // 2. Idempotency guard — only one transfer in flight for a cube. If a
  //    different destination is already claimed, refuse. Same destination →
  //    resume from current state below.
  if (
    cube.transferState !== "idle" &&
    cube.transferState !== "failed" &&
    cube.transferState !== "completed" &&
    cube.transferDestinationServerId &&
    cube.transferDestinationServerId !== destinationServerId
  ) {
    throw new Error(
      `Cube ${cubeId} is already transferring to ${cube.transferDestinationServerId}`
    );
  }

  // Capture old state BEFORE any updates — we need these for source teardown.
  const oldInternalIp = cube.internalIp;
  // N-M2: capture the old IPv6 too. The destination IP allocation (under the
  // advisory lock) pre-claims BOTH internal_ip and internal_ipv6 into the cube
  // row so the OR-filter can see them; a failed transfer's rollback must
  // restore BOTH or the cube is left with a v6 address that points at the
  // now-torn-down destination subnet (split-brain).
  const oldInternalIpv6 = cube.internalIpv6;
  // Remember the pre-transfer status so sleeping cubes are re-paused on the
  // destination rather than left running — the customer paused deliberately.
  const wasRunning = cube.status === "running";

  // Retry idempotency — `transferState` advances monotonically through the
  // phases, so a retry can fast-skip any phase whose state marker is already
  // past it. Without these guards, a retry of an interrupted `restoring`
  // would re-run the multi-GB rsync from scratch (audit H5, 2026-05-24).
  // The ordered list mirrors the phase progression in the handler below.
  const TRANSFER_STATE_ORDER = [
    "idle",
    "failed",
    "snapshotting",
    "restoring",
    "finalizing",
    "completed",
  ] as const;
  const stateIndex = (s: string | null | undefined): number =>
    TRANSFER_STATE_ORDER.indexOf(
      (s ?? "idle") as (typeof TRANSFER_STATE_ORDER)[number]
    );
  const transferStateAtOrPast = (target: string): boolean =>
    stateIndex(cube.transferState) >= stateIndex(target);
  const tcpMappings = await db.query.tcpPortMappings.findMany({
    where: eq(tcpPortMappings.cubeId, cubeId),
  });
  const allDomainMappings = await db.query.domainMappings.findMany({
    where: eq(domainMappings.cubeId, cubeId),
  });
  // The live custom domains that move with the cube. Gate on `status === "active"`
  // (the maintained live-route signal), NOT the vestigial `verificationStatus`
  // column — see the long note at the step-8 re-point loop. Reused by the
  // re-point loop, the source teardown, and the failure-rollback restore.
  const activeDomains = allDomainMappings.filter(
    (d) => d.status === "active" && d.port != null
  );

  // Track allocated resources for failure cleanup.
  let newInternalIp: string | null = null;
  // The octet is NOT preserved across transfer — a fresh octet is picked on
  // the destination and both addresses are derived from the destination's S.
  let newInternalIpv6: string | null = null;
  let atomicFlipDone = false;
  // Path to the temp rootfs snapshot copy on the source server (cleaned up after upload).
  let snapshotTempPath: string | null = null;
  // Set to true once source VM is paused for cutover so the error handler can wake it.
  let sourceSleepedForCutover = false;
  // Set to true once step 8 has (or may have) re-pointed custom-domain origins
  // to the DESTINATION. The failure-rollback then knows it must restore those
  // origins to the source + drop the orphaned destination Caddy routes.
  let domainRoutingApplied = false;

  try {
    // 3. Pre-flight capacity check on destination.
    const dest = await db.query.servers.findFirst({
      where: eq(servers.id, destinationServerId),
    });
    if (!dest) {
      throw new Error(`Destination server ${destinationServerId} not found`);
    }
    if (dest.status !== "active" || dest.setupPhase !== "ready") {
      throw new Error(
        `Destination server not ready (status=${dest.status} phase=${dest.setupPhase})`
      );
    }

    const src = await db.query.servers.findFirst({
      where: eq(servers.id, sourceServerId),
    });
    if (!src) {
      throw new Error(`Source server ${sourceServerId} not found`);
    }

    if (dest.regionId !== src.regionId) {
      throw new Error(
        `Cross-region transfers are not supported (src=${src.regionId} dst=${dest.regionId})`
      );
    }

    await log.step("Pre-flight capacity check on destination", async () => {
      const cpuRamFits = serverHasCpuRamRoom(dest, cube.vcpus, cube.ramMb);
      const diskFits = serverHasDiskRoom(dest, cube.diskLimitGb);

      if (!cpuRamFits || !diskFits) {
        await db
          .update(cubes)
          .set({
            transferState: "failed",
            updatedAt: new Date(),
          })
          .where(eq(cubes.id, cubeId));
        throw new Error(
          `Destination server lacks capacity (cpuRam=${cpuRamFits} disk=${diskFits})`
        );
      }
    });

    // 4. Claim the transfer — record destination + start time. Idempotent:
    //    re-running a job for the same destination is fine.
    await db
      .update(cubes)
      .set({
        transferDestinationServerId: destinationServerId,
        transferStartedAt: cube.transferStartedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(cubes.id, cubeId));

    // Enter an active transfer state BEFORE pausing the source in step 5.
    // cube.state-sync excludes snapshotting/restoring/finalizing/cancelling but
    // NOT idle — so if we paused the source while transferState was still
    // 'idle', state-sync could observe the paused VM as a 'running→sleeping'
    // mismatch and flip the cube to sleeping mid-transfer (clearing
    // lastBilledAt + firing a misleading cube.sleeping webhook). Guarded so a
    // crash-retry that already advanced past snapshotting isn't regressed
    // (the rsync-skip at step 6 reads the loaded cube.transferState, unaffected).
    if (!transferStateAtOrPast("restoring")) {
      await db
        .update(cubes)
        .set({ transferState: "snapshotting", updatedAt: new Date() })
        .where(eq(cubes.id, cubeId));
    }

    dispatchWebhookEvent(spaceId, "cube.transfer.started", {
      cube: buildCubeSummary(cube),
      transfer: {
        fromServerId: sourceServerId,
        toServerId: destinationServerId,
      },
    });

    // 5. Take a crash-consistent rootfs snapshot while source stays alive.
    //    Running cube: brief Firecracker Pause → cp --reflink=auto → Resume (offline for seconds only).
    //    Sleeping cube: direct cp (VM already paused, no state change needed).
    //    Source is running during the entire compress + upload + destination boot phases.
    //    The prorated charge and permanent sleep happen at cutover (step 8b), AFTER
    //    the destination is confirmed healthy.
    {
      const { client: srcClient } = await connectToServer(sourceServerId);
      try {
        const rootfsPath = `/var/lib/krova/cubes/${cubeId}/rootfs.ext4`;
        snapshotTempPath = `/var/lib/krova/cubes/${cubeId}/xfer-snapshot.ext4`;

        if (cube.status === "running") {
          await log.step(
            "Pause source VM briefly and copy rootfs snapshot",
            async () => {
              await sleepCube(srcClient, cubeId, cube.launchMode);
              try {
                const cpResult = await execCommand(
                  srcClient,
                  `cp --reflink=auto ${rootfsPath} ${snapshotTempPath}`,
                  300_000
                );
                if (cpResult.exitCode !== 0) {
                  throw new Error(
                    `rootfs snapshot copy failed: ${cpResult.stderr}`
                  );
                }
              } catch (cpErr) {
                // Resume VM immediately on copy failure — don't leave customer's cube paused
                await wakeCube(srcClient, cubeId, cube.launchMode).catch(
                  () => {}
                );
                throw cpErr;
              }
              await wakeCube(srcClient, cubeId, cube.launchMode);
            }
          );
        } else {
          // Already sleeping (paused) — copy without any state change
          await log.step(
            "Copy rootfs snapshot (cube already sleeping)",
            async () => {
              const cpResult = await execCommand(
                srcClient,
                `cp --reflink=auto ${rootfsPath} ${snapshotTempPath}`,
                300_000
              );
              if (cpResult.exitCode !== 0) {
                throw new Error(
                  `rootfs snapshot copy failed: ${cpResult.stderr}`
                );
              }
            }
          );
        }
      } finally {
        srcClient.end();
      }
    }

    // 6. Snapshotting state — transfer rootfs directly from source to destination
    //    via rsync over SSH. The destination connects to the source using the
    //    platform private key (already authorised on the source), written
    //    transiently to /dev/shm (tmpfs — never touches disk).
    //
    //    Retry skip: if a prior run already advanced past `snapshotting`
    //    (transferState is now `restoring` or `finalizing`), the rootfs is
    //    already on the destination. Don't re-rsync — even with rsync
    //    --inplace's "only changed bytes" semantics, the file-traversal
    //    overhead on a multi-GB rootfs is multiple minutes wasted.
    if (transferStateAtOrPast("restoring")) {
      await log.info(
        `Skipping rsync — previous run already advanced past snapshotting (state=${cube.transferState})`
      );
    } else {
      // transferState was already set to 'snapshotting' before step 5's pause.
      {
        const srcKeyRecord = await db.query.sshKeys.findFirst({
          where: eq(sshKeys.id, src.sshKeyId),
        });
        if (!srcKeyRecord) {
          throw new Error("Source server SSH key not found");
        }
        const srcPrivateKey = decryptPrivateKey(
          srcKeyRecord.encryptedPrivateKey,
          env.APP_SECRET
        );
        // base64 has no shell-special characters — safe to single-quote in echo
        const srcKeyB64 = Buffer.from(srcPrivateKey).toString("base64");

        const { client: dstClient } =
          await connectToServer(destinationServerId);
        try {
          await log.step("Create cube directory on destination", async () => {
            await execCommand(
              dstClient,
              `mkdir -p /var/lib/krova/cubes/${cubeId}`
            );
          });

          await log.step(
            "Ensure rsync is installed on destination",
            async () => {
              const check = await execCommand(
                dstClient,
                "which rsync >/dev/null 2>&1 && echo already || (command -v apt-get >/dev/null 2>&1 && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq rsync && echo installed-apt) || (command -v dnf >/dev/null 2>&1 && dnf install -y -q rsync && echo installed-dnf) || echo unknown",
                120_000
              );
              await log.info(`rsync: ${check.stdout.trim()}`);
            }
          );

          await log.step(
            `Transfer rootfs from ${src.hostname} (${src.publicIp}) → destination via rsync`,
            async () => {
              await log.info(
                `Source: root@${src.publicIp}:${src.sshPort} path=${snapshotTempPath}`
              );

              await execCommand(
                dstClient,
                `echo '${srcKeyB64}' | base64 -d > /dev/shm/krova_xfer_key && chmod 600 /dev/shm/krova_xfer_key`,
                5000
              );
              await log.info(
                "Temporary SSH key written to /dev/shm on destination"
              );

              try {
                const r = await execCommand(
                  dstClient,
                  "rsync -az --sparse --inplace --stats" +
                    ` -e "ssh -p ${src.sshPort} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i /dev/shm/krova_xfer_key"` +
                    ` root@${src.publicIp}:${snapshotTempPath}` +
                    ` /var/lib/krova/cubes/${cubeId}/rootfs.ext4`,
                  1_800_000
                );
                if (r.exitCode !== 0) {
                  throw new Error(`rsync failed: ${r.stderr || r.stdout}`);
                }
                // Log rsync --stats summary (last 4 lines cover the key numbers)
                const statsLines = r.stdout
                  .split("\n")
                  .map((l) => l.trim())
                  .filter(Boolean);
                const summary = statsLines.slice(-6).join(" | ");
                if (summary) {
                  await log.info(`rsync stats: ${summary}`);
                }
              } finally {
                await execCommand(
                  dstClient,
                  "rm -f /dev/shm/krova_xfer_key"
                ).catch(() => {});
                await log.info("Temporary SSH key removed from destination");
              }
            }
          );

          await log.step("Verify rootfs on destination", async () => {
            const stat = await execCommand(
              dstClient,
              `stat -c "%s bytes" /var/lib/krova/cubes/${cubeId}/rootfs.ext4`
            );
            if (stat.exitCode !== 0) {
              throw new Error(
                "rootfs.ext4 not found on destination after rsync"
              );
            }
            await log.info(`rootfs.ext4 present: ${stat.stdout.trim()}`);
          });
        } finally {
          dstClient.end();
        }

        // Delete the temp snapshot copy on source — rootfs is now on destination.
        if (snapshotTempPath) {
          await log.step("Remove temp snapshot copy from source", async () => {
            try {
              const { client: srcCleanup } =
                await connectToServer(sourceServerId);
              try {
                await execCommand(
                  srcCleanup,
                  `rm -f ${snapshotTempPath}`
                ).catch(() => {});
                await log.info(`Removed ${snapshotTempPath} from source`);
              } finally {
                srcCleanup.end();
              }
            } catch {
              await log.warn(
                "Could not remove temp snapshot from source (non-fatal)"
              );
            }
          });
          snapshotTempPath = null;
        }
      }
    }

    // 7. Restoring state — allocate identity on destination, download,
    //    decompress, resize rootfs, boot Firecracker.
    await db
      .update(cubes)
      .set({ transferState: "restoring", updatedAt: new Date() })
      .where(eq(cubes.id, cubeId));

    let dstHasVirtioMem = false;
    {
      const { client: dstClient } = await connectToServer(destinationServerId);
      try {
        await log.step("Allocate internal IP on destination", async () => {
          // Serialize IP allocation per destination server with a Postgres
          // advisory xact-scoped lock keyed on a hash of the destination
          // server id. The lock is released automatically on transaction
          // commit/rollback. Combined with the OR-filter below (which makes
          // any in-flight transfer's pre-claimed IP visible even though
          // cubes.serverId is still the source until the atomic flip), this
          // closes the TOCTOU race where two concurrent transfers to the
          // same destination could pick the same IP.
          await db.transaction(async (tx) => {
            await tx.execute(
              sql`SELECT pg_advisory_xact_lock(hashtext(${destinationServerId}))`
            );
            // Read the DESTINATION server's bridge_subnet (S) — the octet is
            // NOT preserved across transfer; both addresses are re-derived from
            // the destination's S and a fresh octet free on the destination.
            const [dstSrv] = await tx
              .select({ bridgeSubnet: servers.bridgeSubnet })
              .from(servers)
              .where(eq(servers.id, destinationServerId))
              .limit(1);
            if (!dstSrv) {
              throw new Error(
                `destination server ${destinationServerId} not found`
              );
            }
            // Cube IPv4 is 198.18.0.0/15, keyed off the server's bridge_subnet
            // (S), assigned at create (allocateBridgeSubnet). A null S means the
            // destination server is mis-provisioned — fail loud rather than
            // minting a broken 198.18.0.x.
            const S = dstSrv.bridgeSubnet;
            if (S === null) {
              throw new Error(
                `Destination server ${destinationServerId} has no bridge_subnet — every active server is assigned one at create (allocateBridgeSubnet); a null value means the server is mis-provisioned and must be fixed before transferring cubes to this host.`
              );
            }
            const existing = await tx
              .select({ internalIp: cubes.internalIp })
              .from(cubes)
              .where(
                and(
                  or(
                    eq(cubes.serverId, destinationServerId),
                    eq(cubes.transferDestinationServerId, destinationServerId)
                  ),
                  isNotNull(cubes.internalIp)
                )
              );
            const existingOctets = existing
              .map((v) => v.internalIp)
              .filter((ip): ip is string => Boolean(ip))
              .map(octetOf);
            const octet = allocateInternalOctet(existingOctets);
            const ip = cubeIpv4Address(S, octet);
            const ipv6 = cubeIpv6Address(S, octet);
            // Write the chosen IP into the cube row immediately so the next
            // allocator (still under its own advisory lock) sees it via the
            // OR-filter on transferDestinationServerId. cube.serverId is
            // still the source — the atomic flip in step 9 overwrites this
            // with no harm.
            await tx
              .update(cubes)
              .set({
                internalIp: ip,
                internalIpv6: ipv6,
                updatedAt: new Date(),
              })
              .where(eq(cubes.id, cubeId));
            newInternalIp = ip;
            newInternalIpv6 = ipv6;
          });
          await log.info(
            `Allocated internal IP ${newInternalIp} / ${newInternalIpv6} on destination`
          );
        });

        // Directory was created in step 6 (before rsync). Write ip.txt so
        // deleteCube's TAP cleanup works correctly if this cube is ever
        // deleted from the destination server.
        await execCommand(
          dstClient,
          `echo '${newInternalIp}' > /var/lib/krova/cubes/${cubeId}/ip.txt`
        );

        const rootfsPath = `/var/lib/krova/cubes/${cubeId}/rootfs.ext4`;

        await log.step("Resize rootfs to disk limit", async () => {
          const truncRes = await execCommand(
            dstClient,
            `truncate -s ${cube.diskLimitGb}G ${rootfsPath}`
          );
          if (truncRes.exitCode !== 0) {
            throw new Error(`truncate failed: ${truncRes.stderr}`);
          }
          // e2fsck may exit non-zero when it fixes things — that's fine.
          await execCommand(
            dstClient,
            `${ioNicePrefix()}e2fsck -fy ${rootfsPath} || true`
          );
          const resizeRes = await execCommand(
            dstClient,
            `${ioNicePrefix()}resize2fs ${rootfsPath}`
          );
          if (resizeRes.exitCode !== 0) {
            throw new Error(`resize2fs failed: ${resizeRes.stderr}`);
          }
        });

        // CRITICAL: update the guest's network config with the new internal
        // IP before booting. The rootfs snapshot was taken from the source
        // server where the cube had a DIFFERENT internal IP hard-coded in
        // its systemd-networkd config (or the legacy netplan YAML for
        // pre-2026-05-24 cubes). If we boot without rewriting this file,
        // the guest configures eth0 with the old IP — ARP lookups for the
        // new IP go unanswered and ALL HTTP/TCP traffic from Caddy fails.
        // `writeCubeGuestNetworkConfig` writes a systemd-networkd unit that
        // works across both supported cube distros (Ubuntu, Debian) — see
        // lib/ssh/cube-guest-network.ts.
        await log.step(
          "Update guest network config for new internal IP",
          async () => {
            if (!newInternalIp) {
              throw new Error("internal IP not allocated");
            }
            const mntDir = `/tmp/krova-transfer-${cubeId}`;
            await execCommand(dstClient, `mkdir -p ${mntDir}`);
            const mntRes = await execCommand(
              dstClient,
              `mount -o loop ${rootfsPath} ${mntDir}`
            );
            if (mntRes.exitCode !== 0) {
              throw new Error(`mount rootfs failed: ${mntRes.stderr}`);
            }
            try {
              await writeCubeGuestNetworkConfig(
                dstClient,
                mntDir,
                newInternalIp
              );
            } finally {
              await execCommand(
                dstClient,
                `umount ${mntDir} 2>/dev/null || umount -l ${mntDir} 2>/dev/null || true; rmdir ${mntDir} 2>/dev/null || true`
              );
            }
          }
        );

        // Resolve the launch mode for the boot on the DESTINATION. cube.serverId
        // is still the source until the atomic flip (step 9), so pass
        // destinationServerId explicitly — this allocates the jailer uid on the
        // destination (allocateJailerUid excludes the cube's own row, so the
        // source's uid is freed when the cube's serverId moves). With
        // JAILER_ENABLED=false this returns { launchMode: "bare" } and the boot
        // is byte-identical to before.
        const { launchMode, jailerUid } = await resolveLaunchModeForCube({
          id: cubeId,
          serverId: destinationServerId,
          launchMode: cube.launchMode,
          jailerUid: cube.jailerUid,
        });

        await withCubeHeartbeat(cubeId, async () => {
          await log.step("Boot Firecracker on destination", async () => {
            if (!newInternalIp) {
              throw new Error("internal IP was not allocated");
            }
            const r = await startCube(dstClient, cubeId, {
              vcpus: cube.vcpus,
              ramMb: cube.ramMb,
              internalIp: newInternalIp,
              launchMode,
              jailerUid,
            });
            dstHasVirtioMem = r.hasVirtioMem;
          });
        });
      } finally {
        dstClient.end();
      }
    }

    // 8. Finalizing state — reapply TCP forwards + Caddy domains, then verify.
    await db
      .update(cubes)
      .set({ transferState: "finalizing", updatedAt: new Date() })
      .where(eq(cubes.id, cubeId));

    {
      const { client: dstClient } = await connectToServer(destinationServerId);
      try {
        // Reapply TCP port mappings on destination. The DB-only work (clear
        // prior dest allocations from a failed retry + INSERT one allocation
        // row per mapping + UPDATE tcp_port_mappings.allocatedPortId) MUST
        // happen in a single transaction — otherwise a worker kill between
        // the DELETE and the INSERTs leaves the dest cube running with no
        // bookkeeping rows, and a concurrent allocator would see those host
        // ports as free and double-assign them. SSH iptables work happens
        // outside the transaction afterwards (slow, external, retryable).
        if (tcpMappings.length > 0 && !newInternalIp) {
          throw new Error("internal IP missing for TCP reapply");
        }

        // Pre-fetch whitelists for each mapping so the inner transaction
        // does only writes.
        const whitelistsByMappingId = new Map<string, string[]>();
        for (const m of tcpMappings) {
          const whitelist = await db
            .select({ cidr: tcpMappingWhitelistedIps.cidr })
            .from(tcpMappingWhitelistedIps)
            .where(eq(tcpMappingWhitelistedIps.mappingId, m.id));
          whitelistsByMappingId.set(
            m.id,
            whitelist.map((w) => w.cidr)
          );
        }

        // Tracks the final host port for each mapping (may differ from original
        // if the preferred port was already in use on the destination server).
        const resolvedPorts = new Map<string, number>();

        await db.transaction(async (tx) => {
          // Idempotency: clear any leftover destination allocations for this
          // cube from a prior failed retry before re-inserting. Source
          // allocations are pruned later in the source-teardown step.
          await tx
            .delete(allocatedPorts)
            .where(
              and(
                eq(allocatedPorts.cubeId, cubeId),
                eq(allocatedPorts.serverId, destinationServerId)
              )
            );

          // Lock all current allocations for the destination server so no
          // concurrent allocator can steal a port between our read and insert.
          const usedRows = await tx
            .select({ port: allocatedPorts.port })
            .from(allocatedPorts)
            .where(eq(allocatedPorts.serverId, destinationServerId))
            .for("update");
          const usedSet = new Set(usedRows.map((r) => r.port));

          for (const m of tcpMappings) {
            const purpose = m.isSsh ? "ssh" : "tcp";

            // Prefer the original port; fall back to the next free one if taken.
            let finalPort = m.hostPort;
            if (usedSet.has(finalPort)) {
              let found = false;
              for (let p = PORT_RANGE.start; p <= PORT_RANGE.end; p++) {
                if (!usedSet.has(p)) {
                  finalPort = p;
                  found = true;
                  break;
                }
              }
              if (!found) {
                throw new Error(
                  `No available ports on destination server ${destinationServerId}`
                );
              }
            }
            // Reserve in local set so subsequent mappings in this loop don't
            // pick the same port before the INSERT is visible.
            usedSet.add(finalPort);

            const [allocated] = await tx
              .insert(allocatedPorts)
              .values({
                serverId: destinationServerId,
                port: finalPort,
                cubeId,
                purpose,
              })
              .returning();

            // Update hostPort in the mapping row if it changed, and always
            // re-point allocatedPortId to the new destination allocation row.
            await tx
              .update(tcpPortMappings)
              .set({
                hostPort: finalPort,
                allocatedPortId: allocated.id,
                updatedAt: new Date(),
              })
              .where(eq(tcpPortMappings.id, m.id));

            resolvedPorts.set(m.id, finalPort);
          }
        });

        // Log any port reassignments so the admin can see what changed.
        for (const m of tcpMappings) {
          const finalPort = resolvedPorts.get(m.id) ?? m.hostPort;
          if (finalPort !== m.hostPort) {
            await log.info(
              `Port conflict on destination: ${m.isSsh ? "SSH" : "TCP"} mapping host:${m.hostPort} reassigned to host:${finalPort} → cube:${m.cubePort}`
            );
          }
        }

        // SSH iptables setup runs outside the DB transaction.
        for (const m of tcpMappings) {
          const finalPort = resolvedPorts.get(m.id) ?? m.hostPort;
          await log.step(
            `Reapply TCP forward host:${finalPort} → cube:${m.cubePort}`,
            async () => {
              if (!newInternalIp) {
                throw new Error("internal IP missing for TCP reapply");
              }
              const cidrs = whitelistsByMappingId.get(m.id) ?? [];
              await addTcpPortForward(
                dstClient,
                finalPort,
                newInternalIp,
                m.cubePort,
                cidrs
              );
            }
          );
        }

        // Re-point each custom domain's Cloudflare Custom Hostname to the
        // destination server's origin (make-before-break — live traffic moves
        // to the already-booted destination cube), then re-add its Caddy Host
        // route. No cert copy: the wildcard Origin CA cert is on every server
        // and Cloudflare manages the visitor-facing cert.
        //
        // `activeDomains` gates on `status === "active"` — the live-route signal
        // maintained by domain-add / domain-remove and used everywhere else that
        // rebuilds routing (`getActiveCustomDomainsForServer`, `cube-delete`).
        // The old `verificationStatus === "verified"` gate keyed off a VESTIGIAL
        // column that no code path maintains in the Cloudflare-for-SaaS world, so
        // any live domain whose verificationStatus wasn't exactly "verified" was
        // silently skipped: its origin was never re-pointed and no destination
        // route was added, yet the source cube was still deleted — leaving the
        // domain on a torn-down server, served the branded landing page
        // (2026-05-29 transfer incident).
        //
        // Flag the re-point BEFORE the loop so the failure-rollback always knows
        // to restore origins to the source even if the loop throws part-way.
        if (activeDomains.length > 0) {
          domainRoutingApplied = true;
        }
        for (const d of activeDomains) {
          await log.step(`Reapply route for ${d.domain}`, async () => {
            if (!newInternalIp) {
              throw new Error("internal IP missing for route reapply");
            }
            if (d.cloudflareHostnameId) {
              await repointCubeCustomHostname(
                d.cloudflareHostnameId,
                destinationServerId
              );
            }
            await addCustomDomainRoute(
              dstClient,
              d.domain,
              newInternalIp,
              d.port!
            );
          });
        }

        await log.step("Verify cube health on destination", async () => {
          // Poll for up to 60s — the guest agent starts after systemd, which
          // can take a few seconds after plugInitialMemory returns. A single
          // one-shot ping causes spurious failures if the agent is 3s late.
          const deadline = Date.now() + 60_000;
          let ok = false;
          while (Date.now() < deadline) {
            ok = await guestPing(dstClient, cubeId).catch(() => false);
            if (ok) {
              break;
            }
            await sleep(2000);
          }
          if (!ok) {
            throw new Error(
              "Guest agent did not respond after transfer (60s timeout)"
            );
          }
        });

        // Re-pause if the cube was sleeping before transfer. startCube always
        // boots the VM fresh (there is no in-place Firecracker resume for a
        // snapshot-restored cube). Re-pausing here preserves the customer's
        // intentional sleep state so billing remains paused on destination.
        if (!wasRunning) {
          await log.step(
            "Re-sleep cube on destination (restoring pre-transfer sleep state)",
            async () => {
              await sleepCube(dstClient, cubeId, cube.launchMode);
            }
          );
        }
      } finally {
        dstClient.end();
      }
    }

    // 8a-pre. Destination preflight: confirm destination is reachable RIGHT NOW
    //     before pausing source. Closes the narrow window between step 8
    //     (destination cube booted + verified healthy) and step 8b (about to
    //     pause source for cutover). If destination crashes / loses SSH /
    //     becomes unreachable in that window, we abort cleanly WITHOUT touching
    //     source — customer cube stays running on source, admin investigates.
    //
    //     Gated on `wasRunning` because that's the only branch that pauses source.
    //     For a cube that was already sleeping, there's nothing to protect here.
    //
    //     A failure throws; the outer catch block (line 1028) sees
    //     `sourceSleepedForCutover=false`, skips the wake-source branch, and
    //     leaves the cube on source running. The transfer state is marked
    //     `failed` (retryable) so pg-boss can retry once the destination
    //     recovers — or the admin can manually retry from the UI.
    if (wasRunning) {
      await log.step("Destination preflight before cutover", async () => {
        try {
          const { client: dstPingClient } =
            await connectToServer(destinationServerId);
          try {
            const r = await execCommand(dstPingClient, "echo ok", 10_000);
            if (r.exitCode !== 0 || !r.stdout.includes("ok")) {
              throw new Error(
                `unexpected probe response (exit=${r.exitCode}, stdout=${r.stdout.slice(0, 100).trim()})`
              );
            }
          } finally {
            dstPingClient.end();
          }
        } catch (err) {
          throw new Error(
            `Destination unreachable just before cutover — aborting without pausing source. Cube remains running on source. ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      });
    }

    // 8b. Cutover: sleep source now that destination is verified healthy.
    //     This is the only moment where the cube goes offline from the customer's perspective.
    //     For running cubes: charge prorated (Rule 38 — admin-initiated stop) then pause.
    //     For sleeping cubes: already paused; no action needed.
    if (wasRunning) {
      await log.step("Sleep source cube for cutover", async () => {
        const { client: srcCutoverClient } =
          await connectToServer(sourceServerId);
        try {
          const sinceLastBillMs = cube.lastBilledAt
            ? Date.now() - new Date(cube.lastBilledAt).getTime()
            : Number.POSITIVE_INFINITY;
          if (sinceLastBillMs > 30_000) {
            await chargeProratedUsageWithAudit(cube, {
              flow: "transfer cutover",
              logPrefix: "[cube-transfer]",
              actor: { type: "user", id: actorId, email: actorEmail },
              metadata: { sourceServerId, destinationServerId },
            });
          }
          await sleepCube(srcCutoverClient, cubeId, cube.launchMode);
          // Mark immediately so the error handler knows to wake if flip fails
          sourceSleepedForCutover = true;
          // Rule 52: a sleeping cube MUST have lastBilledAt = null. The prorated
          // charge above advanced it; clear it here so the brief
          // sleeping-at-cutover window doesn't carry a running-compute clock.
          // The atomic flip re-sets it (new Date() for a running cube, null for
          // a sleeping one); the failure-rollback wake re-sets it too.
          await db
            .update(cubes)
            .set({
              status: "sleeping",
              lastBilledAt: null,
              updatedAt: new Date(),
            })
            .where(eq(cubes.id, cubeId));
        } finally {
          srcCutoverClient.end();
        }
      });
    }

    // 9. Atomic flip — move the cube row to the destination and adjust the
    //    server allocation counters. Once this commits, the cube IS on the
    //    destination as far as the platform is concerned.
    await db.transaction(async (tx) => {
      // Bail if an admin cancelled the transfer while destination was being
      // verified. Lock the cube row first so the check + flip is atomic.
      const [currentCube] = await tx
        .select({ transferState: cubes.transferState })
        .from(cubes)
        .where(eq(cubes.id, cubeId))
        .for("update");
      if (currentCube?.transferState === "cancelling") {
        throw new Error("Transfer cancelled by admin — aborting atomic flip");
      }

      // Deterministic lock order — sort the two server ids lexicographically
      // before acquiring FOR UPDATE locks. A concurrent transfer / provision
      // / migration job that touches the same pair will acquire them in the
      // same order, so the deadlock window collapses to a normal wait.
      const [firstId, secondId] = [sourceServerId, destinationServerId].sort();
      await tx
        .select({ id: servers.id })
        .from(servers)
        .where(eq(servers.id, firstId))
        .for("update")
        .limit(1);
      await tx
        .select({ id: servers.id })
        .from(servers)
        .where(eq(servers.id, secondId))
        .for("update")
        .limit(1);

      // Update the cube row FIRST (moves the cube to the destination + sets
      // the final status), then rebuild each server's allocation counters
      // from the cube rows. Reconcile rather than manual delta math because
      // a sleeping cube contributes 0 CPU + 0 RAM to a server's tally
      // (see `reconcileServerResources` in `lib/server/allocate.ts`) —
      // a `d.allocatedCpus + cube.vcpus` increment / `s.allocatedCpus -
      // cube.vcpus` decrement would drift the counters when the cube being
      // transferred is sleeping. The reconcile reads the post-update cube
      // row so the math is correct from one rule.
      await tx
        .update(cubes)
        .set({
          serverId: destinationServerId,
          internalIp: newInternalIp,
          internalIpv6: newInternalIpv6,
          // Fresh boot on destination declared virtio-mem, so the cube
          // gains live-resize capability for free.
          hasVirtioMem: dstHasVirtioMem,
          transferState: "idle",
          transferDestinationServerId: null,
          // Preserve the pre-transfer sleep state. wasRunning was captured
          // before step 5 (the sleep-on-source step), so a cube that was
          // sleeping before the admin triggered the transfer stays sleeping.
          status: wasRunning ? "running" : "sleeping",
          // Fix #5: respect "sleeping ⇒ lastBilledAt is null". The pre-transfer
          // sleeping cube was charged $0 compute up to cutover; the post-
          // transfer sleeping cube continues at $0 compute. Sleep-storage
          // billing on the destination is independent of lastBilledAt.
          lastBilledAt: wasRunning ? new Date() : null,
          // Rule 52: every start path advances `lastStartedAt`. A running cube
          // just freshly booted on the destination (startCube ran in step 7)
          // — without this, plan-downgrade reconcile would treat the cube as
          // "oldest started" and pick it first for forced sleep, even though
          // it was just booted seconds ago.
          ...(wasRunning ? { lastStartedAt: new Date() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(cubes.id, cubeId));

      // Reconcile both servers in the same lock order we acquired them in.
      await reconcileServerResources(tx, firstId);
      await reconcileServerResources(tx, secondId);
    });
    atomicFlipDone = true;

    // 9b. L2 (NUMA): the cube carried the SOURCE server's `numa_node` through the
    //     flip; left stale it would mis-pin (a node id that means something
    //     different on the destination) or never re-pin on the destination's NEXT
    //     cold-restart. Re-evaluate against the DESTINATION's topology + load via
    //     the same `assignNumaNode` allocator used at create. Done in an ISOLATED
    //     tx (kept OUT of the multi-server-locked flip above to avoid advisory-lock
    //     ordering with the transfer's server row locks) — the destination boot in
    //     step 7 already ran UNPINNED (startCube passed no numa opts), so this only
    //     affects the next cold-restart, and the brief stale window doesn't matter.
    //     DB-only + best-effort + fail-safe: on any error, clear it so the cube
    //     boots unpinned (never throttled) and a later `install:numa-backfill`
    //     re-pins it.
    try {
      await db.transaction((tx) =>
        assignNumaNode(tx, destinationServerId, cubeId)
      );
    } catch (err) {
      console.warn(
        `[cube-transfer] NUMA re-assign on destination failed for ${cubeId}; clearing (boots unpinned until backfill):`,
        err instanceof Error ? err.message : err
      );
      await db.transaction((tx) => clearNumaNode(tx, cubeId)).catch(() => {});
    }

    // 10. Source teardown — non-fatal. The cube is functional on the
    //     destination at this point; if any of these fail, server.reconcile
    //     will pick up the orphans on the next tick.
    await log.step("Tear down source cube", async () => {
      let srcClient:
        | Awaited<ReturnType<typeof connectToServer>>["client"]
        | null = null;
      try {
        const { client } = await connectToServer(sourceServerId);
        srcClient = client;

        // Remove the source Caddy route for every domain that moved with the
        // cube (same `activeDomains` set used to add them on the destination).
        // Keying off the vestigial verificationStatus column here is what left
        // stale routes on every prior server after a transfer.
        for (const d of activeDomains) {
          await removeCustomDomainRoute(srcClient, d.domain).catch((err) => {
            console.warn(
              `[cube-transfer] failed to remove Caddy route ${d.domain} on source (non-fatal):`,
              err instanceof Error ? err.message : err
            );
          });
        }

        if (oldInternalIp) {
          for (const m of tcpMappings) {
            await removeTcpPortForward(
              srcClient,
              m.hostPort,
              oldInternalIp,
              m.cubePort
            ).catch((err) => {
              console.warn(
                `[cube-transfer] failed to remove TCP forward host:${m.hostPort} on source (non-fatal):`,
                err instanceof Error ? err.message : err
              );
            });
          }
        }

        await deleteCube(
          srcClient,
          cubeId,
          oldInternalIp ?? undefined,
          cube.launchMode
        ).catch((err) => {
          console.warn(
            "[cube-transfer] deleteCube on source failed (non-fatal):",
            err instanceof Error ? err.message : err
          );
        });
      } catch (err) {
        console.warn(
          "[cube-transfer] source teardown SSH failed (non-fatal):",
          err instanceof Error ? err.message : err
        );
      } finally {
        if (srcClient) {
          srcClient.end();
        }
      }

      // Free port allocation rows that are still pointing at the source
      // server. Note: in step 8 we re-pointed each tcp_port_mappings row to
      // a new allocation row on the destination, so the OLD allocation rows
      // on source are now orphans. freePortsByCube deletes ALL allocations
      // for this cube — which is too aggressive (would also remove the new
      // dest allocations). Instead, prune by serverId.
      try {
        await db
          .delete(allocatedPorts)
          .where(
            and(
              eq(allocatedPorts.cubeId, cubeId),
              eq(allocatedPorts.serverId, sourceServerId)
            )
          );
      } catch (err) {
        console.warn(
          "[cube-transfer] failed to free source port allocations (non-fatal):",
          err instanceof Error ? err.message : err
        );
      }
    });

    // 11. Audit + lifecycle log + Pusher event.
    audit({
      action: "cube.transfer_complete",
      category: "cube",
      actorType: "user",
      actorId,
      actorEmail,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Cube transferred from ${sourceServerId} to ${destinationServerId}`,
      metadata: {
        sourceServerId,
        destinationServerId,
      },
      source: "worker",
    });

    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `Cube transferred from server ${sourceServerId} to ${destinationServerId}`,
    });

    await triggerCubeLifecycleEvent(cubeId, spaceId, {
      status: wasRunning ? "running" : "sleeping",
      transferred: true,
    });

    dispatchWebhookEvent(spaceId, "cube.transfer.completed", {
      cube: buildCubeSummary({
        ...cube,
        serverId: destinationServerId,
        status: wasRunning ? "running" : "sleeping",
      }),
      transfer: {
        fromServerId: sourceServerId,
        toServerId: destinationServerId,
      },
    });

    // Notify space owner that the migration succeeded.
    try {
      const owner = await getSpaceOwner(spaceId);
      if (owner) {
        const cubeUrl = `${env.NEXT_PUBLIC_APP_URL}/${spaceId}/cubes/${cubeId}`;
        const cubeName = cube.name ?? cubeId;
        const { cubeTransferredEmailTemplate } = await import(
          "@/lib/email/templates/cube-transferred"
        );
        const { html, text } = await cubeTransferredEmailTemplate({
          userName: owner.name,
          spaceName: owner.spaceName,
          cubeName,
          cubeId,
          cubeUrl,
          outcome: "success",
        });
        await enqueueEmail({
          to: owner.email,
          subject: `Cube migrated — ${cubeName}`,
          html,
          text,
        });
      }
    } catch (emailErr) {
      console.error("[cube-transfer] success email enqueue failed:", emailErr);
    }

    await log.info("Cube transfer completed");
    console.log(`[cube-transfer] completed cubeId=${cubeId}`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[cube-transfer] failed cubeId=${cubeId}:`, reason);
    await log.error(`Cube transfer failed: ${reason}`);

    if (atomicFlipDone) {
      // Cube is on destination but source teardown is incomplete.
      // server.reconcile will mop up orphaned source artifacts.
      await db.insert(lifecycleLogs).values({
        entityType: "cube",
        entityId: cubeId,
        message: `Cube transfer completed (cube on destination) but source teardown failed: ${reason}`,
      });
      audit({
        action: "cube.transfer_partial",
        category: "cube",
        actorType: "user",
        actorId,
        actorEmail,
        entityType: "cube",
        entityId: cubeId,
        spaceId,
        description: `Cube transfer succeeded but source teardown failed: ${reason}`,
        metadata: { sourceServerId, destinationServerId, error: reason },
        source: "worker",
      });
    } else {
      // Failure before the atomic flip. Roll back any partially-restored
      // state on the destination so it doesn't take resources or hold the
      // internal IP.
      if (newInternalIp) {
        try {
          const { client: dstClient } =
            await connectToServer(destinationServerId);
          try {
            // deleteCube kills Firecracker + removes the TAP/iptables, but
            // does NOT remove the cube workspace directory. Wipe it
            // explicitly so a half-written rootfs / transfer.ext4.zst
            // doesn't leak between retries.
            await execCommand(
              dstClient,
              `rm -rf /var/lib/krova/cubes/${cubeId}`
            ).catch(() => {});
            await deleteCube(
              dstClient,
              cubeId,
              newInternalIp,
              cube.launchMode
            ).catch(() => {});
            // F3: drop the orphaned destination Caddy routes added during
            // step 8 (make-before-break). The cube is going back to the source,
            // so these routes would dial a now-deleted IP. 404-tolerant.
            if (domainRoutingApplied) {
              for (const d of activeDomains) {
                await removeCustomDomainRoute(dstClient, d.domain).catch(
                  () => {}
                );
              }
            }
          } finally {
            dstClient.end();
          }
        } catch (cleanupErr) {
          console.warn(
            "[cube-transfer] destination cleanup failed (non-fatal):",
            cleanupErr instanceof Error ? cleanupErr.message : cleanupErr
          );
        }
      }

      // Roll back the step-8 port re-point. Step 8 (when reached) moved every
      // mapping's host_port + allocated_port_id onto a fresh DESTINATION
      // allocation; since the flip never happened the cube stays on the SOURCE,
      // so restore each mapping to a source allocation and delete the
      // destination allocations. Without this the destination allocation is
      // stranded (allocated_ports.server_id != cube.server_id) and a co-located
      // cube can re-grab the host port (the duplicate-host-port class). Gated
      // ONLY on having mappings (Rule 57) — independent of newInternalIp — and
      // idempotent: a no-op when step 8 never re-pointed anything. Non-fatal:
      // the cube is back on source and functional regardless; a leaked dest
      // allocation is recoverable, so failure here is audited, not thrown.
      if (tcpMappings.length > 0) {
        try {
          await db.transaction((tx) =>
            revertMappingsToSourceServer(
              tx,
              cubeId,
              sourceServerId,
              destinationServerId
            )
          );
        } catch (portErr) {
          console.warn(
            "[cube-transfer] port rollback after failure failed (non-fatal):",
            portErr instanceof Error ? portErr.message : portErr
          );
          audit({
            action: "cube.transfer_port_rollback_failed",
            category: "cube",
            actorType: "user",
            actorId,
            actorEmail,
            entityType: "cube",
            entityId: cubeId,
            spaceId,
            description: `Port rollback after transfer failure failed: ${portErr instanceof Error ? portErr.message : String(portErr)}`,
            metadata: { sourceServerId, destinationServerId },
            source: "worker",
          });
        }
      }

      // Clean up the snapshot temp copy if it was never consumed by the upload step.
      if (snapshotTempPath) {
        try {
          const { client: srcCleanupClient } =
            await connectToServer(sourceServerId);
          try {
            await execCommand(
              srcCleanupClient,
              `rm -f ${snapshotTempPath}`
            ).catch(() => {});
          } finally {
            srcCleanupClient.end();
          }
        } catch {
          // non-fatal — orphaned temp file wastes disk but doesn't affect correctness
        }
      }

      // If source was slept for cutover (step 8b) but the atomic flip never happened,
      // the cube is still on source. Wake it so the domain comes back up immediately.
      let cubeMovedToError = false;
      if (sourceSleepedForCutover) {
        try {
          const { client: srcWakeClient } =
            await connectToServer(sourceServerId);
          try {
            await wakeCube(srcWakeClient, cubeId, cube.launchMode);
            await db
              .update(cubes)
              .set({
                status: "running",
                // Rule 52: running ⇒ lastBilledAt non-null. The cutover set it
                // null when it slept the source; restore the running-compute
                // clock now that the cube is running on the source again.
                lastBilledAt: new Date(),
                lastStartedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(cubes.id, cubeId));
            await log.info(
              "Source cube woken after transfer failure — domain restored"
            );
          } finally {
            srcWakeClient.end();
          }
        } catch (wakeErr) {
          console.warn(
            "[cube-transfer] failed to wake source after error (non-fatal):",
            wakeErr instanceof Error ? wakeErr.message : wakeErr
          );
          await log
            .warn(
              `Failed to restore source cube after transfer failure: ${wakeErr instanceof Error ? wakeErr.message : String(wakeErr)}`
            )
            .catch(() => {});
          // Cube is on source but may be stuck paused — mark error so operator
          // is alerted. Rule 52: clear lastBilledAt — chargeProratedUsage at
          // line 768 advanced it during cutover; an error cube must not keep
          // the running-compute billing clock running.
          await db
            .update(cubes)
            .set({ status: "error", lastBilledAt: null, updatedAt: new Date() })
            .where(eq(cubes.id, cubeId))
            .catch(() => {});
          cubeMovedToError = true;
        }
      }

      // F2: restore Cloudflare origins to the SOURCE. Step 8 re-points each
      // active domain's Custom Hostname origin to the destination BEFORE the
      // flip (make-before-break). Since the flip never happened, the cube is
      // back on the source — so the origins must point at the source too, or
      // the domain would resolve to the just-torn-down destination cube and
      // serve the branded landing page. Pure Cloudflare API (no SSH), so this
      // runs even if the destination/source hosts are unreachable; idempotent
      // (no-op PATCH if already on source). The source Caddy route was never
      // removed pre-flip, so restoring the origin fully recovers the domain.
      if (domainRoutingApplied) {
        await repointCubeDomainsToServer(activeDomains, sourceServerId);
      }

      // Mark transferState='failed' so the admin can retry. Leave the cube
      // row pointing at the source server (no flip happened). Restore the
      // original internalIp — we may have pre-claimed a destination IP into
      // the cube row during IP allocation (under the advisory lock) so the
      // OR-filter could see it; that IP is no longer claimed.
      await db
        .update(cubes)
        .set({
          transferState: "failed",
          transferDestinationServerId: null,
          internalIp: oldInternalIp,
          internalIpv6: oldInternalIpv6,
          updatedAt: new Date(),
        })
        .where(eq(cubes.id, cubeId));

      await db.insert(lifecycleLogs).values({
        entityType: "cube",
        entityId: cubeId,
        message: `Cube transfer failed: ${reason}`,
      });
      audit({
        action: "cube.transfer_failed",
        category: "cube",
        actorType: "user",
        actorId,
        actorEmail,
        entityType: "cube",
        entityId: cubeId,
        spaceId,
        description: `Cube transfer failed: ${reason}`,
        metadata: { sourceServerId, destinationServerId, error: reason },
        source: "worker",
      });

      // Include `status` so the emailit sync chokepoint in
      // triggerCubeLifecycleEvent fires when the failure left the cube in
      // `error`. Without it, EmailIt would still see the cube as running.
      await triggerCubeLifecycleEvent(cubeId, spaceId, {
        transferState: "failed",
        error: reason,
        ...(cubeMovedToError ? { status: "error" } : {}),
      });

      dispatchWebhookEvent(spaceId, "cube.transfer.failed", {
        cube: buildCubeSummary({
          ...cube,
          status: cubeMovedToError ? "error" : cube.status,
        }),
        reason,
        transfer: {
          fromServerId: sourceServerId,
          toServerId: destinationServerId,
        },
      });

      // Notify space owner that the migration did not complete. Customer-facing
      // copy is generic — `failureReason` carries the underlying error for
      // internal log/audit correlation only.
      try {
        const owner = await getSpaceOwner(spaceId);
        if (owner) {
          const cubeUrl = `${env.NEXT_PUBLIC_APP_URL}/${spaceId}/cubes/${cubeId}`;
          const cubeName = cube.name ?? cubeId;
          const { cubeTransferredEmailTemplate } = await import(
            "@/lib/email/templates/cube-transferred"
          );
          const { html, text } = await cubeTransferredEmailTemplate({
            userName: owner.name,
            spaceName: owner.spaceName,
            cubeName,
            cubeId,
            cubeUrl,
            outcome: "failure",
            failureReason: reason,
          });
          await enqueueEmail({
            to: owner.email,
            subject: `Cube migration failed — ${cubeName}`,
            html,
            text,
          });
        }
      } catch (emailErr) {
        console.error(
          "[cube-transfer] failure email enqueue failed:",
          emailErr
        );
      }
    }

    throw err;
  }
}

export async function handleCubeTransfer(
  jobs: Job<CubeTransferPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleCubeTransferJob(job);
  }
}
