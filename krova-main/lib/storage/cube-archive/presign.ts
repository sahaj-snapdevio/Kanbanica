/**
 * S3 presigned URL helpers for `.cube` archive transfer.
 *
 * Two distinct flows:
 *
 *   - DOWNLOAD (export): a single presigned GET URL valid for 15 min.
 *     Customer's browser fetches the `.cube` object directly from S3.
 *
 *   - UPLOAD (import): browser-side multipart upload via presigned PUT
 *     URLs (one per 8 MB chunk). Pre-signing happens on the worker
 *     against the active S3 backend.
 *
 * The browser → S3 multipart sequence:
 *   1. Worker calls `createMultipartUpload` → S3 returns UploadId.
 *   2. Worker signs N UploadPart URLs (one per chunk).
 *   3. Browser uploads each chunk via fetch(url, {method: "PUT", body}).
 *      Each response's ETag header is the part identifier.
 *   4. Browser sends the (partNumber, etag) list back to the worker.
 *   5. Worker calls `completeMultipartUpload` → S3 assembles the parts.
 *
 * On abort (customer cancel, reaper timeout), `abortMultipartUpload`
 * releases the in-progress parts so they stop billing.
 */

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { buildS3Client } from "@/lib/storage/s3-client";
import type { StorageBackendConnection } from "@/lib/storage/types";

/** Chunk size for browser-side multipart upload. 8 MB satisfies S3's
 *  5 MB minimum and keeps the part count reasonable: a 60 GB archive
 *  is 7,500 parts (well under S3's 10,000-part cap). */
export const UPLOAD_CHUNK_SIZE_BYTES = 8 * 1024 * 1024;

/** Hard cap on upload size. Bigger than any sensible cube backup but
 *  small enough that abuse uploads can't grow unbounded. */
export const MAX_UPLOAD_SIZE_BYTES = 60 * 1024 * 1024 * 1024; // 60 GB

/** Minimum upload size we accept. An empty or truncated `.cube` would
 *  fail validation downstream anyway; rejecting here gives a clearer
 *  error early. */
export const MIN_UPLOAD_SIZE_BYTES = 1 * 1024 * 1024; // 1 MB

export interface PresignedUploadPart {
  partNumber: number;
  url: string;
}

export interface CreatedMultipartUpload {
  chunkSizeBytes: number;
  expiresInSeconds: number;
  parts: PresignedUploadPart[];
  uploadId: string;
}

/**
 * Initiate a multipart upload and return per-part presigned PUT URLs.
 * `fileSizeBytes` determines the part count. Each URL has a 1-hour
 * TTL — if the customer's upload outruns that, they can re-initiate
 * (the abandoned upload gets reaped after 24h).
 */
export async function createMultipartUpload(
  backend: StorageBackendConnection,
  key: string,
  fileSizeBytes: number,
  options: {
    chunkSizeBytes?: number;
    expiresInSeconds?: number;
    contentType?: string;
  } = {}
): Promise<CreatedMultipartUpload> {
  if (fileSizeBytes < MIN_UPLOAD_SIZE_BYTES) {
    throw new Error(
      `File size ${fileSizeBytes} bytes is below the ${MIN_UPLOAD_SIZE_BYTES} minimum`
    );
  }
  if (fileSizeBytes > MAX_UPLOAD_SIZE_BYTES) {
    throw new Error(
      `File size ${fileSizeBytes} bytes exceeds the ${MAX_UPLOAD_SIZE_BYTES} maximum`
    );
  }

  const chunkSizeBytes = options.chunkSizeBytes ?? UPLOAD_CHUNK_SIZE_BYTES;
  const expiresInSeconds = options.expiresInSeconds ?? 3600;

  const numParts = Math.ceil(fileSizeBytes / chunkSizeBytes);
  if (numParts < 1 || numParts > 10_000) {
    throw new Error(
      `Invalid part count ${numParts} (chunk=${chunkSizeBytes}, size=${fileSizeBytes})`
    );
  }

  const client = buildS3Client(backend);
  try {
    const create = await client.send(
      new CreateMultipartUploadCommand({
        Bucket: backend.bucket,
        Key: key,
        ContentType: options.contentType ?? "application/octet-stream",
      })
    );
    if (!create.UploadId) {
      throw new Error("S3 did not return an UploadId");
    }
    const uploadId = create.UploadId;

    const parts: PresignedUploadPart[] = [];
    for (let partNumber = 1; partNumber <= numParts; partNumber++) {
      const url = await getSignedUrl(
        client,
        new UploadPartCommand({
          Bucket: backend.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: expiresInSeconds }
      );
      parts.push({ partNumber, url });
    }

    return { uploadId, parts, chunkSizeBytes, expiresInSeconds };
  } finally {
    client.destroy();
  }
}

export interface CompletedUploadParts {
  etag: string;
  partNumber: number;
}

export interface CompletedMultipartUpload {
  etag: string;
  sizeBytes: number;
}

/**
 * Complete the multipart upload. `parts` must list every part the
 * browser uploaded, sorted by `partNumber`. After completion, the
 * archive is a single S3 object — the caller can HEAD it to confirm
 * the final size, or rely on the size we return here.
 */
export async function completeMultipartUpload(
  backend: StorageBackendConnection,
  key: string,
  uploadId: string,
  parts: CompletedUploadParts[]
): Promise<CompletedMultipartUpload> {
  if (parts.length === 0) {
    throw new Error("No parts supplied for completion");
  }
  // Sort to enforce the API requirement; cheap defensive step.
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  // Reject duplicates and gaps so a malformed payload can't yield a
  // half-assembled object.
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].partNumber !== i + 1) {
      throw new Error(
        `Parts must be contiguous starting at 1; got ${sorted[i].partNumber} at index ${i}`
      );
    }
    if (!sorted[i].etag) {
      throw new Error(`Part ${sorted[i].partNumber} is missing its ETag`);
    }
  }

  const client = buildS3Client(backend);
  try {
    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: backend.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: sorted.map((p) => ({
            PartNumber: p.partNumber,
            ETag: p.etag,
          })),
        },
      })
    );
    // Confirm the actual on-S3 size — used by the caller as a sanity
    // check vs the client-declared expectedSizeBytes.
    const head = await client.send(
      new HeadObjectCommand({ Bucket: backend.bucket, Key: key })
    );
    return {
      etag: head.ETag ?? "",
      sizeBytes: head.ContentLength ?? 0,
    };
  } finally {
    client.destroy();
  }
}

/**
 * Cancel an in-progress multipart upload. Idempotent — used both by
 * the customer-facing cancel endpoint and by the periodic reaper. A
 * missing upload (already aborted, already completed) is treated as
 * success.
 */
export async function abortMultipartUpload(
  backend: StorageBackendConnection,
  key: string,
  uploadId: string
): Promise<void> {
  const client = buildS3Client(backend);
  try {
    await client.send(
      new AbortMultipartUploadCommand({
        Bucket: backend.bucket,
        Key: key,
        UploadId: uploadId,
      })
    );
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "NoSuchUpload") {
      return;
    }
    throw err;
  } finally {
    client.destroy();
  }
}

/**
 * Generate a short-lived presigned GET URL for an existing object.
 * Used by the customer-facing "Download backup" flow — the customer's
 * browser fetches the `.cube` directly from S3 with no Krova-side
 * bandwidth cost.
 */
export async function presignDownloadUrl(
  backend: StorageBackendConnection,
  key: string,
  expiresInSeconds = 15 * 60
): Promise<string> {
  const client = buildS3Client(backend);
  try {
    return await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: backend.bucket, Key: key }),
      { expiresIn: expiresInSeconds }
    );
  } finally {
    client.destroy();
  }
}
