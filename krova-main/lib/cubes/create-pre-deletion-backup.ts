import { and, eq, inArray } from "drizzle-orm";
import {
  cubeBackups,
  type cubes,
  domainMappings,
  lifecycleLogs,
  regions,
  servers,
  tcpMappingWhitelistedIps,
  tcpPortMappings,
} from "@/db/schema";
import { db } from "@/lib/db";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

type CubeRow = typeof cubes.$inferSelect;

/**
 * Create a `cube_backups` row, write a lifecycle log entry, and enqueue
 * the `backup.create` job. Two flows share this helper because the
 * config-snapshot logic (vCPU/RAM/disk/image/region/domain/TCP) is
 * identical for both:
 *
 *  1. **Pre-deletion backup** — caller passes `deleteCubeAfter: true`
 *     **explicitly**. The `backup.create` handler's `finally` block
 *     enqueues `cube.delete` after the backup finishes (even on
 *     failure), so the source cube is cleaned up. Used by:
 *      - `app/actions/cubes.ts` — customer delete with "Preserve backup"
 *      - `lib/worker/handlers/cube-stale-check.ts` — stuck-cube auto-cleanup
 *
 *  2. **Save-as-backup** — `deleteCubeAfter` omitted or `false`. The
 *     source cube keeps running; only the backup is created. Used by:
 *      - `app/actions/backups.ts:createBackupFromCube` — customer-triggered
 *        redeployable backup from a running cube.
 *
 * Deletion is **opt-in** by design: the helper defaults to NOT deleting
 * so a forgotten flag at any future call site can never accidentally
 * destroy a customer's running cube.
 */
export async function createPreDeletionBackup(opts: {
  cube: CubeRow;
  /** Id of the user who initiated the backup, or `null` for system flows. */
  createdBy: string | null;
  /** Free-text message written to `lifecycle_logs` for this backup. */
  lifecycleMessage: string;
  /** Override the backup's display name (defaults to the cube's current name). */
  backupName?: string;
  /**
   * Whether the worker should enqueue `cube.delete` after the backup
   * completes. **Default `false`** — deletion is opt-in. Pre-deletion
   * callers MUST pass `true` explicitly.
   */
  deleteCubeAfter?: boolean;
  /**
   * Skip the default `backup.create` enqueue. Used by the promote-from-
   * snapshot flow which inserts the `cube_backups` row via this helper
   * (to reuse the cubeConfig snapshot logic) but enqueues its own
   * `snapshot.promote-to-backup` handler that restic-dumps the source
   * snapshot rather than compressing the live rootfs. Default `false`.
   */
  skipEnqueue?: boolean;
}): Promise<{ backupId: string }> {
  const {
    cube,
    createdBy,
    lifecycleMessage,
    backupName,
    deleteCubeAfter = false,
    skipEnqueue = false,
  } = opts;

  const domainMaps = await db
    .select({
      domain: domainMappings.domain,
      port: domainMappings.port,
    })
    .from(domainMappings)
    .where(
      and(
        eq(domainMappings.cubeId, cube.id),
        eq(domainMappings.status, "active")
      )
    );

  const tcpMapsRaw = await db
    .select({
      id: tcpPortMappings.id,
      cubePort: tcpPortMappings.cubePort,
      label: tcpPortMappings.label,
      isSsh: tcpPortMappings.isSsh,
    })
    .from(tcpPortMappings)
    .where(eq(tcpPortMappings.cubeId, cube.id));

  const tcpMappingIds = tcpMapsRaw.filter((t) => !t.isSsh).map((t) => t.id);
  const allWhitelistIps =
    tcpMappingIds.length > 0
      ? await db
          .select()
          .from(tcpMappingWhitelistedIps)
          .where(inArray(tcpMappingWhitelistedIps.mappingId, tcpMappingIds))
      : [];

  const whitelistByMapping = new Map<string, string[]>();
  for (const ip of allWhitelistIps) {
    const existing = whitelistByMapping.get(ip.mappingId) ?? [];
    existing.push(ip.cidr);
    whitelistByMapping.set(ip.mappingId, existing);
  }

  const server = await db.query.servers.findFirst({
    where: eq(servers.id, cube.serverId),
  });
  let regionName = "Unknown";
  if (server?.regionId) {
    const [region] = await db
      .select({ name: regions.name })
      .from(regions)
      .where(eq(regions.id, server.regionId))
      .limit(1);
    if (region) {
      regionName = region.name;
    }
  }

  const cubeConfig = {
    vcpus: cube.vcpus,
    ramMb: cube.ramMb,
    diskLimitGb: cube.diskLimitGb,
    imageId: cube.imageId,
    regionId: server?.regionId ?? "",
    regionName,
    domainMappings: domainMaps,
    tcpMappings: tcpMapsRaw
      .filter((t) => !t.isSsh)
      .map((t) => ({
        cubePort: t.cubePort,
        label: t.label,
        whitelistedCidrs: whitelistByMapping.get(t.id) ?? [],
      })),
  };

  const [backup] = await db
    .insert(cubeBackups)
    .values({
      spaceId: cube.spaceId,
      name: backupName ?? cube.name,
      status: "pending",
      originalCubeId: cube.id,
      originalCubeName: cube.name,
      cubeConfig,
      diskSizeGb: cube.diskLimitGb,
      createdBy,
    })
    .returning({ id: cubeBackups.id });

  await db.insert(lifecycleLogs).values({
    entityType: "cube",
    entityId: cube.id,
    message: lifecycleMessage,
  });

  if (!skipEnqueue) {
    await enqueueJob(JOB_NAMES.BACKUP_CREATE, {
      backupId: backup.id,
      cubeId: cube.id,
      spaceId: cube.spaceId,
      serverId: cube.serverId,
      deleteCubeAfter,
    });
  }

  return { backupId: backup.id };
}
