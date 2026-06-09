"use server";

/**
 * Operator-initiated billing corrections. All three actions are admin-only
 * and audit-logged:
 *
 * - `voidOverageCharge` — cancels a specific overage_charge billing event
 *   by writing a compensating credit_refund row and subtracting the
 *   amount from `spaces.this_period_overage_usd`. The Polar meter event
 *   is not retracted (Polar meters are append-only); operators handle
 *   that out-of-band by adjusting the customer's next invoice.
 *
 * - `noteRefundTopup` — records an admin note that a top-up was refunded
 *   in Polar. The actual credit clawback runs automatically via the
 *   `topup.refunded` Polar webhook (`applyPaidTopup` updates the row +
 *   inserts the `credit_refund` event). This action is only for the case
 *   where the refund was processed outside Polar (e.g. chargeback handled
 *   via the bank) — it manually inserts the credit_refund event so the
 *   space's ledger reflects the clawback.
 *
 * - `grantRetroactiveCredit` — convenience wrapper around the existing
 *   credit-grant flow that records an explicit retroactive reason in the
 *   billing-event description AND the audit log metadata. SLA breaches,
 *   support apologies, etc.
 */

import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import * as schema from "@/db/schema";
import { requireActionAdmin } from "@/lib/actions/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { applyCreditTopup } from "@/lib/billing/apply-topup";
import { db } from "@/lib/db";
import { enqueueEmailitSyncForSpaceOwner } from "@/lib/emailit/enqueue-sync";

export async function voidOverageCharge(
  billingEventId: string,
  reason: string
) {
  try {
    const session = await requireActionAdmin();
    if ("error" in session) {
      return session;
    }

    if (!reason || reason.trim().length < 4) {
      return {
        error: "Provide a reason of at least 4 characters for the audit log.",
      };
    }

    const [event] = await db
      .select()
      .from(schema.billingEvents)
      .where(eq(schema.billingEvents.id, billingEventId))
      .limit(1);
    if (!event) {
      return { error: "Billing event not found" };
    }
    if (event.type !== "overage_charge") {
      return {
        error: "Only overage_charge events can be voided through this action.",
      };
    }

    const amount = Number.parseFloat(event.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { error: "Event amount is not a valid positive number" };
    }

    await db.transaction(async (tx) => {
      // Compensating ledger row.
      await tx.insert(schema.billingEvents).values({
        id: createId(),
        spaceId: event.spaceId,
        cubeId: event.cubeId,
        amount: String(-amount),
        type: "credit_refund",
        description: `Voided overage charge ${event.id}: ${reason.trim()}`,
      });

      // Subtract from running period counter, clamped at zero.
      const [space] = await tx
        .select({ counter: schema.spaces.thisPeriodOverageUsd })
        .from(schema.spaces)
        .where(eq(schema.spaces.id, event.spaceId))
        .limit(1);
      if (space) {
        const current = Number.parseFloat(space.counter);
        const next = Math.max(0, current - amount);
        await tx
          .update(schema.spaces)
          .set({
            thisPeriodOverageUsd: next.toFixed(4),
            updatedAt: new Date(),
          })
          .where(eq(schema.spaces.id, event.spaceId));
      }
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "billing.overage_voided",
      category: "billing",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "billing_event",
      entityId: event.id,
      spaceId: event.spaceId,
      description: `Voided overage charge of $${amount.toFixed(4)} — ${reason.trim()}`,
      metadata: {
        overageEventId: event.id,
        spaceId: event.spaceId,
        amount,
        reason: reason.trim(),
      },
      source: "web",
      ...reqCtx,
    });

    await enqueueEmailitSyncForSpaceOwner(event.spaceId);
    return { success: true as const };
  } catch (error) {
    console.error("voidOverageCharge error:", error);
    return { error: "Failed to void overage charge" };
  }
}

export async function noteRefundTopup(
  spaceId: string,
  amount: number,
  reason: string
) {
  try {
    const session = await requireActionAdmin();
    if ("error" in session) {
      return session;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return { error: "Refund amount must be a positive number" };
    }
    if (!reason || reason.trim().length < 4) {
      return {
        error: "Provide a reason of at least 4 characters for the audit log.",
      };
    }

    await db.transaction(async (tx) => {
      // Write a credit_refund row that mirrors the negation Polar's webhook
      // would have written. We do NOT call applyCreditTopup here — that
      // function adds credit, and a refund subtracts. Direct ledger insert
      // + space balance update inside the same tx.
      await tx.insert(schema.billingEvents).values({
        id: createId(),
        spaceId,
        amount: String(-amount),
        type: "credit_refund",
        description: `Manual refund clawback: ${reason.trim()}`,
      });

      // Clamp balance at zero — refunds that exceed current balance are
      // capped because customers can't owe Krova money (we never go
      // negative on prepaid balance; overage handles that case).
      const [space] = await tx
        .select({ balance: schema.spaces.creditBalance })
        .from(schema.spaces)
        .where(eq(schema.spaces.id, spaceId))
        .limit(1);
      if (space) {
        const current = Number.parseFloat(space.balance);
        const next = Math.max(0, current - amount);
        await tx
          .update(schema.spaces)
          .set({
            creditBalance: next.toFixed(4),
            updatedAt: new Date(),
          })
          .where(eq(schema.spaces.id, spaceId));
      }
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "billing.refund_recorded",
      category: "billing",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: `Recorded manual top-up refund of $${amount.toFixed(2)} — ${reason.trim()}`,
      metadata: { spaceId, amount, reason: reason.trim() },
      source: "web",
      ...reqCtx,
    });

    await enqueueEmailitSyncForSpaceOwner(spaceId);
    return { success: true as const };
  } catch (error) {
    console.error("noteRefundTopup error:", error);
    return { error: "Failed to record refund" };
  }
}

export async function grantRetroactiveCredit(
  spaceId: string,
  amount: number,
  reason: string,
  category: "sla_breach" | "support_apology" | "billing_correction" | "other"
) {
  try {
    const session = await requireActionAdmin();
    if ("error" in session) {
      return session;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return { error: "Amount must be a positive number" };
    }
    if (amount > 10_000) {
      return { error: "Single retroactive grant cannot exceed $10,000" };
    }
    if (!reason || reason.trim().length < 4) {
      return {
        error: "Provide a reason of at least 4 characters for the audit log.",
      };
    }

    const description = `Retroactive credit (${category.replace(/_/g, " ")}): ${reason.trim()}`;

    await db.transaction(async (tx) =>
      applyCreditTopup({
        tx,
        spaceId,
        amount,
        type: "credit_grant",
        description,
      })
    );

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "billing.retroactive_credit_grant",
      category: "billing",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: `Granted $${amount.toFixed(2)} retroactive credit (${category}) — ${reason.trim()}`,
      metadata: {
        spaceId,
        amount,
        retroactiveCategory: category,
        reason: reason.trim(),
      },
      source: "web",
      ...reqCtx,
    });

    await enqueueEmailitSyncForSpaceOwner(spaceId);
    return { success: true as const };
  } catch (error) {
    console.error("grantRetroactiveCredit error:", error);
    return { error: "Failed to grant retroactive credit" };
  }
}
