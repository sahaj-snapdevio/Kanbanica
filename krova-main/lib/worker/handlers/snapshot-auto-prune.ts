/**
 * Daily cron: per-cube `restic forget` with the plan's retention buckets.
 *
 * Restic computes which snapshots to drop based on walltime windows
 * (`--keep-last N` keeps the N most recent, `--keep-daily N` keeps one
 * per day for the last N days, etc.). Each plan declares its bucket
 * sizes; this handler turns those into a `restic forget` invocation per
 * cube.
 *
 * Pinned snapshots (`kind='manual'` in the DB) MUST survive the forget.
 * restic has NO `--keep-id` flag, and every snapshot is tagged with its
 * own unique `cube_snapshots.id` (not a shared `auto` tag), so we scope
 * the retention policy to EXACTLY the auto snapshots by passing each
 * auto snapshot's id as a `--tag` (restic ORs repeated `--tag` and never
 * touches snapshots whose tag is absent from the list). Manual/pinned
 * snapshots are simply not in the candidate set → never forgotten. See
 * `lib/snapshots/forget-args.ts` for the full rationale.
 *
 * After the forget, we reconcile DB rows against restic's authoritative
 * snapshot list: any `kind='auto' status='complete'` row whose
 * `storagePath` no longer exists in restic is deleted from the DB
 * (otherwise the customer would see "ghost" snapshots in the UI that
 * fail on restore).
 */

import { and, eq, inArray } from "drizzle-orm";
import type { Job } from "pg-boss";
import { cubeSnapshots, cubes, plans, spaces } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { buildResticForgetArgs } from "@/lib/snapshots/forget-args";
import { connectToServer } from "@/lib/ssh";
import {
  loadResticRepoConfig,
  resticForgetWithRetention,
  resticListSnapshots,
} from "@/lib/storage/restic";

export async function handleSnapshotAutoPrune(_jobs: Job[]): Promise<void> {
  void _jobs;

  const rows = await db
    .select({
      cubeId: cubes.id,
      spaceId: cubes.spaceId,
      serverId: cubes.serverId,
      keepLast: plans.autoSnapshotKeepLast,
      keepDaily: plans.autoSnapshotKeepDaily,
      keepWeekly: plans.autoSnapshotKeepWeekly,
    })
    .from(cubes)
    .innerJoin(spaces, eq(cubes.spaceId, spaces.id))
    .innerJoin(plans, eq(spaces.planId, plans.id))
    .where(inArray(cubes.status, ["running", "sleeping"]));

  let cubesProcessed = 0;
  let cubesPruned = 0;

  for (const row of rows) {
    cubesProcessed++;
    try {
      // Find the backend the cube's restic repo lives on by looking up
      // any non-failed snapshot row's storageBackendId. If the cube has
      // no auto snapshots yet (or none with a backend), skip — nothing
      // to prune.
      const sample = await db.query.cubeSnapshots.findFirst({
        where: and(
          eq(cubeSnapshots.cubeId, row.cubeId),
          eq(cubeSnapshots.kind, "auto"),
          eq(cubeSnapshots.status, "complete")
        ),
        columns: { storageBackendId: true },
      });
      if (!sample?.storageBackendId) {
        continue;
      }

      // Collect every AUTO snapshot's restic tag (= its cube_snapshots.id,
      // attached at backup time). The retention policy is scoped to EXACTLY
      // these via repeated `--tag`, so manual/pinned snapshots (whose ids are
      // deliberately absent from the list) are never forget candidates. restic
      // has no `--keep-id` flag — see lib/snapshots/forget-args.ts.
      const autoRows = await db
        .select({ id: cubeSnapshots.id })
        .from(cubeSnapshots)
        .where(
          and(
            eq(cubeSnapshots.cubeId, row.cubeId),
            eq(cubeSnapshots.kind, "auto"),
            eq(cubeSnapshots.status, "complete")
          )
        );
      const autoTagIds = autoRows.map((r) => r.id);

      const args = buildResticForgetArgs(
        {
          autoSnapshotKeepLast: row.keepLast,
          autoSnapshotKeepDaily: row.keepDaily,
          autoSnapshotKeepWeekly: row.keepWeekly,
        },
        autoTagIds
      );
      if (!args) {
        // Zero retention configured, or no auto snapshots to prune — skip.
        // (A tag-less retention forget would endanger manual/pinned snapshots.)
        continue;
      }

      const { config: repoConfig } = await loadResticRepoConfig(
        row.cubeId,
        sample.storageBackendId
      );

      const { client } = await connectToServer(row.serverId);
      try {
        // Routes through the shared wrapper so a stale repo lock (dead host
        // mid-op) is auto-recovered instead of stranding this cube's prune
        // every cycle. Throws on a real failure → caught by the per-cube
        // catch below, which logs and moves to the next cube.
        await resticForgetWithRetention(client, repoConfig, args, 1_200_000);

        // Reconcile DB: any auto snapshot whose restic id is no longer in the
        // repo gets removed from cube_snapshots. A list/parse glitch must NOT
        // fail the cube — the forget already succeeded; the next cycle
        // re-syncs.
        try {
          const liveSnapshots = await resticListSnapshots(client, repoConfig);
          const liveIds = new Set(liveSnapshots.map((s) => s.id));
          const dbAuto = await db
            .select({
              id: cubeSnapshots.id,
              storagePath: cubeSnapshots.storagePath,
            })
            .from(cubeSnapshots)
            .where(
              and(
                eq(cubeSnapshots.cubeId, row.cubeId),
                eq(cubeSnapshots.kind, "auto"),
                eq(cubeSnapshots.status, "complete")
              )
            );
          const toDelete = dbAuto
            .filter((r) => r.storagePath && !liveIds.has(r.storagePath))
            .map((r) => r.id);
          if (toDelete.length > 0) {
            await db
              .delete(cubeSnapshots)
              .where(inArray(cubeSnapshots.id, toDelete));
            cubesPruned++;
            console.log(
              `[snapshot-auto-prune] cube ${row.cubeId}: dropped ${toDelete.length} DB rows`
            );
          }

          // Pinned-snapshot safety net (audit M3): a customer can pin an auto
          // snapshot (kind auto→manual) in the tiny window after this run read
          // the keep-id set but before the forget, so the just-pinned snapshot
          // isn't protected and gets forgotten. That would leave a `manual` DB
          // row pointing at a vanished restic id — a silent unrestorable
          // "ghost". We do NOT delete it (the customer pinned it deliberately);
          // instead surface it LOUDLY so an operator can investigate / re-pin
          // another. Never let a manual snapshot silently become unrestorable.
          const dbManual = await db
            .select({
              id: cubeSnapshots.id,
              name: cubeSnapshots.name,
              storagePath: cubeSnapshots.storagePath,
            })
            .from(cubeSnapshots)
            .where(
              and(
                eq(cubeSnapshots.cubeId, row.cubeId),
                eq(cubeSnapshots.kind, "manual"),
                eq(cubeSnapshots.status, "complete")
              )
            );
          const manualGhosts = dbManual.filter(
            (r) => r.storagePath && !liveIds.has(r.storagePath)
          );
          for (const ghost of manualGhosts) {
            console.error(
              `[snapshot-auto-prune] ALERT: pinned/manual snapshot ${ghost.id} (cube ${row.cubeId}) has a restic id no longer in the repo — likely a pin-vs-prune race; row left for manual recovery`
            );
            audit({
              action: "snapshot.pinned_ghost_detected",
              category: "cube",
              actorType: "system",
              entityType: "cube",
              entityId: row.cubeId,
              spaceId: row.spaceId,
              description: `Pinned snapshot "${ghost.name}" no longer exists in restic (pin-vs-prune race) — unrestorable; needs operator attention`,
              metadata: {
                snapshotId: ghost.id,
                storagePath: ghost.storagePath,
              },
              source: "worker",
            });
          }
        } catch (parseErr) {
          console.warn(
            `[snapshot-auto-prune] failed to reconcile restic snapshots for cube ${row.cubeId}:`,
            parseErr instanceof Error ? parseErr.message : parseErr
          );
        }
      } finally {
        client.end();
      }
    } catch (err) {
      console.error(
        `[snapshot-auto-prune] cube ${row.cubeId} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  audit({
    action: "snapshot.auto_prune_cycle",
    category: "platform",
    actorType: "system",
    entityType: "cube",
    description: `Auto-prune cycle — processed=${cubesProcessed} pruned=${cubesPruned}`,
    metadata: { cubesProcessed, cubesPruned },
    source: "worker",
  });
}
