import { and, eq } from "drizzle-orm";
import { Suspense } from "react";

import { AuthForm } from "@/app/(auth)/_components/auth-form";
import { invites } from "@/db/schema";
import { db } from "@/lib/db";

interface LoginPageProps {
  searchParams: Promise<{ invite?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { invite: inviteToken } = await searchParams;
  const invitedEmail = inviteToken
    ? await lookupInviteEmail(inviteToken)
    : null;

  return (
    <Suspense>
      <AuthForm
        description="Sign in to your account to continue"
        footerLinkHref="/signup"
        footerLinkText="Sign up"
        footerText="Don't have an account?"
        googleButtonLabel="Continue with Google"
        invitedEmail={invitedEmail}
        submitButtonLabel="Send Magic Link"
        title="Log In"
      />
    </Suspense>
  );
}

async function lookupInviteEmail(token: string): Promise<string | null> {
  const [row] = await db
    .select({ email: invites.email, expiresAt: invites.expiresAt })
    .from(invites)
    .where(and(eq(invites.token, token), eq(invites.status, "pending")))
    .limit(1);
  if (!row) {
    return null;
  }
  if (row.expiresAt < new Date()) {
    return null;
  }
  return row.email;
}
