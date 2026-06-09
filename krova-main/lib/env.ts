import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_SECRET: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.url(),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // Google OAuth credentials (env-only, required)
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  // EmailIt — transactional email delivery + marketing contact sync
  // (https://emailit.com/docs/api-reference/)
  EMAILIT_API_KEY: z.string().min(1),
  EMAILIT_FROM: z.string().min(1),
  // EmailIt webhook signing secret (`whsec_…`), created in the EmailIt
  // dashboard (Webhooks → Webhook secret). Used to verify the HMAC-SHA256
  // signature on inbound webhook deliveries. Optional: when unset, the
  // webhook route rejects all deliveries (503) — set it once the webhook
  // exists in EmailIt.
  EMAILIT_WEBHOOK_SECRET: z.string().min(1).optional(),
  // EmailIt audience id (aud_xxx) that synced marketing contacts join.
  // Optional: when unset, contact sync is inert (transactional email and
  // webhooks still work). Create the audience in the EmailIt dashboard.
  EMAILIT_AUDIENCE_ID: z.string().min(1).optional(),

  // Pusher / Soketi (real-time WebSocket)
  PUSHER_APP_ID: z.string().min(1),
  PUSHER_KEY: z.string().min(1),
  PUSHER_SECRET: z.string().min(1),
  PUSHER_CLUSTER: z.string().min(1).optional(),
  PUSHER_HOST: z.string().min(1).optional(),
  PUSHER_PORT: z.coerce.number().optional(),

  // Cloudflare for SaaS — custom domain routing.
  // See docs/superpowers/specs/2026-05-16-cloudflare-for-saas-design.md.
  // All optional: the app boots without them. `pnpm cloudflare:check`
  // validates presence + correctness before integration code runs.
  CLOUDFLARE_API_TOKEN: z.string().min(1).optional(),
  CLOUDFLARE_ZONE_ID: z.string().min(1).optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1).optional(),
  CLOUDFLARE_ORIGIN_CERT: z.string().min(1).optional(),
  CLOUDFLARE_ORIGIN_KEY: z.string().min(1).optional(),

  // Polar.sh — only the secrets + runtime mode live in env. The product /
  // meter IDs are operator-managed via the DB (`plans.polarProductId` for
  // each subscription product, `platform_settings.polarCreditProductId` for
  // top-up, `platform_settings.polarOverageMeterId` for overage). All
  // optional — the app boots without them and every Polar code path is
  // inert until they are populated.
  POLAR_ACCESS_TOKEN: z.string().min(1).optional(),
  POLAR_WEBHOOK_SECRET: z.string().min(1).optional(),
  POLAR_SERVER: z.enum(["sandbox", "production"]).default("sandbox"),

  // Google Tag Manager container id (`GTM-XXXXXXX`), wired into
  // `@analytics/google-tag-manager` via the AnalyticsProvider in the root
  // layout. Public — ships to the browser as `NEXT_PUBLIC_*`.
  // Optional: when unset, the AnalyticsProvider renders children verbatim
  // and every `analytics.track()` / `useAnalytics().track()` is a no-op.
  // Operators configure GA4 + any other vendor tags inside the GTM
  // workspace; the customer-facing GA4 measurement id lives in GTM, not
  // here.
  NEXT_PUBLIC_GTM_CONTAINER_ID: z
    .string()
    .regex(/^GTM-[A-Z0-9]+$/, "Must be a GTM container id (GTM-XXXXXXX)")
    .optional(),

  // TEST-ONLY escape hatch for the on-host E2E harness (`pnpm test:e2e`). When
  // set to "true", the `install` setup phase skips ONLY the Cloudflare-for-SaaS
  // origin-DNS sub-step (everything else — Firecracker/jailer/restic/caddy/
  // rclone installs, host hardening, vsock helpers — runs unchanged), so a
  // throwaway dev server can be set up faithfully without prod Cloudflare creds
  // or polluting prod DNS. NEVER set this in production: a real server without
  // a Cloudflare origin cannot host customer custom domains. Unset/false in
  // prod ⇒ the phase behaves exactly as before (hard-fails on missing CF env).
  KROVA_E2E_SKIP_CLOUDFLARE: z.enum(["true", "false"]).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.issues);
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;
