import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins/admin";
import { magicLink } from "better-auth/plugins/magic-link";
import { PRODUCT_NAME } from "@/config/platform";
import * as schema from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";
import { emailChangeTemplate } from "@/lib/email/templates/email-change";
import { magicLinkTemplate } from "@/lib/email/templates/magic-link";
import { env } from "@/lib/env";

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
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      const { html, text } = await emailChangeTemplate({
        newEmail: user.email,
        verifyUrl: url,
      });
      await enqueueEmail({
        to: user.email,
        subject: `Confirm your new email address for ${PRODUCT_NAME}`,
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
  plugins: [
    admin({
      impersonationSessionDuration: 3600,
      allowImpersonatingAdmins: false,
    }),
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        // Dev convenience: print the link so you can sign in without SMTP.
        // Never log the email + magic-link URL in production (sensitive).
        if (env.NODE_ENV !== "production") {
          console.log(`[magic-link] ${email} → ${url}`);
        }
        const { html, text } = await magicLinkTemplate({
          email,
          magicLinkUrl: url,
        });

        await enqueueEmail({
          to: email,
          subject: `Sign in to ${PRODUCT_NAME}`,
          html,
          text,
        });

        await audit({
          action: "auth.magic_link_sent",
          actorEmail: email,
          description: `Magic link sent to ${email}`,
          entityType: "user",
          metadata: { email },
        });
      },
    }),
  ],
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60,
    },
  },
  // Throttle auth endpoints (in-memory store; fine for a single instance).
  // Stricter limits on the credential/magic-link entry points to curb abuse
  // (magic-link email spam, password guessing).
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/magic-link": { window: 60, max: 5 },
      "/sign-in/email": { window: 60, max: 10 },
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await audit({
            action: "user.created",
            actorEmail: user.email,
            actorId: user.id,
            description: `User created: ${user.email}`,
            entityId: user.id,
            entityType: "user",
          });
        },
      },
    },
  },
});
