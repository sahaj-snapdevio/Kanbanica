"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { deleteList } from "@/app/actions/list";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface DeleteListDialogProps {
  list: { id: string; name: string };
  onOpenChange: (open: boolean) => void;
  open: boolean;
  spaceId: string;
  workspaceId: string;
}

export function DeleteListDialog({
  open,
  onOpenChange,
  workspaceId,
  spaceId,
  list,
}: DeleteListDialogProps) {
  const router = useRouter();
  const [confirm, setConfirm] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  function handleOpenChange(val: boolean) {
    if (!val) {
      setConfirm("");
      setError("");
    }
    onOpenChange(val);
  }

  async function handleDelete() {
    if (confirm !== list.name) {
      return;
    }

    setLoading(true);
    setError("");

    const result = await deleteList(workspaceId, spaceId, list.id);

    setLoading(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }

    handleOpenChange(false);
    router.push(`/${workspaceId}`);
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete List</DialogTitle>
          <DialogDescription>
            This will permanently delete <strong>{list.name}</strong> and all
            its tasks, comments, and attachments. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Consider archiving instead — archived lists can be restored any
            time.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="delete-confirm">
              Type <strong>{list.name}</strong> to confirm
            </Label>
            <Input
              autoFocus
              disabled={loading}
              id="delete-confirm"
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={list.name}
              value={confirm}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            disabled={loading}
            onClick={() => handleOpenChange(false)}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            disabled={confirm !== list.name || loading}
            onClick={handleDelete}
            type="button"
            variant="destructive"
          >
            {loading ? "Deleting…" : "Delete List"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
