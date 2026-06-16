"use client";

import * as React from "react";
import { updateList } from "@/app/actions/list";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const COLOR_PALETTE = [
  "#6B7280", "#EF4444", "#F97316", "#EAB308",
  "#22C55E", "#14B8A6", "#3B82F6", "#8B5CF6",
  "#EC4899", "#F43F5E",
];

interface EditListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  spaceId: string;
  list: {
    id: string;
    name: string;
    color: string | null;
    description: string | null;
  };
}

export function EditListDialog({
  open,
  onOpenChange,
  workspaceId,
  spaceId,
  list,
}: EditListDialogProps) {
  const [name, setName] = React.useState(list.name);
  const [color, setColor] = React.useState(list.color ?? COLOR_PALETTE[5]);
  const [description, setDescription] = React.useState(list.description ?? "");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  // Sync when dialog re-opens with different list data
  React.useEffect(() => {
    if (open) {
      setName(list.name);
      setColor(list.color ?? COLOR_PALETTE[5]);
      setDescription(list.description ?? "");
      setError("");
    }
  }, [open, list]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("List name is required"); return; }

    setLoading(true);
    setError("");

    const result = await updateList(workspaceId, spaceId, list.id, {
      name: name.trim(),
      color: color || null,
      description: description.trim() || null,
    });

    setLoading(false);
    if ("error" in result) { setError(result.error); return; }

    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Edit List</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-list-name">Name</Label>
            <Input
              id="edit-list-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              disabled={loading}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="h-6 w-6 rounded-full focus:outline-none"
                  style={{
                    backgroundColor: c,
                    boxShadow: color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : undefined,
                  }}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-list-description">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea
              id="edit-list-description"
              placeholder="What is this list for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              disabled={loading}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
