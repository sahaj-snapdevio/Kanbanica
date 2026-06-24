import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { space } from "@/db/schema";
import { getWorkspaceMembership } from "@/lib/permissions";
import { SprintSettingsForm } from "@/components/sprint/sprint-settings-form";

interface PageProps {
  params: Promise<{ workspaceId: string; spaceId: string }>;
}

export default async function SprintSettingsPage({ params }: PageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { workspaceId, spaceId } = await params;

  const [s] = await db
    .select({
      sprintStartDay: space.sprintStartDay,
      sprintDefaultDurationWeeks: space.sprintDefaultDurationWeeks,
      sprintNameFormat: space.sprintNameFormat,
      sprintDateFormat: space.sprintDateFormat,
      sprintAutoMarkDone: space.sprintAutoMarkDone,
      sprintAutoCreateNext: space.sprintAutoCreateNext,
      sprintAutoMoveIncomplete: space.sprintAutoMoveIncomplete,
      sprintAutoArchiveAfterN: space.sprintAutoArchiveAfterN,
      name: space.name,
    })
    .from(space)
    .where(and(eq(space.id, spaceId), eq(space.workspaceId, workspaceId)));

  if (!s) notFound();

  const wm = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!wm) notFound();

  return (
    <SprintSettingsForm
      workspaceId={workspaceId}
      spaceId={spaceId}
      spaceName={s.name}
      initialSettings={{
        sprintStartDay: s.sprintStartDay,
        sprintDefaultDurationWeeks: s.sprintDefaultDurationWeeks,
        sprintNameFormat: s.sprintNameFormat,
        sprintDateFormat: s.sprintDateFormat,
        sprintAutoMarkDone: s.sprintAutoMarkDone,
        sprintAutoCreateNext: s.sprintAutoCreateNext,
        sprintAutoMoveIncomplete: s.sprintAutoMoveIncomplete,
        sprintAutoArchiveAfterN: s.sprintAutoArchiveAfterN,
      }}
    />
  );
}
