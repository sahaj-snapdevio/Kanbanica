import { revalidatePath } from "next/cache";
import { broadcastDataChanged } from "@/lib/realtime/broadcast";

/**
 * The single "after a mutation" helper for the whole app.
 *
 * ARCHITECTURE RULE: every server mutation (server actions AND route handlers)
 * must call `refreshWorkspace(...)` after writing. New code must NEVER call
 * `broadcastDataChanged()` directly — routing everything through here keeps the
 * Next.js cache invalidation and the realtime broadcast in lockstep and gives us
 * exactly one place that fans out live updates.
 *
 * @param workspaceId  workspace whose members should be notified
 * @param paths        specific paths to revalidate. Defaults to the workspace
 *                     layout (`/${workspaceId}`, layout scope), which covers the
 *                     sidebar and every nested page. Pass concrete list/space
 *                     paths when a finer revalidation is wanted.
 */
export async function refreshWorkspace(
  workspaceId: string,
  paths?: string[],
): Promise<void> {
  if (paths && paths.length > 0) {
    for (const path of paths) revalidatePath(path);
  } else {
    revalidatePath(`/${workspaceId}`, "layout");
  }

  await broadcastDataChanged(workspaceId);
}
