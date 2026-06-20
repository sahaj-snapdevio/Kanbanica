"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createChannel } from "@/app/actions/channel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface CreateChannelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
}

export function CreateChannelModal({ open, onOpenChange, workspaceId }: CreateChannelModalProps) {
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Channel</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="channel-name" className="text-sm font-medium text-foreground">
              Channel name
            </label>
            <div className="flex items-center gap-2">
              <span className="text-lg text-muted-foreground">#</span>
              <Input
                id="channel-name"
                placeholder="e.g. general"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                maxLength={50}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Channel names must be lowercase and can contain letters, numbers, hyphens, and underscores.
            </p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading ? "Creating…" : "Create Channel"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
