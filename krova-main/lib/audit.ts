import * as schema from "@/db/schema";
import { db } from "@/lib/db";

type AuditCategory = (typeof schema.auditCategory.enumValues)[number];
type AuditActorType = (typeof schema.auditActorType.enumValues)[number];

export type AuditLogEntry = {
  action: string;
  category: AuditCategory;
  actorType: AuditActorType;
  actorId?: string | null;
  actorEmail?: string | null;
  entityType: string;
  entityId?: string | null;
  spaceId?: string | null;
  metadata?: Record<string, unknown> | null;
  description?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  source?: "web" | "api" | "worker" | "system";
};

/**
 * Write a single audit log entry. Fire-and-forget — errors are logged
 * to console but never thrown so callers are never disrupted.
 */
export async function audit(entry: AuditLogEntry): Promise<void> {
  try {
    await db.insert(schema.auditLogs).values({
      action: entry.action,
      category: entry.category,
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      actorEmail: entry.actorEmail ?? null,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      spaceId: entry.spaceId ?? null,
      metadata: entry.metadata ?? null,
      description: entry.description ?? null,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
      source: entry.source ?? "web",
    });
  } catch (err) {
    console.error("[audit] failed to write audit log:", err, entry);
  }
}

/**
 * Write multiple audit log entries in a single INSERT.
 */
export async function auditBatch(entries: AuditLogEntry[]): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  try {
    await db.insert(schema.auditLogs).values(
      entries.map((entry) => ({
        action: entry.action,
        category: entry.category,
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        actorEmail: entry.actorEmail ?? null,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        spaceId: entry.spaceId ?? null,
        metadata: entry.metadata ?? null,
        description: entry.description ?? null,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
        source: entry.source ?? "web",
      }))
    );
  } catch (err) {
    console.error("[audit] failed to write batch audit logs:", err);
  }
}

// ---------------------------------------------------------------------------
// Helpers for extracting request context in server actions & API routes
// ---------------------------------------------------------------------------

/**
 * Extract IP address and user-agent from Next.js headers.
 * Works in both server actions (via `headers()`) and API routes (via `request.headers`).
 */
export function extractRequestContext(hdrs: Headers): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const ipAddress =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    hdrs.get("x-real-ip") ??
    null;
  const userAgent = hdrs.get("user-agent") ?? null;
  return { ipAddress, userAgent };
}
