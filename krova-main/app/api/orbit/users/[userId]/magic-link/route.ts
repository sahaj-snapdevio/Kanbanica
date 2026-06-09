import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * POST /api/orbit/users/[userId]/magic-link
 *
 * Trigger Better Auth's magic-link sign-in flow on behalf of a user — the
 * customer-facing equivalent of "password reset" for our magic-link-only
 * auth stack. Useful when a customer can't access their inbox via the
 * normal signup page (e.g. corporate quarantine).
 *
 * Admin-only. Audit-logged. The actual email is sent by Better Auth's
 * `magicLink.sendMagicLink` callback we configured in lib/auth.ts.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const session = await requireAdmin(request);
    const { userId } = await params;

    const [target] = await db
      .select({
        id: schema.user.id,
        email: schema.user.email,
        banned: schema.user.banned,
        banExpires: schema.user.banExpires,
      })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);

    if (!target) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    if (target.banned) {
      const stillBanned =
        !target.banExpires || target.banExpires.getTime() > Date.now();
      if (stillBanned) {
        return Response.json(
          { error: "Cannot send magic link — user is banned" },
          { status: 400 }
        );
      }
    }

    // Better Auth's server-side helper. The configured `sendMagicLink`
    // callback handles the EmailIt enqueue.
    await auth.api.signInMagicLink({
      body: { email: target.email },
      headers: request.headers,
    });

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "auth.admin_sent_magic_link",
      category: "auth",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "user",
      entityId: userId,
      description: `Admin sent magic link to ${target.email}`,
      metadata: { userId, email: target.email },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST orbit magic-link error:", error);
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to send magic link",
      },
      { status: 500 }
    );
  }
}
