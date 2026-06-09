import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  pbkdf2Sync,
  randomBytes,
} from "crypto";
import { env } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 100_000;
const KEY_VERSION = 0x01;

function deriveKey(encryptionKey: string, salt: Buffer): Buffer {
  return pbkdf2Sync(encryptionKey, salt, PBKDF2_ITERATIONS, 32, "sha256");
}

/**
 * Encrypt a string value with AES-256-GCM + PBKDF2.
 * Format: base64(0x01 + salt(16) + IV(16) + ciphertext + authTag(16))
 * Defaults to APP_SECRET as the encryption key.
 */
export function encryptValue(
  plain: string,
  key: string = env.APP_SECRET
): string {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const derivedKey = deriveKey(key, salt);
  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);

  const encrypted = Buffer.concat([
    cipher.update(plain, "utf-8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const blob = Buffer.concat([
    Buffer.from([KEY_VERSION]),
    salt,
    iv,
    encrypted,
    authTag,
  ]);
  return blob.toString("base64");
}

/**
 * Decrypt a value encrypted by encryptValue.
 * Defaults to APP_SECRET as the decryption key.
 */
export function decryptValue(
  cipher: string,
  key: string = env.APP_SECRET
): string {
  const blob = Buffer.from(cipher, "base64");
  const minLength = 1 + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH;
  if (blob.length < minLength) {
    throw new Error("Invalid encrypted value: too short");
  }
  if (blob[0] !== KEY_VERSION) {
    throw new Error("Invalid encrypted value: unknown version byte");
  }

  const salt = blob.subarray(1, 1 + SALT_LENGTH);
  const iv = blob.subarray(1 + SALT_LENGTH, 1 + SALT_LENGTH + IV_LENGTH);
  const authTag = blob.subarray(blob.length - AUTH_TAG_LENGTH);
  const ciphertext = blob.subarray(
    1 + SALT_LENGTH + IV_LENGTH,
    blob.length - AUTH_TAG_LENGTH
  );

  const derivedKey = deriveKey(key, salt);
  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf-8");
}

/**
 * Deterministic HMAC-SHA256 of `value`, keyed by APP_SECRET by default.
 *
 * Used to derive a per-server token that the bare-metal host stores and
 * presents when calling /api/internal/server-rebooted — so APP_SECRET itself
 * never leaves the control plane.
 */
export function hmacSign(value: string, key: string = env.APP_SECRET): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

/**
 * Wraps a sensitive value so it never leaks through toString / JSON.stringify.
 * Call .unwrap() to access the actual value.
 */
export class Secret<T = string> {
  readonly #value: T;

  constructor(value: T) {
    this.#value = value;
  }

  unwrap(): T {
    return this.#value;
  }

  toString(): string {
    return "[REDACTED]";
  }

  toJSON(): string {
    return "[REDACTED]";
  }
}
