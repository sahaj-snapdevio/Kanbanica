"use client";

import * as React from "react";
import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArchiveIcon,
  CaretRightIcon,
  CopyIcon,
  DotsThreeIcon,
  GearIcon,
  PencilSimpleIcon,
  RowsIcon,
  SquaresFourIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { archiveList, duplicateList } from "@/app/actions/list";
import { getArchivedTasksForList } from "@/app/actions/task";
import { EditListDialog } from "@/components/list/edit-list-dialog";
import { DeleteListDialog } from "@/components/list/delete-list-dialog";
import { StatusSettingsPanel } from "@/components/list/status-settings-panel";
import { CreateTaskModal } from "@/components/task/create-task-modal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ListView } from "./list-view";
import { BoardView } from "./board-view";
import { BoardSkeleton } from "./board-skeleton";

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
  statusId: string | null;
  seqNumber: number;
  orderIndex: number;
  dueDateStart: Date | null;
  dueDateEnd: Date | null;
  tags: { id: string; name: string; color: string }[];
  assignees: { userId: string; name: string; image: string | null }[];
}

interface ListContainerProps {
  workspaceId: string;
  space: { id: string; name: string; color: string | null };
  list: { id: string; name: string; color: string | null; description: string | null };
  statuses: Status[];
  tasks: Task[];
  members: { userId: string; name: string | null; email: string | null }[];
  tags: { id: string; name: string; color: string }[];
  canManage: boolean;
  canEdit: boolean;
  isAdmin: boolean;
}

const VIEWS: { key: View; label: string; icon: React.ReactNode }[] = [
  { key: "list",  label: "List",  icon: <RowsIcon className="size-3.5" /> },
  { key: "board", label: "Board", icon: <SquaresFourIcon className="size-3.5" /> },
];

export function ListContainer({
  workspaceId,
  space,
  list,
  statuses,
  tasks,
  members,
  tags,
  canManage,
  canEdit,
  isAdmin,
}: ListContainerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [view, setView] = useState<View>((searchParams.get("view") as View) ?? "list");
  const [pendingView, setPendingView] = useState<View | null>(null);
  const [isViewPending, startViewTransition] = useTransition();

  // Defer the heavy Board mount so the tab click stays responsive. `pendingView`
  // is set urgently (so a shaped skeleton paints immediately), while the actual
  // view swap runs inside the transition and replaces the skeleton when ready.
  function switchView(next: View) {
    if (next === view) return;
    setPendingView(next);
    startViewTransition(() => {
      setView(next);
      setPendingView(null);
    });
  }

  const showBoardSkeleton = isViewPending && pendingView === "board";
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [showArchived, setShowArchived] = React.useState(false);
  const [archivedTasks, setArchivedTasks] = React.useState<{ id: string; title: string; seqNumber: number }[]>([]);
  const [archivedLoading, setArchivedLoading] = React.useState(false);

  async function handleToggleArchived() {
    if (!showArchived && archivedTasks.length === 0) {
      setArchivedLoading(true);
      const result = await getArchivedTasksForList(workspaceId, space.id, list.id);
      if (!("error" in result)) setArchivedTasks(result.tasks);
      setArchivedLoading(false);
    }
    setShowArchived(v => !v);
  }

  return (
    <div className="space-y-5 p-6">
      <CreateTaskModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={workspaceId}
        spaceId={space.id}
        listId={list.id}
        statuses={statuses}
      />
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

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm">
        <span className="flex items-center gap-1.5 font-medium">
          {space.color && (
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: space.color }} />
          )}
          {space.name}
        </span>
        <CaretRightIcon className="size-3.5 text-muted-foreground" />
        <h1 className="flex-1 font-semibold">{list.name}</h1>

        {(canManage || isAdmin) && (
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex size-7 items-center justify-center rounded-md hover:bg-accent transition-colors">
                <DotsThreeIcon className="size-4.5 text-foreground/70" weight="bold" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-1">
              {canManage && (
                <>
                  <button onClick={() => setEditOpen(true)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-accent">
                    <PencilSimpleIcon className="size-3.5 shrink-0 text-muted-foreground" /> Edit List
                  </button>
                  <button onClick={() => setStatusOpen(true)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-accent">
                    <GearIcon className="size-3.5 shrink-0 text-muted-foreground" /> Manage Statuses
                  </button>
                  <button onClick={async () => { await duplicateList(workspaceId, space.id, list.id); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-accent">
                    <CopyIcon className="size-3.5 shrink-0 text-muted-foreground" /> Duplicate
                  </button>
                  <div className="my-1 h-px bg-border" />
                  <button onClick={async () => { const res = await archiveList(workspaceId, space.id, list.id); if (!("error" in res)) router.push(`/${workspaceId}`); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                    <ArchiveIcon className="size-3.5 shrink-0" /> Archive List
                  </button>
                </>
              )}
              {isAdmin && (
                <button onClick={() => setDeleteOpen(true)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10">
                  <TrashIcon className="size-3.5 shrink-0" /> Delete List
                </button>
              )}
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* View tabs */}
      <div className="flex items-center gap-1 border-b">
        {VIEWS.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => switchView(key)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              view === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {/* Active view — while switching into Board, show a board-shaped skeleton
          and suppress the outgoing view so they don't overlap. */}
      {showBoardSkeleton && <BoardSkeleton columns={statuses.length || 4} />}
      {!showBoardSkeleton && view === "list" && (
        <ListView
          workspaceId={workspaceId}
          spaceId={space.id}
          listId={list.id}
          statuses={statuses}
          tasks={tasks}
          isAdmin={isAdmin}
          canEdit={canEdit}
          members={members}
          tags={tags}
          archivedTasks={showArchived ? archivedTasks : []}
          onArchivedChanged={async () => {
            const result = await getArchivedTasksForList(workspaceId, space.id, list.id);
            if (!("error" in result)) setArchivedTasks(result.tasks);
          }}
        />
      )}
      {!showBoardSkeleton && view === "board" && (
        <BoardView
          workspaceId={workspaceId}
          space={space}
          list={list}
          statuses={statuses}
          tasks={tasks}
          headerless
          canEdit={canEdit}
          isAdmin={isAdmin}
          members={members}
          tags={tags}
        />
      )}
    </div>
  );
}
