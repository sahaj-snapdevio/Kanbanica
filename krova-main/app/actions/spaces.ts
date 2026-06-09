"use server";

import { createId } from "@paralleldrive/cuid2";
import { and, count, eq, inArray, ne } from "drizzle-orm";
import { headers } from "next/headers";
import * as schema from "@/db/schema";
import { PERMISSION_VALUES } from "@/db/schema/types";
import { requireActionMembershipAndPermission } from "@/lib/actions/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { chargeProratedUsageWithAudit } from "@/lib/cost";
import { db } from "@/lib/db";
import { notifyAdminsOfSpaceDeletion } from "@/lib/email/notify-deletion";
import { enqueueEmailitSync } from "@/lib/emailit/enqueue-sync";
import { collectSpaceDeletionSummary } from "@/lib/orbit/deletion-summaries";
import { acquireUserLock, getDefaultPlan } from "@/lib/plan/usage";
import { validateName } from "@/lib/validators";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

export async function createSpace(name: string) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return { error: "Unauthorized" };
    }

    const trimmedName = validateName(name);
    if (!trimmedName) {
      return {
        error: "Name is required and must be 1–64 printable characters",
      };
    }

    const spaceId = createId();
    const membershipId = createId();

    // Source the default plan + its included credit from the `plans` table
    // (operator-editable in Orbit → Plans).
    const defaultPlan = await getDefaultPlan();
    const defaultIncludedCredit = Number.parseFloat(
      defaultPlan.includedCreditUsd
    );

    await db.transaction(async (tx) => {
      // Serialize this user's space creations so the once-per-user trial-grant
      // check below cannot be raced into multiple grants.
      await acquireUserLock(tx, session.user.id);

      // The included-credit trial grant is given ONCE PER USER — only their
      // first owned space. Later spaces start at $0 (closes the
      // create-many-spaces farm).
      const [owned] = await tx
        .select({ n: count() })
        .from(schema.spaceMemberships)
        .where(
          and(
            eq(schema.spaceMemberships.userId, session.user.id),
            eq(schema.spaceMemberships.isOwner, true)
          )
        );
      const isFirstSpace = Number(owned?.n ?? 0) === 0;

      await tx.insert(schema.spaces).values({
        id: spaceId,
        name: trimmedName,
        creditBalance: isFirstSpace ? defaultIncludedCredit.toFixed(4) : "0",
        planId: defaultPlan.id,
      });

      await tx.insert(schema.spaceMemberships).values({
        id: membershipId,
        userId: session.user.id,
        spaceId,
        isOwner: true,
      });

      await tx.insert(schema.memberPermissions).values(
        PERMISSION_VALUES.map((p) => ({
          id: createId(),
          membershipId,
          permission: p,
        }))
      );

      await tx.insert(schema.lifecycleLogs).values({
        entityType: "space" as const,
        entityId: spaceId,
        message: "Space created",
      });
    });

    const [space] = await db
      .select()
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId));

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "space.create",
      category: "space",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: `Created space "${trimmedName}"`,
      metadata: { name: trimmedName },
      ...reqCtx,
    });

    // owned_space_count / space_count just changed for this user.
    await enqueueEmailitSync(session.user.id);

    return { success: true, data: space };
  } catch (error) {
    console.error("createSpace error:", error);
    return {
      error: "Something went wrong while creating the space. Please try again.",
    };
  }
}

export async function renameSpace(spaceId: string, name: string) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return { error: "Unauthorized" };
    }

    const validatedName = validateName(name);
    if (!validatedName) {
      return {
        error: "Name is required and must be 1–64 printable characters",
      };
    }

    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "members.manage"
    );
    if ("error" in permResult) {
      return permResult;
    }

    // Read the current name BEFORE the update so the audit log captures the real old name
    const [existing] = await db
      .select({ name: schema.spaces.name })
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId))
      .limit(1);

    const oldName = existing?.name;

    const [updated] = await db
      .update(schema.spaces)
      .set({ name: validatedName, updatedAt: new Date() })
      .where(eq(schema.spaces.id, spaceId))
      .returning();

    if (!updated) {
      return { error: "Space not found" };
    }

    await db.insert(schema.lifecycleLogs).values({
      entityType: "space",
      entityId: spaceId,
      message: `Space renamed to "${validatedName}"`,
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "space.rename",
      category: "space",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: `Renamed space to "${validatedName}"`,
      metadata: { oldName, newName: validatedName },
      ...reqCtx,
    });

    return { success: true, data: updated };
  } catch (error) {
    console.error("renameSpace error:", error);
    return {
      error: "Something went wrong while renaming the space. Please try again.",
    };
  }
}

export async function deleteSpace(spaceId: string) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return { error: "Unauthorized" };
    }

    // deleteSpace requires owner — check manually since it's a special case
    const [membership] = await db
      .select()
      .from(schema.spaceMemberships)
      .where(
        and(
          eq(schema.spaceMemberships.userId, session.user.id),
          eq(schema.spaceMemberships.spaceId, spaceId)
        )
      )
      .limit(1);

    if (!membership) {
      return { error: "Forbidden: not a member of this space" };
    }

    if (!membership.isOwner) {
      return { error: "Only the owner can delete a space" };
    }

    const [space] = await db
      .select()
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId));

    if (!space) {
      return { error: "Space not found" };
    }

    // Block deletion if space has any active cubes (not deleted)
    const [activeCubeCount] = await db
      .select({ count: count() })
      .from(schema.cubes)
      .where(
        and(
          eq(schema.cubes.spaceId, spaceId),
          ne(schema.cubes.status, "deleted")
        )
      );

    if (activeCubeCount.count > 0) {
      return {
        error: "Cannot delete space with active Cubes. Delete all Cubes first.",
      };
    }

    // Block deletion if space has any backups
    const [backupCount] = await db
      .select({ count: count() })
      .from(schema.cubeBackups)
      .where(eq(schema.cubeBackups.spaceId, spaceId));

    if (backupCount.count > 0) {
      return {
        error:
          "Cannot delete space with existing backups. Delete all backups first.",
      };
    }

    // Block deletion if space has non-zero credit balance
    if (Number.parseFloat(space.creditBalance) !== 0) {
      return {
        error:
          "Cannot delete space with remaining credits. Contact support to zero out the balance.",
      };
    }

    // Collect storage paths BEFORE the transaction (to avoid long-held locks from HTTP calls)
    const allSnapshots = await db
      .select({
        storagePath: schema.cubeSnapshots.storagePath,
        storageBackendId: schema.cubeSnapshots.storageBackendId,
      })
      .from(schema.cubeSnapshots)
      .where(eq(schema.cubeSnapshots.spaceId, spaceId));

    // Charge prorated usage for all running cubes BEFORE deleting the space.
    // Once the space row is gone, the worker's cube.delete can't charge the space.
    const billableCubes = await db
      .select()
      .from(schema.cubes)
      .where(
        and(
          eq(schema.cubes.spaceId, spaceId),
          eq(schema.cubes.status, "running")
        )
      );

    for (const cube of billableCubes) {
      if (cube.lastBilledAt) {
        // Rule 51 + Fix #3: once the space + cube rows are gone, retroactive
        // billing is impossible — the failure MUST land in the audit log.
        // `chargeProratedUsageWithAudit` makes that audit row structural.
        await chargeProratedUsageWithAudit(cube, {
          flow: "space delete",
          logPrefix: `[deleteSpace] cube ${cube.id}`,
          actor: {
            type: "user",
            id: session.user.id,
            email: session.user.email,
          },
          source: "web",
        });
      }
    }

    // Schedule storage cleanup for residual snapshot objects BEFORE deleting
    // the space row. Enqueuing first means a failed enqueue aborts deletion
    // with an actionable error — instead of orphaning objects after the
    // space (and every DB reference to those paths) is already gone.
    const pathsByBackend = new Map<string, string[]>();
    for (const snap of allSnapshots) {
      if (!snap.storagePath || !snap.storageBackendId) {
        continue;
      }
      const paths = pathsByBackend.get(snap.storageBackendId) ?? [];
      paths.push(snap.storagePath);
      pathsByBackend.set(snap.storageBackendId, paths);
    }
    try {
      for (const [storageBackendId, storagePaths] of pathsByBackend) {
        await enqueueJob(JOB_NAMES.STORAGE_CLEANUP, {
          storagePaths,
          storageBackendId,
          reason: `Space "${space.name}" deleted`,
        });
      }
    } catch (err) {
      console.error("[deleteSpace] failed to enqueue storage cleanup:", err);
      return { error: "Failed to schedule cleanup. Please try again." };
    }

    // Snapshot the space BEFORE the transaction tears it down so the admin
    // deletion-summary email has accurate counts (cubes, snapshots, backups,
    // members, …). The owner triggering self-service is the initiator.
    const deletionSummary = await collectSpaceDeletionSummary(spaceId, {
      type: "owner",
      userId: session.user.id,
      email: session.user.email,
    });

    const orphanUsersDeleted: {
      userId: string;
      email: string;
      contactId: string | null;
    }[] = [];
    // Non-owner members of the deleted space who still hold a membership
    // elsewhere — their space_count / is_team_member just changed, so we
    // refresh their EmailIt contact after the tx commits.
    const survivingMemberUserIds: string[] = [];

    await db.transaction(async (tx) => {
      // Enqueue cube.delete for all non-deleted Cubes
      const activeCubes = await tx
        .select()
        .from(schema.cubes)
        .where(
          and(
            eq(schema.cubes.spaceId, spaceId),
            ne(schema.cubes.status, "deleted")
          )
        );

      for (const cube of activeCubes) {
        await enqueueJob(JOB_NAMES.CUBE_DELETE, {
          cubeId: cube.id,
          spaceId,
          serverId: cube.serverId,
        });
      }

      // Find members who have no other spaces — delete their accounts
      const members = await tx
        .select({ userId: schema.spaceMemberships.userId })
        .from(schema.spaceMemberships)
        .where(eq(schema.spaceMemberships.spaceId, spaceId));

      const memberUserIds = members
        .map((m) => m.userId)
        .filter((id) => id !== session.user.id);

      if (memberUserIds.length > 0) {
        const usersWithOtherSpaces = await tx
          .select({ userId: schema.spaceMemberships.userId })
          .from(schema.spaceMemberships)
          .where(
            and(
              inArray(schema.spaceMemberships.userId, memberUserIds),
              ne(schema.spaceMemberships.spaceId, spaceId)
            )
          );

        const usersWithOtherSpaceIds = new Set(
          usersWithOtherSpaces.map((u) => u.userId)
        );
        survivingMemberUserIds.push(
          ...memberUserIds.filter((id) => usersWithOtherSpaceIds.has(id))
        );
        const membersWithNoOtherSpaces = memberUserIds.filter(
          (id) => !usersWithOtherSpaceIds.has(id)
        );

        if (membersWithNoOtherSpaces.length > 0) {
          // Capture orphan emails + contact ids before deletion so we can
          // fan out EmailIt cleanup jobs and include them in the admin email.
          const orphanRows = await tx
            .select({
              id: schema.user.id,
              email: schema.user.email,
              emailitContactId: schema.user.emailitContactId,
            })
            .from(schema.user)
            .where(inArray(schema.user.id, membersWithNoOtherSpaces));
          for (const o of orphanRows) {
            orphanUsersDeleted.push({
              userId: o.id,
              email: o.email,
              contactId: o.emailitContactId,
            });
          }
          await tx
            .delete(schema.user)
            .where(inArray(schema.user.id, membersWithNoOtherSpaces));
        }
      }

      await tx.insert(schema.lifecycleLogs).values({
        entityType: "space",
        entityId: spaceId,
        message: "Space deleted",
      });

      await tx.delete(schema.spaces).where(eq(schema.spaces.id, spaceId));
    });

    // Fan out EmailIt cleanup for every orphan account just hard-deleted.
    // Retryable + idempotent (404 = success) so transient EmailIt outages
    // don't block the user-facing flow.
    for (const orphan of orphanUsersDeleted) {
      try {
        await enqueueJob(JOB_NAMES.EMAILIT_DELETE_CONTACT, {
          contactId: orphan.contactId,
          email: orphan.email,
        });
      } catch (err) {
        console.error(
          `[deleteSpace] failed to enqueue EmailIt cleanup for ${orphan.email}:`,
          err
        );
      }
    }

    // The owner just lost a space; surviving members lost a team membership.
    await enqueueEmailitSync(session.user.id);
    for (const userId of survivingMemberUserIds) {
      await enqueueEmailitSync(userId);
    }

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "space.delete",
      category: "space",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: `Deleted space "${space.name}"`,
      metadata: {
        name: space.name,
        creditBalance: space.creditBalance,
        orphanUsersDeleted: orphanUsersDeleted.length,
      },
      ...reqCtx,
    });

    if (deletionSummary) {
      try {
        await notifyAdminsOfSpaceDeletion({
          ...deletionSummary,
          orphanUsersDeleted: orphanUsersDeleted.map((o) => o.email),
        });
      } catch (err) {
        console.error(
          `[deleteSpace] failed to send admin notification for ${spaceId}:`,
          err
        );
      }
    }

    return { success: true };
  } catch (error) {
    console.error("deleteSpace error:", error);
    return {
      error: "Something went wrong while deleting the space. Please try again.",
    };
  }
}
