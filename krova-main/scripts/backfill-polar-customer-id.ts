/**
 * One-shot backfill for `spaces.polar_customer_id`.
 *
 * Why this exists: Polar's `external_id` on a customer record is PER-EMAIL,
 * not per-space. When the same user subscribes a second space, Polar reuses
 * the existing customer and the new space's id is NOT addressable through the
 * `external_id` surface (`updateExternal` / `getStateExternal` for the sibling
 * space 404s). Krova therefore stores Polar's canonical customer id on the
 * space row, captured from the first webhook seen for the space.
 *
 * For spaces that subscribed BEFORE this column existed, the canonical id
 * was never captured. This script fills it in by calling
 * `polar.subscriptions.get({ id: space.providerSubscriptionId })` for every
 * space with a recorded subscription, then writing `sub.customer.id` to the
 * row.
 *
 * Usage:
 *   tsx scripts/backfill-polar-customer-id.ts            # dry-run (default)
 *   tsx scripts/backfill-polar-customer-id.ts --apply    # commits the writes
 *
 * Idempotent — re-running after a successful pass is a no-op (skips rows
 * that already have a non-null `polar_customer_id`).
 *
 * Run AFTER deploying migration 0041 (which adds the column).
 */
import { existsSync } from "fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

const APPLY = process.argv.includes("--apply");

async function main() {
  const [{ db }, schema, { getPolarClient }, { isNull, isNotNull, and, eq }] =
    await Promise.all([
      import("@/lib/db"),
      import("@/db/schema"),
      import("@/lib/payments/polar/client"),
      import("drizzle-orm"),
    ]);

  if (!process.env.POLAR_ACCESS_TOKEN) {
    console.error(
      "POLAR_ACCESS_TOKEN is not set — backfill needs read access to Polar."
    );
    process.exit(1);
  }

  console.log(
    `Mode: ${APPLY ? "APPLY (will commit)" : "DRY-RUN (read-only)"}\n`
  );

  // Every space that has a recorded subscription but no captured customer id.
  const rows = await db
    .select({
      id: schema.spaces.id,
      name: schema.spaces.name,
      providerSubscriptionId: schema.spaces.providerSubscriptionId,
    })
    .from(schema.spaces)
    .where(
      and(
        isNotNull(schema.spaces.providerSubscriptionId),
        isNull(schema.spaces.polarCustomerId)
      )
    );

  if (rows.length === 0) {
    console.log(
      "No spaces with a subscription and a missing polar_customer_id. Nothing to do."
    );
    return;
  }

  console.log(`${rows.length} space(s) to backfill:\n`);
  const polar = getPolarClient();
  let captured = 0;
  let missing = 0;
  let failed = 0;

  for (const row of rows) {
    const subId = row.providerSubscriptionId;
    if (!subId) {
      continue; // guarded by the WHERE, but narrow for TS
    }
    try {
      const sub = await polar.subscriptions.get({ id: subId });
      const customerId = sub.customer?.id ?? null;
      if (!customerId) {
        console.warn(
          `  ${row.id} (${row.name}) sub=${subId}: subscription has no customer.id — skipping`
        );
        missing++;
        continue;
      }
      console.log(
        `  ${row.id} (${row.name}) sub=${subId} → polar_customer_id=${customerId}`
      );
      if (APPLY) {
        await db
          .update(schema.spaces)
          .set({ polarCustomerId: customerId, updatedAt: new Date() })
          .where(eq(schema.spaces.id, row.id));
      }
      captured++;
    } catch (err) {
      // Likely 404 — subscription has been hard-deleted in Polar; nothing
      // we can do for that space here. Other failures are surfaced too.
      const status = (err as { statusCode?: number })?.statusCode;
      console.warn(
        `  ${row.id} (${row.name}) sub=${subId}: failed (${status ?? "unknown"}) — ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      failed++;
    }
  }

  console.log(
    `\n${APPLY ? "Applied" : "Would apply"}: ${captured} captured · ${missing} missing customer.id · ${failed} failed`
  );
  if (!APPLY) {
    console.log("\nDRY-RUN — pass --apply to commit.");
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
