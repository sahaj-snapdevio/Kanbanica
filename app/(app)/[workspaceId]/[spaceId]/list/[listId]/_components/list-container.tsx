"use client";

import {
  ArchiveIcon,
  CopyIcon,
  DotsThreeIcon,
  GearIcon,
  PencilSimpleIcon,
  RowsIcon,
  SquaresFourIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { useState, useTransition } from "react";
import { archiveList, duplicateList } from "@/app/actions/list";
import { getArchivedTasksForList } from "@/app/actions/task";
import { DeleteListDialog } from "@/components/list/delete-list-dialog";
import { EditListDialog } from "@/components/list/edit-list-dialog";
import { StatusSettingsPanel } from "@/components/list/status-settings-panel";
import { CreateTaskModal } from "@/components/task/create-task-modal";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSetTopbar } from "@/lib/topbar-context";
import { cn } from "@/lib/utils";
import { BoardSkeleton } from "./board-skeleton";
import { BoardView } from "./board-view";
import { ListView } from "./list-view";

type View = "list" | "board";

interface Status {
  color: string;
  id: string;
  name: string;
  orderIndex: number;
  type: "OPEN" | "ACTIVE" | "CLOSED";
}

interface Task {
  assignees: { userId: string; name: string; image: string | null }[];
  dueDateEnd: Date | null;
  dueDateStart: Date | null;
  id: string;
  isPinnedToList: boolean;
  orderIndex: number;
  pinnedToListOrder: number | null;
  priority: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  seqNumber: number;
  statusId: string | null;
  tags: { id: string; name: string; color: string }[];
  title: string;
}

interface ListContainerProps {
  canEdit: boolean;
  canManage: boolean;
  canPinToList: boolean;
  currentUserId: string;
  isAdmin: boolean;
  list: {
    id: string;
    name: string;
    color: string | null;
    description: string | null;
  };
  members: { userId: string; name: string | null; email: string | null }[];
  personallyPinnedIds: Set<string>;
  pinnedTasks: Task[];
  space: { id: string; name: string; color: string | null };
  statuses: Status[];
  tags: { id: string; name: string; color: string }[];
  tasks: Task[];
  workspaceId: string;
}

const VIEWS: { key: View; label: string; icon: React.ReactNode }[] = [
  { key: "list", label: "List", icon: <RowsIcon className="size-3.5" /> },
  {
    key: "board",
    label: "Board",
    icon: <SquaresFourIcon className="size-3.5" />,
  },
];

export function ListContainer({
  workspaceId,
  space,
  list,
  statuses,
  tasks,
  pinnedTasks,
  members,
  tags,
  canManage,
  canEdit,
  isAdmin,
  canPinToList,
  currentUserId,
  personallyPinnedIds,
}: ListContainerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [view, setView] = useState<View>(
    (searchParams.get("view") as View) ?? "list"
  );

  useSetTopbar({
    breadcrumbs: [{ label: space.name, color: space.color }],
    title: list.name,
    actions:
      canManage || isAdmin ? (
        <Popover>
          <PopoverTrigger asChild>
            <button className="flex size-7 items-center justify-center rounded-md hover:bg-accent transition-colors">
              <DotsThreeIcon
                className="size-4.5 text-foreground/70"
                weight="bold"
              />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-48 p-1">
            {canManage && (
              <>
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                  onClick={() => setEditOpen(true)}
                >
                  <PencilSimpleIcon className="size-3.5 shrink-0 text-muted-foreground" />{" "}
                  Edit List
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                  onClick={() => setStatusOpen(true)}
                >
                  <GearIcon className="size-3.5 shrink-0 text-muted-foreground" />{" "}
                  Manage Statuses
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                  onClick={async () => {
                    await duplicateList(workspaceId, space.id, list.id);
                  }}
                >
                  <CopyIcon className="size-3.5 shrink-0 text-muted-foreground" />{" "}
                  Duplicate
                </button>
                <div className="my-1 h-px bg-border" />
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={async () => {
                    const res = await archiveList(
                      workspaceId,
                      space.id,
                      list.id
                    );
                    if (!("error" in res)) {
                      router.push(`/${workspaceId}`);
                    }
                  }}
                >
                  <ArchiveIcon className="size-3.5 shrink-0" /> Archive List
                </button>
              </>
            )}
            {isAdmin && (
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
                onClick={() => setDeleteOpen(true)}
              >
                <TrashIcon className="size-3.5 shrink-0" /> Delete List
              </button>
            )}
          </PopoverContent>
        </Popover>
      ) : undefined,
  });
  const [pendingView, setPendingView] = useState<View | null>(null);
  const [isViewPending, startViewTransition] = useTransition();

  // Defer the heavy Board mount so the tab click stays responsive. `pendingView`
  // is set urgently (so a shaped skeleton paints immediately), while the actual
  // view swap runs inside the transition and replaces the skeleton when ready.
  function switchView(next: View) {
    if (next === view) {
      return;
    }
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
  const [archivedTasks, setArchivedTasks] = React.useState<
    { id: string; title: string; seqNumber: number }[]
  >([]);
  const [archivedLoading, setArchivedLoading] = React.useState(false);

  async function handleToggleArchived() {
    if (!showArchived && archivedTasks.length === 0) {
      setArchivedLoading(true);
      const result = await getArchivedTasksForList(
        workspaceId,
        space.id,
        list.id
      );
      if (!("error" in result)) {
        setArchivedTasks(result.tasks);
      }
      setArchivedLoading(false);
    }
    setShowArchived((v) => !v);
  }

  return (
    <div className="space-y-5 p-6">
      <CreateTaskModal
        listId={list.id}
        onOpenChange={setCreateOpen}
        open={createOpen}
        spaceId={space.id}
        statuses={statuses}
        workspaceId={workspaceId}
      />
      {canManage && (
        <>
          <EditListDialog
            list={list}
            onOpenChange={setEditOpen}
            open={editOpen}
            spaceId={space.id}
            workspaceId={workspaceId}
          />
          <StatusSettingsPanel
            listId={list.id}
            onOpenChange={setStatusOpen}
            open={statusOpen}
            spaceId={space.id}
            statuses={statuses}
            workspaceId={workspaceId}
          />
        </>
      )}
      {isAdmin && (
        <DeleteListDialog
          list={list}
          onOpenChange={setDeleteOpen}
          open={deleteOpen}
          spaceId={space.id}
          workspaceId={workspaceId}
        />
      )}

      {/* View tabs */}
      <div className="flex items-center gap-1 border-b">
        {VIEWS.map(({ key, label, icon }) => (
          <button
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              view === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            key={key}
            onClick={() => switchView(key)}
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
          archivedTasks={showArchived ? archivedTasks : []}
          canEdit={canEdit}
          canPinToList={canPinToList}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          listId={list.id}
          members={members}
          onArchivedChanged={async () => {
            const result = await getArchivedTasksForList(
              workspaceId,
              space.id,
              list.id
            );
            if (!("error" in result)) {
              setArchivedTasks(result.tasks);
            }
          }}
          personallyPinnedIds={personallyPinnedIds}
          pinnedTasks={pinnedTasks}
          spaceId={space.id}
          statuses={statuses}
          tags={tags}
          tasks={tasks}
          workspaceId={workspaceId}
        />
      )}
      {!showBoardSkeleton && view === "board" && (
        <BoardView
          canEdit={canEdit}
          headerless
          isAdmin={isAdmin}
          list={list}
          members={members}
          space={space}
          statuses={statuses}
          tags={tags}
          tasks={tasks}
          workspaceId={workspaceId}
        />
      )}
    </div>
  );
}
