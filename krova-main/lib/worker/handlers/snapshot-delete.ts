import { eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import { cubeSnapshots, cubes, lifecycleLogs } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { connectToServer } from "@/lib/ssh";
import { adjustBackendUsage } from "@/lib/storage/backends";
import {
  loadResticRepoConfig,
  resticForgetSnapshot,
} from "@/lib/storage/restic";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildSnapshotPayload } from "@/lib/webhook-payloads";
import { JobLogger } from "@/lib/worker/job-log";
import type { SnapshotDeletePayload } from "@/lib/worker/job-types";

async function handleSnapshotDeleteJob(
  job: Job<SnapshotDeletePayload>
): Promise<void> {
  const { snapshotId, cubeId, spaceId } = job.data;
  const log = new JobLogger(job.id, "snapshot.delete", "cube", cubeId);
  console.log(`[snapshot-delete] starting for snapshotId=${snapshotId}`);
  await log.info(`Snapshot delete started (snapshotId=${snapshotId})`);

  // 1. Load snapshot. If the row is already gone (e.g. cube-delete
  //    cascade fired first), nothing to do.
  const snapshot = await db.query.cubeSnapshots.findFirst({
    where: eq(cubeSnapshots.id, snapshotId),
  });
  if (!snapshot) {
    console.log(`[snapshot-delete] snapshot ${snapshotId} not found, skipping`);
    return;
  }

  // 1b. Refuse to delete while the snapshot is actively being created or
  //     restored. `restic forget` on a live restore-source would yank
  //     chunks the restore stream is reading and cause mid-stream
  //     failure; on a snapshot still being created it would race the
  //     `restic backup` writer. Throw so pg-boss retries — by the next
  //     attempt the in-flight job will have flipped `status` back to
  //     `complete` or `failed`. See audit H7 (2026-05-24).
  if (snapshot.status === "restoring" || snapshot.status === "creating") {
    const reason =
      `Snapshot ${snapshotId} is in status='${snapshot.status}' — refusing to delete ` +
      "while restore/create is in flight; pg-boss will retry";
    console.warn(`[snapshot-delete] ${reason}`);
    await log.warn(reason);
    throw new Error(reason);
  }

  // 2. Load cube — restic must run on a host that has the restic
  //    binary, and the cube's host already has it (installed at
  //    server.install). We use the cube's host for locality (it
  //    likely has a warmed restic chunk cache from prior snapshots
  //    of this cube) and so we don't need fleet-wide host selection.
  const cube = await db.query.cubes.findFirst({
    where: eq(cubes.id, cubeId),
    columns: { serverId: true },
  });
  if (!cube) {
    // Cube row gone — cube.delete cascade has already wiped the
    // snapshot row in a normal teardown. We saw the row at step 1,
    // so something raced; safest to delete the snapshot row and
    // leave the restic chunks to the cube-delete cleanup that wipes
    // the whole repo prefix.
    await db.delete(cubeSnapshots).where(eq(cubeSnapshots.id, snapshotId));
    console.warn(
      `[snapshot-delete] snapshot ${snapshotId} has no parent cube — DB row deleted, restic chunks left for repo-prefix sweep`
    );
    return;
  }

  // 3. resolve restic repo config (per-cube password + backend creds).
  //    Pass the snapshot's pinned `storageBackendId` so we always
  //    target the backend that actually holds this snapshot's repo.
  //    If the snapshot row has no backend reference (legacy /
  //    partially-written state), skip the restic forget and proceed
  //    to DB cleanup — the cube-delete prefix sweep will catch any
  //    orphan chunks if the cube is later deleted.
  if (!snapshot.storageBackendId) {
    console.warn(
      `[snapshot-delete] snapshot ${snapshotId} has no storageBackendId — skipping restic forget, proceeding to DB cleanup`
    );
    await db.delete(cubeSnapshots).where(eq(cubeSnapshots.id, snapshotId));
    return;
  }
  const { config: repoConfig } = await loadResticRepoConfig(
    cubeId,
    snapshot.storageBackendId
  );

  // 4. Connect + run `restic forget --prune`. The handler is
  //    idempotent: a re-run of a partially-completed delete (chunks
  //    forgotten but DB row still present) sees `no matching
  //    snapshots found` from restic and is treated as success by
  //    resticForgetSnapshot.
  const { client } = await connectToServer(cube.serverId);
  try {
    const resticSnapshotId = snapshot.storagePath;
    if (resticSnapshotId) {
      await log.step(
        `Restic forget snapshot ${resticSnapshotId.slice(0, 8)}`,
        async () => {
          await resticForgetSnapshot(client, repoConfig, resticSnapshotId);
        }
      );
    } else {
      // Defensive: a snapshot row with no restic snapshot id can't be
      // forgotten via restic — there's nothing to forget. Skip the
      // restic call and proceed to DB cleanup so the orphan row is
      // removed. The repo-prefix sweep at cube.delete is the
      // backstop for any restic chunks.
      console.warn(
        `[snapshot-delete] snapshot ${snapshotId} has no restic snapshot id — skipping restic forget, proceeding to DB cleanup`
      );
    }
  } finally {
    client.end();
  }

  // 5. Delete DB record (only reached on success)
  await db.delete(cubeSnapshots).where(eq(cubeSnapshots.id, snapshotId));

  // Approximate between-tick adjust — `sizeBytes` is the dedup'd
  // `data_added_packed` from the restic backup summary, NOT what pruning this
  // snapshot actually frees (dedup means chunks shared with other snapshots
  // survive). The authoritative usedBytes is recomputed periodically by
  // `storage.health-check` from real S3 sizes; this just keeps backend
  // selection roughly accurate until the next reconcile.
  if (snapshot.storageBackendId && snapshot.sizeBytes) {
    await adjustBackendUsage(snapshot.storageBackendId, -snapshot.sizeBytes);
  }

  // 6. Write lifecycle log
  await db.insert(lifecycleLogs).values({
    entityType: "cube",
    entityId: cubeId,
    message: `Snapshot "${snapshot.name}" deleted`,
  });

  audit({
    action: "snapshot.delete",
    category: "cube",
    actorType: "system",
    entityType: "cube",
    entityId: cubeId,
    spaceId,
    description: `Snapshot "${snapshot.name}" deleted`,
    metadata: { snapshotId, resticSnapshotId: snapshot.storagePath },
    source: "worker",
  });

  dispatchWebhookEvent(spaceId, "snapshot.deleted", {
    snapshot: buildSnapshotPayload({
      cubeId,
      id: snapshotId,
      kind: snapshot.kind,
      name: snapshot.name,
      sizeBytes: snapshot.sizeBytes,
    }),
  });

  console.log(`[snapshot-delete] completed snapshotId=${snapshotId}`);
  await log.info(`Snapshot "${snapshot.name}" deleted`);
}

export async function handleSnapshotDelete(
  jobs: Job<SnapshotDeletePayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleSnapshotDeleteJob(job);
  }
}
