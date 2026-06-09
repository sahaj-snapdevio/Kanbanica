import { desc, eq } from "drizzle-orm";
import { DomainClaimsTable } from "@/app/(orbit)/orbit/domains/_components/domain-claims-table";
import { DomainsTable } from "@/app/(orbit)/orbit/domains/_components/domains-table";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function OrbitDomainsPage() {
  const rows = await db
    .select({
      id: schema.domainMappings.id,
      domain: schema.domainMappings.domain,
      port: schema.domainMappings.port,
      status: schema.domainMappings.status,
      verificationStatus: schema.domainMappings.verificationStatus,
      cloudflareStatus: schema.domainMappings.cloudflareStatus,
      cloudflareHostnameId: schema.domainMappings.cloudflareHostnameId,
      createdAt: schema.domainMappings.createdAt,
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
    .orderBy(desc(schema.domainMappings.createdAt));

  const domains = rows.map((r) => ({
    id: r.id,
    domain: r.domain,
    port: r.port ?? null,
    status: r.status,
    verificationStatus: r.verificationStatus,
    cloudflareStatus: r.cloudflareStatus ?? null,
    cloudflareHostnameId: r.cloudflareHostnameId ?? null,
    createdAt: r.createdAt,
    cubeId: r.cubeId,
    cubeName: r.cubeName ?? "—",
    spaceId: r.spaceId ?? null,
    spaceName: r.spaceName ?? "—",
    serverHostname: r.serverHostname ?? "—",
  }));

  const claimRows = await db
    .select({
      id: schema.spaceDomainClaims.id,
      domain: schema.spaceDomainClaims.domain,
      status: schema.spaceDomainClaims.status,
      verifiedAt: schema.spaceDomainClaims.verifiedAt,
      createdAt: schema.spaceDomainClaims.createdAt,
      spaceId: schema.spaceDomainClaims.spaceId,
      spaceName: schema.spaces.name,
    })
    .from(schema.spaceDomainClaims)
    .leftJoin(
      schema.spaces,
      eq(schema.spaces.id, schema.spaceDomainClaims.spaceId)
    )
    .orderBy(desc(schema.spaceDomainClaims.createdAt));

  const claims = claimRows.map((c) => ({
    id: c.id,
    domain: c.domain,
    status: c.status,
    spaceId: c.spaceId ?? null,
    spaceName: c.spaceName ?? "—",
    verifiedAt: c.verifiedAt ? c.verifiedAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Custom domains</PageHeaderTitle>
          <PageHeaderDescription>
            All customer custom domains routed through Cloudflare for SaaS.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <DomainsTable domains={domains} />

      <div className="space-y-3">
        <div>
          <h2 className="font-semibold text-lg">Verified domain claims</h2>
          <p className="text-muted-foreground text-sm">
            Space-level domain locks. A verified claim reserves a domain and all
            its subdomains to one space.
          </p>
        </div>
        <DomainClaimsTable claims={claims} />
      </div>
    </div>
  );
}
