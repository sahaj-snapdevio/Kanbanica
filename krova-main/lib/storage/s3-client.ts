/**
 * AWS SDK S3 client construction for direct worker → bucket operations.
 *
 * Used for lightweight operations (object deletion, listing, head probes)
 * — heavy file transfers go through `s3-transfer.ts`, which orchestrates
 * `rclone` on the bare-metal host so bytes never pass through the worker.
 */

import { S3Client } from "@aws-sdk/client-s3";

import type { StorageBackendConnection } from "@/lib/storage/types";

export function buildS3Client(conn: StorageBackendConnection): S3Client {
  return new S3Client({
    endpoint: conn.endpoint,
    region: conn.region,
    credentials: {
      accessKeyId: conn.accessKeyId.unwrap(),
      secretAccessKey: conn.secretAccessKey.unwrap(),
    },
    // Most S3-compatible providers (iDrive E2, Backblaze B2, MinIO, etc.)
    // expect path-style addressing rather than virtual-host-style.
    forcePathStyle: true,
  });
}
