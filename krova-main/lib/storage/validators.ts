/**
 * Validators for storage backend admin inputs. All inputs come from the
 * Orbit operator form and pass through the Orbit API. Every field is
 * normalised — trimmed, case-corrected where applicable — so the DB row
 * is canonical regardless of operator typing.
 */

/**
 * Validate the S3 endpoint URL. Must be `https://...` with a valid host.
 * Returns the trimmed URL with no trailing slash, or null on invalid input.
 */
export function validateS3Endpoint(endpoint: unknown): string | null {
  if (typeof endpoint !== "string") {
    return null;
  }
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (trimmed.length === 0 || trimmed.length > 512) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") {
    return null;
  }
  if (!parsed.host || parsed.host.length > 253) {
    return null;
  }
  return trimmed;
}

/**
 * Validate an S3 region code (e.g. `eu-central-1`, `us-west-2`).
 */
export function validateS3Region(region: unknown): string | null {
  if (typeof region !== "string") {
    return null;
  }
  const trimmed = region.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 64) {
    return null;
  }
  if (!/^[a-z0-9-]+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Validate a bucket name. AWS S3 rules: lowercase letters, digits, dots
 * and hyphens; 3–63 chars; must start/end with a letter or digit.
 */
export function validateS3Bucket(bucket: unknown): string | null {
  if (typeof bucket !== "string") {
    return null;
  }
  const trimmed = bucket.trim();
  if (trimmed.length < 3 || trimmed.length > 63) {
    return null;
  }
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(trimmed)) {
    return null;
  }
  // No consecutive dots, no IP-address-like names.
  if (trimmed.includes("..")) {
    return null;
  }
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Validate the optional capacity field. Operators enter GB as an integer.
 * Returns the coerced number, `null` for an explicit unlimited value,
 * or `undefined` for invalid input.
 */
export function validateCapacityGb(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 10_000_000) {
    return;
  }
  return n;
}
