import { count, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { encryptPrivateKey } from "@/lib/ssh/decrypt";
import { deriveKeyInfo } from "@/lib/ssh/keypair";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ keyId: string }> }
) {
  try {
    const session = await requireAdmin(request);
    const { keyId } = await params;
    const body = await request.json();
    const { name, privateKey } = body;

    const [existing] = await db
      .select()
      .from(schema.sshKeys)
      .where(eq(schema.sshKeys.id, keyId))
      .limit(1);

    if (!existing) {
      return Response.json({ error: "SSH key not found" }, { status: 404 });
    }

    if (name === undefined && privateKey === undefined) {
      return Response.json(
        { error: "At least one field is required" },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        return Response.json(
          { error: "Name must be a non-empty string" },
          { status: 400 }
        );
      }
      updates.name = name.trim();
    }
    if (privateKey && typeof privateKey === "string") {
      const normalizedKey = privateKey.replace(/\r\n/g, "\n").trim() + "\n";
      let derived;
      try {
        derived = deriveKeyInfo(normalizedKey);
      } catch (err) {
        return Response.json(
          {
            error:
              err instanceof Error ? err.message : "Invalid SSH private key",
          },
          { status: 400 }
        );
      }
      updates.encryptedPrivateKey = encryptPrivateKey(
        normalizedKey,
        env.APP_SECRET
      );
      updates.publicKey = derived.publicKey;
      updates.fingerprint = derived.fingerprint;
    }

    const [updated] = await db
      .update(schema.sshKeys)
      .set(updates)
      .where(eq(schema.sshKeys.id, keyId))
      .returning();

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "ssh_key.update",
      category: "platform",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "ssh_key",
      entityId: keyId,
      description: `Admin updated SSH key "${updated.name}"`,
      metadata: {
        name: updated.name,
        privateKeyChanged: !!privateKey,
      },
      source: "api",
      ...reqCtx,
    });

    return Response.json({
      sshKey: {
        id: updated.id,
        name: updated.name,
        createdAt: updated.createdAt,
      },
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("PATCH /api/orbit/ssh-keys/[keyId] error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ keyId: string }> }
) {
  try {
    const session = await requireAdmin(request);
    const { keyId } = await params;

    const [existing] = await db
      .select()
      .from(schema.sshKeys)
      .where(eq(schema.sshKeys.id, keyId))
      .limit(1);

    if (!existing) {
      return Response.json({ error: "SSH key not found" }, { status: 404 });
    }

    // Check if any servers reference this key
    const [serverRef] = await db
      .select({ count: count(schema.servers.id) })
      .from(schema.servers)
      .where(eq(schema.servers.sshKeyId, keyId));

    if (serverRef && Number(serverRef.count) > 0) {
      return Response.json(
        {
          error: `Cannot delete SSH key — ${serverRef.count} server(s) still reference it.`,
        },
        { status: 409 }
      );
    }

    await db.delete(schema.sshKeys).where(eq(schema.sshKeys.id, keyId));

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "ssh_key.delete",
      category: "platform",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "ssh_key",
      entityId: keyId,
      description: `Admin deleted SSH key "${existing.name}"`,
      metadata: { name: existing.name },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("DELETE /api/orbit/ssh-keys/[keyId] error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
