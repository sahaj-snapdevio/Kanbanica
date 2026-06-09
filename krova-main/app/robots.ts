import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/docs/", "/terms", "/privacy", "/aup", "/cookies"],
        disallow: [
          "/api/",
          "/orbit/",
          "/post-auth",
          "/login",
          "/signup",
          "/forgot-password",
          "/reset-password",
          "/verify-email",
          "/spaces/",
        ],
      },
    ],
    sitemap: siteUrl("/sitemap.xml"),
    host: siteUrl("/").replace(/\/$/, ""),
  };
}
