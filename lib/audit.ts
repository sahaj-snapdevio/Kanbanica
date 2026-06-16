import { auditLogs } from "@/db/schema";
import { db } from "@/lib/db";

export interface AuditInput {
  action: string;
  actorEmail?: string | null;
  actorId?: string | null;
  description: string;
  entityId?: string | null;
  entityType: string;
  metadata?: Record<string, unknown>;
}

export async function audit(input: AuditInput) {
  try {
    await db.insert(auditLogs).values({
      action: input.action,
      actorEmail: input.actorEmail ?? null,
      actorId: input.actorId ?? null,
      description: input.description,
      entityId: input.entityId ?? null,
      entityType: input.entityType,
      metadata: input.metadata,
    });
  } catch (error) {
    console.error("[audit] failed to write audit log", error);
  }
}
