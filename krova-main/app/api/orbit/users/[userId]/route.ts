import { and, eq, inArray, ne } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { notifyAdminsOfUserDeletion } from "@/lib/email/notify-deletion";
import { enqueueEmailitSync } from "@/lib/emailit/enqueue-sync";
import { collectUserDeletionSummary } from "@/lib/orbit/deletion-summaries";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    await requireAdmin(request);

    const { userId } = await params;

    const [userRecord] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);

    if (!userRecord) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    const memberships = await db
      .select({
        membership: schema.spaceMemberships,
        space: schema.spaces,
      })
      .from(schema.spaceMemberships)
      .innerJoin(
        schema.spaces,
        eq(schema.spaceMemberships.spaceId, schema.spaces.id)
      )
      .where(eq(schema.spaceMemberships.userId, userId));

    const spaceIds = memberships.map((m) => m.space.id);

    let userCubes: (typeof schema.cubes.$inferSelect)[] = [];
    if (spaceIds.length > 0) {
      userCubes = await db
        .select()
        .from(schema.cubes)
        .where(
          and(
            inArray(schema.cubes.spaceId, spaceIds),
            ne(schema.cubes.status, "deleted")
          )
        );
    }

    return Response.json({
      user: userRecord,
      spaces: memberships.map((m) => ({
        ...m.space,
        isOwner: m.membership.isOwner,
      })),
      cubes: userCubes,
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET /api/orbit/users/[userId] error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const session = await requireAdmin(request);

    const { userId } = await params;

    const [userRecord] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);

    if (!userRecord) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    // Prevent deleting users who own spaces (would orphan resources)
    const ownedSpaces = await db
      .select({ id: schema.spaceMemberships.spaceId })
      .from(schema.spaceMemberships)
      .where(
        and(
          eq(schema.spaceMemberships.userId, userId),
          eq(schema.spaceMemberships.isOwner, true)
        )
      )
      .limit(1);

    if (ownedSpaces.length > 0) {
      return Response.json(
        {
          error:
            "Cannot delete user who owns spaces. Transfer ownership first.",
        },
        { status: 409 }
      );
    }

    // Capture everything we want in the admin deletion email BEFORE the row
    // is gone — joined spaces, the emailitContactId, last sign-in.
    const summary = await collectUserDeletionSummary(userId, {
      type: "admin",
      userId: session.user.id,
      email: session.user.email,
    });

    // Enqueue EmailIt-contact cleanup BEFORE the user row is deleted so we
    // still have the contactId. The job is retryable and idempotent (404 is
    // treated as success), so a transient EmailIt outage can't block the
    // user deletion.
    if (summary?.emailitContactId || summary?.email) {
      try {
        await enqueueJob(JOB_NAMES.EMAILIT_DELETE_CONTACT, {
          contactId: summary.emailitContactId,
          email: summary.email,
        });
      } catch (err) {
        console.error(
          `[orbit:user.delete] failed to enqueue EmailIt cleanup for ${userId}:`,
          err
        );
      }
    }

    await db.delete(schema.user).where(eq(schema.user.id, userId));

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "admin.delete_user",
      category: "auth",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "user",
      entityId: userId,
      description: `Admin deleted user "${userRecord.email}"`,
      metadata: {
        userId,
        userEmail: userRecord.email,
        emailitContactId: summary?.emailitContactId ?? null,
        membershipsRemoved: summary?.spaces.length ?? 0,
      },
      source: "api",
      ...reqCtx,
    });

    if (summary) {
      try {
        await notifyAdminsOfUserDeletion(summary);
      } catch (err) {
        console.error(
          `[orbit:user.delete] failed to send admin notification for ${userId}:`,
          err
        );
      }
    }

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("DELETE /api/orbit/users/[userId] error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const session = await requireAdmin(request);

    const { userId } = await params;
    const body = await request.json();
    const { role } = body as { role?: unknown };

    if (role !== "admin" && role !== "user") {
      return Response.json(
        { error: "role is required and must be 'admin' or 'user'" },
        { status: 400 }
      );
    }

    // Prevent admins from modifying their own admin status
    if (userId === session.user.id) {
      return Response.json(
        { error: "Cannot modify your own admin status" },
        { status: 403 }
      );
    }

    const [userRecord] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);

    if (!userRecord) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    const [updated] = await db
      .update(schema.user)
      .set({ role, updatedAt: new Date() })
      .where(eq(schema.user.id, userId))
      .returning();

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "admin.update_user",
      category: "auth",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "user",
      entityId: userId,
      description: `Admin ${role === "admin" ? "granted" : "revoked"} admin status for user "${userId}"`,
      metadata: { userId, role },
      source: "api",
      ...reqCtx,
    });

    // account_role just flipped for the target user.
    await enqueueEmailitSync(userId);

    return Response.json({ user: updated });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("PATCH /api/orbit/users/[userId] error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
