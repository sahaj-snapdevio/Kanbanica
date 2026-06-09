import { and, count, eq, inArray, ne, sum } from "drizzle-orm";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

export interface UserDeletionSummary {
  createdAt: Date;
  email: string;
  /** EmailIt contact id, if previously synced. Captured pre-delete so the
   *  enqueued cleanup job has something to target. */
  emailitContactId: string | null;
  emailVerified: boolean;
  /** Whoever triggered the deletion. */
  initiator: {
    type: "admin" | "system";
    userId: string | null;
    email: string | null;
  };
  lastSignedInAt: Date | null;
  name: string;
  reason: string | null;
  role: string | null;
  /** Memberships removed (non-owner only — owner-blocking is enforced by the endpoint). */
  spaces: { spaceId: string; spaceName: string }[];
  userId: string;
}

export interface SpaceDeletionSummary {
  backups: { count: number; totalGb: number };
  createdAt: Date;
  creditBalanceUsd: string;
  cubes: {
    count: number;
    totalVcpus: number;
    totalRamMb: number;
    totalDiskGb: number;
    names: string[];
  };
  domains: { count: number; hostnames: string[] };
  /** Initiator of the delete. */
  initiator: {
    type: "admin" | "owner" | "system";
    userId: string | null;
    email: string | null;
  };
  members: {
    /** Non-owner members at time of deletion. */
    count: number;
    emails: string[];
  };
  owner: { userId: string | null; email: string | null; name: string | null };
  planId: string;
  planName: string | null;
  snapshots: { count: number; totalGb: number };
  spaceId: string;
  spaceName: string;
  subscriptionStatus: string | null;
}

/**
 * Snapshot everything we want in the post-delete admin email BEFORE the rows
 * vanish. Aggregate queries — bounded cost regardless of cube count.
 */
export async function collectUserDeletionSummary(
  userId: string,
  initiator: UserDeletionSummary["initiator"],
  reason: string | null = null
): Promise<UserDeletionSummary | null> {
  const [userRow] = await db
    .select({
      id: schema.user.id,
      email: schema.user.email,
      name: schema.user.name,
      emailVerified: schema.user.emailVerified,
      createdAt: schema.user.createdAt,
      role: schema.user.role,
      emailitContactId: schema.user.emailitContactId,
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);

  if (!userRow) {
    return null;
  }

  const memberships = await db
    .select({
      spaceId: schema.spaces.id,
      spaceName: schema.spaces.name,
    })
    .from(schema.spaceMemberships)
    .innerJoin(
      schema.spaces,
      eq(schema.spaceMemberships.spaceId, schema.spaces.id)
    )
    .where(eq(schema.spaceMemberships.userId, userId));

  const [lastSession] = await db
    .select({ createdAt: schema.session.createdAt })
    .from(schema.session)
    .where(eq(schema.session.userId, userId))
    .orderBy(schema.session.createdAt)
    .limit(1);

  return {
    userId: userRow.id,
    email: userRow.email,
    name: userRow.name,
    emailVerified: userRow.emailVerified,
    createdAt: userRow.createdAt,
    lastSignedInAt: lastSession?.createdAt ?? null,
    role: userRow.role,
    spaces: memberships,
    emailitContactId: userRow.emailitContactId,
    initiator,
    reason,
  };
}

export async function collectSpaceDeletionSummary(
  spaceId: string,
  initiator: SpaceDeletionSummary["initiator"]
): Promise<SpaceDeletionSummary | null> {
  const [spaceRow] = await db
    .select({
      id: schema.spaces.id,
      name: schema.spaces.name,
      createdAt: schema.spaces.createdAt,
      planId: schema.spaces.planId,
      subscriptionStatus: schema.spaces.subscriptionStatus,
      creditBalance: schema.spaces.creditBalance,
      planName: schema.plans.name,
    })
    .from(schema.spaces)
    .leftJoin(schema.plans, eq(schema.spaces.planId, schema.plans.id))
    .where(eq(schema.spaces.id, spaceId))
    .limit(1);

  if (!spaceRow) {
    return null;
  }

  const [ownerRow] = await db
    .select({
      userId: schema.user.id,
      email: schema.user.email,
      name: schema.user.name,
    })
    .from(schema.spaceMemberships)
    .innerJoin(schema.user, eq(schema.spaceMemberships.userId, schema.user.id))
    .where(
      and(
        eq(schema.spaceMemberships.spaceId, spaceId),
        eq(schema.spaceMemberships.isOwner, true)
      )
    )
    .limit(1);

  const cubeAgg = await db
    .select({
      count: count(),
      totalVcpus: sum(schema.cubes.vcpus),
      totalRamMb: sum(schema.cubes.ramMb),
      totalDiskGb: sum(schema.cubes.diskLimitGb),
    })
    .from(schema.cubes)
    .where(
      and(eq(schema.cubes.spaceId, spaceId), ne(schema.cubes.status, "deleted"))
    );

  const cubeNameRows = await db
    .select({ name: schema.cubes.name })
    .from(schema.cubes)
    .where(
      and(eq(schema.cubes.spaceId, spaceId), ne(schema.cubes.status, "deleted"))
    )
    .limit(50);

  const snapshotAgg = await db
    .select({
      count: count(),
      totalGb: sum(schema.cubeSnapshots.sizeBytes),
    })
    .from(schema.cubeSnapshots)
    .where(eq(schema.cubeSnapshots.spaceId, spaceId));

  const backupAgg = await db
    .select({
      count: count(),
      totalGb: sum(schema.cubeBackups.sizeBytes),
    })
    .from(schema.cubeBackups)
    .where(eq(schema.cubeBackups.spaceId, spaceId));

  const domainRows = await db
    .select({ hostname: schema.domainMappings.domain })
    .from(schema.domainMappings)
    .innerJoin(schema.cubes, eq(schema.domainMappings.cubeId, schema.cubes.id))
    .where(eq(schema.cubes.spaceId, spaceId));

  const memberRows = await db
    .select({ email: schema.user.email })
    .from(schema.spaceMemberships)
    .innerJoin(schema.user, eq(schema.spaceMemberships.userId, schema.user.id))
    .where(
      and(
        eq(schema.spaceMemberships.spaceId, spaceId),
        eq(schema.spaceMemberships.isOwner, false)
      )
    );

  const bytesToGb = (bytes: string | number | null | undefined): number => {
    if (bytes == null) {
      return 0;
    }
    const n = typeof bytes === "string" ? Number(bytes) : bytes;
    if (!Number.isFinite(n) || n <= 0) {
      return 0;
    }
    return Math.round((n / 1024 / 1024 / 1024) * 100) / 100;
  };
  const intOr0 = (v: string | number | null | undefined): number => {
    if (v == null) {
      return 0;
    }
    const n = typeof v === "string" ? Number(v) : v;
    return Number.isFinite(n) ? n : 0;
  };

  return {
    spaceId: spaceRow.id,
    spaceName: spaceRow.name,
    createdAt: spaceRow.createdAt,
    owner: {
      userId: ownerRow?.userId ?? null,
      email: ownerRow?.email ?? null,
      name: ownerRow?.name ?? null,
    },
    planId: spaceRow.planId,
    planName: spaceRow.planName,
    subscriptionStatus: spaceRow.subscriptionStatus,
    creditBalanceUsd: spaceRow.creditBalance,
    cubes: {
      count: intOr0(cubeAgg[0]?.count),
      totalVcpus: intOr0(cubeAgg[0]?.totalVcpus),
      totalRamMb: intOr0(cubeAgg[0]?.totalRamMb),
      totalDiskGb: intOr0(cubeAgg[0]?.totalDiskGb),
      names: cubeNameRows.map((r) => r.name),
    },
    snapshots: {
      count: intOr0(snapshotAgg[0]?.count),
      totalGb: bytesToGb(snapshotAgg[0]?.totalGb as string | null),
    },
    backups: {
      count: intOr0(backupAgg[0]?.count),
      totalGb: bytesToGb(backupAgg[0]?.totalGb as string | null),
    },
    domains: {
      count: domainRows.length,
      hostnames: domainRows.map((d) => d.hostname),
    },
    members: {
      count: memberRows.length,
      emails: memberRows.map((m) => m.email),
    },
    initiator,
  };
}

/**
 * After the space-delete worker hard-deletes orphan users, it augments the
 * pre-collected summary with their emails — these are the accounts whose
 * EmailIt contacts also need cleanup.
 */
export function withOrphanUsers(
  summary: SpaceDeletionSummary,
  orphans: { userId: string; email: string }[]
): SpaceDeletionSummary & { orphanUsersDeleted: string[] } {
  return {
    ...summary,
    orphanUsersDeleted: orphans.map((o) => o.email),
  };
}

/** Discriminator used by helpers that take either summary type. */
export type DeletionSummary =
  | { kind: "user"; data: UserDeletionSummary }
  | {
      kind: "space";
      data: SpaceDeletionSummary & { orphanUsersDeleted?: string[] };
    };

/** Filter out a user id from a list (used when an owner's own deletion of
 *  their space shouldn't list themselves as an affected member). */
export async function findOrphanUserIds(
  spaceId: string,
  excludeUserIds: string[] = []
): Promise<string[]> {
  const rows = await db
    .select({ userId: schema.spaceMemberships.userId })
    .from(schema.spaceMemberships)
    .where(eq(schema.spaceMemberships.spaceId, spaceId));
  const candidateIds = rows
    .map((r) => r.userId)
    .filter((id) => !excludeUserIds.includes(id));
  if (candidateIds.length === 0) {
    return [];
  }
  const elsewhere = await db
    .select({ userId: schema.spaceMemberships.userId })
    .from(schema.spaceMemberships)
    .where(
      and(
        inArray(schema.spaceMemberships.userId, candidateIds),
        ne(schema.spaceMemberships.spaceId, spaceId)
      )
    );
  const keep = new Set(elsewhere.map((e) => e.userId));
  return candidateIds.filter((id) => !keep.has(id));
}
