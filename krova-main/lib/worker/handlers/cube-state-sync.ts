/**
 * Cube state sync job.
 *
 * Runs every 2 minutes to sync actual Firecracker VM state with the database.
 * Catches cases where a user shuts down or pauses a VM from inside (via SSH).
 *
 * Firecracker states → DB status mapping:
 *   "running"   → running (no change)
 *   "paused"    → sleeping (user or system paused)
 *   "shut off"  → sleeping IF the cube has been running long enough for the
 *                 user to have actually been using it; otherwise "error",
 *                 because a VM that disappears within minutes of boot is
 *                 almost always a boot failure (kernel panic, init crash,
 *                 missing guest tooling), not a deliberate shutdown.
 *   not found   → handled by server-reconcile job (ghost detection)
 */

import {
  and,
  desc,
  eq,
  gte,
  inArray,
  like,
  notInArray,
  sql,
} from "drizzle-orm";
import type { Client } from "ssh2";
import { cubes, lifecycleLogs, servers, sshKeys } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { triggerCubeLifecycleEvent } from "@/lib/pusher";
import { reconcileServerResources } from "@/lib/server/allocate";
import {
  createSshConnection,
  decryptPrivateKey,
  execCommand,
  getCubeStatus,
} from "@/lib/ssh";
import { cubePaths, type LaunchMode } from "@/lib/ssh/jailer";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildCubeSummary } from "@/lib/webhook-payloads";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

/**
 * Max times state-sync will auto-relaunch a single cube within the last
 * AUTO_RELAUNCH_RATE_WINDOW_MS. Past this threshold the cube is marked as
 * `error` and surfaced to admins instead of being relaunched — a guest
 * that reboots itself this often is either misconfigured or stuck in a
 * boot loop, and burning fleet cycles on it doesn't help anyone.
 */
const AUTO_RELAUNCH_RATE_LIMIT = 3;
const AUTO_RELAUNCH_RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * The exact substring state-sync greps fc.log for. Emitted by Firecracker
 * v1.x when the guest issues `reboot` / `systemctl reboot` / `shutdown -r`
 * — the VMM has no reboot support so it exits cleanly. ALSO emitted on a
 * clean `shutdown -h now` (which we DO want to treat as a guest halt, not
 * a reboot). For now we treat both the same: relaunch. Customers asking
 * to halt a cube use Sleep / Power Off through the platform UI; an
 * in-guest `shutdown -h` bypassing the platform is rare enough that
 * auto-relaunching is the right default (it preserves the running
 * billing contract and matches user intent for the common case).
 */
const FIRECRACKER_CLEAN_EXIT_MARKER =
  "Firecracker exiting successfully. exit_code=0";

export async function handleCubeStateSync(): Promise<void> {
  // Get all active servers
  const activeServers = await db
    .select({
      id: servers.id,
      hostname: servers.hostname,
      publicIp: servers.publicIp,
      sshPort: servers.sshPort,
      sshKeyId: servers.sshKeyId,
      lastBootId: servers.lastBootId,
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
          await syncServerCubeStates(server);
        } catch (err) {
          console.error(
            `[cube-state-sync] failed for server ${server.hostname}:`,
            err
          );
        }
      })
    );
  }
}

async function syncServerCubeStates(server: {
  id: string;
  hostname: string;
  publicIp: string;
  sshPort: number;
  sshKeyId: string;
  lastBootId: string | null;
}): Promise<void> {
  const sshKey = await db.query.sshKeys.findFirst({
    where: eq(sshKeys.id, server.sshKeyId),
  });
  if (!sshKey) {
    return;
  }

  const decryptedKey = decryptPrivateKey(
    sshKey.encryptedPrivateKey,
    env.APP_SECRET
  );

  let client: Client;
  try {
    client = await createSshConnection(
      server.publicIp,
      server.sshPort,
      decryptedKey
    );
  } catch {
    return; // Can't connect, skip
  }

  try {
    // --- Host reboot detection --------------------------------------------
    // The kernel's boot_id changes on every reboot. If it differs from the
    // value we last recorded, the host rebooted and every Firecracker process
    // is gone. The database is the source of truth: do NOT run the per-cube
    // demote logic below — that would overwrite the cubes' intended `running`
    // state. Hand off to server.reboot-recovery (which restarts them) and
    // skip this server for this tick. servers.lastBootId is written only by
    // the recovery job, except the one-time seed below.
    let currentBootId = "";
    try {
      const bootIdRes = await execCommand(
        client,
        "cat /proc/sys/kernel/random/boot_id",
        5000
      );
      currentBootId = bootIdRes.stdout.trim();
    } catch {
      // Could not read boot-id — fall through to normal sync.
    }
    if (currentBootId) {
      if (server.lastBootId === null) {
        // First time we've seen this server — seed the baseline, then SKIP the
        // demote for this tick (mirroring the changed-boot-id branch). If the
        // host happened to reboot right at seed time, falling through to the
        // per-cube demote below would flip its (now shut-off) `running` cubes
        // to `sleeping` instead of recovering them. Returning defers reconcile
        // one 2-min tick; a real reboot is still recovered immediately by the
        // krova-boot-notify host unit (and by the boot-id-change branch next
        // tick if the id moves again).
        await db
          .update(servers)
          .set({ lastBootId: currentBootId })
          .where(eq(servers.id, server.id));
        return;
      }
      if (server.lastBootId !== currentBootId) {
        console.log(
          `[cube-state-sync] server ${server.hostname} boot-id changed — ` +
            "host rebooted; enqueuing reboot-recovery, skipping demote"
        );
        await enqueueJob(
          JOB_NAMES.SERVER_REBOOT_RECOVERY,
          { serverId: server.id },
          { singletonKey: server.id }
        );
        return; // recovery owns this server until it updates lastBootId
      }
    }

    // Get cubes on this server that we expect to be running or sleeping.
    // Exclude cubes with an active transfer state: during a transfer the
    // source cube temporarily enters Firecracker Paused state (brief snapshot
    // copy in step 5) while the DB still says "running". If state-sync fires
    // in that window it would incorrectly set status="sleeping", corrupting
    // the transfer's wasRunning flag and leaving the cube sleeping after the
    // transfer even though it was originally running. The terminal states
    // ("idle", "failed", "completed") are safe — the cube is fully settled.
    const activeCubes = await db
      .select({
        diskLimitGb: cubes.diskLimitGb,
        id: cubes.id,
        imageId: cubes.imageId,
        internalIp: cubes.internalIp,
        lastBilledAt: cubes.lastBilledAt,
        launchMode: cubes.launchMode,
        name: cubes.name,
        ramMb: cubes.ramMb,
        serverId: cubes.serverId,
        spaceId: cubes.spaceId,
        status: cubes.status,
        vcpus: cubes.vcpus,
      })
      .from(cubes)
      .where(
        and(
          eq(cubes.serverId, server.id),
          inArray(cubes.status, ["running", "sleeping"]),
          // Exclude every non-terminal transfer state, including
          // `cancelling` (the cancel handler is mid-recovery and may be
          // about to wake the source — state-sync demoting back to
          // `sleeping` would race that recovery). See audit M11
          // (2026-05-24).
          notInArray(cubes.transferState, [
            "snapshotting",
            "restoring",
            "finalizing",
            "cancelling",
          ])
        )
      );

    if (activeCubes.length === 0) {
      return;
    }

    // Check each cube's actual state via Firecracker
    for (const cube of activeCubes) {
      try {
        const hypervisorState = await getCubeStatus(
          client,
          cube.id,
          cube.launchMode
        );
        await handleStateMismatch(cube, hypervisorState, server.id, client);
      } catch {
        // Skip individual cube errors
      }
    }
  } finally {
    client.end();
  }
}

async function handleStateMismatch(
  cube: {
    diskLimitGb: number;
    id: string;
    imageId: string;
    internalIp: string | null;
    lastBilledAt: Date | null;
    launchMode: LaunchMode;
    name: string;
    ramMb: number;
    serverId: string;
    spaceId: string;
    status: string;
    vcpus: number;
  },
  hypervisorState: string,
  serverId: string,
  client: Client
): Promise<void> {
  const dbStatus = cube.status;

  // Map hypervisor state to expected DB status
  let expectedDbStatus: string;
  switch (hypervisorState) {
    case "running":
      expectedDbStatus = "running";
      break;
    case "paused":
      expectedDbStatus = "sleeping";
      break;
    case "shut off":
      expectedDbStatus = "sleeping";
      break;
    default:
      // "not_found" etc. — handled by reconciliation job
      return;
  }

  // No mismatch
  if (dbStatus === expectedDbStatus) {
    return;
  }

  // DB says running but VM is shut off or paused → one of three cases:
  //   (a) The guest issued `reboot` / `systemctl reboot`. Firecracker
  //       doesn't support guest reboot — it exits cleanly with
  //       `exit_code=0`. We auto-relaunch (rate-limited) so the customer
  //       gets what they asked for.
  //   (b) The boot crashed almost immediately (kernel panic, init error,
  //       OOM kill before login). Surface as `error` so the customer sees
  //       something went wrong.
  //   (c) The guest was paused (Firecracker `Pause` action — currently only
  //       used by the transfer flow, which excludes itself from this code
  //       path; or some other operator-issued pause). Surface as `sleeping`.
  // Tell (a) and (b) apart by tailing `fc.log` for Firecracker's
  // clean-exit marker. Tell (b) from a quiet shutdown by checking how
  // recently a lifecycle log was written (the "just booted" heuristic).
  if (
    dbStatus === "running" &&
    (hypervisorState === "shut off" || hypervisorState === "paused")
  ) {
    const BOOT_FAILURE_WINDOW_MS = 5 * 60 * 1000;

    const [latestLog] = await db
      .select({ createdAt: lifecycleLogs.createdAt })
      .from(lifecycleLogs)
      .where(
        and(
          eq(lifecycleLogs.entityType, "cube"),
          eq(lifecycleLogs.entityId, cube.id)
        )
      )
      .orderBy(desc(lifecycleLogs.createdAt))
      .limit(1);

    // Case (a): clean Firecracker exit means the guest rebooted itself.
    // Only check fc.log when the hypervisor reports `shut off` (a paused
    // VM can't have written an exit marker — it's still alive, just halted).
    if (hypervisorState === "shut off") {
      const cleanExit = await detectFirecrackerCleanExit(
        client,
        cube.id,
        cube.launchMode
      );
      if (cleanExit) {
        await handleGuestRebootedCube(cube, serverId);
        return;
      }
    }

    const justBooted =
      hypervisorState === "shut off" &&
      !!latestLog &&
      Date.now() - latestLog.createdAt.getTime() < BOOT_FAILURE_WINDOW_MS;

    const targetStatus: "sleeping" | "error" = justBooted
      ? "error"
      : "sleeping";

    console.log(
      `[cube-state-sync] cube "${cube.name}" (${cube.id}): DB=running, hypervisor=${hypervisorState} → updating to ${targetStatus}` +
        (justBooted ? " (recent boot, treating as boot failure)" : "")
    );

    // BILLING POLICY: do NOT charge prorated for state-sync detected
    // shutdowns — these are by definition unexpected (the cube.sleep /
    // cube.delete / snapshot.restore handlers all flip the DB row to a
    // non-"running" status BEFORE the hypervisor stops, so by the time
    // state-sync runs there would be no DB="running" + hypervisor="shut off"
    // mismatch to detect). Charging for the partial hour leading up to a
    // crash is unfair to the customer — they did not get the value out of
    // those minutes (kernel panic, OOM kill, guest filesystem corruption,
    // host reboot, or a `shutdown -h` from inside the guest that bypassed
    // our flow). Customer-initiated stops via the platform UI continue to
    // charge correctly because their handlers (cube-sleep.ts, cube-delete.ts,
    // snapshot-restore.ts) call chargeProratedUsage themselves.
    //
    // Past full-hour charges from the billing-hourly cron stand — those
    // cover time the cube was actually running and serving the customer.
    // Only the partial-hour-since-lastBilledAt is forgiven.

    // Atomic conditional update: only change if still "running" to prevent
    // overwriting concurrent operations (sleep, delete) that may have changed
    // status between our read and now. Reconcile the server's allocation
    // counters in the same transaction — running → sleeping must release
    // CPU+RAM back to the host pool (rule lives in `reconcileServerResources`);
    // running → error releases CPU+RAM+disk.
    const synced = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(cubes)
        .set({
          status: targetStatus,
          lastBilledAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(cubes.id, cube.id), eq(cubes.status, "running")))
        .returning({ id: cubes.id });
      if (!row) {
        return false;
      }
      await reconcileServerResources(tx, serverId);
      return true;
    });

    if (!synced) {
      console.log(
        `[cube-state-sync] cube ${cube.id} status changed concurrently, skipping sync to ${targetStatus}`
      );
      return;
    }

    const logMessage = justBooted
      ? "VM exited within minutes of boot — marked as error (likely boot failure or guest crash). No billing charge applied for this partial period."
      : hypervisorState === "shut off"
        ? "Cube unexpectedly powered off — marked as sleeping. Try waking the cube; if it fails again contact support. Compute charges stopped (no partial-period charge); sleep-storage billing continues for disk."
        : "Cube paused on hypervisor — marked as sleeping. Compute charges stopped (no partial-period charge); sleep-storage billing continues for disk.";

    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cube.id,
      message: logMessage,
    });

    await triggerCubeLifecycleEvent(cube.id, cube.spaceId, {
      status: targetStatus,
    });
    if (targetStatus === "sleeping" || targetStatus === "error") {
      dispatchWebhookEvent(
        cube.spaceId,
        targetStatus === "sleeping" ? "cube.sleeping" : "cube.error",
        {
          cube: buildCubeSummary({ ...cube, status: targetStatus }),
          reason: "state_sync_detected",
        }
      );
    }

    audit({
      action: "cube.state_sync",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cube.id,
      spaceId: cube.spaceId,
      description: `State sync: VM ${hypervisorState} on hypervisor, DB was running → ${targetStatus}`,
      metadata: {
        hypervisorState,
        previousDbStatus: dbStatus,
        serverId,
        justBooted,
      },
      source: "worker",
    });
  }

  // DB says sleeping but VM is actually running → sync to running
  if (dbStatus === "sleeping" && hypervisorState === "running") {
    console.log(
      `[cube-state-sync] cube "${cube.name}" (${cube.id}): DB=sleeping, hypervisor=running → updating to running`
    );

    // Atomic conditional update: only change if still "sleeping" to prevent
    // overwriting concurrent wake operations that may have already
    // transitioned the cube. Reconcile in the same transaction —
    // sleeping → running must reclaim the cube's CPU+RAM from the host pool.
    const synced = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(cubes)
        .set({
          status: "running",
          lastBilledAt: new Date(),
          lastStartedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(cubes.id, cube.id), eq(cubes.status, "sleeping")))
        .returning({ id: cubes.id });
      if (!row) {
        return false;
      }
      await reconcileServerResources(tx, serverId);
      return true;
    });

    if (!synced) {
      console.log(
        `[cube-state-sync] cube ${cube.id} status changed concurrently, skipping sync to running`
      );
      return;
    }

    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cube.id,
      message: "Cube detected as running on hypervisor — marked as running",
    });

    await triggerCubeLifecycleEvent(cube.id, cube.spaceId, {
      status: "running",
    });
    dispatchWebhookEvent(cube.spaceId, "cube.running", {
      cube: buildCubeSummary({ ...cube, status: "running" }),
      reason: "state_sync_detected",
    });

    audit({
      action: "cube.state_sync",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cube.id,
      spaceId: cube.spaceId,
      description:
        "State sync: VM running on hypervisor, DB was sleeping → running",
      metadata: { hypervisorState, previousDbStatus: dbStatus, serverId },
      source: "worker",
    });
  }
}

/**
 * Tail the cube's `fc.log` on the host and look for Firecracker's
 * clean-exit marker (emitted on guest-issued reboot or shutdown). Returns
 * false on any SSH/grep failure — when we can't tell, assume it's NOT a
 * clean exit (the safe default surfaces an error message to the customer
 * rather than silently auto-relaunching a possibly-crashed cube).
 *
 * `grep -F` is used because the marker contains no metacharacters and
 * `-F` is meaningfully faster on large logs. `tail -n 200` keeps the
 * scan bounded; Firecracker's exit line is always one of the last few
 * messages, but startCube's per-boot health-check noise can push it
 * slightly back from the absolute tail.
 */
async function detectFirecrackerCleanExit(
  client: Client,
  cubeId: string,
  launchMode: LaunchMode
): Promise<boolean> {
  const { fcLog } = cubePaths(cubeId, launchMode);
  try {
    const result = await execCommand(
      client,
      `tail -n 200 ${fcLog} 2>/dev/null | grep -F "${FIRECRACKER_CLEAN_EXIT_MARKER}" | tail -n 1`,
      10_000
    );
    return result.stdout.trim().length > 0;
  } catch (err) {
    console.warn(
      `[cube-state-sync] fc.log clean-exit probe failed for cube ${cubeId}:`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

/**
 * Auto-relaunch (rate-limited) a cube whose guest issued `reboot`. The
 * customer expects the cube to come back up — that's what the in-guest
 * `reboot` command means everywhere except Firecracker — so we enqueue
 * cube.auto-relaunch unless this cube has rebooted more than
 * AUTO_RELAUNCH_RATE_LIMIT times in the past hour, in which case we
 * mark it `error` and surface to admins (likely a reboot-looping guest).
 *
 * Atomic conditional update guards against racing with another state-sync
 * tick that also detected the same dead Firecracker — only the first one
 * past the status='running' check transitions the row and enqueues the
 * job; the dedup at the queue level (singletonKey + policy=exclusive)
 * is belt-and-suspenders if both tries got past the row update.
 */
async function handleGuestRebootedCube(
  cube: {
    diskLimitGb: number;
    id: string;
    imageId: string;
    internalIp: string | null;
    name: string;
    ramMb: number;
    serverId: string;
    spaceId: string;
    vcpus: number;
  },
  serverId: string
): Promise<void> {
  const since = new Date(Date.now() - AUTO_RELAUNCH_RATE_WINDOW_MS);
  const recentRelaunches = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(lifecycleLogs)
    .where(
      and(
        eq(lifecycleLogs.entityType, "cube"),
        eq(lifecycleLogs.entityId, cube.id),
        like(lifecycleLogs.message, "Cube auto-restarted after guest-issued%"),
        gte(lifecycleLogs.createdAt, since)
      )
    );

  const relaunchCount = recentRelaunches[0]?.count ?? 0;

  if (relaunchCount >= AUTO_RELAUNCH_RATE_LIMIT) {
    console.warn(
      `[cube-state-sync] cube "${cube.name}" (${cube.id}) is in a reboot loop ` +
        `(${relaunchCount} auto-restarts in past hour) — marking as error`
    );

    const [synced] = await db
      .update(cubes)
      .set({
        status: "error",
        lastBilledAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(cubes.id, cube.id), eq(cubes.status, "running")))
      .returning({ id: cubes.id });

    if (!synced) {
      return;
    }

    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cube.id,
      message:
        "Guest issued reboot but cube has hit the auto-restart rate limit " +
        `(${relaunchCount} in the past hour) — marked as error for manual review. ` +
        "No billing charge applied for this partial period.",
    });

    await triggerCubeLifecycleEvent(cube.id, cube.spaceId, {
      status: "error",
      reason: "auto-restart rate limit exceeded",
    });
    dispatchWebhookEvent(cube.spaceId, "cube.error", {
      cube: buildCubeSummary({ ...cube, status: "error" }),
      reason: "auto_restart_rate_limit",
    });

    audit({
      action: "cube.auto_relaunch_rate_limited",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cube.id,
      spaceId: cube.spaceId,
      description: `Cube hit auto-restart rate limit (${relaunchCount}/hr) — flipped to error`,
      metadata: {
        serverId,
        relaunchCount,
        windowMs: AUTO_RELAUNCH_RATE_WINDOW_MS,
      },
      source: "worker",
    });
    return;
  }

  // Under the rate limit — auto-relaunch. The cube.auto-relaunch handler
  // does its own atomic claim (running|booting → booting), so we don't
  // pre-transition the row here. We DO emit a lifecycle log to record
  // what state-sync observed before the relaunch fires.
  console.log(
    `[cube-state-sync] cube "${cube.name}" (${cube.id}): guest issued reboot ` +
      "(Firecracker exited cleanly) — enqueuing cube.auto-relaunch " +
      `(${relaunchCount + 1}/${AUTO_RELAUNCH_RATE_LIMIT} in past hour)`
  );

  // Enqueue first: a duplicate enqueue (singletonKey dedup) returns null,
  // and we don't want to double-log the "Guest issued reboot…" message on
  // back-to-back state-sync ticks that both see the same dead Firecracker
  // before the handler has had a chance to flip the row to `booting`.
  const jobId = await enqueueJob(
    JOB_NAMES.CUBE_AUTO_RELAUNCH,
    {
      cubeId: cube.id,
      spaceId: cube.spaceId,
      serverId,
      reason: "guest-issued reboot (Firecracker exit_code=0)",
    },
    { singletonKey: cube.id }
  );

  if (jobId === null) {
    // Another state-sync tick already enqueued for this cube; let that one
    // play out. No lifecycle / audit log so the UI doesn't show two
    // identical "Guest issued reboot…" entries.
    return;
  }

  await db.insert(lifecycleLogs).values({
    entityType: "cube",
    entityId: cube.id,
    message:
      "Guest issued reboot — Firecracker exited cleanly, auto-restarting cube " +
      `(${relaunchCount + 1}/${AUTO_RELAUNCH_RATE_LIMIT} in past hour)`,
  });

  audit({
    action: "cube.auto_relaunch_enqueued",
    category: "cube",
    actorType: "system",
    entityType: "cube",
    entityId: cube.id,
    spaceId: cube.spaceId,
    description: `Guest issued reboot — enqueued auto-relaunch (${relaunchCount + 1}/${AUTO_RELAUNCH_RATE_LIMIT}/hr)`,
    metadata: { serverId, relaunchCount },
    source: "worker",
  });
}
