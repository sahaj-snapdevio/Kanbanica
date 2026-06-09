/**
 * Pusher / Soketi real-time event broadcasting.
 *
 * Server-side: Lazy initialization — reads config from env vars.
 * Client-side: Config served from dashboard layout via getPusherClientConfig().
 */

import { createHash } from "node:crypto";
import Pusher from "pusher";
import { enqueueEmailitSyncForSpaceOwner } from "@/lib/emailit/enqueue-sync";
import {
  getPusherClientConfig as getClientConfig,
  getPusherConfig,
} from "@/lib/service-config";

// Re-export for convenience
export { getClientConfig as getPusherClientConfig };

// ── Server-side Pusher (lazy, cached) ──────────────────────────────────

let _pusherServer: Pusher | null = null;
let _pusherConfigKey: string | null = null;
let _fingerprintLogged = false;

/**
 * Get the server-side Pusher instance.
 * Creates lazily on first call.
 *
 * Cache key intentionally includes a hash of the secret so a rotated
 * `PUSHER_SECRET` env var invalidates the cached instance. Without this,
 * the long-running worker process (or a Next.js dev server kept alive
 * through env edits) would continue to sign with the stale secret —
 * exactly the failure mode that produces "all subscriptions return 401"
 * while the operator believes the secret was updated.
 */
export function getPusherServer(): Pusher {
  const config = getPusherConfig();

  const secretHash = createHash("sha256")
    .update(config.secret, "utf8")
    .digest("hex")
    .slice(0, 16);

  const configKey = `${config.appId}:${config.key}:${config.cluster}:${config.host}:${config.port}:${secretHash}`;
  if (_pusherServer && _pusherConfigKey === configKey) {
    return _pusherServer;
  }

  // One-shot fingerprint log on first init / config change, so operators
  // can grep worker logs and compare against Soketi's secret fingerprint
  // without needing the admin diagnostic endpoint.
  if (!_fingerprintLogged || _pusherConfigKey !== configKey) {
    console.log(
      `[pusher] init key=${config.key} secretFingerprint=${secretHash} secretLength=${Buffer.byteLength(config.secret, "utf8")} host=${config.host ?? "(cluster mode)"} cluster=${config.cluster || "(none)"}`
    );
    _fingerprintLogged = true;
  }

  // Soketi mode: use custom host/port. Pusher cloud mode: use cluster.
  _pusherServer = config.host
    ? new Pusher({
        appId: config.appId,
        key: config.key,
        secret: config.secret,
        host: config.host,
        port: String(config.port ?? 443),
        useTLS: true,
        cluster: config.cluster || "default",
      })
    : new Pusher({
        appId: config.appId,
        key: config.key,
        secret: config.secret,
        cluster: config.cluster,
        useTLS: true,
      });
  _pusherConfigKey = configKey;
  return _pusherServer;
}

// ── Trigger helpers ────────────────────────────────────────────────────

export async function triggerEvent(
  channel: string,
  event: string,
  data: unknown
): Promise<void> {
  const server = getPusherServer();
  await server.trigger(channel, event, data);
}

/**
 * Statuses that change a user's EmailIt contact custom fields
 * (`cube_count`, `running_cube_count`, `lifecycle_stage`). Intermediate
 * statuses (booting, stopping, pending) are skipped — their terminal
 * counterpart will fire again shortly.
 */
const EMAILIT_RELEVANT_CUBE_STATUSES = new Set([
  "running",
  "sleeping",
  "deleted",
  "error",
]);

/**
 * Fire a lifecycle event on both the per-Cube channel (for the detail page)
 * and the space channel (for the list page). On terminal status transitions,
 * also enqueue an EmailIt contact sync for the space owner — the single
 * chokepoint that keeps the marketing audience fresh on cube state changes.
 */
export async function triggerCubeLifecycleEvent(
  cubeId: string,
  spaceId: string,
  data: Record<string, unknown>
): Promise<void> {
  const server = getPusherServer();

  const results = await Promise.allSettled([
    server.trigger(`private-cube-${cubeId}`, "lifecycle.update", data),
    server.trigger(`private-space-${spaceId}`, "cube.status-change", {
      cubeId,
      ...data,
    }),
  ]);
  for (const r of results) {
    if (r.status === "rejected") {
      console.error("[pusher] trigger failed:", r.reason);
    }
  }

  const status = data.status;
  if (
    typeof status === "string" &&
    EMAILIT_RELEVANT_CUBE_STATUSES.has(status)
  ) {
    await enqueueEmailitSyncForSpaceOwner(spaceId);
  }
}
