import { count, eq, gt } from "drizzle-orm";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

/**
 * Public endpoint: returns regions that have at least one active server.
 * Used by the Create Cube form so customers can choose a region.
 */
export async function GET() {
  try {
    const regionRows = await db
      .select({
        id: schema.regions.id,
        name: schema.regions.name,
        slug: schema.regions.slug,
      })
      .from(schema.regions)
      .innerJoin(schema.servers, eq(schema.servers.regionId, schema.regions.id))
      .where(eq(schema.servers.status, "active"))
      .groupBy(schema.regions.id, schema.regions.name, schema.regions.slug)
      .having(gt(count(schema.servers.id), 0));

    return Response.json({ regions: regionRows });
  } catch (error) {
    console.error("GET /api/regions error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
