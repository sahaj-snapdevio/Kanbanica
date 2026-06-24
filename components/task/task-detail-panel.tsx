"use client";

import {
  ArchiveIcon,
  ArrowRightIcon,
  CheckIcon,
  ClipboardTextIcon,
  CopyIcon,
  DotsThreeIcon,
  EyeIcon,
  EyeSlashIcon,
  GearIcon,
  LinkIcon,
  PlusIcon,
  TimerIcon,
  TrashIcon,
  UserIcon,
  XIcon,
} from "@phosphor-icons/react";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  archiveTask,
  deleteTask,
  duplicateTask,
  getTaskDetail,
  getWorkspaceMembers,
  logTime,
  updateTask,
  updateTaskStatus,
} from "@/app/actions/task";
import { addAssignee, removeAssignee, toggleWatcher } from "@/app/actions/task-assignee";
import { getWorkspaceTags, createTag, deleteTag, addTaskTag, removeTaskTag } from "@/app/actions/task-tag";
import {
  addAssignee,
  removeAssignee,
  toggleWatcher,
} from "@/app/actions/task-assignee";
import {
  addChecklistItem,
  createChecklist,
  deleteChecklist,
  deleteChecklistItem,
  toggleChecklistItem,
} from "@/app/actions/task-checklist";
import { addDependency, removeDependency, searchTasksForDependency } from "@/app/actions/task-dependency";
import { logTime } from "@/app/actions/task";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ClickUpCalendar } from "@/components/ui/clickup-calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { TaskActivityFeed } from "@/components/task/task-activity-feed";
import { ManageStatusesDialog } from "@/components/list/manage-statuses-dialog";
import { ClickUpCalendar } from "@/components/ui/clickup-calendar";

// ─── Types ────────────────────────────────────────────────────────────────────

type Priority = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";

interface TaskDetailPanelProps {
  inline?: boolean; // render content directly without Sheet overlay
  isAdmin?: boolean;
  listId: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  spaceId: string;
  taskId: string;
  workspaceId: string;
}

// ─── Priority config ──────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<
  Priority,
  { label: string; color: string; icon: string; bg: string }
> = {
  NONE: {
    label: "No Priority",
    color: "text-muted-foreground",
    icon: "😴",
    bg: "bg-muted/60",
  },
  LOW: {
    label: "Low",
    color: "text-blue-500",
    icon: "🐢",
    bg: "bg-blue-50 dark:bg-blue-950/40",
  },
  MEDIUM: {
    label: "Medium",
    color: "text-yellow-500",
    icon: "🚶",
    bg: "bg-yellow-50 dark:bg-yellow-950/40",
  },
  HIGH: {
    label: "High",
    color: "text-orange-500",
    icon: "🏃",
    bg: "bg-orange-50 dark:bg-orange-950/40",
  },
  URGENT: {
    label: "Urgent",
    color: "text-red-500",
    icon: "⚡",
    bg: "bg-red-50 dark:bg-red-950/40",
  },
};

// ─── Avatar helper ────────────────────────────────────────────────────────────

function userInitials(name: string | null, email: string | null) {
  if (name) {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return (email ?? "?").slice(0, 2).toUpperCase();
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export function TaskDetailPanel({
  open,
  onOpenChange,
  taskId,
  workspaceId,
  spaceId,
  listId,
  isAdmin,
  inline = false,
}: TaskDetailPanelProps) {
  const router = useRouter();
  const [data, setData] = React.useState<Awaited<
    ReturnType<typeof getTaskDetail>
  > | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [titleEditing, setTitleEditing] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState("");
  const [descDraft, setDescDraft] = React.useState("");
  const [descEditing, setDescEditing] = React.useState(false);
  const [members, setMembers] = React.useState<{ userId: string | null; name: string; email: string; image: string | null }[]>([]);
  const [allTags, setAllTags] = React.useState<{ id: string; name: string; color: string }[]>([]);
  const [deleteTagTarget, setDeleteTagTarget] = React.useState<{ id: string; name: string } | null>(null);
  const [newChecklistName, setNewChecklistName] = React.useState("");
  const [addingChecklist, setAddingChecklist] = React.useState(false);
  const [newItemTexts, setNewItemTexts] = React.useState<
    Record<string, string>
  >({});
  const [depQuery, setDepQuery] = React.useState("");
  const [depResults, setDepResults] = React.useState<
    { id: string; title: string; seqNumber: number }[]
  >([]);
  const [timeInput, setTimeInput] = React.useState("");
  const [timeNote, setTimeNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [startCalOpen, setStartCalOpen] = React.useState(false);
  const [endCalOpen, setEndCalOpen] = React.useState(false);
  const [manageStatusesOpen, setManageStatusesOpen] = React.useState(false);

  async function load() {
    setLoading(true);
    const [detail, mem, tags] = await Promise.all([
      getTaskDetail(workspaceId, spaceId, taskId),
      getWorkspaceMembers(workspaceId),
      getWorkspaceTags(workspaceId),
    ]);
    setData(detail && !("error" in detail) ? detail : null);
    if (mem && !("error" in mem)) {
      setMembers(
        mem.members.filter(
          (m): m is typeof m & { userId: string } => m.userId !== null
        )
      );
    }
    if (tags && !("error" in tags)) {
      setAllTags(tags.tags);
    }
    setLoading(false);
  }

  React.useEffect(() => {
    if (open && taskId) {
      load();
    }
  }, [open, taskId]);

  React.useEffect(() => {
    if (data && !("error" in data)) {
      setTitleDraft(data.task.title);
      setDescDraft(
        typeof data.task.description === "string"
          ? data.task.description
          : data.task.description
            ? JSON.stringify(data.task.description)
            : ""
      );
    }
  }, [data]);

  if (!open) {
    return null;
  }

  if (loading || !data || "error" in data) {
    const loadingContent = (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">
          {loading ? "Loading…" : "Task not found"}
        </p>
      </div>
    );
    if (inline) {
      return <div className="h-full overflow-y-auto">{loadingContent}</div>;
    }
    return (
      <Sheet onOpenChange={onOpenChange} open={open}>
        <SheetContent
          aria-describedby={undefined}
          className="w-full sm:max-w-2xl overflow-y-auto"
        >
          {loadingContent}
        </SheetContent>
      </Sheet>
    );
  }

  const {
    task: t,
    assignees,
    watchers,
    tags,
    checklists,
    dependencies,
    timeLogs,
    statuses,
    currentUserId,
  } = data;
  const isWatching = watchers.some((w) => w.userId === currentUserId);
  const currentStatus = statuses.find((s) => s.id === t.statusId);
  const priority =
    PRIORITY_CONFIG[t.priority as Priority] ?? PRIORITY_CONFIG.NONE;
  const totalChecked = checklists
    .flatMap((c) => c.items)
    .filter((i) => i.isChecked).length;
  const totalItems = checklists.flatMap((c) => c.items).length;
  const checkProgress =
    totalItems > 0 ? Math.round((totalChecked / totalItems) * 100) : 0;

  async function saveTitle() {
    if (!titleDraft.trim() || titleDraft === t.title) {
      setTitleEditing(false);
      return;
    }
    await updateTask(workspaceId, spaceId, listId, taskId, {
      title: titleDraft.trim(),
    });
    setTitleEditing(false);
    load();
  }

  async function saveDescription() {
    await updateTask(workspaceId, spaceId, listId, taskId, {
      description: descDraft,
    });
    setDescEditing(false);
    load();
  }

  async function handleStatusChange(statusId: string) {
    await updateTaskStatus(workspaceId, spaceId, listId, taskId, statusId);
    load();
  }

  async function handlePriorityChange(p: Priority) {
    await updateTask(workspaceId, spaceId, listId, taskId, { priority: p });
    load();
  }

  async function handleDueDateChange(
    field: "start" | "end",
    date: Date | null
  ) {
    if (field === "start") {
      await updateTask(workspaceId, spaceId, listId, taskId, {
        dueDateStart: date,
      });
    } else {
      await updateTask(workspaceId, spaceId, listId, taskId, {
        dueDateEnd: date,
      });
    }
    load();
  }

  async function handleToggleAssignee(userId: string) {
    const already = assignees.some((a) => a.userId === userId);
    if (already) {
      await removeAssignee(workspaceId, spaceId, listId, taskId, userId);
    } else {
      await addAssignee(workspaceId, spaceId, listId, taskId, userId);
    }
    load();
  }

  async function handleToggleTag(tagId: string) {
    const already = tags.some((tag) => tag.id === tagId);
    if (already) {
      await removeTaskTag(workspaceId, spaceId, listId, taskId, tagId);
    } else {
      await addTaskTag(workspaceId, spaceId, listId, taskId, tagId);
    }
    load();
  }

  async function handleCreateTag(name: string) {
    const res = await createTag(workspaceId, name);
    if ("tag" in res) {
      await addTaskTag(workspaceId, spaceId, listId, taskId, res.tag.id);
      load();
    }
  }

  async function handleDeleteTag() {
    if (!deleteTagTarget) return;
    await deleteTag(workspaceId, deleteTagTarget.id);
    setDeleteTagTarget(null);
    load();
  }

  async function handleToggleWatch() {
    await toggleWatcher(workspaceId, spaceId, listId, taskId);
    load();
  }

  async function handleAddChecklist() {
    if (!newChecklistName.trim()) {
      return;
    }
    await createChecklist(
      workspaceId,
      spaceId,
      listId,
      taskId,
      newChecklistName
    );
    setNewChecklistName("");
    setAddingChecklist(false);
    load();
  }

  async function handleToggleItem(itemId: string) {
    await toggleChecklistItem(workspaceId, spaceId, listId, itemId);
    load();
  }

  async function handleAddItem(checklistId: string) {
    const text = newItemTexts[checklistId] ?? "";
    if (!text.trim()) {
      return;
    }
    await addChecklistItem(workspaceId, spaceId, listId, checklistId, text);
    setNewItemTexts((prev) => ({ ...prev, [checklistId]: "" }));
    load();
  }

  async function handleDepSearch(q: string) {
    setDepQuery(q);
    if (q.length < 2) {
      setDepResults([]);
      return;
    }
    const res = await searchTasksForDependency(workspaceId, spaceId, q, taskId);
    if ("tasks" in res) {
      setDepResults(
        res.tasks?.map((t) => ({
          id: t.id,
          title: t.title,
          seqNumber: t.seqNumber,
        })) ?? []
      );
    }
  }

  async function handleAddDep(dependsOnTaskId: string) {
    await addDependency(workspaceId, spaceId, listId, taskId, dependsOnTaskId);
    setDepQuery("");
    setDepResults([]);
    load();
  }

  async function handleRemoveDep(depId: string) {
    await removeDependency(workspaceId, spaceId, listId, depId, taskId);
    load();
  }

  async function handleLogTime() {
    const mins = Number.parseInt(timeInput);
    if (!mins || mins <= 0) {
      return;
    }
    await logTime(
      workspaceId,
      spaceId,
      listId,
      taskId,
      mins,
      timeNote || undefined
    );
    setTimeInput("");
    setTimeNote("");
    load();
  }

  async function handleDuplicate() {
    setSaving(true);
    const res = await duplicateTask(workspaceId, spaceId, listId, taskId);
    setSaving(false);
    if ("taskId" in res) {
      onOpenChange(false);
      router.refresh();
    }
  }

  async function handleArchive() {
    await archiveTask(workspaceId, spaceId, listId, taskId);
    onOpenChange(false);
  }

  async function handleDelete() {
    if (!confirm("Permanently delete this task? This cannot be undone.")) {
      return;
    }
    await deleteTask(workspaceId, spaceId, listId, taskId);
    onOpenChange(false);
  }

  function copyLink() {
    navigator.clipboard.writeText(
      `${window.location.origin}/${workspaceId}/task/${taskId}`
    );
  }

  const dueDateStart = t.dueDateStart ? new Date(t.dueDateStart) : null;
  const dueDateEnd = t.dueDateEnd ? new Date(t.dueDateEnd) : null;

  const panelContent = (
    <>
      {/* Header */}
      <div className="flex items-start gap-2 border-b px-6 py-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <ClipboardTextIcon className="size-3.5" />
            <span className="font-mono">#{t.seqNumber}</span>
            <button
              className="flex items-center gap-1 hover:text-foreground"
              onClick={copyLink}
            >
              <LinkIcon className="size-3" />
              Copy link
            </button>
          </div>
          {titleEditing ? (
            <Input
              autoFocus
              className="text-base font-semibold h-auto py-1 border-none shadow-none focus-visible:ring-0 px-0"
              onBlur={saveTitle}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  saveTitle();
                }
                if (e.key === "Escape") {
                  setTitleEditing(false);
                }
              }}
              value={titleDraft}
            />
          ) : (
            <h2
              className="text-base font-semibold cursor-text hover:bg-accent rounded px-1 -mx-1 py-0.5"
              onClick={() => setTitleEditing(true)}
            >
              {t.title}
            </h2>
          )}
        </div>
        {/* Header actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
              isWatching
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
            onClick={handleToggleWatch}
          >
            {isWatching ? (
              <EyeSlashIcon className="size-3.5" />
            ) : (
              <EyeIcon className="size-3.5" />
            )}
            {isWatching ? "Unwatch" : "Watch"}
          </button>
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex size-8 items-center justify-center rounded-md hover:bg-accent">
                <DotsThreeIcon className="size-4.5" weight="bold" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 p-1">
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                disabled={saving}
                onClick={handleDuplicate}
              >
                <CopyIcon className="size-3.5 text-muted-foreground" />{" "}
                Duplicate
              </button>
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                onClick={handleArchive}
              >
                <ArchiveIcon className="size-3.5 text-muted-foreground" />{" "}
                Archive
              </button>
              <Separator className="my-1" />
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
                onClick={handleDelete}
              >
                <TrashIcon className="size-3.5" /> Delete
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

        {/* Body — two-column */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Main column */}
          <div className="flex-1 min-w-0 overflow-y-auto px-6 py-4 space-y-6">
            {/* Status + Priority row */}
            <div className="flex flex-wrap gap-2">
              <div className="flex items-center gap-1">
                <Select value={t.statusId ?? undefined} onValueChange={handleStatusChange}>
                  <SelectTrigger className="h-7 w-auto text-xs px-2 gap-1.5">
                    {currentStatus && (
                      <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: currentStatus.color }} />
                    )}
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["OPEN", "ACTIVE", "CLOSED"] as const).map((type) => {
                      const group = statuses.filter((s) => s.type === type);
                      if (group.length === 0) return null;
                      const label = type === "OPEN" ? "Not started" : type === "ACTIVE" ? "Active" : "Closed";
                      return (
                        <SelectGroup key={type}>
                          <SelectLabel className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground px-2 py-1">
                            {label}
                          </SelectLabel>
                          {group.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              <span className="flex items-center gap-1.5">
                                <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                                {s.name}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      );
                    })}
                  </SelectContent>
                </Select>
                {isAdmin && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                        <DotsThreeIcon className="size-3.5" weight="bold" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="right" align="start" className="w-36">
                      <DropdownMenuItem onClick={() => setManageStatusesOpen(true)}>
                        <GearIcon className="size-3.5" />
                        Edit statuses
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

            <Select
              onValueChange={(v) => handlePriorityChange(v as Priority)}
              value={t.priority}
            >
              <SelectTrigger
                className={cn(
                  "h-7 w-auto text-xs px-2 gap-1.5",
                  priority.color,
                  priority.bg
                )}
              >
                <span>{priority.icon}</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  Object.entries(PRIORITY_CONFIG) as [
                    Priority,
                    (typeof PRIORITY_CONFIG)[Priority],
                  ][]
                ).map(([key, cfg]) => (
                  <SelectItem key={key} value={key}>
                    <span
                      className={cn("flex items-center gap-1.5", cfg.color)}
                    >
                      <span>{cfg.icon}</span>
                      {cfg.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">
              Description
            </Label>
            {descEditing ? (
              <div className="space-y-2">
                <Textarea
                  autoFocus
                  className="text-sm resize-none"
                  onChange={(e) => setDescDraft(e.target.value)}
                  placeholder="Add a description…"
                  rows={6}
                  value={descDraft}
                />
                <div className="flex gap-2">
                  <Button onClick={saveDescription} size="sm">
                    Save
                  </Button>
                  <Button
                    onClick={() => setDescEditing(false)}
                    size="sm"
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div
                className="min-h-15 rounded-md border border-transparent hover:border-border hover:bg-accent/30 px-2 py-1.5 text-sm cursor-text transition-colors"
                onClick={() => setDescEditing(true)}
              >
                {descDraft ? (
                  <p className="whitespace-pre-wrap">{descDraft}</p>
                ) : (
                  <p className="text-muted-foreground">Add a description…</p>
                )}
              </div>
            )}
          </div>

          {/* Checklists */}
          {checklists.length > 0 && (
            <div className="space-y-4">
              {checklists.map((cl) => {
                const clChecked = cl.items.filter((i) => i.isChecked).length;
                const clTotal = cl.items.length;
                return (
                  <div key={cl.id}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{cl.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {clChecked}/{clTotal}
                      </span>
                    </div>
                    {clTotal > 0 && (
                      <Progress
                        className="h-1.5 mb-2"
                        value={clTotal > 0 ? (clChecked / clTotal) * 100 : 0}
                      />
                    )}
                    <div className="space-y-1">
                      {cl.items.map((item) => (
                        <div
                          className="flex items-center gap-2 group"
                          key={item.id}
                        >
                          <Checkbox
                            checked={item.isChecked}
                            className="shrink-0"
                            onCheckedChange={() => handleToggleItem(item.id)}
                          />
                          <span
                            className={cn(
                              "flex-1 text-sm",
                              item.isChecked &&
                                "line-through text-muted-foreground"
                            )}
                          >
                            {item.title}
                          </span>
                          <button
                            className="opacity-0 group-hover:opacity-100 flex size-5 items-center justify-center rounded hover:bg-destructive/10 text-destructive transition-opacity"
                            onClick={() =>
                              deleteChecklistItem(
                                workspaceId,
                                spaceId,
                                listId,
                                item.id
                              ).then(load)
                            }
                          >
                            <XIcon className="size-3" />
                          </button>
                        </div>
                      ))}
                      {/* Add item row */}
                      <div className="flex gap-1 mt-1">
                        <Input
                          className="h-7 text-xs"
                          onChange={(e) =>
                            setNewItemTexts((prev) => ({
                              ...prev,
                              [cl.id]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleAddItem(cl.id);
                            }
                          }}
                          placeholder="Add item…"
                          value={newItemTexts[cl.id] ?? ""}
                        />
                        <Button
                          className="h-7 px-2"
                          onClick={() => handleAddItem(cl.id)}
                          size="sm"
                        >
                          <PlusIcon className="size-3.5" />
                        </Button>
                        <button
                          className="flex size-7 items-center justify-center rounded hover:bg-destructive/10 text-destructive"
                          onClick={() =>
                            deleteChecklist(
                              workspaceId,
                              spaceId,
                              listId,
                              cl.id
                            ).then(load)
                          }
                          title="Delete checklist"
                        >
                          <TrashIcon className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add checklist */}
          {addingChecklist ? (
            <div className="flex gap-2">
              <Input
                autoFocus
                className="h-8 text-sm"
                onChange={(e) => setNewChecklistName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddChecklist();
                  }
                  if (e.key === "Escape") {
                    setAddingChecklist(false);
                  }
                }}
                placeholder="Checklist name…"
                value={newChecklistName}
              />
              <Button
                disabled={!newChecklistName.trim()}
                onClick={handleAddChecklist}
                size="sm"
              >
                Add
              </Button>
              <Button
                onClick={() => setAddingChecklist(false)}
                size="sm"
                variant="ghost"
              >
                Cancel
              </Button>
            </div>
          ) : (
            <button
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setAddingChecklist(true)}
            >
              <PlusIcon className="size-3.5" />
              Add checklist
            </button>
          )}

          {/* Dependencies */}
          {dependencies.length > 0 && (
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                Dependencies
              </Label>
              <div className="space-y-1">
                {dependencies.map((dep) => (
                  <div
                    className="flex items-center gap-2 rounded-md border px-2 py-1.5 group"
                    key={dep.id}
                  >
                    <ArrowRightIcon className="size-3 text-muted-foreground shrink-0" />
                    <span className="text-xs font-mono text-muted-foreground shrink-0">
                      #{dep.dependsOnSeq}
                    </span>
                    <span className="flex-1 text-sm truncate">
                      {dep.dependsOnTitle}
                    </span>
                    <button
                      className="opacity-0 group-hover:opacity-100 size-5 flex items-center justify-center rounded hover:bg-destructive/10 text-destructive transition-opacity"
                      onClick={() => handleRemoveDep(dep.id)}
                    >
                      <XIcon className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add dependency */}
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <PlusIcon className="size-3.5" />
                Add dependency
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-2">
              <Input
                autoFocus
                className="h-8 text-sm mb-2"
                onChange={(e) => handleDepSearch(e.target.value)}
                placeholder="Search tasks (#42 or title)…"
                value={depQuery}
              />
              {depResults.length > 0 && (
                <div className="space-y-1">
                  {depResults.map((t) => (
                    <button
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                      key={t.id}
                      onClick={() => handleAddDep(t.id)}
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        #{t.seqNumber}
                      </span>
                      <span className="truncate">{t.title}</span>
                    </button>
                  ))}
                </div>
              )}
              {depQuery.length >= 2 && depResults.length === 0 && (
                <p className="text-xs text-muted-foreground px-2">
                  No tasks found
                </p>
              )}
            </PopoverContent>
          </Popover>

          {/* Comments + Activity feed */}
          <TaskActivityFeed
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            listId={listId}
            spaceId={spaceId}
            taskId={taskId}
            workspaceId={workspaceId}
          />
        </div>

        {/* Sidebar column */}
        <div className="w-56 shrink-0 border-l overflow-y-auto px-4 py-4 space-y-5">
          {/* Assignees */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Assignees
              </span>
              <Popover>
                <PopoverTrigger asChild>
                  <button className="size-5 flex items-center justify-center rounded hover:bg-accent">
                    <PlusIcon className="size-3.5 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56 p-2">
                  <p className="text-xs font-medium text-muted-foreground mb-1.5 px-1">
                    Select members
                  </p>
                  <div className="space-y-0.5 max-h-48 overflow-y-auto">
                    {members.map((m) => {
                      const isAssigned = assignees.some(
                        (a) => a.userId === m.userId
                      );
                      return (
                        <button
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                          key={m.userId}
                          onClick={() => handleToggleAssignee(m.userId!)}
                        >
                          <Avatar className="size-6 shrink-0">
                            <AvatarFallback className="text-2xs">
                              {userInitials(m.name, m.email)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="flex-1 truncate text-left">
                            {m.name || m.email}
                          </span>
                          {isAssigned && (
                            <CheckIcon className="size-3.5 text-primary shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            {assignees.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {assignees.map((a) => (
                  <div
                    className="flex items-center gap-1 rounded-full bg-accent px-2 py-0.5"
                    key={a.userId}
                  >
                    <Avatar className="size-4">
                      <AvatarFallback className="text-[8px]">
                        {userInitials(a.name, a.email)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-xs max-w-20 truncate">
                      {a.name ?? a.email}
                    </span>
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => handleToggleAssignee(a.userId!)}
                    >
                      <XIcon className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">None</p>
            )}
          </div>

          <Separator />

          {/* Due date */}
          <div>
            <Label className="text-xs font-medium text-muted-foreground block mb-1.5">
              Due date
            </Label>
            <div className="space-y-1">
              <div>
                <p className="text-2xs text-muted-foreground mb-0.5">Start</p>
                <Popover onOpenChange={setStartCalOpen} open={startCalOpen}>
                  <PopoverTrigger asChild>
                    <button className="w-full flex items-center rounded-md border bg-background px-2 py-1.5 text-xs hover:bg-accent transition-colors text-left">
                      {dueDateStart ? (
                        format(dueDateStart, "MMM d, yyyy")
                      ) : (
                        <span className="text-muted-foreground">
                          Pick a date
                        </span>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-0">
                    <ClickUpCalendar
                      onClose={() => setStartCalOpen(false)}
                      onSelect={(date) => handleDueDateChange("start", date)}
                      selectedDate={dueDateStart}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <p className="text-2xs text-muted-foreground mb-0.5">End</p>
                <Popover onOpenChange={setEndCalOpen} open={endCalOpen}>
                  <PopoverTrigger asChild>
                    <button className="w-full flex items-center rounded-md border bg-background px-2 py-1.5 text-xs hover:bg-accent transition-colors text-left">
                      {dueDateEnd ? (
                        format(dueDateEnd, "MMM d, yyyy")
                      ) : (
                        <span className="text-muted-foreground">
                          Pick a date
                        </span>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-0">
                    <ClickUpCalendar
                      onClose={() => setEndCalOpen(false)}
                      onSelect={(date) => handleDueDateChange("end", date)}
                      selectedDate={dueDateEnd}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>

          <Separator />

            {/* Tags */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-muted-foreground">Tags</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="size-5 flex items-center justify-center rounded hover:bg-accent">
                      <PlusIcon className="size-3.5 text-muted-foreground" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-52 p-2" align="end">
                    <TagPicker
                      allTags={allTags}
                      selectedIds={tags.map((t) => t.id)}
                      onToggle={handleToggleTag}
                      onCreate={handleCreateTag}
                      onDelete={(id, name) => setDeleteTagTarget({ id, name })}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              {tags.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {tags.map((tag) => (
                    <Badge
                      key={tag.id}
                      variant="secondary"
                      className="gap-1 pr-1 text-xs"
                      style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
                    >
                      {tag.name}
                      <button onClick={() => handleToggleTag(tag.id)} className="hover:opacity-70">
                        <XIcon className="size-2.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">None</p>
              )}
            </div>

          <Separator />

          {/* Watchers */}
          <div>
            <span className="text-xs font-medium text-muted-foreground block mb-1.5">
              Watchers
            </span>
            {watchers.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {watchers.map((w) => (
                  <div key={w.userId} title={w.name ?? w.email ?? ""}>
                    <Avatar className="size-6">
                      <AvatarFallback className="text-[9px]">
                        {userInitials(w.name, w.email)}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">None</p>
            )}
          </div>

          <Separator />

          {/* Time log */}
          <div>
            <div className="flex items-center gap-1 mb-1.5">
              <TimerIcon className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">
                Time logged
              </span>
            </div>
            {timeLogs.length > 0 && (
              <div className="mb-2 space-y-1">
                {timeLogs.map((log) => (
                  <div
                    className="text-xs text-muted-foreground flex justify-between"
                    key={log.id}
                  >
                    <span>
                      {Math.floor(log.durationMinutes / 60)}h{" "}
                      {log.durationMinutes % 60}m
                    </span>
                    {log.note && (
                      <span className="truncate max-w-20">{log.note}</span>
                    )}
                  </div>
                ))}
                <div className="text-xs font-medium">
                  Total:{" "}
                  {Math.floor(
                    timeLogs.reduce((s, l) => s + l.durationMinutes, 0) / 60
                  )}
                  h {timeLogs.reduce((s, l) => s + l.durationMinutes, 0) % 60}m
                </div>
              </div>
            )}
            <div className="space-y-1">
              <Input
                className="h-7 text-xs"
                min={1}
                onChange={(e) => setTimeInput(e.target.value)}
                placeholder="Minutes"
                type="number"
                value={timeInput}
              />
              <Input
                className="h-7 text-xs"
                onChange={(e) => setTimeNote(e.target.value)}
                placeholder="Note (optional)"
                value={timeNote}
              />
              <Button
                className="h-7 w-full text-xs"
                disabled={!timeInput}
                onClick={handleLogTime}
                size="sm"
              >
                Log time
              </Button>
            </div>
          </div>

          <Separator />

          {/* Reporter */}
          <div>
            <span className="text-xs font-medium text-muted-foreground block mb-1">
              Reporter
            </span>
            <div className="flex items-center gap-1.5">
              <UserIcon className="size-3.5 text-muted-foreground" />
              <span className="text-xs truncate">
                {members.find((m) => m.userId === t.reporterId)?.name ??
                  "Unknown"}
              </span>
            </div>
          </div>

          {/* Checklist progress (sidebar summary) */}
          {totalItems > 0 && (
            <>
              <Separator />
              <div>
                <span className="text-xs font-medium text-muted-foreground block mb-1.5">
                  Checklist
                </span>
                <Progress className="h-1.5 mb-1" value={checkProgress} />
                <p className="text-xs text-muted-foreground">
                  {totalChecked}/{totalItems} items
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );

  const deleteTagDialog = (
    <AlertDialog open={!!deleteTagTarget} onOpenChange={(open) => { if (!open) setDeleteTagTarget(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete tag &ldquo;{deleteTagTarget?.name}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the tag and remove it from every task in the workspace. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDeleteTag}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            Delete tag
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (inline) {
    return (
      <>
        <div className="h-full overflow-y-auto flex flex-col gap-0">
          {panelContent}
        </div>
        {deleteTagDialog}
      </>
    );
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          className="w-full sm:max-w-2xl overflow-y-auto flex flex-col gap-0 p-0"
          aria-describedby={undefined}
        >
          {panelContent}
        </SheetContent>
      </Sheet>
      {deleteTagDialog}
      <ManageStatusesDialog
        open={manageStatusesOpen}
        onOpenChange={setManageStatusesOpen}
        workspaceId={workspaceId}
        spaceId={spaceId}
        listId={listId}
        onSaved={() => load()}
      />
    </>
  );
}

// ─── Tag picker sub-component ─────────────────────────────────────────────────

function TagPicker({
  allTags,
  selectedIds,
  onToggle,
  onCreate,
  onDelete,
}: {
  allTags: { id: string; name: string; color: string }[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onCreate: (name: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const [search, setSearch] = React.useState("");

  const filtered = allTags.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );
  const exactMatch = allTags.some(
    (t) => t.name.toLowerCase() === search.toLowerCase()
  );

  return (
    <div>
      <Input
        autoFocus
        className="h-7 text-xs mb-2"
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search or create tag…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && search.trim() && !exactMatch) {
            e.preventDefault();
            onCreate(search.trim());
            setSearch("");
          }
        }}
        className="h-7 text-xs mb-2"
      />
      <div className="space-y-0.5 max-h-40 overflow-y-auto">
        {filtered.map((tag) => (
          <div
            key={tag.id}
            className="group/tag flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-accent"
          >
            <button
              onClick={() => onToggle(tag.id)}
              className="flex flex-1 min-w-0 items-center gap-2"
            >
              <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
              <span className="flex-1 truncate text-left text-xs">{tag.name}</span>
              {selectedIds.includes(tag.id) && <CheckIcon className="size-3.5 text-primary shrink-0" />}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(tag.id, tag.name); }}
              className="opacity-0 group-hover/tag:opacity-100 flex size-5 items-center justify-center rounded hover:bg-destructive/10 hover:text-destructive transition-opacity shrink-0"
            >
              <TrashIcon className="size-3" />
            </button>
          </div>
        ))}
        {search && !exactMatch && (
          <button
            onClick={() => { onCreate(search.trim()); setSearch(""); }}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-xs text-primary hover:bg-accent"
            onClick={() => {
              onCreate(search);
              setSearch("");
            }}
          >
            <PlusIcon className="size-3.5" />
            Create &ldquo;{search}&rdquo;
          </button>
        )}
      </div>
    </div>
  );
}
