export const PRODUCT_NAME = "Kanbanica";
export const PRODUCT_DESCRIPTION =
  "A modern project management tool for teams — boards, sprints, and tasks in one place.";
export const LOGO_PATH = "/Kanbanica2.png";

/**
 * Public links — centralised so they live in one place. Self-hosters can
 * override these without touching code via the optional NEXT_PUBLIC_* env vars
 * (inlined at build time); the values below are the defaults.
 */
export const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@kanbanica.com";
export const MARKETING_DOMAIN =
  process.env.NEXT_PUBLIC_MARKETING_DOMAIN ?? "kanbanica.com";

export const ADMIN_ROLE = "admin";
export const USER_ROLE = "user";
