import { audit, extractRequestContext } from "@/lib/audit";
import { auth } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const currentSession = await auth.api.getSession({
      headers: request.headers,
    });

    if (!currentSession) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sessionWithImpersonation = currentSession.session as {
      impersonatedBy?: string;
    };
    const adminUserId = sessionWithImpersonation.impersonatedBy;

    if (!adminUserId) {
      return Response.json(
        { error: "Not currently impersonating" },
        { status: 400 }
      );
    }

    const reqCtx = extractRequestContext(request.headers);

    const authResponse = await auth.api.stopImpersonating({
      headers: request.headers,
      asResponse: true,
    });

    if (!authResponse.ok) {
      return authResponse;
    }

    audit({
      action: "admin.impersonate_stop",
      category: "auth",
      actorType: "admin",
      actorId: adminUserId,
      entityType: "user",
      entityId: currentSession.user.id,
      description: `Admin stopped impersonating "${currentSession.user.email}"`,
      metadata: {
        targetUserId: currentSession.user.id,
        targetEmail: currentSession.user.email,
      },
      source: "api",
      ...reqCtx,
    });

    return authResponse;
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST /api/orbit/stop-impersonating error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
