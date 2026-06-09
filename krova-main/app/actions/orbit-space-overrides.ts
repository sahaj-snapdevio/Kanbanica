"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { CPU_OPTIONS, DISK_OPTIONS, RAM_OPTIONS } from "@/config/platform";
import * as schema from "@/db/schema";
import { requireActionAdmin } from "@/lib/actions/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";

/**
 * Orbit-only server action for per-space limit overrides.
 *
 * Every overridable field on `spaces` (the `override_*` columns added in
 * Phase 5A) is exposed through `setSpaceOverride`. Each call updates ONE
 * column. Passing `value = null` clears the override, restoring the plan's
 * value at read time via `effectiveLimits`.
 *
 * Auth: `requireActionAdmin` from `lib/actions/auth-helpers.ts` —
 * defense-in-depth admin + ban re-check against the DB.
 *
 * Audit + lifecycle: every successful change writes one `audit_logs` entry
 * (category `platform`) and one `lifecycle_logs` entry (entityType `space`).
 */

// ---------------------------------------------------------------------------
// Field allowlist + per-kind validation
// ---------------------------------------------------------------------------

/**
 * The set of `spaces` columns this action is allowed to write. Strict
 * allowlist — never trust the field name from the client.
 *
 * `kind` drives validation:
 *  - `int-positive`: positive integer; null clears.
 *  - `int-cpu` / `int-ram` / `int-disk`: positive integer within the
 *    platform CPU/RAM/DISK option ranges.
 *  - `usd`: non-negative USD; null clears. Stored as `numeric(12,4)` string.
 *  - `bool`: boolean; null clears.
 */
const OVERRIDE_FIELDS = {
  overrideMaxConcurrentCubes: { kind: "int-positive" },
  overrideMaxVcpus: { kind: "int-cpu" },
  overrideMaxRamMb: { kind: "int-ram" },
  overrideMaxDiskGb: { kind: "int-disk" },
  overrideMaxSeats: { kind: "int-positive" },
  overrideMaxBackups: { kind: "int-positive" },
  overrideMaxDomains: { kind: "int-positive" },
  overrideIncludedCreditUsd: { kind: "usd" },
  overrideAllowTopup: { kind: "bool" },
  overrideAllowOverage: { kind: "bool" },
  overrideOverageCapMaxUsd: { kind: "usd" },
} as const;

export type OverrideField = keyof typeof OVERRIDE_FIELDS;

/** All valid override field names. Used by the client to type the call. */

type ValidatedValue =
  | { ok: true; column: number | string | boolean | null }
  | { ok: false; error: string };

function validateOverrideValue(
  field: OverrideField,
  value: unknown
): ValidatedValue {
  if (value === null) {
    return { ok: true, column: null };
  }

  const spec = OVERRIDE_FIELDS[field];

  switch (spec.kind) {
    case "int-positive": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return { ok: false, error: "Value must be a whole number" };
      }
      if (value < 1) {
        return { ok: false, error: "Value must be at least 1" };
      }
      return { ok: true, column: value };
    }
    case "int-cpu": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return { ok: false, error: "Value must be a whole number" };
      }
      if (value < CPU_OPTIONS.min || value > CPU_OPTIONS.max) {
        return {
          ok: false,
          error: `vCPUs must be between ${CPU_OPTIONS.min} and ${CPU_OPTIONS.max}`,
        };
      }
      return { ok: true, column: value };
    }
    case "int-ram": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return { ok: false, error: "Value must be a whole number" };
      }
      if (value < RAM_OPTIONS.min || value > RAM_OPTIONS.max) {
        return {
          ok: false,
          error: `RAM must be between ${RAM_OPTIONS.min} and ${RAM_OPTIONS.max} MB`,
        };
      }
      return { ok: true, column: value };
    }
    case "int-disk": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return { ok: false, error: "Value must be a whole number" };
      }
      if (value < DISK_OPTIONS.min || value > DISK_OPTIONS.max) {
        return {
          ok: false,
          error: `Disk must be between ${DISK_OPTIONS.min} and ${DISK_OPTIONS.max} GB`,
        };
      }
      return { ok: true, column: value };
    }
    case "usd": {
      if (typeof value !== "number" || Number.isNaN(value)) {
        return { ok: false, error: "Value must be a number" };
      }
      if (value < 0) {
        return { ok: false, error: "Value must be zero or greater" };
      }
      if (value > 1_000_000) {
        return { ok: false, error: "Value is unreasonably large" };
      }
      return { ok: true, column: value.toFixed(4) };
    }
    case "bool": {
      if (typeof value !== "boolean") {
        return { ok: false, error: "Value must be true or false" };
      }
      return { ok: true, column: value };
    }
  }
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

/**
 * Set or clear one per-space limit override. `value = null` clears the
 * override and restores the plan's value at read time.
 */
export async function setSpaceOverride(
  spaceId: string,
  field: OverrideField,
  value: number | string | boolean | null
): Promise<{ success: true } | { error: string }> {
  try {
    const sessionResult = await requireActionAdmin();
    if ("error" in sessionResult) {
      return sessionResult;
    }
    const session = sessionResult;

    if (typeof spaceId !== "string" || spaceId.length === 0) {
      return { error: "Invalid space id" };
    }
    if (!(field in OVERRIDE_FIELDS)) {
      return { error: `Unknown override field: ${String(field)}` };
    }

    const validated = validateOverrideValue(field, value);
    if (!validated.ok) {
      return { error: validated.error };
    }

    const [space] = await db
      .select({
        id: schema.spaces.id,
        name: schema.spaces.name,
        overrideMaxConcurrentCubes: schema.spaces.overrideMaxConcurrentCubes,
        overrideMaxVcpus: schema.spaces.overrideMaxVcpus,
        overrideMaxRamMb: schema.spaces.overrideMaxRamMb,
        overrideMaxDiskGb: schema.spaces.overrideMaxDiskGb,
        overrideMaxSeats: schema.spaces.overrideMaxSeats,
        overrideMaxBackups: schema.spaces.overrideMaxBackups,
        overrideMaxDomains: schema.spaces.overrideMaxDomains,
        overrideIncludedCreditUsd: schema.spaces.overrideIncludedCreditUsd,
        overrideAllowTopup: schema.spaces.overrideAllowTopup,
        overrideAllowOverage: schema.spaces.overrideAllowOverage,
        overrideOverageCapMaxUsd: schema.spaces.overrideOverageCapMaxUsd,
      })
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId))
      .limit(1);
    if (!space) {
      return { error: "Space not found" };
    }

    // No-op fast path — DB write + audit only when the value actually changes.
    const previous = space[field];
    const next = validated.column;
    if (previous === next) {
      return { success: true as const };
    }

    await db.transaction(async (tx) => {
      await tx
        .update(schema.spaces)
        .set({
          [field]: validated.column,
          updatedAt: new Date(),
        })
        .where(eq(schema.spaces.id, spaceId));

      await tx.insert(schema.lifecycleLogs).values({
        entityType: "space" as const,
        entityId: spaceId,
        message:
          validated.column === null
            ? `Override cleared: ${field}`
            : `Override set: ${field} = ${String(validated.column)}`,
      });
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action:
        validated.column === null
          ? "space.override_clear"
          : "space.override_set",
      category: "platform",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description:
        validated.column === null
          ? `Cleared override ${field} on space ${space.name}`
          : `Set override ${field} = ${String(validated.column)} on space ${space.name}`,
      metadata: {
        field,
        from: previous,
        to: validated.column,
      },
      ...reqCtx,
    });

    return { success: true as const };
  } catch (error) {
    console.error("setSpaceOverride error:", error);
    return { error: "Something went wrong updating the override." };
  }
}
