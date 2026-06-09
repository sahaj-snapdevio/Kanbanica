import { and, count, desc, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);

    const url = new URL(request.url);
    const statusFilter = url.searchParams.get("status");
    const serverIdFilter = url.searchParams.get("serverId");
    const spaceIdFilter = url.searchParams.get("spaceId");
    const { page, limit, offset } = parsePagination(url);

    const conditions: ReturnType<typeof eq>[] = [];

    if (statusFilter) {
      conditions.push(
        eq(
          schema.cubes.status,
          statusFilter as
            | "pending"
            | "booting"
            | "running"
            | "sleeping"
            | "stopping"
            | "deleted"
            | "error"
        )
      );
    }
    if (serverIdFilter) {
      conditions.push(eq(schema.cubes.serverId, serverIdFilter));
    }
    if (spaceIdFilter) {
      conditions.push(eq(schema.cubes.spaceId, spaceIdFilter));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await db
      .select({ total: count() })
      .from(schema.cubes)
      .where(whereClause);

    const totalCount = countResult?.total ?? 0;

    const cubes = await db
      .select({
        cube: schema.cubes,
        spaceName: schema.spaces.name,
        serverHostname: schema.servers.hostname,
      })
      .from(schema.cubes)
      .leftJoin(schema.spaces, eq(schema.cubes.spaceId, schema.spaces.id))
      .leftJoin(schema.servers, eq(schema.cubes.serverId, schema.servers.id))
      .where(whereClause)
      .orderBy(desc(schema.cubes.createdAt))
      .limit(limit)
      .offset(offset);

    const result = cubes.map((row) => ({
      ...row.cube,
      spaceName: row.spaceName,
      serverHostname: row.serverHostname,
    }));

    return Response.json({
      cubes: result,
      pagination: paginationMeta(totalCount, { page, limit }),
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET /api/orbit/cubes error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
