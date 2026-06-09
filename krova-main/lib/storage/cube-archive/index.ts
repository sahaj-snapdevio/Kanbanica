/**
 * `.cube` archive subsystem — single portable file customers can
 * download/upload to move cubes between accounts or keep offline.
 *
 *   <bucket>/<env>/backups/<spaceId>/<backupId>.cube    ← exported backups
 *   <bucket>/<env>/imports/<spaceId>/<importId>.cube    ← customer uploads
 *
 * Each `.cube` is a plain tar (no outer compression — rootfs blob is
 * already zstd) containing three bare-name entries: `manifest.json`,
 * `rootfs.ext4.zst`, `checksums.txt`. See `manifest.ts` for the wire
 * schema.
 */

export {
  type BuildCubeArchiveInput,
  type BuildCubeArchiveResult,
  buildCubeArchive,
} from "@/lib/storage/cube-archive/host-build";
export {
  type ExtractCubeArchiveInput,
  type ExtractCubeArchiveResult,
  extractCubeArchive,
} from "@/lib/storage/cube-archive/host-extract";
export {
  type BuildManifestInput,
  buildManifest,
  CUBE_ARCHIVE_FORMAT,
  type CubeArchiveManifest,
  MAX_MANIFEST_BYTES,
  type ParsedManifest,
  parseAndValidateManifest,
} from "@/lib/storage/cube-archive/manifest";
export {
  abortMultipartUpload,
  type CompletedMultipartUpload,
  type CompletedUploadParts,
  type CreatedMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  MAX_UPLOAD_SIZE_BYTES,
  MIN_UPLOAD_SIZE_BYTES,
  type PresignedUploadPart,
  presignDownloadUrl,
  UPLOAD_CHUNK_SIZE_BYTES,
} from "@/lib/storage/cube-archive/presign";
