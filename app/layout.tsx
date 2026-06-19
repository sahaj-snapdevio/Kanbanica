import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from "@/config/platform";
import { cn } from "@/lib/utils";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: PRODUCT_NAME,
    template: `%s | ${PRODUCT_NAME}`,
  },
  description: PRODUCT_DESCRIPTION,
  icons: {
    icon: "/kanbanica-logo 1.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html className={cn("scroll-smooth font-sans", inter.variable)} lang="en">
      <body suppressHydrationWarning>
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
