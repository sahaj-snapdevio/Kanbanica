/**
 * Cancel an in-progress cube transfer.
 *
 * Atomically marks the transfer as "cancelling" (preventing the transfer
 * job from completing its atomic flip) and enqueues a cleanup job that
 * SSHes to the destination to tear down any partial state and, if the
 * source was slept for cutover, wakes it back up.
 */

import { eq } from "drizzle-orm";
import { cubes } from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueueJob } from "@/lib/worker/enqueue";
import type { CubeTransferCancelPayload } from "@/lib/worker/job-types";
import { JOB_NAMES } from "@/lib/worker/job-types";

const CANCELLABLE_STATES = ["snapshotting", "restoring", "finalizing"] as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cubeId: string }> }
) {
  try {
    const session = await requireAdmin(request);
    const { cubeId } = await params;

    // Read state + flip atomically so the previousTransferState passed to
    // the handler is guaranteed consistent with what the flip overwrote.
    // Without the transaction, two reads at different points in time can
    // observe different transferState values and the handler would lose
    // the pre-flip signal needed to decide whether to wake the source
    // (see audit H4, 2026-05-24).
    const captured = await db.transaction(async (tx) => {
      const [c] = await tx
        .select()
        .from(cubes)
        .where(eq(cubes.id, cubeId))
        .for("update")
        .limit(1);
      if (!c) {
        return { kind: "not-found" as const };
      }
      if (
        !CANCELLABLE_STATES.includes(
          c.transferState as (typeof CANCELLABLE_STATES)[number]
        )
      ) {
        return {
          kind: "bad-state" as const,
          transferState: c.transferState,
        };
      }
      await tx
        .update(cubes)
        .set({ transferState: "cancelling", updatedAt: new Date() })
        .where(eq(cubes.id, cubeId));
      return {
        kind: "captured" as const,
        cube: c,
        previousTransferState:
          c.transferState as (typeof CANCELLABLE_STATES)[number],
        cubeStatusAtCancel: c.status as string,
      };
    });

    if (captured.kind === "not-found") {
      return Response.json({ error: "Cube not found" }, { status: 404 });
    }
    if (captured.kind === "bad-state") {
      return Response.json(
        {
          error: `Transfer cannot be cancelled in state "${captured.transferState}". Must be one of: ${CANCELLABLE_STATES.join(", ")}`,
        },
        { status: 409 }
      );
    }

    const { cube, previousTransferState, cubeStatusAtCancel } = captured;

    const payload: CubeTransferCancelPayload = {
      cubeId,
      spaceId: cube.spaceId,
      sourceServerId: cube.serverId,
      destinationServerId: cube.transferDestinationServerId,
      previousTransferState,
      cubeStatusAtCancel,
      actorId: session.user.id,
      actorEmail: session.user.email,
    };

    // singletonKey + the queue's `exclusive` policy collapse a double-click
    // into one in-flight cancel per cube (defense-in-depth on top of the
    // state-flip out of CANNABLE_STATES above).
    await enqueueJob(JOB_NAMES.CUBE_TRANSFER_CANCEL, payload, {
      singletonKey: `transfer-cancel:${cubeId}`,
    });

    audit({
      action: "cube.transfer_cancel_requested",
      category: "cube",
      actorType: "admin",
      actorId: session.user.id,
      entityType: "cube",
      entityId: cubeId,
      spaceId: cube.spaceId,
      description: `Admin ${session.user.email} cancelled in-progress transfer (was ${previousTransferState})`,
      metadata: {
        previousTransferState,
        cubeStatusAtCancel,
        destinationServerId: cube.transferDestinationServerId,
      },
      source: "api",
      ...extractRequestContext(request.headers),
    });

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(
      "POST /api/orbit/cubes/[cubeId]/transfer/cancel error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
