import type { Secret } from "@/lib/encrypt";

/**
 * Decrypted S3 backend connection ready for AWS SDK or rclone use.
 *
 * The `accessKeyId` and `secretAccessKey` are wrapped in `Secret<string>`
 * so they don't accidentally appear in logs or JSON serialisation. Call
 * `.unwrap()` only at the exact point of use.
 */
export interface StorageBackendConnection {
  accessKeyId: Secret<string>;
  bucket: string;
  endpoint: string;
  id: string;
  name: string;
  region: string;
  secretAccessKey: Secret<string>;
}
