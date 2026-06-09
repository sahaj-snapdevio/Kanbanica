import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { paymentBreakdown } from "@/components/billing/topup-math";
import * as schema from "@/db/schema";
import { computeTopupCents } from "@/lib/billing/topup-checkout";
import { db } from "@/lib/db";
import { invalidatePlatformSettingsCache } from "@/lib/platform-settings";

// The money invariant: computeTopupCents (DB-backed, reads platform_settings)
// MUST agree with paymentBreakdown (the client-safe pure mirror). This is the
// cross-check the pure unit test (tests/unit/topup-math.test.ts) can't do.

async function setFee(percent: string, flatUsd: string) {
  await db
    .update(schema.platformSettings)
    .set({ paymentFeePercent: percent, paymentFeeFlatUsd: flatUsd })
    .where(eq(schema.platformSettings.id, 1));
  invalidatePlatformSettingsCache();
}

test("computeTopupCents agrees with paymentBreakdown across fee configs", async () => {
  // snapshot original so we restore the shared singleton afterwards
  const [orig] = await db
    .select({
      percent: schema.platformSettings.paymentFeePercent,
      flat: schema.platformSettings.paymentFeeFlatUsd,
    })
    .from(schema.platformSettings)
    .where(eq(schema.platformSettings.id, 1))
    .limit(1);
  assert.ok(orig, "platform_settings singleton (migration 0037) must exist");

  try {
    const configs = [
      { percent: 0.029, flatUsd: 0.3 },
      { percent: 0, flatUsd: 0.4 },
      { percent: 0.07, flatUsd: 0 },
      { percent: 0.035, flatUsd: 0.5 },
    ];
    for (const fee of configs) {
      await setFee(String(fee.percent), String(fee.flatUsd));
      for (const base of [5, 10, 100, 999]) {
        const server = await computeTopupCents(base);
        const client = paymentBreakdown(base, fee);
        assert.equal(
          server.baseCents,
          Math.round(client.baseUsd * 100),
          `base mismatch @ base=${base} ${JSON.stringify(fee)}`
        );
        assert.equal(
          server.totalCents,
          Math.round(client.totalUsd * 100),
          `total mismatch @ base=${base} ${JSON.stringify(fee)}`
        );
        assert.equal(
          server.feeCents,
          server.totalCents - server.baseCents,
          "feeCents = total - base"
        );
      }
    }
  } finally {
    await setFee(orig.percent, orig.flat);
  }
});
