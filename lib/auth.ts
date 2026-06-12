import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin } from "better-auth/plugins/admin";
import { magicLink } from "better-auth/plugins/magic-link";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { magicLinkEmail } from "@/lib/email/templates/magic-link";
import { env } from "@/lib/env";

export const auth = betterAuth({
  database: prismaAdapter(db, {
    provider: "postgresql",
  }),
  secret: env.APP_SECRET,
  baseURL: env.NEXT_PUBLIC_APP_URL,
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
