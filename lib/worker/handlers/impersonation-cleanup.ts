import { and, isNotNull, lt } from "drizzle-orm";
import { session } from "@/db/schema";
import { db } from "@/lib/db";

export async function handleImpersonationCleanup() {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
  await db
    .delete(session)
    .where(
      and(isNotNull(session.impersonatedBy), lt(session.createdAt, cutoff))
    );
}
