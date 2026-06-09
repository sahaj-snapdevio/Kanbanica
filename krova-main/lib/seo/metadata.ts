import type { Metadata } from "next";
import { PRODUCT_NAME } from "@/config/platform";
import { twitterHandle } from "@/lib/seo/social";

type OpenGraphInput = NonNullable<Metadata["openGraph"]>;
type TwitterInput = NonNullable<Metadata["twitter"]>;

export function pageOpenGraph(
  partial: Partial<OpenGraphInput> & { url: string }
): OpenGraphInput {
  return {
    type: "website",
    locale: "en_US",
    siteName: PRODUCT_NAME,
    images: ["/opengraph-image"],
    ...partial,
  };
}

export function pageTwitter(partial: Partial<TwitterInput>): TwitterInput {
  const handle = twitterHandle();
  return {
    card: "summary_large_image",
    images: ["/opengraph-image"],
    ...(handle ? { site: handle, creator: handle } : {}),
    ...partial,
  };
}
