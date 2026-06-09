/**
 * Shared image-sync logic used by both:
 *   - the `server.pull-images` setup phase (first-time images)
 *   - the `server.update-images` admin action (refresh existing images on
 *     active servers without going through the phase-reset dance)
 *
 * Behavior:
 *   - Validates every `platform_images` source file is readable on the
 *     worker container's filesystem before opening SSH (cheap fail-fast).
 *   - SFTPs each image from worker → bare-metal `/var/lib/krova/images/`.
 *   - Verifies sha256 of compressed uploads against the DB row, decompresses
 *     `.zst` artifacts in place, sets file mode 0644.
 *   - Idempotent for kernels (skipped when on-disk sha256 matches DB);
 *     rootfs files are always re-uploaded because their sha256 is for the
 *     `.zst` and isn't recoverable post-decompress.
 *
 * Caller is responsible for: opening the SSH client, advancing phase state.
 * This helper just moves bytes onto the box.
 */

import { eq } from "drizzle-orm";
import { existsSync, statSync } from "fs";
import type { Client, SFTPWrapper } from "ssh2";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { ioNicePrefix } from "@/lib/io-nice";
import { execCommand } from "@/lib/ssh/exec";
import type { JobLogger } from "@/lib/worker/job-log";

const IMAGES_DIR = "/var/lib/krova/images";

function openSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolveS, rejectS) => {
    client.sftp((err, sftp) => {
      if (err) {
        rejectS(err);
      } else {
        resolveS(sftp);
      }
    });
  });
}

function fastPut(
  sftp: SFTPWrapper,
  localPath: string,
  remotePath: string
): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    sftp.fastPut(localPath, remotePath, {}, (err) => {
      if (err) {
        rejectP(err);
      } else {
        resolveP();
      }
    });
  });
}

export interface SyncImagesResult {
  count: number;
  /** Kernel version that's now on disk on the server. */
  kernelVersion: number;
  /** Rootfs versions on disk, keyed by image name (e.g. "ubuntu-24.04"). */
  rootfsVersions: Record<string, number>;
  skipped: number;
  totalBytes: number;
  uploaded: number;
}

/**
 * Sync all rows from `platform_images` onto the bare-metal server's
 * `/var/lib/krova/images/` directory. Throws on any per-image failure.
 *
 * On success, also updates the server row's `currentKernelVersion` +
 * `currentRootfsVersions` so the admin UI can detect drift between what's
 * actually on disk and what cubes booted with.
 *
 * The `client` must be an already-open SSH connection. The caller owns its
 * lifecycle — this helper does NOT close it.
 */
export async function syncPlatformImages(
  client: Client,
  serverId: string,
  log: JobLogger
): Promise<SyncImagesResult> {
  const images = await db.select().from(schema.platformImages);
  if (images.length === 0) {
    throw new Error(
      "No platform_images rows found — run `pnpm build:images` first"
    );
  }

  // Validate every source file is readable on the worker BEFORE opening SFTP.
  // Cheap fail-fast — saves spinning up an SFTP session only to find missing
  // files mid-upload.
  await log.step(
    `Validate ${images.length} local image artifact(s)`,
    async () => {
      for (const img of images) {
        if (!existsSync(img.path)) {
          throw new Error(
            `Image source missing on worker: ${img.path} (run \`pnpm build:images\` to regenerate)`
          );
        }
        const localSize = statSync(img.path).size;
        if (localSize !== img.sizeBytes) {
          throw new Error(
            `Image size mismatch for ${img.name}: DB says ${img.sizeBytes}, file is ${localSize}`
          );
        }
      }
    }
  );

  const sftp = await openSftp(client);

  let skipped = 0;
  let uploaded = 0;
  let totalBytes = 0;
  try {
    await execCommand(client, `mkdir -p ${IMAGES_DIR}`, 5000);

    for (const img of images) {
      const sizeMb = (img.sizeBytes / 1024 / 1024).toFixed(1);
      const before = uploaded;
      await log.step(`Image: ${img.name} (${sizeMb} MB)`, async () => {
        const isCompressed = img.path.endsWith(".zst");
        const finalName =
          img.kind === "kernel" ? "vmlinux" : `${img.name}.ext4`;
        const finalPath = `${IMAGES_DIR}/${finalName}`;
        const uploadPath = isCompressed
          ? `${finalPath}.zst.upload`
          : `${finalPath}.upload`;

        // Idempotency: kernels have a direct sha256 we can verify against.
        // Rootfs sha256s reference the compressed .zst — once decompressed
        // there's no recoverable hash, so always re-upload rootfs files.
        if (img.kind === "kernel") {
          const probe = await execCommand(
            client,
            `test -f ${finalPath} && sha256sum ${finalPath} | awk '{print $1}'`,
            10_000
          );
          if (probe.stdout.trim() === img.sha256) {
            await log.info(`Skipped ${img.name} — sha256 matches existing`);
            skipped++;
            return;
          }
        }

        await fastPut(sftp, img.path, uploadPath);

        const hashResult = await execCommand(
          client,
          `sha256sum ${uploadPath} | awk '{print $1}'`,
          60_000
        );
        const actual = hashResult.stdout.trim();
        if (actual !== img.sha256) {
          await execCommand(client, `rm -f ${uploadPath}`, 5000).catch(
            () => {}
          );
          throw new Error(
            `sha256 mismatch: expected ${img.sha256}, got ${actual}`
          );
        }

        if (isCompressed) {
          await execCommand(
            client,
            `${ioNicePrefix()}zstd -d -f ${uploadPath} -o ${finalPath} && rm -f ${uploadPath}`,
            1_800_000
          );
        } else {
          await execCommand(client, `mv ${uploadPath} ${finalPath}`, 5000);
        }

        await execCommand(client, `chmod 644 ${finalPath}`, 5000);
        uploaded++;
        totalBytes += img.sizeBytes;
      });
      void before;
    }
  } finally {
    try {
      sftp.end();
    } catch {
      /* noop */
    }
  }

  // Build the version map from platform_images: kernel version (single) +
  // per-rootfs versions keyed by image name. After sync, EVERYTHING in
  // platform_images is on disk on this server, so the server's "current"
  // versions match `platform_images.version`.
  const kernelImg = images.find((i) => i.kind === "kernel");
  const kernelVersion = kernelImg?.version ?? 0;
  const rootfsVersions: Record<string, number> = {};
  for (const img of images) {
    if (img.kind === "rootfs") {
      rootfsVersions[img.name] = img.version;
    }
  }

  // Persist to the server row so admin UI can detect drift between what's
  // on disk vs. what cubes booted with.
  await db
    .update(schema.servers)
    .set({
      currentKernelVersion: kernelVersion,
      currentRootfsVersions: rootfsVersions,
      updatedAt: new Date(),
    })
    .where(eq(schema.servers.id, serverId));

  return {
    count: images.length,
    totalBytes,
    skipped,
    uploaded,
    kernelVersion,
    rootfsVersions,
  };
}
