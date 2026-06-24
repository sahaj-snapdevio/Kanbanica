"use client";

import {
  ArchiveIcon,
  ArrowLeftIcon,
  CalendarBlankIcon,
  CaretRightIcon,
  CheckIcon,
  ClipboardTextIcon,
  CopyIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  EyeIcon,
  EyeSlashIcon,
  FileIcon,
  FilePdfIcon,
  FlagIcon,
  LinkIcon,
  PaperclipIcon,
  PlusIcon,
  PushPinIcon,
  TagIcon,
  TimerIcon,
  TrashIcon,
  UserIcon,
  XIcon,
} from "@phosphor-icons/react";
import { format } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import {
  archiveTask,
  createSubtask,
  deleteTask,
  duplicateTask,
  getTaskDetail,
  getWorkspaceMembers,
  logTime,
  updateTask,
  updateTaskStatus,
} from "@/app/actions/task";
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
import {
  addDependency,
  removeDependency,
  searchTasksForDependency,
} from "@/app/actions/task-dependency";
import {
  addTaskTag,
  createTag,
  getWorkspaceTags,
  removeTaskTag,
} from "@/app/actions/task-tag";
import { TaskActivityFeed } from "@/components/task/task-activity-feed";
import { TaskDescriptionEditor } from "@/components/task/task-description-editor";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ClickUpCalendar } from "@/components/ui/clickup-calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useSetTopbar } from "@/lib/topbar-context";
import { cn } from "@/lib/utils";
import { TaskDetailSkeleton } from "./task-detail-skeleton";

type Priority = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";

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

// ─── Field row (label + value in grid) ───────────────────────────────────────

function FieldRow({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-border/40 last:border-0">
      <div className="flex items-center gap-2 w-36 shrink-0 text-sm text-muted-foreground pt-0.5">
        <span className="shrink-0">{icon}</span>
        {label}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

interface TaskDetailPageProps {
  canPinToList?: boolean;
  listId: string;
  listName: string;
  spaceId: string;
  taskId: string;
  workspaceId: string;
  workspaceName: string;
}

export function TaskDetailPage({
  workspaceId,
  spaceId,
  listId,
  taskId,
  listName,
  workspaceName,
  canPinToList,
}: TaskDetailPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromView = searchParams.get("from");
  const fromSprintId = searchParams.get("sid");

  const contextLabel = fromView === "sprint" ? "Sprint" : listName || "List";
  useSetTopbar({
    breadcrumbs: [{ label: workspaceName }],
    title: contextLabel,
  });
  const [data, setData] = React.useState<Awaited<
    ReturnType<typeof getTaskDetail>
  > | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [titleEditing, setTitleEditing] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState("");
  const [descDraft, setDescDraft] = React.useState("");
  const [members, setMembers] = React.useState<
    { userId: string; name: string; email: string; image: string | null }[]
  >([]);
  const [allTags, setAllTags] = React.useState<
    { id: string; name: string; color: string }[]
  >([]);
  const [tagSearch, setTagSearch] = React.useState("");
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
  const [showDepsSection, setShowDepsSection] = React.useState(false);
  const [subtaskInput, setSubtaskInput] = React.useState("");
  const [attachments, setAttachments] = React.useState<
    {
      id: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
      url: string;
      commentId: string | null;
      uploadedBy: string;
      createdAt: Date;
    }[]
  >([]);
  const [uploadingFile, setUploadingFile] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [creatingSubtask, setCreatingSubtask] = React.useState(false);
  const [isPinned, setIsPinned] = React.useState(false);
  const [statusPopoverOpen, setStatusPopoverOpen] = React.useState(false);
  const [priorityPopoverOpen, setPriorityPopoverOpen] = React.useState(false);
  const [assigneePopoverOpen, setAssigneePopoverOpen] = React.useState(false);
  const [tagPopoverOpen, setTagPopoverOpen] = React.useState(false);
  const [startCalOpen, setStartCalOpen] = React.useState(false);
  const [endCalOpen, setEndCalOpen] = React.useState(false);

  async function fetchAll(showSpinner: boolean) {
    if (showSpinner) {
      setLoading(true);
    }
    const [detail, mem, tags, attRes, pinRes] = await Promise.all([
      getTaskDetail(workspaceId, spaceId, taskId),
      getWorkspaceMembers(workspaceId),
      getWorkspaceTags(workspaceId),
      fetch(`/api/tasks/${taskId}/attachments`)
        .then((r) => r.json())
        .catch(() => ({ attachments: [] })),
      fetch(`/api/tasks/${taskId}/pin`, { method: "GET" })
        .then((r) => (r.ok ? r.json() : { pinned: false }))
        .catch(() => ({ pinned: false })),
    ]);
    setData(detail && !("error" in detail) ? detail : null);
    if (mem && !("error" in mem)) {
      setMembers(
        mem.members
          .filter((m): m is typeof m & { userId: string } => m.userId !== null)
          .map((m) => ({
            userId: m.userId!,
            name: m.name,
            email: m.email,
            image: m.image,
          }))
      );
    }
    if (tags && !("error" in tags)) {
      setAllTags(tags.tags);
    }
    if (attRes?.attachments) {
      setAttachments(attRes.attachments);
    }
    setIsPinned(!!pinRes?.pinned);
    if (showSpinner) {
      setLoading(false);
    }
  }

  async function handleTogglePin() {
    const next = !isPinned;
    setIsPinned(next);
    const res = await fetch(`/api/tasks/${taskId}/pin`, {
      method: next ? "POST" : "DELETE",
    });
    if (!res.ok) {
      setIsPinned(!next);
      const data = await res.json().catch(() => ({}));
      // eslint-disable-next-line no-console
      console.error("Pin toggle failed:", data.error);
    }
  }

  // Initial load shows spinner; subsequent refreshes are silent
  const load = () => fetchAll(false);

  React.useEffect(() => {
    fetchAll(true);
  }, [taskId]);

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

  const listBackUrl =
    fromView === "sprint" && fromSprintId
      ? `/${workspaceId}/${spaceId}/sprint/${fromSprintId}`
      : `/${workspaceId}/${spaceId}/list/${listId}${fromView && fromView !== "sprint" ? `?view=${fromView}` : ""}`;

  if (loading) {
    return <TaskDetailSkeleton />;
  }

  if (!data || "error" in data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Task not found.</p>
        <Button onClick={() => router.push(listBackUrl)} variant="ghost">
          <ArrowLeftIcon className="size-4 mr-2" /> Back to list
        </Button>
      </div>
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
    subtasks,
    parentTask,
    currentUserId,
  } = data;
  const backUrl = t.parentTaskId
    ? `/${workspaceId}/task/${t.parentTaskId}`
    : listBackUrl;
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
  const filteredTags = allTags.filter((t) =>
    t.name.toLowerCase().includes(tagSearch.toLowerCase())
  );
  const exactTagMatch = allTags.some(
    (t) => t.name.toLowerCase() === tagSearch.toLowerCase()
  );

  const dueDateStart = t.dueDateStart ? new Date(t.dueDateStart) : null;
  const dueDateEnd = t.dueDateEnd ? new Date(t.dueDateEnd) : null;

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
    load();
  }

  async function handleStatusChange(statusId: string) {
    setStatusPopoverOpen(false);
    await updateTaskStatus(workspaceId, spaceId, listId, taskId, statusId);
    load();
  }

  async function handlePriorityChange(p: Priority) {
    setPriorityPopoverOpen(false);
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
      setTagSearch("");
      load();
    }
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
    await duplicateTask(workspaceId, spaceId, listId, taskId);
    setSaving(false);
    router.push(backUrl);
  }

  async function handleArchive() {
    await archiveTask(workspaceId, spaceId, listId, taskId);
    router.push(backUrl);
  }

  async function handleDelete() {
    if (!confirm("Permanently delete this task? This cannot be undone.")) {
      return;
    }
    await deleteTask(workspaceId, spaceId, listId, taskId);
    router.push(backUrl);
  }

  function copyLink() {
    navigator.clipboard.writeText(
      `${window.location.origin}/${workspaceId}/task/${taskId}`
    );
  }

  async function handleFileUpload(file: File) {
    setUploadingFile(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/tasks/${taskId}/attachments`, {
      method: "POST",
      body: fd,
    });
    setUploadingFile(false);
    if (res.ok) {
      const { attachment } = await res.json();
      setAttachments((prev) => [...prev, attachment]);
    }
  }

  async function handleDeleteAttachment(attachmentId: string) {
    await fetch(`/api/attachments/${attachmentId}`, { method: "DELETE" });
    setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
  }

  function formatBytes(bytes: number) {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function isImage(mimeType: string) {
    return mimeType.startsWith("image/");
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b px-5 py-3 shrink-0">
        <button
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => router.push(backUrl)}
        >
          <ArrowLeftIcon className="size-4" />
        </button>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <ClipboardTextIcon className="size-4" />
          <span>{listName}</span>
          {parentTask && (
            <>
              <CaretRightIcon className="size-3.5" />
              <button
                className="hover:text-foreground transition-colors truncate max-w-xs"
                onClick={() =>
                  router.push(`/${workspaceId}/task/${parentTask.id}`)
                }
              >
                {parentTask.title}
              </button>
            </>
          )}
          <CaretRightIcon className="size-3.5" />
          <span className="text-foreground font-medium truncate max-w-xs">
            {t.title}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
              isPinned
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
            onClick={handleTogglePin}
            title={isPinned ? "Unpin from sidebar" : "Pin to sidebar"}
          >
            <PushPinIcon
              className="size-3.5"
              weight={isPinned ? "fill" : "regular"}
            />
            {isPinned ? "Pinned" : "Pin"}
          </button>
          <button
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            onClick={copyLink}
          >
            <LinkIcon className="size-3.5" /> Copy link
          </button>
          <button
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
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
              <button className="flex size-7 items-center justify-center rounded-md hover:bg-accent text-muted-foreground">
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
              {canPinToList && listId && (
                <>
                  <Separator className="my-1" />
                  {data?.task.isPinnedToList ? (
                    <button
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                      onClick={async () => {
                        const res = await fetch(
                          `/api/tasks/${taskId}/pin-to-list`,
                          { method: "DELETE" }
                        );
                        if (res.ok) {
                          load();
                        }
                      }}
                    >
                      <PushPinIcon
                        className="size-3.5 text-primary"
                        weight="fill"
                      />{" "}
                      Unpin from list
                    </button>
                  ) : (
                    <button
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                      onClick={async () => {
                        const res = await fetch(
                          `/api/tasks/${taskId}/pin-to-list`,
                          { method: "POST" }
                        );
                        if (res.ok) {
                          load();
                        } else {
                          const d = await res.json().catch(() => ({}));
                          alert(d.error ?? "Failed to pin");
                        }
                      }}
                    >
                      <PushPinIcon className="size-3.5 text-muted-foreground" />{" "}
                      Pin to list top
                    </button>
                  )}
                </>
              )}
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

      {/* Two-column body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Left: main content ── */}
        <div className="flex-1 min-w-0 overflow-y-auto px-8 py-6">
          {/* Title */}
          {titleEditing ? (
            <Input
              autoFocus
              className="text-2xl font-bold h-auto py-1 border-none shadow-none focus-visible:ring-0 px-0 mb-5"
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
            <h1
              className="text-2xl font-bold cursor-text hover:bg-accent/50 rounded px-1 -mx-1 py-1 mb-5 transition-colors"
              onClick={() => setTitleEditing(true)}
            >
              {t.title}
            </h1>
          )}

          {/* Fields grid */}
          <div className="rounded-lg border bg-card px-4 mb-6">
            {/* Status */}
            <FieldRow
              icon={
                <span
                  className="size-3 rounded-full shrink-0"
                  style={{ backgroundColor: currentStatus?.color ?? "#9CA3AF" }}
                />
              }
              label="Status"
            >
              <Popover
                onOpenChange={setStatusPopoverOpen}
                open={statusPopoverOpen}
              >
                <PopoverTrigger asChild>
                  <button
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-semibold transition-colors hover:opacity-80"
                    style={{
                      backgroundColor: `${currentStatus?.color ?? "#9CA3AF"}20`,
                      color: currentStatus?.color ?? "#9CA3AF",
                    }}
                  >
                    {currentStatus?.name ?? "No status"}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-44 p-1">
                  {statuses.map((s) => (
                    <button
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                      key={s.id}
                      onClick={() => handleStatusChange(s.id)}
                    >
                      <span
                        className="size-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: s.color }}
                      />
                      <span className="flex-1 text-left">{s.name}</span>
                      {s.id === t.statusId && (
                        <CheckIcon className="size-3.5 text-primary" />
                      )}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            </FieldRow>

            {/* Assignees */}
            <FieldRow
              icon={<UserIcon className="size-3.5" />}
              label="Assignees"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                {assignees.map((a) => (
                  <div
                    className="flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs"
                    key={a.userId}
                  >
                    <Avatar className="size-4">
                      <AvatarFallback className="text-[8px]">
                        {userInitials(a.name, a.email)}
                      </AvatarFallback>
                    </Avatar>
                    <span>{a.name ?? a.email}</span>
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => handleToggleAssignee(a.userId)}
                    >
                      <XIcon className="size-3" />
                    </button>
                  </div>
                ))}
                <Popover
                  onOpenChange={setAssigneePopoverOpen}
                  open={assigneePopoverOpen}
                >
                  <PopoverTrigger asChild>
                    <button className="flex size-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                      <PlusIcon className="size-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-52 p-2">
                    <p className="text-xs text-muted-foreground px-1 mb-1.5">
                      Select members
                    </p>
                    <div className="space-y-0.5 max-h-48 overflow-y-auto">
                      {members.map((m) => {
                        const selected = assignees.some(
                          (a) => a.userId === m.userId
                        );
                        return (
                          <button
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                            key={m.userId}
                            onClick={() => handleToggleAssignee(m.userId)}
                          >
                            <Avatar className="size-6 shrink-0">
                              <AvatarFallback className="text-2xs">
                                {userInitials(m.name, m.email)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="flex-1 truncate text-left">
                              {m.name}
                            </span>
                            {selected && (
                              <CheckIcon className="size-3.5 text-primary shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </FieldRow>

            {/* Dates */}
            <FieldRow
              icon={<CalendarBlankIcon className="size-3.5" />}
              label="Dates"
            >
              <div className="flex items-center gap-2">
                <Popover onOpenChange={setStartCalOpen} open={startCalOpen}>
                  <PopoverTrigger asChild>
                    <button className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs w-32 hover:bg-accent transition-colors">
                      <CalendarBlankIcon className="size-3 text-muted-foreground shrink-0" />
                      <span
                        className={
                          dueDateStart
                            ? "text-foreground"
                            : "text-muted-foreground"
                        }
                      >
                        {dueDateStart
                          ? format(dueDateStart, "MMM d, yyyy")
                          : "Start date"}
                      </span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-0">
                    <ClickUpCalendar
                      onClose={() => setStartCalOpen(false)}
                      onSelect={(date) => {
                        handleDueDateChange("start", date);
                        setStartCalOpen(false);
                      }}
                      selectedDate={dueDateStart}
                    />
                  </PopoverContent>
                </Popover>
                <span className="text-muted-foreground text-xs">→</span>
                <Popover onOpenChange={setEndCalOpen} open={endCalOpen}>
                  <PopoverTrigger asChild>
                    <button className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs w-32 hover:bg-accent transition-colors">
                      <CalendarBlankIcon className="size-3 text-muted-foreground shrink-0" />
                      <span
                        className={
                          dueDateEnd
                            ? "text-foreground"
                            : "text-muted-foreground"
                        }
                      >
                        {dueDateEnd
                          ? format(dueDateEnd, "MMM d, yyyy")
                          : "End date"}
                      </span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-0">
                    <ClickUpCalendar
                      onClose={() => setEndCalOpen(false)}
                      onSelect={(date) => {
                        handleDueDateChange("end", date);
                        setEndCalOpen(false);
                      }}
                      selectedDate={dueDateEnd}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </FieldRow>

            {/* Priority */}
            <FieldRow icon={<FlagIcon className="size-3.5" />} label="Priority">
              <Popover
                onOpenChange={setPriorityPopoverOpen}
                open={priorityPopoverOpen}
              >
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors hover:opacity-80",
                      priority.bg,
                      priority.color
                    )}
                  >
                    <span>{priority.icon}</span>
                    {priority.label}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-44 p-1">
                  {(
                    Object.entries(PRIORITY_CONFIG) as [
                      Priority,
                      (typeof PRIORITY_CONFIG)[Priority],
                    ][]
                  ).map(([key, cfg]) => (
                    <button
                      className={cn(
                        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent",
                        cfg.color
                      )}
                      key={key}
                      onClick={() => handlePriorityChange(key)}
                    >
                      <span>{cfg.icon}</span>
                      <span className="flex-1 text-left">{cfg.label}</span>
                      {key === t.priority && (
                        <CheckIcon className="size-3.5 shrink-0" />
                      )}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            </FieldRow>

            {/* Tags */}
            <FieldRow icon={<TagIcon className="size-3.5" />} label="Tags">
              <div className="flex flex-wrap items-center gap-1.5">
                {tags.map((tag) => (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                    key={tag.id}
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                    <button
                      className="opacity-60 hover:opacity-100"
                      onClick={() => handleToggleTag(tag.id)}
                    >
                      <XIcon className="size-3" />
                    </button>
                  </span>
                ))}
                <Popover onOpenChange={setTagPopoverOpen} open={tagPopoverOpen}>
                  <PopoverTrigger asChild>
                    <button className="flex size-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                      <PlusIcon className="size-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-52 p-2">
                    <Input
                      autoFocus
                      className="h-7 text-xs mb-2"
                      onChange={(e) => setTagSearch(e.target.value)}
                      placeholder="Search or create…"
                      value={tagSearch}
                    />
                    <div className="space-y-0.5 max-h-40 overflow-y-auto">
                      {filteredTags.map((tag) => {
                        const selected = tags.some((t) => t.id === tag.id);
                        return (
                          <button
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                            key={tag.id}
                            onClick={() => handleToggleTag(tag.id)}
                          >
                            <span
                              className="size-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: tag.color }}
                            />
                            <span className="flex-1 truncate text-left text-xs">
                              {tag.name}
                            </span>
                            {selected && (
                              <CheckIcon className="size-3.5 text-primary shrink-0" />
                            )}
                          </button>
                        );
                      })}
                      {tagSearch && !exactTagMatch && (
                        <button
                          className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-xs text-primary hover:bg-accent"
                          onClick={() => handleCreateTag(tagSearch.trim())}
                        >
                          <PlusIcon className="size-3.5" /> Create &ldquo;
                          {tagSearch}&rdquo;
                        </button>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </FieldRow>

            {/* Time logged */}
            {timeLogs.length > 0 && (
              <FieldRow
                icon={<TimerIcon className="size-3.5" />}
                label="Track time"
              >
                <span className="text-sm font-medium">
                  {Math.floor(
                    timeLogs.reduce((s, l) => s + l.durationMinutes, 0) / 60
                  )}
                  h {timeLogs.reduce((s, l) => s + l.durationMinutes, 0) % 60}m
                </span>
              </FieldRow>
            )}
          </div>

          {/* Subtasks — only shown on parent tasks (not subtask detail pages) */}
          {!t.parentTaskId && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold">Subtasks</h3>
                {subtasks && subtasks.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {subtasks.filter((s) => s.statusType === "CLOSED").length}/
                    {subtasks.length} completed
                  </span>
                )}
              </div>

              {subtasks && subtasks.length > 0 && (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <Progress
                      className="flex-1 h-1.5"
                      value={Math.round(
                        (subtasks.filter((s) => s.statusType === "CLOSED")
                          .length /
                          subtasks.length) *
                          100
                      )}
                    />
                  </div>
                  <div className="space-y-1 mb-3">
                    {subtasks.map((sub) => (
                      <div
                        className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 hover:bg-accent/30 cursor-pointer group"
                        key={sub.id}
                        onClick={() =>
                          router.push(`/${workspaceId}/task/${sub.id}`)
                        }
                      >
                        <span
                          className="size-2.5 rounded-full shrink-0"
                          style={{
                            backgroundColor: sub.statusColor ?? "#9CA3AF",
                          }}
                        />
                        <span className="font-mono text-xs text-muted-foreground shrink-0">
                          #{sub.seqNumber}
                        </span>
                        <span
                          className={cn(
                            "flex-1 text-sm truncate",
                            sub.statusType === "CLOSED" &&
                              "line-through text-muted-foreground"
                          )}
                        >
                          {sub.title}
                        </span>
                        <CaretRightIcon className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="flex gap-2 items-center">
                <Input
                  className="h-8 rounded-lg text-xs"
                  disabled={creatingSubtask}
                  onChange={(e) => setSubtaskInput(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && subtaskInput.trim()) {
                      setCreatingSubtask(true);
                      await createSubtask(
                        workspaceId,
                        spaceId,
                        taskId,
                        subtaskInput.trim()
                      );
                      setSubtaskInput("");
                      setCreatingSubtask(false);
                      load();
                    }
                  }}
                  placeholder="Add subtask…"
                  value={subtaskInput}
                />
                <Button
                  className="h-8 rounded-lg text-xs font-semibold shrink-0 px-3"
                  disabled={creatingSubtask || !subtaskInput.trim()}
                  onClick={async () => {
                    if (!subtaskInput.trim()) {
                      return;
                    }
                    setCreatingSubtask(true);
                    await createSubtask(
                      workspaceId,
                      spaceId,
                      taskId,
                      subtaskInput.trim()
                    );
                    setSubtaskInput("");
                    setCreatingSubtask(false);
                    load();
                  }}
                  size="sm"
                >
                  Add
                </Button>
              </div>
            </div>
          )}

          {/* Description */}
          <div className="mb-6">
            <TaskDescriptionEditor
              onChange={setDescDraft}
              onSave={saveDescription}
              value={descDraft}
            />
          </div>

          {/* Attachments */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <PaperclipIcon className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Attachments</h3>
                {attachments.filter((a) => !a.commentId).length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {attachments.filter((a) => !a.commentId).length} file
                    {attachments.filter((a) => !a.commentId).length === 1
                      ? ""
                      : "s"}
                  </span>
                )}
              </div>
              <button
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground border hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
                disabled={uploadingFile}
                onClick={() => fileInputRef.current?.click()}
              >
                <PlusIcon className="size-3.5" />
                {uploadingFile ? "Uploading…" : "Attach file"}
              </button>
              <input
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    handleFileUpload(file);
                    e.target.value = "";
                  }
                }}
                ref={fileInputRef}
                type="file"
              />
            </div>

            {/* Drop zone */}
            <div
              className="rounded-lg border-2 border-dashed border-border/50 p-4 transition-colors hover:border-primary/30 hover:bg-accent/20 cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
              onDragLeave={(e) => {
                e.currentTarget.classList.remove(
                  "border-primary/60",
                  "bg-accent/30"
                );
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.currentTarget.classList.add(
                  "border-primary/60",
                  "bg-accent/30"
                );
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove(
                  "border-primary/60",
                  "bg-accent/30"
                );
                const file = e.dataTransfer.files[0];
                if (file) {
                  handleFileUpload(file);
                }
              }}
            >
              {attachments.filter((a) => !a.commentId).length === 0 ? (
                <div className="flex flex-col items-center gap-1 py-2 text-muted-foreground">
                  <PaperclipIcon className="size-8 opacity-30" />
                  <p className="text-xs">Drop files here or click to upload</p>
                  <p className="text-2xs opacity-60">Max 10 MB per file</p>
                </div>
              ) : (
                <div
                  className="grid grid-cols-2 gap-2 sm:grid-cols-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  {attachments
                    .filter((a) => !a.commentId)
                    .map((att) => (
                      <div
                        className="group relative rounded-md border bg-card overflow-hidden"
                        key={att.id}
                      >
                        {isImage(att.mimeType) ? (
                          <a
                            href={att.url}
                            rel="noopener noreferrer"
                            target="_blank"
                          >
                            <img
                              alt={att.fileName}
                              className="w-full h-24 object-cover"
                              src={att.url}
                            />
                          </a>
                        ) : (
                          <a
                            className="flex flex-col items-center justify-center gap-2 h-24 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                            download={att.fileName}
                            href={att.url}
                            rel="noopener noreferrer"
                            target="_blank"
                          >
                            {att.mimeType === "application/pdf" ? (
                              <FilePdfIcon className="size-8 text-red-500" />
                            ) : (
                              <FileIcon className="size-8" />
                            )}
                            <DownloadSimpleIcon className="size-3.5 opacity-0 group-hover:opacity-100 absolute top-2 right-8 transition-opacity" />
                          </a>
                        )}
                        <div className="px-2 py-1.5 border-t">
                          <p className="text-xs truncate font-medium">
                            {att.fileName}
                          </p>
                          <p className="text-2xs text-muted-foreground">
                            {formatBytes(att.fileSize)}
                          </p>
                        </div>
                        <button
                          className="absolute top-1.5 right-1.5 size-6 inline-flex items-center justify-center leading-none rounded-full bg-black/70 text-white hover:bg-red-500 opacity-0 group-hover:opacity-100 transition-all"
                          onClick={() => handleDeleteAttachment(att.id)}
                        >
                          <XIcon className="size-3.5 shrink-0" weight="bold" />
                        </button>
                      </div>
                    ))}
                  <button
                    className="flex flex-col items-center justify-center h-full min-h-24 rounded-md border-2 border-dashed border-border/50 text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors disabled:opacity-50"
                    disabled={uploadingFile}
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    <PlusIcon className="size-5" />
                    <span className="text-2xs mt-1">
                      {uploadingFile ? "Uploading…" : "Add file"}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <Separator className="mb-6" />

          {/* Checklists */}
          {checklists.length > 0 && (
            <div className="space-y-5 mb-6">
              {totalItems > 0 && (
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-xs text-muted-foreground w-8 text-right">
                    {checkProgress}%
                  </span>
                  <Progress className="flex-1 h-1.5" value={checkProgress} />
                </div>
              )}
              {checklists.map((cl) => (
                <div key={cl.id}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-semibold text-sm flex-1">
                      {cl.name}
                    </span>
                    <button
                      className="text-muted-foreground hover:text-destructive"
                      onClick={async () => {
                        await deleteChecklist(
                          workspaceId,
                          spaceId,
                          listId,
                          cl.id
                        );
                        load();
                      }}
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  </div>
                  <div className="space-y-1 mb-2">
                    {cl.items.map((item) => (
                      <div
                        className="flex items-center gap-2 rounded-md py-1 px-1 hover:bg-accent/30 group"
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
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                          onClick={async () => {
                            await deleteChecklistItem(
                              workspaceId,
                              spaceId,
                              listId,
                              item.id
                            );
                            load();
                          }}
                        >
                          <XIcon className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      className="h-7 rounded-lg text-xs"
                      onChange={(e) =>
                        setNewItemTexts((prev) => ({
                          ...prev,
                          [cl.id]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleAddItem(cl.id);
                        }
                      }}
                      placeholder="Add item…"
                      value={newItemTexts[cl.id] ?? ""}
                    />
                    <Button
                      className="h-7 rounded-lg px-3 text-xs font-semibold"
                      onClick={() => handleAddItem(cl.id)}
                      size="sm"
                    >
                      Add
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Dependencies */}
          {(showDepsSection || dependencies.length > 0) && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold mb-3">Dependencies</h3>
              {dependencies.length > 0 && (
                <div className="space-y-1 mb-3">
                  {dependencies.map((dep) => (
                    <div
                      className="flex items-center gap-2 rounded-md border bg-card px-3 py-2"
                      key={dep.id}
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        #{dep.dependsOnSeq}
                      </span>
                      <span className="flex-1 text-sm truncate">
                        {dep.dependsOnTitle}
                      </span>
                      <button
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemoveDep(dep.dependsOnTaskId)}
                      >
                        <XIcon className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="relative">
                <Input
                  className="h-8 rounded-lg text-xs"
                  onChange={(e) => handleDepSearch(e.target.value)}
                  placeholder="Search task to depend on…"
                  value={depQuery}
                />
                {depResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
                    {depResults.map((r) => (
                      <button
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                        key={r.id}
                        onClick={() => handleAddDep(r.id)}
                      >
                        <span className="font-mono text-xs text-muted-foreground">
                          #{r.seqNumber}
                        </span>
                        <span className="truncate">{r.title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            {addingChecklist ? (
              <div className="flex gap-2 items-center">
                <Input
                  autoFocus
                  className="h-7 rounded-lg text-xs w-44"
                  onChange={(e) => setNewChecklistName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
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
                  className="h-7 rounded-lg px-3 text-xs font-semibold"
                  onClick={handleAddChecklist}
                  size="sm"
                >
                  Add
                </Button>
                <Button
                  className="h-7 rounded-lg text-xs"
                  onClick={() => setAddingChecklist(false)}
                  size="sm"
                  variant="ghost"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                className="h-8 rounded-lg text-xs font-semibold"
                onClick={() => setAddingChecklist(true)}
                size="sm"
                variant="outline"
              >
                <PlusIcon className="size-3.5 mr-1.5" /> Create checklist
              </Button>
            )}

            {!showDepsSection && dependencies.length === 0 && (
              <Button
                className="h-8 rounded-lg text-xs font-semibold"
                onClick={() => setShowDepsSection(true)}
                size="sm"
                variant="outline"
              >
                <PlusIcon className="size-3.5 mr-1.5" /> Relate items or add
                dependencies
              </Button>
            )}
          </div>

          {/* Time logging */}
          <div className="mt-6 pt-6 border-t">
            <h3 className="text-sm font-semibold mb-3">Log time</h3>
            <div className="flex gap-3 items-end">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">Minutes</label>
                <Input
                  className="h-8 rounded-lg text-xs w-24"
                  min="1"
                  onChange={(e) => setTimeInput(e.target.value)}
                  placeholder="30"
                  type="number"
                  value={timeInput}
                />
              </div>
              <div className="flex-1 flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">
                  Note (optional)
                </label>
                <Input
                  className="h-8 rounded-lg text-xs"
                  onChange={(e) => setTimeNote(e.target.value)}
                  placeholder="What did you work on?"
                  value={timeNote}
                />
              </div>
              <Button
                className="h-8 rounded-lg px-3 text-xs font-semibold shrink-0"
                onClick={handleLogTime}
                size="sm"
              >
                Log
              </Button>
            </div>
          </div>
        </div>

        {/* ── Right: comments + activity ── */}
        <div className="w-80 xl:w-96 shrink-0 border-l flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <TaskActivityFeed
              currentUserId={currentUserId}
              listId={listId}
              spaceId={spaceId}
              taskId={taskId}
              workspaceId={workspaceId}
            />
          </div>

          {/* Task seq footer */}
          <div className="border-t px-5 py-3 shrink-0">
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">#{t.seqNumber}</span> · Created{" "}
              {format(new Date(t.createdAt), "MMM d, yyyy")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
