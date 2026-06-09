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

    const [countResult] = await db
      .select({ total: count() })
      .from(schema.spaces);

    const totalCount = countResult?.total ?? 0;

    const spacesWithCounts = await db
      .select({
        id: schema.spaces.id,
        name: schema.spaces.name,
        creditBalance: schema.spaces.creditBalance,
        createdAt: schema.spaces.createdAt,
        updatedAt: schema.spaces.updatedAt,
        cubeCount: count(schema.cubes.id),
      })
      .from(schema.spaces)
      .leftJoin(schema.cubes, eq(schema.spaces.id, schema.cubes.spaceId))
      .groupBy(schema.spaces.id)
      .orderBy(desc(schema.spaces.createdAt))
      .limit(limit)
      .offset(offset);

    return Response.json({
      spaces: spacesWithCounts,
      pagination: paginationMeta(totalCount, { page, limit }),
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET /api/orbit/spaces error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
