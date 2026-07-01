import { type NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { list, space } from "@/db/schema";
import { requireSpacePermission } from "@/lib/permissions";
import { reorderListPins } from "@/server/list-pin";
import { refreshWorkspace } from "@/lib/realtime/refresh";

// PATCH /api/lists/:listId/pinned-tasks/reorder
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ listId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { listId } = await params;
  const [l] = await db
    .select({ workspaceId: space.workspaceId, spaceId: list.spaceId })
    .from(list)
    .innerJoin(space, eq(list.spaceId, space.id))
    .where(eq(list.id, listId))
    .limit(1);

  if (!l) return NextResponse.json({ error: "List not found" }, { status: 404 });

  const permErr = await requireSpacePermission(session.user.id, l.workspaceId, l.spaceId, "full_access");
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.orderedIds)) {
    return NextResponse.json({ error: "orderedIds array required" }, { status: 400 });
  }

  const result = await reorderListPins(listId, body.orderedIds);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 500 });

  await refreshWorkspace(l.workspaceId);
  return NextResponse.json({ ok: true });
}
