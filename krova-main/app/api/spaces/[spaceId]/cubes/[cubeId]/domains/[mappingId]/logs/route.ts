import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  requireCubeAccess,
  requirePermission,
  requireSpaceMember,
} from "@/lib/api/auth-helpers";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { shellEscape } from "@/lib/ssh";
import { createSshConnection } from "@/lib/ssh/connection";
import { decryptPrivateKey } from "@/lib/ssh/decrypt";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ spaceId: string; cubeId: string; mappingId: string }>;
  }
) {
  try {
    const { spaceId, cubeId, mappingId } = await params;
    const { membership } = await requireSpaceMember(request, spaceId);
    await requirePermission(membership, "cube.view");
    await requireCubeAccess(membership, cubeId);

    // Load domain mapping
    const [mapping] = await db
      .select()
      .from(schema.domainMappings)
      .where(
        and(
          eq(schema.domainMappings.id, mappingId),
          eq(schema.domainMappings.cubeId, cubeId)
        )
      )
      .limit(1);

    if (!mapping) {
      return Response.json(
        { error: "Domain mapping not found" },
        { status: 404 }
      );
    }

    // Load cube → server
    const [cube] = await db
      .select({ serverId: schema.cubes.serverId })
      .from(schema.cubes)
      .where(
        and(eq(schema.cubes.id, cubeId), eq(schema.cubes.spaceId, spaceId))
      )
      .limit(1);

    if (!cube) {
      return Response.json({ error: "Cube not found" }, { status: 404 });
    }

    const [server] = await db
      .select({
        publicIp: schema.servers.publicIp,
        sshPort: schema.servers.sshPort,
        sshKeyId: schema.servers.sshKeyId,
      })
      .from(schema.servers)
      .where(eq(schema.servers.id, cube.serverId))
      .limit(1);

    if (!server) {
      return Response.json({ error: "Server not found" }, { status: 404 });
    }

    const [sshKey] = await db
      .select()
      .from(schema.sshKeys)
      .where(eq(schema.sshKeys.id, server.sshKeyId))
      .limit(1);

    if (!sshKey) {
      return Response.json({ error: "SSH key not found" }, { status: 404 });
    }

    const privateKey = decryptPrivateKey(
      sshKey.encryptedPrivateKey,
      env.APP_SECRET
    );

    const domain = mapping.domain;
    const encoder = new TextEncoder();
    let sshClient: Awaited<ReturnType<typeof createSshConnection>> | null =
      null;
    let closed = false;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          sshClient = await createSshConnection(
            server.publicIp,
            server.sshPort,
            privateKey
          );

          // Tail Caddy access log, filter for this domain using fixed-string grep.
          // Caddy access logs are JSON with "host":"domain" in the request object.
          const escapedDomain = shellEscape(domain);
          const cmd = `tail -n 2000 -f /var/log/caddy/access.log 2>/dev/null | grep -F --line-buffered '"host":"${escapedDomain}"'`;

          sshClient.exec(cmd, (err, channel) => {
            if (err) {
              if (!closed) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ error: err.message })}\n\n`
                  )
                );
                controller.close();
                closed = true;
              }
              sshClient?.end();
              return;
            }

            channel.on("data", (data: Buffer) => {
              if (closed) {
                return;
              }
              const lines = data.toString().split("\n").filter(Boolean);
              for (const line of lines) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ line })}\n\n`)
                );
              }
            });

            channel.stderr.on("data", (data: Buffer) => {
              if (closed) {
                return;
              }
              const lines = data.toString().split("\n").filter(Boolean);
              for (const line of lines) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ line: `[stderr] ${line}` })}\n\n`
                  )
                );
              }
            });

            channel.on("close", () => {
              if (!closed) {
                closed = true;
                controller.close();
              }
              sshClient?.end();
            });
          });
        } catch (err) {
          if (!closed) {
            const message =
              err instanceof Error ? err.message : "SSH connection failed";
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`)
            );
            controller.close();
            closed = true;
          }
        }
      },
      cancel() {
        closed = true;
        sshClient?.end();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET domain logs error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
