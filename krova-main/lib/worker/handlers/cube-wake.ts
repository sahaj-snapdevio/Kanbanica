import { and, eq, ne } from "drizzle-orm";
import type { Job } from "pg-boss";
import type { Client } from "ssh2";
import { cubes, lifecycleLogs, servers } from "@/db/schema";
import { audit } from "@/lib/audit";
import { resolveLaunchModeForCube } from "@/lib/cubes/launch-mode";
import { cubeNumaLaunchOpts } from "@/lib/cubes/numa-launch-opts";
import { db } from "@/lib/db";
import { triggerCubeLifecycleEvent } from "@/lib/pusher";
import { reconcileServerResources } from "@/lib/server/allocate";
import { subnetOf } from "@/lib/server/cube-network";
import { connectToServer, getCubeStatus, startCube, wakeCube } from "@/lib/ssh";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildCubeSummary } from "@/lib/webhook-payloads";
import { JobLogger } from "@/lib/worker/job-log";
import type { CubeWakePayload } from "@/lib/worker/job-types";

async function handleCubeWakeJob(job: Job<CubeWakePayload>): Promise<void> {
  const { cubeId, spaceId, serverId } = job.data;
  const log = new JobLogger(job.id, "cube.wake", "cube", cubeId);
  console.log(`[cube-wake] starting for cubeId=${cubeId}`);
  await log.info("Cube wake started");

  // 1. Atomically claim cube inside a transaction to prevent concurrent wake/sleep/delete races
  const cube = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(cubes)
      .where(eq(cubes.id, cubeId))
      .for("update")
      .limit(1);
    if (row?.status !== "sleeping") {
      return null;
    }

    // Mark as booting to prevent other operations from claiming it
    await tx
      .update(cubes)
      .set({ status: "booting", updatedAt: new Date() })
      .where(eq(cubes.id, cubeId));

    return row;
  });

  if (!cube) {
    console.log(
      `[cube-wake] cube ${cubeId} not found or not sleeping, skipping`
    );
    return;
  }

  // 2. Connect to the host. GUARDED (Rule 58): the cube is already claimed
  //    `booting`, so a host-down connect failure MUST revert it to `sleeping`
  //    (the cube never woke) and rethrow — otherwise it strands in `booting`
  //    forever, because the claim above requires `sleeping` and the pg-boss
  //    retry would short-circuit. Mirrors the main catch below.
  let client: Client;
  try {
    ({ client } = await connectToServer(serverId));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[cube-wake] host unreachable for cubeId=${cubeId}:`, err);
    await log.error(`Cube wake failed to connect to host: ${reason}`);
    await db
      .update(cubes)
      .set({ status: "sleeping", updatedAt: new Date() })
      .where(eq(cubes.id, cubeId))
      .catch(() => {});
    await triggerCubeLifecycleEvent(cubeId, spaceId, {
      status: "sleeping",
    }).catch(() => {});
    throw err;
  }

  try {
    // 3. Check VM state and resume/start accordingly
    let vmState = "unknown";
    try {
      vmState = (
        await getCubeStatus(client, cubeId, cube.launchMode)
      ).toLowerCase();
    } catch {
      // VM might not exist, startCube will fail with a clear error
    }

    await log.info(`Detected VM state: ${vmState}`);
    // `coldRestarted` is true if Firecracker actually re-loaded the kernel
    // from disk (startCube path). False for resume-from-paused (the kernel
    // stays in memory). We use this to know whether to refresh the cube's
    // bootedKernelVersion to whatever's currently on the server.
    let coldRestarted = false;
    let restartHasVirtioMem = false;
    // Resolve the launch mode once before any (re)start. With JAILER_ENABLED
    // false this returns { launchMode: "bare" } and the bare path stays
    // byte-identical.
    const { launchMode, jailerUid } = await resolveLaunchModeForCube({
      id: cubeId,
      serverId: cube.serverId ?? serverId,
      launchMode: cube.launchMode,
      jailerUid: cube.jailerUid,
    });

    // Fail-loud 198.18 scheme guard. Post-atomic-cutover the entire fleet is on
    // 198.18.0.0/15; a stray un-converted cube (still on a legacy 10.x IP, or on
    // a subnet that no longer matches its host's bridge_subnet) must NOT be
    // silently booted onto stale guest networking — it would come up
    // unreachable. subnetOf() THROWS on any non-198.18 address, so we guard it
    // and surface a clear, actionable error instead of crash-looping the parser
    // or routing it onto the wrong scheme.
    const [srv] = await db
      .select({ bridgeSubnet: servers.bridgeSubnet })
      .from(servers)
      .where(eq(servers.id, cube.serverId ?? serverId))
      .limit(1);
    if (cube.internalIp != null && srv?.bridgeSubnet != null) {
      let cubeSubnet: number | null = null;
      try {
        cubeSubnet = subnetOf(cube.internalIp);
      } catch {
        // subnetOf throws on any non-198.18 IPv4 — leave cubeSubnet null so the
        // invariant check below fires.
        cubeSubnet = null;
      }
      if (cubeSubnet === null || cubeSubnet !== srv.bridgeSubnet) {
        throw new Error(
          `Cube ${cubeId} internal IP (${cube.internalIp}) is not on its host's 198.18 subnet (expected S=${srv.bridgeSubnet}) — this should not happen; investigate before waking.`
        );
      }
    }

    if (vmState === "paused") {
      await log.step("Resume paused Firecracker VM", async () => {
        await wakeCube(client, cubeId, cube.launchMode);
      });
    } else if (vmState === "shut off") {
      // Firecracker process died — restart with a new process.
      // Unlike libvirt, Firecracker doesn't persist domain definitions,
      // so we need the cube config to restart.
      if (!cube.internalIp || cube.vcpus <= 0 || cube.ramMb <= 0) {
        throw new Error(
          `Cannot restart Cube ${cubeId}: missing config (ip=${cube.internalIp}, vcpus=${cube.vcpus}, ram=${cube.ramMb})`
        );
      }
      await log.step("Restart Firecracker VM (was shut off)", async () => {
        const r = await startCube(client, cubeId, {
          vcpus: cube.vcpus,
          ramMb: cube.ramMb,
          internalIp: cube.internalIp!,
          launchMode,
          jailerUid,
          ...(await cubeNumaLaunchOpts(cubeId)),
        });
        restartHasVirtioMem = r.hasVirtioMem;
      });
      coldRestarted = true;
    } else {
      await log.step(
        "Try resume, fall back to restart on failure",
        async () => {
          try {
            await wakeCube(client, cubeId, cube.launchMode);
          } catch {
            if (!cube.internalIp || cube.vcpus <= 0 || cube.ramMb <= 0) {
              throw new Error(
                `Cannot restart Cube ${cubeId}: missing config (ip=${cube.internalIp}, vcpus=${cube.vcpus}, ram=${cube.ramMb})`
              );
            }
            const r = await startCube(client, cubeId, {
              vcpus: cube.vcpus,
              ramMb: cube.ramMb,
              internalIp: cube.internalIp,
              launchMode,
              jailerUid,
              ...(await cubeNumaLaunchOpts(cubeId)),
            });
            restartHasVirtioMem = r.hasVirtioMem;
            coldRestarted = true;
          }
        }
      );
    }

    // If we actually cold-restarted, refresh `bootedKernelVersion` to the
    // server's current kernel. Resume-from-paused leaves it alone (same
    // in-memory kernel).
    let refreshedKernelVersion: number | null = null;
    if (coldRestarted) {
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
          "[cube-wake] kernel version refresh failed (non-fatal):",
          err instanceof Error ? err.message : err
        );
      }
    }

    // 4. Update Cube status, clear zeroBalanceSleep, start billing clock,
    //    AND reclaim the cube's CPU+RAM from the host pool. The sleep/
    //    power-off handler released them when the cube went to sleep, so we
    //    have to add them back here. One transaction so a crash between
    //    the status flip and the reconcile can't leave the server
    //    under-counting an already-running cube.
    //    `ne("deleted")` guard: a concurrent `cube.delete` can claim the
    //    cube (booting → deleted) while wakeCube/startCube is running.
    //    Without this guard, the final UPDATE would resurrect the deleted
    //    cube as `running` with a live Firecracker the platform no longer
    //    tracks.
    await db.transaction(async (tx) => {
      const [synced] = await tx
        .update(cubes)
        .set({
          status: "running",
          zeroBalanceSleep: false,
          lastBilledAt: new Date(),
          lastStartedAt: new Date(),
          // A successful wake (incl. the cube:inspect --restart path: error →
          // sleeping → wake) clears the auto error-recovery budget so a later,
          // unrelated error episode gets a fresh set of attempts.
          errorRecoveryAttempts: 0,
          // Only flip hasVirtioMem when we actually cold-restarted — resume from
          // paused keeps the same Firecracker process whose device set was fixed
          // at original boot time. A pre-virtio-mem cube that resumes still has
          // no virtio-mem device.
          ...(coldRestarted ? { hasVirtioMem: restartHasVirtioMem } : {}),
          ...(coldRestarted && refreshedKernelVersion !== null
            ? { bootedKernelVersion: refreshedKernelVersion }
            : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(cubes.id, cubeId), ne(cubes.status, "deleted")))
        .returning({ id: cubes.id });
      if (synced) {
        await reconcileServerResources(tx, serverId);
      }
    });

    // 5. Write lifecycle log
    const message = cube.zeroBalanceSleep
      ? "Cube resumed — credits topped up"
      : "Cube resumed from sleep";
    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message,
    });

    // 6. Fire Pusher event + outbound webhooks
    await triggerCubeLifecycleEvent(cubeId, spaceId, { status: "running" });
    dispatchWebhookEvent(spaceId, "cube.running", {
      cube: buildCubeSummary({ ...cube, status: "running" }),
    });

    audit({
      action: "cube.wake_complete",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: "Cube resumed from sleep",
      metadata: { serverId },
      source: "worker",
    });

    console.log(`[cube-wake] completed cubeId=${cubeId}`);
    await log.info("Cube wake complete — running");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[cube-wake] failed cubeId=${cubeId}:`, err);
    await log.error(`Cube wake failed: ${reason}`);

    // Revert status back to sleeping so the user can retry
    await db
      .update(cubes)
      .set({ status: "sleeping", updatedAt: new Date() })
      .where(eq(cubes.id, cubeId))
      .catch(() => {});

    await triggerCubeLifecycleEvent(cubeId, spaceId, {
      status: "sleeping",
    }).catch(() => {});

    throw err;
  } finally {
    client.end();
  }
}

export async function handleCubeWake(
  jobs: Job<CubeWakePayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleCubeWakeJob(job);
  }
}
