import { createId } from "@paralleldrive/cuid2";
import { and, desc, eq, ne } from "drizzle-orm";
import * as schema from "@/db/schema";
import { audit } from "@/lib/audit";
import type {
  CubeActionContext,
  CubeActionResult,
} from "@/lib/cube-actions/types";
import { db } from "@/lib/db";
import { validateName } from "@/lib/validators";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

/**
 * Shared v1 snapshot handlers. Intentionally scoped to the v1 routes
 * only — the customer-dashboard surface uses server actions in
 * `app/actions/snapshots.ts` whose pre-checks DIVERGE from these
 * routes (server action enforces a per-plan manual-snapshot cap via
 * `assertCanCreateManualSnapshot`, but does NOT check for an
 * in-progress snapshot; v1 routes have the in-progress guard but
 * have never enforced the plan cap). Reconciling those divergences is
 * a product decision outside this refactor — for now, each surface
 * keeps its existing pre-checks and they share only the cube reads,
 * status guards, status flips, enqueue, lifecycle log, and audit
 * inside the handlers below.
 */

export type ListSnapshotRow = {
  id: string;
  cubeId: string;
  spaceId: string;
  name: string;
  status: string;
  sizeBytes: number | null;
  kind: string;
  completedAt: Date | null;
  createdAt: Date;
};

/**
 * Shared business logic for `GET /cubes/[cubeId]/snapshots` (v1).
 * Returns the per-cube snapshot list with a narrow column set, scoped by
 * (cubeId, spaceId) for tenant isolation.
 */
export async function listSnapshotsAction(
  ctx: Pick<CubeActionContext, "spaceId" | "cubeId">
): Promise<ListSnapshotRow[]> {
  return await db
    .select({
      id: schema.cubeSnapshots.id,
      cubeId: schema.cubeSnapshots.cubeId,
      spaceId: schema.cubeSnapshots.spaceId,
      name: schema.cubeSnapshots.name,
      status: schema.cubeSnapshots.status,
      sizeBytes: schema.cubeSnapshots.sizeBytes,
      kind: schema.cubeSnapshots.kind,
      completedAt: schema.cubeSnapshots.completedAt,
      createdAt: schema.cubeSnapshots.createdAt,
    })
    .from(schema.cubeSnapshots)
    .where(
      and(
        eq(schema.cubeSnapshots.cubeId, ctx.cubeId),
        eq(schema.cubeSnapshots.spaceId, ctx.spaceId)
      )
    )
    .orderBy(desc(schema.cubeSnapshots.createdAt));
}

export type CreateSnapshotV1Row = {
  id: string;
  cubeId: string;
  spaceId: string;
  name: string;
  status: "pending";
  kind: "manual";
  sizeBytes: null;
  completedAt: null;
  createdAt: Date;
};

/**
 * Shared business logic for `POST /cubes/[cubeId]/snapshots` (v1 surface).
 * Routes are responsible for: the storage-backend gate, the
 * `withIdempotency` wrapper, and the user-supplied name (or absence
 * thereof — v1 auto-generates a timestamped default; the dashboard server
 * action REQUIRES a name).
 *
 * Pre-checks performed here: cube exists + scoped, status running|sleeping,
 * no in-progress snapshot row.
 */
export async function createSnapshotV1Action(
  ctx: CubeActionContext,
  input: { rawName: unknown }
): Promise<CubeActionResult<{ snapshot: CreateSnapshotV1Row }>> {
  const { spaceId, cubeId, membership, actor, reqCtx } = ctx;

  const [cube] = await db
    .select()
    .from(schema.cubes)
    .where(and(eq(schema.cubes.id, cubeId), eq(schema.cubes.spaceId, spaceId)))
    .limit(1);

  if (!cube) {
    return { ok: false, status: 404, error: "Cube not found" };
  }

  if (cube.status !== "running" && cube.status !== "sleeping") {
    return {
      ok: false,
      status: 422,
      error: `Cube must be running or sleeping to create a snapshot. Current status: ${cube.status}`,
    };
  }

  // Rule 58 preflight (audit M-6): a cube mid cross-server transfer keeps
  // status running/sleeping, but `cube.transfer` is copying its rootfs — a
  // concurrent snapshot would capture a torn ext4. snapshot-create re-checks
  // defensively, but gate up-front for a clean 409 (matches the dashboard
  // action) instead of a transient `failed` snapshot row.
  if (cube.transferState !== "idle") {
    return {
      ok: false,
      status: 409,
      error:
        "This Cube is being transferred between servers. Try again once the transfer completes.",
    };
  }

  const [inProgress] = await db
    .select({ id: schema.cubeSnapshots.id })
    .from(schema.cubeSnapshots)
    .where(
      and(
        eq(schema.cubeSnapshots.cubeId, cubeId),
        eq(schema.cubeSnapshots.status, "creating")
      )
    )
    .limit(1);

  if (inProgress) {
    return {
      ok: false,
      status: 409,
      error: "A snapshot is already being created for this cube",
    };
  }

  const now = new Date();
  const validated = validateName(input.rawName);
  const snapshotName =
    validated ??
    `snapshot-${now.toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;

  const snapshotId = createId();
  await db.insert(schema.cubeSnapshots).values({
    id: snapshotId,
    cubeId,
    spaceId,
    name: snapshotName,
    status: "pending",
    kind: "manual",
    createdBy: membership.userId,
  });

  await enqueueJob(JOB_NAMES.SNAPSHOT_CREATE, {
    snapshotId,
    cubeId,
    spaceId,
    serverId: cube.serverId,
  });

  await db.insert(schema.lifecycleLogs).values({
    entityType: "cube" as const,
    entityId: cubeId,
    message: `Snapshot creation requested via API key: "${snapshotName}"`,
  });

  if (actor.kind !== "apiKey") {
    // This handler is wired into the v1 routes only — caller invariant.
    // If we ever fold the dashboard server action through here, lifecycle
    // log + audit description need to branch on actor (server action's
    // wording is `Snapshot "X" creation started`, not the via-API-key form).
    return {
      ok: false,
      status: 500,
      error: "Internal server error",
    };
  }

  audit({
    action: "snapshot.create",
    category: "cube",
    actorType: "user",
    actorId: actor.apiKeyId,
    actorEmail: null,
    entityType: "cube",
    entityId: cubeId,
    spaceId,
    description: `Requested snapshot "${snapshotName}" for cube "${cube.name}" via API key`,
    metadata: {
      snapshotId,
      snapshotName,
      cubeId,
      apiKeyId: actor.apiKeyId,
    },
    source: "api",
    ...reqCtx,
  });

  return {
    ok: true,
    data: {
      snapshot: {
        id: snapshotId,
        cubeId,
        spaceId,
        name: snapshotName,
        status: "pending",
        kind: "manual",
        sizeBytes: null,
        completedAt: null,
        createdAt: now,
      },
    },
  };
}

/**
 * Shared business logic for `DELETE /cubes/[cubeId]/snapshots/[snapshotId]`
 * (v1). Mirrors the pre-refactor v1 behavior — DOES NOT enforce the
 * "auto snapshots refuse to delete; pin them first" rule that the
 * dashboard server action does.
 */
export async function deleteSnapshotV1Action(
  ctx: CubeActionContext & { snapshotId: string }
): Promise<CubeActionResult<{ snapshotName: string }>> {
  const { spaceId, cubeId, snapshotId, actor, reqCtx } = ctx;

  const [snapshot] = await db
    .select()
    .from(schema.cubeSnapshots)
    .where(
      and(
        eq(schema.cubeSnapshots.id, snapshotId),
        eq(schema.cubeSnapshots.cubeId, cubeId),
        eq(schema.cubeSnapshots.spaceId, spaceId)
      )
    )
    .limit(1);

  if (!snapshot) {
    return { ok: false, status: 404, error: "Snapshot not found" };
  }

  if (snapshot.status === "creating" || snapshot.status === "restoring") {
    return {
      ok: false,
      status: 409,
      error: `Cannot delete a snapshot that is currently ${snapshot.status}`,
    };
  }

  await enqueueJob(JOB_NAMES.SNAPSHOT_DELETE, {
    snapshotId,
    cubeId,
    spaceId,
  });

  await db.insert(schema.lifecycleLogs).values({
    entityType: "cube" as const,
    entityId: cubeId,
    message: `Snapshot deletion requested via API key: "${snapshot.name}"`,
  });

  if (actor.kind !== "apiKey") {
    return { ok: false, status: 500, error: "Internal server error" };
  }

  audit({
    action: "snapshot.delete",
    category: "cube",
    actorType: "user",
    actorId: actor.apiKeyId,
    actorEmail: null,
    entityType: "cube",
    entityId: cubeId,
    spaceId,
    description: `Requested deletion of snapshot "${snapshot.name}" via API key`,
    metadata: {
      snapshotId,
      snapshotName: snapshot.name,
      cubeId,
      apiKeyId: actor.apiKeyId,
    },
    source: "api",
    ...reqCtx,
  });

  return { ok: true, data: { snapshotName: snapshot.name } };
}

/**
 * Shared business logic for `POST /cubes/[cubeId]/restore` (v1).
 * Routes parse the body's `snapshotId` and forward it here.
 */
export async function restoreSnapshotV1Action(
  ctx: CubeActionContext,
  input: { snapshotId: unknown }
): Promise<CubeActionResult<{ snapshotName: string; cubeName: string }>> {
  const { spaceId, cubeId, actor, reqCtx } = ctx;
  const { snapshotId } = input;

  if (!snapshotId || typeof snapshotId !== "string") {
    return {
      ok: false,
      status: 400,
      error: "snapshotId is required and must be a string",
    };
  }

  const [snapshot] = await db
    .select()
    .from(schema.cubeSnapshots)
    .where(
      and(
        eq(schema.cubeSnapshots.id, snapshotId),
        eq(schema.cubeSnapshots.cubeId, cubeId),
        eq(schema.cubeSnapshots.spaceId, spaceId)
      )
    )
    .limit(1);

  if (!snapshot) {
    return { ok: false, status: 404, error: "Snapshot not found" };
  }

  if (snapshot.status !== "complete") {
    return {
      ok: false,
      status: 422,
      error: `Snapshot must be complete to restore. Current status: ${snapshot.status}`,
    };
  }

  const [cube] = await db
    .select()
    .from(schema.cubes)
    .where(and(eq(schema.cubes.id, cubeId), eq(schema.cubes.spaceId, spaceId)))
    .limit(1);

  if (!cube) {
    return { ok: false, status: 404, error: "Cube not found" };
  }

  if (cube.status !== "running" && cube.status !== "sleeping") {
    return {
      ok: false,
      status: 422,
      error: `Cube must be running or sleeping to restore a snapshot. Current status: ${cube.status}`,
    };
  }

  // Atomically claim the cube (status → stopping). This claim IS the restore
  // lock the worker guards on; without it the SNAPSHOT_RESTORE handler skips.
  const [claimedCube] = await db
    .update(schema.cubes)
    .set({ status: "stopping", updatedAt: new Date() })
    .where(
      and(
        eq(schema.cubes.id, cubeId),
        eq(schema.cubes.spaceId, spaceId),
        ne(schema.cubes.status, "deleted"),
        ne(schema.cubes.status, "stopping"),
        ne(schema.cubes.status, "error"),
        ne(schema.cubes.status, "pending"),
        ne(schema.cubes.status, "booting"),
        eq(schema.cubes.transferState, "idle")
      )
    )
    .returning({ id: schema.cubes.id });
  if (!claimedCube) {
    return {
      ok: false,
      status: 409,
      error: "Cube is no longer in a valid state for snapshot restore",
    };
  }

  await enqueueJob(JOB_NAMES.SNAPSHOT_RESTORE, {
    snapshotId,
    cubeId,
    spaceId,
    serverId: cube.serverId,
    // Capture the true pre-restore status — the handler can't read it off the
    // row (it's flipped to "stopping" before the handler runs).
    wasRunning: cube.status === "running",
  });

  await db.insert(schema.lifecycleLogs).values({
    entityType: "cube" as const,
    entityId: cubeId,
    message: `Snapshot restore requested via API key: "${snapshot.name}"`,
  });

  if (actor.kind !== "apiKey") {
    return { ok: false, status: 500, error: "Internal server error" };
  }

  audit({
    action: "snapshot.restore",
    category: "cube",
    actorType: "user",
    actorId: actor.apiKeyId,
    actorEmail: null,
    entityType: "cube",
    entityId: cubeId,
    spaceId,
    description: `Requested restore of snapshot "${snapshot.name}" for cube "${cube.name}" via API key`,
    metadata: {
      snapshotId,
      snapshotName: snapshot.name,
      cubeId,
      apiKeyId: actor.apiKeyId,
    },
    source: "api",
    ...reqCtx,
  });

  return {
    ok: true,
    data: { snapshotName: snapshot.name, cubeName: cube.name },
  };
}
