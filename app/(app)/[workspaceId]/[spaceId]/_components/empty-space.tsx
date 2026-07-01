"use client";

import * as React from "react";
import { PlusIcon, StackIcon } from "@phosphor-icons/react";
import { CreateListModal } from "@/components/list/create-list-modal";
import { Button } from "@/components/ui/button";
import { useSetTopbar } from "@/lib/topbar-context";

interface EmptySpaceProps {
  workspaceId: string;
  space: { id: string; name: string; color: string | null };
  canManage: boolean;
}

export function EmptySpace({ workspaceId, space, canManage }: EmptySpaceProps) {
  const [createOpen, setCreateOpen] = React.useState(false);

  useSetTopbar({
    breadcrumbs: [{ label: space.name, color: space.color }],
    title: "Lists",
  });

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-xl bg-accent text-muted-foreground">
        <StackIcon className="size-7" />
      </div>
      <h2 className="mt-5 text-lg font-semibold text-foreground">This Space has no Lists yet</h2>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        Lists are where tasks live — create one to get started.
      </p>
      {canManage && (
        <Button className="mt-6 rounded-md" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="size-4" weight="bold" /> Create a List
        </Button>
      )}

      {createOpen && (
        <CreateListModal
          open={createOpen}
          onOpenChange={setCreateOpen}
          workspaceId={workspaceId}
          spaceId={space.id}
        />
      )}
    </div>
  );
}
