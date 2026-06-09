/**
 * Shared Cube boot lifecycle.
 *
 * This module contains the core VM provisioning logic for Cube provisioning.
 * The entire boot sequence — from SSH connection to VM running — lives here.
 *
 * Uses Firecracker microVMs instead of libvirt/KVM.
 */

import { and, eq, ne, sql } from "drizzle-orm";
import type { Client } from "ssh2";
import { DEFAULT_CUBE_SSH_PORT } from "@/config/platform";
import {
  allocatedPorts,
  cubes,
  lifecycleLogs,
  servers,
  tcpPortMappings,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { resolveLaunchModeForCube } from "@/lib/cubes/launch-mode";
import { cubeNumaLaunchOpts } from "@/lib/cubes/numa-launch-opts";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";
import { getSpaceOwner } from "@/lib/email/helpers";
import { notifyAdminsOfCubeError } from "@/lib/email/notify-error";
import { cubeErrorEmailTemplate } from "@/lib/email/templates/cube-error";
import { env } from "@/lib/env";
import { triggerCubeLifecycleEvent } from "@/lib/pusher";
import {
  cubeIpv4Address,
  cubeIpv6Address,
  octetOf,
} from "@/lib/server/cube-network";
import { findSshAllocation } from "@/lib/server/ports";
import {
  addTcpPortForward,
  allocateInternalOctet,
  createCube as bootCubeVm,
  connectToServer,
  deleteCube as destroyCubeVm,
  execCommand,
  removeTcpPortForward,
  shellEscape,
  tapName,
} from "@/lib/ssh";
import { cubePaths } from "@/lib/ssh/jailer";
import { sleep } from "@/lib/utils";
import { formatImageVersion } from "@/lib/version";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import type { JobLogger } from "@/lib/worker/job-log";

export interface CubeBootInput {
  cubeId: string;
  /** Cube display name — becomes the guest hostname (slugified). */
  cubeName?: string | null;
  diskLimitGb: number;
  imageId: string;
  /** Optional logger — when provided, each major checkpoint (SSH connect, IP
   *  allocation, VM boot, port forward, guest-agent ready, → running) writes a
   *  row to job_logs and emits a `job.log` event so the UI can stream it live. */
  log?: JobLogger;
  ramMb: number;
  serverId: string;
  spaceId: string;
  sshPublicKey: string;
  userData?: string | null;
  vcpus: number;
}

export interface CubeBootContext {
  client: Client;
  cubeId: string;
  internalIp: string;
  serverId: string;
  spaceId: string;
}

export interface CubeBootCallbacks {
  /** Entity label for logs (e.g., 'Cube' or 'App "myapp"'). */
  entityLabel?: string;
  /** URL path for error email link. Default: `/${spaceId}/cubes/${cubeId}` */
  errorUrlPath?: string;
  /** Called after cube status is set to booting, before SSH connect. For app status updates. */
  onBooting?: (cubeId: string, spaceId: string) => Promise<void>;
  /** Called after cube → running. For app final status, domain setup, etc. */
  onComplete?: (ctx: CubeBootContext) => Promise<void>;
  /** Called after VM is responsive, before cube → running. Install Docker, deploy, etc. */
  onCubeReady?: (ctx: CubeBootContext) => Promise<void>;
  /** Called on error, after cube cleanup. For app-specific error handling. */
  onError?: (cubeId: string, spaceId: string, reason: string) => Promise<void>;
  /** Called at various provisioning stages. For Pusher progress events on apps. */
  onProgress?: (stage: string, message: string) => Promise<void>;
}

/**
 * Boot a Cube VM — the shared core of cube provisioning.
 *
 * Steps: load server → SSH connect → allocate IP → cleanup stale → boot VM →
 * read boot log → setup iptables → wait for guest agent → onCubeReady callback →
 * set cube running → onComplete callback → upload boot log.
 *
 * On error: destroys VM, frees resources, marks cube as error, sends email.
 */
export async function bootCube(
  input: CubeBootInput,
  callbacks?: CubeBootCallbacks
): Promise<void> {
  const {
    cubeId,
    spaceId,
    serverId,
    vcpus,
    ramMb,
    diskLimitGb,
    imageId,
    sshPublicKey,
    cubeName,
    userData,
    log,
  } = input;
  const label = callbacks?.entityLabel ?? "Cube";
  const logPrefix = `[cube-boot:${cubeId}]`;

  console.log(`${logPrefix} starting for ${label}`);
  if (log) {
    await log.info(
      `${label} provisioning started (vcpus=${vcpus}, ram=${ramMb}MB, disk=${diskLimitGb}GB)`
    );
  }

  let internalIp: string | null = null;
  let internalIpv6: string | null = null;
  let sshPortAllocated = false;
  let allocatedSshPort: number | null = null;
  let sshPortAllocatedPortId: string | null = null;
  // Declared in function scope so the catch cleanup (destroyCubeVm /
  // removeTcpPortForward) and the finally's client.end() can reach it even
  // when connectToServer itself throws.
  let client: Client | null = null;
  try {
    // 1. Load server + SSH key, connect. GUARDED (Rule 58 / guarded-connect
    //    invariant): the cube was already claimed `booting` by cube.provision
    //    before this job ran, so a host-down HERE must flip the cube
    //    booting→error via the catch below — NOT escape uncaught and strand
    //    the row in `booting` for ~10 min until cube.stale-check
    //    salvage-and-deletes it. Moving the connect inside the try also frees
    //    the server resources allocate() already reserved (the catch's
    //    decrement) instead of leaking them until stale-check runs.
    const conn = await connectToServer(serverId);
    const server = conn.server;
    client = conn.client;
    console.log(`${logPrefix} server=${server.hostname} ip=${server.publicIp}`);
    if (log) {
      await log.info(`Connected to ${server.hostname} (${server.publicIp})`);
    }

    // 2. Cube is already in `booting` (the only caller, `cube.provision`, did
    //    an atomic `pending → booting` claim before enqueueing this work).
    //    The previous version wrote `status: "booting"` unconditionally here,
    //    which was a latent correctness trap: any future caller that claimed
    //    to a different intermediate state would have its claim stomped by
    //    this blind write (audit L4, 2026-05-24). Just emit the Pusher event.
    console.log(`${logPrefix} cube status confirmed → booting`);
    await triggerCubeLifecycleEvent(cubeId, spaceId, { status: "booting" });
    await callbacks?.onBooting?.(cubeId, spaceId);

    console.log(`${logPrefix} SSH connected`);
    await callbacks?.onProgress?.("ssh", "Connected to server");

    // 5. Allocate internal IP — serialized via a Postgres advisory xact lock
    //    keyed on a hash of the server id (C4 fix: this allocation was
    //    previously UNLOCKED, so two concurrent provisions on the same host
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
      // Cube IPv4 is now 198.18.0.0/15, keyed off the server's bridge_subnet (S).
      // Every active server is assigned a bridge_subnet at create
      // (allocateBridgeSubnet) for the 198.18.0.0/15 scheme. A null value means
      // the server is mis-provisioned — fail loud rather than minting a broken
      // 198.18.0.x address.
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
    console.log(`${logPrefix} allocated internal IP: ${internalIp}`);
    await callbacks?.onProgress?.("ip", `Allocated internal IP: ${internalIp}`);
    if (log) {
      await log.info(`Allocated internal IP ${internalIp} / ${internalIpv6}`);
    }

    // 5c. Clean up stale resources from previous failed attempts
    const { execCommand: exec2 } = await import("@/lib/ssh/exec");

    // Resolve the launch mode (jailed vs bare) + jailer uid for this cube.
    // This is a FRESH cube, so it defaults to bare/null; resolveLaunchModeForCube
    // applies the JAILER_ENABLED policy and persists any transition in its own
    // transaction, returning what to thread into bootCubeVm. With JAILER_ENABLED
    // false this resolves to "bare", and cubePaths(id,"bare") yields the legacy
    // /var/lib/krova/cubes/<id>/* paths — byte-identical to before.
    const { launchMode, jailerUid } = await resolveLaunchModeForCube({
      id: cubeId,
      serverId,
      launchMode: "bare",
      jailerUid: null,
    });

    // Kill any old Firecracker process for this cube
    await exec2(
      client,
      `PID=$(cat ${shellEscape(cubePaths(cubeId, launchMode).pidFile)} 2>/dev/null) && [ -n "$PID" ] && kill -9 "$PID" 2>/dev/null || true`
    );

    // Clean up old TAP device if it exists
    const tap = tapName(internalIp);
    await exec2(client, `ip link del ${tap} 2>/dev/null || true`);

    // Clean up stale iptables rules for this IP
    const iptResult = await exec2(
      client,
      "command -v iptables-legacy 2>/dev/null || echo iptables"
    );
    const ipt = iptResult.stdout.trim() || "iptables";
    await exec2(
      client,
      `${ipt} -t nat -S PREROUTING 2>/dev/null | grep -- '--to-destination ${internalIp}:' | sed 's/^-A/-D/' | while read rule; do ${ipt} -t nat $rule 2>/dev/null; done || true`
    );
    await exec2(
      client,
      `${ipt} -t nat -S POSTROUTING 2>/dev/null | grep -- '-d ${internalIp}' | sed 's/^-A/-D/' | while read rule; do ${ipt} -t nat $rule 2>/dev/null; done || true`
    );

    // Remove old cube directory
    await exec2(client, `rm -rf /var/lib/krova/cubes/${cubeId}`);
    console.log(`${logPrefix} cleaned up stale resources`);
    if (log) {
      await log.info("Cleaned up stale resources from prior attempts");
    }

    // 6. Determine image and disk paths (ext4 for Firecracker)
    const imageFilename = `${imageId}.ext4`;
    const baseImagePath = `/var/lib/krova/images/${imageFilename}`;
    const diskPath = `/var/lib/krova/cubes/${cubeId}/rootfs.ext4`;

    // 7. Boot Cube via Firecracker
    console.log(
      `${logPrefix} booting: vcpus=${vcpus} ram=${ramMb}MB diskSize=${diskLimitGb}GB`
    );
    const { hasVirtioMem } = await bootCubeVm(client, {
      cubeId,
      vcpus,
      ramMb,
      diskPath,
      diskSizeGb: diskLimitGb,
      baseimagePath: baseImagePath,
      imageId,
      internalIp,
      sshPublicKey,
      cubeName: cubeName ?? null,
      userData: userData ?? null,
      launchMode,
      jailerUid,
      // L2 (NUMA): pin to the allocator-assigned node (fail-safe null when off).
      ...(await cubeNumaLaunchOpts(cubeId)),
    });
    console.log(`${logPrefix} VM booted successfully`);
    await callbacks?.onProgress?.("boot", "Cube booted successfully");
    if (log) {
      await log.info("Firecracker VM booted");
    }

    // 8. Get allocated SSH port. allocateServerAndCreateCube always reserves
    // one before booting, so this lookup must succeed. Scope by `serverId` (not
    // just cubeId) so a stranded cross-server allocation — e.g. one left by a
    // failed transfer — can never make us bind the iptables DNAT to the wrong
    // host port (defense-in-depth alongside the transfer port-rollback fix).
    const portRecord = await findSshAllocation(serverId, cubeId);

    if (!portRecord) {
      throw new Error(
        `No SSH port allocated for cube ${cubeId} on server ${serverId} — allocate_ports invariant violated`
      );
    }

    allocatedSshPort = portRecord.port;
    sshPortAllocatedPortId = portRecord.id;
    sshPortAllocated = true;
    console.log(`${logPrefix} SSH port: ${allocatedSshPort}`);

    // 10. Set up iptables TCP port forward for SSH.
    //
    // Every fresh cube boots with sshd on `DEFAULT_CUBE_SSH_PORT` (22) —
    // that's what the rootfs ships with and what the platform expects at
    // first boot. The customer can later move sshd onto a different port
    // inside the cube AND inform the platform via the dedicated SSH-port
    // endpoint (`PUT /api/spaces/[spaceId]/cubes/[cubeId]/ssh-port`),
    // which atomically replays this DNAT through the
    // `tcp-mapping.update-cube-port` worker handler. We never hardcode `22`
    // here directly: the constant lives in `config/platform.ts` so the
    // reachability cron and the iptables call agree on the same default.
    console.log(
      `${logPrefix} setting up iptables port forward ${allocatedSshPort} → ${internalIp}:${DEFAULT_CUBE_SSH_PORT}`
    );
    await addTcpPortForward(
      client,
      allocatedSshPort,
      internalIp,
      DEFAULT_CUBE_SSH_PORT,
      []
    );

    // 10b. Create TCP mapping record for SSH. `cubePort` is the source of
    // truth for the reachability cron's L2 probe — keep it in lockstep
    // with the iptables rule above.
    await db.insert(tcpPortMappings).values({
      cubeId,
      cubePort: DEFAULT_CUBE_SSH_PORT,
      hostPort: allocatedSshPort,
      allocatedPortId: sshPortAllocatedPortId,
      label: "SSH",
      isSsh: true,
      status: "active",
    });
    console.log(`${logPrefix} SSH TCP mapping created`);
    await callbacks?.onProgress?.("network", "Network configured");
    if (log) {
      await log.info(
        `Network configured: SSH on host port ${allocatedSshPort} → ${internalIp}:${DEFAULT_CUBE_SSH_PORT}`
      );
    }

    // 11. Wait for guest agent to respond.
    //
    // The vsock guest agent is the sole management channel — no SSH keys in
    // the VM for platform use. If it never comes up, the cube is a black box
    // we can't manage; marking it "running" anyway would mislead the customer.
    //
    // Window: 180s (90 attempts × 2s). 90s was the previous limit but proved
    // too tight for first-boot scenarios where systemd waits on
    // network-online.target. 180s comfortably covers cold-boot of a stock
    // Ubuntu/Debian/Rocky rootfs while still failing fast enough that
    // customers don't sit on a broken cube for minutes.
    //
    // On timeout we read the last ~8KB of /var/lib/krova/cubes/<id>/serial.log
    // from the host, embed it in the lifecycle log entry, and throw — the
    // outer catch block handles teardown (destroy VM, remove iptables, free
    // SSH port, decrement server allocation, mark cube `error`).
    console.log(`${logPrefix} waiting for guest agent on ${cubeId}...`);
    const { guestPing } = await import("@/lib/ssh/guest-exec");
    const GUEST_AGENT_TIMEOUT_S = 180;
    const POLL_INTERVAL_MS = 2000;
    const totalAttempts = Math.floor(
      (GUEST_AGENT_TIMEOUT_S * 1000) / POLL_INTERVAL_MS
    );
    let cubeResponsive = false;
    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      // Check if the cube was deleted while we were waiting — bail out immediately
      // so the catch block's resource cleanup doesn't double-decrement what
      // cube-delete already freed.
      const [cubeCheck] = await db
        .select({ status: cubes.status })
        .from(cubes)
        .where(eq(cubes.id, cubeId))
        .limit(1);
      if (!cubeCheck || cubeCheck.status === "deleted") {
        console.log(`${logPrefix} cube deleted mid-boot, aborting`);
        if (log) {
          await log.info(
            "Cube was deleted while waiting for guest agent — aborting"
          );
        }
        return;
      }
      if (await guestPing(client, cubeId)) {
        cubeResponsive = true;
        const elapsed = (attempt + 1) * 2;
        console.log(`${logPrefix} guest agent responsive after ${elapsed}s`);
        await callbacks?.onProgress?.("ready", "Cube is responsive");
        if (log) {
          await log.info(`Guest agent responsive after ${elapsed}s`);
        }
        break;
      }
      await sleep(POLL_INTERVAL_MS);
    }
    if (!cubeResponsive) {
      // Pull the serial console tail so the lifecycle log captures whatever
      // the kernel printed before dying — this is how we diagnosed the
      // VIRTIO_MMIO_CMDLINE_DEVICES issue, and it's the single most useful
      // piece of evidence for any future boot failure.
      let serialTail = "";
      try {
        const tailRes = await execCommand(
          client,
          `tail -c 8192 /var/lib/krova/cubes/${cubeId}/serial.log 2>/dev/null || echo '<serial.log not readable>'`,
          10_000
        );
        serialTail = tailRes.stdout.trim().slice(-7500);
      } catch (tailErr) {
        serialTail = `<failed to read serial.log: ${tailErr instanceof Error ? tailErr.message : String(tailErr)}>`;
      }

      console.error(
        `${logPrefix} guest agent unresponsive after ${GUEST_AGENT_TIMEOUT_S}s — failing boot. Serial log tail:\n${serialTail}`
      );
      if (log) {
        await log.error(
          `Guest agent unresponsive after ${GUEST_AGENT_TIMEOUT_S}s — VM failed to boot or kernel panic. Last lines of serial.log:\n${serialTail || "(empty)"}`
        );
      }
      throw new Error(
        `Guest agent unresponsive after ${GUEST_AGENT_TIMEOUT_S}s. Serial log tail:\n${serialTail || "(empty)"}`
      );
    }

    // 12. Post-boot setup (caller-specific: Docker, compose, Kamal, etc.)
    const ctx: CubeBootContext = {
      client,
      internalIp,
      cubeId,
      spaceId,
      serverId,
    };
    await callbacks?.onCubeReady?.(ctx);

    // 14. Resolve image versions for drift tracking. Kernel version is the
    //   one currently sitting on /var/lib/krova/images/vmlinux on this server
    //   (recorded by the most recent pull-images / update-images run).
    //   Rootfs version is the platform_images row for this Cube's imageId.
    //   Both are best-effort: if `pnpm build:images` was never run with the
    //   versioning support, we record null and the UI just doesn't show a
    //   version badge.
    let bootedKernelVersion: number | null = null;
    let provisionedRootfsVersion: number | null = null;
    try {
      const { servers, platformImages } = await import("@/db/schema");
      const [serverRow] = await db
        .select({ currentKernelVersion: servers.currentKernelVersion })
        .from(servers)
        .where(eq(servers.id, serverId))
        .limit(1);
      if (serverRow) {
        bootedKernelVersion = serverRow.currentKernelVersion;
      }
      const [rootfsRow] = await db
        .select({ version: platformImages.version })
        .from(platformImages)
        .where(eq(platformImages.name, imageId))
        .limit(1);
      if (rootfsRow) {
        provisionedRootfsVersion = rootfsRow.version;
      }
    } catch (err) {
      console.warn(
        `${logPrefix} version capture failed (non-fatal):`,
        err instanceof Error ? err.message : err
      );
    }

    // 15. Update cube → running
    console.log(`${logPrefix} cube status → running`);
    if (log) {
      const kv = formatImageVersion(bootedKernelVersion) ?? "?";
      const rv = formatImageVersion(provisionedRootfsVersion) ?? "?";
      await log.info(`${label} is running (kernel v${kv}, rootfs v${rv})`);
    }
    await db
      .update(cubes)
      .set({
        status: "running",
        internalIp,
        lastBilledAt: new Date(),
        lastStartedAt: new Date(),
        bootedKernelVersion,
        provisionedRootfsVersion,
        hasVirtioMem,
        updatedAt: new Date(),
      })
      .where(and(eq(cubes.id, cubeId), ne(cubes.status, "deleted")));

    // 15. Post-running callback (app status, domain mapping, etc.)
    await callbacks?.onComplete?.(ctx);

    // 16. Write lifecycle logs
    await db.insert(lifecycleLogs).values([
      {
        entityType: "cube",
        entityId: cubeId,
        message: `${label} assigned to ${server.hostname}, booting started`,
      },
      {
        entityType: "cube",
        entityId: cubeId,
        message: `${label} is running — internal IP: ${internalIp}`,
      },
    ]);

    // 19. Fire Pusher running event + outbound webhooks
    await triggerCubeLifecycleEvent(cubeId, spaceId, {
      status: "running",
      internalIp,
    });
    dispatchWebhookEvent(spaceId, "cube.running", {
      cube: {
        diskLimitGb,
        id: cubeId,
        imageId,
        internalIp,
        name: cubeName ?? "",
        ramMb,
        serverId,
        status: "running",
        vcpus,
      },
      publicIpv4: server.publicIp ?? null,
    });

    audit({
      action: "cube.provision_complete",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `${label} provisioned successfully`,
      metadata: {
        cubeId,
        serverId,
        internalIp,
        vcpus,
        ramMb,
      },
      source: "worker",
    });

    console.log(`${logPrefix} completed ip=${internalIp}`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`${logPrefix} failed: ${reason}`);
    if (log) {
      await log.error(`${label} provisioning failed: ${reason}`);
    }

    // Cleanup: destroy Firecracker VM, remove TAP, remove iptables, free
    // resources. `client` is null when the failure was the connect itself —
    // there is nothing on the host to tear down in that case (no VM, no port
    // forward yet), so skip the host-side cleanup and fall through to the DB
    // resource release + error transition below.
    try {
      if (client) {
        await destroyCubeVm(client, cubeId, internalIp ?? undefined).catch(
          () => {}
        );

        if (sshPortAllocated && allocatedSshPort && internalIp) {
          await removeTcpPortForward(
            client,
            allocatedSshPort,
            internalIp,
            DEFAULT_CUBE_SSH_PORT
          ).catch(() => {});
        }
      }
    } catch {
      // Best-effort cleanup
    }

    // Clean up the SSH TCP mapping record this run created — scope the
    // delete to JUST the SSH mapping we just inserted (matched via the
    // allocated_ports FK we tracked in `sshPortAllocatedPortId`). A
    // blanket `WHERE cubeId=?` would also wipe any non-SSH mappings a
    // concurrent `tcp-mapping.add` job had created, leaving the
    // iptables rules dangling without their DB rows. See audit M3
    // (2026-05-24).
    if (sshPortAllocatedPortId) {
      await db
        .delete(tcpPortMappings)
        .where(eq(tcpPortMappings.allocatedPortId, sshPortAllocatedPortId))
        .catch(() => {});
    }

    // Check if the cube was already claimed by a concurrent delete job.
    // If so, cube-delete already freed server resources and ports — skip
    // those steps to avoid double-decrementing. Also skip error notifications
    // since the user intentionally deleted the cube.
    const [cubeNow] = await db
      .select({ status: cubes.status })
      .from(cubes)
      .where(eq(cubes.id, cubeId))
      .limit(1);
    const cubeAlreadyDeleted = cubeNow?.status === "deleted";

    if (!cubeAlreadyDeleted) {
      // Decrement server allocated resources (locked to prevent concurrent drift)
      await db.transaction(async (tx) => {
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
              allocatedCpus: Math.max(0, srv.allocatedCpus - vcpus),
              allocatedRamMb: Math.max(0, srv.allocatedRamMb - ramMb),
              allocatedDiskGb: Math.max(0, srv.allocatedDiskGb - diskLimitGb),
              updatedAt: new Date(),
            })
            .where(eq(servers.id, serverId));
        }
      });
    }

    // Free allocated ports (no-op if already deleted by cube-delete)
    await db.delete(allocatedPorts).where(eq(allocatedPorts.cubeId, cubeId));

    if (!cubeAlreadyDeleted) {
      // Update Cube to error
      await db
        .update(cubes)
        .set({ status: "error", updatedAt: new Date() })
        .where(eq(cubes.id, cubeId));

      // Write lifecycle log
      await db.insert(lifecycleLogs).values({
        entityType: "cube",
        entityId: cubeId,
        message: `${label} failed to provision: ${reason}`,
      });

      // Fire Pusher error event + outbound webhooks
      await triggerCubeLifecycleEvent(cubeId, spaceId, {
        status: "error",
        reason,
      });
      dispatchWebhookEvent(spaceId, "cube.error", {
        cube: {
          diskLimitGb,
          id: cubeId,
          imageId,
          internalIp: null,
          name: cubeName ?? "",
          ramMb,
          serverId,
          status: "error",
          vcpus,
        },
        reason,
      });

      // Caller-specific error handling (app status update, deployment status, etc.)
      await callbacks?.onError?.(cubeId, spaceId, reason);

      // Notify space owner
      try {
        const owner = await getSpaceOwner(spaceId);
        if (owner) {
          const urlPath =
            callbacks?.errorUrlPath ?? `/${spaceId}/cubes/${cubeId}`;
          const errorUrl = `${env.NEXT_PUBLIC_APP_URL}${urlPath}`;
          const { html, text } = await cubeErrorEmailTemplate({
            userName: owner.name,
            spaceName: owner.spaceName,
            cubeName: label,
            cubeId,
            reason,
            cubeUrl: errorUrl,
          });
          await enqueueEmail({
            to: owner.email,
            subject: `${label} failed to provision — ${owner.spaceName}`,
            html,
            text,
          });
        }
      } catch (emailErr) {
        console.error(`${logPrefix} failed to send error email:`, emailErr);
      }

      // Notify admin error recipients
      await notifyAdminsOfCubeError({
        cubeName: label,
        cubeId,
        spaceId,
        serverId,
        reason,
      }).catch((err) => {
        console.error(
          `${logPrefix} failed to send admin error notification:`,
          err
        );
      });

      audit({
        action: "cube.provision_failed",
        category: "cube",
        actorType: "system",
        entityType: "cube",
        entityId: cubeId,
        spaceId,
        description: `${label} provisioning failed: ${reason}`,
        metadata: { cubeId, serverId, error: reason },
        source: "worker",
      });
    }

    throw err;
  } finally {
    client?.end();
  }
}
