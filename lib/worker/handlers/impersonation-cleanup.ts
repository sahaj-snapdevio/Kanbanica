import { db } from "@/lib/db";
import { session } from "@/db/schema";
import { and, lt, isNotNull } from "drizzle-orm";

export async function handleImpersonationCleanup() {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
  await db
    .delete(session)
    .where(
      and(
        isNotNull(session.impersonatedBy),
        lt(session.createdAt, cutoff),
      )
    );
}
