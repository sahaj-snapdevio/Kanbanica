/**
 * Stream the tail of a Cube's serial console + Firecracker logs to admin
 * operators. Read-only diagnostic surface — no commands accepted, no writes.
 *
 * Why this exists: when a Cube fails to boot (kernel panic, init failure,
 * vsock misconfig, missing virtio driver), the symptom in the UI is
 * "guest agent unresponsive" or "hypervisor=shut off". The actual root
 * cause is in /var/lib/krova/cubes/<id>/serial.log and firecracker.log on
 * the host. Without surfacing these, every diagnosis requires SSH'ing
 * into the bare-metal box. Surfacing them in the admin UI means a single
 * operator can triage faster than rotating through dozens of servers.
 *
 * Security:
 *   - Admin-only via requireAdmin (orbit-scope).
 *   - Read-only `tail -c <bytes>` on a fixed path pattern. cubeId comes
 *     from the route param and is the cube's CUID2 — not user-controllable.
 *   - We bound `bytes` to [1024, 131072] so a malicious admin can't ask
 *     for a multi-GB read that exhausts the worker.
 *
 * Returns JSON: { serialLog: string, firecrackerLog: string,
 *                 serialBytes: number, firecrackerBytes: number,
 *                 fetchedAt: string }
 */

import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { db } from "@/lib/db";
import { connectToServer } from "@/lib/ssh/connect-to-server";
import { execCommand } from "@/lib/ssh/exec";
import { cubePaths } from "@/lib/ssh/jailer";

const MIN_BYTES = 1024;
const MAX_BYTES = 131_072; // 128 KB — enough for a full kernel boot trace
const DEFAULT_BYTES = 16_384;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ cubeId: string }> }
) {
  try {
    await requireAdmin(request);
    const { cubeId } = await params;

    const url = new URL(request.url);
    const requestedBytes = Number(
      url.searchParams.get("bytes") ?? DEFAULT_BYTES
    );
    const bytes = Number.isFinite(requestedBytes)
      ? Math.min(MAX_BYTES, Math.max(MIN_BYTES, Math.floor(requestedBytes)))
      : DEFAULT_BYTES;

    const [cube] = await db
      .select({
        serverId: schema.cubes.serverId,
        launchMode: schema.cubes.launchMode,
      })
      .from(schema.cubes)
      .where(eq(schema.cubes.id, cubeId))
      .limit(1);
    if (!cube) {
      return Response.json({ error: "Cube not found" }, { status: 404 });
    }

    const conn = await connectToServer(cube.serverId);
    try {
      // Run both reads in one SSH session. `tail -c` returns "" if the file
      // is missing or unreadable; we report that with a placeholder so the
      // operator can tell "log doesn't exist" from "log is empty".
      const cubeDir = `/var/lib/krova/cubes/${cubeId}`;
      const fcLogPath = cubePaths(cubeId, cube.launchMode).fcLog;
      const [serialRes, fcRes] = await Promise.all([
        execCommand(
          conn.client,
          `if [ -f ${cubeDir}/serial.log ]; then tail -c ${bytes} ${cubeDir}/serial.log; else echo '<serial.log does not exist on host>'; fi`,
          15_000
        ),
        execCommand(
          conn.client,
          `if [ -f ${fcLogPath} ]; then tail -c ${bytes} ${fcLogPath}; else echo '<firecracker.log does not exist on host>'; fi`,
          15_000
        ),
      ]);

      return Response.json({
        serialLog: serialRes.stdout,
        firecrackerLog: fcRes.stdout,
        serialBytes: serialRes.stdout.length,
        firecrackerBytes: fcRes.stdout.length,
        fetchedAt: new Date().toISOString(),
      });
    } finally {
      try {
        conn.client.end();
      } catch {
        /* noop */
      }
    }
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET /api/orbit/cubes/[cubeId]/vm-console error:", error);
    return Response.json(
      { error: "Failed to read VM console logs" },
      { status: 500 }
    );
  }
}
