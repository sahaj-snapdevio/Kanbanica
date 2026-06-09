import { and, eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import { cubes } from "@/db/schema";
import { db } from "@/lib/db";
import { triggerCubeLifecycleEvent } from "@/lib/pusher";
import { bootCube } from "@/lib/worker/cube-boot";
import { JobLogger } from "@/lib/worker/job-log";
import type { CubeProvisionPayload } from "@/lib/worker/job-types";

async function handleCubeProvisionJob(
  job: Job<CubeProvisionPayload>
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
    userData,
  } = job.data;
  console.log(`[cube-provision] starting for cubeId=${cubeId}`);

  // Check current cube status for idempotency
  const currentCube = await db.query.cubes.findFirst({
    where: eq(cubes.id, cubeId),
    columns: { status: true, name: true },
  });

  if (!currentCube) {
    console.log(`[cube-provision] cube ${cubeId} not found, skipping`);
    return;
  }

  if (currentCube.status === "running") {
    console.log(
      `[cube-provision] cube ${cubeId} already running, idempotent success`
    );
    return;
  }

  if (currentCube.status === "booting") {
    // Check how long it's been booting — if under 10 min, another provision attempt
    // is likely still in progress, so skip to avoid duplicate boot. The stale-check
    // job will clean up cubes stuck in booting for over 10 minutes.
    console.log(
      `[cube-provision] cube ${cubeId} already booting, skipping (stale-check will handle if stuck)`
    );
    return;
  }

  // Atomic idempotent claim: only proceed if status is still "pending".
  // Transition to "booting" so concurrent provision jobs skip this cube.
  const [claimed] = await db
    .update(cubes)
    .set({ status: "booting", updatedAt: new Date() })
    .where(and(eq(cubes.id, cubeId), eq(cubes.status, "pending")))
    .returning({ name: cubes.name });

  if (!claimed) {
    console.log(
      `[cube-provision] cube ${cubeId} not pending (status=${currentCube.status}), skipping`
    );
    return;
  }

  // Broadcast the pending → booting transition immediately. Without this, the
  // UI relies on the next Pusher event from bootCube() to learn about the
  // status change, leaving a window where the badge sits at "pending" while
  // the worker is already booting.
  await triggerCubeLifecycleEvent(cubeId, spaceId, { status: "booting" });

  const log = new JobLogger(job.id, "cube.provision", "cube", cubeId);

  // Boot the cube using the shared boot lifecycle — no extra callbacks needed
  await bootCube(
    {
      cubeId,
      spaceId,
      serverId,
      vcpus,
      ramMb,
      diskLimitGb,
      imageId,
      sshPublicKey,
      cubeName: claimed.name,
      userData,
      log,
    },
    {
      entityLabel: `Cube "${claimed.name}"`,
      errorUrlPath: `/${spaceId}/cubes/${cubeId}`,
    }
  );
}

export async function handleCubeProvision(
  jobs: Job<CubeProvisionPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleCubeProvisionJob(job);
  }
}
