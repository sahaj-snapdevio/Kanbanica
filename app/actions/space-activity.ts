"use server";

import { headers } from "next/headers";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { activityLog, task, list, user } from "@/db/schema";
import { canAccessSpace } from "@/lib/permissions";
import { subDays } from "date-fns";

export interface SpaceActivityEntry {
  id: string;
  taskId: string;
  taskTitle: string;
  taskSeq: number;
  listId: string;
  listName: string;
  eventType: string;
  meta: unknown;
  createdAt: Date;
  actorName: string | null;
  actorEmail: string | null;
  actorImage: string | null;
}

export async function getSpaceActivity(
  workspaceId: string,
  spaceId: string,
  page = 1,
): Promise<{ entries: SpaceActivityEntry[]; total: number } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const accessible = await canAccessSpace(session.user.id, workspaceId, spaceId);
  if (!accessible) return { error: "Unauthorized" };

  const since = subDays(new Date(), 30);
  const PAGE_SIZE = 50;
  const offset = (page - 1) * PAGE_SIZE;

  const rows = await db
    .select({
      id: activityLog.id,
      taskId: activityLog.taskId,
      taskTitle: task.title,
      taskSeq: task.seqNumber,
      listId: list.id,
      listName: list.name,
      eventType: activityLog.eventType,
      meta: activityLog.meta,
      createdAt: activityLog.createdAt,
      actorName: user.name,
      actorEmail: user.email,
      actorImage: user.image,
    })
    .from(activityLog)
    .innerJoin(task, eq(activityLog.taskId, task.id))
    .innerJoin(list, eq(task.listId, list.id))
    .leftJoin(user, eq(activityLog.userId, user.id))
    .where(
      and(
        eq(list.spaceId, spaceId),
        eq(list.isArchived, false),
        gte(activityLog.createdAt, since),
      ),
    )
    .orderBy(desc(activityLog.createdAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  return {
    entries: rows.map((r) => ({
      ...r,
      taskTitle: r.taskTitle,
      taskSeq: r.taskSeq,
    })),
    total: rows.length, // approximate — good enough for MVP pagination
  };
}
