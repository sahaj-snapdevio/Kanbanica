import { and, eq } from "drizzle-orm";
import { LOGO_PATH, PRODUCT_NAME } from "@/config/platform";
import { spaceMemberships, spaces, user } from "@/db/schema";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Returns platform branding (productName + logoUrl) for use in emails.
 * logoUrl is an absolute URL derived from NEXT_PUBLIC_APP_URL + LOGO_PATH.
 */
export function getPlatformBranding(): {
  productName: string;
  logoUrl: string;
} {
  return {
    productName: PRODUCT_NAME,
    logoUrl: `${env.NEXT_PUBLIC_APP_URL}${LOGO_PATH}`,
  };
}

/**
 * Format a `Date` for an email as an unambiguous UTC timestamp like
 * `"January 5, 2026 at 14:30 UTC"`. Emails are rendered server-side and read
 * by recipients anywhere on earth, so the timezone label is mandatory — a
 * bare local-formatted date would be ambiguous wherever it lands. Pass
 * `{ dateOnly: true }` to drop the time component (still UTC-anchored).
 */
export function formatEmailDateUtc(
  date: Date,
  options: { dateOnly?: boolean } = {}
): string {
  const datePart = date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  });
  if (options.dateOnly) {
    return `${datePart} (UTC)`;
  }
  const timePart = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: "UTC",
  });
  return `${datePart} at ${timePart} UTC`;
}

/**
 * Returns the space owner's email and name, or null if not found.
 */
export async function getSpaceOwner(
  spaceId: string
): Promise<{ email: string; name: string; spaceName: string } | null> {
  const [row] = await db
    .select({
      email: user.email,
      name: user.name,
      spaceName: spaces.name,
    })
    .from(spaceMemberships)
    .innerJoin(user, eq(spaceMemberships.userId, user.id))
    .innerJoin(spaces, eq(spaceMemberships.spaceId, spaces.id))
    .where(
      and(
        eq(spaceMemberships.spaceId, spaceId),
        eq(spaceMemberships.isOwner, true)
      )
    )
    .limit(1);

  return row ?? null;
}
