import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/authz";
import LandingPage from "@/components/landing-page";

export default async function HomePage() {
  const session = await getCurrentSession();
  if (session) redirect("/post-auth");

  return <LandingPage />;
}
