import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createSshConnection } from "@/lib/ssh/connection";
import { decryptPrivateKey } from "@/lib/ssh/decrypt";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
    await requireAdmin(request);

    const { serverId } = await params;

    const [server] = await db
      .select({
        id: schema.servers.id,
        publicIp: schema.servers.publicIp,
        sshPort: schema.servers.sshPort,
        sshKeyId: schema.servers.sshKeyId,
      })
      .from(schema.servers)
      .where(eq(schema.servers.id, serverId))
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

          // Stream journalctl with recent 200 lines then follow
          sshClient.exec(
            "journalctl -f --no-pager -n 200 -o short-iso",
            (err, channel) => {
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
            }
          );
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
    console.error("GET /api/orbit/servers/[serverId]/logs error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
