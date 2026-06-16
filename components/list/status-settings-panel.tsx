"use client";

import * as React from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
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
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const COLOR_OPTIONS = [
  "#6B7280", "#EF4444", "#F97316", "#EAB308",
  "#22C55E", "#14B8A6", "#3B82F6", "#8B5CF6",
  "#EC4899", "#F43F5E",
];

type StatusType = "OPEN" | "ACTIVE" | "CLOSED";

interface Status {
  id: string;
  name: string;
  color: string;
  type: StatusType;
  orderIndex: number;
}

interface StatusSettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  spaceId: string;
  listId: string;
  statuses: Status[];
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

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COLOR_OPTIONS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className="h-5 w-5 rounded-full focus:outline-none"
          style={{
            backgroundColor: c,
            boxShadow: value === c ? `0 0 0 2px white, 0 0 0 3px ${c}` : undefined,
          }}
        />
      ))}
    </div>
  );
}

interface EditRowProps {
  status: Status;
  workspaceId: string;
  spaceId: string;
  listId: string;
  onDone: () => void;
}

function EditRow({ status, workspaceId, spaceId, listId, onDone }: EditRowProps) {
  const [name, setName] = React.useState(status.name);
  const [color, setColor] = React.useState(status.color);
  const [type, setType] = React.useState<StatusType>(status.type);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  async function save() {
    if (!name.trim()) { setError("Name required"); return; }
    setLoading(true);
    const res = await updateListStatus(workspaceId, spaceId, listId, status.id, {
      name: name.trim(), color, type,
    });
    setLoading(false);
    if ("error" in res) { setError(res.error); return; }
    onDone();
  }

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 text-sm flex-1"
          autoFocus
          disabled={loading}
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as StatusType)}
          className="h-8 rounded-md border bg-background px-2 text-xs"
          disabled={loading}
        >
          <option value="OPEN">Open</option>
          <option value="ACTIVE">Active</option>
          <option value="CLOSED">Closed</option>
        </select>
      </div>
      <ColorPicker value={color} onChange={setColor} />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={loading || !name.trim()}>
          {loading ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone} disabled={loading}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

interface AddRowProps {
  workspaceId: string;
  spaceId: string;
  listId: string;
  onDone: () => void;
}

function AddRow({ workspaceId, spaceId, listId, onDone }: AddRowProps) {
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState(COLOR_OPTIONS[6]);
  const [type, setType] = React.useState<StatusType>("OPEN");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  async function save() {
    if (!name.trim()) { setError("Name required"); return; }
    setLoading(true);
    const res = await createListStatus(workspaceId, spaceId, listId, {
      name: name.trim(), color, type,
    });
    setLoading(false);
    if ("error" in res) { setError(res.error); return; }
    onDone();
  }

  return (
    <div className="rounded-lg border border-dashed p-3 space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="Status name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 text-sm flex-1"
          autoFocus
          disabled={loading}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as StatusType)}
          className="h-8 rounded-md border bg-background px-2 text-xs"
          disabled={loading}
        >
          <option value="OPEN">Open</option>
          <option value="ACTIVE">Active</option>
          <option value="CLOSED">Closed</option>
        </select>
      </div>
      <ColorPicker value={color} onChange={setColor} />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={loading || !name.trim()}>
          {loading ? "Adding…" : "Add Status"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone} disabled={loading}>
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
    if ("error" in res) { setDeleteError(res.error); return; }
    setStatuses((prev) => prev.filter((s) => s.id !== statusId));
  }

  async function handleMove(index: number, direction: -1 | 1) {
    const next = [...statuses];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setStatuses(next);
    await reorderListStatuses(workspaceId, spaceId, listId, next.map((s) => s.id));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Manage Statuses</DialogTitle>
        </DialogHeader>

        <div className="space-y-2 py-2 max-h-[60vh] overflow-y-auto pr-1">
          {statuses.map((status, i) =>
            editingId === status.id ? (
              <EditRow
                key={status.id}
                status={status}
                workspaceId={workspaceId}
                spaceId={spaceId}
                listId={listId}
                onDone={() => setEditingId(null)}
              />
            ) : (
              <div
                key={status.id}
                className="group flex items-center gap-2 rounded-lg border px-3 py-2"
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: status.color }}
                />
                <span className="flex-1 text-sm font-medium">{status.name}</span>
                <span className={cn("text-xs", TYPE_COLORS[status.type])}>
                  {TYPE_LABELS[status.type]}
                </span>

                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleMove(i, -1)}
                    disabled={i === 0}
                    className="flex size-6 items-center justify-center rounded hover:bg-accent disabled:opacity-30"
                    title="Move up"
                  >
                    <ArrowUpIcon className="size-3" />
                  </button>
                  <button
                    onClick={() => handleMove(i, 1)}
                    disabled={i === statuses.length - 1}
                    className="flex size-6 items-center justify-center rounded hover:bg-accent disabled:opacity-30"
                    title="Move down"
                  >
                    <ArrowDownIcon className="size-3" />
                  </button>
                  <button
                    onClick={() => { setEditingId(status.id); setAdding(false); }}
                    className="flex size-6 items-center justify-center rounded hover:bg-accent"
                    title="Edit"
                  >
                    <PencilSimpleIcon className="size-3" />
                  </button>
                  <button
                    onClick={() => handleDelete(status.id)}
                    className="flex size-6 items-center justify-center rounded hover:bg-destructive/10 text-destructive"
                    title="Delete"
                  >
                    <TrashIcon className="size-3" />
                  </button>
                </div>
              </div>
            ),
          )}

          {adding ? (
            <AddRow
              workspaceId={workspaceId}
              spaceId={spaceId}
              listId={listId}
              onDone={() => setAdding(false)}
            />
          ) : (
            <button
              onClick={() => { setAdding(true); setEditingId(null); }}
              className="flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground transition-colors"
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
