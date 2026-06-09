/**
 * Centralized service configuration reader.
 *
 * Pusher/Soketi and Google OAuth: read from environment variables.
 * Snapshots: read from static config (config/platform.ts).
 * Error notifications: read live from the DB (every active Orbit admin) plus
 *   any optional extras configured in `config/platform.ts ERROR_NOTIFY_EMAILS`.
 */

import { eq } from "drizzle-orm";
import { ERROR_NOTIFY_EMAILS } from "@/config/platform";
import { user } from "@/db/schema";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

// ── Pusher / Soketi Config (env-only) ─────────────────────────────────

export interface PusherConfig {
  appId: string;
  cluster: string;
  host?: string;
  key: string;
  port?: number;
  secret: string;
}

export function getPusherConfig(): PusherConfig {
  return {
    appId: env.PUSHER_APP_ID,
    key: env.PUSHER_KEY,
    secret: env.PUSHER_SECRET,
    cluster: env.PUSHER_CLUSTER ?? "",
    host: env.PUSHER_HOST,
    port: env.PUSHER_PORT,
  };
}

export interface PusherClientConfig {
  cluster: string;
  host?: string;
  key: string;
  port?: number;
}

export function getPusherClientConfig(): PusherClientConfig {
  return {
    key: env.PUSHER_KEY,
    cluster: env.PUSHER_CLUSTER ?? "",
    host: env.PUSHER_HOST,
    port: env.PUSHER_PORT,
  };
}

// ── Google OAuth Config (env-only) ────────────────────────────────────

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  };
}

// ── Error Notification Emails ────────────────────────────────────────

/**
 * Recipients for operator-fanout emails (cube errors, storage health, user/
 * space deletion summaries). The list IS every active Orbit admin (DB
 * role='admin', excluding users with a currently-active ban), unioned with
 * any extras configured in `config/platform.ts ERROR_NOTIFY_EMAILS` (e.g.
 * an `oncall@` mailbox that isn't tied to a real user account).
 *
 * Promote/demote/ban an admin in Orbit → recipients update on the next call.
 * Deduplicated case-insensitively.
 */
export async function getErrorNotifyEmails(): Promise<string[]> {
  const rows = await db
    .select({
      email: user.email,
      banned: user.banned,
      banExpires: user.banExpires,
    })
    .from(user)
    .where(eq(user.role, "admin"));

  const now = Date.now();
  const seen = new Set<string>();
  const out: string[] = [];

  for (const r of rows) {
    if (r.banned) {
      const banActive = !r.banExpires || r.banExpires.getTime() > now;
      if (banActive) {
        continue;
      }
    }
    const key = r.email.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(r.email);
  }

  for (const extra of ERROR_NOTIFY_EMAILS) {
    if (!extra) {
      continue;
    }
    const key = extra.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(extra);
  }

  return out;
}

// Snapshot config is no longer global — it lives per-plan now
// (`plans.auto_snapshot_*` + `plans.max_manual_snapshots_per_cube`),
// resolved via `effectiveLimits` in lib/plan/limits.ts and consumed by
// the snapshot.scheduler + snapshot.auto-prune handlers. See the
// 2026-05-25 snapshot/backup overhaul plan.
