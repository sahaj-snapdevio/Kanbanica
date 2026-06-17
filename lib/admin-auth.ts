import { auth } from "@/lib/auth";
import { headers } from "next/headers";

// Returns the session if the user is a platform admin, otherwise returns null.
export async function getAdminSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  if ((session.user as { role?: string }).role !== "admin") return null;
  return session;
}
