import { createHash, randomBytes } from "crypto";

const KEY_PREFIX = "kro_";
const KEY_BYTES = 32;

/**
 * Generate a new API key.
 * Returns { fullKey, keyPrefix, keyHash } — store only the hash.
 * The full key is shown to the user once and never stored.
 */
export function generateApiKey(): {
  fullKey: string;
  keyPrefix: string;
  keyHash: string;
} {
  const bytes = randomBytes(KEY_BYTES);
  const fullKey = KEY_PREFIX + bytes.toString("base64url");
  const keyPrefix = fullKey.slice(0, 11); // "kro_" + first 7 chars
  const keyHash = hashApiKey(fullKey);
  return { fullKey, keyPrefix, keyHash };
}

/**
 * Hash an API key with SHA-256 for storage/lookup.
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
