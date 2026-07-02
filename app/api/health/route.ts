import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// Liveness/readiness probe for load balancers and container orchestrators.
// Returns 200 { ok: true, db: "connected" } when the database is reachable,
// otherwise 503. Keep this unauthenticated so health checks can reach it.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
    return Response.json({ ok: true, db: "connected" });
  } catch {
    return Response.json({ ok: false, db: "disconnected" }, { status: 503 });
  }
}
