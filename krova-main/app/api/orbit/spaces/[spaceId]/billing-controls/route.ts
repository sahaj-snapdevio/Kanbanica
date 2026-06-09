import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

/**
 * POST /api/orbit/spaces/[spaceId]/billing-controls
 *
 * Operator-facing per-space billing controls. One endpoint, two actions:
 *
 * - { action: "reset_overage" } — clear `this_period_overage_usd` back to
 *   0. Use to wipe an in-progress overage count when an operator has
 *   manually voided every overage_charge for the period.
 *
 * - { action: "bill_now" } — enqueue a `billing.hourly` job for this
 *   space immediately rather than waiting for the next cron tick. The
 *   worker handler is the same one the cron drives, so the result is
 *   identical to a normal hourly bill.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    const session = await requireAdmin(request);
    const { spaceId } = await params;
    const body = await request.json().catch(() => ({}));
    const action = body?.action as string | undefined;

    if (action !== "reset_overage" && action !== "bill_now") {
      return Response.json(
        { error: "action must be 'reset_overage' or 'bill_now'" },
        { status: 400 }
      );
    }

    const [space] = await db
      .select()
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId))
      .limit(1);
    if (!space) {
      return Response.json({ error: "Space not found" }, { status: 404 });
    }

    const reqCtx = extractRequestContext(request.headers);

    if (action === "reset_overage") {
      const prior = Number.parseFloat(space.thisPeriodOverageUsd);
      await db
        .update(schema.spaces)
        .set({
          thisPeriodOverageUsd: "0",
          updatedAt: new Date(),
        })
        .where(eq(schema.spaces.id, spaceId));

      audit({
        action: "billing.overage_counter_reset",
        category: "billing",
        actorType: "admin",
        actorId: session.user.id,
        actorEmail: session.user.email,
        entityType: "space",
        entityId: spaceId,
        spaceId,
        description: `Reset overage counter for space "${space.name}" — was $${prior.toFixed(4)}`,
        metadata: { spaceId, priorAmount: prior },
        source: "api",
        ...reqCtx,
      });

      return Response.json({
        success: true,
        message: `Overage counter reset (was $${prior.toFixed(4)})`,
        priorAmount: prior,
      });
    }

    if (action === "bill_now") {
      // Enqueue the same hourly billing job the cron runs. The worker is
      // idempotent: it computes the prorated/full-hour amounts from the
      // cube `last_billed_at` timestamps so calling it ahead of schedule
      // is safe — the next cron tick simply finds nothing to bill until
      // the next hour boundary.
      await enqueueJob(JOB_NAMES.BILLING_HOURLY, { spaceId });

      audit({
        action: "billing.manual_bill_triggered",
        category: "billing",
        actorType: "admin",
        actorId: session.user.id,
        actorEmail: session.user.email,
        entityType: "space",
        entityId: spaceId,
        spaceId,
        description: `Admin triggered an immediate billing run for "${space.name}"`,
        metadata: { spaceId },
        source: "api",
        ...reqCtx,
      });

      return Response.json({
        success: true,
        message:
          "Billing job enqueued — check the billing events in a few seconds",
      });
    }

    return Response.json({ error: "Unhandled action" }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST billing-controls error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
