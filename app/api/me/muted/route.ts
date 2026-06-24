import { createId } from "@paralleldrive/cuid2";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { mutedEntity } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { entityType, entityId } = body;

  if (!entityType || !entityId) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  if (!["TASK", "SPACE"].includes(entityType)) {
    return NextResponse.json({ error: "Invalid entityType" }, { status: 400 });
  }

  await db
    .insert(mutedEntity)
    .values({
      id: createId(),
      userId: session.user.id,
      entityType: entityType as "TASK" | "SPACE",
      entityId,
      createdAt: new Date(),
    })
    .onConflictDoNothing();

  return NextResponse.json({ ok: true }, { status: 201 });
}
