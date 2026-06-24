import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { list } from "@/db/schema";
import { ListGeneralSettingsForm } from "@/components/list/list-general-settings-form";

interface PageProps {
  params: Promise<{ workspaceId: string; spaceId: string; listId: string }>;
}

export default async function ListGeneralSettingsPage({ params }: PageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { workspaceId, spaceId, listId } = await params;

  const [l] = await db
    .select({ name: list.name, color: list.color, description: list.description })
    .from(list)
    .where(and(eq(list.id, listId), eq(list.spaceId, spaceId)));
  if (!l) notFound();

  return (
    <ListGeneralSettingsForm
      workspaceId={workspaceId}
      spaceId={spaceId}
      listId={listId}
      initialName={l.name}
      initialColor={l.color}
      initialDescription={l.description}
    />
  );
}
