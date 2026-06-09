/**
 * Storage backend health check job.
 *
 * Connects to each active S3 backend and runs `HeadBucket` to confirm
 * credentials + endpoint reachability. Updates `lastHealthCheck` and
 * emits a warning when `usedBytes` is at >=85% of `capacityGb`.
 */

import { eq } from "drizzle-orm";
import { storageBackends } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { decryptValue, Secret } from "@/lib/encrypt";
import { env } from "@/lib/env";
import { getStorageEnvSegment } from "@/lib/storage/restic";
import { s3ProbeBackend, s3SumObjectSizes } from "@/lib/storage/s3-direct";
import type { StorageBackendConnection } from "@/lib/storage/types";

const CAPACITY_WARNING_THRESHOLD = 0.85;

export async function handleStorageHealthCheck(): Promise<void> {
  console.log("[storage-health-check] starting capacity check");

  const activeBackends = await db.query.storageBackends.findMany({
    where: eq(storageBackends.isActive, true),
  });

  if (activeBackends.length === 0) {
    console.log("[storage-health-check] no active backends, skipping");
    return;
  }

  let checked = 0;
  let warnings = 0;
  let failures = 0;

  for (const backend of activeBackends) {
    try {
      const conn: StorageBackendConnection = {
        id: backend.id,
        name: backend.name,
        endpoint: backend.endpoint,
        region: backend.region,
        bucket: backend.bucket,
        accessKeyId: new Secret(decryptValue(backend.accessKeyIdEnc)),
        secretAccessKey: new Secret(decryptValue(backend.secretAccessKeyEnc)),
      };

      await s3ProbeBackend(conn);

      // Reconcile usedBytes against GROUND TRUTH: sum the real size of every
      // object Krova stores under this backend's `<env>/` prefix (restic repos
      // + backups + imports + exports). The per-op `adjustBackendUsage` deltas
      // are only a between-tick approximation — several removal paths
      // (`snapshot.auto-prune`, `restic.prune`'s chunk reclaim, `cube.delete`'s
      // repo-prefix wipe) never decrement, so without this periodic recompute
      // usedBytes drifts upward unbounded. Streamed sum — never holds the full
      // object list in memory. On failure we keep the prior value (don't zero).
      let usedBytes = backend.usedBytes;
      try {
        const envPrefix = `${getStorageEnvSegment(env.NODE_ENV)}/`;
        const { totalBytes, objectCount } = await s3SumObjectSizes(conn, [
          envPrefix,
        ]);
        usedBytes = totalBytes;
        console.log(
          `[storage-health-check] ${backend.name}: reconciled usedBytes=${totalBytes} across ${objectCount} object(s)`
        );
      } catch (sumErr) {
        console.error(
          `[storage-health-check] failed to reconcile usedBytes for ${backend.name}, keeping prior value:`,
          sumErr instanceof Error ? sumErr.message : sumErr
        );
      }

      const capacityBytes =
        backend.capacityGb == null ? null : backend.capacityGb * 1024 ** 3;
      const usagePercent =
        capacityBytes != null && capacityBytes > 0
          ? (usedBytes / capacityBytes) * 100
          : 0;

      await db
        .update(storageBackends)
        .set({ usedBytes, lastHealthCheck: new Date(), updatedAt: new Date() })
        .where(eq(storageBackends.id, backend.id));

      if (capacityBytes == null) {
        console.log(
          `[storage-health-check] ${backend.name}: reachable (no capacity configured)`
        );
      } else {
        const freeGb = Math.max(
          0,
          Math.round((capacityBytes - usedBytes) / 1024 / 1024 / 1024)
        );
        console.log(
          `[storage-health-check] ${backend.name}: ${usagePercent.toFixed(1)}% used (${freeGb} GB free)`
        );

        if (usagePercent / 100 >= CAPACITY_WARNING_THRESHOLD) {
          warnings++;
          console.warn(
            `[storage-health-check] WARNING: ${backend.name} is at ${usagePercent.toFixed(1)}% capacity!`
          );

          try {
            const { getErrorNotifyEmails } = await import(
              "@/lib/service-config"
            );
            const { enqueueEmail } = await import("@/lib/email");
            const recipients = await getErrorNotifyEmails();
            for (const to of recipients) {
              await enqueueEmail({
                to,
                subject: `[Krova] Storage backend "${backend.name}" at ${usagePercent.toFixed(0)}% capacity`,
                html: `<p>Storage backend <strong>${backend.name}</strong> (${backend.endpoint}, bucket <code>${backend.bucket}</code>) is at <strong>${usagePercent.toFixed(1)}%</strong> of its <strong>${backend.capacityGb} GB</strong> plan with only <strong>${freeGb} GB</strong> free. Add a new backend or clean up old snapshots/backups.</p>`,
                text: `Storage backend "${backend.name}" (${backend.endpoint}, bucket ${backend.bucket}) is at ${usagePercent.toFixed(1)}% capacity with ${freeGb} GB free.`,
              });
            }
          } catch (emailErr) {
            console.error(
              "[storage-health-check] failed to send capacity warning email:",
              emailErr
            );
          }
        }
      }

      checked++;
    } catch (err) {
      failures++;
      console.error(
        `[storage-health-check] failed to check ${backend.name}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  audit({
    action: "storage.health_check",
    category: "platform",
    actorType: "system",
    entityType: "storage",
    description: `Storage health check: ${checked}/${activeBackends.length} reachable, ${warnings} warning(s), ${failures} failure(s)`,
    metadata: {
      total: activeBackends.length,
      checked,
      warnings,
      failures,
    },
    source: "worker",
  });

  // Avoid printing the words "failure" / "warning" on a clean run — the
  // Dokploy log viewer keyword-matches log content and color-codes
  // `0 failure(s)` as a red ERROR row, which is misleading. Only mention
  // those counts when they are non-zero (and then the colorisation is
  // actually appropriate).
  const summary =
    failures === 0 && warnings === 0
      ? `all ${checked} backend(s) healthy`
      : `${checked} ok, ${warnings} near capacity, ${failures} unreachable`;
  console.log(`[storage-health-check] completed — ${summary}`);
}
