import { and, count, desc, eq, ne } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { Cube, SpaceMembership } from "@/db/schema/types";
import type { CubeActionResult } from "@/lib/cube-actions/types";
import { db } from "@/lib/db";
import { assertCanCreateCubeV2, effectiveLimits } from "@/lib/plan/limits";
import {
  acquireSpaceLock,
  countActiveCubesTx,
  getSpaceOverrides,
  getSpacePlanRow,
} from "@/lib/plan/usage";
import {
  allocateServerAndCreateCube,
  reconcileServerResources,
} from "@/lib/server/allocate";
import { freePortsByCube } from "@/lib/server/ports";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

/**
 * Reduced row shape returned when a non-owner member lists cubes — the
 * dashboard + v1 routes select the same subset because the team-member view
 * historically hid server IDs / system fields the owner sees in full. Kept
 * as a type so the GET routes can iterate the result uniformly.
 */
type CubeListRow = Pick<
  Cube,
  | "id"
  | "spaceId"
  | "serverId"
  | "name"
  | "status"
  | "vcpus"
  | "ramMb"
  | "diskLimitGb"
  | "imageId"
  | "internalIp"
  | "internalIpv6"
  | "zeroBalanceSleep"
  | "createdAt"
  | "updatedAt"
>;

/**
 * Shared business logic for `GET /cubes`. Returns the rows + total count.
 * Routes are responsible for:
 *   - the auth chain that yields `membership`
 *   - any wire-format wrapping (publicIp join, formatCube, audit log)
 *
 * Owner gets a SELECT * on cubes; non-owner is gated on `cube.view` and
 * gets only the assigned cubes via the memberCubeAssignments join, with
 * the reduced column set above.
 *
 * Caller MUST gate non-owner with `requirePermission(membership, "cube.view")`
 * before calling — this handler trusts the membership for read scope but
 * does NOT re-check the permission (kept in the route so the 403 surfaces
 * before any DB work).
 */
export async function listCubesAction(input: {
  spaceId: string;
  membership: SpaceMembership;
  page: number;
  limit: number;
  offset: number;
}): Promise<{ cubes: CubeListRow[]; totalCount: number }> {
  const { spaceId, membership, limit, offset } = input;

  const whereClause = and(
    eq(schema.cubes.spaceId, spaceId),
    ne(schema.cubes.status, "deleted")
  );

  if (membership.isOwner) {
    const [countResult] = await db
      .select({ total: count() })
      .from(schema.cubes)
      .where(whereClause);

    const totalCount = countResult?.total ?? 0;

    const rows = await db
      .select()
      .from(schema.cubes)
      .where(whereClause)
      .orderBy(desc(schema.cubes.createdAt))
      .limit(limit)
      .offset(offset);

    return { cubes: rows, totalCount };
  }

  const [countResult] = await db
    .select({ total: count() })
    .from(schema.cubes)
    .innerJoin(
      schema.memberCubeAssignments,
      and(
        eq(schema.memberCubeAssignments.cubeId, schema.cubes.id),
        eq(schema.memberCubeAssignments.membershipId, membership.id)
      )
    )
    .where(whereClause);

  const totalCount = countResult?.total ?? 0;

  const rows = await db
    .select({
      id: schema.cubes.id,
      spaceId: schema.cubes.spaceId,
      serverId: schema.cubes.serverId,
      name: schema.cubes.name,
      status: schema.cubes.status,
      vcpus: schema.cubes.vcpus,
      ramMb: schema.cubes.ramMb,
      diskLimitGb: schema.cubes.diskLimitGb,
      imageId: schema.cubes.imageId,
      internalIp: schema.cubes.internalIp,
      internalIpv6: schema.cubes.internalIpv6,
      zeroBalanceSleep: schema.cubes.zeroBalanceSleep,
      createdAt: schema.cubes.createdAt,
      updatedAt: schema.cubes.updatedAt,
    })
    .from(schema.cubes)
    .innerJoin(
      schema.memberCubeAssignments,
      and(
        eq(schema.memberCubeAssignments.cubeId, schema.cubes.id),
        eq(schema.memberCubeAssignments.membershipId, membership.id)
      )
    )
    .where(whereClause)
    .orderBy(desc(schema.cubes.createdAt))
    .limit(limit)
    .offset(offset);

  return { cubes: rows, totalCount };
}

export type CreateCubeInput = {
  name: string;
  vcpus: number;
  ramMb: number;
  diskGb: number;
  imageId: string;
  sshPublicKey: string;
  regionId?: string;
  userData?: string | null;
};

/**
 * Shared business logic for `POST /cubes`. Routes are responsible for:
 *   - parsing + validating the request body into a CreateCubeInput
 *   - emitting the audit log (the two routes carry different metadata)
 *   - dispatching webhooks (only v1 does this today)
 *   - wire-format response shaping
 *
 * Handler owns: cost calc, space lookup, credit check, plan-limit check
 * inside a per-space advisory lock, server allocation + cube row insert,
 * provision-job enqueue.
 *
 * Caller MUST have already validated `input` — this handler does NOT
 * re-run isValidRangeValue / validateName / isValidSshPublicKey checks.
 * The 422 (insufficient credits) response shape carries the structured
 * {required, available} metadata in errorMeta.
 */
export async function createCubeAction(
  input: { spaceId: string } & CreateCubeInput,
  cost: { hourlyCost: number }
): Promise<CubeActionResult<{ cube: Cube }>> {
  const {
    spaceId,
    name,
    vcpus,
    ramMb,
    diskGb,
    imageId,
    sshPublicKey,
    regionId,
    userData,
  } = input;
  const { hourlyCost } = cost;
  const diskLimitGb = diskGb;

  const [space] = await db
    .select()
    .from(schema.spaces)
    .where(eq(schema.spaces.id, spaceId))
    .limit(1);

  if (!space) {
    return { ok: false, status: 404, error: "Space not found" };
  }

  const creditBalance = Number.parseFloat(space.creditBalance);
  if (creditBalance < hourlyCost) {
    return {
      ok: false,
      status: 422,
      error: "Insufficient credits",
      errorMeta: { required: hourlyCost, available: creditBalance },
    };
  }

  const [planRow, spaceOverrides] = await Promise.all([
    getSpacePlanRow(spaceId),
    getSpaceOverrides(spaceId),
  ]);
  const limits = effectiveLimits(planRow, spaceOverrides);

  type TxResult =
    | { kind: "planRejected"; error: string }
    | { kind: "ok"; cube: Cube };

  const txResult = await db.transaction(async (tx): Promise<TxResult> => {
    await acquireSpaceLock(tx, spaceId);
    const activeCubes = await countActiveCubesTx(tx, spaceId);
    const planCheck = assertCanCreateCubeV2(limits, activeCubes, {
      vcpus,
      ramMb,
      diskGb,
    });
    if (!planCheck.ok) {
      return { kind: "planRejected", error: planCheck.error };
    }
    const { cube } = await allocateServerAndCreateCube(
      {
        spaceId,
        name,
        vcpus,
        ramMb,
        diskLimitGb,
        imageId,
        regionId,
        userData: userData ?? null,
      },
      { throwResponse: true, tx }
    );
    return { kind: "ok", cube };
  });

  if (txResult.kind === "planRejected") {
    return { ok: false, status: 403, error: txResult.error };
  }

  const { cube } = txResult;

  try {
    await enqueueJob(JOB_NAMES.CUBE_PROVISION, {
      cubeId: cube.id,
      spaceId,
      serverId: cube.serverId,
      vcpus: cube.vcpus,
      ramMb: cube.ramMb,
      diskLimitGb: cube.diskLimitGb,
      imageId: cube.imageId,
      sshPublicKey: sshPublicKey.trim(),
      userData: userData ?? null,
    });
  } catch (err) {
    // The cube row + SSH port + server allocation already committed in the tx
    // above, but provisioning never got enqueued (pg-boss/DB hiccup). Without
    // rollback the cube strands in `pending` holding a host CPU/RAM/disk
    // reservation (wrongly reducing capacity for other allocations) until
    // cube.stale-check reaps it ~10 min later. Roll back NOW — flip to error,
    // free the SSH port, reconcile the server counters — mirroring the
    // dashboard createCube path so both create surfaces behave identically.
    console.error(
      `[cube-list-create] CUBE_PROVISION enqueue failed for ${cube.id}; rolling back:`,
      err
    );
    await db
      .transaction(async (tx) => {
        await tx
          .update(schema.cubes)
          .set({ status: "error", lastBilledAt: null, updatedAt: new Date() })
          .where(eq(schema.cubes.id, cube.id));
        await freePortsByCube(tx, cube.id);
        await reconcileServerResources(tx, cube.serverId);
      })
      .catch(() => {});
    return {
      ok: false,
      status: 500,
      error: "Failed to start cube provisioning. Please try again.",
    };
  }

  return { ok: true, data: { cube } };
}
