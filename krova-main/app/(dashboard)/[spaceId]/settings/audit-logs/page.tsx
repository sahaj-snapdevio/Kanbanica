import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AuditLogViewer } from "@/components/audit-log-viewer";
import { SettingsNav } from "@/components/settings-nav";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server/session";

export default async function AuditLogsPage({
  params,
}: {
  params: Promise<{ spaceId: string }>;
}) {
  const { spaceId } = await params;
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const [membership] = await db
    .select()
    .from(schema.spaceMemberships)
    .where(
      and(
        eq(schema.spaceMemberships.userId, session.user.id),
        eq(schema.spaceMemberships.spaceId, spaceId)
      )
    )
    .limit(1);

  if (!membership) {
    redirect("/");
  }

  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Settings</PageHeaderTitle>
          <PageHeaderDescription>
            Manage your space settings.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>

      <SettingsNav spaceId={spaceId} />

      <AuditLogViewer spaceId={spaceId} />
    </div>
  );
}
