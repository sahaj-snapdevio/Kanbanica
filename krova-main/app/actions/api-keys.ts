"use server";

import { and, desc, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import * as schema from "@/db/schema";
import { generateApiKey } from "@/lib/api-keys";
import { audit, extractRequestContext } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function getApiKeys(spaceId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" as const };
  }

  const [membership] = await db
    .select()
    .from(schema.spaceMemberships)
    .where(
      and(
        eq(schema.spaceMemberships.userId, session.user.id),
        eq(schema.spaceMemberships.spaceId, spaceId)
      )
    )
    .limit(1);

  if (!membership) {
    return { error: "Forbidden" as const };
  }

  const keys = await db
    .select({
      id: schema.apiKeys.id,
      name: schema.apiKeys.name,
      keyPrefix: schema.apiKeys.keyPrefix,
      lastUsedAt: schema.apiKeys.lastUsedAt,
      revokedAt: schema.apiKeys.revokedAt,
      createdAt: schema.apiKeys.createdAt,
    })
    .from(schema.apiKeys)
    .where(
      and(eq(schema.apiKeys.spaceId, spaceId), isNull(schema.apiKeys.revokedAt))
    )
    .orderBy(desc(schema.apiKeys.createdAt));

  return { keys };
}

export async function createApiKey(spaceId: string, name: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" as const };
  }

  const [membership] = await db
    .select()
    .from(schema.spaceMemberships)
    .where(
      and(
        eq(schema.spaceMemberships.userId, session.user.id),
        eq(schema.spaceMemberships.spaceId, spaceId)
      )
    )
    .limit(1);

  if (!membership) {
    return { error: "Forbidden" as const };
  }

  const { fullKey, keyPrefix, keyHash } = generateApiKey();

  const [created] = await db
    .insert(schema.apiKeys)
    .values({
      spaceId,
      membershipId: membership.id,
      name,
      keyPrefix,
      keyHash,
    })
    .returning({ id: schema.apiKeys.id });

  const headersList = await headers();
  const reqCtx = extractRequestContext(headersList);
  audit({
    action: "api_key.created",
    category: "space",
    actorType: "user",
    actorId: session.user.id,
    actorEmail: session.user.email,
    entityType: "space",
    entityId: spaceId,
    spaceId,
    description: `Created API key "${name}"`,
    metadata: { keyName: name, keyPrefix },
    source: "web",
    ...reqCtx,
  });

  return { apiKey: fullKey, keyPrefix, id: created.id };
}

export async function revokeApiKey(spaceId: string, keyId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" as const };
  }

  const [membership] = await db
    .select()
    .from(schema.spaceMemberships)
    .where(
      and(
        eq(schema.spaceMemberships.userId, session.user.id),
        eq(schema.spaceMemberships.spaceId, spaceId)
      )
    )
    .limit(1);

  if (!membership) {
    return { error: "Forbidden" as const };
  }

  const [keyRow] = await db
    .select({ id: schema.apiKeys.id, name: schema.apiKeys.name })
    .from(schema.apiKeys)
    .where(
      and(eq(schema.apiKeys.id, keyId), eq(schema.apiKeys.spaceId, spaceId))
    )
    .limit(1);

  if (!keyRow) {
    return { error: "API key not found" as const };
  }

  await db
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(schema.apiKeys.id, keyId));

  const headersList = await headers();
  const reqCtx = extractRequestContext(headersList);
  audit({
    action: "api_key.revoked",
    category: "space",
    actorType: "user",
    actorId: session.user.id,
    actorEmail: session.user.email,
    entityType: "space",
    entityId: spaceId,
    spaceId,
    description: `Revoked API key "${keyRow.name}"`,
    metadata: { keyName: keyRow.name },
    source: "web",
    ...reqCtx,
  });

  return { success: true };
}
