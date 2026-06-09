/**
 * Host mount reaper.
 *
 * Sweeps orphaned `/tmp/krova-mount-<cubeId>` loop-mounts left behind on
 * bare-metal hosts. createCube() / snapshot-restore / backup-redeploy all
 * mount the rootfs at that path during provisioning and unmount in a
 * `finally` block — but a worker crash, SSH disconnect, or host hiccup
 * between the mount and the finally leaves the loop device pinning the
 * rootfs inode. If cube.delete then runs and `rm -rf`s the workspace, the
 * loop still holds the file as `(deleted)`, eating disk blocks until
 * reboot. The 2026-05-22 motd "/tmp/krova-mount-* using 99.7% of 9.76GB"
 * warning was exactly this state.
 *
 * **Safety posture: this handler never deletes any file. Ever.**
 *
 *   1. Scope is hardcoded to `/tmp/krova-mount-<cubeId>` only. The other
 *      `/tmp/krova-transfer-*` mounts used by cube.transfer are
 *      structurally outside our regex.
 *   2. `mount -t ext4` pre-filters at the source — we never see non-ext4
 *      mounts.
 *   3. The cube id segment is regex-validated as `[a-z0-9]+` (CUID2
 *      shape) before any command interpolation.
 *   4. Skip if the cube exists AND its status is in
 *      (`pending`, `booting`, `stopping`) — a live handler may still hold
 *      the mount.
 *   5. `umount` is the kernel-authoritative check. If anything has the
 *      filesystem open, the kernel refuses with EBUSY and we skip; we
 *      never use `umount -l` here (the cube.delete defensive path can,
 *      because it knows the cube is being torn down).
 *   6. `rmdir` only removes empty directories — the kernel refuses
 *      non-empty dirs. No `rm`, ever.
 *
 * The handler is structurally incapable of touching /var/lib/krova/cubes/
 * or any file inside any mount.
 */

import { eq, inArray } from "drizzle-orm";
import { cubes, servers, sshKeys } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createSshConnection, decryptPrivateKey, execCommand } from "@/lib/ssh";

const MOUNT_PATH_REGEX =
  /^(\S+) on (\/tmp\/krova-mount-([a-z0-9]+)) type ext4 /;
const CUBE_ID_REGEX = /^[a-z0-9]+$/;

/**
 * Cube statuses during which a handler may legitimately be holding a mount
 * at /tmp/krova-mount-<id>. We refuse to unmount under any of these.
 */
const IN_FLIGHT_STATUSES = new Set<string>(["pending", "booting", "stopping"]);

/**
 * Per-server cap. If a host has somehow accumulated more orphans than this,
 * we reap the first N and let the next tick handle the rest, rather than
 * holding the SSH connection open indefinitely.
 */
const MAX_REAP_PER_SERVER_PER_TICK = 50;

export async function handleHostMountReaper(): Promise<void> {
  console.log("[host-mount-reaper] starting sweep");

  const activeServers = await db
    .select({
      id: servers.id,
      hostname: servers.hostname,
      publicIp: servers.publicIp,
      sshPort: servers.sshPort,
      sshKeyId: servers.sshKeyId,
    })
    .from(servers)
    .where(eq(servers.status, "active"));

  const BATCH_SIZE = 10;
  for (let i = 0; i < activeServers.length; i += BATCH_SIZE) {
    const batch = activeServers.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(
      batch.map(async (server) => {
        try {
          await reapServerMounts(server);
        } catch (err) {
          console.error(
            `[host-mount-reaper] failed to reap on ${server.hostname}:`,
            err
          );
        }
      })
    );
  }

  console.log("[host-mount-reaper] sweep complete");
}

async function reapServerMounts(server: {
  id: string;
  hostname: string;
  publicIp: string;
  sshPort: number;
  sshKeyId: string;
}): Promise<void> {
  const sshKey = await db.query.sshKeys.findFirst({
    where: eq(sshKeys.id, server.sshKeyId),
  });
  if (!sshKey) {
    console.warn(
      `[host-mount-reaper] SSH key not found for ${server.hostname}, skipping`
    );
    return;
  }

  const decryptedKey = decryptPrivateKey(
    sshKey.encryptedPrivateKey,
    env.APP_SECRET
  );

  let client;
  try {
    client = await createSshConnection(
      server.publicIp,
      server.sshPort,
      decryptedKey
    );
  } catch (err) {
    console.warn(
      `[host-mount-reaper] cannot connect to ${server.hostname}: ${err}`
    );
    return;
  }

  try {
    // mount -t ext4 pre-filters to ext4 mounts at the source — we never see
    // tmpfs, overlay, or any other type. The output format on Linux is:
    //   "<source> on <target> type ext4 (<opts>)"
    const mountResult = await execCommand(
      client,
      "mount -t ext4 2>/dev/null || true",
      15_000
    );

    const candidates: { cubeId: string; target: string }[] = [];
    for (const line of mountResult.stdout.split("\n")) {
      const m = MOUNT_PATH_REGEX.exec(line);
      if (!m) {
        continue;
      }
      const target = m[2];
      const cubeId = m[3];
      // Defense-in-depth: re-validate the captured cube id is pure
      // alphanumeric. The regex above already enforces this, but an
      // explicit check makes the safety property local to the
      // interpolation site below.
      if (!CUBE_ID_REGEX.test(cubeId)) {
        continue;
      }
      candidates.push({ cubeId, target });
    }

    if (candidates.length === 0) {
      return;
    }

    if (candidates.length > MAX_REAP_PER_SERVER_PER_TICK) {
      console.warn(
        `[host-mount-reaper] ${server.hostname} has ${candidates.length} orphan mounts — capping to ${MAX_REAP_PER_SERVER_PER_TICK} per tick`
      );
      candidates.length = MAX_REAP_PER_SERVER_PER_TICK;
    }

    // Bulk-fetch the matching cube rows in one query. Missing rows
    // (true ghosts, like today's incident) just won't appear here.
    const ids = candidates.map((c) => c.cubeId);
    const cubeRows = await db
      .select({ id: cubes.id, status: cubes.status })
      .from(cubes)
      .where(inArray(cubes.id, ids));
    const statusById = new Map(cubeRows.map((c) => [c.id, c.status]));

    for (const { cubeId, target } of candidates) {
      const status = statusById.get(cubeId) ?? null;

      // Safety guard: an in-flight handler may still need this mount.
      if (status && IN_FLIGHT_STATUSES.has(status)) {
        console.log(
          `[host-mount-reaper] skip ${target} on ${server.hostname} — cube status=${status} (in-flight)`
        );
        continue;
      }

      // umount (no -l). If the kernel reports EBUSY, something has the
      // filesystem open and we must NOT force it — bail and wait for the
      // next tick. Firecracker never holds the mount open (it uses the
      // rootfs file directly as a block device), so a busy mount means
      // an unexpected process is using it — admin should investigate.
      const umountResult = await execCommand(
        client,
        `umount ${target}`,
        15_000
      ).catch((err) => ({
        stdout: "",
        stderr: String(err),
        exitCode: 1,
      }));

      if (umountResult.exitCode !== 0) {
        console.warn(
          `[host-mount-reaper] umount refused for ${target} on ${server.hostname} (status=${status ?? "missing"}): ${umountResult.stderr.trim()}`
        );
        continue;
      }

      // rmdir refuses non-empty dirs by design — after umount the mount
      // point is empty, so this just removes the empty directory. If for
      // any reason it isn't empty, rmdir fails with ENOTEMPTY and we
      // leave the dir alone (no recursion, no rm).
      await execCommand(
        client,
        `rmdir ${target} 2>/dev/null || true`,
        5000
      ).catch(() => {});

      console.log(
        `[host-mount-reaper] reaped ${target} on ${server.hostname} (cube status=${status ?? "missing"})`
      );

      await audit({
        action: "server.mount_reaped",
        category: "server",
        actorType: "system",
        entityType: "server",
        entityId: server.id,
        description: `Reaped orphan loop-mount ${target} on ${server.hostname}`,
        metadata: {
          cubeId,
          serverId: server.id,
          serverHostname: server.hostname,
          target,
          cubeStatus: status ?? "missing",
        },
        source: "worker",
      });
    }
  } finally {
    client.end();
  }
}
