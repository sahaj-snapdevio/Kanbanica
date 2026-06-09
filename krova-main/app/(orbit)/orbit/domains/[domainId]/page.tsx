/**
 * Admin detail page for a single customer custom domain. Read-only —
 * admin DELETE is not exposed yet (would need an admin-side route that
 * mirrors `domain.remove`'s job + Cloudflare cleanup). For destructive
 * actions, drive the customer flow via the cube's admin control room.
 */

import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LocalDate } from "@/components/local-date";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import {
  cloudflareStatusVariant,
  domainStatusVariant,
} from "@/lib/status-display";

export const dynamic = "force-dynamic";

export default async function OrbitDomainDetailPage({
  params,
}: {
  params: Promise<{ domainId: string }>;
}) {
  const { domainId } = await params;

  const [row] = await db
    .select({
      id: schema.domainMappings.id,
      domain: schema.domainMappings.domain,
      port: schema.domainMappings.port,
      status: schema.domainMappings.status,
      verificationStatus: schema.domainMappings.verificationStatus,
      verificationCheckedAt: schema.domainMappings.verificationCheckedAt,
      verifyAttempts: schema.domainMappings.verifyAttempts,
      verificationError: schema.domainMappings.verificationError,
      tlsStatus: schema.domainMappings.tlsStatus,
      cloudflareHostnameId: schema.domainMappings.cloudflareHostnameId,
      cloudflareStatus: schema.domainMappings.cloudflareStatus,
      createdAt: schema.domainMappings.createdAt,
      updatedAt: schema.domainMappings.updatedAt,
      cubeId: schema.domainMappings.cubeId,
      cubeName: schema.cubes.name,
      spaceId: schema.cubes.spaceId,
      spaceName: schema.spaces.name,
      serverHostname: schema.servers.hostname,
    })
    .from(schema.domainMappings)
    .leftJoin(schema.cubes, eq(schema.cubes.id, schema.domainMappings.cubeId))
    .leftJoin(schema.spaces, eq(schema.spaces.id, schema.cubes.spaceId))
    .leftJoin(schema.servers, eq(schema.servers.id, schema.cubes.serverId))
    .where(eq(schema.domainMappings.id, domainId))
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
            href="/orbit/domains"
          >
            Domains
          </Link>
          <span>/</span>
          <span className="font-mono">{row.domain}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold tracking-tight">
            {row.domain}
          </h1>
          <Badge variant={domainStatusVariant(row.status)}>{row.status}</Badge>
          <Badge variant={cloudflareStatusVariant(row.cloudflareStatus)}>
            Cloudflare: {row.cloudflareStatus ?? "—"}
          </Badge>
          <Badge variant="outline">TLS: {row.tlsStatus}</Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Routing</CardTitle>
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
                  <span className="text-muted-foreground">—</span>
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
              <dt className="text-muted-foreground">Server</dt>
              <dd className="font-medium">{row.serverHostname ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Cube port</dt>
              <dd className="font-mono tabular-nums">{row.port ?? "—"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cloudflare for SaaS</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Hostname ID</dt>
              <dd className="font-mono text-xs">
                {row.cloudflareHostnameId ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium">{row.cloudflareStatus ?? "—"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Verification &amp; lifecycle
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Verification status</dt>
              <dd className="font-medium">{row.verificationStatus}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Verify attempts</dt>
              <dd className="font-mono tabular-nums">{row.verifyAttempts}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Last checked</dt>
              <dd className="font-medium">
                <LocalDate iso={row.verificationCheckedAt} mode="relative" />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Verification error</dt>
              <dd className="font-medium">{row.verificationError ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Added</dt>
              <dd className="font-medium">
                <LocalDate iso={row.createdAt} mode="relative" />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Updated</dt>
              <dd className="font-medium">
                <LocalDate iso={row.updatedAt} mode="relative" />
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
