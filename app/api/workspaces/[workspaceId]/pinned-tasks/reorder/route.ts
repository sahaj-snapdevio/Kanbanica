import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getWorkspaceMembership } from "@/lib/permissions";
import { reorderPinnedTasks } from "@/server/pinned-task";

// PATCH /api/workspaces/:workspaceId/pinned-tasks/reorder
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { workspaceId } = await params;
  const membership = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.orderedIds)) {
    return NextResponse.json(
      { error: "orderedIds array required" },
      { status: 400 }
    );
  }

  const result = await reorderPinnedTasks(
    session.user.id,
    workspaceId,
    body.orderedIds
  );
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
