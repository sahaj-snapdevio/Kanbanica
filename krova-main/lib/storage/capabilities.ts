/**
 * Storage backend capability checks for customer-facing UI.
 *
 * When no active storage backend is configured (`storage_backends`),
 * snapshot and backup features are hidden from the customer dashboard
 * rather than shown as broken buttons. The Orbit admin panel ignores
 * these capabilities — it still needs to render storage management so
 * an operator can add the first backend.
 *
 * Server-side guards in `assertBackupStorageAvailable()` give the same
 * answer to API routes and server actions, as defense in depth against
 * a customer that bypasses the UI.
 */

import { count, eq } from "drizzle-orm";
import { cache } from "react";
import { storageBackends } from "@/db/schema";
import { db } from "@/lib/db";

export interface StorageCapabilities {
  canCreateBackup: boolean;
  canCreateSnapshot: boolean;
  /** True when at least one storage backend row is marked active. */
  hasActiveBackend: boolean;
}

/**
 * Capabilities for the current state of configured storage backends.
 * Deduped per request via React `cache()` so each render pass hits the
 * DB at most once, even when several server components ask.
 */
export const getStorageCapabilities = cache(
  async (): Promise<StorageCapabilities> => {
    const [row] = await db
      .select({ count: count() })
      .from(storageBackends)
      .where(eq(storageBackends.isActive, true));

    const hasActiveBackend = (row?.count ?? 0) > 0;
    return {
      hasActiveBackend,
      canCreateSnapshot: hasActiveBackend,
      canCreateBackup: hasActiveBackend,
    };
  }
);

const STORAGE_UNAVAILABLE_MESSAGE =
  "Backup storage isn't configured on this platform yet. Please contact support if you expected this feature to be available.";

/**
 * Action/API-route guard. Returns a `{ error }` object when storage is
 * unavailable so callers can short-circuit and surface the message;
 * returns `null` when storage is ready.
 */
export async function assertBackupStorageAvailable(): Promise<{
  error: string;
} | null> {
  const caps = await getStorageCapabilities();
  if (!caps.hasActiveBackend) {
    return { error: STORAGE_UNAVAILABLE_MESSAGE };
  }
  return null;
}

export { STORAGE_UNAVAILABLE_MESSAGE };
