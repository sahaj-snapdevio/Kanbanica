/**
 * Storage backend audit / cleanup.
 *
 *   pnpm storage:audit                  — dry run: report orphans
 *   pnpm storage:audit --delete         — delete eligible orphans
 *   pnpm storage:audit --min-age-hours=6  — change the in-flight safety window
 *
 * Three storage layouts coexist on the bucket:
 *
 *   1. **Full-blob backups** as `.cube` archives at
 *      `<env>/backups/<spaceId>/<backupId>.cube`. Audit: an object with
 *      no matching `cube_backups.storagePath` is an orphan and is
 *      eligible for deletion.
 *
 *   2. **Restic snapshot repos** at `<env>/snapshot-repos/<cubeId>/...`.
 *      Per-cube repos containing many internal chunk files. We do NOT
 *      audit individual chunks (restic owns chunk lifecycle and the
 *      `restic.prune` cron handles unreferenced chunks). Instead we
 *      check whether the `<cubeId>` prefix maps to a live cube — if
 *      not, the entire repo is orphan and the prefix can be wiped.
 *
 *   3. **Customer-uploaded import archives** at
 *      `<env>/imports/<spaceId>/<importId>.cube`. Audit: an object with
 *      no matching active `cube_imports` row is an orphan (the worker
 *      / reaper deletes these after successful provisioning).
 *
 *   4. **Snapshot export archives** at
 *      `<env>/exports/<spaceId>/<exportId>.cube`. Audit: an object with
 *      no matching `snapshot_exports` row in a non-terminal state is an
 *      orphan (the `snapshot.export-reap` hourly cron deletes these
 *      after the 24h presigned-URL TTL).
 *
 * Safety: `--delete` skips any object younger than `--min-age-hours`
 * (default 24h) so an in-progress upload (the DB row's storagePath /
 * cube row is written only AFTER the upload finishes) is never
 * mistaken for an orphan.
 */
import { existsSync } from "fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

/**
 * Prefixes we list when auditing each backend. Backups are scanned at
 * the object level (per-file orphan check); restic repos are scanned
 * at the prefix level (per-cube orphan check).
 */
const BACKUP_PREFIXES = ["production/backups/", "development/backups/"];
const RESTIC_REPO_PREFIXES = [
  "production/snapshot-repos/",
  "development/snapshot-repos/",
];
const IMPORT_PREFIXES = ["production/imports/", "development/imports/"];
// Snapshot exports (`snapshot.export` handler writes here, snapshot.export-
// reap cron sweeps after the 24h TTL). Objects with no matching
// `snapshot_exports` row in a non-terminal state are orphan.
const EXPORT_PREFIXES = ["production/exports/", "development/exports/"];

function fmtBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(2)} ${units[i]}`;
}

function fmtAge(mtimeMs: number): string {
  if (mtimeMs <= 0) {
    return "?";
  }
  const hours = (Date.now() - mtimeMs) / 3_600_000;
  if (hours < 1) {
    return `${Math.round(hours * 60)}m`;
  }
  if (hours < 48) {
    return `${hours.toFixed(1)}h`;
  }
  return `${(hours / 24).toFixed(1)}d`;
}

/**
 * Extract the cube id from a restic-repo object key. Format:
 *   `<env>/snapshot-repos/<cubeId>/...`
 * Returns null if the key doesn't match the expected layout.
 */
function repoCubeIdFromKey(key: string): string | null {
  const parts = key.split("/");
  if (parts.length < 3) {
    return null;
  }
  if (parts[1] !== "snapshot-repos") {
    return null;
  }
  return parts[2] || null;
}

/**
 * Extract the import id from an upload object key. Format:
 *   `<env>/imports/<spaceId>/<importId>.cube`
 * Returns null if the key doesn't match the expected layout.
 */
function importIdFromKey(key: string): string | null {
  const parts = key.split("/");
  if (parts.length !== 4) {
    return null;
  }
  if (parts[1] !== "imports") {
    return null;
  }
  const filename = parts[3];
  if (!filename.endsWith(".cube")) {
    return null;
  }
  return filename.slice(0, -".cube".length) || null;
}

/**
 * Pull the `<exportId>` out of `<env>/exports/<spaceId>/<exportId>.cube`.
 * Mirrors `importIdFromKey` — both prefixes use the same per-space layout.
 */
function exportIdFromKey(key: string): string | null {
  const parts = key.split("/");
  if (parts.length !== 4) {
    return null;
  }
  if (parts[1] !== "exports") {
    return null;
  }
  const filename = parts[3];
  if (!filename.endsWith(".cube")) {
    return null;
  }
  return filename.slice(0, -".cube".length) || null;
}

async function main() {
  const args = process.argv.slice(2);
  const doDelete = args.includes("--delete");
  const minAgeArg = args.find((a) => a.startsWith("--min-age-hours="));
  const parsedAge = minAgeArg ? Number(minAgeArg.split("=")[1]) : Number.NaN;
  const minAgeHours =
    Number.isFinite(parsedAge) && parsedAge >= 0 ? parsedAge : 24;
  const minAgeMs = minAgeHours * 3_600_000;

  const { db } = await import("@/lib/db");
  const schema = await import("@/db/schema");
  const { s3ListObjects, s3DeleteObjects } = await import(
    "@/lib/storage/s3-direct"
  );
  const { getBackendConnection } = await import("@/lib/storage/backends");

  const backends = await db.select().from(schema.storageBackends);
  if (backends.length === 0) {
    console.log("No storage backends configured — nothing to audit.");
    process.exit(0);
  }

  // Tracked backup object keys (one-to-one with cube_backups rows).
  const backupRows = await db
    .select({
      id: schema.cubeBackups.id,
      storagePath: schema.cubeBackups.storagePath,
      storageBackendId: schema.cubeBackups.storageBackendId,
      status: schema.cubeBackups.status,
    })
    .from(schema.cubeBackups);
  const knownBackupKeys = new Set<string>();
  for (const row of backupRows) {
    if (row.storagePath) {
      knownBackupKeys.add(row.storagePath);
    }
  }

  // Live cube ids — used to identify orphan restic repos (prefix
  // `<cubeId>` not matching any non-deleted cube).
  const liveCubeRows = await db
    .select({ id: schema.cubes.id, status: schema.cubes.status })
    .from(schema.cubes);
  const liveCubeIds = new Set<string>();
  for (const c of liveCubeRows) {
    if (c.status !== "deleted") {
      liveCubeIds.add(c.id);
    }
  }

  // Active import ids — used to identify orphan `imports/<importId>.cube`
  // objects (terminal states `complete`, `failed`, `expired` mean the row
  // is done; their S3 object should already have been deleted by the
  // worker / reaper, so anything still present in S3 with no matching
  // active row is an orphan).
  const importRows = await db
    .select({
      id: schema.cubeImports.id,
      status: schema.cubeImports.status,
    })
    .from(schema.cubeImports);
  const liveImportIds = new Set<string>();
  for (const r of importRows) {
    if (
      r.status === "uploading" ||
      r.status === "finalizing" ||
      r.status === "provisioning"
    ) {
      liveImportIds.add(r.id);
    }
  }

  // Active snapshot export ids — same logic as imports. `ready` rows are
  // in-flight downloads; `pending`/`materializing` rows are being
  // produced. `expired`/`failed` rows are terminal and their S3 object
  // should have been deleted by the `snapshot.export-reap` cron; anything
  // still present with no matching active row is an orphan.
  const exportRows = await db
    .select({
      id: schema.snapshotExports.id,
      status: schema.snapshotExports.status,
    })
    .from(schema.snapshotExports);
  const liveExportIds = new Set<string>();
  for (const r of exportRows) {
    if (
      r.status === "pending" ||
      r.status === "materializing" ||
      r.status === "ready"
    ) {
      liveExportIds.add(r.id);
    }
  }

  // Snapshot rows — used for the dangling-row report (snapshot row
  // points at a restic snapshot id that doesn't exist in any repo).
  const snapshotRows = await db
    .select({
      id: schema.cubeSnapshots.id,
      cubeId: schema.cubeSnapshots.cubeId,
      storagePath: schema.cubeSnapshots.storagePath,
      storageBackendId: schema.cubeSnapshots.storageBackendId,
      status: schema.cubeSnapshots.status,
    })
    .from(schema.cubeSnapshots);

  console.log(
    `Auditing ${backends.length} backend(s) against ${knownBackupKeys.size} backup object(s) and ${liveCubeIds.size} live cube repo(s).`
  );
  console.log(
    doDelete
      ? `Mode: DELETE (orphans older than ${minAgeHours}h will be removed)`
      : "Mode: dry run (no objects will be deleted)"
  );

  const scannedBackendIds = new Set<string>();
  const seenBackupKeys = new Set<string>();
  let totalOrphanBackupObjects = 0;
  let totalOrphanBackupBytes = 0;
  let totalOrphanRepoCubeIds = 0;
  let totalOrphanRepoBytes = 0;
  let totalOrphanImportObjects = 0;
  let totalOrphanImportBytes = 0;
  let totalOrphanExportObjects = 0;
  let totalOrphanExportBytes = 0;
  let totalDeleted = 0;
  let totalDeletedBytes = 0;

  for (const backend of backends) {
    const tag = backend.isActive ? "" : " [inactive]";
    console.log(`\n=== Backend "${backend.name}" (${backend.id})${tag} ===`);

    const conn = await getBackendConnection(backend.id);
    if (!conn) {
      console.log("  Skipped — could not load connection.");
      continue;
    }

    // ── Phase 1: full-blob backups ────────────────────────────────
    let backupObjects: { key: string; sizeBytes: number; mtimeMs: number }[];
    try {
      backupObjects = await s3ListObjects(conn, BACKUP_PREFIXES);
    } catch (err) {
      console.log(`  Skipped backups — failed to list: ${String(err)}`);
      continue;
    }
    scannedBackendIds.add(backend.id);
    for (const o of backupObjects) {
      seenBackupKeys.add(o.key);
    }

    const backupOrphans = backupObjects
      .filter((o) => !knownBackupKeys.has(o.key))
      .sort((a, b) => b.sizeBytes - a.sizeBytes);

    if (backupOrphans.length === 0) {
      console.log(
        `  Backups: ${backupObjects.length} object(s) — no orphans. OK`
      );
    } else {
      const orphanBytes = backupOrphans.reduce((s, f) => s + f.sizeBytes, 0);
      totalOrphanBackupObjects += backupOrphans.length;
      totalOrphanBackupBytes += orphanBytes;
      console.log(
        `  Backups: ${backupObjects.length} object(s), ${backupOrphans.length} orphan(s) — ${fmtBytes(orphanBytes)}:`
      );

      const deletableKeys: string[] = [];
      let deletableBytes = 0;
      for (const o of backupOrphans) {
        const tooYoung = Date.now() - o.mtimeMs < minAgeMs;
        console.log(
          `    [backup]   ${fmtBytes(o.sizeBytes).padStart(10)}  age=${fmtAge(o.mtimeMs)}${tooYoung ? "  (recent — kept as possible in-flight upload)" : ""}`
        );
        console.log(`      ${o.key}`);
        if (!tooYoung) {
          deletableKeys.push(o.key);
          deletableBytes += o.sizeBytes;
        }
      }

      if (deletableKeys.length > 0 && doDelete) {
        const { deleted, failed } = await s3DeleteObjects(deletableKeys, conn);
        totalDeleted += deleted;
        totalDeletedBytes += deletableBytes;
        console.log(
          `  Deleted ${deleted} backup orphan(s), ${fmtBytes(deletableBytes)} reclaimed${failed > 0 ? ` — ${failed} failed (re-run to retry)` : ""}.`
        );
      } else if (deletableKeys.length > 0) {
        console.log(
          `  -> ${deletableKeys.length} backup orphan(s) (${fmtBytes(deletableBytes)}) eligible for deletion — re-run with --delete.`
        );
      }
    }

    // ── Phase 2: restic snapshot repos ────────────────────────────
    // Group all chunk objects by `<cubeId>` from the key. A cube id
    // not in `liveCubeIds` means the entire repo is orphan and can
    // be wiped (the cube was deleted but the repo prefix sweep
    // failed, OR the cube was deleted before the restic refactor
    // and its old `.ext4.zst` snapshots got cleaned up but a stray
    // restic repo got created somehow — defensive coverage).
    let repoObjects: { key: string; sizeBytes: number; mtimeMs: number }[];
    try {
      repoObjects = await s3ListObjects(conn, RESTIC_REPO_PREFIXES);
    } catch (err) {
      console.log(`  Skipped restic repos — failed to list: ${String(err)}`);
      continue;
    }

    interface RepoSummary {
      cubeId: string;
      newestMtimeMs: number;
      objects: typeof repoObjects;
      totalBytes: number;
    }
    const reposByCubeId = new Map<string, RepoSummary>();
    for (const o of repoObjects) {
      const cubeId = repoCubeIdFromKey(o.key);
      if (!cubeId) {
        continue;
      }
      const existing = reposByCubeId.get(cubeId);
      if (existing) {
        existing.objects.push(o);
        existing.totalBytes += o.sizeBytes;
        if (o.mtimeMs > existing.newestMtimeMs) {
          existing.newestMtimeMs = o.mtimeMs;
        }
      } else {
        reposByCubeId.set(cubeId, {
          cubeId,
          objects: [o],
          totalBytes: o.sizeBytes,
          newestMtimeMs: o.mtimeMs,
        });
      }
    }

    const orphanRepos = [...reposByCubeId.values()].filter(
      (r) => !liveCubeIds.has(r.cubeId)
    );

    if (orphanRepos.length === 0) {
      console.log(
        `  Restic repos: ${reposByCubeId.size} repo(s) — all map to live cubes. OK`
      );
    } else {
      const repoOrphanBytes = orphanRepos.reduce((s, r) => s + r.totalBytes, 0);
      totalOrphanRepoCubeIds += orphanRepos.length;
      totalOrphanRepoBytes += repoOrphanBytes;
      console.log(
        `  Restic repos: ${reposByCubeId.size} repo(s), ${orphanRepos.length} orphan(s) — ${fmtBytes(repoOrphanBytes)}:`
      );

      const deletableKeys: string[] = [];
      let deletableBytes = 0;
      for (const r of orphanRepos.sort((a, b) => b.totalBytes - a.totalBytes)) {
        const tooYoung = Date.now() - r.newestMtimeMs < minAgeMs;
        console.log(
          `    [repo]     cube=${r.cubeId}  ${fmtBytes(r.totalBytes).padStart(10)}  ${r.objects.length} obj(s)  newest=${fmtAge(r.newestMtimeMs)}${tooYoung ? "  (recent — kept as possible in-flight repo init)" : ""}`
        );
        if (!tooYoung) {
          for (const o of r.objects) {
            deletableKeys.push(o.key);
          }
          deletableBytes += r.totalBytes;
        }
      }

      if (deletableKeys.length > 0 && doDelete) {
        const { deleted, failed } = await s3DeleteObjects(deletableKeys, conn);
        totalDeleted += deleted;
        totalDeletedBytes += deletableBytes;
        console.log(
          `  Deleted ${deleted} repo object(s), ${fmtBytes(deletableBytes)} reclaimed${failed > 0 ? ` — ${failed} failed (re-run to retry)` : ""}.`
        );
      } else if (deletableKeys.length > 0) {
        console.log(
          `  -> ${deletableKeys.length} repo object(s) (${fmtBytes(deletableBytes)}) eligible for deletion — re-run with --delete.`
        );
      }
    }

    // ── Phase 3: customer-uploaded import archives ───────────────────
    // `imports/<spaceId>/<importId>.cube` — terminal import states
    // already wipe their object as part of the worker / reaper flow,
    // so anything still present with no active row is an orphan.
    let importObjects: { key: string; sizeBytes: number; mtimeMs: number }[];
    try {
      importObjects = await s3ListObjects(conn, IMPORT_PREFIXES);
    } catch (err) {
      console.log(`  Skipped imports — failed to list: ${String(err)}`);
      continue;
    }

    const importOrphans = importObjects.filter((o) => {
      const id = importIdFromKey(o.key);
      if (!id) {
        return true; // unrecognized layout — treat as orphan
      }
      return !liveImportIds.has(id);
    });

    if (importOrphans.length === 0) {
      console.log(
        `  Imports: ${importObjects.length} object(s) — all match active rows. OK`
      );
    } else {
      const orphanBytes = importOrphans.reduce((s, f) => s + f.sizeBytes, 0);
      totalOrphanImportObjects += importOrphans.length;
      totalOrphanImportBytes += orphanBytes;
      console.log(
        `  Imports: ${importObjects.length} object(s), ${importOrphans.length} orphan(s) — ${fmtBytes(orphanBytes)}:`
      );

      const deletableKeys: string[] = [];
      let deletableBytes = 0;
      for (const o of importOrphans) {
        const tooYoung = Date.now() - o.mtimeMs < minAgeMs;
        console.log(
          `    [import]   ${fmtBytes(o.sizeBytes).padStart(10)}  age=${fmtAge(o.mtimeMs)}${tooYoung ? "  (recent — kept as possible in-flight upload)" : ""}`
        );
        console.log(`      ${o.key}`);
        if (!tooYoung) {
          deletableKeys.push(o.key);
          deletableBytes += o.sizeBytes;
        }
      }

      if (deletableKeys.length > 0 && doDelete) {
        const { deleted, failed } = await s3DeleteObjects(deletableKeys, conn);
        totalDeleted += deleted;
        totalDeletedBytes += deletableBytes;
        console.log(
          `  Deleted ${deleted} import orphan(s), ${fmtBytes(deletableBytes)} reclaimed${failed > 0 ? ` — ${failed} failed (re-run to retry)` : ""}.`
        );
      } else if (deletableKeys.length > 0) {
        console.log(
          `  -> ${deletableKeys.length} import orphan(s) (${fmtBytes(deletableBytes)}) eligible for deletion — re-run with --delete.`
        );
      }
    }

    // ── Phase 4: snapshot exports ─────────────────────────────────────
    // `exports/<spaceId>/<exportId>.cube` — the `snapshot.export-reap`
    // hourly cron deletes objects whose row is `expired`/`failed` past
    // the 7-day terminal-retention window. Anything remaining without a
    // live row is an orphan (worker died between upload + DB flip, or a
    // failed row already had its S3 object reaped but the row hasn't
    // hard-deleted yet).
    let exportObjects: { key: string; sizeBytes: number; mtimeMs: number }[];
    try {
      exportObjects = await s3ListObjects(conn, EXPORT_PREFIXES);
    } catch (err) {
      console.log(`  Skipped exports — failed to list: ${String(err)}`);
      continue;
    }

    const exportOrphans = exportObjects.filter((o) => {
      const id = exportIdFromKey(o.key);
      if (!id) {
        return true;
      }
      return !liveExportIds.has(id);
    });

    if (exportOrphans.length === 0) {
      console.log(
        `  Exports: ${exportObjects.length} object(s) — all match active rows. OK`
      );
    } else {
      const orphanBytes = exportOrphans.reduce((s, f) => s + f.sizeBytes, 0);
      totalOrphanExportObjects += exportOrphans.length;
      totalOrphanExportBytes += orphanBytes;
      console.log(
        `  Exports: ${exportObjects.length} object(s), ${exportOrphans.length} orphan(s) — ${fmtBytes(orphanBytes)}:`
      );

      const deletableKeys: string[] = [];
      let deletableBytes = 0;
      for (const o of exportOrphans) {
        const tooYoung = Date.now() - o.mtimeMs < minAgeMs;
        console.log(
          `    [export]   ${fmtBytes(o.sizeBytes).padStart(10)}  age=${fmtAge(o.mtimeMs)}${tooYoung ? "  (recent — kept as possible in-flight materialize)" : ""}`
        );
        console.log(`      ${o.key}`);
        if (!tooYoung) {
          deletableKeys.push(o.key);
          deletableBytes += o.sizeBytes;
        }
      }

      if (deletableKeys.length > 0 && doDelete) {
        const { deleted, failed } = await s3DeleteObjects(deletableKeys, conn);
        totalDeleted += deleted;
        totalDeletedBytes += deletableBytes;
        console.log(
          `  Deleted ${deleted} export orphan(s), ${fmtBytes(deletableBytes)} reclaimed${failed > 0 ? ` — ${failed} failed (re-run to retry)` : ""}.`
        );
      } else if (deletableKeys.length > 0) {
        console.log(
          `  -> ${deletableKeys.length} export orphan(s) (${fmtBytes(deletableBytes)}) eligible for deletion — re-run with --delete.`
        );
      }
    }
  }

  // ── Dangling backup-DB rows whose object is gone ────────────────
  // For backups only — we can't tell from object listing whether a
  // restic snapshot id in `cube_snapshots.storagePath` is missing
  // (would need to run `restic snapshots` per cube). The
  // `restic.check` weekly cron is the canonical health check for
  // snapshot-side dangling references.
  const dangling = backupRows.filter(
    (r) =>
      r.storagePath &&
      !seenBackupKeys.has(r.storagePath) &&
      (r.storageBackendId === null || scannedBackendIds.has(r.storageBackendId))
  );
  if (dangling.length > 0) {
    console.log(
      `\n=== Dangling DB rows — ${dangling.length} backup row(s) whose object is missing ===`
    );
    for (const r of dangling) {
      console.log(`  ${r.id}  status=${r.status}  ${r.storagePath}`);
    }
    console.log("  Not auto-fixed — review these rows manually.");
  }

  // Snapshot rows whose cube has no restic repo at all (e.g. cube
  // was deleted but the snapshot row somehow survived the cascade).
  // We can detect this without restic: any non-deleted snapshot row
  // whose cubeId no longer maps to a non-deleted cube row.
  const orphanedSnapshotRows = snapshotRows.filter(
    (r) => r.storagePath && !liveCubeIds.has(r.cubeId)
  );
  if (orphanedSnapshotRows.length > 0) {
    console.log(
      `\n=== Orphaned snapshot DB rows — ${orphanedSnapshotRows.length} (cube deleted) ===`
    );
    for (const r of orphanedSnapshotRows) {
      console.log(
        `  ${r.id}  status=${r.status}  cube=${r.cubeId}  restic=${r.storagePath?.slice(0, 12)}`
      );
    }
    console.log("  Not auto-fixed — review these rows manually.");
  }

  console.log("\n=== Summary ===");
  console.log(
    `  Backup orphan objects: ${totalOrphanBackupObjects} (${fmtBytes(totalOrphanBackupBytes)})`
  );
  console.log(
    `  Orphan restic repos:   ${totalOrphanRepoCubeIds} (${fmtBytes(totalOrphanRepoBytes)})`
  );
  console.log(
    `  Orphan import objects: ${totalOrphanImportObjects} (${fmtBytes(totalOrphanImportBytes)})`
  );
  console.log(
    `  Orphan export objects: ${totalOrphanExportObjects} (${fmtBytes(totalOrphanExportBytes)})`
  );
  if (doDelete) {
    console.log(
      `  Deleted: ${totalDeleted} object(s) (${fmtBytes(totalDeletedBytes)} reclaimed)`
    );
  } else if (
    totalOrphanBackupObjects +
      totalOrphanRepoCubeIds +
      totalOrphanImportObjects +
      totalOrphanExportObjects >
    0
  ) {
    console.log("  Dry run — re-run with --delete to remove eligible orphans.");
  }
  console.log(`  Dangling backup rows:  ${dangling.length}`);
  console.log(`  Orphan snapshot rows:  ${orphanedSnapshotRows.length}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("storage-audit failed:", err);
  process.exit(1);
});
