import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { reconcileSpaceSubscription } from "@/lib/billing/reconcile-subscription";

/** POST — force a Polar subscription reconcile for one space (admin only). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    const session = await requireAdmin(request);
    const { spaceId } = await params;

    const outcome = await reconcileSpaceSubscription(spaceId);

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "billing.subscription_resync",
      category: "billing",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: "Admin resynced subscription from the provider",
      metadata: { spaceId, outcome: outcome.result },
      source: "api",
      ...reqCtx,
    });
    return Response.json({ ok: true, outcome });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("[orbit resync-subscription] failed:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
