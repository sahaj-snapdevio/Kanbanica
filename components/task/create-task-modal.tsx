"use client";

import * as React from "react";
import {
  CalendarBlankIcon,
  CheckIcon,
  FlagIcon,
  PaperclipIcon,
  PlusIcon,
  TagIcon,
  UserIcon,
  XIcon,
} from "@phosphor-icons/react";
import { createTask } from "@/app/actions/task";
import { getWorkspaceMembers } from "@/app/actions/task";
import { getWorkspaceTags, createTag } from "@/app/actions/task-tag";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

type Priority = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";

interface Status {
  id: string;
  name: string;
  color: string;
  type: "OPEN" | "ACTIVE" | "CLOSED";
}

interface CreateTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  spaceId: string;
  listId: string;
  statuses: Status[];
  defaultStatusId?: string;
  onCreated?: (taskId: string) => void;
}

const PRIORITY_OPTIONS: { value: Priority; label: string; color: string; dot: string }[] = [
  { value: "NONE", label: "No priority", color: "text-muted-foreground", dot: "bg-muted-foreground/40" },
  { value: "LOW", label: "Low", color: "text-blue-500", dot: "bg-blue-500" },
  { value: "MEDIUM", label: "Medium", color: "text-yellow-500", dot: "bg-yellow-500" },
  { value: "HIGH", label: "High", color: "text-orange-500", dot: "bg-orange-500" },
  { value: "URGENT", label: "Urgent", color: "text-red-500", dot: "bg-red-500" },
];

function userInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

export function CreateTaskModal({
  open,
  onOpenChange,
  workspaceId,
  spaceId,
  listId,
  statuses,
  defaultStatusId,
  onCreated,
}: CreateTaskModalProps) {
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [statusId, setStatusId] = React.useState(defaultStatusId ?? statuses[0]?.id ?? "");
  const [priority, setPriority] = React.useState<Priority>("NONE");
  const [dueDate, setDueDate] = React.useState("");
  const [assigneeIds, setAssigneeIds] = React.useState<string[]>([]);
  const [tagIds, setTagIds] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [statusPopoverOpen, setStatusPopoverOpen] = React.useState(false);
  const [assigneePopoverOpen, setAssigneePopoverOpen] = React.useState(false);
  const [dueDatePopoverOpen, setDueDatePopoverOpen] = React.useState(false);
  const [priorityPopoverOpen, setPriorityPopoverOpen] = React.useState(false);
  const [tagPopoverOpen, setTagPopoverOpen] = React.useState(false);

  const [members, setMembers] = React.useState<{ userId: string; name: string; image: string | null }[]>([]);
  const [allTags, setAllTags] = React.useState<{ id: string; name: string; color: string }[]>([]);
  const [tagSearch, setTagSearch] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setStatusId(defaultStatusId ?? statuses[0]?.id ?? "");
      setTitle("");
      setDescription("");
      setPriority("NONE");
      setDueDate("");
      setAssigneeIds([]);
      setTagIds([]);
      setError("");

      Promise.all([getWorkspaceMembers(workspaceId), getWorkspaceTags(workspaceId)]).then(
        ([mem, tags]) => {
          if (mem && !("error" in mem)) {
            setMembers(
              mem.members
                .filter((m): m is typeof m & { userId: string } => m.userId !== null)
                .map((m) => ({ userId: m.userId!, name: m.name, image: m.image })),
            );
          }
          if (tags && !("error" in tags)) setAllTags(tags.tags);
        },
      );
    }
  }, [open, defaultStatusId]);

  async function handleSubmit() {
    if (!title.trim()) { setError("Task name is required"); return; }
    setLoading(true);
    setError("");
    const res = await createTask(workspaceId, spaceId, listId, { title: title.trim(), statusId });
    setLoading(false);
    if ("error" in res) { setError(res.error); return; }
    onCreated?.(res.taskId);
    onOpenChange(false);
  }

  const currentStatus = statuses.find((s) => s.id === statusId);
  const currentPriority = PRIORITY_OPTIONS.find((p) => p.value === priority)!;
  const selectedMembers = members.filter((m) => assigneeIds.includes(m.userId));
  const selectedTags = allTags.filter((t) => tagIds.includes(t.id));
  const filteredTags = allTags.filter((t) => t.name.toLowerCase().includes(tagSearch.toLowerCase()));
  const exactTagMatch = allTags.some((t) => t.name.toLowerCase() === tagSearch.toLowerCase());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden" aria-describedby={undefined}>
        <DialogHeader className="sr-only">
          <span>Create Task</span>
        </DialogHeader>

        {/* Top bar: status tabs (Task / Doc / etc simplified) */}
        <div className="flex items-center gap-1 border-b px-5 pt-3 pb-0">
          <button className="border-b-2 border-primary pb-2 px-1 text-sm font-medium text-foreground">
            Task
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-3">
          {/* Title */}
          <input
            autoFocus
            placeholder="Task Name"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
            className="w-full text-xl font-semibold bg-transparent outline-none placeholder:text-muted-foreground/40"
          />

          {/* Description */}
          <Textarea
            placeholder="Add description, or write with ✦ AI"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="resize-none border-none shadow-none focus-visible:ring-0 text-sm px-0 text-muted-foreground placeholder:text-muted-foreground/40"
          />

          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* Quick fields row */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {/* Status */}
            <Popover open={statusPopoverOpen} onOpenChange={setStatusPopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-accent"
                  style={{ borderColor: currentStatus?.color, color: currentStatus?.color }}
                >
                  {currentStatus?.name ?? "Status"}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-44 p-1" align="start">
                {statuses.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => { setStatusId(s.id); setStatusPopoverOpen(false); }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="flex-1 text-left">{s.name}</span>
                    {s.id === statusId && <CheckIcon className="size-3.5 text-primary" />}
                  </button>
                ))}
              </PopoverContent>
            </Popover>

            {/* Assignee */}
            <Popover open={assigneePopoverOpen} onOpenChange={setAssigneePopoverOpen}>
              <PopoverTrigger asChild>
                <button className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                  {selectedMembers.length > 0 ? (
                    <>
                      <div className="flex -space-x-1">
                        {selectedMembers.slice(0, 2).map((m) => (
                          <Avatar key={m.userId} className="size-4 border border-background">
                            <AvatarFallback className="text-[8px]">{userInitials(m.name)}</AvatarFallback>
                          </Avatar>
                        ))}
                      </div>
                      <span>{selectedMembers.length === 1 ? selectedMembers[0].name.split(" ")[0] : `${selectedMembers.length} assignees`}</span>
                    </>
                  ) : (
                    <>
                      <UserIcon className="size-3.5" />
                      Assignee
                    </>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-52 p-2" align="start">
                <p className="text-xs text-muted-foreground px-1 mb-1.5">Select members</p>
                <div className="space-y-0.5 max-h-48 overflow-y-auto">
                  {members.map((m) => {
                    const selected = assigneeIds.includes(m.userId);
                    return (
                      <button
                        key={m.userId}
                        onClick={() => setAssigneeIds((prev) => selected ? prev.filter((id) => id !== m.userId) : [...prev, m.userId])}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                      >
                        <Avatar className="size-6 shrink-0">
                          <AvatarFallback className="text-[10px]">{userInitials(m.name)}</AvatarFallback>
                        </Avatar>
                        <span className="flex-1 truncate text-left">{m.name}</span>
                        {selected && <CheckIcon className="size-3.5 text-primary shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>

            {/* Due date */}
            <Popover open={dueDatePopoverOpen} onOpenChange={setDueDatePopoverOpen}>
              <PopoverTrigger asChild>
                <button className={cn("flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs hover:bg-accent transition-colors", dueDate ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                  <CalendarBlankIcon className="size-3.5" />
                  {dueDate ? format(new Date(dueDate), "MMM d") : "Due date"}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-3" align="start">
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Due date</p>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => { setDueDate(e.target.value); setDueDatePopoverOpen(false); }}
                    className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                  />
                  {dueDate && (
                    <Button size="sm" variant="ghost" className="w-full h-7 text-xs" onClick={() => { setDueDate(""); setDueDatePopoverOpen(false); }}>
                      Clear
                    </Button>
                  )}
                </div>
              </PopoverContent>
            </Popover>

            {/* Priority */}
            <Popover open={priorityPopoverOpen} onOpenChange={setPriorityPopoverOpen}>
              <PopoverTrigger asChild>
                <button className={cn("flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-accent", currentPriority.color)}>
                  <FlagIcon className="size-3.5" weight={priority !== "NONE" ? "fill" : "regular"} />
                  {priority !== "NONE" ? currentPriority.label : "Priority"}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-40 p-1" align="start">
                {PRIORITY_OPTIONS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => { setPriority(p.value); setPriorityPopoverOpen(false); }}
                    className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent", p.color)}
                  >
                    <span className={cn("size-2 rounded-full shrink-0", p.dot)} />
                    <span className="flex-1 text-left">{p.label}</span>
                    {p.value === priority && <CheckIcon className="size-3.5 shrink-0" />}
                  </button>
                ))}
              </PopoverContent>
            </Popover>

            {/* Tags */}
            <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
              <PopoverTrigger asChild>
                <button className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                  <TagIcon className="size-3.5" />
                  {selectedTags.length > 0 ? (
                    <span>{selectedTags.map((t) => t.name).join(", ")}</span>
                  ) : (
                    "Tags"
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-52 p-2" align="start">
                <Input
                  autoFocus
                  placeholder="Search or create tag…"
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                  className="h-7 text-xs mb-2"
                />
                <div className="space-y-0.5 max-h-40 overflow-y-auto">
                  {filteredTags.map((t) => {
                    const selected = tagIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        onClick={() => setTagIds((prev) => selected ? prev.filter((id) => id !== t.id) : [...prev, t.id])}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                      >
                        <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                        <span className="flex-1 truncate text-left text-xs">{t.name}</span>
                        {selected && <CheckIcon className="size-3.5 text-primary shrink-0" />}
                      </button>
                    );
                  })}
                  {tagSearch && !exactTagMatch && (
                    <button
                      onClick={async () => {
                        const res = await createTag(workspaceId, tagSearch.trim());
                        if ("tag" in res) {
                          setAllTags((prev) => [...prev, res.tag]);
                          setTagIds((prev) => [...prev, res.tag.id]);
                          setTagSearch("");
                        }
                      }}
                      className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-xs text-primary hover:bg-accent"
                    >
                      <PlusIcon className="size-3.5" />
                      Create &ldquo;{tagSearch}&rdquo;
                    </button>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t px-6 py-3 bg-muted/30">
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <PaperclipIcon className="size-3.5" />
              Templates
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              onClick={handleSubmit}
              disabled={loading || !title.trim()}
              className="h-8 text-sm"
            >
              {loading ? "Creating…" : "Create Task"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
