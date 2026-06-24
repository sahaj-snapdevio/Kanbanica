import type { Metadata } from "next";
import { redirect } from "next/navigation";
import LandingPage from "@/components/landing-page";
import {
  LOGO_PATH,
  PRODUCT_DESCRIPTION,
  PRODUCT_NAME,
} from "@/config/platform";
import { getCurrentSession } from "@/lib/authz";

const title = `${PRODUCT_NAME} — Project management your team will actually use`;

export const metadata: Metadata = {
  title,
  description: PRODUCT_DESCRIPTION,
  applicationName: PRODUCT_NAME,
  keywords: [
    "project management",
    "kanban",
    "sprints",
    "task management",
    "open source",
    PRODUCT_NAME,
  ],
  openGraph: {
    title,
    description: PRODUCT_DESCRIPTION,
    siteName: PRODUCT_NAME,
    type: "website",
    images: [{ url: LOGO_PATH }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description: PRODUCT_DESCRIPTION,
    images: [LOGO_PATH],
  },
};

export default async function HomePage() {
  const session = await getCurrentSession();
  if (session) {
    redirect("/post-auth");
  }

  return <LandingPage />;
}
