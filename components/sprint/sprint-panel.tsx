"use client";

import {
  CalendarBlankIcon,
  CaretDownIcon,
  CaretRightIcon,
  LightningIcon,
  PlusIcon,
  TargetIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  addTaskToSprint,
  deleteSprint,
  getBacklogTasks,
  getSprints,
  getSprintWithTasks,
  startSprint,
} from "@/app/actions/sprint";
import { createTask } from "@/app/actions/task";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { AddTasksToSprintModal } from "./add-tasks-to-sprint-modal";
import { CloseSprintModal } from "./close-sprint-modal";
import { CreateSprintModal } from "./create-sprint-modal";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SprintRow {
  createdAt: Date;
  endDate: Date | null;
  goal: string | null;
  id: string;
  name: string;
  startDate: Date | null;
  status: "PLANNED" | "ACTIVE" | "CLOSED";
}

interface SprintProgress {
  closed: number;
  total: number;
}

interface SprintPanelProps {
  listId?: string;
  onDataChanged?: () => void;
  spaceId: string;
  workspaceId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(date: Date | null): string {
  if (!date) {
    return "—";
  }
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function getDaysRemaining(endDate: Date | null): number | null {
  if (!endDate) {
    return null;
  }
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  return Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// ─── Inline create task input ─────────────────────────────────────────────────

function QuickCreateSprintTask({
  workspaceId,
  spaceId,
  sprintId,
  onCreated,
}: {
  workspaceId: string;
  spaceId: string;
  sprintId: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function show() {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function cancel() {
    setOpen(false);
    setTitle("");
  }

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) {
      cancel();
      return;
    }
    setSaving(true);
    try {
      const res = await createTask(workspaceId, spaceId, null, {
        title: trimmed,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      const sprintRes = await addTaskToSprint(
        workspaceId,
        spaceId,
        sprintId,
        res.taskId
      );
      if ("error" in sprintRes) {
        toast.error(sprintRes.error);
        return;
      }
      setTitle("");
      onCreated();
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch {
      toast.error("Something went wrong creating the task.");
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
    if (e.key === "Escape") {
      cancel();
    }
  }

  if (!open) {
    return (
      <button
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
        onClick={show}
      >
        <PlusIcon className="size-3.5 shrink-0" />
        Create task
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-background px-2 py-1.5 ring-1 ring-primary/20">
      <input
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 disabled:opacity-50"
        disabled={saving}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Task title…"
        ref={inputRef}
        type="text"
        value={title}
      />
      <div className="flex items-center gap-1 shrink-0">
        <button
          className="rounded px-2 py-0.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
          disabled={saving || !title.trim()}
          onClick={() => void submit()}
        >
          {saving ? "…" : "Add"}
        </button>
        <button
          className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          disabled={saving}
          onClick={cancel}
        >
          Esc
        </button>
      </div>
    </div>
  );
}

// ─── Active Sprint Card ───────────────────────────────────────────────────────

function ActiveSprintCard({
  sprint,
  progress,
  workspaceId,
  spaceId,
  listId,
  onClose,
  onAddTasks,
  onRefresh,
}: {
  sprint: SprintRow;
  progress: SprintProgress | null;
  workspaceId: string;
  spaceId: string;
  listId: string;
  onClose: () => void;
  onAddTasks: () => void;
  onRefresh: () => void;
}) {
  const daysRemaining = getDaysRemaining(sprint.endDate);
  const isOverdue = daysRemaining !== null && daysRemaining < 0;
  const percent =
    progress && progress.total > 0
      ? Math.round((progress.closed / progress.total) * 100)
      : 0;

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <LightningIcon
            className="size-4 text-primary shrink-0 mt-0.5"
            weight="fill"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{sprint.name}</p>
            {sprint.goal && (
              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                {sprint.goal}
              </p>
            )}
          </div>
        </div>
        <Badge
          className="shrink-0 border-primary/30 text-primary bg-primary/10 text-xs px-2 py-1 rounded"
          variant="outline"
        >
          Active
        </Badge>
      </div>

      {progress && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {progress.closed}/{progress.total} tasks
            </span>
            <span className="font-medium">{percent}%</span>
          </div>
          <Progress className="h-1.5" value={percent} />
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs">
          <CalendarBlankIcon className="size-3 text-muted-foreground" />
          {daysRemaining === null ? null : isOverdue ? (
            <span className="text-destructive font-medium">
              Overdue by {Math.abs(daysRemaining)}{" "}
              {Math.abs(daysRemaining) === 1 ? "day" : "days"}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {daysRemaining === 0
                ? "Ends today"
                : `${daysRemaining} ${daysRemaining === 1 ? "day" : "days"} left`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {listId && (
            <Button
              className="h-7 text-xs"
              onClick={onAddTasks}
              size="sm"
              variant="ghost"
            >
              <PlusIcon className="size-3 mr-1" />
              Add tasks
            </Button>
          )}
          <Button
            className="h-7 text-xs"
            onClick={onClose}
            size="sm"
            variant="outline"
          >
            Close Sprint
          </Button>
        </div>
      </div>

      {/* Inline create task */}
      <QuickCreateSprintTask
        onCreated={onRefresh}
        spaceId={spaceId}
        sprintId={sprint.id}
        workspaceId={workspaceId}
      />
    </div>
  );
}

// ─── Planned Sprint Row ───────────────────────────────────────────────────────

function PlannedSprintRow({
  sprint,
  hasActiveSprint,
  workspaceId,
  spaceId,
  listId,
  onStart,
  onDelete,
  onAddTasks,
  onRefresh,
}: {
  sprint: SprintRow;
  hasActiveSprint: boolean;
  workspaceId: string;
  spaceId: string;
  listId: string;
  onStart: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAddTasks: (id: string) => void;
  onRefresh: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleConfirmDelete() {
    setDeleting(true);
    try {
      await onDelete(sprint.id);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="rounded-md border bg-card group">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{sprint.name}</p>
            <p className="text-xs text-muted-foreground">
              {sprint.startDate
                ? `Starts ${formatDate(sprint.startDate)}`
                : "No start date"}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100 px-1"
              onClick={() => setExpanded((v) => !v)}
            >
              <PlusIcon className="size-3" />
              New task
            </button>
            {listId && (
              <button
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100 px-1"
                onClick={() => onAddTasks(sprint.id)}
              >
                Add tasks
              </button>
            )}
            {!hasActiveSprint && (
              <Button
                className="h-7 text-xs"
                disabled={starting || deleting}
                onClick={async () => {
                  setStarting(true);
                  try {
                    await onStart(sprint.id);
                  } finally {
                    setStarting(false);
                  }
                }}
                size="sm"
                variant="outline"
              >
                {starting ? "Starting…" : "Start Sprint"}
              </Button>
            )}
            <button
              aria-label="Delete sprint"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 transition-all hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
              disabled={deleting || starting}
              onClick={() => setConfirmDelete(true)}
            >
              <TrashIcon className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Inline create task — shown when "New task" is clicked */}
        {expanded && (
          <div className="px-3 pb-3">
            <QuickCreateSprintTask
              onCreated={() => {
                onRefresh();
              }}
              spaceId={spaceId}
              sprintId={sprint.id}
              workspaceId={workspaceId}
            />
          </div>
        )}
      </div>

      <AlertDialog onOpenChange={setConfirmDelete} open={confirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete sprint?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{sprint.name}</strong> will be permanently deleted. Tasks
              in this sprint will not be deleted — they will return to the
              backlog.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={() => void handleConfirmDelete()}
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function SprintPanel({
  workspaceId,
  spaceId,
  listId,
  onDataChanged,
}: SprintPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [sprints, setSprints] = useState<SprintRow[]>([]);
  const [progressMap, setProgressMap] = useState<
    Record<string, SprintProgress>
  >({});
  const [backlogCount, setBacklogCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [closeTarget, setCloseTarget] = useState<SprintRow | null>(null);
  const [addTasksTarget, setAddTasksTarget] = useState<SprintRow | null>(null);

  const activeSprints = sprints.filter((s) => s.status === "ACTIVE");
  const plannedSprints = sprints.filter((s) => s.status === "PLANNED");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sprintsResult = await getSprints(workspaceId, spaceId);
      const backlogResult = await getBacklogTasks(workspaceId, spaceId);

      if ("error" in sprintsResult) {
        throw new Error(sprintsResult.error);
      }
      if ("error" in backlogResult) {
        throw new Error(backlogResult.error);
      }

      const rows = sprintsResult.sprints ?? [];
      setSprints(rows);
      setBacklogCount(
        backlogResult.lists.reduce((sum, l) => sum + l.tasks.length, 0)
      );

      const activeRows = rows.filter((s) => s.status === "ACTIVE");
      if (activeRows.length > 0) {
        const progressResults = await Promise.all(
          activeRows.map((s) => getSprintWithTasks(workspaceId, spaceId, s.id))
        );
        const map: Record<string, SprintProgress> = {};
        for (let i = 0; i < activeRows.length; i++) {
          const res = progressResults[i];
          if ("tasks" in res) {
            const closed = res.tasks.filter(
              (t) => t.statusType === "CLOSED"
            ).length;
            map[activeRows[i].id] = { total: res.tasks.length, closed };
          }
        }
        setProgressMap(map);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sprints.");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, spaceId, listId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function refresh() {
    void fetchData();
    onDataChanged?.();
  }

  async function handleStartSprint(sprintId: string) {
    const result = await startSprint(workspaceId, spaceId, sprintId);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    refresh();
  }

  async function handleDeleteSprint(sprintId: string) {
    const result = await deleteSprint(workspaceId, spaceId, sprintId);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    refresh();
  }

  return (
    <>
      <CreateSprintModal
        onCreated={() => {
          setCreateOpen(false);
          refresh();
        }}
        onOpenChange={setCreateOpen}
        open={createOpen}
        spaceId={spaceId}
        workspaceId={workspaceId}
      />
      {addTasksTarget && listId && (
        <AddTasksToSprintModal
          listId={listId}
          onAdded={() => {
            setAddTasksTarget(null);
            refresh();
          }}
          onOpenChange={(open) => {
            if (!open) {
              setAddTasksTarget(null);
            }
          }}
          open={true}
          spaceId={spaceId}
          sprintId={addTasksTarget.id}
          sprintName={addTasksTarget.name}
          workspaceId={workspaceId}
        />
      )}
      {closeTarget && (
        <CloseSprintModal
          listId={listId ?? ""}
          onClosed={() => {
            setCloseTarget(null);
            refresh();
          }}
          onOpenChange={(open) => {
            if (!open) {
              setCloseTarget(null);
            }
          }}
          open={true}
          spaceId={spaceId}
          sprintId={closeTarget.id}
          sprintName={closeTarget.name}
          workspaceId={workspaceId}
        />
      )}

      <div className="rounded-lg border bg-card">
        <button
          className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-accent/50 transition-colors rounded-lg"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <CaretDownIcon className="size-3.5 text-muted-foreground" />
          ) : (
            <CaretRightIcon className="size-3.5 text-muted-foreground" />
          )}
          <TargetIcon className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium flex-1">Sprints</span>
          {activeSprints.length > 0 && (
            <Badge
              className="shrink-0 border-primary/30 text-primary bg-primary/10 text-xs px-2 py-1 rounded"
              variant="outline"
            >
              {activeSprints.length} Active
            </Badge>
          )}
          {plannedSprints.length > 0 && (
            <Badge
              className="shrink-0 border-border text-muted-foreground bg-muted text-xs px-2 py-1 rounded"
              variant="outline"
            >
              {plannedSprints.length} Planned
            </Badge>
          )}
        </button>

        {expanded && (
          <div className="px-4 pb-4 space-y-3">
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}

            {loading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <div
                    className="h-12 rounded-md bg-muted animate-pulse"
                    key={i}
                  />
                ))}
              </div>
            ) : (
              <>
                {activeSprints.length > 0 && (
                  <div className="space-y-2">
                    {activeSprints.map((s) => (
                      <ActiveSprintCard
                        key={s.id}
                        listId={listId ?? ""}
                        onAddTasks={() => setAddTasksTarget(s)}
                        onClose={() => setCloseTarget(s)}
                        onRefresh={refresh}
                        progress={progressMap[s.id] ?? null}
                        spaceId={spaceId}
                        sprint={s}
                        workspaceId={workspaceId}
                      />
                    ))}
                  </div>
                )}

                {plannedSprints.length > 0 && (
                  <div className="space-y-1.5">
                    {activeSprints.length > 0 && (
                      <p className="text-xs font-medium text-muted-foreground px-1">
                        Planned
                      </p>
                    )}
                    {plannedSprints.map((s) => (
                      <PlannedSprintRow
                        hasActiveSprint={activeSprints.length > 0}
                        key={s.id}
                        listId={listId ?? ""}
                        onAddTasks={(id) =>
                          setAddTasksTarget(
                            sprints.find((sp) => sp.id === id) ?? null
                          )
                        }
                        onDelete={handleDeleteSprint}
                        onRefresh={refresh}
                        onStart={handleStartSprint}
                        spaceId={spaceId}
                        sprint={s}
                        workspaceId={workspaceId}
                      />
                    ))}
                  </div>
                )}

                {sprints.length === 0 && (
                  <div className="flex flex-col items-center gap-2 py-6 text-center">
                    <TargetIcon className="size-8 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">
                      No sprints yet
                    </p>
                    <p className="text-xs text-muted-foreground/70">
                      Create a sprint to start organizing work into iterations
                    </p>
                  </div>
                )}

                {sprints.length > 0 && <div className="h-px bg-border" />}

                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="font-medium">Backlog</span>
                    <Badge className="text-xs h-5 px-1.5" variant="secondary">
                      {backlogCount}
                    </Badge>
                  </div>
                  <button
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setCreateOpen(true)}
                  >
                    <PlusIcon className="size-3.5" />
                    Create Sprint
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
