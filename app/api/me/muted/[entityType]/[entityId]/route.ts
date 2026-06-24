import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { mutedEntity } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ entityType: string; entityId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { entityType, entityId } = await params;

  await db
    .delete(mutedEntity)
    .where(
      and(
        eq(mutedEntity.userId, session.user.id),
        eq(mutedEntity.entityId, entityId),
        eq(mutedEntity.entityType, entityType as "TASK" | "SPACE")
      )
    );

  return NextResponse.json({ ok: true });
}
