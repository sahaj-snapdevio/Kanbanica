import { and, count, eq, inArray, ne } from "drizzle-orm";
import type { Job } from "pg-boss";
import {
  cubes,
  lifecycleLogs,
  spaceMemberships,
  spaces,
  user,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { notifyAdminsOfSpaceDeletion } from "@/lib/email/notify-deletion";
import { enqueueEmailitSync } from "@/lib/emailit/enqueue-sync";
import { enqueueJob } from "@/lib/worker/enqueue";
import type {
  SpaceDeletePayload,
  SpaceDeletionSummaryPayload,
} from "@/lib/worker/job-types";
import { JOB_NAMES } from "@/lib/worker/job-types";

// Re-check budget before force-deleting the space anyway. 20 attempts × 30s
// ≈ 10 min — comfortably longer than a normal cube.delete, but bounded so a
// single stuck cube cannot wedge the job forever.
const MAX_ATTEMPTS = 20;
const RECHECK_DELAY_SECONDS = 30;

async function handleSpaceDeleteJob(
  job: Job<SpaceDeletePayload>
): Promise<void> {
  const { spaceId } = job.data;
  const attempt = job.data.attempt ?? 1;

  const [space] = await db
    .select()
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);
  if (!space) {
    console.log(`[space-delete] space ${spaceId} already gone, skipping`);
    return;
  }

  // Wait until every cube has finished deleting. cube.delete sets
  // status='deleted' but keeps the row; deleting the space row now would
  // cascade-remove cube rows and make an in-flight cube.delete job no-op —
  // leaking the Firecracker VM + host disk and skipping the server resource
  // decrement.
  const [pending] = await db
    .select({ value: count() })
    .from(cubes)
    .where(and(eq(cubes.spaceId, spaceId), ne(cubes.status, "deleted")));
  const pendingCubes = pending?.value ?? 0;

  if (pendingCubes > 0 && attempt < MAX_ATTEMPTS) {
    console.log(
      `[space-delete] space ${spaceId}: ${pendingCubes} cube(s) still deleting — re-checking in ${RECHECK_DELAY_SECONDS}s (attempt ${attempt}/${MAX_ATTEMPTS})`
    );
    await enqueueJob(
      JOB_NAMES.SPACE_DELETE,
      { spaceId, attempt: attempt + 1 },
      { startAfter: RECHECK_DELAY_SECONDS }
    );
    return;
  }

  if (pendingCubes > 0) {
    console.warn(
      `[space-delete] space ${spaceId}: ${pendingCubes} cube(s) still not deleted after ${MAX_ATTEMPTS} attempts — force-deleting space anyway`
    );
  }

  // Delete the space row. The FK cascade removes cubes, memberships, snapshot
  // and backup rows. Member users left with no other space are hard-deleted
  // too — the same cascade the customer-side deleteSpace performs. The
  // orphan emails + contact ids are captured pre-delete so we can fan out
  // EmailIt-contact cleanup jobs and ship them to the admin notification.
  const orphanUsersDeleted: {
    userId: string;
    email: string;
    contactId: string | null;
  }[] = [];
  // Surviving members of the deleted space — those who still hold a membership
  // elsewhere. Their `space_count` / `is_team_member` just changed, so we
  // enqueue an EmailIt sync for each one after the transaction commits.
  const survivingUserIds: string[] = [];

  await db.transaction(async (tx) => {
    const members = await tx
      .select({ userId: spaceMemberships.userId })
      .from(spaceMemberships)
      .where(eq(spaceMemberships.spaceId, spaceId));
    const memberUserIds = members.map((m) => m.userId);

    if (memberUserIds.length > 0) {
      const elsewhere = await tx
        .select({ userId: spaceMemberships.userId })
        .from(spaceMemberships)
        .where(
          and(
            inArray(spaceMemberships.userId, memberUserIds),
            ne(spaceMemberships.spaceId, spaceId)
          )
        );
      const keep = new Set(elsewhere.map((u) => u.userId));
      survivingUserIds.push(...memberUserIds.filter((id) => keep.has(id)));
      const orphanUserIds = memberUserIds.filter((id) => !keep.has(id));
      if (orphanUserIds.length > 0) {
        const orphanRows = await tx
          .select({
            id: user.id,
            email: user.email,
            emailitContactId: user.emailitContactId,
          })
          .from(user)
          .where(inArray(user.id, orphanUserIds));
        for (const o of orphanRows) {
          orphanUsersDeleted.push({
            userId: o.id,
            email: o.email,
            contactId: o.emailitContactId,
          });
        }
        await tx.delete(user).where(inArray(user.id, orphanUserIds));
      }
    }

    await tx.insert(lifecycleLogs).values({
      entityType: "space",
      entityId: spaceId,
      message: "Space deleted (admin force-delete)",
    });

    await tx.delete(spaces).where(eq(spaces.id, spaceId));
  });

  // Fan out EmailIt cleanup for every orphan account just hard-deleted.
  // Job-level retries cover transient EmailIt API hiccups; missing contacts
  // (404) are treated as success by the handler.
  for (const orphan of orphanUsersDeleted) {
    try {
      await enqueueJob(JOB_NAMES.EMAILIT_DELETE_CONTACT, {
        contactId: orphan.contactId,
        email: orphan.email,
      });
    } catch (err) {
      console.error(
        `[space-delete] failed to enqueue EmailIt cleanup for ${orphan.email}:`,
        err
      );
    }
  }

  // Refresh surviving members' contact fields (space_count / is_team_member).
  for (const userId of survivingUserIds) {
    await enqueueEmailitSync(userId);
  }

  audit({
    action: "space.delete",
    category: "space",
    actorType: "system",
    entityType: "space",
    entityId: spaceId,
    spaceId,
    description: `Space "${space.name}" force-deleted (admin)`,
    metadata: {
      spaceId,
      spaceName: space.name,
      orphanUsersDeleted: orphanUsersDeleted.length,
    },
    source: "worker",
  });

  // Ship the admin deletion-summary email. The summary was captured by the
  // Orbit endpoint pre-delete; the worker augments it with orphan emails.
  const summary: SpaceDeletionSummaryPayload | undefined = job.data.summary;
  if (summary) {
    try {
      await notifyAdminsOfSpaceDeletion({
        ...summary,
        createdAt: new Date(summary.createdAt),
        orphanUsersDeleted: orphanUsersDeleted.map((o) => o.email),
      });
    } catch (err) {
      console.error(
        `[space-delete] failed to send admin notification for space ${spaceId}:`,
        err
      );
    }
  }

  console.log(`[space-delete] completed for space ${spaceId}`);
}

export async function handleSpaceDelete(
  jobs: Job<SpaceDeletePayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleSpaceDeleteJob(job);
  }
}
