import { and, eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import { cubeSnapshots, cubes, lifecycleLogs } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";
import { getSpaceOwner } from "@/lib/email/helpers";
import { env } from "@/lib/env";
import { triggerCubeLifecycleEvent } from "@/lib/pusher";
import { snapshotCreateFailureAction } from "@/lib/snapshots/failure-policy";
import { connectToServer, guestExec } from "@/lib/ssh";
import { adjustBackendUsage } from "@/lib/storage/backends";
import {
  ensureResticRepo,
  loadResticRepoConfig,
  resticBackup,
} from "@/lib/storage/restic";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildSnapshotPayload } from "@/lib/webhook-payloads";
import { JobLogger } from "@/lib/worker/job-log";
import type { SnapshotCreatePayload } from "@/lib/worker/job-types";

/**
 * Apply the create-failure policy to a row that never produced a usable
 * snapshot: auto → delete; manual → a dismissible `failed` note (storagePath
 * nulled — it holds no data). Lifecycle log + audit are written by the caller.
 */
async function failCreate(
  snapshotId: string,
  kind: "auto" | "manual"
): Promise<void> {
  if (snapshotCreateFailureAction(kind) === "delete") {
    await db
      .delete(cubeSnapshots)
      .where(eq(cubeSnapshots.id, snapshotId))
      .catch(() => {});
    return;
  }
  await db
    .update(cubeSnapshots)
    .set({ status: "failed", storagePath: null })
    .where(eq(cubeSnapshots.id, snapshotId));
}

async function handleSnapshotCreateJob(
  job: Job<SnapshotCreatePayload>
): Promise<void> {
  const { snapshotId, cubeId, spaceId, serverId } = job.data;
  const log = new JobLogger(job.id, "snapshot.create", "cube", cubeId);
  console.log(
    `[snapshot-create] starting for snapshotId=${snapshotId} cubeId=${cubeId}`
  );
  await log.info(`Snapshot creation started (snapshotId=${snapshotId})`);

  // 1. Load snapshot — only proceed if status is still "pending"
  const snapshot = await db.query.cubeSnapshots.findFirst({
    where: eq(cubeSnapshots.id, snapshotId),
  });
  if (snapshot?.status !== "pending") {
    console.log(
      `[snapshot-create] snapshot ${snapshotId} not pending, skipping`
    );
    return;
  }

  // 2. Load cube — must be running or sleeping (rootfs exists on disk in both states)
  const cube = await db.query.cubes.findFirst({
    where: eq(cubes.id, cubeId),
  });
  if (!cube || (cube.status !== "running" && cube.status !== "sleeping")) {
    await failCreate(snapshotId, snapshot.kind);
    console.log(
      `[snapshot-create] cube ${cubeId} not running/sleeping (status=${cube?.status}), marking snapshot failed`
    );
    return;
  }

  // 2b. Defense-in-depth (audit H2): never snapshot a cube mid cross-server
  //     transfer. A transferring cube keeps status='running'/'sleeping' while
  //     `cube.transfer` is mid cp/rsync of rootfs.ext4, so a restic backup
  //     would capture a torn, half-written ext4 and mark it `complete` —
  //     silently unrestorable. The scheduler already filters these out; this
  //     guards the customer-action + pg-boss retry paths. Fail the row; the
  //     customer can re-snapshot once the transfer settles.
  if (cube.transferState !== "idle") {
    await failCreate(snapshotId, snapshot.kind);
    await log.error(
      `Snapshot "${snapshot.name}" refused: cube is mid-transfer (transferState=${cube.transferState}). Try again once the transfer completes.`
    );
    console.log(
      `[snapshot-create] cube ${cubeId} mid-transfer (transferState=${cube.transferState}), marking snapshot failed`
    );
    return;
  }

  // 3. Resolve the storage backend + per-cube restic repo config BEFORE the
  //    atomic claim (Rule 58 preflight). A missing/unconfigured backend
  //    (loadResticRepoConfig throws "No active storage backend configured" via
  //    selectBackend) must mark the row `failed` while it is still `pending` —
  //    NOT escape uncaught AFTER the claim and strand it in `creating` until
  //    snapshot.stale-check reaps it ~2h later. loadResticRepoConfig is a
  //    read-only resolve (no side effect), so running it before the claim is
  //    safe and introduces no new race (the claim below is still atomic).
  //
  //    For an EXISTING repo (cube already has snapshots), loadResticRepoConfig
  //    pins the backend to whichever one the cube's first snapshot landed on —
  //    preventing a freshly-added higher-capacity backend from silently
  //    splitting this cube's snapshot history across two repos. For a NEW repo
  //    it falls back to selectBackend(). The returned `backend` is the resolved
  //    StorageBackendConnection — used below to record `storageBackendId` on
  //    the new snapshot row and to `adjustBackendUsage` after the upload.
  let repoConfig: Awaited<ReturnType<typeof loadResticRepoConfig>>["config"];
  let backend: Awaited<ReturnType<typeof loadResticRepoConfig>>["backend"];
  try {
    const resolved = await loadResticRepoConfig(cubeId);
    repoConfig = resolved.config;
    backend = resolved.backend;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await failCreate(snapshotId, snapshot.kind);
    console.error(
      `[snapshot-create] backend resolution failed snapshotId=${snapshotId}: ${reason}`
    );
    await log.error(`Snapshot "${snapshot.name}" failed: ${reason}`);
    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `Snapshot "${snapshot.name}" failed: ${reason}`,
    });
    return;
  }

  // 4. Atomically update snapshot → creating (only if still pending, prevents concurrent races)
  const [claimed] = await db
    .update(cubeSnapshots)
    .set({ status: "creating" })
    .where(
      and(eq(cubeSnapshots.id, snapshotId), eq(cubeSnapshots.status, "pending"))
    )
    .returning({ id: cubeSnapshots.id });

  if (!claimed) {
    console.log(
      `[snapshot-create] snapshot ${snapshotId} no longer pending, skipping`
    );
    return;
  }

  // 5. Load server and SSH key. The connect is GUARDED so a host that's down
  //    (EHOSTUNREACH) doesn't strand this row in `creating` forever: the row
  //    was already claimed above, and an uncaught connect failure here would
  //    let the pg-boss retry short-circuit on status!='pending', leaving a
  //    permanent zombie row that no cron reaps (2026-05-28 mango outage).
  let client: Awaited<ReturnType<typeof connectToServer>>["client"];
  try {
    client = (await connectToServer(serverId)).client;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[snapshot-create] connect failed snapshotId=${snapshotId}: ${reason}`
    );
    await log.error(`Snapshot "${snapshot.name}" failed: ${reason}`);
    // Nothing reached restic (storagePath still null). Route through the
    // create-failure policy: auto → delete the orphan row (clean UI, scheduler
    // retries); manual → leave a dismissible `failed` note so the customer's
    // intent doesn't silently vanish.
    await failCreate(snapshotId, snapshot.kind);
    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `Snapshot "${snapshot.name}" failed: ${reason}`,
    });
    return;
  }

  try {
    // Flush filesystem buffers inside the VM for a cleaner snapshot, but only if the cube
    // is running. On a sleeping cube the guest agent is paused and the call would burn its
    // full 10s timeout before failing.
    if (cube.status === "running") {
      await guestExec(client, cubeId, "sync", 10_000).catch(() => {
        console.warn(
          "[snapshot-create] sync failed (guest agent may be unresponsive), proceeding anyway"
        );
      });
    }

    // 6. Initialize the cube's restic repository on first use.
    //    Idempotent — ensureResticRepo probes for existing repo
    //    (exit 10 = doesn't exist) and only runs `restic init` if
    //    the repo isn't there yet.
    await log.step("Initialize restic repository", async () => {
      await ensureResticRepo(client, repoConfig);
    });

    // 7. Back up the rootfs into the repo. Restic chunks the file
    //    (content-addressed dedup): the FIRST backup uploads the
    //    full ~compressed-size of the rootfs, every subsequent
    //    backup uploads only the chunks that changed. Reported
    //    sizes (`dataAddedPacked` / `totalBytesProcessed`) come from the
    //    `--json` summary message — see commands.ts.
    //
    //    We backup with workingDir + relative path so the snapshot
    //    stores `rootfs.ext4` (relative). Restore later uses
    //    `--target=<workingDir>` and the file lands at the original
    //    path. Avoids the absolute-path nesting trap on restore.
    const cubeDir = `/var/lib/krova/cubes/${cubeId}`;
    const result = await log.step(
      "Restic backup",
      async () =>
        await resticBackup(
          client,
          repoConfig,
          cubeDir,
          "rootfs.ext4",
          snapshotId
        )
    );
    const fileSizeBytes = result.dataAddedPacked;
    const resticSnapshotId = result.snapshotId;
    console.log(
      `[snapshot-create] restic snapshot ${resticSnapshotId} — data added: ${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB (rootfs ${(result.totalBytesProcessed / 1024 / 1024).toFixed(0)} MB, dedup'd)`
    );
    await log.info(
      `Snapshot stored: ${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB added to repo (${(result.totalBytesProcessed / 1024 / 1024).toFixed(0)} MB rootfs, dedup'd)`
    );

    // 8. Update snapshot → complete.
    //    `storagePath` now holds the restic snapshot id (the 64-hex
    //    string restic uses to identify the snapshot inside the repo).
    //    `storageBackendId` still references the S3 backend row, since
    //    the restic repo lives in that backend's bucket.
    await db
      .update(cubeSnapshots)
      .set({
        status: "complete",
        sizeBytes: fileSizeBytes,
        storagePath: resticSnapshotId,
        storageBackendId: backend.id,
        completedAt: new Date(),
      })
      .where(eq(cubeSnapshots.id, snapshotId));

    // Bookkeeping for the per-plan auto-snapshot scheduler: only on
    // `kind='auto'` snapshots. `lastAutoSnapshotAt` gates the cadence
    // check; `snapshottedSinceSleep` enforces "one snapshot per sleep
    // cycle" for sleeping cubes.
    if (snapshot.kind === "auto") {
      await db
        .update(cubes)
        .set({
          lastAutoSnapshotAt: new Date(),
          snapshottedSinceSleep: true,
        })
        .where(eq(cubes.id, cubeId));
    }

    // Approximate between-tick adjust (authoritative usedBytes is recomputed
    // periodically by `storage.health-check` from real S3 sizes).
    await adjustBackendUsage(backend.id, fileSizeBytes);

    // 9. Write lifecycle log
    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `Snapshot "${snapshot.name}" created (${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB added, dedup'd)`,
    });

    // 10. Fire Pusher event
    await triggerCubeLifecycleEvent(cubeId, spaceId, {
      snapshotId,
      snapshotStatus: "complete",
    });

    dispatchWebhookEvent(spaceId, "snapshot.created", {
      snapshot: buildSnapshotPayload({
        cubeId,
        id: snapshotId,
        kind: snapshot.kind,
        name: snapshot.name,
        sizeBytes: fileSizeBytes,
      }),
    });

    audit({
      action: "snapshot.create_complete",
      category: "cube",
      actorType: snapshot.createdBy ? "user" : "system",
      actorId: snapshot.createdBy,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Snapshot "${snapshot.name}" created`,
      metadata: {
        snapshotId,
        sizeBytes: fileSizeBytes,
        resticSnapshotId,
        totalBytesProcessed: result.totalBytesProcessed,
      },
      source: "worker",
    });

    console.log(`[snapshot-create] completed snapshotId=${snapshotId}`);
    await log.info(`Snapshot "${snapshot.name}" complete`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[snapshot-create] failed snapshotId=${snapshotId}:`, reason);
    await log.error(`Snapshot "${snapshot.name}" failed: ${reason}`);

    // Re-read the row's CURRENT status. `storagePath` + `status='complete'` are
    // written together (step 8), so if the row already reached `complete` the
    // failure was in a trivial post-success step (adjustBackendUsage / lifecycle
    // log / audit / email) — the snapshot is GOOD. Never downgrade it.
    const [currentRow] = await db
      .select({ status: cubeSnapshots.status })
      .from(cubeSnapshots)
      .where(eq(cubeSnapshots.id, snapshotId))
      .limit(1);
    if (currentRow && currentRow.status !== "complete") {
      await failCreate(snapshotId, snapshot.kind);
    } else {
      console.log(
        `[snapshot-create] snapshot ${snapshotId} already complete — post-success step failed, leaving it complete`
      );
    }

    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `Snapshot "${snapshot.name}" failed: ${reason}`,
    });

    await triggerCubeLifecycleEvent(cubeId, spaceId, {
      snapshotId,
      snapshotStatus: "failed",
    });

    audit({
      action: "snapshot.create_failed",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Snapshot "${snapshot.name}" failed: ${reason}`,
      metadata: { snapshotId, error: reason },
      source: "worker",
    });

    // Notify space owner about the snapshot failure using the existing cube-error template
    try {
      const owner = await getSpaceOwner(spaceId);
      if (owner) {
        const cubeUrl = `${env.NEXT_PUBLIC_APP_URL}/${spaceId}/cubes/${cubeId}`;
        const { cubeErrorEmailTemplate } = await import(
          "@/lib/email/templates/cube-error"
        );
        const { html, text } = await cubeErrorEmailTemplate({
          userName: owner.name,
          spaceName: owner.spaceName,
          cubeName: snapshot.name,
          cubeId,
          reason: `Snapshot creation failed: ${reason}`,
          cubeUrl,
        });
        await enqueueEmail({
          to: owner.email,
          subject: `Snapshot failed — ${snapshot.name}`,
          html,
          text,
        });
      }
    } catch (emailErr) {
      console.error(
        "[snapshot-create] failed to send failure notification email:",
        emailErr
      );
    }

    throw err;
  } finally {
    client.end();
  }
}

export async function handleSnapshotCreate(
  jobs: Job<SnapshotCreatePayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleSnapshotCreateJob(job);
  }
}
