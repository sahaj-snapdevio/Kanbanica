import { S3Client } from "@aws-sdk/client-s3";
import { env } from "@/lib/env";

let _client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!_client) {
    _client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
      // Most S3-compatible providers (R2, MinIO, B2, iDrive E2) require
      // path-style addressing rather than virtual-host-style.
      forcePathStyle: true,
    });
  }
  return _client;
}

export const BUCKET = () => env.S3_BUCKET;
