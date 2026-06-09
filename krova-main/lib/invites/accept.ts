import { createId } from "@paralleldrive/cuid2";
import { and, asc, count, eq, inArray, ne } from "drizzle-orm";
import * as schema from "@/db/schema";
import { PERMISSION_VALUES, type PermissionValue } from "@/db/schema/types";
import { db } from "@/lib/db";
import {
  assertCanInviteMemberV2,
  loadEffectiveLimitsTx,
} from "@/lib/plan/limits";
import { acquireSpaceLock } from "@/lib/plan/usage";

type TxHandle = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AcceptInviteOk = {
  ok: true;
  inviteId: string;
  spaceId: string;
  invitePermissions: string[];
  inviteCubeAssignments: string[];
  invitedBy: string;
  inviteeEmail: string;
  /** True when the user was already a member of the target space — no rows
   *  were inserted; the invite was simply marked accepted. Callers should
   *  branch on this for audit accuracy and to avoid mis-claiming permissions
   *  were applied. */
  wasExistingMember: boolean;
};

export type AcceptInviteErr = { ok: false; error: string };

export type AcceptInviteResult = AcceptInviteOk | AcceptInviteErr;

interface AcceptInviteInTxParams {
  inviteId: string;
  tx: TxHandle;
  userEmail: string;
  userId: string;
}

/**
 * Core invite-acceptance logic, callable from a server action (acceptInvite)
 * or from the user.create auth hook for auto-accept-on-signup. Operates inside
 * the caller's transaction with a `FOR UPDATE` lock on the invite row.
 *
 * Re-validates the invite's stored permissions and cube assignments against
 * the current `PERMISSION_VALUES` and live cubes — so an invite sent before a
 * permission rename or a cube deletion still accepts cleanly (invalid entries
 * are silently dropped).
 */
export async function acceptInviteInTx({
  tx,
  inviteId,
  userId,
  userEmail,
}: AcceptInviteInTxParams): Promise<AcceptInviteResult> {
  const [invite] = await tx
    .select()
    .from(schema.invites)
    .where(eq(schema.invites.id, inviteId))
    .for("update")
    .limit(1);

  if (invite?.status !== "pending") {
    return { ok: false, error: "This invite is no longer valid" };
  }

  if (invite.email.toLowerCase() !== userEmail.toLowerCase()) {
    return {
      ok: false,
      error: "This invite was sent to a different email address",
    };
  }

  if (invite.expiresAt < new Date()) {
    await tx
      .update(schema.invites)
      .set({ status: "expired" })
      .where(eq(schema.invites.id, invite.id));
    return {
      ok: false,
      error: "This invite has expired. Ask the space owner to send a new one.",
    };
  }

  // Serialize concurrent accepts (and any other space-scoped mutation that
  // touches plan-limit counts) so the seat-cap re-check + membership insert
  // below are atomic per space. Without this lock, two simultaneous accepts
  // can both pass a count() at N and both insert, overshooting maxSeats.
  await acquireSpaceLock(tx, invite.spaceId);

  const [existingMembership] = await tx
    .select({ id: schema.spaceMemberships.id })
    .from(schema.spaceMemberships)
    .where(
      and(
        eq(schema.spaceMemberships.userId, userId),
        eq(schema.spaceMemberships.spaceId, invite.spaceId)
      )
    )
    .limit(1);

  if (existingMembership) {
    await tx
      .update(schema.invites)
      .set({ status: "accepted" })
      .where(eq(schema.invites.id, invite.id));
    return {
      ok: true,
      inviteId: invite.id,
      spaceId: invite.spaceId,
      invitePermissions: (invite.permissions as string[]) ?? [],
      inviteCubeAssignments: (invite.cubeAssignments as string[]) ?? [],
      invitedBy: invite.invitedBy,
      inviteeEmail: invite.email,
      wasExistingMember: true,
    };
  }

  const limits = await loadEffectiveLimitsTx(tx, invite.spaceId);
  const [{ memberCount }] = await tx
    .select({ memberCount: count() })
    .from(schema.spaceMemberships)
    .where(eq(schema.spaceMemberships.spaceId, invite.spaceId));
  const seatCheck = assertCanInviteMemberV2(limits, Number(memberCount));
  if (!seatCheck.ok) {
    return { ok: false, error: seatCheck.error };
  }

  const rawPermissions = (invite.permissions as string[]) ?? [];
  const rawCubeAssignments = (invite.cubeAssignments as string[]) ?? [];

  const permSet = new Set<string>(PERMISSION_VALUES);
  const invitePermissions = rawPermissions.filter((p) => permSet.has(p));

  let inviteCubeAssignments: string[] = [];
  if (rawCubeAssignments.length > 0) {
    const validCubes = await tx
      .select({ id: schema.cubes.id })
      .from(schema.cubes)
      .where(
        and(
          eq(schema.cubes.spaceId, invite.spaceId),
          inArray(schema.cubes.id, rawCubeAssignments),
          ne(schema.cubes.status, "deleted")
        )
      );
    inviteCubeAssignments = validCubes.map((v) => v.id);
  }

  const membershipId = createId();
  await tx.insert(schema.spaceMemberships).values({
    id: membershipId,
    userId,
    spaceId: invite.spaceId,
    isOwner: false,
  });

  if (invitePermissions.length > 0) {
    await tx.insert(schema.memberPermissions).values(
      invitePermissions.map((p) => ({
        id: createId(),
        membershipId,
        permission: p as PermissionValue,
      }))
    );
  }

  if (inviteCubeAssignments.length > 0) {
    await tx.insert(schema.memberCubeAssignments).values(
      inviteCubeAssignments.map((cubeId) => ({
        id: createId(),
        membershipId,
        cubeId,
      }))
    );
  }

  await tx
    .update(schema.invites)
    .set({ status: "accepted" })
    .where(eq(schema.invites.id, invite.id));

  return {
    ok: true,
    inviteId: invite.id,
    spaceId: invite.spaceId,
    invitePermissions,
    inviteCubeAssignments,
    invitedBy: invite.invitedBy,
    inviteeEmail: invite.email,
    wasExistingMember: false,
  };
}

/**
 * Find every pending, unexpired invite that targets the given email. Used by
 * the user.create auth hook to detect a team-invitee signup so the personal
 * default space + credit grant can be skipped and the invites auto-accepted.
 */
export async function findPendingInvitesForEmail(email: string) {
  // ORDER BY spaceId keeps the lock acquisition order consistent across
  // concurrent signups when multiple users are invited to the same set of
  // spaces — preventing the deadlock where tx A holds space1 + waits on
  // space2 while tx B holds space2 + waits on space1.
  const rows = await db
    .select({
      id: schema.invites.id,
      spaceId: schema.invites.spaceId,
      expiresAt: schema.invites.expiresAt,
    })
    .from(schema.invites)
    .where(
      and(
        eq(schema.invites.email, email.toLowerCase()),
        eq(schema.invites.status, "pending")
      )
    )
    .orderBy(asc(schema.invites.spaceId));

  const now = new Date();
  return rows.filter((r) => r.expiresAt > now);
}
