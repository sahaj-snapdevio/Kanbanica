/**
 * Load a server's SSH credentials from DB and open an SSH connection.
 *
 * This pattern is used by every worker handler that operates on a server.
 * Centralizing it eliminates ~150 lines of duplicated boilerplate.
 */

import { Socket } from "node:net";
import { eq } from "drizzle-orm";
import type { Client } from "ssh2";
import { servers, sshKeys } from "@/db/schema";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createSshConnection } from "@/lib/ssh/connection";
import { decryptPrivateKey } from "@/lib/ssh/decrypt";

type ServerRow = typeof servers.$inferSelect;

/**
 * Load a server by ID, decrypt its SSH key, and open a connection.
 * Throws if the server or SSH key is not found.
 *
 * Caller is responsible for calling `client.end()` when done (typically in a finally block).
 */
export async function connectToServer(
  serverId: string
): Promise<{ server: ServerRow; client: Client }> {
  const server = await db.query.servers.findFirst({
    where: eq(servers.id, serverId),
  });
  if (!server) {
    throw new Error(`Server ${serverId} not found`);
  }

  const sshKey = await db.query.sshKeys.findFirst({
    where: eq(sshKeys.id, server.sshKeyId),
  });
  if (!sshKey) {
    throw new Error(`SSH key ${server.sshKeyId} not found`);
  }

  const decryptedKey = decryptPrivateKey(
    sshKey.encryptedPrivateKey,
    env.APP_SECRET
  );

  const client = await createSshConnection(
    server.publicIp,
    server.sshPort,
    decryptedKey
  );

  return { server, client };
}

/**
 * Lightweight liveness probe: a single raw TCP connect to the server's SSH
 * port (no SSH handshake, no key decryption, no retries). Resolves `true` if
 * the port accepts a connection within `timeoutMs`, `false` on timeout /
 * refused / EHOSTUNREACH / missing server.
 *
 * Used as a preflight before writing an in-progress row (snapshot/backup/
 * import) or attempting an auto-recovery boot, so a host that's down doesn't
 * strand the row in a half-state. NOTE: this is a best-effort point-in-time
 * check — the host can still drop in the window between the probe and the
 * real operation, so callers that mutate state must STILL handle a later
 * connect failure (the guarded `connectToServer` in the handlers does this).
 */
export async function isServerReachable(
  serverId: string,
  timeoutMs = 4000
): Promise<boolean> {
  const server = await db.query.servers.findFirst({
    where: eq(servers.id, serverId),
    columns: { publicIp: true, sshPort: true },
  });
  if (!server) {
    return false;
  }
  return probeTcp(server.publicIp, server.sshPort, timeoutMs);
}

function probeTcp(
  host: string,
  port: number,
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}
