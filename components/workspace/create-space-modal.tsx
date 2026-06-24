"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createSpace } from "@/app/actions/space";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const COLORS = [
  "#EF4444",
  "#F97316",
  "#F59E0B",
  "#22C55E",
  "#14B8A6",
  "#3B82F6",
  "#8B5CF6",
  "#EC4899",
  "#6B7280",
  "#0EA5E9",
];

interface CreateSpaceModalProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  workspaceId: string;
}

export function CreateSpaceModal({
  open,
  onOpenChange,
  workspaceId,
}: CreateSpaceModalProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[5]);
  const [isPrivate, setIsPrivate] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      return;
    }
    startTransition(async () => {
      const result = await createSpace(workspaceId, { name, color, isPrivate });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Project created");
      setName("");
      setColor(COLORS[5]);
      setIsPrivate(false);
      onOpenChange(false);
      router.push(`/${workspaceId}/${result.spaceId}/list/${result.listId}`);
    });
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a Project</DialogTitle>
        </DialogHeader>

        <form className="space-y-5 pt-2" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor="space-name">Name</Label>
            <Input
              autoFocus
              id="space-name"
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Backend API"
              required
              value={name}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  className={cn(
                    "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110",
                    color === c
                      ? "scale-110 border-foreground"
                      : "border-transparent"
                  )}
                  key={c}
                  onClick={() => setColor(c)}
                  style={{ backgroundColor: c }}
                  type="button"
                />
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Visibility</Label>
            <div className="flex gap-3">
              {(["public", "private"] as const).map((v) => (
                <button
                  className={cn(
                    "flex-1 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                    (v === "private") === isPrivate
                      ? "border-primary bg-primary/5 font-medium"
                      : "border-border hover:bg-accent"
                  )}
                  key={v}
                  onClick={() => setIsPrivate(v === "private")}
                  type="button"
                >
                  {v === "public" ? "🌐 Public" : "🔒 Private"}
                  <p className="mt-0.5 font-normal text-muted-foreground text-xs">
                    {v === "public"
                      ? "All workspace members"
                      : "Only invited members"}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              disabled={pending}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="gap-2"
              disabled={pending || !name.trim()}
              type="submit"
            >
              {pending && <Spinner className="size-4" />}
              Create Project
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
