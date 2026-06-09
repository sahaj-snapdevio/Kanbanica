import { createId } from "@paralleldrive/cuid2";
import { and, count, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import * as schema from "@/db/schema";
import { PERMISSION_VALUES } from "@/db/schema/types";
import { requireSession } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { acquireUserLock, getDefaultPlan } from "@/lib/plan/usage";

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request);

    const memberships = await db
      .select({
        space: schema.spaces,
        membership: schema.spaceMemberships,
      })
      .from(schema.spaceMemberships)
      .innerJoin(
        schema.spaces,
        eq(schema.spaces.id, schema.spaceMemberships.spaceId)
      )
      .where(eq(schema.spaceMemberships.userId, session.user.id));

    const result = memberships.map((m) => ({
      ...m.space,
      isOwner: m.membership.isOwner,
      membershipId: m.membership.id,
    }));

    return Response.json(result);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request);
    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return Response.json({ error: "Name is required" }, { status: 400 });
    }

    // Phase 5C — pull the default plan (and its included credit) from the DB
    // plans table so an operator-edited default takes effect without a
    // redeploy.
    const defaultPlan = await getDefaultPlan();
    const defaultIncludedCredit = Number.parseFloat(
      defaultPlan.includedCreditUsd
    );

    const spaceId = createId();
    const membershipId = createId();
    let isFirstSpace = false;

    await db.transaction(async (tx) => {
      // Serialize this user's space creations so the once-per-user trial-grant
      // check below cannot be raced into multiple grants. Mirrors the
      // server-action path in app/actions/spaces.ts (Rule 14).
      await acquireUserLock(tx, session.user.id);

      // The included-credit trial grant is given ONCE PER USER — only their
      // first owned space. Later spaces start at $0 (closes the
      // create-many-spaces farm).
      const [owned] = await tx
        .select({ n: count() })
        .from(schema.spaceMemberships)
        .where(
          and(
            eq(schema.spaceMemberships.userId, session.user.id),
            eq(schema.spaceMemberships.isOwner, true)
          )
        );
      isFirstSpace = Number(owned?.n ?? 0) === 0;
      const creditGrant = isFirstSpace ? defaultIncludedCredit : 0;

      await tx.insert(schema.spaces).values({
        id: spaceId,
        name: name.trim(),
        creditBalance: creditGrant.toFixed(4),
        planId: defaultPlan.id,
      });

      await tx.insert(schema.spaceMemberships).values({
        id: membershipId,
        userId: session.user.id,
        spaceId,
        isOwner: true,
      });

      // Grant all permissions to the creator
      await tx.insert(schema.memberPermissions).values(
        PERMISSION_VALUES.map((p) => ({
          id: createId(),
          membershipId,
          permission: p,
        }))
      );

      await tx.insert(schema.lifecycleLogs).values({
        entityType: "space" as const,
        entityId: spaceId,
        message: "Space created",
      });

      // Only log the credit grant when one actually happened — a $0 row
      // would mislead the billing event log.
      if (creditGrant > 0) {
        await tx.insert(schema.billingEvents).values({
          id: createId(),
          spaceId,
          amount: creditGrant.toFixed(4),
          type: "credit_grant",
          description: "Initial credit grant",
        });
      }
    });

    const [space] = await db
      .select()
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId));

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "space.create",
      category: "space",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: `Created space "${name.trim()}"`,
      metadata: {
        spaceId,
        name: name.trim(),
        planId: defaultPlan.id,
        initialCreditUsd: isFirstSpace ? defaultIncludedCredit : 0,
      },
      source: "api",
      ...reqCtx,
    });

    return Response.json(space, { status: 201 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
