import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { ProfileDataExportCard } from "@/components/profile-data-export-card";
import { ProfileDeleteAccountCard } from "@/components/profile-delete-account-card";
import { ProfileForm } from "@/components/profile-form";
import { ProfileSessionsCard } from "@/components/profile-sessions-card";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import { user } from "@/db/schema";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server/session";

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  // marketingOptIn is a custom column not surfaced on the Better Auth
  // session — read it directly.
  const [row] = await db
    .select({ marketingOptIn: user.marketingOptIn })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);

  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Profile</PageHeaderTitle>
          <PageHeaderDescription>
            Manage your name and email.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>

      <ProfileForm
        user={{
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          marketingOptIn: row?.marketingOptIn ?? true,
        }}
      />

      <ProfileSessionsCard />

      <div className="grid gap-6 lg:grid-cols-2">
        <ProfileDataExportCard />
        <ProfileDeleteAccountCard userEmail={session.user.email} />
      </div>
    </div>
  );
}
