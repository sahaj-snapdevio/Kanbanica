// Version-skew recovery — a browser tab left open across a deploy still holds a
// Server Action id or a JS/CSS chunk reference from the PREVIOUS build. When that
// stale reference hits the new server it fails with "Failed to find Server Action"
// (server actions) or a ChunkLoadError (assets). The fix is the same in both
// cases: reload once onto the current deployment.
//
// This module is the single source of truth for BOTH the match list and the reload
// (Rule 14) — imported by the window-level listener (components/deployment-skew-reload.tsx)
// and by every route error boundary (app/**/error.tsx, app/global-error.tsx).

const SKEW_MESSAGE_FRAGMENTS = [
  "Failed to find Server Action",
  "ChunkLoadError",
  "Loading chunk",
  "Loading CSS chunk",
  "Failed to fetch dynamically imported module",
  "error loading dynamically imported module",
];

/** True when the error is a stale-deployment artifact safe to recover with a reload. */
export function isDeploymentSkewError(error: unknown): boolean {
  let message = "";
  if (typeof error === "string") {
    message = error;
  } else if (error instanceof Error) {
    message = error.message;
  } else if (
    typeof error === "object" &&
    error !== null &&
    "message" in error
  ) {
    message = String((error as { message: unknown }).message);
  }
  if (!message) {
    return false;
  }
  return SKEW_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment));
}

// Loop guard: a genuinely recurring error (e.g. one our match list overfits on)
// must never trap the user in a reload cycle. We stamp sessionStorage BEFORE
// reloading and refuse a second reload inside the cooldown window — at most one
// reload per cooldown, then the error surfaces normally.
const RELOAD_GUARD_KEY = "krova:skew-reload-at";
const RELOAD_COOLDOWN_MS = 10_000;

/**
 * Reload once to pull the current deployment's assets. Returns true if a reload
 * was triggered, false if suppressed by the loop guard or called server-side.
 */
export function recoverFromDeploymentSkew(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_GUARD_KEY) ?? "0");
    if (Number.isFinite(last) && Date.now() - last < RELOAD_COOLDOWN_MS) {
      return false; // already reloaded recently — surface the error instead of looping
    }
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // sessionStorage blocked (private mode) — fall through and reload anyway
  }
  window.location.reload();
  return true;
}
