import { desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { PRODUCT_NAME } from "@/config/platform";
import { account, auditLogs, session as sessionTable, user } from "@/db/schema";
import { audit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const requestHeaders = await headers();
  const current = await auth.api.getSession({ headers: requestHeaders });
  if (!current) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [profile, sessions, accounts, auditEntries] = await Promise.all([
    db.query.user.findFirst({ where: eq(user.id, current.user.id) }),
    db
      .select({
        createdAt: sessionTable.createdAt,
        expiresAt: sessionTable.expiresAt,
        id: sessionTable.id,
        ipAddress: sessionTable.ipAddress,
        userAgent: sessionTable.userAgent,
      })
      .from(sessionTable)
      .where(eq(sessionTable.userId, current.user.id))
      .orderBy(desc(sessionTable.createdAt)),
    db
      .select({
        createdAt: account.createdAt,
        id: account.id,
        providerId: account.providerId,
      })
      .from(account)
      .where(eq(account.userId, current.user.id)),
    db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.actorId, current.user.id))
      .orderBy(desc(auditLogs.createdAt))
      .limit(5000),
  ]);

  await audit({
    action: "profile.data_exported",
    actorEmail: current.user.email,
    actorId: current.user.id,
    description: "Downloaded account data export",
    entityId: current.user.id,
    entityType: "user",
    metadata: {
      auditCount: auditEntries.length,
      sessionCount: sessions.length,
    },
  });

  const payload = {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    user: profile
      ? {
          createdAt: profile.createdAt.toISOString(),
          email: profile.email,
          emailVerified: profile.emailVerified,
          id: profile.id,
          name: profile.name,
          role: profile.role,
          updatedAt: profile.updatedAt.toISOString(),
        }
      : null,
    sessions: sessions.map((session) => ({
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      id: session.id,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
    })),
    linkedAccounts: accounts.map((linkedAccount) => ({
      createdAt: linkedAccount.createdAt.toISOString(),
      id: linkedAccount.id,
      providerId: linkedAccount.providerId,
    })),
    auditLog: auditEntries.map((entry) => ({
      action: entry.action,
      createdAt: entry.createdAt.toISOString(),
      description: entry.description,
      entityId: entry.entityId,
      entityType: entry.entityType,
      id: entry.id,
      metadata: entry.metadata,
    })),
  };

  const filename = `${PRODUCT_NAME.toLowerCase()}-account-export-${current.user.email.replace(/[^a-z0-9]/gi, "_")}-${new Date().toISOString().slice(0, 10)}.json`;

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
