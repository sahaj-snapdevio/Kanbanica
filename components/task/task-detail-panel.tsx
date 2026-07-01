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
  GearIcon,
  LinkIcon,
  PlusIcon,
  TagIcon,
  TrashIcon,
  UserPlusIcon,
  UserIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  getTaskDetail,
  updateTask,
  updateTaskStatus,
  deleteTask,
  archiveTask,
  unarchiveTask,
  duplicateTask,
  getWorkspaceMembers,
} from "@/app/actions/task";
import { toastWithUndo } from "@/lib/undo-toast";
import { addAssignee, removeAssignee, toggleWatcher } from "@/app/actions/task-assignee";
import { getWorkspaceTags, createTag, deleteTag, addTaskTag, removeTaskTag } from "@/app/actions/task-tag";
import {
  createChecklist,
  deleteChecklist,
  addChecklistItem,
  toggleChecklistItem,
  deleteChecklistItem,
} from "@/app/actions/task-checklist";
import { addDependency, removeDependency, searchTasksForDependency } from "@/app/actions/task-dependency";
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
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { TaskActivityFeed, type TaskActivityFeedHandle } from "@/components/task/task-activity-feed";
import { AttachmentPreviewProvider } from "@/components/task/attachment-preview-modal";
import { InviteMemberModal } from "@/components/workspace/invite-member-modal";
import { ManageStatusesDialog } from "@/components/list/manage-statuses-dialog";
import { Calendar } from "@/components/ui/calendar";

// ─── Types ────────────────────────────────────────────────────────────────────

type Priority = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";

interface TaskDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  workspaceId: string;
  spaceId: string;
  listId: string;
  isAdmin?: boolean;
  inline?: boolean; // render content directly without Sheet overlay
}

// ─── Priority config ──────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<Priority, { label: string; color: string; icon: string; bg: string }> = {
  NONE: { label: "No Priority", color: "text-muted-foreground", icon: "😴", bg: "bg-muted/60" },
  LOW: { label: "Low", color: "text-blue-500", icon: "🦥", bg: "bg-blue-50 dark:bg-blue-950/40" },
  MEDIUM: { label: "Medium", color: "text-yellow-500", icon: "🚶", bg: "bg-yellow-50 dark:bg-yellow-950/40" },
  HIGH: { label: "High", color: "text-orange-500", icon: "🏃", bg: "bg-orange-50 dark:bg-orange-950/40" },
  URGENT: { label: "Urgent", color: "text-red-500", icon: "🚨", bg: "bg-red-50 dark:bg-red-950/40" },
};

// ─── Avatar helper ────────────────────────────────────────────────────────────

function userInitials(name: string | null, email: string | null) {
  if (name) return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
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
  const [data, setData] = React.useState<Awaited<ReturnType<typeof getTaskDetail>> | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [titleEditing, setTitleEditing] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState("");
  const [descDraft, setDescDraft] = React.useState("");
  const [descEditing, setDescEditing] = React.useState(false);
  const [members, setMembers] = React.useState<{ userId: string | null; name: string; email: string; image: string | null }[]>([]);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [allTags, setAllTags] = React.useState<{ id: string; name: string; color: string }[]>([]);
  const [deleteTagTarget, setDeleteTagTarget] = React.useState<{ id: string; name: string } | null>(null);
  const [newChecklistName, setNewChecklistName] = React.useState("");
  const [addingChecklist, setAddingChecklist] = React.useState(false);
  const [newItemTexts, setNewItemTexts] = React.useState<Record<string, string>>({});
  const [depQuery, setDepQuery] = React.useState("");
  const [depResults, setDepResults] = React.useState<{ id: string; title: string; seqNumber: number }[]>([]);
  const feedRef = React.useRef<TaskActivityFeedHandle>(null);
  const [saving, setSaving] = React.useState(false);
  const [startCalOpen, setStartCalOpen] = React.useState(false);
  const [endCalOpen, setEndCalOpen] = React.useState(false);
  const [manageStatusesOpen, setManageStatusesOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  async function load() {
    setLoading(true);
    const [detail, mem, tags] = await Promise.all([
      getTaskDetail(workspaceId, spaceId, taskId),
      getWorkspaceMembers(workspaceId),
      getWorkspaceTags(workspaceId),
    ]);
    setData(detail && !("error" in detail) ? detail : null);
    if (mem && !("error" in mem)) setMembers(mem.members.filter((m): m is typeof m & { userId: string } => m.userId !== null));
    if (tags && !("error" in tags)) setAllTags(tags.tags);
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
    const loadingContent = (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">{loading ? "Loading…" : "Task not found"}</p>
      </div>
    );
    if (inline) return <div className="h-full overflow-y-auto">{loadingContent}</div>;
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" aria-describedby={undefined}>
          {loadingContent}
        </SheetContent>
      </Sheet>
    );
  }

  const { task: t, assignees, watchers, tags, checklists, dependencies, statuses, currentUserId } = data;
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

  async function handleDueDateChange(field: "start" | "end", date: Date | null) {
    if (field === "start") {
      // Keep end >= start: if the new start is after the current end, move end too.
      const patch =
        date && dueDateEnd && date > dueDateEnd
          ? { dueDateStart: date, dueDateEnd: date }
          : { dueDateStart: date };
      await updateTask(workspaceId, spaceId, listId, taskId, patch);
    } else {
      await updateTask(workspaceId, spaceId, listId, taskId, { dueDateEnd: date });
    }
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
    if ("tasks" in res) setDepResults(res.tasks?.map((t) => ({ id: t.id, title: t.title, seqNumber: t.seqNumber })) ?? []);
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
    toastWithUndo("Task archived", async () => {
      await unarchiveTask(workspaceId, spaceId, listId, taskId);
      router.refresh();
    });
  }

  function handleDelete() {
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    setDeleting(true);
    await deleteTask(workspaceId, spaceId, listId, taskId);
    setDeleting(false);
    setDeleteOpen(false);
    onOpenChange(false);
  }

  function copyLink() {
    navigator.clipboard.writeText(`${window.location.origin}/${workspaceId}/task/${taskId}`);
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
                  <DotsThreeIcon className="size-4.5" weight="bold" />
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

              <Select value={t.priority} onValueChange={(v) => handlePriorityChange(v as Priority)}>
                <SelectTrigger className={cn("h-7 w-auto text-xs px-2 gap-1.5", priority.color, priority.bg)}>
                  <span>{priority.icon}</span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(PRIORITY_CONFIG) as [Priority, typeof PRIORITY_CONFIG[Priority]][]).map(([key, cfg]) => (
                    <SelectItem key={key} value={key}>
                      <span className={cn("flex items-center gap-1.5", cfg.color)}>
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
                  className="min-h-15 rounded-md border border-transparent hover:border-border hover:bg-accent/30 px-2 py-1.5 text-sm cursor-text transition-colors"
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

            {/* Comments + Activity feed */}
            <TaskActivityFeed
              ref={feedRef}
              workspaceId={workspaceId}
              spaceId={spaceId}
              listId={listId}
              taskId={taskId}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
            />
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
                              <AvatarFallback className="text-2xs">{userInitials(m.name, m.email)}</AvatarFallback>
                            </Avatar>
                            <span className="flex-1 truncate text-left">{m.name || m.email}</span>
                            {isAssigned && <CheckIcon className="size-3.5 text-primary shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                    <Separator className="my-1.5" />
                    <button
                      onClick={() => setInviteOpen(true)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-border">
                        <UserPlusIcon className="size-3.5" />
                      </span>
                      <span className="flex-1 truncate text-left">Invite member</span>
                    </button>
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
                      <span className="text-xs max-w-20 truncate">{a.name ?? a.email}</span>
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
                  <p className="text-2xs text-muted-foreground mb-0.5">Start</p>
                  <Popover open={startCalOpen} onOpenChange={setStartCalOpen}>
                    <PopoverTrigger asChild>
                      <button className="w-full flex items-center rounded-md border bg-background px-2 py-1.5 text-xs hover:bg-accent transition-colors text-left">
                        {dueDateStart ? format(dueDateStart, "MMM d, yyyy") : <span className="text-muted-foreground">Pick a date</span>}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end" collisionPadding={16}>
                      <Calendar
                        mode="single"
                        selected={dueDateStart ?? undefined}
                        onSelect={(date) => { handleDueDateChange("start", date ?? null); setStartCalOpen(false); }}

                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div>
                  <p className="text-2xs text-muted-foreground mb-0.5">End</p>
                  <Popover open={endCalOpen} onOpenChange={setEndCalOpen}>
                    <PopoverTrigger asChild>
                      <button className="w-full flex items-center rounded-md border bg-background px-2 py-1.5 text-xs hover:bg-accent transition-colors text-left">
                        {dueDateEnd ? format(dueDateEnd, "MMM d, yyyy") : <span className="text-muted-foreground">Pick a date</span>}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end" collisionPadding={16}>
                      <Calendar
                        mode="single"
                        selected={dueDateEnd ?? undefined}
                        disabled={dueDateStart ? { before: dueDateStart } : undefined}
                        onSelect={(date) => { handleDueDateChange("end", date ?? null); setEndCalOpen(false); }}

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
    </>
  );

  const deleteTaskDialog = (
    <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <DialogContent className="sm:max-w-xs text-center">
        <div className="flex flex-col items-center gap-3 pt-2">
          <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
            <TrashIcon className="size-6 text-destructive" weight="fill" />
          </div>
          <div>
            <DialogTitle className="text-base font-bold">Delete Task</DialogTitle>
            <p className="text-sm text-muted-foreground mt-1">This action cannot be undone.</p>
          </div>
        </div>
        <div className="flex gap-2 mt-2">
          <Button variant="outline" className="flex-1" onClick={() => setDeleteOpen(false)} disabled={deleting}>Cancel</Button>
          <Button variant="destructive" className="flex-1" onClick={confirmDelete} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
          <AttachmentPreviewProvider>{panelContent}</AttachmentPreviewProvider>
        </div>
        {deleteTagDialog}
        {deleteTaskDialog}
        <InviteMemberModal open={inviteOpen} onOpenChange={setInviteOpen} workspaceId={workspaceId} onInvited={load} />
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
          <AttachmentPreviewProvider>{panelContent}</AttachmentPreviewProvider>
        </SheetContent>
      </Sheet>
      {deleteTagDialog}
      {deleteTaskDialog}
      <ManageStatusesDialog
        open={manageStatusesOpen}
        onOpenChange={setManageStatusesOpen}
        workspaceId={workspaceId}
        spaceId={spaceId}
        listId={listId}
        onSaved={() => load()}
      />
      <InviteMemberModal open={inviteOpen} onOpenChange={setInviteOpen} workspaceId={workspaceId} onInvited={load} />
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

  const filtered = allTags.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()));
  const exactMatch = allTags.some((t) => t.name.toLowerCase() === search.toLowerCase());

  return (
    <div>
      <Input
        autoFocus
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
          >
            <PlusIcon className="size-3.5" />
            Create &ldquo;{search}&rdquo;
          </button>
        )}
      </div>
    </div>
  );
}
