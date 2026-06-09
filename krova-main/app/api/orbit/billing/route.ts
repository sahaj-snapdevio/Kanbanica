import { countDistinct, inArray, ne, sum } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);

    const [creditsGranted] = await db
      .select({ total: sum(schema.billingEvents.amount) })
      .from(schema.billingEvents)
      .where(
        inArray(schema.billingEvents.type, ["credit_grant", "credit_topup"])
      );

    // Sum every debit type so the Orbit dashboard matches what the
    // customer-facing `getBillingSummary` reports. Previously this only
    // counted `hourly_charge` — missing prorated, backup-storage, the new
    // sleep-storage, and overage charges.
    const [creditsConsumed] = await db
      .select({ total: sum(schema.billingEvents.amount) })
      .from(schema.billingEvents)
      .where(
        inArray(schema.billingEvents.type, [
          "hourly_charge",
          "prorated_charge",
          "backup_storage_charge",
          "sleep_storage_charge",
          "overage_charge",
        ])
      );

    const [activeSpaces] = await db
      .select({ count: countDistinct(schema.cubes.spaceId) })
      .from(schema.cubes)
      .where(ne(schema.cubes.status, "deleted"));

    return Response.json({
      totalCreditsGranted: creditsGranted?.total ?? "0",
      totalCreditsConsumed: creditsConsumed?.total ?? "0",
      activeSpaceCount: activeSpaces?.count ?? 0,
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET /api/orbit/billing error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
