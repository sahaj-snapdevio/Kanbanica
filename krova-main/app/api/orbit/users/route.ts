import { count, desc, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);

    const url = new URL(request.url);
    const { page, limit, offset } = parsePagination(url);

    const [countResult] = await db.select({ total: count() }).from(schema.user);

    const totalCount = countResult?.total ?? 0;

    const users = await db
      .select({
        id: schema.user.id,
        email: schema.user.email,
        name: schema.user.name,
        role: schema.user.role,
        image: schema.user.image,
        createdAt: schema.user.createdAt,
        updatedAt: schema.user.updatedAt,
        spaceCount: count(schema.spaceMemberships.id),
      })
      .from(schema.user)
      .leftJoin(
        schema.spaceMemberships,
        eq(schema.user.id, schema.spaceMemberships.userId)
      )
      .groupBy(schema.user.id)
      .orderBy(desc(schema.user.createdAt))
      .limit(limit)
      .offset(offset);

    return Response.json({
      users,
      pagination: paginationMeta(totalCount, { page, limit }),
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET /api/orbit/users error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
