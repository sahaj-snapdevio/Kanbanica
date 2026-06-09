/**
 * Weekly `restic check --read-data-subset=2%` sweep across every
 * cube's snapshot repo.
 *
 * `restic check` verifies the integrity of the repository structure
 * (config, indexes, snapshot trees) AND a sampled 2% of the actual
 * pack data. Over 50 weeks the full repo is verified. A failure
 * here indicates either:
 *
 *   - Corruption (S3 partial write, network drop during pack
 *     upload, accidental object deletion).
 *   - Repository inconsistency (deleted snapshot left orphan pack
 *     references — usually fixed by the next `restic prune`).
 *
 * Either way, the customer's snapshots for that cube are in danger
 * — we email platform admins with the cube id + restic stderr so
 * they can investigate before the next snapshot fails or the next
 * restore returns garbage.
 *
 * Schedule: weekly on Sunday at 06:00 UTC (offset from the prune
 * sweep at 04:00 so check sees the post-prune state).
 *
 * Failure handling: a check failure on one cube doesn't stop the
 * sweep. Each failure produces one admin email; multiple cubes
 * failing on the same week produce multiple emails (each tied to
 * a specific cube — useful for triage).
 */

import { and, eq, isNotNull, ne } from "drizzle-orm";
import { cubeSnapshots, cubes } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";
import { getErrorNotifyEmails } from "@/lib/service-config";
import { connectToServer } from "@/lib/ssh";
import { loadResticRepoConfig, resticCheck } from "@/lib/storage/restic";

export async function handleResticCheck(): Promise<void> {
  console.log("[restic.check] starting weekly integrity sweep");

  const rows = await db
    .select({
      id: cubes.id,
      name: cubes.name,
      spaceId: cubes.spaceId,
      serverId: cubes.serverId,
    })
    .from(cubes)
    .where(
      and(ne(cubes.status, "deleted"), isNotNull(cubes.snapshotRepoPasswordEnc))
    );

  if (rows.length === 0) {
    console.log(
      "[restic.check] no cubes with snapshot repos — nothing to check"
    );
    return;
  }

  let ok = 0;
  let issues = 0;
  const issueDetails: Array<{
    cubeId: string;
    cubeName: string;
    spaceId: string;
    reason: string;
  }> = [];

  for (const cube of rows) {
    try {
      // Pin the check to the cube's existing repo backend
      // (loadResticRepoConfig walks `cube_snapshots` to find it). If
      // the cube has a password but no snapshots, restic check has
      // nothing meaningful to verify — skip.
      const latestSnapshot = await db.query.cubeSnapshots.findFirst({
        where: eq(cubeSnapshots.cubeId, cube.id),
        columns: { id: true },
      });
      if (!latestSnapshot) {
        console.log(
          `[restic.check] cube ${cube.id} (${cube.name}) — no snapshots, skipping`
        );
        continue;
      }
      const { config: repoConfig } = await loadResticRepoConfig(cube.id);
      const { client } = await connectToServer(cube.serverId);
      try {
        const result = await resticCheck(client, repoConfig);
        if (result.ok) {
          ok++;
          console.log(
            `[restic.check] cube ${cube.id} (${cube.name}) — repo healthy`
          );
        } else {
          issues++;
          issueDetails.push({
            cubeId: cube.id,
            cubeName: cube.name,
            spaceId: cube.spaceId,
            reason: result.reason,
          });
          console.error(
            `[restic.check] cube ${cube.id} (${cube.name}) — INTEGRITY ISSUE: ${result.reason}`
          );
        }
      } finally {
        client.end();
      }
    } catch (err) {
      issues++;
      const reason = err instanceof Error ? err.message : String(err);
      issueDetails.push({
        cubeId: cube.id,
        cubeName: cube.name,
        spaceId: cube.spaceId,
        reason,
      });
      console.error(
        `[restic.check] cube ${cube.id} (${cube.name}) — check threw:`,
        reason
      );
    }
  }

  // Notify platform admins per-cube when integrity issues are found.
  // One email per affected cube so each goes to its own thread / can
  // be acted on independently. The email is one-shot — operators see
  // a fresh notification each week until the underlying issue is
  // resolved AND the next `restic.check` returns ok for that cube.
  if (issues > 0) {
    try {
      const recipients = await getErrorNotifyEmails();
      for (const detail of issueDetails) {
        const subject = `[Krova] Restic repo integrity issue — cube ${detail.cubeName}`;
        const reasonTrimmed = detail.reason.slice(0, 1500);
        const html =
          "<p>Weekly <code>restic check --read-data-subset=2%</code> " +
          `found an issue with cube <strong>${detail.cubeName}</strong> ` +
          `(id <code>${detail.cubeId}</code>, space ` +
          `<code>${detail.spaceId}</code>).</p>` +
          "<p>Reason:</p>" +
          `<pre>${reasonTrimmed.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>` +
          "<p>Investigate before the next snapshot or restore. Try " +
          "<code>restic check --read-data</code> against the repo for a " +
          "full data verification; if corruption is confirmed, the " +
          "affected snapshots are unrecoverable and should be deleted " +
          "+ recreated.</p>";
        const text =
          `Weekly restic check found an issue with cube ${detail.cubeName} ` +
          `(id ${detail.cubeId}, space ${detail.spaceId}).\n\n` +
          `Reason:\n${reasonTrimmed}\n\n` +
          "Investigate before the next snapshot or restore.";
        for (const to of recipients) {
          await enqueueEmail({ to, subject, html, text });
        }
      }
    } catch (emailErr) {
      console.error(
        "[restic.check] failed to enqueue admin notification email:",
        emailErr
      );
    }
  }

  audit({
    action: "restic.check_sweep",
    category: "platform",
    actorType: "system",
    entityType: "storage",
    description: `Restic check sweep: ${ok} ok, ${issues} issues across ${rows.length} cube(s)`,
    metadata: {
      total: rows.length,
      ok,
      issues,
      issueIds: issueDetails.map((d) => d.cubeId),
    },
    source: "worker",
  });

  console.log(
    issues === 0
      ? `[restic.check] completed — all ${ok} cube(s) healthy`
      : `[restic.check] completed — ${ok} healthy, ${issues} with issues`
  );
}
