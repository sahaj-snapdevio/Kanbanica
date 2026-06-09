/**
 * One-shot reset for the image-versioning baseline.
 *
 * After moving from the integer-only scheme (v1, v2, …, v10) to the dotted
 * scheme (v1.0, v1.1, …, v1.10), use this script to wipe accumulated minor
 * counters back to v1.0 across every relevant table. This is intended to be
 * run once, after testing the new scheme, on the deployed environment that
 * was carrying old integer values.
 *
 * What it does:
 *   - platform_images.version          → 0          (= v1.0 baseline)
 *   - servers.current_kernel_version   → 0          (= v1.0 baseline)
 *   - servers.current_rootfs_versions  → {}         (cleared; next Update Images repopulates)
 *   - cubes.booted_kernel_version      → NULL       (badge hides until next cold-boot)
 *   - cubes.provisioned_rootfs_version → NULL       (badge hides until next provision)
 *
 * sha256 in platform_images is intentionally KEPT — the next `pnpm build:images`
 * will compare against it; if the artifact bytes match, version stays at 0
 * (still "v1.0"); if bytes changed, version bumps to 1 (display "v1.1").
 *
 * Cube booted/provisioned versions are nulled (not zeroed) because a cube's
 * actual running kernel doesn't change just because we ran a script. Truth is
 * restored on the next cold-boot when cube-boot.ts copies the server's value.
 *
 * Run via: `pnpm reset:image:version`
 */

import { isNotNull } from "drizzle-orm";
import { existsSync } from "fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

async function resetImageVersion() {
  const [{ db }, { platformImages }, { servers }, { cubes }] =
    await Promise.all([
      import("@/lib/db"),
      import("@/db/schema/platform-images"),
      import("@/db/schema/servers"),
      import("@/db/schema/cubes"),
    ]);

  console.log("→ Resetting image-version baseline to v1.0 …");

  const piResult = await db
    .update(platformImages)
    .set({ version: 0 })
    .returning({ id: platformImages.id });
  console.log(`  platform_images: reset ${piResult.length} row(s) to v1.0`);

  const srvResult = await db
    .update(servers)
    .set({ currentKernelVersion: 0, currentRootfsVersions: {} })
    .returning({ id: servers.id });
  console.log(
    `  servers: reset current_kernel_version + cleared current_rootfs_versions on ${srvResult.length} row(s)`
  );

  const cubesKernelResult = await db
    .update(cubes)
    .set({ bootedKernelVersion: null })
    .where(isNotNull(cubes.bootedKernelVersion))
    .returning({ id: cubes.id });
  console.log(
    `  cubes: nulled booted_kernel_version on ${cubesKernelResult.length} row(s)`
  );

  const cubesRootfsResult = await db
    .update(cubes)
    .set({ provisionedRootfsVersion: null })
    .where(isNotNull(cubes.provisionedRootfsVersion))
    .returning({ id: cubes.id });
  console.log(
    `  cubes: nulled provisioned_rootfs_version on ${cubesRootfsResult.length} row(s)`
  );

  console.log("");
  console.log("Done. Final DB state:");
  console.log("  - platform_images: every row at v1.0 (sha256 preserved)");
  console.log("  - servers: every row at v1.0, current_rootfs_versions = {}");
  console.log("  - cubes: booted/provisioned versions nulled (badge hides)");
  console.log("");
  console.log(
    "On-disk artifacts on the worker host and each bare-metal server"
  );
  console.log("are NOT touched. Customer cubes keep running the kernel they");
  console.log("cold-booted with — badge reappears (truthful value) on next");
  console.log("cold-restart.");

  process.exit(0);
}

resetImageVersion().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
