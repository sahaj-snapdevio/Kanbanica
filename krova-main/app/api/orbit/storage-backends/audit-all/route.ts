import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";

/**
 * POST /api/orbit/storage-backends/audit-all
 *
 * Operator-facing "run an audit pass now" trigger. Iterates every
 * storage backend and fires the per-backend health-check endpoint in
 * parallel. Each per-backend call records its own audit row, so the
 * only thing this route audit-logs is the fan-out event itself with the
 * count of backends touched.
 *
 * The deep orphan-object scan still lives in `pnpm storage:audit` (host
 * shell only) because it depends on full bucket listing; this UI button
 * verifies S3 reachability across every backend.
 */
export async function POST(request: Request) {
  try {
    const session = await requireAdmin(request);

    const backends = await db
      .select({
        id: schema.storageBackends.id,
        name: schema.storageBackends.name,
      })
      .from(schema.storageBackends);

    if (backends.length === 0) {
      return Response.json({
        success: true,
        message: "No storage backends configured",
        checked: 0,
      });
    }

    const baseUrl = new URL(request.url).origin;
    const forwardedCookie = request.headers.get("cookie") ?? "";

    const results = await Promise.allSettled(
      backends.map(async (backend) => {
        const res = await fetch(
          `${baseUrl}/api/orbit/storage-backends/${backend.id}/health-check`,
          {
            method: "POST",
            headers: { cookie: forwardedCookie },
          }
        );
        return {
          id: backend.id,
          name: backend.name,
          ok: res.ok,
          status: res.status,
        };
      })
    );

    const ok = results.filter(
      (r) => r.status === "fulfilled" && r.value.ok
    ).length;
    const failed = results.length - ok;

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "storage.audit_all_triggered",
      category: "platform",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "storage_backend",
      description: `Admin ran audit-all on ${backends.length} storage backend(s) (${ok} ok, ${failed} failed)`,
      metadata: { total: backends.length, ok, failed },
      source: "api",
      ...reqCtx,
    });

    return Response.json({
      success: true,
      message:
        failed === 0
          ? `Audit completed — all ${ok} ${ok === 1 ? "backend" : "backends"} healthy`
          : `Audit completed — ${ok} healthy, ${failed} failed`,
      checked: backends.length,
      ok,
      failed,
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST /api/orbit/storage-backends/audit-all error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
