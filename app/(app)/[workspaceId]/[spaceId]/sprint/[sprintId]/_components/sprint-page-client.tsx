"use client";

import { TrayIcon } from "@phosphor-icons/react";
import * as React from "react";
import { BacklogView } from "@/components/sprint/backlog-view";
import { SprintListView } from "@/components/sprint/sprint-list-view";
import { SprintPanel } from "@/components/sprint/sprint-panel";
import { Button } from "@/components/ui/button";
import { useSetTopbar } from "@/lib/topbar-context";

interface SprintPageClientProps {
  canEdit: boolean;
  isAdmin: boolean;
  members: { userId: string; name: string | null; email: string | null }[];
  spaceColor: string | null;
  spaceId: string;
  spaceName: string;
  sprintId: string;
  workspaceId: string;
}

export function SprintPageClient({
  workspaceId,
  spaceId,
  sprintId,
  spaceName,
  spaceColor,
  isAdmin,
  canEdit,
  members,
}: SprintPageClientProps) {
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [showBacklog, setShowBacklog] = React.useState(false);

  useSetTopbar({
    breadcrumbs: [{ label: spaceName, color: spaceColor }],
    title: "Sprints",
  });

  function handleDataChanged() {
    setRefreshKey((k) => k + 1);
  }

  return (
    <>
      <SprintPanel
        onDataChanged={handleDataChanged}
        spaceId={spaceId}
        workspaceId={workspaceId}
      />
      <SprintListView
        canEdit={canEdit}
        isAdmin={isAdmin}
        members={members}
        refreshKey={refreshKey}
        spaceId={spaceId}
        workspaceId={workspaceId}
      />

      {/* Backlog toggle */}
      <div className="pt-2">
        <Button
          className="gap-2 text-muted-foreground hover:text-foreground"
          onClick={() => setShowBacklog((v) => !v)}
          size="sm"
          variant="ghost"
        >
          <TrayIcon className="size-4" />
          {showBacklog ? "Hide Backlog" : "Show Backlog"}
        </Button>
      </div>

      {showBacklog && (
        <BacklogView
          refreshKey={refreshKey}
          spaceId={spaceId}
          sprintId={sprintId}
          workspaceId={workspaceId}
        />
      )}
    </>
  );
}
