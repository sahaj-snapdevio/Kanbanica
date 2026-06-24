"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import * as React from "react";
import {
  createListStatus,
  deleteListStatus,
  reorderListStatuses,
  updateListStatus,
} from "@/app/actions/list";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const COLOR_OPTIONS = [
  "#6B7280",
  "#EF4444",
  "#F97316",
  "#EAB308",
  "#22C55E",
  "#14B8A6",
  "#3B82F6",
  "#8B5CF6",
  "#EC4899",
  "#F43F5E",
];

type StatusType = "OPEN" | "ACTIVE" | "CLOSED";

interface Status {
  color: string;
  id: string;
  name: string;
  orderIndex: number;
  type: StatusType;
}

interface StatusSettingsPanelProps {
  listId: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  spaceId: string;
  statuses: Status[];
  workspaceId: string;
}

const TYPE_LABELS: Record<StatusType, string> = {
  OPEN: "Open",
  ACTIVE: "Active",
  CLOSED: "Closed",
};

const TYPE_COLORS: Record<StatusType, string> = {
  OPEN: "text-muted-foreground",
  ACTIVE: "text-blue-500",
  CLOSED: "text-green-600",
};

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COLOR_OPTIONS.map((c) => (
        <button
          className="h-5 w-5 rounded-full focus:outline-none"
          key={c}
          onClick={() => onChange(c)}
          style={{
            backgroundColor: c,
            boxShadow:
              value === c ? `0 0 0 2px white, 0 0 0 3px ${c}` : undefined,
          }}
          type="button"
        />
      ))}
    </div>
  );
}

interface EditRowProps {
  listId: string;
  onDone: () => void;
  spaceId: string;
  status: Status;
  workspaceId: string;
}

function EditRow({
  status,
  workspaceId,
  spaceId,
  listId,
  onDone,
}: EditRowProps) {
  const [name, setName] = React.useState(status.name);
  const [color, setColor] = React.useState(status.color);
  const [type, setType] = React.useState<StatusType>(status.type);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  async function save() {
    if (!name.trim()) {
      setError("Name required");
      return;
    }
    setLoading(true);
    const res = await updateListStatus(
      workspaceId,
      spaceId,
      listId,
      status.id,
      {
        name: name.trim(),
        color,
        type,
      }
    );
    setLoading(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    onDone();
  }

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
      <div className="flex gap-2">
        <Input
          autoFocus
          className="h-8 text-sm flex-1"
          disabled={loading}
          onChange={(e) => setName(e.target.value)}
          value={name}
        />
        <select
          className="h-8 rounded-md border bg-background px-2 text-xs"
          disabled={loading}
          onChange={(e) => setType(e.target.value as StatusType)}
          value={type}
        >
          <option value="OPEN">Open</option>
          <option value="ACTIVE">Active</option>
          <option value="CLOSED">Closed</option>
        </select>
      </div>
      <ColorPicker onChange={setColor} value={color} />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button disabled={loading || !name.trim()} onClick={save} size="sm">
          {loading ? "Saving…" : "Save"}
        </Button>
        <Button disabled={loading} onClick={onDone} size="sm" variant="ghost">
          Cancel
        </Button>
      </div>
    </div>
  );
}

interface AddRowProps {
  listId: string;
  onDone: () => void;
  spaceId: string;
  workspaceId: string;
}

function AddRow({ workspaceId, spaceId, listId, onDone }: AddRowProps) {
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState(COLOR_OPTIONS[6]);
  const [type, setType] = React.useState<StatusType>("OPEN");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  async function save() {
    if (!name.trim()) {
      setError("Name required");
      return;
    }
    setLoading(true);
    const res = await createListStatus(workspaceId, spaceId, listId, {
      name: name.trim(),
      color,
      type,
    });
    setLoading(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    onDone();
  }

  return (
    <div className="rounded-lg border border-dashed p-3 space-y-3">
      <div className="flex gap-2">
        <Input
          autoFocus
          className="h-8 text-sm flex-1"
          disabled={loading}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
          placeholder="Status name"
          value={name}
        />
        <select
          className="h-8 rounded-md border bg-background px-2 text-xs"
          disabled={loading}
          onChange={(e) => setType(e.target.value as StatusType)}
          value={type}
        >
          <option value="OPEN">Open</option>
          <option value="ACTIVE">Active</option>
          <option value="CLOSED">Closed</option>
        </select>
      </div>
      <ColorPicker onChange={setColor} value={color} />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button disabled={loading || !name.trim()} onClick={save} size="sm">
          {loading ? "Adding…" : "Add Status"}
        </Button>
        <Button disabled={loading} onClick={onDone} size="sm" variant="ghost">
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function StatusSettingsPanel({
  open,
  onOpenChange,
  workspaceId,
  spaceId,
  listId,
  statuses: initialStatuses,
}: StatusSettingsPanelProps) {
  const [statuses, setStatuses] = React.useState(initialStatuses);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState("");

  // Keep local list in sync when parent re-renders (after server revalidation)
  React.useEffect(() => {
    setStatuses(initialStatuses);
  }, [initialStatuses]);

  async function handleDelete(statusId: string) {
    setDeleteError("");
    const res = await deleteListStatus(workspaceId, spaceId, listId, statusId);
    if ("error" in res) {
      setDeleteError(res.error);
      return;
    }
    setStatuses((prev) => prev.filter((s) => s.id !== statusId));
  }

  async function handleMove(index: number, direction: -1 | 1) {
    const next = [...statuses];
    const target = index + direction;
    if (target < 0 || target >= next.length) {
      return;
    }
    [next[index], next[target]] = [next[target], next[index]];
    setStatuses(next);
    await reorderListStatuses(
      workspaceId,
      spaceId,
      listId,
      next.map((s) => s.id)
    );
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage Statuses</DialogTitle>
        </DialogHeader>

        <div className="space-y-2 py-2 max-h-[60vh] overflow-y-auto pr-1">
          {statuses.map((status, i) =>
            editingId === status.id ? (
              <EditRow
                key={status.id}
                listId={listId}
                onDone={() => setEditingId(null)}
                spaceId={spaceId}
                status={status}
                workspaceId={workspaceId}
              />
            ) : (
              <div
                className="group flex items-center gap-2 rounded-lg border px-3 py-2"
                key={status.id}
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: status.color }}
                />
                <span className="flex-1 text-sm font-medium">
                  {status.name}
                </span>
                <span className={cn("text-xs", TYPE_COLORS[status.type])}>
                  {TYPE_LABELS[status.type]}
                </span>

                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    className="flex size-6 items-center justify-center rounded hover:bg-accent disabled:opacity-30"
                    disabled={i === 0}
                    onClick={() => handleMove(i, -1)}
                    title="Move up"
                  >
                    <ArrowUpIcon className="size-3" />
                  </button>
                  <button
                    className="flex size-6 items-center justify-center rounded hover:bg-accent disabled:opacity-30"
                    disabled={i === statuses.length - 1}
                    onClick={() => handleMove(i, 1)}
                    title="Move down"
                  >
                    <ArrowDownIcon className="size-3" />
                  </button>
                  <button
                    className="flex size-6 items-center justify-center rounded hover:bg-accent"
                    onClick={() => {
                      setEditingId(status.id);
                      setAdding(false);
                    }}
                    title="Edit"
                  >
                    <PencilSimpleIcon className="size-3" />
                  </button>
                  <button
                    className="flex size-6 items-center justify-center rounded hover:bg-destructive/10 text-destructive"
                    onClick={() => handleDelete(status.id)}
                    title="Delete"
                  >
                    <TrashIcon className="size-3" />
                  </button>
                </div>
              </div>
            )
          )}

          {adding ? (
            <AddRow
              listId={listId}
              onDone={() => setAdding(false)}
              spaceId={spaceId}
              workspaceId={workspaceId}
            />
          ) : (
            <button
              className="flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground transition-colors"
              onClick={() => {
                setAdding(true);
                setEditingId(null);
              }}
            >
              <PlusIcon className="size-4" />
              Add status
            </button>
          )}

          {deleteError && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span className="flex-1">{deleteError}</span>
              <button onClick={() => setDeleteError("")}>
                <XIcon className="size-4" />
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
