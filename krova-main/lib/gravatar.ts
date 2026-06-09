import { createHash } from "crypto";

/**
 * Returns a Gravatar image URL for the given email address.
 * Falls back to an "identicon" (unique geometric pattern) if
 * no Gravatar is associated with the email.
 */
export function getGravatarUrl(email: string, size = 80): string {
  const hash = createHash("md5")
    .update(email.trim().toLowerCase())
    .digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?d=identicon&s=${size}`;
}
