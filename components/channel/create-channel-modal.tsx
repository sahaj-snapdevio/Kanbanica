"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { createChannel } from "@/app/actions/channel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface CreateChannelModalProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  workspaceId: string;
}

export function CreateChannelModal({
  open,
  onOpenChange,
  workspaceId,
}: CreateChannelModalProps) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await createChannel(workspaceId, name);

    if ("error" in result) {
      setError(result.error);
      setLoading(false);
      return;
    }

    setName("");
    setLoading(false);
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Channel</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="channel-name"
            >
              Channel name
            </label>
            <div className="flex items-center gap-2">
              <span className="text-lg text-muted-foreground">#</span>
              <Input
                autoFocus
                id="channel-name"
                maxLength={50}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. general"
                value={name}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Channel names must be lowercase and can contain letters, numbers,
              hyphens, and underscores.
            </p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button
              disabled={loading}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button disabled={loading || !name.trim()} type="submit">
              {loading ? "Creating…" : "Create Channel"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
