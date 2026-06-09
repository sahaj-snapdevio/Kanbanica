import { SOCIAL_HANDLES } from "@/config/platform";

/**
 * Full profile URLs for every non-empty handle in `SOCIAL_HANDLES`. Used as the
 * Organization `sameAs` array. Blank handles are filtered out, so the structured
 * data only ever lists profiles that actually exist.
 */
export function socialProfileUrls(): string[] {
  const urls: string[] = [];
  if (SOCIAL_HANDLES.x) {
    urls.push(`https://x.com/${SOCIAL_HANDLES.x}`);
  }
  if (SOCIAL_HANDLES.github) {
    urls.push(`https://github.com/${SOCIAL_HANDLES.github}`);
  }
  if (SOCIAL_HANDLES.linkedin) {
    urls.push(`https://www.linkedin.com/${SOCIAL_HANDLES.linkedin}`);
  }
  if (SOCIAL_HANDLES.youtube) {
    urls.push(`https://www.youtube.com/${SOCIAL_HANDLES.youtube}`);
  }
  if (SOCIAL_HANDLES.instagram) {
    urls.push(`https://www.instagram.com/${SOCIAL_HANDLES.instagram}`);
  }
  if (SOCIAL_HANDLES.discord) {
    urls.push(`https://discord.gg/${SOCIAL_HANDLES.discord}`);
  }
  return urls;
}

/**
 * The X/Twitter "@handle" for the Twitter card `site` / `creator`, or
 * `undefined` when unset (so the meta tag is omitted rather than left blank).
 */
export function twitterHandle(): string | undefined {
  return SOCIAL_HANDLES.x ? `@${SOCIAL_HANDLES.x}` : undefined;
}
