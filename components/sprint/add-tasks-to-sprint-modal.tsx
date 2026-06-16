"use client";

import { useState, useEffect, useMemo } from "react";
import { MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getBacklogTasks, addTaskToSprint } from "@/app/actions/sprint";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BacklogTask {
  id: string;
  title: string;
  seqNumber: number;
  priority: string | null;
  statusId: string;
  orderIndex: number;
}

interface AddTasksToSprintModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  spaceId: string;
  listId: string;
  sprintId: string;
  sprintName: string;
  onAdded: () => void;
}

const PRIORITY_COLOR: Record<string, string> = {
  URGENT: "text-red-500",
  HIGH: "text-orange-500",
  MEDIUM: "text-yellow-500",
  LOW: "text-blue-500",
  NONE: "text-muted-foreground/30",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function AddTasksToSprintModal({
  open,
  onOpenChange,
  workspaceId,
  spaceId,
  listId,
  sprintId,
  sprintName,
  onAdded,
}: AddTasksToSprintModalProps) {
  const [tasks, setTasks] = useState<BacklogTask[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setSearch("");
    setError(null);
    void loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function loadTasks() {
    setLoading(true);
    try {
      const result = await getBacklogTasks(workspaceId, spaceId, listId);
      if ("error" in result) { setError(result.error); return; }
      setTasks(result.tasks);
    } catch {
      setError("Failed to load backlog tasks.");
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        String(t.seqNumber).includes(q),
    );
  }, [tasks, search]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === filtered.length && filtered.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((t) => t.id)));
    }
  }

  async function handleAdd() {
    if (selected.size === 0) return;
    setAdding(true);
    setError(null);
    try {
      const ids = Array.from(selected);
      const results = await Promise.all(
        ids.map((taskId) =>
          addTaskToSprint(workspaceId, spaceId, listId, sprintId, taskId),
        ),
      );
      const failed = results.filter((r) => "error" in r);
      if (failed.length > 0) {
        setError(`${failed.length} task(s) could not be added.`);
      }
      onAdded();
      onOpenChange(false);
    } catch {
      setError("Failed to add tasks. Please try again.");
    } finally {
      setAdding(false);
    }
  }

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((t) => selected.has(t.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-base">
            Add tasks to{" "}
            <span className="text-muted-foreground font-normal">{sprintName}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* Search */}
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search backlog tasks…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
              autoFocus
            />
          </div>

          {/* Task list */}
          <div className="rounded-md border overflow-hidden">
            {loading ? (
              <div className="space-y-px p-1">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-10 rounded bg-muted animate-pulse" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-1 py-10 text-center">
                <p className="text-sm text-muted-foreground">
                  {tasks.length === 0
                    ? "All tasks are already in a sprint"
                    : "No tasks match your search"}
                </p>
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                {/* Select all header */}
                <button
                  onClick={toggleAll}
                  className="flex w-full items-center gap-3 border-b bg-muted/30 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                >
                  <input
                    type="checkbox"
                    readOnly
                    checked={allFilteredSelected}
                    className="rounded"
                  />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {allFilteredSelected ? "Deselect all" : "Select all"} ({filtered.length})
                  </span>
                </button>

                {filtered.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => toggle(task.id)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/50 transition-colors border-b last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      readOnly
                      checked={selected.has(task.id)}
                      className="rounded shrink-0"
                    />
                    <span className="font-mono text-xs text-muted-foreground/60 shrink-0 w-8">
                      #{task.seqNumber}
                    </span>
                    <span className="flex-1 text-sm truncate">{task.title}</span>
                    {task.priority && task.priority !== "NONE" && (
                      <span className={`text-xs font-medium shrink-0 ${PRIORITY_COLOR[task.priority] ?? ""}`}>
                        {task.priority}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={adding}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={adding || selected.size === 0}>
            <PlusIcon className="size-3.5 mr-1.5" />
            {adding
              ? "Adding…"
              : `Add ${selected.size > 0 ? selected.size : ""} task${selected.size === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
