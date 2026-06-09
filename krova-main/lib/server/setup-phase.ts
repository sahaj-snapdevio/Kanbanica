/**
 * Atomic setup-phase transition helpers + Pusher push for live UI updates.
 *
 * Phase order: bootstrap -> install -> pull_images -> network -> reboot -> verify -> ready
 *
 * All transitions are idempotent — a "claim running" sets idle->running only;
 * "complete success" advances to the next phase only when status was running;
 * "fail" sets running->failed with an error message.
 */

import { and, eq, ne } from "drizzle-orm";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { triggerEvent } from "@/lib/pusher";

export type SetupPhase =
  | "bootstrap"
  | "install"
  | "pull_images"
  | "network"
  | "reboot"
  | "verify"
  | "ready";

export type SetupStatus = "idle" | "running" | "failed";

const PHASE_ORDER: SetupPhase[] = [
  "bootstrap",
  "install",
  "pull_images",
  "network",
  "reboot",
  "verify",
  "ready",
];

export function nextPhase(current: SetupPhase): SetupPhase {
  const idx = PHASE_ORDER.indexOf(current);
  if (idx < 0 || idx >= PHASE_ORDER.length - 1) {
    return "ready";
  }
  return PHASE_ORDER[idx + 1];
}

async function notify(serverId: string) {
  try {
    await triggerEvent(`private-server-${serverId}`, "setup.update", {
      serverId,
    });
  } catch {
    // pusher is best-effort
  }
}

/**
 * Mark the given phase as running. Returns false if the server is not currently
 * sitting on this phase with status idle/failed (i.e. another worker raced us
 * or the operator skipped a phase).
 */
export async function claimPhaseRunning(
  serverId: string,
  phase: SetupPhase
): Promise<boolean> {
  const result = await db
    .update(schema.servers)
    .set({
      setupStatus: "running",
      setupError: null,
      setupStartedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.servers.id, serverId),
        eq(schema.servers.setupPhase, phase),
        ne(schema.servers.setupStatus, "running")
      )
    )
    .returning({ id: schema.servers.id });

  await notify(serverId);
  return result.length > 0;
}

/**
 * Phase succeeded — advance to the next phase, idle status. Reaching "ready"
 * does NOT auto-activate the server: setup completion leaves `status` untouched
 * (a freshly-set-up server ends "ready" + "inactive") and an operator activates
 * it manually from Orbit. This keeps a not-yet-vetted host out of the allocation
 * pool until a human explicitly opts it in.
 */
export async function completePhase(
  serverId: string,
  phase: SetupPhase
): Promise<void> {
  const next = nextPhase(phase);
  await db
    .update(schema.servers)
    .set({
      setupPhase: next,
      setupStatus: "idle",
      setupError: null,
      setupStartedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.servers.id, serverId),
        eq(schema.servers.setupPhase, phase),
        eq(schema.servers.setupStatus, "running")
      )
    );

  await notify(serverId);
}

/** Phase failed — keep on this phase, mark failed, store error. */
export async function failPhase(
  serverId: string,
  phase: SetupPhase,
  error: string
): Promise<void> {
  await db
    .update(schema.servers)
    .set({
      setupStatus: "failed",
      setupError: error.slice(0, 2000),
      setupStartedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(schema.servers.id, serverId), eq(schema.servers.setupPhase, phase))
    );

  await notify(serverId);
}
