import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type _Object,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";
import { BUCKET, getS3Client } from "@/lib/storage/s3-client";

export interface UploadOptions {
  contentType?: string;
  cacheControl?: string;
  acl?: "public-read" | "private";
}

export async function s3Upload(
  key: string,
  body: Buffer | Uint8Array | string | ReadableStream,
  options: UploadOptions = {}
): Promise<string> {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: BUCKET(),
      Key: key,
      Body: body as Buffer,
      ContentType: options.contentType ?? "application/octet-stream",
      CacheControl: options.cacheControl,
      ACL: options.acl,
    })
  );
  return key;
}

export async function s3Download(key: string): Promise<Buffer> {
  const res = await getS3Client().send(
    new GetObjectCommand({ Bucket: BUCKET(), Key: key })
  );
  if (!res.Body) throw new Error(`S3 object ${key} has no body`);
  return Buffer.from(await res.Body.transformToByteArray());
}

export interface S3ObjectMeta {
  key: string;
  sizeBytes: number;
  lastModified: Date;
  contentType?: string;
  etag?: string;
}

export async function s3Head(key: string): Promise<S3ObjectMeta | null> {
  try {
    const res = await getS3Client().send(
      new HeadObjectCommand({ Bucket: BUCKET(), Key: key })
    );
    return {
      key,
      sizeBytes: res.ContentLength ?? 0,
      lastModified: res.LastModified ?? new Date(0),
      contentType: res.ContentType,
      etag: res.ETag,
    };
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "NotFound" || name === "NoSuchKey") return null;
    throw err;
  }
}

export async function s3Delete(key: string): Promise<void> {
  try {
    await getS3Client().send(
      new DeleteObjectCommand({ Bucket: BUCKET(), Key: key })
    );
  } catch (err) {
    const name = (err as { name?: string }).name;
    const code = (err as { Code?: string }).Code;
    if (name === "NoSuchKey" || code === "NoSuchKey") return;
    throw err;
  }
}

export async function s3DeleteMany(
  keys: string[]
): Promise<{ deleted: number; failed: number }> {
  if (keys.length === 0) return { deleted: 0, failed: 0 };

  let deleted = 0;
  let failed = 0;

  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    const res = await getS3Client().send(
      new DeleteObjectsCommand({
        Bucket: BUCKET(),
        Delete: {
          Objects: chunk.map((Key) => ({ Key })),
          Quiet: false,
        },
      })
    );
    deleted += res.Deleted?.length ?? 0;
    for (const e of res.Errors ?? []) {
      if (e.Code === "NoSuchKey") {
        deleted++;
      } else {
        failed++;
        console.warn(`[s3] failed to delete ${e.Key}: ${e.Code} ${e.Message}`);
      }
    }
  }

  return { deleted, failed };
}

export interface S3ListItem {
  key: string;
  sizeBytes: number;
  lastModified: Date;
}

export async function s3List(prefix: string): Promise<S3ListItem[]> {
  const results: S3ListItem[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await getS3Client().send(
      new ListObjectsV2Command({
        Bucket: BUCKET(),
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    for (const obj of res.Contents ?? ([] as _Object[])) {
      if (!obj.Key) continue;
      results.push({
        key: obj.Key,
        sizeBytes: obj.Size ?? 0,
        lastModified: obj.LastModified ?? new Date(0),
      });
    }

    if (res.IsTruncated && !res.NextContinuationToken) {
      throw new Error(
        "ListObjectsV2 returned IsTruncated=true without NextContinuationToken — refusing to commit a partial listing"
      );
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return results;
}

export async function presignDownloadUrl(
  key: string,
  expiresInSeconds = 15 * 60
): Promise<string> {
  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({ Bucket: BUCKET(), Key: key }),
    { expiresIn: expiresInSeconds }
  );
}

export async function presignUploadUrl(
  key: string,
  options: { expiresInSeconds?: number; contentType?: string } = {}
): Promise<string> {
  return getSignedUrl(
    getS3Client(),
    new PutObjectCommand({
      Bucket: BUCKET(),
      Key: key,
      ContentType: options.contentType ?? "application/octet-stream",
    }),
    { expiresIn: options.expiresInSeconds ?? 3600 }
  );
}

export async function getPublicUrl(
  key: string,
  expiresInSeconds = 3600
): Promise<string> {
  const publicBase = env.S3_PUBLIC_URL;
  if (publicBase) {
    return `${publicBase}/${key}`;
  }
  return presignDownloadUrl(key, expiresInSeconds);
}
