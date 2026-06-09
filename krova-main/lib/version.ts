import { IMAGE_VERSION_MAJOR } from "@/config/platform";

/**
 * Render an image-version integer (the `minor` stored in `platform_images.version`,
 * `servers.currentKernelVersion`, `cubes.bootedKernelVersion`, etc.) as a dotted
 * version string `${IMAGE_VERSION_MAJOR}.${minor}`.
 *
 * Returns null when the minor is null/undefined — caller should hide the badge
 * (cube provisioned before versioning shipped, or server never image-synced).
 */
export function formatImageVersion(
  minor: number | null | undefined
): string | null {
  if (minor == null) {
    return null;
  }
  return `${IMAGE_VERSION_MAJOR}.${minor}`;
}

/**
 * Tuple comparison for image versions. Returns true when `bootedMinor` is
 * strictly behind `serverMinor` — i.e. the cube needs a cold-restart to pick
 * up the latest kernel currently sitting on the server's disk.
 *
 * Major is shared (compile-time constant), so only the minor is compared.
 * If majors ever diverge in the future, extend this helper.
 */
export function isImageVersionOutdated(
  bootedMinor: number | null | undefined,
  serverMinor: number | null | undefined
): boolean {
  if (bootedMinor == null || serverMinor == null) {
    return false;
  }
  return bootedMinor < serverMinor;
}
