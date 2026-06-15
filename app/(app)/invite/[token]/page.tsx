import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { InviteCard } from "@/components/workspace/invite-card";
import { Card, CardContent } from "@/components/ui/card";

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const invite = await db.workspaceMember.findFirst({
    where: { inviteToken: token, status: "INVITED", workspace: { status: "ACTIVE" } },
    include: { workspace: { select: { name: true } } },
  });

  const expired = !!invite?.inviteExpiresAt && invite.inviteExpiresAt < new Date();
  const wrongEmail =
    !!invite && invite.email?.toLowerCase() !== session.user.email.toLowerCase();

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {!invite || expired ? (
          <Card>
            <CardContent className="py-8 text-center space-y-1">
              <h1 className="font-semibold">
                {expired ? "This invite has expired" : "Invite not found"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {expired
                  ? "Ask a workspace admin to re-send your invite."
                  : "This invite link is no longer valid."}
              </p>
            </CardContent>
          </Card>
        ) : wrongEmail ? (
          <Card>
            <CardContent className="py-8 text-center space-y-1">
              <h1 className="font-semibold">This invite is for a different email</h1>
              <p className="text-sm text-muted-foreground">
                It was sent to <span className="font-medium">{invite.email}</span>, but
                you&apos;re signed in as{" "}
                <span className="font-medium">{session.user.email}</span>. Sign in with the
                invited email to accept.
              </p>
            </CardContent>
          </Card>
        ) : (
          <InviteCard token={token} workspaceName={invite.workspace.name} />
        )}
      </div>
    </div>
  );
}
