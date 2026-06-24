"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { TaskDetailPanel } from "@/components/task/task-detail-panel";

interface TaskDeepLinkProps {
  listId: string;
  spaceId: string;
  taskId: string;
  workspaceId: string;
}

export function TaskDeepLink({
  workspaceId,
  spaceId,
  listId,
  taskId,
}: TaskDeepLinkProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(true);

  function handleClose(val: boolean) {
    setOpen(val);
    if (!val) {
      router.push(`/${workspaceId}/${spaceId}/list/${listId}`);
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-8 text-muted-foreground text-sm">
      <p>Opening task…</p>
      <TaskDetailPanel
        listId={listId}
        onOpenChange={handleClose}
        open={open}
        spaceId={spaceId}
        taskId={taskId}
        workspaceId={workspaceId}
      />
    </div>
  );
}
