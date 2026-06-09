import { and, desc, eq, ne } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { applyCreditTopup } from "@/lib/billing/apply-topup";
import { chargeProratedUsageWithAudit } from "@/lib/cost";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";
import { getSpaceOwner } from "@/lib/email/helpers";
import { creditGrantedEmailTemplate } from "@/lib/email/templates/credit-granted";
import { env } from "@/lib/env";
import { collectSpaceDeletionSummary } from "@/lib/orbit/deletion-summaries";
import { enqueueJob } from "@/lib/worker/enqueue";
import type { SpaceDeletionSummaryPayload } from "@/lib/worker/job-types";
import { JOB_NAMES } from "@/lib/worker/job-types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    await requireAdmin(request);

    const { spaceId } = await params;

    const [space] = await db
      .select()
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId))
      .limit(1);

    if (!space) {
      return Response.json({ error: "Space not found" }, { status: 404 });
    }

    const members = await db
      .select({
        membership: schema.spaceMemberships,
        user: {
          id: schema.user.id,
          email: schema.user.email,
          name: schema.user.name,
          image: schema.user.image,
        },
      })
      .from(schema.spaceMemberships)
      .innerJoin(
        schema.user,
        eq(schema.spaceMemberships.userId, schema.user.id)
      )
      .where(eq(schema.spaceMemberships.spaceId, spaceId));

    const cubeList = await db
      .select()
      .from(schema.cubes)
      .where(
        and(
          eq(schema.cubes.spaceId, spaceId),
          ne(schema.cubes.status, "deleted")
        )
      );

    const billingHistory = await db
      .select()
      .from(schema.billingEvents)
      .where(eq(schema.billingEvents.spaceId, spaceId))
      .orderBy(desc(schema.billingEvents.createdAt))
      .limit(100);

    return Response.json({
      space,
      members: members.map((m) => ({
        ...m.user,
        isOwner: m.membership.isOwner,
        membershipId: m.membership.id,
      })),
      cubes: cubeList,
      billingEvents: billingHistory,
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET /api/orbit/spaces/[spaceId] error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    const session = await requireAdmin(request);

    const { spaceId } = await params;
    const body = await request.json();
    const { amount, note, name } = body;

    if (amount === undefined && name === undefined) {
      return Response.json(
        { error: "At least one of amount or name is required" },
        { status: 400 }
      );
    }

    if (amount !== undefined) {
      if (
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        return Response.json(
          { error: "amount must be a positive finite number" },
          { status: 400 }
        );
      }
      // Validate precision: max 4 decimal places to match DB numeric(12,4)
      const decimalStr = String(amount).split(".")[1];
      if (decimalStr && decimalStr.length > 4) {
        return Response.json(
          { error: "amount must have at most 4 decimal places" },
          { status: 400 }
        );
      }
      // Cap at reasonable maximum to prevent accidental or malicious large grants
      if (amount > 100_000) {
        return Response.json(
          { error: "amount exceeds maximum allowed value of 100,000" },
          { status: 400 }
        );
      }
    }

    if (name !== undefined) {
      const trimmed = typeof name === "string" ? name.trim() : "";
      if (!trimmed || trimmed.length > 64) {
        return Response.json(
          { error: "name must be 1–64 characters" },
          { status: 400 }
        );
      }
    }

    const [space] = await db
      .select()
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId))
      .limit(1);

    if (!space) {
      return Response.json({ error: "Space not found" }, { status: 404 });
    }

    const reqCtx = extractRequestContext(request.headers);

    // Apply rename if requested
    if (name !== undefined) {
      const trimmedName = (name as string).trim();
      await db
        .update(schema.spaces)
        .set({ name: trimmedName, updatedAt: new Date() })
        .where(eq(schema.spaces.id, spaceId));

      await db.insert(schema.lifecycleLogs).values({
        entityType: "space",
        entityId: spaceId,
        message: `Admin renamed space to "${trimmedName}"`,
      });

      audit({
        action: "space.admin_update",
        category: "space",
        actorType: "admin",
        actorId: session.user.id,
        actorEmail: session.user.email,
        entityType: "space",
        entityId: spaceId,
        spaceId,
        description: `Admin renamed space to "${trimmedName}"`,
        metadata: { spaceId, name: trimmedName },
        source: "api",
        ...reqCtx,
      });
    }

    // Apply credit top-up if requested
    if (amount !== undefined) {
      // Apply the grant through the shared credit-apply helper (the same path
      // the Polar top-up webhook uses). The helper does the FOR UPDATE lock,
      // balance increment, ledger row, and zeroBalanceSleep clear inside the
      // transaction, and returns the cube ids to wake after commit.
      const applied = await db.transaction(async (tx) =>
        applyCreditTopup({
          tx,
          spaceId,
          amount: Number(amount),
          type: "credit_grant",
          description:
            note || `Admin credit grant of $${Number(amount).toFixed(4)}`,
        })
      );

      const newBalance = applied
        ? applied.newBalance
        : Number(space.creditBalance);
      const wakeCubeIds = applied ? applied.wakeCubeIds : [];

      // Wake zero-balance-slept cubes AFTER the transaction commits.
      for (const cubeId of wakeCubeIds) {
        const [cube] = await db
          .select({ serverId: schema.cubes.serverId })
          .from(schema.cubes)
          .where(eq(schema.cubes.id, cubeId))
          .limit(1);
        if (cube) {
          await enqueueJob(JOB_NAMES.CUBE_WAKE, {
            cubeId,
            spaceId,
            serverId: cube.serverId,
          });
        }
      }

      await db.insert(schema.lifecycleLogs).values({
        entityType: "space",
        entityId: spaceId,
        message: `Admin topped up credits by ${amount}${note ? `: ${note}` : ""}`,
      });

      // Notify space owner about the credit grant
      try {
        const owner = await getSpaceOwner(spaceId);
        if (owner) {
          const spaceUrl = `${env.NEXT_PUBLIC_APP_URL}/${spaceId}/billing`;
          const { html, text } = await creditGrantedEmailTemplate({
            userName: owner.name,
            spaceName: owner.spaceName,
            amount: String(amount),
            newBalance: newBalance.toFixed(2),
            note: note || undefined,
            spaceUrl,
          });
          await enqueueEmail({
            to: owner.email,
            subject: `Credits added to ${owner.spaceName}`,
            html,
            text,
          });
        }
      } catch (err) {
        console.error(
          `[orbit] failed to send credit-granted email for space ${spaceId}:`,
          err
        );
      }

      audit({
        action: "billing.credit_grant",
        category: "billing",
        actorType: "admin",
        actorId: session.user.id,
        actorEmail: session.user.email,
        entityType: "space",
        entityId: spaceId,
        spaceId,
        description: `Admin granted ${amount} credits to space "${spaceId}"`,
        metadata: {
          spaceId,
          amount,
          note: note || null,
          newBalance: newBalance.toFixed(4),
        },
        source: "api",
        ...reqCtx,
      });

      const [updatedSpace] = await db
        .select()
        .from(schema.spaces)
        .where(eq(schema.spaces.id, spaceId))
        .limit(1);

      return Response.json({ space: updatedSpace });
    }

    const [refreshed] = await db
      .select()
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId))
      .limit(1);

    return Response.json({ space: refreshed });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("PATCH /api/orbit/spaces/[spaceId] error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    const session = await requireAdmin(request);

    const { spaceId } = await params;

    const [space] = await db
      .select()
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId))
      .limit(1);

    if (!space) {
      return Response.json({ error: "Space not found" }, { status: 404 });
    }

    const activeCubes = await db
      .select()
      .from(schema.cubes)
      .where(
        and(
          eq(schema.cubes.spaceId, spaceId),
          ne(schema.cubes.status, "deleted")
        )
      );

    // Charge prorated usage for all running cubes before anything is torn
    // down. chargeProratedUsage clears lastBilledAt, so cube.delete's own
    // prorated charge is skipped — no double charge.
    //
    // Rule 51: catch + audit the failure. An uncaught throw here would abort
    // the entire admin space-delete with the storage-cleanup half-done. The
    // delete should proceed even if billing fails — the audit row is the
    // operator's record that revenue was lost.
    for (const cube of activeCubes) {
      if (cube.lastBilledAt) {
        await chargeProratedUsageWithAudit(
          {
            id: cube.id,
            spaceId,
            vcpus: cube.vcpus,
            ramMb: cube.ramMb,
            diskLimitGb: cube.diskLimitGb,
            lastBilledAt: cube.lastBilledAt,
          },
          {
            flow: "orbit space delete",
            logPrefix: `[orbit deleteSpace] cube ${cube.id}`,
            actor: {
              type: "user",
              id: session.user.id,
              email: session.user.email,
            },
            source: "api",
          }
        );
      }
    }

    // Collect every storage-backend object the space owns — snapshots AND
    // backups — so a force-delete leaves nothing behind on the buckets.
    // Backups normally survive cube deletion; a space delete removes them.
    const snapshotObjects = await db
      .select({
        storagePath: schema.cubeSnapshots.storagePath,
        storageBackendId: schema.cubeSnapshots.storageBackendId,
      })
      .from(schema.cubeSnapshots)
      .where(eq(schema.cubeSnapshots.spaceId, spaceId));
    const backupObjects = await db
      .select({
        storagePath: schema.cubeBackups.storagePath,
        storageBackendId: schema.cubeBackups.storageBackendId,
      })
      .from(schema.cubeBackups)
      .where(eq(schema.cubeBackups.spaceId, spaceId));

    // Tear down each cube's infrastructure (VM, host disk, networking) via
    // cube.delete.
    for (const cube of activeCubes) {
      await enqueueJob(JOB_NAMES.CUBE_DELETE, {
        cubeId: cube.id,
        spaceId,
        serverId: cube.serverId,
      });
    }

    // Delete every snapshot + backup object from the storage backends,
    // grouped by backend. storage.cleanup is retryable and treats a missing
    // object as success, so overlap with cube.delete's own snapshot cleanup
    // is harmless.
    const pathsByBackend = new Map<string, string[]>();
    for (const obj of [...snapshotObjects, ...backupObjects]) {
      if (!obj.storagePath || !obj.storageBackendId) {
        continue;
      }
      const paths = pathsByBackend.get(obj.storageBackendId) ?? [];
      paths.push(obj.storagePath);
      pathsByBackend.set(obj.storageBackendId, paths);
    }
    for (const [storageBackendId, storagePaths] of pathsByBackend) {
      await enqueueJob(JOB_NAMES.STORAGE_CLEANUP, {
        storagePaths,
        storageBackendId,
        reason: `Space "${space.name}" deleted`,
      });
    }

    // Snapshot what's being deleted BEFORE the worker tears it down, so the
    // admin notification email shipped from the worker after the cascade has
    // accurate counts (cubes, snapshots, backups, members, …).
    const deletionSummary = await collectSpaceDeletionSummary(spaceId, {
      type: "admin",
      userId: session.user.id,
      email: session.user.email,
    });

    // Serialize the summary for pg-boss (Date → ISO string).
    const summaryPayload: SpaceDeletionSummaryPayload | undefined =
      deletionSummary
        ? {
            ...deletionSummary,
            createdAt: deletionSummary.createdAt.toISOString(),
          }
        : undefined;

    // Hand the space-row deletion to a worker job. It waits for the
    // cube.delete jobs above to finish before dropping the row — deleting it
    // now would cascade-remove the cube rows mid-deletion and make those jobs
    // no-op (leaking VMs + host disks).
    await enqueueJob(
      JOB_NAMES.SPACE_DELETE,
      { spaceId, summary: summaryPayload },
      { singletonKey: spaceId }
    );

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "space.delete",
      category: "space",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: `Admin force-deleted space "${space.name}"`,
      metadata: {
        spaceId,
        spaceName: space.name,
        cubes: activeCubes.length,
        snapshotFiles: snapshotObjects.length,
        backupFiles: backupObjects.length,
      },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("DELETE /api/orbit/spaces/[spaceId] error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
