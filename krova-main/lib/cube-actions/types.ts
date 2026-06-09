import type { SpaceMembership } from "@/db/schema/types";

/**
 * The actor performing a cube action. Either a logged-in dashboard user
 * (session-authed) or a v1 API consumer (API-key-authed). Used by the shared
 * cube-action handlers to attribute audit logs and append a " via API key"
 * suffix to lifecycle log + audit descriptions.
 */
export type CubeActor =
  | { kind: "session"; userId: string; userEmail: string }
  | { kind: "apiKey"; apiKeyId: string };

/**
 * Per-call context for any cube action: the actor, the resolved membership,
 * the IDs, and the raw request context that audit logs need.
 */
export interface CubeActionContext {
  actor: CubeActor;
  cubeId: string;
  membership: SpaceMembership;
  reqCtx: { ipAddress: string | null; userAgent: string | null };
  spaceId: string;
}

/**
 * Result of a cube action. Routes/server-actions translate this to their
 * own response shape (HTTP status + JSON body, or server-action result).
 *
 * `status` mirrors the HTTP status code the route would return. It is NOT
 * a literal HTTP response — the route owns the wire format so the existing
 * dashboard + v1 JSON shapes can be preserved exactly.
 *
 * `errorMeta` carries extra structured fields the route should spread into
 * the error JSON body alongside `error` (e.g. the wake 422 response includes
 * `{ required, available }` so the customer's UI can show the deficit).
 */
export type CubeActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: 400 | 403 | 404 | 409 | 422 | 429 | 500 | 503;
      error: string;
      errorMeta?: Record<string, unknown>;
    };

/**
 * Whether to append a " via <label>" suffix to lifecycle log messages and
 * audit descriptions. Mirrors the historical per-route behavior.
 *
 * Existing label conventions (preserved exactly, do not normalize):
 *   - sleep, wake → "API key"  (the default)
 *   - ssh-port    → "API"
 *   - domains, tcp-mappings → caller does NOT use this helper; both routes
 *     produced identical descriptions for session vs apiKey actors.
 */
export function actorSuffix(
  actor: CubeActor,
  label: "API key" | "API" = "API key"
): string {
  return actor.kind === "apiKey" ? ` via ${label}` : "";
}

/**
 * Resolve the actor into the actorId / actorEmail / extra-metadata fields
 * the `audit()` helper expects.
 */
export function actorAuditFields(actor: CubeActor): {
  actorId: string;
  actorEmail: string | null;
  metadataExtras: Record<string, unknown>;
} {
  if (actor.kind === "session") {
    return {
      actorId: actor.userId,
      actorEmail: actor.userEmail,
      metadataExtras: {},
    };
  }
  return {
    actorId: actor.apiKeyId,
    actorEmail: null,
    metadataExtras: { apiKeyId: actor.apiKeyId },
  };
}
