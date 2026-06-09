/**
 * Tiny semver helpers — just enough for the weekly version scanner.
 *
 * We don't pull in the `semver` package because:
 *   - Our pinned-version strings span several formats (SemVer, kernel-style
 *     6.1.172, GitHub tags with leading "v"). A real semver parser would
 *     reject most of them.
 *   - We only need two operations: normalize a string into a comparable
 *     `[major, minor, patch]` tuple and compare two such tuples.
 *
 * Anything that doesn't parse cleanly returns `null` from `normalizeVersion`,
 * which the scanner treats as "can't compare" and skips with a sane default.
 */

export function normalizeVersion(
  raw: string | undefined | null
): string | null {
  if (!raw) {
    return null;
  }
  // Strip caret/tilde/leading-v, drop pre-release/build suffixes.
  const m = raw
    .trim()
    .replace(/^[^\d]*/, "") // drops "v", "^", "~", ">=" etc
    .match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) {
    return null;
  }
  const [, major, minor = "0", patch = "0"] = m;
  return `${major}.${minor}.${patch}`;
}

/**
 * Compare two version strings. Returns -1 if `a < b`, 0 if equal, +1 if
 * `a > b`. Inputs that don't parse compare equal — caller decides what
 * to do with that.
 */
export function compareVersions(a: string, b: string): number {
  const aN = normalizeVersion(a);
  const bN = normalizeVersion(b);
  if (!aN || !bN) {
    return 0;
  }
  const aParts = aN.split(".").map(Number);
  const bParts = bN.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (aParts[i] > bParts[i]) {
      return 1;
    }
    if (aParts[i] < bParts[i]) {
      return -1;
    }
  }
  return 0;
}
