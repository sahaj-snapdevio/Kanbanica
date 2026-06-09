/**
 * Client-safe classification of `billing_events.type` values.
 *
 * Lives outside `lib/billing.ts` (which imports `db` and is server-only) so
 * client components can drive their +/- sign, ArrowUp/ArrowDown icon, and
 * red/green colour off a single source of truth. Every UI surface that
 * renders a billing event MUST consult `BILLING_DEBIT_TYPES` or
 * `billingEventKind()` instead of re-enumerating event types inline — Rule
 * 14 (no code duplication). Adding a new charge type means adding it to
 * the pgEnum in db/schema/billing.ts AND to the Set below; nothing else.
 *
 * Enum values are derived from drizzle's `billingEventType.enumValues` so
 * a missing branch fails TypeScript at compile time when a new enum value
 * is introduced.
 */

import type { billingEventType } from "@/db/schema/billing";

export type BillingEventType = (typeof billingEventType.enumValues)[number];

/**
 * Event types that DEBIT the customer's credit balance (charges).
 * Everything not in this set CREDITS the balance (top-ups, grants, plan
 * credit, refunds back to the customer).
 */
export const BILLING_DEBIT_TYPES: ReadonlySet<BillingEventType> =
  new Set<BillingEventType>([
    "hourly_charge",
    "prorated_charge",
    "backup_storage_charge",
    "sleep_storage_charge",
    "overage_charge",
  ]);

export function isBillingDebit(type: string): boolean {
  return BILLING_DEBIT_TYPES.has(type as BillingEventType);
}

export function billingEventKind(type: string): "debit" | "credit" {
  return isBillingDebit(type) ? "debit" : "credit";
}
