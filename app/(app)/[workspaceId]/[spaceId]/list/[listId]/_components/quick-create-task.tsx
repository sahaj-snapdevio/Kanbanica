"use client";

import * as React from "react";
import { PlusIcon } from "@phosphor-icons/react";
import { createTask } from "@/app/actions/task";

interface QuickCreateTaskProps {
  workspaceId: string;
  spaceId: string;
  listId: string;
  statusId?: string;
  placeholder?: string;
  className?: string;
}

export function QuickCreateTask({
  workspaceId,
  spaceId,
  listId,
  statusId,
  placeholder = "Add task…",
  className,
}: QuickCreateTaskProps) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function show() {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function close() {
    setOpen(false);
    setTitle("");
  }

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) { close(); return; }
    setLoading(true);
    await createTask(workspaceId, spaceId, listId, { title: trimmed, statusId });
    setLoading(false);
    setTitle("");
    inputRef.current?.focus();
  }

  if (!open) {
    return (
      <button
        onClick={show}
        className={`flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-muted-foreground text-sm transition-colors hover:border-border hover:bg-accent hover:text-foreground w-full ${className ?? ""}`}
      >
        <PlusIcon className="size-4 shrink-0" />
        {placeholder}
      </button>
    );
  }

  return (
    <div className={`rounded-lg border bg-background px-3 py-2 shadow-sm ${className ?? ""}`}>
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        disabled={loading}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); submit(); }
          if (e.key === "Escape") { close(); }
        }}
        onBlur={() => { if (!title.trim()) close(); }}
      />
      <p className="mt-1 text-xs text-muted-foreground">
        Enter to save · Esc to cancel
      </p>
    </div>
  );
}
