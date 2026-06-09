import { env } from "@/lib/env";

export function siteUrl(path = "/"): string {
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
  if (!path || path === "/") {
    return `${base}/`;
  }
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

export function siteOrigin(): URL {
  return new URL(env.NEXT_PUBLIC_APP_URL);
}
