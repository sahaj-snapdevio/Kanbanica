import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workspace } from "@/db/schema";
import { GeneralSettingsForm } from "@/components/workspace/general-settings-form";

interface GeneralSettingsPageProps {
  params: Promise<{ workspaceId: string }>;
}

export const metadata = { title: "General Settings — Kanbanica" };

export default async function GeneralSettingsPage({ params }: GeneralSettingsPageProps) {
  const { workspaceId } = await params;

  const [ws] = await db
    .select({ id: workspace.id, name: workspace.name, slug: workspace.slug, logoEmoji: workspace.logoEmoji })
    .from(workspace)
    .where(eq(workspace.id, workspaceId));

  if (!ws) notFound();

  return <GeneralSettingsForm workspace={ws} />;
}
