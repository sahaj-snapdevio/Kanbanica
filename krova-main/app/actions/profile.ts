"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import * as schema from "@/db/schema";
import { user } from "@/db/schema";
import { audit, extractRequestContext } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueueEmailitSync } from "@/lib/emailit/enqueue-sync";
import { validateEmail } from "@/lib/validators";

/**
 * Clears Better Auth's session data cache cookie so the next
 * `getSession()` call reads fresh data from the database.
 *
 * `auth.api.*` calls in server actions update the DB but cannot
 * set response cookies, leaving the cached session stale.
 */
async function clearSessionCache() {
  const cookieStore = await cookies();
  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.includes("session_data")) {
      cookieStore.delete(cookie.name);
    }
  }
}

export async function updateNameAction(name: string) {
  try {
    const reqHeaders = await headers();
    const session = await auth.api.getSession({ headers: reqHeaders });
    if (!session) {
      return { error: "Unauthorized" };
    }

    const trimmed = name.trim();
    if (!trimmed || trimmed.length === 0) {
      return { error: "Name is required" };
    }
    if (trimmed.length > 100) {
      return { error: "Name must be 100 characters or fewer" };
    }

    await auth.api.updateUser({
      body: { name: trimmed },
      headers: reqHeaders,
    });

    // Invalidate the session cookie cache so the UI reflects the change
    await clearSessionCache();

    const reqCtx = extractRequestContext(reqHeaders);
    audit({
      action: "profile.update_name",
      category: "auth",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "user",
      entityId: session.user.id,
      description: `Updated display name to "${trimmed}"`,
      metadata: { oldName: session.user.name, newName: trimmed },
      ...reqCtx,
    });

    return { success: true };
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return {
      error: "Something went wrong while updating your name. Please try again.",
    };
  }
}

export async function updateMarketingOptInAction(optIn: boolean) {
  try {
    const reqHeaders = await headers();
    const session = await auth.api.getSession({ headers: reqHeaders });
    if (!session) {
      return { error: "Unauthorized" };
    }

    await db
      .update(user)
      .set({ marketingOptIn: optIn })
      .where(eq(user.id, session.user.id));

    // Reflect the new opt-in preference in EmailIt immediately. The helper
    // is fire-and-forget — a queue failure must not fail the toggle.
    await enqueueEmailitSync(session.user.id);

    const reqCtx = extractRequestContext(reqHeaders);
    audit({
      action: "profile.update_marketing_opt_in",
      category: "auth",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "user",
      entityId: session.user.id,
      description: `${optIn ? "Enabled" : "Disabled"} marketing emails`,
      metadata: { marketingOptIn: optIn },
      ...reqCtx,
    });

    return { success: true };
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return {
      error: "Something went wrong while updating your preferences.",
    };
  }
}

// ---------------------------------------------------------------------------
// Session management — listing, single-revoke, and "sign out all other
// devices". The current session token is included in the list so the UI can
// label it explicitly and prevent the user from accidentally revoking the
// session they're using right now.
// ---------------------------------------------------------------------------

export interface UserSessionRow {
  createdAt: string;
  expiresAt: string;
  id: string;
  impersonatedBy: string | null;
  ipAddress: string | null;
  isCurrent: boolean;
  token: string;
  userAgent: string | null;
}

export async function listUserSessions(): Promise<
  { error: string } | { sessions: UserSessionRow[] }
> {
  try {
    const reqHeaders = await headers();
    const session = await auth.api.getSession({ headers: reqHeaders });
    if (!session) {
      return { error: "Unauthorized" };
    }

    const rows = await db
      .select({
        id: schema.session.id,
        token: schema.session.token,
        ipAddress: schema.session.ipAddress,
        userAgent: schema.session.userAgent,
        createdAt: schema.session.createdAt,
        expiresAt: schema.session.expiresAt,
        impersonatedBy: schema.session.impersonatedBy,
      })
      .from(schema.session)
      .where(eq(schema.session.userId, session.user.id))
      .orderBy(desc(schema.session.createdAt));

    return {
      sessions: rows.map((r) => ({
        id: r.id,
        token: r.token,
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        isCurrent: r.token === session.session.token,
        impersonatedBy: r.impersonatedBy,
      })),
    };
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "Failed to load sessions" };
  }
}

export async function revokeUserSession(sessionId: string) {
  try {
    const reqHeaders = await headers();
    const current = await auth.api.getSession({ headers: reqHeaders });
    if (!current) {
      return { error: "Unauthorized" };
    }

    const [row] = await db
      .select({
        id: schema.session.id,
        token: schema.session.token,
        userId: schema.session.userId,
      })
      .from(schema.session)
      .where(eq(schema.session.id, sessionId))
      .limit(1);

    if (!row) {
      return { error: "Session not found" };
    }
    if (row.userId !== current.user.id) {
      return { error: "Cannot revoke a session you do not own" };
    }
    if (row.token === current.session.token) {
      return {
        error:
          "Cannot revoke the session you are currently using — sign out instead",
      };
    }

    await db.delete(schema.session).where(eq(schema.session.id, sessionId));

    const reqCtx = extractRequestContext(reqHeaders);
    audit({
      action: "auth.session_revoked",
      category: "auth",
      actorType: "user",
      actorId: current.user.id,
      actorEmail: current.user.email,
      entityType: "session",
      entityId: sessionId,
      description: "Revoked an active session",
      metadata: { sessionId },
      ...reqCtx,
    });

    return { success: true as const };
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "Failed to revoke session" };
  }
}

export async function signOutAllOtherSessions() {
  try {
    const reqHeaders = await headers();
    const current = await auth.api.getSession({ headers: reqHeaders });
    if (!current) {
      return { error: "Unauthorized" };
    }

    // Delete every session for this user EXCEPT the one this request was
    // made with. Better Auth's `revokeOtherSessions` would also do this, but
    // we drop directly to the DB so we can audit the exact count.
    const others = await db
      .select({ id: schema.session.id, token: schema.session.token })
      .from(schema.session)
      .where(eq(schema.session.userId, current.user.id));
    const toRevoke = others
      .filter((s) => s.token !== current.session.token)
      .map((s) => s.id);

    if (toRevoke.length > 0) {
      await db
        .delete(schema.session)
        .where(inArray(schema.session.id, toRevoke));
    }

    const reqCtx = extractRequestContext(reqHeaders);
    audit({
      action: "auth.signout_all_others",
      category: "auth",
      actorType: "user",
      actorId: current.user.id,
      actorEmail: current.user.email,
      entityType: "user",
      entityId: current.user.id,
      description: `Signed out ${toRevoke.length} other session(s)`,
      metadata: { revokedCount: toRevoke.length },
      ...reqCtx,
    });

    return { success: true as const, data: { revokedCount: toRevoke.length } };
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "Failed to sign out other sessions" };
  }
}

// ---------------------------------------------------------------------------
// Data export — gathers every row tied to the user across the system into
// a single JSON object. The blob is returned to the client (no object-storage
// round-trip), which keeps the implementation simple while still meeting
// the GDPR "data portability" obligation. Audit-logged.
// ---------------------------------------------------------------------------

export async function requestDataExport(): Promise<
  | { error: string }
  | {
      success: true;
      data: { filename: string; export: Record<string, unknown> };
    }
> {
  try {
    const reqHeaders = await headers();
    const session = await auth.api.getSession({ headers: reqHeaders });
    if (!session) {
      return { error: "Unauthorized" };
    }

    const userId = session.user.id;

    // User profile row (the source of truth for marketing opt-in etc.)
    const [profile] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);

    // Memberships + space rows the user belongs to (any role).
    const memberships = await db
      .select({
        membership: schema.spaceMemberships,
        space: schema.spaces,
      })
      .from(schema.spaceMemberships)
      .innerJoin(
        schema.spaces,
        eq(schema.spaces.id, schema.spaceMemberships.spaceId)
      )
      .where(eq(schema.spaceMemberships.userId, userId));

    const spaceIds = memberships.map((m) => m.space.id);

    // Per-membership permissions + cube assignments.
    const permissions =
      memberships.length > 0
        ? await db
            .select()
            .from(schema.memberPermissions)
            .where(
              inArray(
                schema.memberPermissions.membershipId,
                memberships.map((m) => m.membership.id)
              )
            )
        : [];
    const cubeAssignments =
      memberships.length > 0
        ? await db
            .select()
            .from(schema.memberCubeAssignments)
            .where(
              inArray(
                schema.memberCubeAssignments.membershipId,
                memberships.map((m) => m.membership.id)
              )
            )
        : [];

    // Cubes in any space the user belongs to.
    const cubes =
      spaceIds.length > 0
        ? await db
            .select()
            .from(schema.cubes)
            .where(inArray(schema.cubes.spaceId, spaceIds))
        : [];

    // Billing events for those spaces — these are how the user can prove
    // their account history to a regulator if asked.
    const billingEvents =
      spaceIds.length > 0
        ? await db
            .select()
            .from(schema.billingEvents)
            .where(inArray(schema.billingEvents.spaceId, spaceIds))
            .orderBy(desc(schema.billingEvents.createdAt))
        : [];

    // Audit log entries where the user was the actor — narrow scope so
    // unrelated audit rows from other users are not exposed.
    const auditEvents = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.actorId, userId))
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(5000);

    const exportPayload = {
      exportedAt: new Date().toISOString(),
      schemaVersion: 1 as const,
      user: profile
        ? {
            id: profile.id,
            email: profile.email,
            name: profile.name,
            emailVerified: profile.emailVerified,
            createdAt: profile.createdAt.toISOString(),
            updatedAt: profile.updatedAt.toISOString(),
            marketingOptIn: profile.marketingOptIn,
          }
        : null,
      memberships: memberships.map((m) => ({
        spaceId: m.space.id,
        spaceName: m.space.name,
        isOwner: m.membership.isOwner,
        joinedAt: m.membership.createdAt.toISOString(),
        permissions: permissions
          .filter((p) => p.membershipId === m.membership.id)
          .map((p) => p.permission),
        cubeAssignments: cubeAssignments
          .filter((a) => a.membershipId === m.membership.id)
          .map((a) => a.cubeId),
      })),
      cubes: cubes.map((c) => ({
        id: c.id,
        name: c.name,
        spaceId: c.spaceId,
        status: c.status,
        vcpus: c.vcpus,
        ramMb: c.ramMb,
        diskLimitGb: c.diskLimitGb,
        imageId: c.imageId,
        createdAt: c.createdAt.toISOString(),
      })),
      billingEvents: billingEvents.map((e) => ({
        id: e.id,
        spaceId: e.spaceId,
        cubeId: e.cubeId,
        type: e.type,
        amount: e.amount,
        description: e.description,
        createdAt: e.createdAt.toISOString(),
      })),
      auditLog: auditEvents.map((a) => ({
        id: a.id,
        action: a.action,
        category: a.category,
        entityType: a.entityType,
        entityId: a.entityId,
        description: a.description,
        metadata: a.metadata,
        source: a.source,
        createdAt: a.createdAt.toISOString(),
      })),
    };

    const reqCtx = extractRequestContext(reqHeaders);
    audit({
      action: "profile.data_export",
      category: "auth",
      actorType: "user",
      actorId: userId,
      actorEmail: session.user.email,
      entityType: "user",
      entityId: userId,
      description: "Generated a personal-data export",
      metadata: {
        membershipCount: memberships.length,
        cubeCount: cubes.length,
        billingEventCount: billingEvents.length,
        auditEventCount: auditEvents.length,
      },
      ...reqCtx,
    });

    return {
      success: true as const,
      data: {
        filename: `krova-data-export-${session.user.email.replace(/[^a-z0-9]/gi, "_")}-${new Date().toISOString().slice(0, 10)}.json`,
        export: exportPayload,
      },
    };
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "Failed to generate data export" };
  }
}

// ---------------------------------------------------------------------------
// Account deletion — destructive, terminal. Eligibility check refuses the
// request if the user still owns any space; the customer must transfer
// ownership or delete the space first. The actual deletion cascades through
// the DB (sessions, accounts, memberships are all on `onDelete: "cascade"`
// against the user row). Audit-logged.
// ---------------------------------------------------------------------------

export interface AccountDeletionBlocker {
  reason: string;
  spaceId?: string;
  spaceName?: string;
}

export async function checkAccountDeletionEligibility(): Promise<
  { error: string } | { blockers: AccountDeletionBlocker[] }
> {
  try {
    const reqHeaders = await headers();
    const session = await auth.api.getSession({ headers: reqHeaders });
    if (!session) {
      return { error: "Unauthorized" };
    }

    const ownedSpaces = await db
      .select({ id: schema.spaces.id, name: schema.spaces.name })
      .from(schema.spaceMemberships)
      .innerJoin(
        schema.spaces,
        eq(schema.spaces.id, schema.spaceMemberships.spaceId)
      )
      .where(
        and(
          eq(schema.spaceMemberships.userId, session.user.id),
          eq(schema.spaceMemberships.isOwner, true)
        )
      );

    const blockers: AccountDeletionBlocker[] = ownedSpaces.map((s) => ({
      reason: `You own space "${s.name}". Transfer ownership or delete the space before closing your account.`,
      spaceId: s.id,
      spaceName: s.name,
    }));

    return { blockers };
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "Failed to check eligibility" };
  }
}

export async function requestAccountDeletion(confirmEmail: string) {
  try {
    const reqHeaders = await headers();
    const session = await auth.api.getSession({ headers: reqHeaders });
    if (!session) {
      return { error: "Unauthorized" };
    }

    if (
      typeof confirmEmail !== "string" ||
      confirmEmail.trim().toLowerCase() !== session.user.email.toLowerCase()
    ) {
      return {
        error: "Type your email exactly to confirm — the value did not match",
      };
    }

    // Re-check eligibility inside the action — the page may have loaded a
    // stale "no blockers" state.
    const eligibility = await checkAccountDeletionEligibility();
    if ("error" in eligibility) {
      return eligibility;
    }
    if (eligibility.blockers.length > 0) {
      return {
        error: `Cannot delete account — ${eligibility.blockers.length} blocker(s) remain. Refresh the page to see them.`,
      };
    }

    const userId = session.user.id;
    const userEmail = session.user.email;
    const userName = session.user.name;

    // Capture the request context for the audit row BEFORE the user row is
    // deleted — `extractRequestContext` does not need the DB so we can call
    // it first, but the audit must be flushed before the cascade or we lose
    // the actor_id FK reference.
    const reqCtx = extractRequestContext(reqHeaders);
    audit({
      action: "auth.account_deleted",
      category: "auth",
      actorType: "user",
      actorId: userId,
      actorEmail: userEmail,
      entityType: "user",
      entityId: userId,
      description: `Deleted account ${userEmail}`,
      metadata: { userId, userEmail, userName },
      ...reqCtx,
    });

    // Cascade-delete: sessions, accounts, memberships, audit actor_id
    // (already written above as plain text). User row removal fires the
    // FK ON DELETE CASCADE chain.
    await db.delete(schema.user).where(eq(schema.user.id, userId));

    // Best-effort session cookie clear — we are technically signed out by
    // the row removal, but the cookie still references the missing session.
    await clearSessionCache();

    return { success: true as const };
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return {
      error:
        "Something went wrong while deleting your account. Please try again.",
    };
  }
}

export async function changeEmailAction(newEmail: string) {
  try {
    const reqHeaders = await headers();
    const session = await auth.api.getSession({ headers: reqHeaders });
    if (!session) {
      return { error: "Unauthorized" };
    }

    const trimmed = validateEmail(newEmail);
    if (!trimmed) {
      return { error: "Invalid email address" };
    }

    if (trimmed === session.user.email.toLowerCase()) {
      return { error: "New email must be different from your current email" };
    }

    await auth.api.changeEmail({
      body: { newEmail: trimmed },
      headers: reqHeaders,
    });

    // Invalidate the session cookie cache so the UI reflects the change
    await clearSessionCache();

    const reqCtx = extractRequestContext(reqHeaders);
    audit({
      action: "profile.change_email",
      category: "auth",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "user",
      entityId: session.user.id,
      description: `Initiated email change to ${trimmed}`,
      metadata: { oldEmail: session.user.email, newEmail: trimmed },
      ...reqCtx,
    });

    return { success: true };
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return {
      error:
        "Something went wrong while changing your email. Please try again.",
    };
  }
}
