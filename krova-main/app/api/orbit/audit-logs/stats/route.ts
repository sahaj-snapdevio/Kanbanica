import { and, count, desc, gte, isNotNull, lte } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);

    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    const conditions = [];
    if (from) {
      const fromDate = new Date(from);
      if (isNaN(fromDate.getTime())) {
        return Response.json({ error: "Invalid 'from' date" }, { status: 400 });
      }
      conditions.push(gte(schema.auditLogs.createdAt, fromDate));
    }
    if (to) {
      const toDate = new Date(to);
      if (isNaN(toDate.getTime())) {
        return Response.json({ error: "Invalid 'to' date" }, { status: 400 });
      }
      conditions.push(lte(schema.auditLogs.createdAt, toDate));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const countCol = count(schema.auditLogs.id);

    // Run all analytics queries in parallel
    const [
      totalCount,
      byCategory,
      byAction,
      byActorType,
      bySource,
      topActors,
      topSpaces,
    ] = await Promise.all([
      // Total count
      db.select({ count: countCol }).from(schema.auditLogs).where(where),

      // Breakdown by category
      db
        .select({
          category: schema.auditLogs.category,
          count: countCol,
        })
        .from(schema.auditLogs)
        .where(where)
        .groupBy(schema.auditLogs.category)
        .orderBy(desc(countCol)),

      // Top 20 actions
      db
        .select({
          action: schema.auditLogs.action,
          count: countCol,
        })
        .from(schema.auditLogs)
        .where(where)
        .groupBy(schema.auditLogs.action)
        .orderBy(desc(countCol))
        .limit(20),

      // Breakdown by actor type
      db
        .select({
          actorType: schema.auditLogs.actorType,
          count: countCol,
        })
        .from(schema.auditLogs)
        .where(where)
        .groupBy(schema.auditLogs.actorType)
        .orderBy(desc(countCol)),

      // Breakdown by source
      db
        .select({
          source: schema.auditLogs.source,
          count: countCol,
        })
        .from(schema.auditLogs)
        .where(where)
        .groupBy(schema.auditLogs.source)
        .orderBy(desc(countCol)),

      // Top 10 most active users
      db
        .select({
          actorId: schema.auditLogs.actorId,
          actorEmail: schema.auditLogs.actorEmail,
          count: countCol,
        })
        .from(schema.auditLogs)
        .where(
          and(...(where ? [where] : []), isNotNull(schema.auditLogs.actorId))
        )
        .groupBy(schema.auditLogs.actorId, schema.auditLogs.actorEmail)
        .orderBy(desc(countCol))
        .limit(10),

      // Top 10 most active spaces
      db
        .select({
          spaceId: schema.auditLogs.spaceId,
          count: countCol,
        })
        .from(schema.auditLogs)
        .where(
          and(...(where ? [where] : []), isNotNull(schema.auditLogs.spaceId))
        )
        .groupBy(schema.auditLogs.spaceId)
        .orderBy(desc(countCol))
        .limit(10),
    ]);

    return Response.json({
      total: Number(totalCount[0]?.count ?? 0),
      byCategory: byCategory.map((r) => ({
        category: r.category,
        count: Number(r.count),
      })),
      byAction: byAction.map((r) => ({
        action: r.action,
        count: Number(r.count),
      })),
      byActorType: byActorType.map((r) => ({
        actorType: r.actorType,
        count: Number(r.count),
      })),
      bySource: bySource.map((r) => ({
        source: r.source,
        count: Number(r.count),
      })),
      topActors: topActors.map((r) => ({
        actorId: r.actorId,
        actorEmail: r.actorEmail,
        count: Number(r.count),
      })),
      topSpaces: topSpaces.map((r) => ({
        spaceId: r.spaceId,
        count: Number(r.count),
      })),
      range: { from: from ?? null, to: to ?? null },
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET /api/orbit/audit-logs/stats error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
