import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_ROLE } from "@/config/platform";
import { user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function getCurrentSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireSession() {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

export async function requireAdmin() {
  const session = await requireSession();
  const [freshUser] = await db
    .select({
      banned: user.banned,
      email: user.email,
      id: user.id,
      role: user.role,
    })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);

  if (!freshUser || freshUser.banned || freshUser.role !== ADMIN_ROLE) {
    redirect("/dashboard");
  }

  return {
    ...session,
    user: {
      ...session.user,
      banned: freshUser.banned,
      email: freshUser.email,
      role: freshUser.role,
    },
  };
}
