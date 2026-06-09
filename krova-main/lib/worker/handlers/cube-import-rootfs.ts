/**
 * Provision a new cube from a customer-uploaded `.cube` archive.
 *
 * Triggered by the `/cubes/imports/{id}/complete` endpoint AFTER the
 * customer's multipart upload has been finalized on S3 and the cube
 * row has been created (pending). This handler:
 *
 *   1. Loads the cube_imports row + new cube row.
 *   2. Atomically claims the cube (pending → booting).
 *   3. SSHes to the allocated server, sets up the cube workspace.
 *   4. rclone-downloads the `.cube` archive from S3.
 *   5. Extracts (sha256-verifies, decompresses rootfs, ext4 sanity).
 *   6. Optionally grows the rootfs to a larger disk size if the
 *      customer requested an upward override at initiate time.
 *   7. fsck + (if sshKeyMode='replace') loop-mounts and overwrites
 *      /root/.ssh/authorized_keys.
 *   8. Boots the Firecracker VM via the standard startCube path.
 *   9. Sets up the SSH port forward + tcp_port_mappings row.
 *  10. Marks cube running + import complete + deletes the S3 archive.
 *
 * On any failure: marks cube `error`, marks import `failed`, decrements
 * server resources, frees ports, leaves the .cube on S3 for operator
 * inspection (the reaper picks it up after 7 days).
 */

import { and, eq, ne, sql } from "drizzle-orm";
import type { Job } from "pg-boss";

import { DEFAULT_CUBE_SSH_PORT } from "@/config/platform";
import {
  allocatedPorts,
  cubeImports,
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
import {
  cubeIpv4Address,
  cubeIpv6Address,
  octetOf,
} from "@/lib/server/cube-network";
import {
  addTcpPortForward,
  allocateInternalOctet,
  connectToServer,
  deleteCube as destroyCubeVm,
  execCommand,
  guestPing,
  removeTcpPortForward,
  shellEscape,
  startCube,
  tapName,
  writeCubeGuestNetworkConfig,
} from "@/lib/ssh";
import { cubePaths } from "@/lib/ssh/jailer";
import { getBackendConnection } from "@/lib/storage/backends";
import { extractCubeArchive } from "@/lib/storage/cube-archive";
import { s3DeleteObject } from "@/lib/storage/s3-direct";
import { s3HostDownload } from "@/lib/storage/s3-transfer";
import { sleep } from "@/lib/utils";
import { withCubeHeartbeat } from "@/lib/worker/cube-heartbeat";
import { JobLogger } from "@/lib/worker/job-log";
import type { CubeImportRootfsPayload } from "@/lib/worker/job-types";

async function handleCubeImportRootfsJob(
  job: Job<CubeImportRootfsPayload>
): Promise<void> {
  const { importId } = job.data;

  // 1. Load the import row. Pull the cube_id captured by /complete —
  //    everything we need flows from there.
  const importRow = await db.query.cubeImports.findFirst({
    where: eq(cubeImports.id, importId),
  });
  if (!importRow) {
    console.log(`[cube-import-rootfs] import ${importId} not found, skipping`);
    return;
  }
  if (importRow.status !== "provisioning") {
    console.log(
      `[cube-import-rootfs] import ${importId} status=${importRow.status}, skipping`
    );
    return;
  }
  if (!importRow.cubeId) {
    await failImport(importId, "Import has no associated cube id");
    return;
  }
  const cubeId = importRow.cubeId;
  const spaceId = importRow.spaceId;

  const log = new JobLogger(job.id, "cube.import-rootfs", "cube", cubeId);
  console.log(
    `[cube-import-rootfs] starting importId=${importId} cubeId=${cubeId}`
  );
  await log.info(`Cube import started (importId=${importId})`);

  // 2. Atomically claim the cube — must be pending.
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
      launchMode: cubes.launchMode,
      jailerUid: cubes.jailerUid,
    });
  if (!claimed) {
    // The cube isn't `pending`. If THIS import already drove it to `running`
    // (the worker died / the job expired AFTER startCube succeeded but BEFORE
    // flipping the import `complete`), reconcile the import to `complete` +
    // delete the now-superseded .cube — rather than marking a HEALTHY cube's
    // import `failed` and leaking the S3 archive (audit M-4). The cube row was
    // created for THIS import, so a `running` status can only mean a prior run
    // of this handler succeeded. Any other status is a genuine no-op.
    const [existing] = await db
      .select({ status: cubes.status })
      .from(cubes)
      .where(eq(cubes.id, cubeId))
      .limit(1);
    if (existing?.status === "running") {
      await db
        .update(cubeImports)
        .set({ status: "complete", updatedAt: new Date() })
        .where(
          and(
            eq(cubeImports.id, importId),
            eq(cubeImports.status, "provisioning")
          )
        );
      try {
        const backend = await getBackendConnection(importRow.storageBackendId);
        if (backend) {
          await s3DeleteObject(importRow.s3Key, backend);
        }
      } catch (err) {
        console.error(
          `[cube-import-rootfs] M-4 reconcile: failed to delete S3 archive ${importRow.s3Key}:`,
          err instanceof Error ? err.message : err
        );
      }
      console.log(
        `[cube-import-rootfs] import ${importId} reconciled to complete (cube already running)`
      );
      return;
    }
    await failImport(importId, "Cube no longer pending");
    return;
  }

  await triggerCubeLifecycleEvent(cubeId, spaceId, { status: "booting" });

  const serverId = claimed.serverId;

  // Resolve the Firecracker launch mode (bare vs jailed) + jailer uid ONCE,
  // before the first host side effect. Runs in its own DB transaction,
  // persists any mode/uid transition, and applies the JAILER_ENABLED policy.
  // The cube row already exists (created at /complete), so we feed its current
  // launch_mode / jailer_uid in — a fresh import row defaults to bare/null.
  const { launchMode, jailerUid } = await resolveLaunchModeForCube({
    id: cubeId,
    serverId,
    launchMode: claimed.launchMode,
    jailerUid: claimed.jailerUid,
  });

  // Guarded connect so a host-down doesn't strand the cube in `booting` +
  // the import in `provisioning`. Connect fails before any IP/port/VM is
  // allocated, so the rich client-dependent cleanup in the main catch isn't
  // needed — just flip the cube to `error` (revivable via cube:inspect
  // --restart) and fail the import row.
  let client: Awaited<ReturnType<typeof connectToServer>>["client"];
  try {
    client = (await connectToServer(serverId)).client;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[cube-import-rootfs] connect failed importId=${importId}: ${reason}`
    );
    await log.error(`Cube import failed: ${reason}`);
    // The SSH port + server CPU/RAM/disk counters were reserved at /complete
    // (allocateServerAndCreateCube), BEFORE this worker ran — so a host-down
    // here must release them or they leak permanently (the cube parks in
    // `error` and is never auto-revived). Mirror the main catch (audit CC-1).
    await releaseImportCubeAllocations(serverId, cubeId, claimed);
    await db
      .update(cubes)
      .set({ status: "error", lastBilledAt: null, updatedAt: new Date() })
      .where(eq(cubes.id, cubeId));
    await db
      .insert(lifecycleLogs)
      .values({
        entityType: "cube",
        entityId: cubeId,
        message: `Cube import failed: ${reason}`,
      })
      .catch(() => {});
    await triggerCubeLifecycleEvent(cubeId, spaceId, { status: "error" });
    await failImport(importId, reason);
    audit({
      action: "cube.import_failed",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Cube import failed: ${reason}`,
      metadata: { importId, error: reason },
      source: "worker",
    });
    return;
  }

  let internalIp: string | null = null;
  let internalIpv6: string | null = null;
  let sshPortAllocated = false;
  let allocatedSshPort: number | null = null;

  try {
    // 3. Allocate internal IP — serialized via Postgres advisory xact lock
    //    keyed on a hash of the destination server id (same pattern as
    //    cube-transfer's destination IP allocation). Without this, two
    //    concurrent imports to the same server can both read the same set
    //    of existing IPs and both pick the same next IP (audit H6,
    //    2026-05-24). The lock is per-transaction so it auto-releases on
    //    commit/rollback. Reads the server's bridge_subnet (S), picks the
    //    lowest free octet, and derives BOTH the IPv4 and IPv6 address.
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

    // 4. Clean up stale state from any prior failed attempt + create
    //    the cube workspace.
    await execCommand(
      client,
      `PID=$(cat ${shellEscape(cubePaths(cubeId, launchMode).pidFile)} 2>/dev/null) && [ -n "$PID" ] && kill -9 "$PID" 2>/dev/null || true`
    );
    const tap = tapName(internalIp);
    await execCommand(client, `ip link del ${tap} 2>/dev/null || true`);
    await execCommand(client, `rm -rf /var/lib/krova/cubes/${cubeId}`);

    const cubeDir = `/var/lib/krova/cubes/${cubeId}`;
    const archivePath = `${cubeDir}/${importId}.cube`;
    const rootfsPath = `${cubeDir}/rootfs.ext4`;
    await execCommand(client, `mkdir -p ${cubeDir}`);
    await execCommand(
      client,
      `echo ${shellEscape(internalIp)} > ${cubeDir}/ip.txt`
    );

    // 5. Resolve the backend the upload landed on.
    const backend = await getBackendConnection(importRow.storageBackendId);
    if (!backend) {
      throw new Error(
        `Storage backend ${importRow.storageBackendId} not found`
      );
    }

    // 6. Download → extract → optional disk grow → fsck → mount + key
    //    inject (if replace) → done. All inside one heartbeat block:
    //    the cube sits in `booting` throughout and a multi-GB archive
    //    can take 10+ minutes — without the heartbeat,
    //    cube.stale-check would mark the cube stuck and enqueue a
    //    parallel cube.delete that wipes the rootfs we're working on.
    await withCubeHeartbeat(cubeId, async () => {
      await log.step("Download archive from storage backend", async () => {
        await s3HostDownload(client, importRow.s3Key, archivePath, backend);
      });

      const extracted = await log.step(
        "Extract .cube archive (verify + decompress)",
        async () =>
          await extractCubeArchive(client, {
            archivePath,
            workDir: cubeDir,
            targetDir: cubeDir,
          })
      );
      if (extracted.rangeIssues.length > 0) {
        // Range issues are platform-range warnings, not hard errors.
        // They were already surfaced to the customer at initiate time;
        // we log them again here for the audit trail.
        await log.warn(
          `Manifest range warnings: ${extracted.rangeIssues.join("; ")}`
        );
      }

      // Disk sizing — decided against the GROUND-TRUTH decompressed rootfs size
      // (extracted.rootfsSizeBytes, which host-extract HARD-verifies equals the
      // manifest's uncompressedSizeBytes), NOT the manifest's self-reported
      // config.diskLimitGb (that equality is only a soft range-warning, so a
      // hand-crafted .cube could declare config.diskLimitGb:10 while shipping a
      // 50G rootfs). A Firecracker rootfs is a fixed-size ext4 image == the
      // cube's disk; we can grow it UP (resize2fs) but NEVER shrink.
      const claimedBytes = claimed.diskLimitGb * 1024 * 1024 * 1024;
      const sourceGb = Math.round(
        extracted.rootfsSizeBytes / (1024 * 1024 * 1024)
      );
      // SECURITY/BILLING guard (audit I-2): refuse a rootfs larger than the
      // disk the customer is paying for. Booting it would overcommit the host
      // (Rule 53 — disk sold 1:1, no oversell) and underbill. Fail loud; the
      // main catch flips the cube to `error` + frees its resources.
      if (extracted.rootfsSizeBytes > claimedBytes) {
        throw new Error(
          `Imported rootfs (${sourceGb}G / ${extracted.rootfsSizeBytes} bytes) exceeds the requested cube disk (${claimed.diskLimitGb}G) — refusing to boot an oversized rootfs`
        );
      }
      // Optional disk grow — only allowed UP (shrinking would corrupt ext4).
      if (claimedBytes > extracted.rootfsSizeBytes) {
        await log.step(
          `Grow rootfs ${sourceGb}G → ${claimed.diskLimitGb}G`,
          async () => {
            const truncate = await execCommand(
              client,
              `truncate -s ${claimed.diskLimitGb}G ${shellEscape(rootfsPath)}`,
              60_000
            );
            if (truncate.exitCode !== 0) {
              throw new Error(`truncate failed: ${truncate.stderr}`);
            }
            // resize2fs requires a clean fs (e2fsck succeeds first).
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
        // No grow — still run e2fsck to clean any dirty journal from
        // the source cube's live snapshot (matches backup-redeploy).
        await log.info("Checking filesystem and replaying journal");
        const fsck = await execCommand(
          client,
          `${ioNicePrefix()}e2fsck -fy ${shellEscape(rootfsPath)}`,
          600_000
        );
        if (fsck.exitCode >= 4) {
          const tail = (fsck.stderr || fsck.stdout).slice(-500);
          throw new Error(
            `Imported rootfs has unrecoverable errors (e2fsck exit=${fsck.exitCode}): ${tail}`
          );
        }
      }

      // 7. Mount rootfs to:
      //    a) ALWAYS rewrite the guest network config with the new
      //       internal IP (the imported .cube was built on a different
      //       host with a different internal IP baked into
      //       systemd-networkd / netplan; without this rewrite the
      //       cube boots with the WRONG IP and is unreachable).
      //    b) Conditionally inject the customer's SSH public key when
      //       sshKeyMode === "replace". On "keep", leave the rootfs's
      //       existing authorized_keys alone — customer accepted the
      //       "you need the matching private key" warning at initiate.
      const sshPublicKey = importRow.sshPublicKey;
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

        if (importRow.sshKeyMode === "replace") {
          if (!sshPublicKey) {
            throw new Error("ssh_key_mode=replace but ssh_public_key is null");
          }
          await execCommand(
            client,
            `mkdir -p ${mountDir}/root/.ssh && chmod 700 ${mountDir}/root/.ssh`
          );
          const keyB64 = Buffer.from(sshPublicKey + "\n").toString("base64");
          await execCommand(
            client,
            `echo '${keyB64}' | base64 -d > ${mountDir}/root/.ssh/authorized_keys && chmod 600 ${mountDir}/root/.ssh/authorized_keys`
          );
          await log.info("Injected customer SSH public key into rootfs");
        } else {
          await log.info(
            "ssh_key_mode=keep — leaving imported rootfs's authorized_keys untouched"
          );
        }
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

    // 9. Grab the SSH port that allocateServerAndCreateCube
    //    pre-allocated, set up the iptables forward, persist the
    //    mapping row (same shape as backup-redeploy).
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
    sshPortAllocated = true;

    // Every freshly-imported cube boots with sshd on `DEFAULT_CUBE_SSH_PORT`
    // — the rootfs in the `.cube` archive ships with sshd at port 22, and
    // the customer can later move it via the Networking-tab PATCH flow.
    // See `config/platform.ts` for the constant's rationale.
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

    // 10. Wait for guest agent (best-effort — non-fatal).
    let cubeResponsive = false;
    for (let attempt = 0; attempt < 45; attempt++) {
      if (await guestPing(client, cubeId)) {
        cubeResponsive = true;
        break;
      }
      await sleep(2000);
    }
    if (!cubeResponsive) {
      await log.warn(
        "Guest agent did not respond within 90 s — continuing anyway"
      );
    }

    // Track the booted kernel version (matches backup-redeploy).
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
    } catch (err) {
      console.warn(
        "[cube-import-rootfs] kernel version refresh failed (non-fatal):",
        err instanceof Error ? err.message : err
      );
    }

    // 11. Mark cube running.
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

    // 12. Mark import complete + record audit + lifecycle log.
    await db
      .update(cubeImports)
      .set({
        status: "complete",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(cubeImports.id, importId));

    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: "Cube imported from .cube archive",
    });

    audit({
      action: "cube.import_complete",
      category: "cube",
      actorType: importRow.createdBy ? "user" : "system",
      actorId: importRow.createdBy,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: "Imported cube from .cube archive",
      metadata: { importId, sshKeyMode: importRow.sshKeyMode },
      source: "worker",
    });

    // 13. Delete the archive from S3 — the new cube's rootfs is the
    //     canonical copy now. Best-effort: a failure here is benign
    //     (the reaper or storage:audit will catch the orphan), so we
    //     log and continue.
    try {
      await s3DeleteObject(importRow.s3Key, backend);
    } catch (err) {
      console.warn(
        `[cube-import-rootfs] failed to clean up S3 archive ${importRow.s3Key}:`,
        err
      );
    }

    await log.info("Cube import complete");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[cube-import-rootfs] failed importId=${importId}:`, reason);
    await log.error(`Cube import failed: ${reason}`);

    // Best-effort VM cleanup
    try {
      await destroyCubeVm(
        client,
        cubeId,
        internalIp ?? undefined,
        launchMode
      ).catch(() => {});
      if (sshPortAllocated && allocatedSshPort && internalIp) {
        await removeTcpPortForward(
          client,
          allocatedSshPort,
          internalIp,
          DEFAULT_CUBE_SSH_PORT
        ).catch(() => {});
      }
    } catch {
      // Best-effort
    }

    // Drop the SSH tcp mapping row + free allocated ports + decrement server
    // resource counters (shared with the early-connect guard so neither path
    // leaks the /complete-time allocations — audit CC-1).
    await releaseImportCubeAllocations(serverId, cubeId, claimed);

    // Rule 52: pair status="error" with lastBilledAt=null (defense in depth).
    await db
      .update(cubes)
      .set({ status: "error", lastBilledAt: null, updatedAt: new Date() })
      .where(eq(cubes.id, cubeId));

    await db
      .insert(lifecycleLogs)
      .values({
        entityType: "cube",
        entityId: cubeId,
        message: `Cube import failed: ${reason}`,
      })
      .catch(() => {});

    await triggerCubeLifecycleEvent(cubeId, spaceId, { status: "error" });

    await failImport(importId, reason);

    audit({
      action: "cube.import_failed",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Cube import failed: ${reason}`,
      metadata: { importId, error: reason },
      source: "worker",
    });

    throw err;
  } finally {
    client.end();
  }
}

/**
 * Release the host allocations the `/complete` step reserved for an import cube
 * (the SSH `tcp_port_mappings` row + the server CPU/RAM/disk counters + the
 * `allocated_ports` rows) before parking the cube in `error`. Shared by the
 * early-connect guard AND the main catch so NO failure path leaks the SSH port
 * / over-counts the server (audit CC-1) — `reconcileServerResources` excludes
 * `error` cubes so the counters self-heal eventually, but it never frees
 * `allocated_ports`, so the port would leak permanently without this. All
 * steps are best-effort and never throw.
 */
async function releaseImportCubeAllocations(
  serverId: string,
  cubeId: string,
  claimed: { vcpus: number; ramMb: number; diskLimitGb: number }
): Promise<void> {
  await db
    .delete(tcpPortMappings)
    .where(eq(tcpPortMappings.cubeId, cubeId))
    .catch(() => {});

  await db
    .transaction(async (tx) => {
      const [srv] = await tx
        .select()
        .from(servers)
        .where(eq(servers.id, serverId))
        .for("update")
        .limit(1);
      if (srv) {
        await tx
          .update(servers)
          .set({
            allocatedCpus: Math.max(0, srv.allocatedCpus - claimed.vcpus),
            allocatedRamMb: Math.max(0, srv.allocatedRamMb - claimed.ramMb),
            allocatedDiskGb: Math.max(
              0,
              srv.allocatedDiskGb - claimed.diskLimitGb
            ),
            updatedAt: new Date(),
          })
          .where(eq(servers.id, serverId));
      }
    })
    .catch(() => {});

  await db
    .delete(allocatedPorts)
    .where(eq(allocatedPorts.cubeId, cubeId))
    .catch(() => {});
}

async function failImport(importId: string, reason: string): Promise<void> {
  await db
    .update(cubeImports)
    .set({
      status: "failed",
      error: reason.slice(0, 2000),
      updatedAt: new Date(),
    })
    .where(eq(cubeImports.id, importId))
    .catch((err) => {
      console.error(
        `[cube-import-rootfs] failed to mark import ${importId} failed:`,
        err
      );
    });
}

export async function handleCubeImportRootfs(
  jobs: Job<CubeImportRootfsPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleCubeImportRootfsJob(job);
  }
}
