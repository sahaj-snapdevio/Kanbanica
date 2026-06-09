import { PLATFORM_BASE_DOMAIN, PRODUCT_NAME } from "@/config/platform";
import type { FaqEntry } from "@/lib/seo/faq-data";
import { siteUrl } from "@/lib/seo/site";
import { socialProfileUrls } from "@/lib/seo/social";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export function JsonLd({ data }: { data: Json }) {
  return (
    <script
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD is required to be inline <script>
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
      type="application/ld+json"
    />
  );
}

export function organizationJsonLd(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${siteUrl("/")}#organization`,
    name: PRODUCT_NAME,
    url: siteUrl("/"),
    logo: siteUrl("/logo.png"),
    description: `${PRODUCT_NAME} is a self-service cloud platform that runs lightweight Firecracker microVMs (Cubes) on dedicated bare-metal servers — each Cube gets its own kernel and hardware-enforced isolation, the same technology behind AWS Lambda, with per-hour billing and full root SSH.`,
    sameAs: socialProfileUrls(),
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: `support@${PLATFORM_BASE_DOMAIN}`,
        availableLanguage: ["English"],
      },
    ],
  };
}

export function websiteJsonLd(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${siteUrl("/")}#website`,
    name: PRODUCT_NAME,
    url: siteUrl("/"),
    publisher: { "@id": `${siteUrl("/")}#organization` },
    inLanguage: "en-US",
  };
}

export function softwareApplicationJsonLd(params: {
  description: string;
  startingPriceUsd: number;
}): Json {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: PRODUCT_NAME,
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "Cloud Infrastructure",
    operatingSystem: "Linux",
    description: params.description,
    url: siteUrl("/"),
    image: siteUrl("/logo.png"),
    offers: {
      "@type": "Offer",
      price: params.startingPriceUsd.toFixed(2),
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      url: siteUrl("/pricing"),
    },
    provider: { "@id": `${siteUrl("/")}#organization` },
  };
}

export function faqPageJsonLd(items: FaqEntry[]): Json {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

export function breadcrumbJsonLd(
  items: { name: string; path: string }[]
): Json {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: item.name,
      item: siteUrl(item.path),
    })),
  };
}

export function techArticleJsonLd(params: {
  headline: string;
  description: string;
  path: string;
  dateModified?: string;
}): Json {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: params.headline,
    description: params.description,
    url: siteUrl(params.path),
    inLanguage: "en-US",
    isPartOf: { "@id": `${siteUrl("/")}#website` },
    publisher: { "@id": `${siteUrl("/")}#organization` },
    ...(params.dateModified ? { dateModified: params.dateModified } : {}),
  };
}
