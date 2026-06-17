import { Files } from "files-sdk";
import { fs as fsAdapter } from "files-sdk/fs";
// import { s3 } from "files-sdk/s3";
// import { S3Client } from "@aws-sdk/client-s3";
import path from "path";

// const STORAGE_DRIVER = process.env.STORAGE_DRIVER ?? "local"; // uncomment when enabling S3/R2
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

function createStorage() {
  // ── Production: S3 or Cloudflare R2 ─────────────────────────────────────────
  // Uncomment this block and set the env vars below when ready for production.
  //
  // Required env vars:
  //   STORAGE_DRIVER=s3          (or "r2" — both use the S3 adapter)
  //   S3_BUCKET=teamority-uploads
  //   S3_REGION=auto             (use "auto" for R2, e.g. "us-east-1" for AWS S3)
  //   S3_ACCESS_KEY_ID=...
  //   S3_SECRET_ACCESS_KEY=...
  //   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com  (R2 only; omit for AWS S3)
  //
  // if (process.env.STORAGE_DRIVER === "s3" || process.env.STORAGE_DRIVER === "r2") {
  //   return new Files({
  //     adapter: s3({
  //       client: new S3Client({
  //         region: process.env.S3_REGION!,
  //         endpoint: process.env.S3_ENDPOINT,   // R2 / MinIO only; omit for AWS S3
  //         credentials: {
  //           accessKeyId: process.env.S3_ACCESS_KEY_ID!,
  //           secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  //         },
  //       }),
  //       bucket: process.env.S3_BUCKET!,
  //     }),
  //   });
  // }
  // ────────────────────────────────────────────────────────────────────────────

  // Default: local filesystem — stores files in ./uploads/, served via /api/files
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
