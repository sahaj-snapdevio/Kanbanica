import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
} from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 100_000;
// Version byte: 0x01 = PBKDF2-derived key, 0x00 or absent = legacy zero-padded key
const KEY_VERSION_PBKDF2 = 0x01;

/** Derive AES-256 key using PBKDF2 with a random salt. */
function deriveKeyPbkdf2(encryptionKey: string, salt: Buffer): Buffer {
  return pbkdf2Sync(encryptionKey, salt, PBKDF2_ITERATIONS, 32, "sha256");
}

/** Legacy key derivation (zero-padded) — only used for decrypting old data. */
function deriveKeyLegacy(encryptionKey: string): Buffer {
  const hash = Buffer.alloc(32);
  const keyBuf = Buffer.from(encryptionKey, "utf-8");
  keyBuf.copy(hash, 0, 0, Math.min(keyBuf.length, 32));
  return hash;
}

/**
 * Encrypt with PBKDF2 key derivation.
 * Format: base64(0x01 + salt + IV + ciphertext + authTag)
 */
export function encryptPrivateKey(
  plainKey: string,
  encryptionKey: string
): string {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKeyPbkdf2(encryptionKey, salt);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainKey, "utf-8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Versioned format: version byte + salt + IV + ciphertext + authTag
  const blob = Buffer.concat([
    Buffer.from([KEY_VERSION_PBKDF2]),
    salt,
    iv,
    encrypted,
    authTag,
  ]);
  return blob.toString("base64");
}

/**
 * Decrypt — supports both new PBKDF2 format and legacy zero-padded format.
 * Auto-detects format by checking the version byte.
 */
export function decryptPrivateKey(
  encryptedKey: string,
  encryptionKey: string
): string {
  const blob = Buffer.from(encryptedKey, "base64");

  if (blob.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("Invalid encrypted key: too short");
  }

  // Check version byte
  if (blob[0] === KEY_VERSION_PBKDF2) {
    // New format: version(1) + salt(16) + IV(16) + ciphertext + authTag(16)
    const minLength = 1 + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH;
    if (blob.length < minLength) {
      throw new Error("Invalid encrypted key: too short for PBKDF2 format");
    }

    const salt = blob.subarray(1, 1 + SALT_LENGTH);
    const iv = blob.subarray(1 + SALT_LENGTH, 1 + SALT_LENGTH + IV_LENGTH);
    const authTag = blob.subarray(blob.length - AUTH_TAG_LENGTH);
    const ciphertext = blob.subarray(
      1 + SALT_LENGTH + IV_LENGTH,
      blob.length - AUTH_TAG_LENGTH
    );

    const key = deriveKeyPbkdf2(encryptionKey, salt);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString("utf-8");
  }

  // Legacy format: IV(16) + ciphertext + authTag(16) — no version byte, no salt
  const iv = blob.subarray(0, IV_LENGTH);
  const authTag = blob.subarray(blob.length - AUTH_TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH, blob.length - AUTH_TAG_LENGTH);

  const key = deriveKeyLegacy(encryptionKey);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf-8");
}
