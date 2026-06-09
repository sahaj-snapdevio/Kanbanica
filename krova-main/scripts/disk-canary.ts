/**
 * Single-cube CANARY for the disk-I/O overhaul: apply the per-cube disk features
 * (currently `cache_type=Writeback`) to ONE running cube and verify it relaunches
 * cleanly — before flipping any fleet-wide flag.
 *
 * It does NOT mutate global config. It enqueues a `cube.cold-restart` for the
 * given cube so the worker kills + relaunches it; on that relaunch the cube picks
 * up the per-cube disk features IFF its id is on the `DISK_CANARY_CUBE_IDS`
 * allowlist in config/platform.ts (which must be edited + deployed FIRST — the
 * script warns if the id isn't there, because a cold-restart without it just
 * relaunches the cube unchanged).
 *
 * Operator workflow (Rule 60 — operator runs this against prod):
 *   1. Add the cube id to `DISK_CANARY_CUBE_IDS = ["<cubeId>"]` and deploy.
 *   2. `pnpm disk:canary <cubeId>`  (this script — enqueues the cold-restart)
 *   3. Watch the dashboard for "running", then verify on the host:
 *        - the cube booted + networks,
 *        - `cat /proc/mounts | grep vda` inside the cube, then an fsync test:
 *          `dd if=/dev/zero of=/root/t bs=1M count=64 conv=fdatasync` returns
 *          durably (with Writeback a host power-loss after this would NOT lose it,
 *          unlike Unsafe).
 *   4. Roll back any time: remove the id from DISK_CANARY_CUBE_IDS, deploy,
 *      `pnpm disk:canary <cubeId>` again → relaunches on the old config.
 *
 * The worker MUST be running to process the enqueued job.
 *
 * Run: pnpm disk:canary <cubeId>
 */

import { existsSync } from "node:fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

async function main(): Promise<void> {
  const cubeId = process.argv[2];
  if (!cubeId) {
    console.error("Usage: pnpm disk:canary <cubeId>");
    process.exit(2);
  }

  const { eq } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const schema = await import("@/db/schema");
  const { DISK_CANARY_CUBE_IDS, DISK_WRITEBACK_CACHE_ENABLED } = await import(
    "@/config/platform"
  );
  const { enqueueJob } = await import("@/lib/worker/enqueue");
  const { JOB_NAMES } = await import("@/lib/worker/job-types");

  const [cube] = await db
    .select({
      id: schema.cubes.id,
      name: schema.cubes.name,
      spaceId: schema.cubes.spaceId,
      serverId: schema.cubes.serverId,
      status: schema.cubes.status,
    })
    .from(schema.cubes)
    .where(eq(schema.cubes.id, cubeId))
    .limit(1);

  if (!cube) {
    console.error(`Cube ${cubeId} not found.`);
    process.exit(1);
  }
  if (!cube.serverId) {
    console.error(`Cube ${cubeId} has no server assigned — cannot relaunch.`);
    process.exit(1);
  }

  const onAllowlist = DISK_CANARY_CUBE_IDS.includes(cubeId);
  const willApply = DISK_WRITEBACK_CACHE_ENABLED || onAllowlist;
  console.log(`Cube "${cube.name}" (${cubeId}) — status=${cube.status}`);
  console.log(
    `  DISK_WRITEBACK_CACHE_ENABLED (global) = ${DISK_WRITEBACK_CACHE_ENABLED}`
  );
  console.log(`  on DISK_CANARY_CUBE_IDS allowlist     = ${onAllowlist}`);
  if (!willApply) {
    console.error(
      "\n  ⚠ This cube will relaunch WITHOUT the disk features (Writeback).\n" +
        `    Add "${cubeId}" to DISK_CANARY_CUBE_IDS in config/platform.ts and\n` +
        "    deploy FIRST, then re-run this command. Aborting (nothing enqueued)."
    );
    process.exit(1);
  }
  if (cube.status !== "running") {
    console.error(
      `\n  ⚠ Cube is "${cube.status}", not "running". cold-restart relaunches a\n` +
        "    running cube. Start/wake it first, then re-run. Aborting."
    );
    process.exit(1);
  }

  const jobId = await enqueueJob(JOB_NAMES.CUBE_COLD_RESTART, {
    cubeId: cube.id,
    spaceId: cube.spaceId,
    serverId: cube.serverId,
  });

  await db.insert(schema.lifecycleLogs).values({
    entityType: "cube",
    entityId: cubeId,
    message: "Disk-canary cold-restart enqueued (cache_type=Writeback)",
  });

  console.log(
    `\n  ✓ cold-restart job ${jobId} enqueued. The worker will kill + relaunch the\n` +
      "    cube; on relaunch it boots with cache_type=Writeback. Watch the dashboard\n" +
      '    for "running", then run the fsync verification above.'
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("disk:canary failed:", err);
  process.exit(1);
});
