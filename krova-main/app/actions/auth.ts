"use server";

import { headers } from "next/headers";
import { audit, extractRequestContext } from "@/lib/audit";
import { auth } from "@/lib/auth";

export async function logoutAction() {
  try {
    const hdrs = await headers();
    const session = await auth.api.getSession({ headers: hdrs });

    await auth.api.signOut({ headers: hdrs });

    if (session) {
      audit({
        action: "auth.logout",
        category: "auth",
        actorType: "user",
        actorId: session.user.id,
        actorEmail: session.user.email,
        entityType: "user",
        entityId: session.user.id,
        description: `User logged out: ${session.user.email}`,
        source: "web",
        ...extractRequestContext(hdrs),
      });
    }

    return { success: true };
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "Logout failed" };
  }
}
