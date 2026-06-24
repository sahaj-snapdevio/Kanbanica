import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { list } from "@/db/schema";
import { getSpacePermission } from "@/lib/permissions";
import { ListSettingsNav } from "@/components/list/list-settings-nav";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";

interface ListSettingsLayoutProps {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string; spaceId: string; listId: string }>;
}

export default async function ListSettingsLayout({ children, params }: ListSettingsLayoutProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { workspaceId, spaceId, listId } = await params;

  const permission = await getSpacePermission(session.user.id, workspaceId, spaceId);
  if (!permission || (permission !== "full_access")) redirect(`/${workspaceId}/${spaceId}/list/${listId}`);

  const [l] = await db
    .select({ name: list.name })
    .from(list)
    .where(and(eq(list.id, listId), eq(list.spaceId, spaceId)));
  if (!l) notFound();

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="mb-6">
        <Link
          href={`/${workspaceId}/${spaceId}/list/${listId}`}
          className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon className="size-3.5" />
          Back to list
        </Link>
        <h1 className="text-xl font-semibold">{l.name} — Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage this List</p>
      </div>
      <ListSettingsNav workspaceId={workspaceId} spaceId={spaceId} listId={listId} />
      {children}
    </div>
  );
}
