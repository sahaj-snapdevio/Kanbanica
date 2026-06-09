/**
 * Weekly `restic prune` sweep across every cube's repo.
 *
 * `restic forget --prune` at snapshot-delete time only prunes that
 * one snapshot's chunks. After many forgets the repo accumulates
 * unreferenced chunks (e.g. when many snapshots all referenced the
 * same chunk and the LAST snapshot to reference it forgets last).
 * Running `restic prune` periodically reclaims that orphaned data.
 *
 * Per-cube model:
 *   - Iterate every non-deleted cube that already has a snapshot
 *     repo password (i.e. at least one snapshot was ever taken).
 *   - SSH to the cube's current host and run `restic prune`.
 *   - Prune acquires an exclusive repo lock; concurrent backups on
 *     the same cube block until it finishes (typical ~30s).
 *
 * Schedule: weekly on Sunday at 04:00 UTC (offset from billing.hourly
 * and the daily email-it/job-logs prunes to avoid contention).
 *
 * Failure handling: a prune failure on one cube doesn't stop the
 * sweep for others. Each cube's failure is logged + audit'd; the
 * next week's run retries.
 */

import { and, eq, isNotNull, ne } from "drizzle-orm";
import { cubeSnapshots, cubes } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";
import { getErrorNotifyEmails } from "@/lib/service-config";
import { connectToServer } from "@/lib/ssh";
import { loadResticRepoConfig, resticPrune } from "@/lib/storage/restic";

export async function handleResticPrune(): Promise<void> {
  console.log("[restic.prune] starting weekly sweep");

  // Pull every non-deleted cube that has a restic repo password
  // (i.e. at least one snapshot was ever taken). Cubes that have
  // never been snapshotted have no repo to prune.
  const rows = await db
    .select({
      id: cubes.id,
      name: cubes.name,
      serverId: cubes.serverId,
      spaceId: cubes.spaceId,
    })
    .from(cubes)
    .where(
      and(ne(cubes.status, "deleted"), isNotNull(cubes.snapshotRepoPasswordEnc))
    );

  if (rows.length === 0) {
    console.log("[restic.prune] no cubes with snapshot repos — nothing to do");
    return;
  }

  let ok = 0;
  let failures = 0;
  const failureDetails: Array<{
    cubeId: string;
    cubeName: string;
    spaceId: string;
    reason: string;
  }> = [];

  for (const cube of rows) {
    try {
      // Pin the prune to the cube's existing repo backend
      // (loadResticRepoConfig walks `cube_snapshots` to find it).
      // If the cube has no snapshots, the helper falls back to
      // selectBackend() — but there's nothing to prune on a
      // snapshot-less repo so skip the call.
      const latestSnapshot = await db.query.cubeSnapshots.findFirst({
        where: eq(cubeSnapshots.cubeId, cube.id),
        columns: { id: true },
      });
      if (!latestSnapshot) {
        console.log(
          `[restic.prune] cube ${cube.id} (${cube.name}) — no snapshots, skipping`
        );
        continue;
      }
      const { config: repoConfig } = await loadResticRepoConfig(cube.id);
      const { client } = await connectToServer(cube.serverId);
      try {
        await resticPrune(client, repoConfig);
        ok++;
        console.log(`[restic.prune] cube ${cube.id} (${cube.name}) — prune ok`);
      } finally {
        client.end();
      }
    } catch (err) {
      failures++;
      const reason = err instanceof Error ? err.message : String(err);
      failureDetails.push({
        cubeId: cube.id,
        cubeName: cube.name,
        spaceId: cube.spaceId,
        reason,
      });
      console.error(
        `[restic.prune] cube ${cube.id} (${cube.name}) — prune failed:`,
        reason
      );
    }
  }

  audit({
    action: "restic.prune_sweep",
    category: "platform",
    actorType: "system",
    entityType: "storage",
    description: `Restic prune sweep: ${ok} ok, ${failures} failures across ${rows.length} cube(s)`,
    metadata: { total: rows.length, ok, failures },
    source: "worker",
  });

  // Notify platform admins per-cube when prune failures occur, mirroring
  // the restic-check pattern. Silent prune failures accumulate orphaned
  // chunks until operators manually check logs (audit M16, 2026-05-24).
  if (failures > 0) {
    try {
      const recipients = await getErrorNotifyEmails();
      for (const detail of failureDetails) {
        const subject = `[Krova] Restic prune failed — cube ${detail.cubeName}`;
        const reasonTrimmed = detail.reason.slice(0, 1500);
        const html =
          "<p>Weekly <code>restic prune</code> failed for cube " +
          `<strong>${detail.cubeName}</strong> (id <code>${detail.cubeId}</code>, ` +
          `space <code>${detail.spaceId}</code>).</p>` +
          "<p>Reason:</p>" +
          `<pre>${reasonTrimmed.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>` +
          "<p>Orphaned restic chunks for this cube will accumulate until " +
          `the prune succeeds. Investigate via SSH to the cube's host and ` +
          "re-run prune manually; the next Sunday sweep will retry.</p>";
        const text =
          `Weekly restic prune failed for cube ${detail.cubeName} ` +
          `(id ${detail.cubeId}, space ${detail.spaceId}).\n\n` +
          `Reason:\n${reasonTrimmed}\n\n` +
          "Orphaned restic chunks will accumulate until the prune succeeds.";
        for (const to of recipients) {
          await enqueueEmail({ to, subject, html, text }).catch((err) => {
            console.error(
              `[restic.prune] failed to enqueue admin email to ${to}:`,
              err
            );
          });
        }
      }
    } catch (notifyErr) {
      console.error(
        "[restic.prune] failed to notify admins of prune failures:",
        notifyErr
      );
    }
  }

  // Avoid the word "failed" / "failures" on the success path — the
  // Dokploy log viewer keyword-matches and color-codes the row red.
  console.log(
    failures === 0
      ? `[restic.prune] completed — all ${ok} cube(s) pruned`
      : `[restic.prune] completed — ${ok} ok, ${failures} failures`
  );
}
