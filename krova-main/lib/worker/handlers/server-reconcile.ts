/**
 * Server reconciliation job.
 *
 * Runs periodically to detect and surface drift between the database and
 * Firecracker. **Reconciliation never auto-destroys anything customer-facing
 * — it only notifies admins and lets them clean up manually via Orbit or
 * `pnpm cube:inspect`.** A previous version of this handler force-destroyed
 * orphaned VMs automatically; that path is gone (2026-05-21) because an
 * earlier bug elsewhere had repeatedly classified active customer cubes as
 * orphans during transfer windows, and the auto-destroy compounded the data
 * loss before any human could intervene.
 *
 * 1. **Orphaned VMs** — Cube directories on the host with no matching DB
 *    record (or DB record is "deleted"). Admins are notified with the host
 *    path, disk usage, process state, and the exact `pnpm cube:inspect`
 *    command to inspect/destroy after manual review.
 *
 * 2. **Ghost cubes** — DB says "running" but Firecracker process doesn't
 *    exist. Marked as "error" and admins are notified.
 *
 * 3. **Stale error cubes** — Cubes stuck in "error" status for over 30
 *    minutes. Admins are notified for manual review — no auto-deletion.
 */

import { and, eq, gte, lt, notInArray, or, sql } from "drizzle-orm";
import { cubes, lifecycleLogs, servers, sshKeys } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { notifyAdminsOfCubeError } from "@/lib/email/notify-error";
import { env } from "@/lib/env";
import { createSshConnection, decryptPrivateKey, execCommand } from "@/lib/ssh";
import { jailRoot } from "@/lib/ssh/jailer";

/** Cubes in "error" longer than this are surfaced to admins for review. */
const STALE_ERROR_MINUTES = 30;

/**
 * The server.reconcile cron interval, in minutes. MUST match the
 * `boss.schedule(JOB_NAMES.SERVER_RECONCILE, ...)` cron in lib/worker/boss.ts.
 * The stale-error notify window is derived from it.
 */
const RECONCILE_INTERVAL_MINUTES = 10;

export async function handleServerReconcile(): Promise<void> {
  console.log("[server-reconcile] starting reconciliation");

  // 1. Notify admins of stale error cubes (no SSH needed)
  await notifyStaleErrorCubes();

  // 2. SSH into each active server and reconcile VMs
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

  // Process servers in batches to limit concurrent SSH connections
  const BATCH_SIZE = 10;
  for (let i = 0; i < activeServers.length; i += BATCH_SIZE) {
    const batch = activeServers.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(
      batch.map(async (server) => {
        try {
          await reconcileServer(server);
        } catch (err) {
          console.error(
            `[server-reconcile] failed to reconcile server ${server.hostname}:`,
            err
          );
        }
      })
    );
  }

  console.log("[server-reconcile] reconciliation complete");
}

async function reconcileServer(server: {
  id: string;
  hostname: string;
  publicIp: string;
  sshPort: number;
  sshKeyId: string;
}): Promise<void> {
  // Load SSH key
  const sshKey = await db.query.sshKeys.findFirst({
    where: eq(sshKeys.id, server.sshKeyId),
  });
  if (!sshKey) {
    console.warn(
      `[server-reconcile] SSH key not found for server ${server.hostname}, skipping`
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
      `[server-reconcile] cannot connect to server ${server.hostname}: ${err}`
    );
    return;
  }

  try {
    // List all cube directories on the host (each Firecracker VM has its own directory)
    const result = await execCommand(
      client,
      "ls -1 /var/lib/krova/cubes/ 2>/dev/null || true",
      15_000
    );

    // Also list jailed-cube chroots. A jailed transfer whose source teardown
    // removed the legacy cube dir but FAILED to remove the chroot (teardownJail's
    // chroot rm is best-effort) leaves a chroot stranded here with no entry under
    // /var/lib/krova/cubes/ — invisible to the scan above. Union both so that
    // residual chroot is still flagged as an orphan (the forensic probe below
    // already checks the jailRoot pid path, and `cube:inspect --destroy` removes
    // both the cube dir and the jail chroot).
    const jailResult = await execCommand(
      client,
      "ls -1 /var/lib/krova/jail/firecracker/ 2>/dev/null || true",
      15_000
    );

    const hostCubeIds = Array.from(
      new Set(
        [...result.stdout.split("\n"), ...jailResult.stdout.split("\n")]
          .map((s) => s.trim())
          .filter(Boolean)
      )
    );

    // Get all cubes associated with this server (non-deleted).
    // Two cases must both be included to avoid false-orphan destruction:
    //   1. cubes.serverId = server.id  — normal: cube lives here
    //   2. cubes.transferDestinationServerId = server.id  — in-progress transfer:
    //      the cube directory is already created on this server (step 7 of the
    //      transfer handler) but cubes.serverId still points to the source until
    //      the atomic flip. Without this OR, reconcile sees the directory, finds
    //      no matching DB row, and destroys it — killing the transfer mid-flight.
    const dbCubes = await db
      .select({
        id: cubes.id,
        name: cubes.name,
        status: cubes.status,
        spaceId: cubes.spaceId,
        vcpus: cubes.vcpus,
        ramMb: cubes.ramMb,
        diskLimitGb: cubes.diskLimitGb,
        lastBilledAt: cubes.lastBilledAt,
      })
      .from(cubes)
      .where(
        and(
          or(
            eq(cubes.serverId, server.id),
            eq(cubes.transferDestinationServerId, server.id)
          ),
          notInArray(cubes.status, ["deleted"])
        )
      );

    const dbCubeIds = new Set(dbCubes.map((c) => c.id));
    const hostCubeSet = new Set(hostCubeIds);

    // Detect orphaned VMs (on host but not in DB or marked deleted).
    //
    // **Notify only — never auto-destroy.** A previous version of this
    // handler force-destroyed orphans automatically, which compounded data
    // loss when an upstream bug ever mis-classified an active customer cube
    // as an orphan (e.g. transfer windows, race conditions). Admins now
    // inspect and clean up manually via `pnpm cube:inspect`.
    for (const cubeId of hostCubeIds) {
      if (!dbCubeIds.has(cubeId)) {
        // Skip if we've already notified about this orphan in the last
        // notification window — the audit log dedupes repeat alerts so
        // admins aren't spammed every 10 minutes for the same orphan.
        //
        // The metadata->>'cubeId' filter is what makes this work for
        // servers with >1 orphan. Without it (the previous version),
        // `findFirst` would return ONE row per server-id and the
        // in-memory comparison of its metadata.cubeId would only match
        // ONE cubeId — every other orphan on the same server would slip
        // past dedup and email admins every 10 min indefinitely.
        // See audit H8 (2026-05-24).
        const recentNotify = await db.query.auditLogs
          .findFirst({
            where: (a, { eq: e, and: A, gte: g }) =>
              A(
                e(a.action, "server.orphan_vm_detected"),
                e(a.entityId, server.id),
                sql`${a.metadata}->>'cubeId' = ${cubeId}`,
                g(a.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
              ),
          })
          .catch(() => null);
        const alreadyNotifiedRecently = !!recentNotify;

        // Gather forensic info so the admin can decide without SSHing in.
        const [deletedCube] = await db
          .select({ id: cubes.id })
          .from(cubes)
          .where(and(eq(cubes.id, cubeId), eq(cubes.status, "deleted")))
          .limit(1);
        const isKnownDeleted = !!deletedCube;

        const hostPath = `/var/lib/krova/cubes/${cubeId}`;

        // Disk size (best-effort; large dirs can take a couple seconds)
        const duResult = await execCommand(
          client,
          `du -sh ${hostPath} 2>/dev/null | cut -f1 || echo "?"`,
          15_000
        ).catch(() => ({ stdout: "?", stderr: "", exitCode: 1 }));
        const diskSize = duResult.stdout.trim() || "?";

        // Process state — is the Firecracker still alive? The orphan's launch
        // mode is UNKNOWN (no reliable DB row), so probe BOTH the jailed
        // chroot pid path and the legacy bare cube-dir pid path.
        const pidResult = await execCommand(
          client,
          `PID=$(cat ${jailRoot(cubeId)}/firecracker.pid 2>/dev/null || cat ${hostPath}/firecracker.pid 2>/dev/null) && [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null && echo "running:$PID" || echo "stopped"`,
          5000
        ).catch(() => ({ stdout: "unknown", stderr: "", exitCode: 1 }));
        const processState = pidResult.stdout.trim() || "unknown";

        console.warn(
          `[server-reconcile] orphan detected: cubeId=${cubeId} on ${server.hostname} (${isKnownDeleted ? "deleted in DB" : "not in DB"}) — size=${diskSize} process=${processState}`
        );

        audit({
          action: "server.orphan_vm_detected",
          category: "server",
          actorType: "system",
          entityType: "server",
          entityId: server.id,
          description: `Orphaned VM "${cubeId}" detected on ${server.hostname}${isKnownDeleted ? " (DB status: deleted)" : " (no DB record)"} — manual cleanup required`,
          metadata: {
            cubeId,
            serverId: server.id,
            serverHostname: server.hostname,
            hostPath,
            diskSize,
            processState,
            inDb: isKnownDeleted ? "deleted" : "missing",
          },
          source: "worker",
        });

        // Only email once per (cube, server) per 24h — repeated reconcile
        // ticks should not spam the inbox with the same orphan.
        if (!alreadyNotifiedRecently) {
          await notifyAdminsOfCubeError({
            cubeName: cubeId,
            cubeId,
            spaceId: "unknown",
            serverId: server.id,
            reason: `Orphaned VM detected on ${server.hostname}${isKnownDeleted ? " (DB status: deleted)" : " (no DB record)"} — manual cleanup required`,
            manualAction: {
              hostPath,
              serverHostname: server.hostname,
              diskSize,
              processState,
              inspectCommand: `pnpm cube:inspect ${cubeId} --server ${server.id}`,
              destroyCommand: `pnpm cube:inspect ${cubeId} --server ${server.id} --destroy`,
            },
          }).catch(() => {});
        }
      }
    }

    // Detect ghost cubes (in DB as running but not on host)
    for (const dbCube of dbCubes) {
      if (dbCube.status === "running" && !hostCubeSet.has(dbCube.id)) {
        console.warn(
          `[server-reconcile] ghost cube "${dbCube.name}" (${dbCube.id}) on ${server.hostname}: DB says running but VM not found`
        );

        // No prorated charge — ghost cubes are a platform error, not billable
        // Atomic: only update if still running (prevents overwriting concurrent operations)
        const [claimed] = await db
          .update(cubes)
          .set({ status: "error", lastBilledAt: null, updatedAt: new Date() })
          .where(and(eq(cubes.id, dbCube.id), eq(cubes.status, "running")))
          .returning({ id: cubes.id });

        if (!claimed) {
          console.log(
            `[server-reconcile] ghost cube ${dbCube.id} status changed concurrently, skipping`
          );
          continue;
        }

        await db.insert(lifecycleLogs).values({
          entityType: "cube",
          entityId: dbCube.id,
          message:
            "Cube marked as error — VM not found on hypervisor during reconciliation",
        });

        audit({
          action: "server.ghost_cube_detected",
          category: "server",
          actorType: "system",
          entityType: "cube",
          entityId: dbCube.id,
          spaceId: dbCube.spaceId,
          description: `Ghost cube "${dbCube.name}" detected — DB running but VM missing on ${server.hostname}`,
          metadata: { cubeId: dbCube.id, serverId: server.id },
          source: "worker",
        });

        await notifyAdminsOfCubeError({
          cubeName: dbCube.name,
          cubeId: dbCube.id,
          spaceId: dbCube.spaceId,
          serverId: server.id,
          reason:
            "Ghost cube — database says running but VM not found on hypervisor",
        }).catch(() => {});
      }
    }
  } finally {
    client.end();
  }
}

/**
 * Surface cubes stuck in "error" to admins. We do NOT auto-delete — Orbit is
 * the single place a cube is deleted, and it runs dependency checks the
 * worker cannot.
 *
 * Notify window: one reconcile interval + 1 min jitter margin. It is slightly
 * WIDER than the interval on purpose, so every stale cube's updatedAt is
 * caught by at least one run — a window narrower than the interval would
 * leave a gap where a cube is never emailed at all. A cube whose updatedAt
 * lands in the 1-min overlap may be emailed twice; for an alerting backstop,
 * never-miss beats never-duplicate. (Error-onset paths already email
 * separately anyway.)
 */
async function notifyStaleErrorCubes(): Promise<void> {
  const now = Date.now();
  const staleThreshold = new Date(now - STALE_ERROR_MINUTES * 60 * 1000);
  const windowStart = new Date(
    now - (STALE_ERROR_MINUTES + RECONCILE_INTERVAL_MINUTES + 1) * 60 * 1000
  );

  const staleErrorCubes = await db
    .select({
      id: cubes.id,
      name: cubes.name,
      spaceId: cubes.spaceId,
      serverId: cubes.serverId,
    })
    .from(cubes)
    .where(
      and(
        eq(cubes.status, "error"),
        lt(cubes.updatedAt, staleThreshold),
        gte(cubes.updatedAt, windowStart)
      )
    );

  if (staleErrorCubes.length === 0) {
    return;
  }

  console.log(
    `[server-reconcile] notifying admins of ${staleErrorCubes.length} stale error cube(s)`
  );

  for (const cube of staleErrorCubes) {
    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cube.id,
      message: `Cube has been in error for over ${STALE_ERROR_MINUTES} minutes — admin notified for manual review`,
    });
    await notifyAdminsOfCubeError({
      cubeName: cube.name,
      cubeId: cube.id,
      spaceId: cube.spaceId,
      serverId: cube.serverId,
      reason: `Cube stuck in "error" for over ${STALE_ERROR_MINUTES} minutes — review and delete via Orbit if appropriate`,
    }).catch(() => {});
  }
}
