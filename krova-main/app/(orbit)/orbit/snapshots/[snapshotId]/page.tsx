/**
 * Admin detail page for a single Cube snapshot. Read-only — admin DELETE
 * is not exposed yet because there is no admin-side API for snapshot
 * deletion (would need to coordinate restic prune, S3 audit, audit log,
 * idempotency). Use the "Open as customer" button to drive the existing
 * customer-side delete flow if needed.
 */

import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LocalDate } from "@/components/local-date";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { formatBytes } from "@/lib/format";
import { snapshotStatusVariant } from "@/lib/status-display";

export const dynamic = "force-dynamic";

export default async function OrbitSnapshotDetailPage({
  params,
}: {
  params: Promise<{ snapshotId: string }>;
}) {
  const { snapshotId } = await params;

  const [row] = await db
    .select({
      id: schema.cubeSnapshots.id,
      name: schema.cubeSnapshots.name,
      status: schema.cubeSnapshots.status,
      sizeBytes: schema.cubeSnapshots.sizeBytes,
      storagePath: schema.cubeSnapshots.storagePath,
      kind: schema.cubeSnapshots.kind,
      createdAt: schema.cubeSnapshots.createdAt,
      completedAt: schema.cubeSnapshots.completedAt,
      cubeId: schema.cubeSnapshots.cubeId,
      cubeName: schema.cubes.name,
      spaceId: schema.cubeSnapshots.spaceId,
      spaceName: schema.spaces.name,
      backendLabel: schema.storageBackends.name,
      createdByEmail: schema.user.email,
    })
    .from(schema.cubeSnapshots)
    .leftJoin(schema.cubes, eq(schema.cubes.id, schema.cubeSnapshots.cubeId))
    .leftJoin(schema.spaces, eq(schema.spaces.id, schema.cubeSnapshots.spaceId))
    .leftJoin(
      schema.storageBackends,
      eq(schema.storageBackends.id, schema.cubeSnapshots.storageBackendId)
    )
    .leftJoin(schema.user, eq(schema.user.id, schema.cubeSnapshots.createdBy))
    .where(eq(schema.cubeSnapshots.id, snapshotId))
    .limit(1);

  if (!row) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Link
            className="transition-colors hover:text-foreground"
            href="/orbit/snapshots"
          >
            Snapshots
          </Link>
          <span>/</span>
          <span>{row.name}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{row.name}</h1>
          <Badge variant={snapshotStatusVariant(row.status)}>
            {row.status}
          </Badge>
          <Badge variant="outline">
            {row.kind === "auto" ? "Auto" : "Manual"}
          </Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Cube</dt>
              <dd>
                {row.cubeId ? (
                  <Link
                    className="font-medium hover:underline"
                    href={`/orbit/cubes/${row.cubeId}`}
                  >
                    {row.cubeName ?? row.cubeId}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">— (deleted)</span>
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
              <dt
                className="text-muted-foreground"
                title="Deduplicated new data this snapshot added to the repo (incremental) — NOT the snapshot's restore size. The first snapshot uploads the whole cube; later ones only what changed."
              >
                Added
              </dt>
              <dd className="font-mono tabular-nums">
                {formatBytes(row.sizeBytes)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Storage backend</dt>
              <dd className="font-medium">{row.backendLabel ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Restic snapshot id</dt>
              <dd className="font-mono text-xs">{row.storagePath ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Created by</dt>
              <dd className="font-medium">
                {row.kind === "auto"
                  ? "Auto (system)"
                  : (row.createdByEmail ?? "—")}
              </dd>
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
          <CardTitle className="text-base">Admin notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Destructive actions (delete, restore) flow through the customer
            interface. Open the cube&apos;s customer-side detail page from{" "}
            {row.cubeId ? (
              <Link
                className="text-foreground hover:underline"
                href={`/orbit/cubes/${row.cubeId}`}
              >
                its admin control room
              </Link>
            ) : (
              "the cube detail (cube has been deleted)"
            )}{" "}
            and use the &quot;Open as customer&quot; button.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
