import { and, count, desc, eq, gte, ilike, lte } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);

    const url = new URL(request.url);
    const { page, limit, offset } = parsePagination(url, { maxPageSize: 200 });

    // Filters
    const action = url.searchParams.get("action");
    const category = url.searchParams.get("category");
    const actorId = url.searchParams.get("actorId");
    const actorType = url.searchParams.get("actorType");
    const actorEmail = url.searchParams.get("actorEmail");
    const entityType = url.searchParams.get("entityType");
    const entityId = url.searchParams.get("entityId");
    const spaceId = url.searchParams.get("spaceId");
    const source = url.searchParams.get("source");
    const from = url.searchParams.get("from"); // ISO date string
    const to = url.searchParams.get("to"); // ISO date string
    const search = url.searchParams.get("search"); // free-text search in description

    const conditions = [];

    if (action) {
      conditions.push(eq(schema.auditLogs.action, action));
    }
    if (category) {
      conditions.push(
        eq(
          schema.auditLogs.category,
          category as (typeof schema.auditCategory.enumValues)[number]
        )
      );
    }
    if (actorId) {
      conditions.push(eq(schema.auditLogs.actorId, actorId));
    }
    if (actorEmail) {
      // Partial match on the `actor_email` text column. ILIKE is fine here
      // — the email column is short, and the audit_logs table has an index
      // on (created_at) for pagination ordering; this is an ad-hoc filter.
      const sanitizedActor = actorEmail.slice(0, 320);
      conditions.push(
        ilike(schema.auditLogs.actorEmail, `%${sanitizedActor}%`)
      );
    }
    if (actorType) {
      conditions.push(
        eq(
          schema.auditLogs.actorType,
          actorType as (typeof schema.auditActorType.enumValues)[number]
        )
      );
    }
    if (entityType) {
      conditions.push(eq(schema.auditLogs.entityType, entityType));
    }
    if (entityId) {
      conditions.push(eq(schema.auditLogs.entityId, entityId));
    }
    if (spaceId) {
      conditions.push(eq(schema.auditLogs.spaceId, spaceId));
    }
    if (source) {
      conditions.push(eq(schema.auditLogs.source, source));
    }
    if (from) {
      conditions.push(gte(schema.auditLogs.createdAt, new Date(from)));
    }
    if (to) {
      conditions.push(lte(schema.auditLogs.createdAt, new Date(to)));
    }
    if (search) {
      // Limit search length to prevent expensive ILIKE queries
      const sanitizedSearch = search.slice(0, 256);
      conditions.push(
        ilike(schema.auditLogs.description, `%${sanitizedSearch}%`)
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(schema.auditLogs)
        .where(where)
        .orderBy(desc(schema.auditLogs.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: count(schema.auditLogs.id) })
        .from(schema.auditLogs)
        .where(where),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    return Response.json({
      data: rows,
      pagination: paginationMeta(total, { page, limit }),
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET /api/orbit/audit-logs error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
