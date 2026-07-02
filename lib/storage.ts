import { Files } from "files-sdk";
import { fs as fsAdapter } from "files-sdk/fs";
import { s3 } from "files-sdk/s3";
import path from "path";
import { env } from "@/lib/env";

const APP_URL = env.NEXT_PUBLIC_APP_URL;

function createStorage() {
  // ── Production: S3 or Cloudflare R2 ─────────────────────────────────────────
  // Enabled by STORAGE_DRIVER=s3 (or "r2" — both use the S3 adapter). Set:
  //   S3_BUCKET, S3_REGION ("auto" for R2, e.g. "us-east-1" for AWS S3),
  //   S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
  //   S3_ENDPOINT (R2 / MinIO / other S3-compatible; omit for AWS S3),
  //   S3_PUBLIC_URL (optional CDN / public bucket origin for serving files).
  if (env.STORAGE_DRIVER === "s3" || env.STORAGE_DRIVER === "r2") {
    return new Files({
      adapter: s3({
        bucket: env.S3_BUCKET,
        region: env.S3_REGION,
        endpoint: env.S3_ENDPOINT, // R2 / MinIO / S3-compatible; omit for AWS S3
        forcePathStyle: !!env.S3_ENDPOINT, // needed by MinIO and most S3-compatible services
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        },
        publicBaseUrl: env.S3_PUBLIC_URL,
      }),
    });
  }

  // Default: local filesystem — stores files in ./uploads/, served via /api/files.
  // In containers, mount a persistent volume at ./uploads or uploads are lost on redeploy.
  return new Files({
    adapter: fsAdapter({
      root: path.join(process.cwd(), "uploads"),
      urlBaseUrl: `${APP_URL}/api/files`,
    }),
  });
}

export const storage = createStorage();

export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/x-zip-compressed",
]);

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
