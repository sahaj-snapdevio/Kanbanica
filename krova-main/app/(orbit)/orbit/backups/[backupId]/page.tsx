/**
 * Admin detail page for a single Cube backup. Read-only — destructive
 * actions flow through the customer-side backup page via impersonation
 * for now. Shows the captured config (vcpus / ram / disk / image /
 * region + any custom domains and TCP mappings captured at backup time).
 */

import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LocalDate } from "@/components/local-date";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IMAGE_OPTIONS } from "@/config/platform";
import * as schema from "@/db/schema";
import type { CubeBackupConfig } from "@/db/schema/backups";
import { db } from "@/lib/db";
import { formatBytes } from "@/lib/format";
import { backupStatusVariant } from "@/lib/status-display";

export const dynamic = "force-dynamic";

export default async function OrbitBackupDetailPage({
  params,
}: {
  params: Promise<{ backupId: string }>;
}) {
  const { backupId } = await params;

  const [row] = await db
    .select({
      id: schema.cubeBackups.id,
      name: schema.cubeBackups.name,
      status: schema.cubeBackups.status,
      sizeBytes: schema.cubeBackups.sizeBytes,
      diskSizeGb: schema.cubeBackups.diskSizeGb,
      storagePath: schema.cubeBackups.storagePath,
      cubeConfig: schema.cubeBackups.cubeConfig,
      originalCubeId: schema.cubeBackups.originalCubeId,
      originalCubeName: schema.cubeBackups.originalCubeName,
      redeployedCubeId: schema.cubeBackups.redeployedCubeId,
      redeployReason: schema.cubeBackups.redeployReason,
      createdAt: schema.cubeBackups.createdAt,
      completedAt: schema.cubeBackups.completedAt,
      spaceId: schema.cubeBackups.spaceId,
      spaceName: schema.spaces.name,
      backendLabel: schema.storageBackends.name,
      createdByEmail: schema.user.email,
    })
    .from(schema.cubeBackups)
    .leftJoin(schema.spaces, eq(schema.spaces.id, schema.cubeBackups.spaceId))
    .leftJoin(
      schema.storageBackends,
      eq(schema.storageBackends.id, schema.cubeBackups.storageBackendId)
    )
    .leftJoin(schema.user, eq(schema.user.id, schema.cubeBackups.createdBy))
    .where(eq(schema.cubeBackups.id, backupId))
    .limit(1);

  if (!row) {
    notFound();
  }

  const config = row.cubeConfig as CubeBackupConfig;
  const imageLabel =
    IMAGE_OPTIONS.find((o) => o.value === config.imageId)?.label ??
    config.imageId;

  // The original cube row may have been hard-deleted long ago; check
  // whether it still exists in the DB so we know whether to link to it.
  const [originalCubeAlive] = await db
    .select({ id: schema.cubes.id })
    .from(schema.cubes)
    .where(eq(schema.cubes.id, row.originalCubeId))
    .limit(1);

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Link
            className="transition-colors hover:text-foreground"
            href="/orbit/backups"
          >
            Backups
          </Link>
          <span>/</span>
          <span>{row.name}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{row.name}</h1>
          <Badge variant={backupStatusVariant(row.status)}>{row.status}</Badge>
          {row.redeployedCubeId && <Badge variant="outline">Redeployed</Badge>}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Original cube</dt>
              <dd>
                {originalCubeAlive ? (
                  <Link
                    className="font-medium hover:underline"
                    href={`/orbit/cubes/${row.originalCubeId}`}
                  >
                    {row.originalCubeName}
                  </Link>
                ) : (
                  <span className="font-medium text-muted-foreground">
                    {row.originalCubeName}{" "}
                    <span className="text-xs">(purged)</span>
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Space</dt>
              <dd>
                {row.spaceId ? (
                  <Link
                    className="font-medium hover:underline"
                    href={`/orbit/spaces/${row.spaceId}`}
                  >
                    {row.spaceName ?? row.spaceId}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Size on backend</dt>
              <dd className="font-mono tabular-nums">
                {formatBytes(row.sizeBytes)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Disk allocation</dt>
              <dd className="font-mono tabular-nums">{row.diskSizeGb} GB</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Storage backend</dt>
              <dd className="font-medium">{row.backendLabel ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Object key</dt>
              <dd className="font-mono text-xs break-all">
                {row.storagePath ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Created by</dt>
              <dd className="font-medium">{row.createdByEmail ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Created</dt>
              <dd className="font-medium">
                <LocalDate iso={row.createdAt} mode="relative" />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Completed</dt>
              <dd className="font-medium">
                <LocalDate iso={row.completedAt} mode="relative" />
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Captured configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">vCPUs</dt>
              <dd className="font-mono tabular-nums">{config.vcpus}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">RAM</dt>
              <dd className="font-mono tabular-nums">{config.ramMb} MB</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Disk</dt>
              <dd className="font-mono tabular-nums">
                {config.diskLimitGb} GB
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Image</dt>
              <dd className="font-medium">{imageLabel}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Region</dt>
              <dd className="font-medium">{config.regionName}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Custom domains</dt>
              <dd className="font-medium">
                {config.domainMappings.length === 0
                  ? "—"
                  : config.domainMappings
                      .map((d) => `${d.domain}:${d.port}`)
                      .join(", ")}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">TCP mappings</dt>
              <dd className="font-medium">
                {config.tcpMappings.length === 0
                  ? "—"
                  : config.tcpMappings
                      .map(
                        (m) => `:${m.cubePort}${m.label ? ` (${m.label})` : ""}`
                      )
                      .join(", ")}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {row.redeployedCubeId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Redeploy</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Redeployed cube</dt>
                <dd>
                  <Link
                    className="font-medium hover:underline"
                    href={`/orbit/cubes/${row.redeployedCubeId}`}
                  >
                    {row.redeployedCubeId}
                  </Link>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Reason</dt>
                <dd className="font-medium">{row.redeployReason ?? "—"}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
