"use client";

import * as React from "react";
import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArchiveIcon,
  CaretRightIcon,
  CopyIcon,
  DotsThreeIcon,
  GearIcon,
  LightningIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  RowsIcon,
  SquaresFourIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { archiveList, duplicateList } from "@/app/actions/list";
import { EditListDialog } from "@/components/list/edit-list-dialog";
import { DeleteListDialog } from "@/components/list/delete-list-dialog";
import { StatusSettingsPanel } from "@/components/list/status-settings-panel";
import { CreateTaskModal } from "@/components/task/create-task-modal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { SprintPanel } from "@/components/sprint/sprint-panel";
import { SprintListView } from "@/components/sprint/sprint-list-view";
import { ListFilterToolbar } from "@/components/list/list-filter-toolbar";
import { type FilterState } from "@/app/actions/search";
import { ListView } from "./list-view";
import { BoardView } from "./board-view";
import { BoardSkeleton } from "./board-skeleton";

type View = "list" | "board" | "sprint";

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
  isAdmin: boolean;
}

const VIEWS: { key: View; label: string; icon: React.ReactNode }[] = [
  { key: "list",   label: "List",   icon: <RowsIcon className="size-3.5" /> },
  { key: "board",  label: "Board",  icon: <SquaresFourIcon className="size-3.5" /> },
  { key: "sprint", label: "Sprint", icon: <LightningIcon className="size-3.5" weight="fill" /> },
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
  isAdmin,
}: ListContainerProps) {
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
  const [sprintVersion, setSprintVersion] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FilterState>({});

  const filteredTasks = tasks.filter((t) => {
    if (search.trim() && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (filters.status?.length && !filters.status.includes(t.statusId)) return false;
    if (filters.priority?.length && !filters.priority.includes(t.priority)) return false;
    if (filters.due) {
      const now = new Date();
      const due = t.dueDateEnd ? new Date(t.dueDateEnd) : null;
      if (filters.due === "overdue" && (!due || due >= now)) return false;
      if (filters.due === "today") {
        if (!due) return false;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
        if (due < today || due >= tomorrow) return false;
      }
      if (filters.due === "this_week") {
        if (!due) return false;
        const start = new Date(); start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - start.getDay());
        const end = new Date(start); end.setDate(end.getDate() + 7);
        if (due < start || due >= end) return false;
      }
      if (filters.due === "no_due_date" && due) return false;
    }
    if (filters.assignee?.length) {
      const hasUnassigned = filters.assignee.includes("unassigned");
      const userIds = filters.assignee.filter((a) => a !== "unassigned");
      const assigneeIds = t.assignees.map((a) => a.userId);
      const matchUnassigned = hasUnassigned && assigneeIds.length === 0;
      const matchUser = userIds.length > 0 && assigneeIds.some((id) => userIds.includes(id));
      if (!matchUnassigned && !matchUser) return false;
    }
    if (filters.tags?.length && !t.tags.some((tg) => filters.tags!.includes(tg.id))) return false;
    return true;
  });

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
                  <button onClick={async () => { await archiveList(workspaceId, space.id, list.id); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
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

      {/* Toolbar: view tabs + search + add task */}
      <div className="flex items-center gap-2">
        {/* View tabs */}
        <div className="flex items-center gap-1 border-b flex-1">
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

        {/* Search */}
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search tasks…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-48 rounded-md border bg-background pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all focus:w-64"
          />
        </div>

        {/* Add Task button */}
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 h-8 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
        >
          <PlusIcon className="size-3.5" weight="bold" />
          Task
        </button>
      </div>

      {/* Filter toolbar */}
      {view !== "sprint" && (
        <ListFilterToolbar
          listId={list.id}
          statuses={statuses}
          members={members}
          tags={tags}
          filters={filters}
          onChange={setFilters}
        />
      )}

      {/* Active view — while switching into Board, show a board-shaped skeleton
          and suppress the outgoing view so they don't overlap. */}
      {showBoardSkeleton && <BoardSkeleton columns={statuses.length || 4} />}
      {!showBoardSkeleton && view === "list" && (
        <ListView
          workspaceId={workspaceId}
          spaceId={space.id}
          listId={list.id}
          statuses={statuses}
          tasks={filteredTasks}
          isAdmin={isAdmin}
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
        />
      )}
      {!showBoardSkeleton && view === "sprint" && (
        <>
          <SprintPanel
            workspaceId={workspaceId}
            spaceId={space.id}
            listId={list.id}
            onDataChanged={() => setSprintVersion((v) => v + 1)}
          />
          <SprintListView
            key={sprintVersion}
            workspaceId={workspaceId}
            spaceId={space.id}
            listId={list.id}
            statuses={statuses}
            isAdmin={isAdmin}
          />
        </>
      )}
    </div>
  );
}
