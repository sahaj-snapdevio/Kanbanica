"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";

const DEFAULT_STATUSES = [
  { name: "Todo", color: "#9CA3AF", type: "OPEN", orderIndex: 0 },
  { name: "In Progress", color: "#3B82F6", type: "ACTIVE", orderIndex: 1 },
  { name: "Review", color: "#8B5CF6", type: "ACTIVE", orderIndex: 2 },
  { name: "Done", color: "#22C55E", type: "CLOSED", orderIndex: 3 },
] as const;

async function getSessionUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return session.user;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "workspace"
  );
}

async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; ; i++) {
    const existing = await db.workspace.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) return slug;
    slug = `${base}-${i}`;
  }
}

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Workspace name is required").max(100),
  logoEmoji: z.string().trim().max(8).optional().nullable(),
});

export async function createOnboardingWorkspace(input: {
  name: string;
  logoEmoji?: string | null;
}): Promise<{ workspaceId: string } | { error: string }> {
  const user = await getSessionUser();

  const parsed = createWorkspaceSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { name, logoEmoji } = parsed.data;

  const slug = await generateUniqueSlug(name);

  const workspace = await db.$transaction(async (tx) => {
    const workspace = await tx.workspace.create({
      data: {
        name,
        slug,
        logoEmoji: logoEmoji || null,
        createdBy: user.id,
      },
    });

    await tx.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        role: "OWNER",
        status: "ACTIVE",
        joinedAt: new Date(),
      },
    });

    await tx.userOnboardingProgress.create({
      data: { userId: user.id, workspaceId: workspace.id },
    });

    return workspace;
  });

  return { workspaceId: workspace.id };
}

const createSpaceSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1, "Space name is required").max(100),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Invalid color")
    .optional()
    .nullable(),
});

const WELCOME_TASK_DESCRIPTION = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "This is a task. You can set a status, assign it to someone, add a due date, and leave comments. Try editing this task or create your own below.",
        },
      ],
    },
  ],
};

export async function createOnboardingSpace(input: {
  workspaceId: string;
  name: string;
  color?: string | null;
}): Promise<{ error: string } | never> {
  const user = await getSessionUser();

  const parsed = createSpaceSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { workspaceId, name, color } = parsed.data;

  const membership = await db.workspaceMember.findFirst({
    where: { workspaceId, userId: user.id, status: "ACTIVE" },
    include: { workspace: true },
  });
  if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
    return { error: "You do not have permission to create a Space here" };
  }

  const { space, list, taskId } = await db.$transaction(async (tx) => {
    const space = await tx.space.create({
      data: {
        workspaceId,
        name,
        color: color || null,
        createdBy: user.id,
      },
    });

    await tx.spaceMember.create({
      data: { spaceId: space.id, userId: user.id, permission: "FULL_ACCESS" },
    });

    // Default List so the user can add tasks immediately (docs/space.md §1)
    const list = await tx.list.create({
      data: { spaceId: space.id, name: "List", createdBy: user.id },
    });

    const statuses = await Promise.all(
      DEFAULT_STATUSES.map((s) =>
        tx.listStatus.create({
          data: { listId: list.id, name: s.name, color: s.color, type: s.type, orderIndex: s.orderIndex },
        }),
      ),
    );
    const todoStatus = statuses[0];

    // Demo welcome task (docs/empty-states.md §2) — only for the very first Space
    let taskId: string | null = null;
    const existingTasks = await tx.task.count({ where: { workspaceId } });
    if (existingTasks === 0) {
      const { taskSeq } = await tx.workspace.update({
        where: { id: workspaceId },
        data: { taskSeq: { increment: 1 } },
        select: { taskSeq: true },
      });

      const task = await tx.task.create({
        data: {
          seqNumber: taskSeq,
          workspaceId,
          listId: list.id,
          statusId: todoStatus.id,
          title: `👋 Welcome to ${membership.workspace.name} — click here to see how a task works`,
          description: WELCOME_TASK_DESCRIPTION,
          reporterId: user.id,
          assignees: { create: { userId: user.id } },
        },
      });

      const demoTag = await tx.tag.upsert({
        where: { workspaceId_name: { workspaceId, name: "demo" } },
        update: {},
        create: { workspaceId, name: "demo", color: "#9CA3AF" },
      });
      await tx.taskTag.create({ data: { taskId: task.id, tagId: demoTag.id } });
      taskId = task.id;
    }

    return { space, list, taskId };
  });

  if (taskId) {
    writeActivityLog({ taskId, userId: user.id, eventType: "task.created" });
  }

  redirect(`/${workspaceId}/${space.id}/list/${list.id}`);
}

export async function dismissGettingStarted(workspaceId: string): Promise<void> {
  const user = await getSessionUser();
  await db.userOnboardingProgress.updateMany({
    where: { userId: user.id, workspaceId, dismissedAt: null },
    data: { dismissedAt: new Date() },
  });
}
