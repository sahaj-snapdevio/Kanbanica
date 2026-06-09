/**
 * Server pull-images phase: stream each `platform_images` artifact from the
 * worker container's local filesystem to /var/lib/krova/images/ on the
 * bare-metal server via SFTP, decompress .zst variants on the bare-metal,
 * verify sha256 of the compressed download.
 *
 * No object-storage involvement. The worker container has the image files
 * mounted in via the Dokploy `/opt/krova-build:/opt/krova-build` bind mount,
 * so they're readable as ordinary local files. Each image streams over the
 * existing platform-key SSH connection — same channel install/network use.
 *
 * The image-sync core (validate, SFTP, sha256, decompress) lives in
 * `lib/server/sync-images.ts` and is shared with `server.update-images` so
 * operator-initiated kernel/rootfs refreshes on already-active servers reuse
 * the exact same path.
 *
 * Idempotency:
 *   - kernel: skipped if on-disk sha256 already matches.
 *   - rootfs: always re-uploaded (sha256 in DB is for the .zst, not the
 *     decompressed .ext4 — no recoverable hash post-decompression).
 */
import type { Job } from "pg-boss";
import { audit } from "@/lib/audit";
import {
  claimPhaseRunning,
  completePhase,
  failPhase,
} from "@/lib/server/setup-phase";
import { syncPlatformImages } from "@/lib/server/sync-images";
import { connectToServer } from "@/lib/ssh/connect-to-server";
import { formatImageVersion } from "@/lib/version";
import { JobLogger } from "@/lib/worker/job-log";
import type { ServerPullImagesPayload } from "@/lib/worker/job-types";

async function runHandler(job: Job<ServerPullImagesPayload>): Promise<void> {
  const { serverId } = job.data;
  const phase = "pull_images" as const;
  const claimed = await claimPhaseRunning(serverId, phase);
  if (!claimed) {
    return;
  }

  const log = new JobLogger(job.id, "server.pull_images", "server", serverId);
  let client: Awaited<ReturnType<typeof connectToServer>>["client"] | null =
    null;

  try {
    await log.info("Pull-images phase started");

    const conn = await connectToServer(serverId);
    client = conn.client;

    const result = await syncPlatformImages(client, serverId, log);

    await log.info(
      `Pull-images phase complete — ${result.count} image(s), ${result.uploaded} uploaded, ${result.skipped} skipped, kernel v${formatImageVersion(result.kernelVersion)}`
    );
    await completePhase(serverId, phase);
    audit({
      action: "server.setup.pull_images_complete",
      category: "server",
      actorType: "system",
      entityType: "server",
      entityId: serverId,
      description: `Server ${conn.server.hostname} received ${result.count} image(s) via worker SFTP (${result.uploaded} uploaded, ${result.skipped} skipped)`,
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
    console.error(`[server-pull-images] failed for ${serverId}:`, err);
    await log.error(`Pull-images phase failed: ${msg}`);
    await failPhase(serverId, phase, msg);
    audit({
      action: "server.setup.pull_images_failed",
      category: "server",
      actorType: "system",
      entityType: "server",
      entityId: serverId,
      description: `Server pull-images phase failed: ${msg.slice(0, 200)}`,
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

export async function handleServerPullImages(
  jobs: Job<ServerPullImagesPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await runHandler(job);
  }
}
