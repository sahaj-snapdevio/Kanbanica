import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { PRODUCT_NAME } from "@/config/platform";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { getGravatarUrl } from "@/lib/gravatar";
import { getSession } from "@/lib/server/session";
import { getPusherClientConfig } from "@/lib/service-config";
import { getStorageCapabilities } from "@/lib/storage/capabilities";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const sessionAny = session.session as { impersonatedBy?: string };
  const impersonatingAs = sessionAny.impersonatedBy
    ? session.user.email
    : undefined;

  const [memberships, pusherConfig, storageCapabilities] = await Promise.all([
    db
      .select({
        id: schema.spaceMemberships.id,
        spaceId: schema.spaceMemberships.spaceId,
        isOwner: schema.spaceMemberships.isOwner,
        spaceName: schema.spaces.name,
        creditBalance: schema.spaces.creditBalance,
      })
      .from(schema.spaceMemberships)
      .innerJoin(
        schema.spaces,
        eq(schema.spaces.id, schema.spaceMemberships.spaceId)
      )
      .where(eq(schema.spaceMemberships.userId, session.user.id)),
    getPusherClientConfig(),
    getStorageCapabilities(),
  ]);

  const spaces = memberships.map((m) => ({
    id: m.spaceId,
    name: m.spaceName,
    creditBalance: Number.parseFloat(m.creditBalance),
    isOwner: m.isOwner,
  }));

  return (
    <DashboardShell
      branding={{
        productName: PRODUCT_NAME,
      }}
      impersonatingAs={impersonatingAs}
      pusherConfig={pusherConfig}
      spaces={spaces}
      storageCapabilities={storageCapabilities}
      user={{
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image || getGravatarUrl(session.user.email),
        role: (session.user as { role?: string | null }).role ?? null,
      }}
    >
      {children}
    </DashboardShell>
  );
}
