import { count } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { encryptPrivateKey } from "@/lib/ssh/decrypt";
import { deriveKeyInfo } from "@/lib/ssh/keypair";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);

    const keys = await db.select().from(schema.sshKeys);

    // Count usage: how many servers reference each key. Storage backends use
    // S3 access keys (not SSH keys) so they never appear here.
    const serverCounts = await db
      .select({
        sshKeyId: schema.servers.sshKeyId,
        count: count(schema.servers.id),
      })
      .from(schema.servers)
      .groupBy(schema.servers.sshKeyId);

    const serverCountMap = new Map(
      serverCounts.map((s) => [s.sshKeyId, Number(s.count)])
    );

    const sshKeys = keys.map((key) => ({
      id: key.id,
      name: key.name,
      fingerprint: key.fingerprint,
      createdAt: key.createdAt,
      serverCount: serverCountMap.get(key.id) ?? 0,
    }));

    return Response.json({ sshKeys });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET /api/orbit/ssh-keys error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAdmin(request);

    const body = await request.json();
    const { name, privateKey } = body;

    if (!name || !privateKey) {
      return Response.json(
        { error: "Missing required fields: name, privateKey" },
        { status: 400 }
      );
    }

    if (typeof name !== "string" || name.trim().length === 0) {
      return Response.json(
        { error: "Name must be a non-empty string" },
        { status: 400 }
      );
    }

    if (typeof privateKey !== "string" || privateKey.trim().length === 0) {
      return Response.json(
        { error: "Private key must be a non-empty string" },
        { status: 400 }
      );
    }

    const normalizedKey = privateKey.replace(/\r\n/g, "\n").trim() + "\n";

    let derived;
    try {
      derived = deriveKeyInfo(normalizedKey);
    } catch (err) {
      return Response.json(
        {
          error: err instanceof Error ? err.message : "Invalid SSH private key",
        },
        { status: 400 }
      );
    }

    const encryptedPrivateKey = encryptPrivateKey(
      normalizedKey,
      env.APP_SECRET
    );

    const [sshKey] = await db
      .insert(schema.sshKeys)
      .values({
        name: name.trim(),
        encryptedPrivateKey,
        publicKey: derived.publicKey,
        fingerprint: derived.fingerprint,
      })
      .returning();

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "ssh_key.create",
      category: "platform",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "ssh_key",
      entityId: sshKey.id,
      description: `Admin created SSH key "${sshKey.name}"`,
      metadata: { name: sshKey.name },
      source: "api",
      ...reqCtx,
    });

    return Response.json(
      {
        sshKey: {
          id: sshKey.id,
          name: sshKey.name,
          fingerprint: sshKey.fingerprint,
          createdAt: sshKey.createdAt,
          serverCount: 0,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST /api/orbit/ssh-keys error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
