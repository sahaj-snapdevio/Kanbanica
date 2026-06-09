import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import type { NextRequest } from "next/server";
import * as schema from "@/db/schema";
import { requirePermission, requireSpaceMember } from "@/lib/api/auth-helpers";
import { getBillingSummary, getSpaceBurnRate } from "@/lib/billing";
import { getCreditRates, getCreditRateTiers } from "@/lib/cost";
import { db } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    const { spaceId } = await params;
    const { membership } = await requireSpaceMember(request, spaceId);
    await requirePermission(membership, "billing.view");

    const url = new URL(request.url);
    const rawPage = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
    const page = Math.max(1, Math.min(10_000, isNaN(rawPage) ? 1 : rawPage));
    const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
    const limit = Math.min(100, Math.max(1, isNaN(rawLimit) ? 50 : rawLimit));
    const typeFilter = url.searchParams.get("type");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    // Fetch space balance
    const [space] = await db
      .select({
        creditBalance: schema.spaces.creditBalance,
        createdAt: schema.spaces.createdAt,
      })
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId));

    if (!space) {
      return Response.json({ error: "Space not found" }, { status: 404 });
    }

    // Use shared billing helpers
    const [rates, tiers] = await Promise.all([
      getCreditRates(),
      getCreditRateTiers(),
    ]);
    const { vcpuRate, ramRate, diskRate } = rates;

    const summary = await getBillingSummary(spaceId);
    const usage = await getSpaceBurnRate(
      spaceId,
      { vcpuRate, ramRate, diskRate },
      tiers
    );

    // Build billing events query with filters
    const VALID_BILLING_TYPES = [
      "hourly_charge",
      "prorated_charge",
      "credit_grant",
      "credit_topup",
      "backup_storage_charge",
      "sleep_storage_charge",
      "credit_refund",
      "plan_credit",
      "overage_charge",
    ] as const;
    type BillingEventType = (typeof VALID_BILLING_TYPES)[number];
    const conditions = [eq(schema.billingEvents.spaceId, spaceId)];
    if (
      typeFilter &&
      (VALID_BILLING_TYPES as readonly string[]).includes(typeFilter)
    ) {
      conditions.push(
        eq(schema.billingEvents.type, typeFilter as BillingEventType)
      );
    }
    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) {
        conditions.push(gte(schema.billingEvents.createdAt, fromDate));
      }
    }
    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) {
        conditions.push(lte(schema.billingEvents.createdAt, toDate));
      }
    }

    const whereClause = and(...conditions);

    // Count total events for pagination
    const [countResult] = await db
      .select({ count: count(schema.billingEvents.id) })
      .from(schema.billingEvents)
      .where(whereClause);

    const totalEvents = Number(countResult?.count ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalEvents / limit));
    const offset = (page - 1) * limit;

    // Fetch billing events with cube names
    const events = await db
      .select({
        id: schema.billingEvents.id,
        cubeId: schema.billingEvents.cubeId,
        amount: schema.billingEvents.amount,
        type: schema.billingEvents.type,
        description: schema.billingEvents.description,
        createdAt: schema.billingEvents.createdAt,
        cubeName: schema.cubes.name,
      })
      .from(schema.billingEvents)
      .leftJoin(schema.cubes, eq(schema.billingEvents.cubeId, schema.cubes.id))
      .where(whereClause)
      .orderBy(desc(schema.billingEvents.createdAt))
      .limit(limit)
      .offset(offset);

    return Response.json({
      creditBalance: Number.parseFloat(space.creditBalance),
      spaceCreatedAt: space.createdAt.toISOString(),
      summary,
      usage: {
        ...usage,
        estimatedDailyBurn: usage.hourlyBurn * 24,
        estimatedMonthlyBurn: usage.hourlyBurn * 24 * 30,
      },
      rates: { vcpuRate, ramRate, diskRate },
      events: events.map((e) => ({
        id: e.id,
        cubeId: e.cubeId,
        cubeName: e.cubeName ?? null,
        amount: Number.parseFloat(e.amount),
        type: e.type,
        description: e.description,
        createdAt: e.createdAt.toISOString(),
      })),
      pagination: { page, limit, totalEvents, totalPages },
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
