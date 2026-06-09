/**
 * Syncs Krova users into the EmailIt marketing audience as contacts.
 *
 * A user maps to one EmailIt contact (workspace-level). Custom fields are
 * recomputed from the database on every sync so EmailIt automations can
 * segment on up-to-date account state. The contact joins
 * `EMAILIT_AUDIENCE_ID` on first creation (audience membership cannot be
 * changed on update — see lib/emailit/contacts.ts).
 *
 * Single source of truth for contact sync — used by the `emailit.sync-contact`
 * worker job (fired from cube / billing / membership / auth code paths via
 * `lib/emailit/enqueue-sync.ts`) and the `pnpm sync:emailit` CLI for the
 * one-shot bulk backfill.
 */

import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { cubes, session, spaceMemberships, spaces, user } from "@/db/schema";
import { db } from "@/lib/db";
import {
  createEmailitContact,
  getEmailitContact,
  updateEmailitContact,
} from "@/lib/emailit/contacts";
import { env } from "@/lib/env";
import { sleep } from "@/lib/utils";

/** Throttle between contacts during a bulk sweep — stays well under EmailIt rate limits. */
const BULK_SYNC_DELAY_MS = 250;

/** Splits a single display name into first / last for EmailIt's contact shape. */
function splitName(name: string): { firstName?: string; lastName?: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return {};
  }
  return {
    firstName: parts[0],
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : undefined,
  };
}

/**
 * Builds the EmailIt `custom_fields` payload for a user from current DB state.
 * Every value is a plain scalar so EmailIt automations can segment on it.
 */
async function buildCustomFields(
  u: {
    createdAt: Date;
    emailVerified: boolean;
    role: string | null;
  },
  userId: string
): Promise<Record<string, unknown>> {
  // Spaces the user belongs to (with per-space credit balance + ownership).
  const memberships = await db
    .select({
      spaceId: spaceMemberships.spaceId,
      isOwner: spaceMemberships.isOwner,
      creditBalance: spaces.creditBalance,
    })
    .from(spaceMemberships)
    .innerJoin(spaces, eq(spaceMemberships.spaceId, spaces.id))
    .where(eq(spaceMemberships.userId, userId));

  const ownedSpaceCount = memberships.filter((m) => m.isOwner).length;
  const isTeamMember = memberships.some((m) => !m.isOwner);
  // Credit balance is per-space; report the sum across spaces the user owns.
  const creditBalance = memberships
    .filter((m) => m.isOwner)
    .reduce((sum, m) => sum + Number(m.creditBalance), 0);

  // Runtime cubes across every space the user can access.
  const spaceIds = memberships.map((m) => m.spaceId);
  let cubeCount = 0;
  let runningCubeCount = 0;
  if (spaceIds.length > 0) {
    const cubeRows = await db
      .select({ status: cubes.status })
      .from(cubes)
      .where(
        and(inArray(cubes.spaceId, spaceIds), ne(cubes.status, "deleted"))
      );
    cubeCount = cubeRows.length;
    runningCubeCount = cubeRows.filter((c) => c.status === "running").length;
  }

  // Most recent session start — a churn / win-back signal.
  const [lastSession] = await db
    .select({ createdAt: session.createdAt })
    .from(session)
    .where(eq(session.userId, userId))
    .orderBy(desc(session.createdAt))
    .limit(1);

  const lifecycleStage =
    runningCubeCount > 0 ? "active" : cubeCount > 0 ? "activated" : "signed_up";

  return {
    signup_date: u.createdAt.toISOString().slice(0, 10),
    email_verified: u.emailVerified,
    account_role: u.role ?? "user",
    lifecycle_stage: lifecycleStage,
    space_count: memberships.length,
    owned_space_count: ownedSpaceCount,
    is_team_member: isTeamMember,
    cube_count: cubeCount,
    running_cube_count: runningCubeCount,
    credit_balance: Math.round(creditBalance * 100) / 100,
    last_active_at: lastSession
      ? lastSession.createdAt.toISOString().slice(0, 10)
      : null,
  };
}

/**
 * Syncs a single user to EmailIt: upserts the contact, refreshes custom
 * fields, mirrors the marketing opt-in onto `unsubscribed`, and records
 * `emailitContactId` / `emailitSyncedAt` on the user row.
 *
 * Throws if `EMAILIT_AUDIENCE_ID` is not configured — callers that run on
 * a schedule should guard with `isContactSyncConfigured()` first.
 */
export async function syncUserToEmailit(userId: string): Promise<void> {
  const audienceId = env.EMAILIT_AUDIENCE_ID;
  if (!audienceId) {
    throw new Error(
      "EMAILIT_AUDIENCE_ID is not configured — contact sync is disabled"
    );
  }

  const [u] = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      role: user.role,
      banned: user.banned,
      marketingOptIn: user.marketingOptIn,
      emailitContactId: user.emailitContactId,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!u) {
    throw new Error(`user ${userId} not found`);
  }

  const customFields = await buildCustomFields(u, u.id);
  const { firstName, lastName } = splitName(u.name);
  // Banned users are unsubscribed regardless of their opt-in preference.
  const unsubscribed = !u.marketingOptIn || u.banned === true;

  let contactId = u.emailitContactId;

  if (contactId) {
    await updateEmailitContact(contactId, {
      firstName,
      lastName,
      customFields,
      unsubscribed,
    });
  } else {
    // No stored id — the contact may still exist (manual entry, prior
    // partial sync). Look it up by email before creating.
    const existing = await getEmailitContact(u.email);
    if (existing) {
      contactId = existing.id;
      await updateEmailitContact(contactId, {
        firstName,
        lastName,
        customFields,
        unsubscribed,
      });
    } else {
      const created = await createEmailitContact({
        email: u.email,
        firstName,
        lastName,
        customFields,
        unsubscribed,
        audiences: [audienceId],
      });
      contactId = created.id;
    }
  }

  await db
    .update(user)
    .set({ emailitContactId: contactId, emailitSyncedAt: new Date() })
    .where(eq(user.id, u.id));
}

/** True when contact sync is configured (an audience id is set). */
export function isContactSyncConfigured(): boolean {
  return Boolean(env.EMAILIT_AUDIENCE_ID);
}

export interface SyncAllResult {
  errors: { email: string; error: string }[];
  failed: number;
  synced: number;
  total: number;
}

/**
 * Syncs every user to EmailIt, sequentially and throttled. One user's
 * failure is recorded and the sweep continues. Shared by the daily cron
 * and the `pnpm sync:emailit` CLI.
 */
export async function syncAllUsers(
  onProgress?: (done: number, total: number, email: string) => void
): Promise<SyncAllResult> {
  const users = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .orderBy(user.createdAt);

  const result: SyncAllResult = {
    total: users.length,
    synced: 0,
    failed: 0,
    errors: [],
  };

  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    try {
      await syncUserToEmailit(u.id);
      result.synced++;
    } catch (err) {
      result.failed++;
      result.errors.push({
        email: u.email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    onProgress?.(i + 1, users.length, u.email);
    if (i < users.length - 1) {
      await sleep(BULK_SYNC_DELAY_MS);
    }
  }

  return result;
}
