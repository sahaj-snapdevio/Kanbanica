import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { audit } from "@/lib/audit";
import { auth } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminSession = await getAdminSession();
  if (!adminSession) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const impersonationSession = await auth.api.impersonateUser({
      body: { userId: id },
      headers: await headers(),
    });

    await audit({
      action: "impersonation_started",
      actorId: adminSession.user.id,
      actorEmail: adminSession.user.email,
      entityType: "user",
      entityId: id,
      description: `Admin started impersonation of user ${id}`,
    });

    return NextResponse.json({ url: "/", session: impersonationSession });
  } catch {
    return NextResponse.json(
      { error: "Failed to impersonate user" },
      { status: 500 }
    );
  }
}
