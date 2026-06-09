import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Job } from "pg-boss";
import { DEFAULT_CUBE_SSH_PORT } from "@/config/platform";
import {
  allocatedPorts,
  cubeBackups,
  cubes,
  domainMappings,
  lifecycleLogs,
  servers,
  tcpMappingWhitelistedIps,
  tcpPortMappings,
} from "@/db/schema";
import type { CubeBackupConfig } from "@/db/schema/backups";
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
import { s3HostDownload } from "@/lib/storage/s3-transfer";
import { sleep } from "@/lib/utils";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildBackupPayload } from "@/lib/webhook-payloads";
import { withCubeHeartbeat } from "@/lib/worker/cube-heartbeat";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JobLogger } from "@/lib/worker/job-log";
import type { BackupRedeployPayload } from "@/lib/worker/job-types";
import { JOB_NAMES } from "@/lib/worker/job-types";

/**
 * Redeploy a Cube from a pre-deletion backup.
 *
 * Instead of booting a fresh VM and then replacing the rootfs (wasteful),
 * this handler directly:
 * 1. Allocates an internal IP
 * 2. Downloads the backup rootfs from the storage backend
 * 3. Injects the new SSH key using base64 encoding (safe against injection)
 * 4. Boots the VM from the restored rootfs using startCube
 * 5. Sets up SSH port forwarding
 * 6. Re-creates domain and TCP mappings from stored config
 *
 * On failure, it fully cleans up: kills VM, frees ports, decrements server
 * resources, and marks the cube as error — mirroring cube-boot.ts cleanup.
 */
async function handleBackupRedeployJob(
  job: Job<BackupRedeployPayload>
): Promise<void> {
  const {
    backupId,
    spaceId,
    newCubeId,
    serverId,
    sshPublicKey,
    sshKeyMode,
    originalDiskLimitGb,
  } = job.data;
  const effectiveSshKeyMode = sshKeyMode ?? "replace";
  const logPrefix = `[backup-redeploy:${newCubeId}]`;
  const log = new JobLogger(job.id, "backup.redeploy", "cube", newCubeId);
  console.log(`${logPrefix} starting for backupId=${backupId}`);
  await log.info(`Cube redeploy from backup started (backupId=${backupId})`);

  // 1. Load backup — must be complete with a valid storage object key
  const backup = await db.query.cubeBackups.findFirst({
    where: eq(cubeBackups.id, backupId),
  });
  if (backup?.status !== "complete") {
    console.log(
      `${logPrefix} backup ${backupId} not complete, marking cube as error`
    );
    // Rule 52: pair status="error" with lastBilledAt=null (defense in depth
    // — the redeployed cube row is fresh with lastBilledAt already null,
    // but uniform invariant enforcement makes the codebase robust).
    await db
      .update(cubes)
      .set({ status: "error", lastBilledAt: null, updatedAt: new Date() })
      .where(eq(cubes.id, newCubeId));
    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: newCubeId,
      message: "Redeploy failed: backup no longer available",
    });
    return;
  }
  if (!backup.storagePath) {
    throw new Error(`Backup ${backupId} has no storage path`);
  }

  const config = backup.cubeConfig as CubeBackupConfig;

  // 2. Claim the cube — must be pending. We RETURN the new cube's
  //    sized columns (vcpus / ramMb / diskLimitGb) because they may
  //    differ from the backup's saved `config` — the server action
  //    applies optional customer-supplied overrides when allocating
  //    the new row. The worker must respect those overrides (boot
  //    with the new vcpus/ramMb, grow the rootfs if the new
  //    diskLimitGb is bigger than the backup's saved size).
  const [claimed] = await db
    .update(cubes)
    .set({ status: "booting", updatedAt: new Date() })
    .where(and(eq(cubes.id, newCubeId), eq(cubes.status, "pending")))
    .returning({
      name: cubes.name,
      vcpus: cubes.vcpus,
      ramMb: cubes.ramMb,
      diskLimitGb: cubes.diskLimitGb,
    });

  if (!claimed) {
    console.log(`${logPrefix} cube not pending, skipping`);
    return;
  }

  await triggerCubeLifecycleEvent(newCubeId, spaceId, { status: "booting" });

  // 3. Load server and SSH key. Guarded connect so a host-down doesn't strand
  //    the new cube in `booting`. Connect fails before any IP/port/VM is
  //    allocated, so the client-dependent cleanup in the main catch isn't
  //    needed — just flip the cube to `error` (revivable via cube:inspect
  //    --restart).
  let client: Awaited<ReturnType<typeof connectToServer>>["client"];
  try {
    client = (await connectToServer(serverId)).client;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`${logPrefix} connect failed: ${reason}`);
    await log.error(`Redeploy failed: ${reason}`);
    // The SSH port + server CPU/RAM/disk counters were reserved at allocation
    // time, BEFORE this worker ran — release them so a host-down here doesn't
    // leak them permanently (the cube parks in `error`, never auto-revived).
    // Mirror the main catch (audit CC-1).
    await releaseRedeployCubeAllocations(serverId, newCubeId, claimed);
    await db
      .update(cubes)
      .set({ status: "error", lastBilledAt: null, updatedAt: new Date() })
      .where(eq(cubes.id, newCubeId));
    await db
      .insert(lifecycleLogs)
      .values({
        entityType: "cube",
        entityId: newCubeId,
        message: `Redeploy from backup failed: ${reason}`,
      })
      .catch(() => {});
    await triggerCubeLifecycleEvent(newCubeId, spaceId, { status: "error" });
    audit({
      action: "backup.redeploy_failed",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: newCubeId,
      spaceId,
      description: `Redeploy from backup failed: ${reason}`,
      metadata: { backupId, newCubeId, error: reason },
      source: "worker",
    });
    return;
  }

  // Resolve the launch mode ONCE for this fresh cube (defaults bare/null) and
  // persist any transition. Threaded into the inline pid-kill path cleanup,
  // startCube, and the cleanup destroyCubeVm below. With JAILER_ENABLED=false
  // this returns "bare", so cubePaths(newCubeId, "bare") === the legacy paths
  // and every command/control-flow stays byte-identical.
  const { launchMode, jailerUid } = await resolveLaunchModeForCube({
    id: newCubeId,
    serverId,
    launchMode: "bare",
    jailerUid: null,
  });

  let internalIp: string | null = null;
  let internalIpv6: string | null = null;
  let sshPortAllocated = false;
  let allocatedSshPort: number | null = null;

  try {
    // 4. Allocate internal IP — serialized via a Postgres advisory xact lock
    //    keyed on a hash of the server id (C4 fix: this allocation was
    //    previously UNLOCKED, so two concurrent redeploys on the same host
    //    could read the same in-use set and pick the same octet). Reads the
    //    server's bridge_subnet (S), picks the lowest free octet, derives BOTH
    //    the IPv4 and IPv6 address, and persists them in the same locked tx.
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
          `Server ${serverId} has no bridge_subnet — every active server is assigned one at create (allocateBridgeSubnet); a null value means the server is mis-provisioned and must be fixed before redeploying cubes on this host.`
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
        .where(eq(cubes.id, newCubeId));
      return { internalIp: ip, internalIpv6: ipv6 };
    }));
    console.log(`${logPrefix} allocated IP: ${internalIp} / ${internalIpv6}`);
    await log.info(`Allocated internal IP ${internalIp} / ${internalIpv6}`);

    // 5. Clean up any stale resources from a previous failed attempt
    await execCommand(
      client,
      `PID=$(cat ${shellEscape(cubePaths(newCubeId, launchMode).pidFile)} 2>/dev/null) && [ -n "$PID" ] && kill -9 "$PID" 2>/dev/null || true`
    );
    const tap = tapName(internalIp);
    await execCommand(client, `ip link del ${tap} 2>/dev/null || true`);
    await execCommand(client, `rm -rf /var/lib/krova/cubes/${newCubeId}`);

    // 6. Create cube directory
    const cubeDir = `/var/lib/krova/cubes/${newCubeId}`;
    const rootfsPath = `${cubeDir}/rootfs.ext4`;
    const archivePath = `${cubeDir}/${backupId}.cube`;
    await execCommand(client, `mkdir -p ${cubeDir}`);
    await execCommand(
      client,
      `echo ${shellEscape(internalIp)} > ${cubeDir}/ip.txt`
    );

    // 7. Download → extract (sha256-verify + decompress + ext4 sanity)
    //    → fsck → mount → inject key. All wrapped in one heartbeat
    //    block: the cube sits in `booting` throughout, and on a multi-
    //    GB rootfs under I/O contention this whole span can exceed
    //    10 min, which would let cube.stale-check kill us and race
    //    with cube.delete (wiping the rootfs we're working on).
    const storagePath = backup.storagePath;
    if (!storagePath) {
      throw new Error(`Backup ${backupId} has no storage path`);
    }
    console.log(`${logPrefix} downloading backup archive from storage backend`);
    await log.info("Downloading backup archive from storage backend");
    const backend = backup.storageBackendId
      ? await getBackendConnection(backup.storageBackendId)
      : null;
    if (!backend) {
      throw new Error(`Storage backend not found for backup ${backupId}`);
    }
    const mountDir = `/tmp/krova-mount-${newCubeId}`;
    await withCubeHeartbeat(newCubeId, async () => {
      await s3HostDownload(client, storagePath, archivePath, backend);

      // Extract the .cube archive — verifies checksums, parses manifest,
      // decompresses the rootfs to rootfsPath, runs `file` to confirm
      // ext4. Cleans up the inner intermediates + the .cube on success.
      await log.step(
        "Extract .cube archive (verify + decompress)",
        async () => {
          await extractCubeArchive(client, {
            archivePath,
            workDir: cubeDir,
            targetDir: cubeDir,
          });
        }
      );

      // 7b. Optional disk grow. The new cube row's diskLimitGb may be
      //     LARGER than the backup's saved value (customer chose to
      //     grow at redeploy time). The new row's diskLimitGb is the
      //     TARGET; the backup config's diskLimitGb is the SOURCE
      //     (also passed in via `originalDiskLimitGb` for the
      //     pre-overrides callers). Run e2fsck first (resize2fs
      //     requires a clean fs), then truncate up + resize2fs upward.
      //     Shrink is rejected upstream and never reaches the worker.
      const targetDiskGb = claimed.diskLimitGb;
      const originalGb = originalDiskLimitGb ?? config.diskLimitGb;
      if (targetDiskGb > originalGb) {
        await log.step(
          `Grow rootfs ${originalGb}G → ${targetDiskGb}G`,
          async () => {
            const preFsck = await execCommand(
              client,
              `${ioNicePrefix()}e2fsck -fy ${rootfsPath}`,
              600_000
            );
            if (preFsck.exitCode >= 4) {
              throw new Error(
                `Pre-grow fsck failed (exit=${preFsck.exitCode}): ${(preFsck.stderr || preFsck.stdout).slice(-500)}`
              );
            }
            const truncate = await execCommand(
              client,
              `truncate -s ${targetDiskGb}G ${rootfsPath}`,
              60_000
            );
            if (truncate.exitCode !== 0) {
              throw new Error(`truncate failed: ${truncate.stderr}`);
            }
            const resize = await execCommand(
              client,
              `${ioNicePrefix()}resize2fs ${rootfsPath}`,
              600_000
            );
            if (resize.exitCode !== 0) {
              throw new Error(`resize2fs failed: ${resize.stderr}`);
            }
          }
        );
      } else {
        // No grow — still run e2fsck to clean the dirty journal that
        // backup.create leaves behind (it compresses the rootfs while
        // the source cube is still running, so the on-disk ext4 has an
        // unreplayed journal). Without this, kernel-side journal
        // replay during the subsequent mount can blow past any
        // reasonable timeout on a multi-GB FS under I/O load (the
        // 2026-05-21 "mount -o loop … timed out after 30000ms" mode).
        await log.info("Checking filesystem and replaying journal");
        const fsckResult = await execCommand(
          client,
          `${ioNicePrefix()}e2fsck -fy ${rootfsPath}`,
          600_000
        );
        // e2fsck exit codes: 0=clean, 1=errors corrected, 2=reboot suggested,
        // 4+=errors remain. <4 is safe to mount.
        if (fsckResult.exitCode >= 4) {
          const tail = (fsckResult.stderr || fsckResult.stdout).slice(-500);
          throw new Error(
            `Backup filesystem has unrecoverable errors (e2fsck exit=${fsckResult.exitCode}): ${tail}`
          );
        }
      }

      // 8. Mount rootfs to:
      //    a) ALWAYS rewrite the guest network config with the new
      //       internal IP (the backup was captured with the source
      //       cube's old IP baked into systemd-networkd / netplan;
      //       without this rewrite the cube boots with the WRONG IP
      //       and is unreachable).
      //    b) Conditionally inject the customer's SSH public key when
      //       sshKeyMode === "replace" (default). On "keep", we leave
      //       the rootfs's existing authorized_keys alone.
      await execCommand(client, `rm -rf ${mountDir}`);
      await execCommand(client, `mkdir -p ${mountDir}`);
      const mountResult = await execCommand(
        client,
        `mount -o loop ${rootfsPath} ${mountDir}`,
        120_000
      );
      if (mountResult.exitCode !== 0) {
        throw new Error(`Failed to mount rootfs: ${mountResult.stderr}`);
      }
      try {
        if (!internalIp) {
          throw new Error("internal IP not allocated");
        }
        await writeCubeGuestNetworkConfig(client, mountDir, internalIp);
        await log.info(
          `Rewrote guest network config for new internal IP ${internalIp}`
        );

        if (effectiveSshKeyMode === "replace") {
          if (!sshPublicKey) {
            throw new Error("ssh_key_mode=replace but sshPublicKey is null");
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

    // 9. Boot the VM from restored rootfs using the NEW cube row's
    //    vcpus/ramMb (which honor the customer's override at redeploy
    //    time — these can differ from `config.vcpus` / `config.ramMb`
    //    saved on the backup).
    console.log(`${logPrefix} starting VM`);
    const { hasVirtioMem: redeployHasVirtioMem } = await startCube(
      client,
      newCubeId,
      {
        vcpus: claimed.vcpus,
        ramMb: claimed.ramMb,
        internalIp,
        launchMode,
        jailerUid,
        // New cube (id is `newCubeId`): allocateServerAndCreateCube assigned a
        // node for THIS destination, so it pins correctly on first boot.
        ...(await cubeNumaLaunchOpts(newCubeId)),
      }
    );
    console.log(`${logPrefix} VM started`);

    // 10. Get the SSH port allocated during cube creation
    const [portRecord] = await db
      .select({ id: allocatedPorts.id, port: allocatedPorts.port })
      .from(allocatedPorts)
      .where(
        and(
          eq(allocatedPorts.cubeId, newCubeId),
          eq(allocatedPorts.purpose, "ssh")
        )
      )
      .limit(1);
    if (!portRecord) {
      throw new Error(`No SSH port allocated for cube ${newCubeId}`);
    }
    allocatedSshPort = portRecord.port;
    sshPortAllocated = true; // Set immediately after port retrieval so cleanup can free it if later steps fail

    // 11. Set up iptables SSH port forward.
    //
    // Redeployed cubes boot with sshd at `DEFAULT_CUBE_SSH_PORT` — the
    // captured backup's rootfs ships sshd on 22, and the customer can move
    // it post-boot via the Networking-tab PATCH flow. See
    // `config/platform.ts` for the constant's rationale.
    await addTcpPortForward(
      client,
      allocatedSshPort,
      internalIp,
      DEFAULT_CUBE_SSH_PORT,
      []
    );

    // 12. Create SSH TCP mapping record
    await db.insert(tcpPortMappings).values({
      cubeId: newCubeId,
      cubePort: DEFAULT_CUBE_SSH_PORT,
      hostPort: allocatedSshPort,
      allocatedPortId: portRecord.id,
      label: "SSH",
      isSsh: true,
      status: "active",
    });

    // 13. Wait for guest agent
    console.log(`${logPrefix} waiting for guest agent...`);
    let cubeResponsive = false;
    for (let attempt = 0; attempt < 45; attempt++) {
      if (await guestPing(client, newCubeId)) {
        cubeResponsive = true;
        console.log(
          `${logPrefix} guest agent responsive after ${(attempt + 1) * 2}s`
        );
        break;
      }
      await sleep(2000);
    }
    if (!cubeResponsive) {
      console.warn(
        `${logPrefix} guest agent not responsive after 90s, continuing`
      );
    }

    // startCube re-read /var/lib/krova/images/vmlinux fresh from disk, so the
    // cube is now running whatever kernel is on the server. Sync the DB field.
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
        `${logPrefix} kernel version refresh failed (non-fatal):`,
        err instanceof Error ? err.message : err
      );
    }

    // 14. Mark cube as running
    await db
      .update(cubes)
      .set({
        status: "running",
        internalIp,
        lastBilledAt: new Date(),
        lastStartedAt: new Date(),
        hasVirtioMem: redeployHasVirtioMem,
        ...(refreshedKernelVersion === null
          ? {}
          : { bootedKernelVersion: refreshedKernelVersion }),
        updatedAt: new Date(),
      })
      .where(eq(cubes.id, newCubeId));

    await triggerCubeLifecycleEvent(newCubeId, spaceId, {
      status: "running",
      internalIp,
    });

    // 15. Update backup record with redeployed cube ID (backup persists)
    await db
      .update(cubeBackups)
      .set({ redeployedCubeId: newCubeId })
      .where(eq(cubeBackups.id, backupId));

    // 16. Re-create domain mappings from stored config (skip domains already in use)
    const domainFailures: string[] = [];
    for (const dm of config.domainMappings) {
      try {
        const insertResult = await db.transaction(async (tx) => {
          const [existing] = await tx
            .select({ id: domainMappings.id })
            .from(domainMappings)
            .where(
              and(
                eq(domainMappings.domain, dm.domain),
                inArray(domainMappings.status, ["pending", "active"])
              )
            )
            .limit(1);

          if (existing) {
            return { skipped: true as const };
          }

          const [mapping] = await tx
            .insert(domainMappings)
            .values({
              cubeId: newCubeId,
              domain: dm.domain,
              port: dm.port,
              status: "pending",
            })
            .returning();

          return { skipped: false as const, mapping };
        });

        if (insertResult.skipped) {
          domainFailures.push(`${dm.domain}: already in use by another cube`);
          console.warn(
            `${logPrefix} skipping domain ${dm.domain}: already in use`
          );
          continue;
        }

        await enqueueJob(JOB_NAMES.DOMAIN_ADD, {
          mappingId: insertResult.mapping.id,
          cubeId: newCubeId,
          serverId,
          domain: dm.domain,
          port: dm.port,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        domainFailures.push(`${dm.domain}: ${reason}`);
        console.warn(
          `${logPrefix} failed to re-create domain ${dm.domain}: ${reason}`
        );
      }
    }

    // 17. Re-create TCP mappings from stored config (non-SSH)
    const tcpFailures: string[] = [];
    for (const tm of config.tcpMappings) {
      try {
        const { allocatePort } = await import("@/lib/server/ports");

        const tcpResult = await db.transaction(async (tx) => {
          const portEntry = await allocatePort(tx, serverId, newCubeId, "tcp");
          if (!portEntry) {
            return null;
          }

          const [mapping] = await tx
            .insert(tcpPortMappings)
            .values({
              cubeId: newCubeId,
              cubePort: tm.cubePort,
              hostPort: portEntry.port,
              allocatedPortId: portEntry.id,
              label: tm.label,
              status: "pending",
            })
            .returning();

          // Persist the IP whitelist rows too. TCP_MAPPING_ADD applies these
          // CIDRs to iptables, but without the DB rows the UI shows no
          // whitelist and a later whitelist-edit would compute from an empty
          // baseline (DB/iptables drift). Mirrors addTcpMappingAction.
          const cidrs = tm.whitelistedCidrs ?? [];
          if (cidrs.length > 0) {
            await tx
              .insert(tcpMappingWhitelistedIps)
              .values(cidrs.map((cidr) => ({ mappingId: mapping.id, cidr })));
          }

          return { mapping, portEntry };
        });

        if (!tcpResult) {
          tcpFailures.push(`:${tm.cubePort} — no port available`);
          continue;
        }

        await enqueueJob(JOB_NAMES.TCP_MAPPING_ADD, {
          mappingId: tcpResult.mapping.id,
          cubeId: newCubeId,
          serverId,
          cubePort: tm.cubePort,
          hostPort: tcpResult.portEntry.port,
          cubeInternalIp: internalIp,
          whitelistedCidrs: tm.whitelistedCidrs ?? [],
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        tcpFailures.push(`:${tm.cubePort} — ${reason}`);
        console.warn(
          `${logPrefix} failed to re-create TCP :${tm.cubePort}: ${reason}`
        );
      }
    }

    // 18. Write lifecycle logs
    let logMessage = `Redeployed from backup "${backup.name}"`;
    if (domainFailures.length > 0 || tcpFailures.length > 0) {
      const failures = [...domainFailures, ...tcpFailures];
      logMessage += ` (partial: ${failures.length} mapping(s) failed to re-create)`;
    }
    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: newCubeId,
      message: logMessage,
    });

    audit({
      action: "backup.redeploy_complete",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: newCubeId,
      spaceId,
      description: `Redeployed cube from backup "${backup.name}"`,
      metadata: {
        backupId,
        newCubeId,
        originalCubeId: backup.originalCubeId,
        domainFailures: domainFailures.length > 0 ? domainFailures : undefined,
        tcpFailures: tcpFailures.length > 0 ? tcpFailures : undefined,
      },
      source: "worker",
    });

    dispatchWebhookEvent(spaceId, "backup.redeployed", {
      backup: buildBackupPayload(backup),
      newCubeId,
    });

    console.log(`${logPrefix} completed`);
    await log.info("Cube redeploy from backup complete");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`${logPrefix} failed: ${reason}`);
    await log.error(`Redeploy failed: ${reason}`);

    // Full cleanup: mirror cube-boot.ts error handling
    try {
      await destroyCubeVm(
        client,
        newCubeId,
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
      // Best-effort cleanup
    }

    // Drop the SSH tcp mapping row + free allocated ports + decrement server
    // resource counters (shared with the early-connect guard so neither path
    // leaks the /complete-time allocations — audit CC-1).
    await releaseRedeployCubeAllocations(serverId, newCubeId, claimed);

    // Mark cube as error (Rule 52: pair with lastBilledAt=null)
    await db
      .update(cubes)
      .set({ status: "error", lastBilledAt: null, updatedAt: new Date() })
      .where(eq(cubes.id, newCubeId));

    await db
      .insert(lifecycleLogs)
      .values({
        entityType: "cube",
        entityId: newCubeId,
        message: `Redeploy from backup failed: ${reason}`,
      })
      .catch(() => {});

    await triggerCubeLifecycleEvent(newCubeId, spaceId, { status: "error" });

    audit({
      action: "backup.redeploy_failed",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: newCubeId,
      spaceId,
      description: `Redeploy from backup failed: ${reason}`,
      metadata: { backupId, newCubeId, error: reason },
      source: "worker",
    });

    throw err;
  } finally {
    client.end();
  }
}

/**
 * Release the host allocations reserved for a redeploy cube at allocation time
 * (the SSH `tcp_port_mappings` row + the server CPU/RAM/disk counters + the
 * `allocated_ports` rows) before parking the cube in `error`. Shared by the
 * early-connect guard AND the main catch so NO failure path leaks the SSH port
 * / over-counts the server (audit CC-1). All steps best-effort, never throws.
 */
async function releaseRedeployCubeAllocations(
  serverId: string,
  newCubeId: string,
  claimed: { vcpus: number; ramMb: number; diskLimitGb: number }
): Promise<void> {
  await db
    .delete(tcpPortMappings)
    .where(eq(tcpPortMappings.cubeId, newCubeId))
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
            // Decrement the NEW cube row's sizes (what allocateServerAndCreateCube
            // incremented), not the backup's saved sizes which may differ.
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
    .where(eq(allocatedPorts.cubeId, newCubeId))
    .catch(() => {});
}

export async function handleBackupRedeploy(
  jobs: Job<BackupRedeployPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleBackupRedeployJob(job);
  }
}
