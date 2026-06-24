"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
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

interface CreateListModalProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  spaceId: string;
  workspaceId: string;
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
    if (!val) {
      reset();
    }
    onOpenChange(val);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("List name is required");
      return;
    }

    setLoading(true);
    setError("");

    const result = await createList(workspaceId, spaceId, {
      name: name.trim(),
      color,
    });

    setLoading(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }

    handleOpenChange(false);
    router.push(`/${workspaceId}/${spaceId}/list/${result.listId}`);
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create List</DialogTitle>
        </DialogHeader>

        <form className="space-y-4 pt-2" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor="list-name">Name</Label>
            <Input
              autoFocus
              disabled={loading}
              id="list-name"
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Backlog, Sprint 1, Bug Reports"
              value={name}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {COLOR_PALETTE.map((c) => (
                <button
                  className="h-6 w-6 rounded-full ring-offset-2 transition-all focus:outline-none"
                  key={c}
                  onClick={() => setColor(c)}
                  style={{
                    backgroundColor: c,
                    boxShadow:
                      color === c
                        ? `0 0 0 2px white, 0 0 0 4px ${c}`
                        : undefined,
                  }}
                  type="button"
                />
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              disabled={loading}
              onClick={() => handleOpenChange(false)}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button disabled={loading || !name.trim()} type="submit">
              {loading ? "Creating…" : "Create List"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
