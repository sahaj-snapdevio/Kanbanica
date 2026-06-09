import { createId } from "@paralleldrive/cuid2";
import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins/admin";
import { magicLink } from "better-auth/plugins/magic-link";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { type AuditLogEntry, auditBatch } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";
import { magicLinkTemplate } from "@/lib/email/templates/magic-link";
import { verifyEmailTemplate } from "@/lib/email/templates/verify-email";
import { validateEmailForSignup } from "@/lib/email-validation";
import { enqueueEmailitSync } from "@/lib/emailit/enqueue-sync";
import { env } from "@/lib/env";
import {
  acceptInviteInTx,
  findPendingInvitesForEmail,
} from "@/lib/invites/accept";
import { getDefaultPlan } from "@/lib/plan/usage";
import { getGoogleOAuthConfig } from "@/lib/service-config";

// Load Google OAuth config from env vars at module init.
// Changes require server restart (standard for OAuth credential updates).
const googleConfig = getGoogleOAuthConfig();

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  secret: env.APP_SECRET,
  baseURL: env.NEXT_PUBLIC_APP_URL,
  socialProviders: {
    google: {
      clientId: googleConfig.clientId,
      clientSecret: googleConfig.clientSecret,
      overrideUserInfoOnSignIn: true,
      mapProfileToUser: (profile) => ({
        image: profile.picture,
      }),
    },
  },
  plugins: [
    admin({
      impersonationSessionDuration: 3600,
      allowImpersonatingAdmins: false,
    }),
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        // Look up the user up front. We need this for both the banned check
        // AND the disposable-domain gate: existing accounts skip the
        // disposable check (they predate this feature or were onboarded
        // before their provider was added to the upstream list) so we
        // don't accidentally lock anyone out of an account they already
        // own. Only NEW signups go through the spam filter.
        const [existing] = await db
          .select({
            id: schema.user.id,
            banned: schema.user.banned,
            banExpires: schema.user.banExpires,
          })
          .from(schema.user)
          .where(eq(schema.user.email, email))
          .limit(1);

        // Reject new signups from disposable / typo email domains. Existing
        // users (any row in `user` with this email) bypass the gate — they
        // already have an account, and admin-triggered magic links from
        // Orbit should always reach the customer. See `lib/email-validation`
        // for the two-layer check (disposable blocklist + MX lookup).
        if (!existing) {
          const validation = await validateEmailForSignup(email);
          if (!validation.ok) {
            auditBatch([
              {
                action: "auth.magic_link_blocked_email_domain",
                category: "auth",
                actorType: "system",
                actorEmail: email,
                entityType: "user",
                description: `Magic link suppressed — ${validation.reason} (${email})`,
                metadata: { email, reason: validation.reason },
                source: "system",
              },
            ]);
            // Surface the rejection to the client. Better Auth propagates
            // an `APIError` thrown from this callback as a structured
            // response with the given status + message; the magic-link
            // `signInMagicLink` endpoint runs BEFORE any user-row insert
            // (user creation only happens later, inside `magicLinkVerify`
            // when the token is clicked) so a thrown error here leaves no
            // orphan rows. `app/(auth)/_components/auth-form.tsx` already
            // renders the message inline via `form.setError("root", …)`.
            throw new APIError("BAD_REQUEST", {
              message: validation.message,
            });
          }
        }

        // Skip enqueueing for banned users — Better Auth blocks the eventual
        // sign-in callback anyway, but suppressing the email saves SMTP quota
        // and prevents abuse via repeated magic-link requests.
        if (existing?.banned) {
          const expired =
            existing.banExpires && existing.banExpires.getTime() <= Date.now();
          if (!expired) {
            auditBatch([
              {
                action: "auth.magic_link_blocked_banned",
                category: "auth",
                actorType: "system",
                actorEmail: email,
                entityType: "user",
                description: `Magic link suppressed — account banned (${email})`,
                metadata: { email },
                source: "system",
              },
            ]);
            return;
          }
        }

        const { html, text } = await magicLinkTemplate({
          email,
          magicLinkUrl: url,
        });
        await enqueueEmail({
          to: email,
          subject: "Sign in to Krova",
          html,
          text,
        });
        auditBatch([
          {
            action: "auth.magic_link_sent",
            category: "auth",
            actorType: "system",
            actorEmail: email,
            entityType: "user",
            description: `Magic link sent to ${email}`,
            metadata: { email },
            source: "system",
          },
        ]);
      },
    }),
  ],
  session: {
    cookieCache: {
      enabled: true,
      // Short cache — combined with DB re-verification of banned/role in
      // requireSession/requireAdmin, this bounds the staleness window for
      // bans and admin demotions to ~60 seconds.
      maxAge: 60,
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      const { html, text } = await verifyEmailTemplate({
        newEmail: user.email,
        verificationUrl: url,
      });
      await enqueueEmail({
        to: user.email,
        subject: "Verify your new email",
        html,
        text,
      });
    },
  },
  user: {
    changeEmail: {
      enabled: true,
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const displayName =
            user.name || user.email.split("@")[0] || "New User";

          if (!user.name) {
            await db
              .update(schema.user)
              .set({ name: displayName })
              .where(eq(schema.user.id, user.id));
          }

          // Read invites and the default plan up front. Neither needs a lock —
          // the per-invite FOR UPDATE in acceptInviteInTx, the per-space
          // advisory lock from acquireSpaceLock, and the user-row FOR UPDATE
          // inside the transaction below provide the necessary serialization.
          const [defaultPlan, pendingInvites] = await Promise.all([
            getDefaultPlan(),
            findPendingInvitesForEmail(user.email),
          ]);
          const creditGrant = Number.parseFloat(defaultPlan.includedCreditUsd);

          type AcceptedInvite = {
            inviteId: string;
            spaceId: string;
            invitedBy: string;
            invitePermissions: string[];
            inviteCubeAssignments: string[];
            wasExistingMember: boolean;
          };

          // Single transaction covers BOTH invite auto-accept and the
          // self-signup personal-space fallback. The user-row FOR UPDATE
          // serializes concurrent hook fires (duplicate OAuth callbacks); the
          // "user already has memberships" check inside is the duplicate-fire
          // short circuit.
          const txResult = await db.transaction(async (tx) => {
            await tx
              .select({ id: schema.user.id })
              .from(schema.user)
              .where(eq(schema.user.id, user.id))
              .for("update")
              .limit(1);

            const [anyMembership] = await tx
              .select({ id: schema.spaceMemberships.id })
              .from(schema.spaceMemberships)
              .where(eq(schema.spaceMemberships.userId, user.id))
              .limit(1);

            if (anyMembership) {
              return { isDuplicateFire: true as const };
            }

            const accepted: AcceptedInvite[] = [];
            const failed: { inviteId: string; error: string }[] = [];

            for (const inv of pendingInvites) {
              const res = await acceptInviteInTx({
                tx,
                inviteId: inv.id,
                userId: user.id,
                userEmail: user.email,
              });
              if (res.ok) {
                accepted.push({
                  inviteId: res.inviteId,
                  spaceId: res.spaceId,
                  invitedBy: res.invitedBy,
                  invitePermissions: res.invitePermissions,
                  inviteCubeAssignments: res.inviteCubeAssignments,
                  wasExistingMember: res.wasExistingMember,
                });
              } else {
                failed.push({ inviteId: inv.id, error: res.error });
              }
            }

            // Personal-space fallback. Fires when EITHER the user had no
            // invites OR every invite acceptance failed (seat cap, racing
            // revoke, expired between read and tx). Prevents the dead-end
            // where a registered user has zero memberships.
            let createdSpace: { id: string; name: string } | null = null;
            if (accepted.length === 0) {
              const [newSpace] = await tx
                .insert(schema.spaces)
                .values({
                  id: createId(),
                  name: `${displayName}'s Space`,
                  creditBalance: String(creditGrant),
                  planId: defaultPlan.id,
                })
                .returning();

              await tx.insert(schema.spaceMemberships).values({
                id: createId(),
                userId: user.id,
                spaceId: newSpace.id,
                isOwner: true,
              });

              await tx.insert(schema.lifecycleLogs).values({
                entityType: "space",
                entityId: newSpace.id,
                message: "Space created",
              });

              await tx.insert(schema.billingEvents).values({
                id: createId(),
                spaceId: newSpace.id,
                amount: String(creditGrant),
                type: "credit_grant",
                description: "Initial credit grant",
              });

              createdSpace = { id: newSpace.id, name: newSpace.name };
            }

            return {
              isDuplicateFire: false as const,
              accepted,
              failed,
              createdSpace,
            };
          });

          if (txResult.isDuplicateFire) {
            return;
          }

          const { accepted, failed, createdSpace } = txResult;

          // Lifecycle logs for accepted invites run outside the transaction so
          // a logging failure can't roll back the membership row.
          for (const a of accepted) {
            await db.insert(schema.lifecycleLogs).values({
              entityType: "space",
              entityId: a.spaceId,
              message: `Invite accepted by ${user.email} (on signup)`,
            });
          }

          const auditEntries: AuditLogEntry[] = [
            {
              action: "auth.register",
              category: "auth",
              actorType: "user",
              actorId: user.id,
              actorEmail: user.email,
              entityType: "user",
              entityId: user.id,
              description: `User registered: ${user.email}`,
              metadata: {
                name: displayName,
                email: user.email,
                viaInvite: accepted.length > 0,
                invitesAccepted: accepted.length,
                invitesFailed: failed.length,
                fellBackToPersonalSpace:
                  pendingInvites.length > 0 && createdSpace != null,
              },
              source: "system",
            },
          ];

          for (const a of accepted) {
            auditEntries.push({
              action: "invite.accept",
              category: "invite",
              actorType: "user",
              actorId: user.id,
              actorEmail: user.email,
              entityType: "invite",
              entityId: a.inviteId,
              spaceId: a.spaceId,
              description: a.wasExistingMember
                ? "Auto-accepted invite on signup (membership pre-existed)"
                : "Auto-accepted invite on signup",
              metadata: {
                invitedBy: a.invitedBy,
                permissions: a.wasExistingMember ? [] : a.invitePermissions,
                cubeAssignments: a.wasExistingMember
                  ? []
                  : a.inviteCubeAssignments,
                wasExistingMember: a.wasExistingMember,
                viaSignup: true,
              },
              source: "system",
            });
          }

          for (const f of failed) {
            auditEntries.push({
              action: "invite.accept_failed",
              category: "invite",
              actorType: "user",
              actorId: user.id,
              actorEmail: user.email,
              entityType: "invite",
              entityId: f.inviteId,
              description: `Auto-accept on signup failed: ${f.error}`,
              metadata: { error: f.error, viaSignup: true },
              source: "system",
            });
          }

          if (createdSpace) {
            auditEntries.push(
              {
                action: "space.create",
                category: "space",
                actorType: "system",
                actorId: user.id,
                actorEmail: user.email,
                entityType: "space",
                entityId: createdSpace.id,
                spaceId: createdSpace.id,
                description: "Default space created for new user",
                metadata: { spaceName: createdSpace.name },
                source: "system",
              },
              {
                action: "billing.credit_grant",
                category: "billing",
                actorType: "system",
                actorId: user.id,
                actorEmail: user.email,
                entityType: "space",
                entityId: createdSpace.id,
                spaceId: createdSpace.id,
                description: `Initial credit grant of ${creditGrant}`,
                metadata: { amount: creditGrant },
                source: "system",
              }
            );
          }

          auditBatch(auditEntries);

          await enqueueEmailitSync(user.id);
        },
      },
      update: {
        after: async (user) => {
          // Auth-managed mutations: email change, email-verified flip, ban /
          // unban, name updates. The contact's `email_verified` custom field
          // (and the unsubscribed flag, which mirrors banned + opt-in) must
          // mirror the new state.
          await enqueueEmailitSync(user.id);
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          // Every login becomes a `last_active_at` refresh in EmailIt.
          await enqueueEmailitSync(session.userId);
        },
      },
    },
  },
});

export type AuthSession = typeof auth.$Infer.Session;
