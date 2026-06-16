"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArchiveIcon,
  ArrowRightIcon,
  CheckIcon,
  ClipboardTextIcon,
  CopyIcon,
  DotsThreeIcon,
  EyeIcon,
  EyeSlashIcon,
  LinkIcon,
  PlusIcon,
  TagIcon,
  TimerIcon,
  TrashIcon,
  UserIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  getTaskDetail,
  updateTask,
  updateTaskStatus,
  deleteTask,
  archiveTask,
  duplicateTask,
  getWorkspaceMembers,
  getTaskActivity,
} from "@/app/actions/task";
import { addAssignee, removeAssignee, toggleWatcher } from "@/app/actions/task-assignee";
import { getWorkspaceTags, createTag, addTaskTag, removeTaskTag } from "@/app/actions/task-tag";
import {
  createChecklist,
  deleteChecklist,
  addChecklistItem,
  toggleChecklistItem,
  deleteChecklistItem,
} from "@/app/actions/task-checklist";
import { addDependency, removeDependency, searchTasksForDependency } from "@/app/actions/task-dependency";
import { logTime } from "@/app/actions/task";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type Priority = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";

interface TaskDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  workspaceId: string;
  spaceId: string;
  listId: string;
}

// ─── Priority config ──────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<Priority, { label: string; color: string; dot: string }> = {
  NONE: { label: "No priority", color: "text-muted-foreground", dot: "bg-muted-foreground/40" },
  LOW: { label: "Low", color: "text-blue-500", dot: "bg-blue-500" },
  MEDIUM: { label: "Medium", color: "text-yellow-500", dot: "bg-yellow-500" },
  HIGH: { label: "High", color: "text-orange-500", dot: "bg-orange-500" },
  URGENT: { label: "Urgent", color: "text-red-500", dot: "bg-red-500" },
};

// ─── Avatar helper ────────────────────────────────────────────────────────────

function userInitials(name: string | null, email: string | null) {
  if (name) return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  return (email ?? "?").slice(0, 2).toUpperCase();
}

// ─── Activity event labels ────────────────────────────────────────────────────

function describeEvent(eventType: string, meta: Record<string, unknown>): string {
  switch (eventType) {
    case "task_created": return "created this task";
    case "title_changed": return `renamed to "${meta.to}"`;
    case "status_changed": return "changed the status";
    case "priority_changed": return `changed priority to ${meta.to}`;
    case "description_updated": return "updated the description";
    case "assignee_added": return "added an assignee";
    case "assignee_removed": return "removed an assignee";
    case "watcher_added": return "started watching";
    case "watcher_removed": return "stopped watching";
    case "due_date_set": return "set a due date";
    case "due_date_changed": return "changed the due date";
    case "due_date_removed": return "removed the due date";
    case "tag_added": return `added tag "${meta.tagName}"`;
    case "tag_removed": return `removed tag "${meta.tagName}"`;
    case "dependency_added": return "added a dependency";
    case "dependency_removed": return "removed a dependency";
    case "task_archived": return "archived this task";
    case "task_unarchived": return "unarchived this task";
    case "task_moved": return "moved this task";
    case "time_logged": return `logged ${meta.minutes} minutes`;
    case "checklist_created": return "added a checklist";
    case "checklist_deleted": return "deleted a checklist";
    default: return eventType.replace(/_/g, " ");
  }
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export function TaskDetailPanel({
  open,
  onOpenChange,
  taskId,
  workspaceId,
  spaceId,
  listId,
}: TaskDetailPanelProps) {
  const router = useRouter();
  const [data, setData] = React.useState<Awaited<ReturnType<typeof getTaskDetail>> | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [titleEditing, setTitleEditing] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState("");
  const [descDraft, setDescDraft] = React.useState("");
  const [descEditing, setDescEditing] = React.useState(false);
  const [members, setMembers] = React.useState<{ userId: string | null; name: string; email: string; image: string | null }[]>([]);
  const [allTags, setAllTags] = React.useState<{ id: string; name: string; color: string }[]>([]);
  const [activity, setActivity] = React.useState<{ id: string; eventType: string; meta: unknown; createdAt: Date; name: string | null; email: string | null }[]>([]);
  const [newChecklistName, setNewChecklistName] = React.useState("");
  const [addingChecklist, setAddingChecklist] = React.useState(false);
  const [newItemTexts, setNewItemTexts] = React.useState<Record<string, string>>({});
  const [depQuery, setDepQuery] = React.useState("");
  const [depResults, setDepResults] = React.useState<{ id: string; title: string; seqNumber: number }[]>([]);
  const [timeInput, setTimeInput] = React.useState("");
  const [timeNote, setTimeNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function load() {
    setLoading(true);
    const [detail, mem, tags, act] = await Promise.all([
      getTaskDetail(workspaceId, spaceId, taskId),
      getWorkspaceMembers(workspaceId),
      getWorkspaceTags(workspaceId),
      getTaskActivity(workspaceId, spaceId, taskId),
    ]);
    setData(detail && !("error" in detail) ? detail : null);
    if (mem && !("error" in mem)) setMembers(mem.members.filter((m): m is typeof m & { userId: string } => m.userId !== null));
    if (tags && !("error" in tags)) setAllTags(tags.tags);
    if (act && !("error" in act)) setActivity(act.logs as typeof activity);
    setLoading(false);
  }

  React.useEffect(() => {
    if (open && taskId) load();
  }, [open, taskId]);

  React.useEffect(() => {
    if (data && !("error" in data)) {
      setTitleDraft(data.task.title);
      setDescDraft(
        typeof data.task.description === "string"
          ? data.task.description
          : data.task.description
          ? JSON.stringify(data.task.description)
          : "",
      );
    }
  }, [data]);

  if (!open) return null;

  if (loading || !data || "error" in data) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" aria-describedby={undefined}>
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">{loading ? "Loading…" : "Task not found"}</p>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  const { task: t, assignees, watchers, tags, checklists, dependencies, timeLogs, statuses, currentUserId } = data;
  const isWatching = watchers.some((w) => w.userId === currentUserId);
  const currentStatus = statuses.find((s) => s.id === t.statusId);
  const priority = PRIORITY_CONFIG[t.priority as Priority] ?? PRIORITY_CONFIG.NONE;
  const totalChecked = checklists.flatMap((c) => c.items).filter((i) => i.isChecked).length;
  const totalItems = checklists.flatMap((c) => c.items).length;
  const checkProgress = totalItems > 0 ? Math.round((totalChecked / totalItems) * 100) : 0;

  async function saveTitle() {
    if (!titleDraft.trim() || titleDraft === t.title) { setTitleEditing(false); return; }
    await updateTask(workspaceId, spaceId, listId, taskId, { title: titleDraft.trim() });
    setTitleEditing(false);
    load();
  }

  async function saveDescription() {
    await updateTask(workspaceId, spaceId, listId, taskId, { description: descDraft });
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

  async function handleDueDateChange(field: "start" | "end", value: string) {
    const date = value ? new Date(value) : null;
    if (field === "start") await updateTask(workspaceId, spaceId, listId, taskId, { dueDateStart: date });
    else await updateTask(workspaceId, spaceId, listId, taskId, { dueDateEnd: date });
    load();
  }

  async function handleToggleAssignee(userId: string) {
    const already = assignees.some((a) => a.userId === userId);
    if (already) await removeAssignee(workspaceId, spaceId, listId, taskId, userId);
    else await addAssignee(workspaceId, spaceId, listId, taskId, userId);
    load();
  }

  async function handleToggleTag(tagId: string) {
    const already = tags.some((tag) => tag.id === tagId);
    if (already) await removeTaskTag(workspaceId, spaceId, listId, taskId, tagId);
    else await addTaskTag(workspaceId, spaceId, listId, taskId, tagId);
    load();
  }

  async function handleCreateTag(name: string) {
    const res = await createTag(workspaceId, name);
    if ("tag" in res) {
      await addTaskTag(workspaceId, spaceId, listId, taskId, res.tag.id);
      load();
    }
  }

  async function handleToggleWatch() {
    await toggleWatcher(workspaceId, spaceId, listId, taskId);
    load();
  }

  async function handleAddChecklist() {
    if (!newChecklistName.trim()) return;
    await createChecklist(workspaceId, spaceId, listId, taskId, newChecklistName);
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
    if (!text.trim()) return;
    await addChecklistItem(workspaceId, spaceId, listId, checklistId, text);
    setNewItemTexts((prev) => ({ ...prev, [checklistId]: "" }));
    load();
  }

  async function handleDepSearch(q: string) {
    setDepQuery(q);
    if (q.length < 2) { setDepResults([]); return; }
    const res = await searchTasksForDependency(workspaceId, spaceId, q, taskId);
    if ("tasks" in res) setDepResults(res.tasks);
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
    const mins = parseInt(timeInput);
    if (!mins || mins <= 0) return;
    await logTime(workspaceId, spaceId, listId, taskId, mins, timeNote || undefined);
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
    if (!confirm(`Permanently delete this task? This cannot be undone.`)) return;
    await deleteTask(workspaceId, spaceId, listId, taskId);
    onOpenChange(false);
  }

  function copyLink() {
    navigator.clipboard.writeText(`${window.location.origin}/${workspaceId}/task/${taskId}`);
  }

  const dueDateStartStr = t.dueDateStart
    ? format(new Date(t.dueDateStart), "yyyy-MM-dd")
    : "";
  const dueDateEndStr = t.dueDateEnd
    ? format(new Date(t.dueDateEnd), "yyyy-MM-dd")
    : "";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full sm:max-w-2xl overflow-y-auto flex flex-col gap-0 p-0"
        aria-describedby={undefined}
      >
        {/* Header */}
        <div className="flex items-start gap-2 border-b px-6 py-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <ClipboardTextIcon className="size-3.5" />
              <span className="font-mono">#{t.seqNumber}</span>
              <button onClick={copyLink} className="flex items-center gap-1 hover:text-foreground">
                <LinkIcon className="size-3" />
                Copy link
              </button>
            </div>
            {titleEditing ? (
              <Input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setTitleEditing(false); }}
                className="text-base font-semibold h-auto py-1 border-none shadow-none focus-visible:ring-0 px-0"
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
              onClick={handleToggleWatch}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
                isWatching
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {isWatching ? <EyeSlashIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
              {isWatching ? "Unwatch" : "Watch"}
            </button>
            <Popover>
              <PopoverTrigger asChild>
                <button className="flex size-8 items-center justify-center rounded-md hover:bg-accent">
                  <DotsThreeIcon className="size-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-44 p-1">
                <button onClick={handleDuplicate} disabled={saving} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent">
                  <CopyIcon className="size-3.5 text-muted-foreground" /> Duplicate
                </button>
                <button onClick={handleArchive} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent">
                  <ArchiveIcon className="size-3.5 text-muted-foreground" /> Archive
                </button>
                <Separator className="my-1" />
                <button onClick={handleDelete} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10">
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
              <Select value={t.statusId} onValueChange={handleStatusChange}>
                <SelectTrigger className="h-7 w-auto text-xs px-2 gap-1.5">
                  {currentStatus && (
                    <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: currentStatus.color }} />
                  )}
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statuses.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} />
                        {s.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={t.priority} onValueChange={(v) => handlePriorityChange(v as Priority)}>
                <SelectTrigger className={cn("h-7 w-auto text-xs px-2 gap-1.5", priority.color)}>
                  <span className={cn("size-2 rounded-full shrink-0", priority.dot)} />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(PRIORITY_CONFIG) as [Priority, typeof PRIORITY_CONFIG[Priority]][]).map(([key, cfg]) => (
                    <SelectItem key={key} value={key}>
                      <span className={cn("flex items-center gap-1.5", cfg.color)}>
                        <span className={cn("size-2 rounded-full", cfg.dot)} />
                        {cfg.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Description */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Description</Label>
              {descEditing ? (
                <div className="space-y-2">
                  <Textarea
                    autoFocus
                    value={descDraft}
                    onChange={(e) => setDescDraft(e.target.value)}
                    rows={6}
                    className="text-sm resize-none"
                    placeholder="Add a description…"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveDescription}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setDescEditing(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => setDescEditing(true)}
                  className="min-h-[60px] rounded-md border border-transparent hover:border-border hover:bg-accent/30 px-2 py-1.5 text-sm cursor-text transition-colors"
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
                        <span className="text-xs text-muted-foreground">{clChecked}/{clTotal}</span>
                      </div>
                      {clTotal > 0 && (
                        <Progress value={clTotal > 0 ? (clChecked / clTotal) * 100 : 0} className="h-1.5 mb-2" />
                      )}
                      <div className="space-y-1">
                        {cl.items.map((item) => (
                          <div key={item.id} className="flex items-center gap-2 group">
                            <Checkbox
                              checked={item.isChecked}
                              onCheckedChange={() => handleToggleItem(item.id)}
                              className="shrink-0"
                            />
                            <span className={cn("flex-1 text-sm", item.isChecked && "line-through text-muted-foreground")}>
                              {item.title}
                            </span>
                            <button
                              onClick={() => deleteChecklistItem(workspaceId, spaceId, listId, item.id).then(load)}
                              className="opacity-0 group-hover:opacity-100 flex size-5 items-center justify-center rounded hover:bg-destructive/10 text-destructive transition-opacity"
                            >
                              <XIcon className="size-3" />
                            </button>
                          </div>
                        ))}
                        {/* Add item row */}
                        <div className="flex gap-1 mt-1">
                          <Input
                            placeholder="Add item…"
                            value={newItemTexts[cl.id] ?? ""}
                            onChange={(e) => setNewItemTexts((prev) => ({ ...prev, [cl.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddItem(cl.id); } }}
                            className="h-7 text-xs"
                          />
                          <Button size="sm" className="h-7 px-2" onClick={() => handleAddItem(cl.id)}>
                            <PlusIcon className="size-3.5" />
                          </Button>
                          <button
                            onClick={() => deleteChecklist(workspaceId, spaceId, listId, cl.id).then(load)}
                            className="flex size-7 items-center justify-center rounded hover:bg-destructive/10 text-destructive"
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
                  placeholder="Checklist name…"
                  value={newChecklistName}
                  onChange={(e) => setNewChecklistName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddChecklist(); } if (e.key === "Escape") setAddingChecklist(false); }}
                  className="h-8 text-sm"
                />
                <Button size="sm" onClick={handleAddChecklist} disabled={!newChecklistName.trim()}>Add</Button>
                <Button size="sm" variant="ghost" onClick={() => setAddingChecklist(false)}>Cancel</Button>
              </div>
            ) : (
              <button
                onClick={() => setAddingChecklist(true)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <PlusIcon className="size-3.5" />
                Add checklist
              </button>
            )}

            {/* Dependencies */}
            {dependencies.length > 0 && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Dependencies</Label>
                <div className="space-y-1">
                  {dependencies.map((dep) => (
                    <div key={dep.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 group">
                      <ArrowRightIcon className="size-3 text-muted-foreground shrink-0" />
                      <span className="text-xs font-mono text-muted-foreground shrink-0">#{dep.dependsOnSeq}</span>
                      <span className="flex-1 text-sm truncate">{dep.dependsOnTitle}</span>
                      <button
                        onClick={() => handleRemoveDep(dep.id)}
                        className="opacity-0 group-hover:opacity-100 size-5 flex items-center justify-center rounded hover:bg-destructive/10 text-destructive transition-opacity"
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
                  placeholder="Search tasks (#42 or title)…"
                  value={depQuery}
                  onChange={(e) => handleDepSearch(e.target.value)}
                  className="h-8 text-sm mb-2"
                  autoFocus
                />
                {depResults.length > 0 && (
                  <div className="space-y-1">
                    {depResults.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => handleAddDep(t.id)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                      >
                        <span className="font-mono text-xs text-muted-foreground">#{t.seqNumber}</span>
                        <span className="truncate">{t.title}</span>
                      </button>
                    ))}
                  </div>
                )}
                {depQuery.length >= 2 && depResults.length === 0 && (
                  <p className="text-xs text-muted-foreground px-2">No tasks found</p>
                )}
              </PopoverContent>
            </Popover>

            {/* Activity log */}
            {activity.length > 0 && (
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">Activity</Label>
                <div className="space-y-3">
                  {activity.map((log) => (
                    <div key={log.id} className="flex items-start gap-2">
                      <Avatar className="size-6 shrink-0 mt-0.5">
                        <AvatarFallback className="text-[10px]">
                          {userInitials(log.name, log.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-medium">{log.name ?? log.email ?? "Someone"}</span>
                        <span className="text-xs text-muted-foreground"> {describeEvent(log.eventType, log.meta as Record<string, unknown>)}</span>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar column */}
          <div className="w-56 shrink-0 border-l overflow-y-auto px-4 py-4 space-y-5">
            {/* Assignees */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-muted-foreground">Assignees</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="size-5 flex items-center justify-center rounded hover:bg-accent">
                      <PlusIcon className="size-3.5 text-muted-foreground" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-2" align="end">
                    <p className="text-xs font-medium text-muted-foreground mb-1.5 px-1">Select members</p>
                    <div className="space-y-0.5 max-h-48 overflow-y-auto">
                      {members.map((m) => {
                        const isAssigned = assignees.some((a) => a.userId === m.userId);
                        return (
                          <button
                            key={m.userId}
                            onClick={() => handleToggleAssignee(m.userId!)}
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                          >
                            <Avatar className="size-6 shrink-0">
                              <AvatarFallback className="text-[10px]">{userInitials(m.name, m.email)}</AvatarFallback>
                            </Avatar>
                            <span className="flex-1 truncate text-left">{m.name || m.email}</span>
                            {isAssigned && <CheckIcon className="size-3.5 text-primary shrink-0" />}
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
                    <div key={a.userId} className="flex items-center gap-1 rounded-full bg-accent px-2 py-0.5">
                      <Avatar className="size-4">
                        <AvatarFallback className="text-[8px]">{userInitials(a.name, a.email)}</AvatarFallback>
                      </Avatar>
                      <span className="text-xs max-w-[80px] truncate">{a.name ?? a.email}</span>
                      <button onClick={() => handleToggleAssignee(a.userId!)} className="text-muted-foreground hover:text-foreground">
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
              <Label className="text-xs font-medium text-muted-foreground block mb-1.5">Due date</Label>
              <div className="space-y-1">
                <div>
                  <p className="text-[10px] text-muted-foreground mb-0.5">Start</p>
                  <input
                    type="date"
                    value={dueDateStartStr}
                    onChange={(e) => handleDueDateChange("start", e.target.value)}
                    className="w-full rounded-md border bg-background px-2 py-1 text-xs"
                  />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-0.5">End</p>
                  <input
                    type="date"
                    value={dueDateEndStr}
                    onChange={(e) => handleDueDateChange("end", e.target.value)}
                    className="w-full rounded-md border bg-background px-2 py-1 text-xs"
                  />
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
              <span className="text-xs font-medium text-muted-foreground block mb-1.5">Watchers</span>
              {watchers.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {watchers.map((w) => (
                    <div key={w.userId} title={w.name ?? w.email ?? ""}>
                      <Avatar className="size-6">
                        <AvatarFallback className="text-[9px]">{userInitials(w.name, w.email)}</AvatarFallback>
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
                <span className="text-xs font-medium text-muted-foreground">Time logged</span>
              </div>
              {timeLogs.length > 0 && (
                <div className="mb-2 space-y-1">
                  {timeLogs.map((log) => (
                    <div key={log.id} className="text-xs text-muted-foreground flex justify-between">
                      <span>{Math.floor(log.durationMinutes / 60)}h {log.durationMinutes % 60}m</span>
                      {log.note && <span className="truncate max-w-[80px]">{log.note}</span>}
                    </div>
                  ))}
                  <div className="text-xs font-medium">
                    Total: {Math.floor(timeLogs.reduce((s, l) => s + l.durationMinutes, 0) / 60)}h {timeLogs.reduce((s, l) => s + l.durationMinutes, 0) % 60}m
                  </div>
                </div>
              )}
              <div className="space-y-1">
                <Input
                  type="number"
                  placeholder="Minutes"
                  value={timeInput}
                  onChange={(e) => setTimeInput(e.target.value)}
                  className="h-7 text-xs"
                  min={1}
                />
                <Input
                  placeholder="Note (optional)"
                  value={timeNote}
                  onChange={(e) => setTimeNote(e.target.value)}
                  className="h-7 text-xs"
                />
                <Button size="sm" className="h-7 w-full text-xs" onClick={handleLogTime} disabled={!timeInput}>
                  Log time
                </Button>
              </div>
            </div>

            <Separator />

            {/* Reporter */}
            <div>
              <span className="text-xs font-medium text-muted-foreground block mb-1">Reporter</span>
              <div className="flex items-center gap-1.5">
                <UserIcon className="size-3.5 text-muted-foreground" />
                <span className="text-xs truncate">
                  {members.find((m) => m.userId === t.reporterId)?.name ?? "Unknown"}
                </span>
              </div>
            </div>

            {/* Checklist progress (sidebar summary) */}
            {totalItems > 0 && (
              <>
                <Separator />
                <div>
                  <span className="text-xs font-medium text-muted-foreground block mb-1.5">Checklist</span>
                  <Progress value={checkProgress} className="h-1.5 mb-1" />
                  <p className="text-xs text-muted-foreground">{totalChecked}/{totalItems} items</p>
                </div>
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Tag picker sub-component ─────────────────────────────────────────────────

function TagPicker({
  allTags,
  selectedIds,
  onToggle,
  onCreate,
}: {
  allTags: { id: string; name: string; color: string }[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onCreate: (name: string) => void;
}) {
  const [search, setSearch] = React.useState("");

  const filtered = allTags.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()));
  const exactMatch = allTags.some((t) => t.name.toLowerCase() === search.toLowerCase());

  return (
    <div>
      <Input
        autoFocus
        placeholder="Search or create tag…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-7 text-xs mb-2"
      />
      <div className="space-y-0.5 max-h-40 overflow-y-auto">
        {filtered.map((tag) => (
          <button
            key={tag.id}
            onClick={() => onToggle(tag.id)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
          >
            <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
            <span className="flex-1 truncate text-left text-xs">{tag.name}</span>
            {selectedIds.includes(tag.id) && <CheckIcon className="size-3.5 text-primary shrink-0" />}
          </button>
        ))}
        {search && !exactMatch && (
          <button
            onClick={() => { onCreate(search); setSearch(""); }}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-xs text-primary hover:bg-accent"
          >
            <PlusIcon className="size-3.5" />
            Create &ldquo;{search}&rdquo;
          </button>
        )}
      </div>
    </div>
  );
}
