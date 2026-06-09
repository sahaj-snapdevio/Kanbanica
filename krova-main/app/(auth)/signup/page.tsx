import { and, eq } from "drizzle-orm";
import { Suspense } from "react";

import { AuthForm } from "@/app/(auth)/_components/auth-form";
import { invites } from "@/db/schema";
import { db } from "@/lib/db";

interface SignupPageProps {
  searchParams: Promise<{ invite?: string }>;
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { invite: inviteToken } = await searchParams;
  const invitedEmail = inviteToken
    ? await lookupInviteEmail(inviteToken)
    : null;

  return (
    <Suspense>
      <AuthForm
        description="Get started with your new account"
        footerLinkHref="/login"
        footerLinkText="Log in"
        footerText="Already have an account?"
        googleButtonLabel="Sign up with Google"
        invitedEmail={invitedEmail}
        submitButtonLabel="Send Magic Link"
        title="Create Account"
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
