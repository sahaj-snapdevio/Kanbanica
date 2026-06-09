/**
 * Operator-initiated image refresh on an active server. Reuses the same
 * image-sync core as `server.pull-images`, but does NOT touch phase state
 * and does NOT block on the phase lifecycle — so it can run on a server
 * that's already `setupPhase=ready` with customer Cubes scheduled to it.
 *
 * Use case: after `pnpm build:images` produces a new vmlinux or rootfs (e.g.
 * a kernel rebuild for additional features, a security-patched rootfs), the
 * operator runs this to push the new artifacts to active servers without
 * destroying state. Existing Cubes keep their currently-loaded kernel until
 * they next boot from cold; new Cubes immediately use the refreshed images.
 *
 * What this handler does NOT do:
 *   - Reboot the server.
 *   - Restart any running Cubes.
 *   - Change `setupPhase` or `setupStatus` (the server stays active).
 */

import { eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import * as schema from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { syncPlatformImages } from "@/lib/server/sync-images";
import { connectToServer } from "@/lib/ssh/connect-to-server";
import { formatImageVersion } from "@/lib/version";
import { JobLogger } from "@/lib/worker/job-log";
import type { ServerUpdateImagesPayload } from "@/lib/worker/job-types";

async function runHandler(job: Job<ServerUpdateImagesPayload>): Promise<void> {
  const { serverId } = job.data;
  const log = new JobLogger(job.id, "server.update_images", "server", serverId);
  let client: Awaited<ReturnType<typeof connectToServer>>["client"] | null =
    null;

  try {
    await log.info("Image update started (operator-initiated)");

    const [server] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, serverId))
      .limit(1);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    const conn = await connectToServer(serverId);
    client = conn.client;

    const result = await syncPlatformImages(client, serverId, log);

    const totalMb = (result.totalBytes / 1024 / 1024).toFixed(1);
    await log.info(
      `Image update complete — ${result.count} image(s), ${result.uploaded} uploaded (${totalMb} MB transferred), ${result.skipped} skipped, kernel v${formatImageVersion(result.kernelVersion)}`
    );

    audit({
      action: "server.images_updated",
      category: "server",
      actorType: "system",
      entityType: "server",
      entityId: serverId,
      description: `Operator refreshed images on "${server.hostname}" — ${result.uploaded}/${result.count} updated, ${result.skipped} skipped`,
      metadata: {
        count: result.count,
        uploaded: result.uploaded,
        skipped: result.skipped,
        totalBytes: result.totalBytes,
      },
      source: "worker",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[server-update-images] failed for ${serverId}:`, err);
    await log.error(`Image update failed: ${msg}`);
    audit({
      action: "server.images_update_failed",
      category: "server",
      actorType: "system",
      entityType: "server",
      entityId: serverId,
      description: `Operator-initiated image update failed: ${msg.slice(0, 200)}`,
      metadata: { error: msg.slice(0, 1000) },
      source: "worker",
    });
  } finally {
    if (client) {
      try {
        client.end();
      } catch {
        /* noop */
      }
    }
  }
}

export async function handleServerUpdateImages(
  jobs: Job<ServerUpdateImagesPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await runHandler(job);
  }
}
