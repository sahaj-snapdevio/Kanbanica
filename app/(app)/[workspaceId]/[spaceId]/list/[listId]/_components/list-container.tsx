"use client";

import { useState } from "react";
import {
  ArchiveIcon,
  CaretRightIcon,
  CopyIcon,
  DotsThreeIcon,
  GearIcon,
  PencilSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { archiveList, duplicateList } from "@/app/actions/list";
import { EditListDialog } from "@/components/list/edit-list-dialog";
import { DeleteListDialog } from "@/components/list/delete-list-dialog";
import { StatusSettingsPanel } from "@/components/list/status-settings-panel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ListView } from "./list-view";
import { BoardView } from "./board-view";

type View = "list" | "board";

interface Status {
  id: string;
  name: string;
  color: string;
  type: "OPEN" | "ACTIVE" | "CLOSED";
  orderIndex: number;
}

interface Task {
  id: string;
  title: string;
  priority: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  statusId: string;
  seqNumber: number;
  orderIndex: number;
  tags: { id: string; name: string; color: string }[];
}

interface ListContainerProps {
  workspaceId: string;
  space: { id: string; name: string; color: string | null };
  list: { id: string; name: string; color: string | null; description: string | null };
  statuses: Status[];
  tasks: Task[];
  canManage: boolean;
  isAdmin: boolean;
}

const VIEWS: { key: View; label: string }[] = [
  { key: "list", label: "List" },
  { key: "board", label: "Board" },
];

export function ListContainer({
  workspaceId,
  space,
  list,
  statuses,
  tasks,
  canManage,
  isAdmin,
}: ListContainerProps) {
  const [view, setView] = useState<View>("list");
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  return (
    <div className="space-y-5 p-6">
      {canManage && (
        <>
          <EditListDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            workspaceId={workspaceId}
            spaceId={space.id}
            list={list}
          />
          <StatusSettingsPanel
            open={statusOpen}
            onOpenChange={setStatusOpen}
            workspaceId={workspaceId}
            spaceId={space.id}
            listId={list.id}
            statuses={statuses}
          />
        </>
      )}
      {isAdmin && (
        <DeleteListDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          workspaceId={workspaceId}
          spaceId={space.id}
          list={list}
        />
      )}

      {/* Breadcrumb + view tabs */}
      <div className="space-y-3">
        <div className="flex items-center gap-1.5 text-sm">
          <span className="flex items-center gap-1.5 font-medium">
            {space.color && (
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: space.color }}
              />
            )}
            {space.name}
          </span>
          <CaretRightIcon className="size-3.5 text-muted-foreground" />
          <h1 className="flex-1 font-semibold">{list.name}</h1>

          {(canManage || isAdmin) && (
            <Popover>
              <PopoverTrigger asChild>
                <button className="flex size-7 items-center justify-center rounded-md hover:bg-accent transition-colors">
                  <DotsThreeIcon className="size-4 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-48 p-1">
                {canManage && (
                  <>
                    <button
                      onClick={() => setEditOpen(true)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                    >
                      <PencilSimpleIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      Edit List
                    </button>
                    <button
                      onClick={() => setStatusOpen(true)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                    >
                      <GearIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      Manage Statuses
                    </button>
                    <button
                      onClick={async () => {
                        await duplicateList(workspaceId, space.id, list.id);
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                    >
                      <CopyIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      Duplicate
                    </button>
                    <div className="my-1 h-px bg-border" />
                    <button
                      onClick={async () => {
                        await archiveList(workspaceId, space.id, list.id);
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <ArchiveIcon className="size-3.5 shrink-0" />
                      Archive List
                    </button>
                  </>
                )}
                {isAdmin && (
                  <button
                    onClick={() => setDeleteOpen(true)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
                  >
                    <TrashIcon className="size-3.5 shrink-0" />
                    Delete List
                  </button>
                )}
              </PopoverContent>
            </Popover>
          )}
        </div>

        <div className="flex items-center gap-1 border-b">
          {VIEWS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={cn(
                "px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                view === key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Active view */}
      {view === "list" ? (
        <ListView
          workspaceId={workspaceId}
          spaceId={space.id}
          listId={list.id}
          statuses={statuses}
          tasks={tasks}
        />
      ) : (
        <BoardView
          workspaceId={workspaceId}
          space={space}
          list={list}
          statuses={statuses}
          tasks={tasks}
          headerless
        />
      )}
    </div>
  );
}
