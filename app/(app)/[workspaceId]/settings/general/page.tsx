import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { GeneralSettingsForm } from "@/components/workspace/general-settings-form";

interface GeneralSettingsPageProps {
  params: Promise<{ workspaceId: string }>;
}

export default async function GeneralSettingsPage({ params }: GeneralSettingsPageProps) {
  const { workspaceId } = await params;

  const workspace = await db.workspace.findFirst({
    where: { id: workspaceId, status: "ACTIVE" },
    select: { id: true, name: true, slug: true, logoEmoji: true },
  });
  if (!workspace) notFound();

  return <GeneralSettingsForm workspace={workspace} />;
}
