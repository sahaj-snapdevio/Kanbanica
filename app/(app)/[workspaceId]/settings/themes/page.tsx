import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ThemeSettingsForm } from "@/components/workspace/theme-settings-form";
import { workspace } from "@/db/schema";
import { db } from "@/lib/db";

interface ThemesPageProps {
  params: Promise<{ workspaceId: string }>;
}

export const metadata = { title: "Themes Settings — Kanbanica" };

export default async function ThemesSettingsPage({ params }: ThemesPageProps) {
  const { workspaceId } = await params;

  const [ws] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.id, workspaceId));

  if (!ws) {
    notFound();
  }

  return <ThemeSettingsForm />;
}
