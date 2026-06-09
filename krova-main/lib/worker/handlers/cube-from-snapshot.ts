/**
 * Clone an existing snapshot into a brand-new cube. The destination cube
 * row is pre-allocated (status='pending') by the server action before
 * this job is enqueued; the handler:
 *
 *  1. Atomically claims the cube (pending → booting).
 *  2. Allocates an internal IP on the destination server (shared
 *     advisory-lock pattern from `cube-import-rootfs.ts`).
 *  3. Cleans any stale state (prior failed attempt of the same cubeId).
 *  4. `restic dump <sourceSnapshotId> rootfs.ext4` straight onto the
 *     destination cube's `rootfs.ext4` — no S3 round-trip, no `.cube`
 *     archive intermediate. The cube's restic chunk cache on the source
 *     repo's backend speeds this.
 *  5. Optional rootfs grow (the customer can clone to a LARGER disk;
 *     shrinking would corrupt ext4).
 *  6. e2fsck to replay any journal from the live snapshot.
 *  7. Loop-mount + rewrite guest network for the new internal IP +
 *     overwrite `/root/.ssh/authorized_keys` with the customer's new key.
 *  8. Boot via `startCube`, then set up the SSH iptables forward + the
 *     `tcp_port_mappings` row.
 *  9. Mark the cube `running`, fire Pusher, audit, log.
 *
 * On any failure: mark the cube `error`, write a lifecycle log, leave
 * the rootfs file in place so an operator can inspect. The original
 * snapshot is untouched (restic is content-addressed; dumping is
 * read-only against the repo).
 */

import { and, eq, ne, sql } from "drizzle-orm";
import type { Job } from "pg-boss";
import { DEFAULT_CUBE_SSH_PORT } from "@/config/platform";
import {
  allocatedPorts,
  cubeSnapshots,
  cubes,
  lifecycleLogs,
  servers,
  tcpPortMappings,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { resolveLaunchModeForCube } from "@/lib/cubes/launch-mode";
import { cubeNumaLaunchOpts } from "@/lib/cubes/numa-launch-opts";
import { db } from "@/lib/db";
import { ioNicePrefix } from "@/lib/io-nice";
import { triggerCubeLifecycleEvent } from "@/lib/pusher";
import { reconcileServerResources } from "@/lib/server/allocate";
import {
  cubeIpv4Address,
  cubeIpv6Address,
  octetOf,
} from "@/lib/server/cube-network";
import {
  connectToServer,
  execCommand,
  guestPing,
  shellEscape,
} from "@/lib/ssh";
import { writeCubeGuestNetworkConfig } from "@/lib/ssh/cube-guest-network";
import {
  deleteCube as destroyCubeVm,
  startCube,
  tapName,
} from "@/lib/ssh/firecracker";
import { cubePaths } from "@/lib/ssh/jailer";
import {
  addTcpPortForward,
  allocateInternalOctet,
  removeTcpPortForward,
} from "@/lib/ssh/network";
import { loadResticRepoConfig, resticDump } from "@/lib/storage/restic";
import { sleep } from "@/lib/utils";
import { withCubeHeartbeat } from "@/lib/worker/cube-heartbeat";
import { JobLogger } from "@/lib/worker/job-log";
import type { CubeFromSnapshotPayload } from "@/lib/worker/job-types";

async function handleCubeFromSnapshotJob(
  job: Job<CubeFromSnapshotPayload>
): Promise<void> {
  const {
    cubeId,
    spaceId,
    serverId,
    sourceSnapshotId,
    sourceCubeId,
    sshPublicKey,
  } = job.data;
  const log = new JobLogger(job.id, "cube.from-snapshot", "cube", cubeId);
  console.log(
    `[cube-from-snapshot] starting cubeId=${cubeId} sourceSnapshotId=${sourceSnapshotId}`
  );
  await log.info(`Clone from snapshot started (source=${sourceSnapshotId})`);

  // 1. Atomic claim — only proceed if still `pending`.
  const [claimed] = await db
    .update(cubes)
    .set({ status: "booting", updatedAt: new Date() })
    .where(and(eq(cubes.id, cubeId), eq(cubes.status, "pending")))
    .returning({
      id: cubes.id,
      serverId: cubes.serverId,
      vcpus: cubes.vcpus,
      ramMb: cubes.ramMb,
      diskLimitGb: cubes.diskLimitGb,
    });
  if (!claimed) {
    await log.warn("Destination cube no longer pending — skipping");
    return;
  }
  await triggerCubeLifecycleEvent(cubeId, spaceId, { status: "booting" });

  // 2. Load source snapshot + verify it's restorable.
  const snapshot = await db.query.cubeSnapshots.findFirst({
    where: eq(cubeSnapshots.id, sourceSnapshotId),
  });
  if (snapshot?.status !== "complete" || !snapshot.storagePath) {
    await failClone(
      cubeId,
      serverId,
      "Source snapshot is not in a complete state with a storage path"
    );
    return;
  }
  if (!snapshot.storageBackendId) {
    await failClone(
      cubeId,
      serverId,
      "Source snapshot has no storage backend reference"
    );
    return;
  }

  // 3. Resolve the source cube's restic repo (pinned to the snapshot's
  //    backend) AND connect to the destination host — BOTH guarded. A missing
  //    storage-backend row (loadResticRepoConfig throws) or a host-down
  //    (connectToServer throws) must flip the cube to `error` via failClone,
  //    NOT escape uncaught and strand the row in `booting` for ~10 min until
  //    cube.stale-check salvage-and-deletes it (guarded-connect invariant;
  //    Rule 58). Both run before any IP/port/VM is allocated, so failClone —
  //    which flips the cube to `error` (revivable via cube:inspect --restart)
  //    — is the whole cleanup.
  let repoConfig: Awaited<ReturnType<typeof loadResticRepoConfig>>["config"];
  let client: Awaited<ReturnType<typeof connectToServer>>["client"];
  try {
    repoConfig = (
      await loadResticRepoConfig(sourceCubeId, snapshot.storageBackendId)
    ).config;
    client = (await connectToServer(serverId)).client;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[cube-from-snapshot] preflight failed cubeId=${cubeId}: ${reason}`
    );
    await log.error(`Clone failed: ${reason}`);
    await failClone(cubeId, serverId, reason);
    return;
  }
  // Resolve the destination cube's launch mode ONCE (fresh cube → bare/null;
  // resolveLaunchModeForCube applies the JAILER_ENABLED policy + persists any
  // transition). Threaded into the inline pid-kill below + startCube.
  const { launchMode, jailerUid } = await resolveLaunchModeForCube({
    id: cubeId,
    serverId,
    launchMode: "bare",
    jailerUid: null,
  });

  let internalIp: string | null = null;
  let internalIpv6: string | null = null;
  let allocatedSshPort: number | null = null;
  // Set true once startCube returns (a live Firecracker is now running). A
  // post-boot failure (port lookup, tcp-mapping insert, running-flip) must kill
  // it in the catch, or the cube lands in `error` while a live VM keeps running
  // on the host — orphaning it (the next launch hits the TAP "Resource busy").
  let vmStarted = false;

  try {
    // 4. Allocate internal IP — serialized via advisory-lock keyed on
    //    destination server (mirrors cube-import-rootfs.ts). Reads the
    //    destination server's bridge_subnet (S), picks the lowest free octet,
    //    and derives BOTH the IPv4 and IPv6 address from it.
    ({ internalIp, internalIpv6 } = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${serverId}))`
      );
      const [srv] = await tx
        .select({ bridgeSubnet: servers.bridgeSubnet })
        .from(servers)
        .where(eq(servers.id, serverId))
        .limit(1);
      if (!srv) {
        throw new Error(`server ${serverId} not found`);
      }
      // Cube IPv4 is 198.18.0.0/15, keyed off the server's bridge_subnet (S),
      // assigned at create (allocateBridgeSubnet). A null S means the server is
      // mis-provisioned — fail loud rather than minting a broken 198.18.0.x.
      const S = srv.bridgeSubnet;
      if (S === null) {
        throw new Error(
          `Server ${serverId} has no bridge_subnet — every active server is assigned one at create (allocateBridgeSubnet); a null value means the server is mis-provisioned and must be fixed before provisioning cubes on this host.`
        );
      }
      const existingCubes = await tx.query.cubes.findMany({
        where: and(eq(cubes.serverId, serverId), ne(cubes.status, "deleted")),
        columns: { internalIp: true },
      });
      const existingOctets = existingCubes
        .map((v) => v.internalIp)
        .filter((ip): ip is string => Boolean(ip))
        .map(octetOf);
      const octet = allocateInternalOctet(existingOctets);
      const ip = cubeIpv4Address(S, octet);
      const ipv6 = cubeIpv6Address(S, octet);
      await tx
        .update(cubes)
        .set({ internalIp: ip, internalIpv6: ipv6, updatedAt: new Date() })
        .where(eq(cubes.id, cubeId));
      return { internalIp: ip, internalIpv6: ipv6 };
    }));
    await log.info(`Allocated internal IP ${internalIp} / ${internalIpv6}`);

    // 5. Clean any stale workspace from a prior failed attempt + recreate.
    await execCommand(
      client,
      `PID=$(cat ${shellEscape(cubePaths(cubeId, launchMode).pidFile)} 2>/dev/null) && [ -n "$PID" ] && kill -9 "$PID" 2>/dev/null || true`
    );
    if (internalIp) {
      await execCommand(
        client,
        `ip link del ${tapName(internalIp)} 2>/dev/null || true`
      );
    }
    await execCommand(client, `rm -rf /var/lib/krova/cubes/${cubeId}`);

    const cubeDir = `/var/lib/krova/cubes/${cubeId}`;
    const rootfsPath = `${cubeDir}/rootfs.ext4`;
    await execCommand(client, `mkdir -p ${cubeDir}`);
    await execCommand(
      client,
      `echo ${shellEscape(internalIp)} > ${cubeDir}/ip.txt`
    );

    // 6. Heartbeat block — restic dump + grow + fsck + mount can take
    //    well over 10 minutes for a multi-GB rootfs.
    await withCubeHeartbeat(cubeId, async () => {
      await log.step("Restic dump source snapshot", async () => {
        await resticDump(
          client,
          repoConfig,
          snapshot.storagePath as string,
          "rootfs.ext4",
          rootfsPath
        );
      });

      // Look up the source cube's original disk size so we know whether
      // the customer asked for a larger destination disk (grow allowed)
      // or a smaller one (rejected at the action layer; defense-in-depth
      // here).
      const sourceCube = await db.query.cubes.findFirst({
        where: eq(cubes.id, sourceCubeId),
        columns: { diskLimitGb: true },
      });
      const sourceDiskGb = sourceCube?.diskLimitGb ?? claimed.diskLimitGb;

      if (claimed.diskLimitGb < sourceDiskGb) {
        throw new Error(
          `Destination disk ${claimed.diskLimitGb} GB is smaller than source ${sourceDiskGb} GB — ext4 cannot shrink`
        );
      }

      if (claimed.diskLimitGb > sourceDiskGb) {
        await log.step(
          `Grow rootfs ${sourceDiskGb}G → ${claimed.diskLimitGb}G`,
          async () => {
            const truncate = await execCommand(
              client,
              `truncate -s ${claimed.diskLimitGb}G ${shellEscape(rootfsPath)}`,
              60_000
            );
            if (truncate.exitCode !== 0) {
              throw new Error(`truncate failed: ${truncate.stderr}`);
            }
            const preFsck = await execCommand(
              client,
              `${ioNicePrefix()}e2fsck -fy ${shellEscape(rootfsPath)}`,
              600_000
            );
            if (preFsck.exitCode >= 4) {
              throw new Error(
                `Pre-grow fsck failed (exit=${preFsck.exitCode}): ${(preFsck.stderr || preFsck.stdout).slice(-500)}`
              );
            }
            const resize = await execCommand(
              client,
              `${ioNicePrefix()}resize2fs ${shellEscape(rootfsPath)}`,
              600_000
            );
            if (resize.exitCode !== 0) {
              throw new Error(`resize2fs failed: ${resize.stderr}`);
            }
          }
        );
      } else {
        await log.info("Checking filesystem and replaying journal");
        const fsck = await execCommand(
          client,
          `${ioNicePrefix()}e2fsck -fy ${shellEscape(rootfsPath)}`,
          600_000
        );
        if (fsck.exitCode >= 4) {
          throw new Error(
            `Cloned rootfs has unrecoverable errors (e2fsck exit=${fsck.exitCode}): ${(fsck.stderr || fsck.stdout).slice(-500)}`
          );
        }
      }

      // 7. Loop-mount + rewrite guest network (the dumped rootfs has the
      //    SOURCE cube's IP baked into systemd-networkd) + overwrite the
      //    customer's authorized_keys.
      const mountDir = `/tmp/krova-mount-${cubeId}`;
      await execCommand(client, `rm -rf ${mountDir}`);
      await execCommand(client, `mkdir -p ${mountDir}`);
      const mountRes = await execCommand(
        client,
        `mount -o loop ${shellEscape(rootfsPath)} ${mountDir}`,
        120_000
      );
      if (mountRes.exitCode !== 0) {
        throw new Error(`Failed to mount rootfs: ${mountRes.stderr}`);
      }
      try {
        if (!internalIp) {
          throw new Error("internal IP not allocated");
        }
        await writeCubeGuestNetworkConfig(client, mountDir, internalIp);
        await log.info(
          `Rewrote guest network config for new internal IP ${internalIp}`
        );
        await execCommand(
          client,
          `mkdir -p ${mountDir}/root/.ssh && chmod 700 ${mountDir}/root/.ssh`
        );
        const keyB64 = Buffer.from(`${sshPublicKey}\n`).toString("base64");
        await execCommand(
          client,
          `echo '${keyB64}' | base64 -d > ${mountDir}/root/.ssh/authorized_keys && chmod 600 ${mountDir}/root/.ssh/authorized_keys`
        );
        await log.info("Injected customer SSH public key into rootfs");
      } finally {
        await execCommand(client, `umount ${mountDir}`, 60_000).catch(() => {});
        await execCommand(client, `rmdir ${mountDir}`).catch(() => {});
      }
    });

    // 8. Boot the VM.
    const { hasVirtioMem } = await startCube(client, cubeId, {
      vcpus: claimed.vcpus,
      ramMb: claimed.ramMb,
      internalIp,
      launchMode,
      jailerUid,
      // New cube: allocateServerAndCreateCube already assigned a node for THIS
      // destination, so it pins correctly on first boot.
      ...(await cubeNumaLaunchOpts(cubeId)),
    });
    vmStarted = true;

    // 9. SSH iptables forward + tcp_port_mappings row (mirrors
    //    cube-import-rootfs.ts).
    const [portRecord] = await db
      .select({ id: allocatedPorts.id, port: allocatedPorts.port })
      .from(allocatedPorts)
      .where(
        and(
          eq(allocatedPorts.cubeId, cubeId),
          eq(allocatedPorts.purpose, "ssh")
        )
      )
      .limit(1);
    if (!portRecord) {
      throw new Error(`No SSH port allocated for cube ${cubeId}`);
    }
    allocatedSshPort = portRecord.port;
    await addTcpPortForward(
      client,
      allocatedSshPort,
      internalIp,
      DEFAULT_CUBE_SSH_PORT,
      []
    );
    await db.insert(tcpPortMappings).values({
      cubeId,
      cubePort: DEFAULT_CUBE_SSH_PORT,
      hostPort: allocatedSshPort,
      allocatedPortId: portRecord.id,
      label: "SSH",
      isSsh: true,
      status: "active",
    });

    // 10. Wait briefly for guest agent (best-effort).
    let responsive = false;
    for (let attempt = 0; attempt < 45; attempt++) {
      if (await guestPing(client, cubeId)) {
        responsive = true;
        break;
      }
      await sleep(2000);
    }
    if (!responsive) {
      await log.warn("Guest agent did not respond within 90 s — continuing");
    }

    // 11. Track booted kernel + mark running.
    let refreshedKernelVersion: number | null = null;
    try {
      const [serverRow] = await db
        .select({ currentKernelVersion: servers.currentKernelVersion })
        .from(servers)
        .where(eq(servers.id, serverId))
        .limit(1);
      if (serverRow) {
        refreshedKernelVersion = serverRow.currentKernelVersion;
      }
    } catch {
      // best-effort
    }

    await db
      .update(cubes)
      .set({
        status: "running",
        internalIp,
        lastBilledAt: new Date(),
        lastStartedAt: new Date(),
        hasVirtioMem,
        ...(refreshedKernelVersion === null
          ? {}
          : { bootedKernelVersion: refreshedKernelVersion }),
        updatedAt: new Date(),
      })
      .where(eq(cubes.id, cubeId));

    await triggerCubeLifecycleEvent(cubeId, spaceId, {
      status: "running",
      internalIp,
    });

    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `Cube cloned from snapshot "${snapshot.name}" of cube ${sourceCubeId}`,
    });

    audit({
      action: "cube.clone_from_snapshot_complete",
      category: "cube",
      actorType: "user",
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Cube cloned from snapshot ${sourceSnapshotId}`,
      metadata: { sourceCubeId, sourceSnapshotId },
      source: "worker",
    });

    await log.info(`Cube cloned and running (internal IP ${internalIp})`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[cube-from-snapshot] failed cubeId=${cubeId}: ${reason}`);
    await log.error(`Clone failed: ${reason}`);
    // If the VM was already booted, a post-boot step failed — kill the live
    // Firecracker (+ TAP + cube dir) so we don't strand an orphan running on
    // the host while the row goes to `error` (mirrors cube-import-rootfs.ts;
    // destroyCubeVm subsumes the iptables DNAT removal below). Most clone
    // failures happen earlier (during restic dump, before startCube) where
    // vmStarted is false and only the port cleanup applies.
    if (vmStarted) {
      await destroyCubeVm(
        client,
        cubeId,
        internalIp ?? undefined,
        launchMode
      ).catch(() => {});
    } else if (allocatedSshPort && internalIp) {
      await removeTcpPortForward(
        client,
        allocatedSshPort,
        internalIp,
        DEFAULT_CUBE_SSH_PORT
      ).catch(() => {});
    }
    await failClone(cubeId, serverId, reason);
  } finally {
    client.end();
  }
}

async function failClone(
  cubeId: string,
  serverId: string,
  reason: string
): Promise<void> {
  // Mirrors cube-import-rootfs's failure pattern — cubes table has no
  // errorMessage column; status='error' + a lifecycle log entry is the
  // canonical signal to the customer. Rule 52: pair with lastBilledAt=null.
  await db
    .update(cubes)
    .set({ status: "error", lastBilledAt: null, updatedAt: new Date() })
    .where(eq(cubes.id, cubeId))
    .catch(() => {});
  await db
    .insert(lifecycleLogs)
    .values({
      entityType: "cube",
      entityId: cubeId,
      message: `Clone from snapshot failed: ${reason.slice(0, 500)}`,
    })
    .catch(() => {});

  // Free the resources the server action allocated for this clone (audit M2):
  // the SSH tcp_port_mappings row, the allocatedPorts reservation, and the
  // server's allocated CPU/RAM/disk counters. Without this they leak until an
  // unrelated create/delete on the server triggers a reconcile — and because
  // the cube never reached `running` (lastStartedAt=null), cube.error-recovery
  // won't revive it, so it's a dead error cube holding allocations. We flip to
  // `error` FIRST (above) so reconcileServerResources (which excludes `error`)
  // recomputes the counters without this clone's reservation.
  await db
    .delete(tcpPortMappings)
    .where(eq(tcpPortMappings.cubeId, cubeId))
    .catch(() => {});
  await db
    .delete(allocatedPorts)
    .where(eq(allocatedPorts.cubeId, cubeId))
    .catch(() => {});
  await db
    .transaction(async (tx) => reconcileServerResources(tx, serverId))
    .catch(() => {});
}

export async function handleCubeFromSnapshot(
  jobs: Job<CubeFromSnapshotPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleCubeFromSnapshotJob(job);
  }
}
