import type { Job } from "pg-boss";
import { db } from "@/lib/db";
import { s3DeleteMany } from "@/lib/storage/s3";
import { enqueue } from "@/lib/worker/boss";
import { JOB_NAMES, type WorkspaceDeletePayload } from "@/lib/worker/job-types";
import { workspaceDeletedEmail } from "@/lib/email/templates/workspace-invite";

const R2_DELETE_BATCH = 50;

/** fileUrl may be a bare key or a full URL — normalize to the R2 key. */
function toStorageKey(fileUrl: string): string {
  if (!/^https?:\/\//.test(fileUrl)) return fileUrl;
  try {
    return new URL(fileUrl).pathname.replace(/^\/+/, "");
  } catch {
    return fileUrl;
  }
}

export async function handleWorkspaceDelete(jobs: Job<WorkspaceDeletePayload>[]): Promise<void> {
  for (const job of jobs) {
    const { workspaceId, requestedBy } = job.data;

    const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) continue; // already deleted — retry after partial completion
    if (workspace.status !== "DELETING") {
      console.warn(`[worker] workspace.delete skipped — ${workspaceId} is not marked deleting`);
      continue;
    }

    // 1. R2 files FIRST. If this crashes, DB references survive and the job
    //    retries safely. DB-first would orphan files forever (docs/workspace.md).
    const attachments = await db.taskAttachment.findMany({
      where: { task: { workspaceId } },
      select: { fileUrl: true },
    });
    const keys = attachments.map((a) => toStorageKey(a.fileUrl));
    for (let i = 0; i < keys.length; i += R2_DELETE_BATCH) {
      await s3DeleteMany(keys.slice(i, i + R2_DELETE_BATCH));
    }

    // 2. DB records in dependency order. Task delete cascades assignees,
    //    watchers, tags, dependencies, checklists, comments, reactions,
    //    activity logs, time logs, attachments, snapshots, sprint links.
    const listIds = (
      await db.list.findMany({ where: { space: { workspaceId } }, select: { id: true } })
    ).map((l) => l.id);

    await db.$transaction([
      db.task.deleteMany({ where: { workspaceId } }),
      db.sprint.deleteMany({ where: { workspaceId } }),
      db.savedFilter.deleteMany({ where: { listId: { in: listIds } } }),
      db.list.deleteMany({ where: { space: { workspaceId } } }),
      db.space.deleteMany({ where: { workspaceId } }),
      db.tag.deleteMany({ where: { workspaceId } }),
      db.notification.deleteMany({ where: { workspaceId } }),
      db.userSearchHistory.deleteMany({ where: { workspaceId } }),
      db.userOnboardingProgress.deleteMany({ where: { workspaceId } }),
      db.userNotificationPreference.deleteMany({ where: { workspaceId } }),
      db.workspaceMember.deleteMany({ where: { workspaceId } }),
      db.workspace.delete({ where: { id: workspaceId } }),
    ]);

    // 3. Platform-level audit trail survives the workspace
    await db.platformAuditLog.create({
      data: {
        adminId: requestedBy,
        action: "workspace.deleted",
        targetType: "WORKSPACE",
        targetId: workspaceId,
        meta: { name: workspace.name },
      },
    });

    // 4. Confirmation email to the Owner who requested it
    const owner = await db.user.findUnique({
      where: { id: requestedBy },
      select: { email: true },
    });
    if (owner) {
      const { subject, html, text } = workspaceDeletedEmail({ workspaceName: workspace.name });
      await enqueue(JOB_NAMES.SEND_EMAIL, { to: owner.email, subject, html, text });
    }

    console.log(`[worker] workspace.delete → ${workspaceId} (${workspace.name})`);
  }
}
