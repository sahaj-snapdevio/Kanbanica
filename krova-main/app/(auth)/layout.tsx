import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Image from "next/image";
import { redirect } from "next/navigation";
import { LOGO_PATH, PRODUCT_NAME } from "@/config/platform";
import { spaceMemberships, spaces } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (session) {
    const memberships = await db
      .select({ spaceId: spaces.id, joinedAt: spaceMemberships.createdAt })
      .from(spaceMemberships)
      .innerJoin(spaces, eq(spaces.id, spaceMemberships.spaceId))
      .where(eq(spaceMemberships.userId, session.user.id));

    const firstMembership = memberships
      .slice()
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())[0];

    redirect(firstMembership ? `/${firstMembership.spaceId}` : "/");
  }

  const productName = PRODUCT_NAME;

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="flex items-center justify-center gap-3">
            <Image
              alt={productName}
              className="h-10 w-auto"
              height={646}
              priority
              src={LOGO_PATH}
              width={1000}
            />
            <h1 className="text-2xl font-bold tracking-tight">{productName}</h1>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Hardware-isolated cloud servers — your own kernel, no public IP,
            billed by the minute.
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
