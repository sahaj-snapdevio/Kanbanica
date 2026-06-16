"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createList } from "@/app/actions/list";
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

const COLOR_PALETTE = [
  "#6B7280", "#EF4444", "#F97316", "#EAB308",
  "#22C55E", "#14B8A6", "#3B82F6", "#8B5CF6",
  "#EC4899", "#F43F5E",
];

interface CreateListModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  spaceId: string;
}

export function CreateListModal({
  open,
  onOpenChange,
  workspaceId,
  spaceId,
}: CreateListModalProps) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState(COLOR_PALETTE[5]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  function reset() {
    setName("");
    setColor(COLOR_PALETTE[5]);
    setError("");
  }

  function handleOpenChange(val: boolean) {
    if (!val) reset();
    onOpenChange(val);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("List name is required"); return; }

    setLoading(true);
    setError("");

    const result = await createList(workspaceId, spaceId, { name: name.trim(), color });

    setLoading(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }

    handleOpenChange(false);
    router.push(`/${workspaceId}/${spaceId}/list/${result.listId}`);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Create List</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="list-name">Name</Label>
            <Input
              id="list-name"
              placeholder="e.g. Backlog, Sprint 1, Bug Reports"
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
                  className="h-6 w-6 rounded-full ring-offset-2 transition-all focus:outline-none"
                  style={{
                    backgroundColor: c,
                    boxShadow: color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : undefined,
                  }}
                />
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading ? "Creating…" : "Create List"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
