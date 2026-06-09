import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { MismatchActions } from "@/app/(auth)/invite/[token]/mismatch-actions";
import { acceptInvite } from "@/app/actions/invites";
import { LocalDate } from "@/components/local-date";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { invites, spaceMemberships, spaces } from "@/db/schema";
import { isVisiblePermission, PERMISSION_LABELS } from "@/db/schema/types";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;

  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect(`/login?invite=${token}`);
  }

  const [invite] = await db
    .select({
      id: invites.id,
      email: invites.email,
      permissions: invites.permissions,
      status: invites.status,
      expiresAt: invites.expiresAt,
      createdAt: invites.createdAt,
      spaceId: invites.spaceId,
      spaceName: spaces.name,
      token: invites.token,
    })
    .from(invites)
    .innerJoin(spaces, eq(invites.spaceId, spaces.id))
    .where(eq(invites.token, token))
    .limit(1);

  if (!invite) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invite Not Found</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>
              This invite link is invalid or has been removed.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // Already a member — fast-redirect into the space.
  const [existingMembership] = await db
    .select({ id: spaceMemberships.id })
    .from(spaceMemberships)
    .where(
      and(
        eq(spaceMemberships.userId, session.user.id),
        eq(spaceMemberships.spaceId, invite.spaceId)
      )
    )
    .limit(1);

  if (existingMembership) {
    redirect(`/${invite.spaceId}`);
  }

  const isExpired = invite.expiresAt < new Date();
  const isNotPending = invite.status !== "pending";

  if (isNotPending || isExpired) {
    const reason = isExpired
      ? "This invite has expired. Ask the space owner to send a new one."
      : `This invite has already been ${invite.status}.`;

    return (
      <Card>
        <CardHeader>
          <CardTitle>Invite Unavailable</CardTitle>
          <CardDescription>Join {invite.spaceName}</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>{reason}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const sessionEmail = session.user.email.toLowerCase();
  const inviteEmail = invite.email.toLowerCase();

  if (sessionEmail !== inviteEmail) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Wrong Account</CardTitle>
          <CardDescription>Join {invite.spaceName}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <AlertDescription>
              This invite was sent to{" "}
              <strong className="break-all">{invite.email}</strong>, but
              you&apos;re signed in as{" "}
              <strong className="break-all">{session.user.email}</strong>. Sign
              out and continue with the invited email.
            </AlertDescription>
          </Alert>
          <MismatchActions token={token} />
        </CardContent>
      </Card>
    );
  }

  // Email matches — auto-accept and redirect.
  const result = await acceptInvite(token);

  if ("success" in result && result.data?.spaceId) {
    redirect(`/${result.data.spaceId}`);
  }

  // Auto-accept failed. Re-check membership: a concurrent tab/request may
  // have completed acceptance between our existingMembership read above and
  // the action's transaction, in which case our action now sees the invite
  // as already-accepted and returns "no longer valid" even though the user
  // IS in the space. Redirect them where they belong.
  const [postFailureMembership] = await db
    .select({ id: spaceMemberships.id })
    .from(spaceMemberships)
    .where(
      and(
        eq(spaceMemberships.userId, session.user.id),
        eq(spaceMemberships.spaceId, invite.spaceId)
      )
    )
    .limit(1);

  if (postFailureMembership) {
    redirect(`/${invite.spaceId}`);
  }

  const permissions = ((invite.permissions as string[]) ?? []).filter(
    isVisiblePermission
  );
  const acceptError =
    "error" in result
      ? result.error
      : "We couldn't process this invite. Please try again.";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Couldn&apos;t Accept Invite</CardTitle>
        <CardDescription>Join {invite.spaceName}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert variant="destructive">
          <AlertDescription>{acceptError}</AlertDescription>
        </Alert>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Invited email</span>
          <span className="font-medium break-all">{invite.email}</span>
        </div>

        {permissions.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground">
              Intended permissions
            </p>
            <div className="flex flex-wrap gap-2">
              {permissions.map((perm) => (
                <Badge key={perm} variant="secondary">
                  {PERMISSION_LABELS[perm] ?? perm}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <Separator />

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Expires</span>
          <span>
            <LocalDate iso={invite.expiresAt} mode="date" />
          </span>
        </div>

        <p className="text-sm text-muted-foreground">
          If this keeps happening, ask the space owner to resend the invite or
          adjust their plan limits.
        </p>
      </CardContent>
    </Card>
  );
}
