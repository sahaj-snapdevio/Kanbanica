"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { TaskDetailPanel } from "@/components/task/task-detail-panel";

interface TaskDeepLinkProps {
  workspaceId: string;
  spaceId: string;
  listId: string;
  taskId: string;
}

export function TaskDeepLink({ workspaceId, spaceId, listId, taskId }: TaskDeepLinkProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(true);

  function handleClose(val: boolean) {
    setOpen(val);
    if (!val) router.push(`/${workspaceId}/${spaceId}/list/${listId}`);
  }

  return (
    <div className="flex h-full items-center justify-center p-8 text-muted-foreground text-sm">
      <p>Opening task…</p>
      <TaskDetailPanel
        open={open}
        onOpenChange={handleClose}
        taskId={taskId}
        workspaceId={workspaceId}
        spaceId={spaceId}
        listId={listId}
      />
    </div>
  );
}
