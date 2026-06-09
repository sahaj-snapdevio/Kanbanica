/**
 * Encrypt/decrypt operator-supplied bootstrap SSH credentials so they can be
 * carried inside a pg-boss job payload (which is stored at-rest in postgres).
 *
 * Reuses the same AES-256-GCM/PBKDF2 envelope as `encryptPrivateKey` — that
 * helper is named for SSH keys but is generic AES; we pass it a JSON-stringified
 * BootstrapCreds object. APP_SECRET is the encryption key.
 *
 * pg-boss retention note:
 *   When a job completes (success OR failure), pg-boss moves the row from
 *   `pgboss.job` into `pgboss.archive` and keeps it for the configured
 *   archive interval (default ~7 days, see pg-boss `archiveCompletedAfterSeconds`).
 *   That means the encrypted creds blob lingers in the DB for that retention
 *   window. Operators concerned about even the encrypted ciphertext sitting
 *   around can either:
 *     (a) configure a shorter `archiveCompletedAfterSeconds` on PgBoss init, or
 *     (b) run a one-shot DELETE against `pgboss.archive` filtered to
 *         `name = 'server.bootstrap'` after a successful setup.
 *   The blob itself is AES-256-GCM with a fresh PBKDF2 salt + IV per
 *   encryption, so leakage of the at-rest copy without APP_SECRET is not a
 *   credential disclosure.
 */

import { env } from "@/lib/env";
import { decryptPrivateKey, encryptPrivateKey } from "@/lib/ssh/decrypt";

export interface BootstrapCreds {
  initialPort: number;
  initialUser: string;
  password?: string;
  privateKey?: string;
}

export function encryptBootstrapCreds(creds: BootstrapCreds): string {
  return encryptPrivateKey(JSON.stringify(creds), env.APP_SECRET);
}

export function decryptBootstrapCreds(encrypted: string): BootstrapCreds {
  const json = decryptPrivateKey(encrypted, env.APP_SECRET);
  const parsed = JSON.parse(json) as BootstrapCreds;
  if (
    !parsed ||
    typeof parsed.initialPort !== "number" ||
    typeof parsed.initialUser !== "string"
  ) {
    throw new Error("Invalid decrypted bootstrap creds");
  }
  return parsed;
}
