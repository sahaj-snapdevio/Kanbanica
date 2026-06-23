import { type NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getWorkspaceMembership } from "@/lib/permissions";
import { getPinnedTasks } from "@/server/pinned-task";

// GET /api/workspaces/:workspaceId/pinned-tasks
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workspaceId } = await params;
  const membership = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const result = await getPinnedTasks(session.user.id, workspaceId);
  return NextResponse.json(result);
}
