import { z } from "zod";

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional()
);

// Dev-only convenience defaults so a fresh clone runs for local development
// without hand-editing a .env first. In production these three remain REQUIRED
// and the app fails fast if any is missing — so runtime behavior for configured
// deployments (dev with .env, or production) is unchanged.
const isProduction = process.env.NODE_ENV === "production";
const DEV_DATABASE_URL = "postgresql://krova:krova@localhost:54329/krova";

const envSchema = z.object({
  DATABASE_URL: isProduction
    ? z.string().min(1)
    : z.string().min(1).default(DEV_DATABASE_URL),
  APP_SECRET: isProduction
    ? z.string().min(1)
    : z.string().min(1).default("dev-only-insecure-app-secret-change-me"),
  NEXT_PUBLIC_APP_URL: isProduction
    ? z.url()
    : z.url().default("http://localhost:3000"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  SMTP_HOST: optionalString,
  SMTP_PORT: z.preprocess((v) => (v ? Number(v) : undefined), z.number().optional()),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  EMAIL_FROM: optionalString,
  EMAIL_WEBHOOK_SECRET: optionalString,
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  STORAGE_DRIVER: z.enum(["local", "s3", "r2"]).default("local"),
  S3_ENDPOINT: z.string().min(1).default("http://localhost:9000"),
  S3_REGION: z.string().min(1).default("auto"),
  S3_BUCKET: z.string().min(1).default("kanbanica"),
  S3_ACCESS_KEY_ID: z.string().min(1).default("minioadmin"),
  S3_SECRET_ACCESS_KEY: z.string().min(1).default("minioadmin"),
  S3_PUBLIC_URL: optionalString,
  VAPID_PUBLIC_KEY: optionalString,
  VAPID_PRIVATE_KEY: optionalString,
  VAPID_SUBJECT: optionalString,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: optionalString,
  // Optional branding overrides for self-hosters (defaults live in config/platform.ts).
  NEXT_PUBLIC_SUPPORT_EMAIL: optionalString,
  NEXT_PUBLIC_MARKETING_DOMAIN: optionalString,
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.issues);
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;

// In production, require at least one working authentication provider so login
// cannot silently break. Either full SMTP (enables magic-link delivery) OR
// Google OAuth is enough — SMTP is not mandatory. In development, magic links
// are logged to the console, so no provider is required. Skipped during
// `next build` (no runtime env yet) — the check runs when the server boots.
if (
  env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build"
) {
  const smtpConfigured = !!(
    env.SMTP_HOST &&
    env.SMTP_USER &&
    env.SMTP_PASS &&
    env.EMAIL_FROM
  );
  const googleConfigured = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

  if (!smtpConfigured && !googleConfigured) {
    throw new Error(
      "No authentication provider configured. In production you must set either " +
        "SMTP (SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_FROM) so magic links can be " +
        "delivered, or Google OAuth (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET). " +
        "Without one of these, users cannot log in."
    );
  }
}
