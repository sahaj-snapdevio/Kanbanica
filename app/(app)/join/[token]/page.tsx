import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { JoinCard } from "@/components/workspace/join-card";
import { Card, CardContent } from "@/components/ui/card";

interface JoinPageProps {
  params: Promise<{ token: string }>;
}

export default async function JoinPage({ params }: JoinPageProps) {
  const { token } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const workspace = await db.workspace.findFirst({
    where: { inviteLinkToken: token, status: "ACTIVE" },
    select: { id: true, name: true },
  });

  // Already a member → straight in
  if (workspace) {
    const existing = await db.workspaceMember.findFirst({
      where: { workspaceId: workspace.id, userId: session.user.id, status: "ACTIVE" },
    });
    if (existing) redirect(`/${workspace.id}`);
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {workspace ? (
          <JoinCard token={token} workspaceName={workspace.name} />
        ) : (
          <Card>
            <CardContent className="py-8 text-center space-y-1">
              <h1 className="font-semibold">This invite link is no longer active</h1>
              <p className="text-sm text-muted-foreground">
                Ask a workspace admin for a new link.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
