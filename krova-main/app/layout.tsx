import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Script from "next/script";

import "@/app/globals.css";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { CookieConsent } from "@/components/cookie-consent";
import { DeploymentSkewReload } from "@/components/deployment-skew-reload";
import { GtmScripts } from "@/components/gtm-scripts";
import { SWRProvider } from "@/components/swr-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PLATFORM_EMAILS, PRODUCT_NAME } from "@/config/platform";
import { CONSENT_STORAGE_KEY } from "@/lib/cookie-consent";
import { env } from "@/lib/env";
import { siteOrigin } from "@/lib/seo/site";
import { twitterHandle } from "@/lib/seo/social";
import { cn } from "@/lib/utils";

const fontSans = localFont({
  src: "../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2",
  variable: "--font-sans",
  display: "swap",
  weight: "100 900",
});

const jetbrainsMono = localFont({
  src: "../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  variable: "--font-mono",
  display: "swap",
  weight: "100 800",
});

const PRODUCT_TAGLINE = `${PRODUCT_NAME} — Hardware-isolated cloud servers, no public IP`;
const PRODUCT_DESCRIPTION =
  "Hardware-isolated microVMs with their own kernel and no public IP — full root SSH, Cloudflare-protected, billed by the minute. Half the price of big VPS.";
const TWITTER_HANDLE = twitterHandle();

export const metadata: Metadata = {
  metadataBase: siteOrigin(),
  title: {
    default: PRODUCT_TAGLINE,
    template: `%s | ${PRODUCT_NAME}`,
  },
  description: PRODUCT_DESCRIPTION,
  applicationName: PRODUCT_NAME,
  generator: "Next.js",
  referrer: "origin-when-cross-origin",
  keywords: [
    "cloud VPS",
    "bare metal cloud",
    "micro VM",
    "Firecracker",
    "Firecracker microVM",
    "no public IP server",
    "hardware-isolated VM",
    "VPS alternative",
    "cheap cloud hosting",
    "AWS Lightsail alternative",
    "DigitalOcean alternative",
    "Linode alternative",
    "per-hour cloud billing",
    "Linux server hosting",
    "SSH cloud VM",
    "developer cloud",
    "custom domains with HTTPS",
    "Cloudflare DDoS",
    `${PRODUCT_NAME} cloud`,
  ],
  authors: [{ name: PRODUCT_NAME }],
  creator: PRODUCT_NAME,
  publisher: PRODUCT_NAME,
  category: "technology",
  formatDetection: { email: false, address: false, telephone: false },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: PRODUCT_NAME,
    title: PRODUCT_TAGLINE,
    description: PRODUCT_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: PRODUCT_TAGLINE,
    description: PRODUCT_DESCRIPTION,
    ...(TWITTER_HANDLE
      ? { site: TWITTER_HANDLE, creator: TWITTER_HANDLE }
      : {}),
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: [{ url: "/favicon.ico" }],
  },
  manifest: "/manifest.webmanifest",
  other: {
    "reply-to": PLATFORM_EMAILS.support,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const gtmId = env.NEXT_PUBLIC_GTM_CONTAINER_ID;
  return (
    <html
      className={cn(
        "antialiased",
        fontSans.variable,
        "font-mono",
        jetbrainsMono.variable
      )}
      lang="en"
      suppressHydrationWarning
    >
      <body>
        <DeploymentSkewReload />
        {gtmId && (
          <Script id="consent-default" strategy="beforeInteractive">
            {`(function(){var w=window;w.dataLayer=w.dataLayer||[];function gtag(){w.dataLayer.push(arguments);}w.gtag=gtag;var d={ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied'};try{var s=JSON.parse(w.localStorage.getItem('${CONSENT_STORAGE_KEY}'));if(s&&(s.analytics_storage==='granted'||s.analytics_storage==='denied')){d.ad_storage=s.ad_storage==='granted'?'granted':'denied';d.ad_user_data=s.ad_user_data==='granted'?'granted':'denied';d.ad_personalization=s.ad_personalization==='granted'?'granted':'denied';d.analytics_storage=s.analytics_storage;}}catch(e){}d.wait_for_update=500;gtag('consent','default',d);})();`}
          </Script>
        )}
        {/* GTM container + noscript fallback — customer-facing routes only,
            never the Orbit admin. Gated client-side because the root layout
            cannot read the pathname. */}
        <GtmScripts gtmId={gtmId} />
        <ThemeProvider>
          <SWRProvider>
            <TooltipProvider>
              <AnalyticsProvider containerId={gtmId}>
                {children}
              </AnalyticsProvider>
              <Toaster />
              <CookieConsent enabled={!!gtmId} />
            </TooltipProvider>
          </SWRProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
