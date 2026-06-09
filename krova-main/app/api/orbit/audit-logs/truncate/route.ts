import { and, count, gte, inArray, lte } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { applyRateLimit, RATE_LIMIT_MUTATION } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const limited = applyRateLimit(request, RATE_LIMIT_MUTATION);
  if (limited) {
    return limited;
  }

  try {
    const session = await requireAdmin(request);

    const body = await request.json();
    const { from, to } = body as { from?: string; to?: string };

    if (!from && !to) {
      return Response.json(
        { error: "At least one of 'from' or 'to' date is required" },
        { status: 400 }
      );
    }

    // Validate dates
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;

    if (from && isNaN(fromDate!.getTime())) {
      return Response.json(
        { error: "Invalid 'from' date format. Use ISO 8601." },
        { status: 400 }
      );
    }
    if (to && isNaN(toDate!.getTime())) {
      return Response.json(
        { error: "Invalid 'to' date format. Use ISO 8601." },
        { status: 400 }
      );
    }

    const conditions = [];
    if (fromDate) {
      conditions.push(gte(schema.auditLogs.createdAt, fromDate));
    }
    if (toDate) {
      conditions.push(lte(schema.auditLogs.createdAt, toDate));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Count before deleting so we can report it
    const [countResult] = await db
      .select({ count: count(schema.auditLogs.id) })
      .from(schema.auditLogs)
      .where(where);

    const totalToDelete = Number(countResult?.count ?? 0);

    if (totalToDelete === 0) {
      return Response.json({
        message: "No audit logs found in the specified range",
        deleted: 0,
      });
    }

    // Delete in batches to avoid long-running transactions on large datasets
    const BATCH_SIZE = 10_000;
    let totalDeleted = 0;

    while (totalDeleted < totalToDelete) {
      const batch = await db
        .select({ id: schema.auditLogs.id })
        .from(schema.auditLogs)
        .where(where)
        .limit(BATCH_SIZE);

      if (batch.length === 0) {
        break;
      }

      await db.delete(schema.auditLogs).where(
        inArray(
          schema.auditLogs.id,
          batch.map((r) => r.id)
        )
      );

      totalDeleted += batch.length;
      if (batch.length < BATCH_SIZE) {
        break;
      }
    }

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "audit_log.truncate",
      category: "platform",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "audit_log",
      description: `Truncated ${totalDeleted} audit logs from ${from ?? "beginning"} to ${to ?? "now"}`,
      metadata: { from, to, deletedCount: totalDeleted },
      source: "api",
      ...reqCtx,
    });

    return Response.json({
      message: `Successfully truncated ${totalDeleted} audit log entries`,
      deleted: totalDeleted,
      range: { from: from ?? null, to: to ?? null },
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST /api/orbit/audit-logs/truncate error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
