import type { NextRequest } from "next/server";

import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { dbClient } from "@/lib/db";
import { getBoss } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

const ALL_QUEUE_NAMES = Object.values(JOB_NAMES);

/**
 * GET /api/orbit/queues
 *
 * Returns queue overview (sizes, schedules) and optionally jobs for a specific queue.
 *
 * Query params:
 *   ?queue=billing.hourly      — fetch jobs for a specific queue
 *   ?state=failed              — filter by job state (created|retry|active|completed|cancelled|failed)
 *   ?limit=50                  — max jobs to return (default 50, max 200)
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const url = new URL(request.url);
    const queueFilter = url.searchParams.get("queue");
    const stateFilter = url.searchParams.get("state");
    const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
    const limit = Math.min(200, Math.max(1, isNaN(rawLimit) ? 50 : rawLimit));

    const boss = await getBoss();

    // Always fetch schedules for overview
    const schedules = await boss.getSchedules();

    // If no specific queue requested, return overview with job counts per queue
    if (!queueFilter) {
      // Single findJobs call per queue (24 calls total), count states in memory
      const queueSummaries = await Promise.all(
        ALL_QUEUE_NAMES.map(async (name) => {
          try {
            const allJobs = await boss.findJobs(name);

            let failed = 0;
            let active = 0;
            let retry = 0;
            let queued = 0;
            for (const j of allJobs) {
              if (j.state === "failed") {
                failed++;
              } else if (j.state === "active") {
                active++;
              } else if (j.state === "retry") {
                retry++;
              } else if (j.state === "created") {
                queued++;
              }
            }

            return {
              name,
              failed,
              active,
              retry,
              queued,
              schedule: schedules.find((s) => s.name === name)?.cron ?? null,
            };
          } catch {
            return {
              name,
              failed: 0,
              active: 0,
              retry: 0,
              queued: 0,
              schedule: schedules.find((s) => s.name === name)?.cron ?? null,
            };
          }
        })
      );

      return Response.json({
        queues: queueSummaries,
        schedules: schedules.map((s) => ({
          name: s.name,
          cron: s.cron,
          timezone: s.timezone,
        })),
      });
    }

    // Validate queue name
    if (
      !ALL_QUEUE_NAMES.includes(queueFilter as (typeof ALL_QUEUE_NAMES)[number])
    ) {
      return Response.json({ error: "Invalid queue name" }, { status: 400 });
    }

    // Fetch jobs for the specific queue
    const allJobs = await boss.findJobs(queueFilter);

    // Filter by state if requested
    const validStates = [
      "created",
      "retry",
      "active",
      "completed",
      "cancelled",
      "failed",
    ];
    let filteredJobs = allJobs;
    if (stateFilter && validStates.includes(stateFilter)) {
      filteredJobs = allJobs.filter((j) => j.state === stateFilter);
    }

    // Sort: failed first, then retry, then active, then created, then rest
    const stateOrder: Record<string, number> = {
      failed: 0,
      retry: 1,
      active: 2,
      created: 3,
      completed: 4,
      cancelled: 5,
    };
    filteredJobs.sort(
      (a, b) => (stateOrder[a.state] ?? 99) - (stateOrder[b.state] ?? 99)
    );

    // Limit
    const jobs = filteredJobs.slice(0, limit).map((j) => ({
      id: j.id,
      name: j.name,
      state: j.state,
      data: j.data,
      priority: j.priority,
      retryLimit: j.retryLimit,
      retryCount: j.retryCount,
      retryDelay: j.retryDelay,
      startAfter: j.startAfter?.toISOString() ?? null,
      startedOn: j.startedOn?.toISOString() ?? null,
      createdOn: j.createdOn?.toISOString() ?? null,
      completedOn: j.completedOn?.toISOString() ?? null,
      expireInSeconds: j.expireInSeconds,
    }));

    return Response.json({
      queue: queueFilter,
      total: filteredJobs.length,
      jobs,
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET /api/orbit/queues error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/orbit/queues
 *
 * Perform actions on jobs: retry, cancel
 *
 * Body: { action: "retry" | "cancel", queue: string, jobId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAdmin(request);

    const body = await request.json();
    const { action, queue, jobId } = body;

    if (!action || !queue || !jobId) {
      return Response.json(
        { error: "action, queue, and jobId are required" },
        { status: 400 }
      );
    }

    if (!ALL_QUEUE_NAMES.includes(queue)) {
      return Response.json({ error: "Invalid queue name" }, { status: 400 });
    }

    if (!["retry", "cancel", "retry_all_failed"].includes(action)) {
      return Response.json(
        {
          error: "action must be 'retry', 'cancel', or 'retry_all_failed'",
        },
        { status: 400 }
      );
    }

    const boss = await getBoss();

    // Bulk: retry every failed job in the queue. jobId is ignored.
    if (action === "retry_all_failed") {
      // findJobs is a read-only listing (no state change); we then call
      // boss.retry on each failed id. Idempotent — re-running after some
      // jobs have already transitioned simply skips those.
      const allJobs = await boss.findJobs(queue);
      const failedIds = allJobs
        .filter((j) => j.state === "failed")
        .map((j) => j.id);
      let retried = 0;
      for (const id of failedIds) {
        try {
          await boss.retry(queue, id);
          retried++;
        } catch {
          // Ignore — job state may have changed mid-loop.
        }
      }

      const reqCtx = extractRequestContext(request.headers);
      audit({
        action: "queue.retry_all_failed",
        category: "app",
        actorType: "admin",
        actorId: session.user.id,
        actorEmail: session.user.email,
        entityType: "queue",
        entityId: queue,
        description: `Admin retried ${retried} failed jobs in queue ${queue}`,
        metadata: { queue, attempted: failedIds.length, retried },
        source: "api",
        ...reqCtx,
      });

      return Response.json({
        success: true,
        message:
          retried === 0
            ? "No failed jobs were eligible for retry"
            : `Re-queued ${retried} failed ${retried === 1 ? "job" : "jobs"} for retry`,
        retried,
      });
    }

    // Verify job exists (per-job actions)
    const job = await boss.getJobById(queue, jobId);
    if (!job) {
      return Response.json({ error: "Job not found" }, { status: 404 });
    }

    const reqCtx = extractRequestContext(request.headers);

    if (action === "retry") {
      if (job.state !== "failed") {
        return Response.json(
          { error: "Only failed jobs can be retried" },
          { status: 400 }
        );
      }
      await boss.retry(queue, jobId);

      audit({
        action: "queue.job_retried",
        category: "app",
        actorType: "admin",
        actorId: session.user.id,
        actorEmail: session.user.email,
        entityType: "job",
        entityId: jobId,
        description: `Admin retried failed job in queue ${queue}`,
        metadata: { queue, jobId, jobData: job.data },
        source: "api",
        ...reqCtx,
      });

      return Response.json({ success: true, message: "Job queued for retry" });
    }

    if (action === "cancel") {
      if (job.state === "completed" || job.state === "cancelled") {
        return Response.json(
          { error: "Job is already completed or cancelled" },
          { status: 400 }
        );
      }

      // pg-boss's boss.cancel() runs `UPDATE pgboss.job SET state='cancelled'
      // WHERE state < 'completed'` — and the pg-boss job_state enum orders
      // `created < retry < active < completed < cancelled < failed`. So a
      // `failed` row silently no-ops (it's "greater than" completed in the
      // enum). When an admin clicks Cancel on a terminally-failed row they
      // want it off the red-badge list, so flip it directly. Workers only
      // fetch `created`/`retry` rows, so a `cancelled` row is inert either
      // way — this is purely a triage/UX state change, not a runtime one.
      if (job.state === "failed") {
        await dbClient`
          UPDATE pgboss.job
          SET state = 'cancelled', completed_on = now()
          WHERE name = ${queue} AND id = ${jobId} AND state = 'failed'
        `;
      } else {
        await boss.cancel(queue, jobId);
      }

      audit({
        action: "queue.job_cancelled",
        category: "app",
        actorType: "admin",
        actorId: session.user.id,
        actorEmail: session.user.email,
        entityType: "job",
        entityId: jobId,
        description: `Admin cancelled job in queue ${queue} (was ${job.state})`,
        metadata: { queue, jobId, previousState: job.state, jobData: job.data },
        source: "api",
        ...reqCtx,
      });

      return Response.json({ success: true, message: "Job cancelled" });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST /api/orbit/queues error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
