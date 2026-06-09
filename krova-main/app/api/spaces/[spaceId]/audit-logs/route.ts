import { and, count, desc, eq, inArray } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireSpaceMember } from "@/lib/api/auth-helpers";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { db } from "@/lib/db";

/**
 * Customer-facing audit logs for a space.
 * Returns only rows scoped to the authenticated user's space.
 * No ipAddress or userAgent exposed (admin-only fields).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    const { spaceId } = await params;
    await requireSpaceMember(request, spaceId);

    const url = new URL(request.url);
    const { page, limit, offset } = parsePagination(url, { maxPageSize: 100 });

    // Optional filters
    const category = url.searchParams.get("category");
    const source = url.searchParams.get("source");

    const conditions = [eq(schema.auditLogs.spaceId, spaceId)];

    if (category) {
      conditions.push(
        eq(
          schema.auditLogs.category,
          category as (typeof schema.auditCategory.enumValues)[number]
        )
      );
    }
    if (source) {
      conditions.push(eq(schema.auditLogs.source, source));
    }

    const where = and(...conditions);

    const [rows, countResult] = await Promise.all([
      db
        .select({
          id: schema.auditLogs.id,
          action: schema.auditLogs.action,
          category: schema.auditLogs.category,
          actorType: schema.auditLogs.actorType,
          actorId: schema.auditLogs.actorId,
          actorEmail: schema.auditLogs.actorEmail,
          entityType: schema.auditLogs.entityType,
          entityId: schema.auditLogs.entityId,
          spaceId: schema.auditLogs.spaceId,
          metadata: schema.auditLogs.metadata,
          description: schema.auditLogs.description,
          source: schema.auditLogs.source,
          createdAt: schema.auditLogs.createdAt,
        })
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

    // Resolve actor names from users and api_keys tables
    const actorIds = [
      ...new Set(
        rows.map((r) => r.actorId).filter((id): id is string => id !== null)
      ),
    ];

    const userNames = new Map<string, string>();
    const apiKeyNames = new Map<string, { name: string; prefix: string }>();

    if (actorIds.length > 0) {
      const [users, keys] = await Promise.all([
        db
          .select({ id: schema.user.id, name: schema.user.name })
          .from(schema.user)
          .where(inArray(schema.user.id, actorIds)),
        db
          .select({
            id: schema.apiKeys.id,
            name: schema.apiKeys.name,
            keyPrefix: schema.apiKeys.keyPrefix,
          })
          .from(schema.apiKeys)
          .where(inArray(schema.apiKeys.id, actorIds)),
      ]);
      for (const u of users) {
        userNames.set(u.id, u.name);
      }
      for (const k of keys) {
        apiKeyNames.set(k.id, { name: k.name, prefix: k.keyPrefix });
      }
    }

    const data = rows.map((row) => {
      const actorName =
        userNames.get(row.actorId ?? "") ??
        apiKeyNames.get(row.actorId ?? "")?.name ??
        row.actorEmail ??
        null;
      const keyPrefix = apiKeyNames.get(row.actorId ?? "")?.prefix ?? null;

      return {
        ...row,
        actorName,
        keyPrefix,
      };
    });

    return Response.json({
      data,
      pagination: paginationMeta(total, { page, limit }),
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET /api/spaces/[spaceId]/audit-logs error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
