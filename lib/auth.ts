import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins/admin";
import { magicLink } from "better-auth/plugins/magic-link";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { magicLinkEmail } from "@/lib/email/templates/magic-link";
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
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      overrideUserInfoOnSignIn: true,
      mapProfileToUser: (profile: { picture?: string }) => ({
        image: profile.picture,
      }),
    },
  },
  plugins: [
    admin(),
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        const { subject, html, text } = magicLinkEmail({ url });
        await sendEmail({ to: email, subject, html, text });
      },
    }),
  ],
});
