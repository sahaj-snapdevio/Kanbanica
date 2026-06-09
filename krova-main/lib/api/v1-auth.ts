import { and, eq, isNull } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { SpaceMembership } from "@/db/schema/types";
import { hashApiKey } from "@/lib/api-keys";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";

/**
 * Authenticate a v1 API request using an X-API-KEY header.
 * Validates the key is not revoked and belongs to the given space.
 * Returns the membership that the key was created under.
 * All authentication attempts (success + failure) are audit-logged.
 */
export async function requireV1ApiKey(
  request: Request,
  spaceId: string
): Promise<{ membership: SpaceMembership; apiKeyId: string }> {
  const apiKey = request.headers.get("x-api-key");
  const reqCtx = extractRequestContext(request.headers);

  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    audit({
      action: "api_key.auth_failed",
      category: "auth",
      actorType: "user",
      actorId: null,
      actorEmail: null,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: "API key authentication failed: missing X-API-KEY header",
      metadata: { reason: "missing_header" },
      source: "api",
      ...reqCtx,
    });

    throw new Response(JSON.stringify({ error: "Missing X-API-KEY header" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const trimmedKey = apiKey.trim();
  const keyHash = hashApiKey(trimmedKey);

  const [keyRow] = await db
    .select()
    .from(schema.apiKeys)
    .where(
      and(
        eq(schema.apiKeys.keyHash, keyHash),
        eq(schema.apiKeys.spaceId, spaceId),
        isNull(schema.apiKeys.revokedAt)
      )
    )
    .limit(1);

  if (!keyRow) {
    audit({
      action: "api_key.auth_failed",
      category: "auth",
      actorType: "user",
      actorId: null,
      actorEmail: null,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: "API key authentication failed: invalid or revoked key",
      metadata: {
        reason: "invalid_or_revoked",
        keyPrefix: trimmedKey.slice(0, 11),
      },
      source: "api",
      ...reqCtx,
    });

    throw new Response(JSON.stringify({ error: "Invalid API key" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Load the membership this key was created under
  const [membership] = await db
    .select()
    .from(schema.spaceMemberships)
    .where(eq(schema.spaceMemberships.id, keyRow.membershipId))
    .limit(1);

  if (!membership) {
    audit({
      action: "api_key.auth_failed",
      category: "auth",
      actorType: "user",
      actorId: keyRow.id,
      actorEmail: null,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: "API key authentication failed: membership no longer exists",
      metadata: {
        reason: "membership_missing",
        keyPrefix: keyRow.keyPrefix,
        apiKeyId: keyRow.id,
      },
      source: "api",
      ...reqCtx,
    });

    throw new Response(
      JSON.stringify({ error: "Invalid API key: membership no longer exists" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // Update lastUsedAt (fire-and-forget, don't block the response)
  db.update(schema.apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiKeys.id, keyRow.id))
    .execute()
    .catch(() => {
      // Silent — best-effort tracking
    });

  return { membership, apiKeyId: keyRow.id };
}
