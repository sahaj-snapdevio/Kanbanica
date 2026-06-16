"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateSpace, archiveSpace, deleteSpace } from "@/app/actions/space";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

const COLORS = [
  "#EF4444", "#F97316", "#F59E0B", "#22C55E",
  "#14B8A6", "#3B82F6", "#8B5CF6", "#EC4899",
  "#6B7280", "#0EA5E9",
];

interface SpaceGeneralSettingsFormProps {
  workspaceId: string;
  spaceId: string;
  spaceName: string;
  spaceColor: string | null;
  isPrivate: boolean;
  isArchived: boolean;
  isAdmin: boolean;
}

export function SpaceGeneralSettingsForm({
  workspaceId,
  spaceId,
  spaceName,
  spaceColor,
  isPrivate,
  isArchived,
  isAdmin,
}: SpaceGeneralSettingsFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(spaceName);
  const [color, setColor] = useState(spaceColor ?? COLORS[5]);
  const [priv, setPriv] = useState(isPrivate);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateSpace(workspaceId, spaceId, { name, color, isPrivate: priv });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Space updated");
      router.refresh();
    });
  }

  function handleArchive() {
    startTransition(async () => {
      const result = await archiveSpace(workspaceId, spaceId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Space archived");
      router.push(`/${workspaceId}`);
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteSpace(workspaceId, spaceId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Space deleted");
      router.push(`/${workspaceId}`);
    });
  }

  return (
    <div className="max-w-xl space-y-8">
      <form onSubmit={handleSave} className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="space-name">Space Name</Label>
          <Input
            id="space-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label>Color</Label>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn(
                  "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110",
                  color === c ? "border-foreground scale-110" : "border-transparent",
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Visibility</Label>
          <div className="flex gap-3">
            {(["public", "private"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setPriv(v === "private")}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-sm transition-colors text-left",
                  (v === "private") === priv
                    ? "border-primary bg-primary/5 font-medium"
                    : "border-border hover:bg-accent",
                )}
              >
                {v === "public" ? "🌐 Public" : "🔒 Private"}
                <p className="text-xs text-muted-foreground font-normal mt-0.5">
                  {v === "public" ? "All workspace members" : "Only invited members"}
                </p>
              </button>
            ))}
          </div>
        </div>

        <Button type="submit" disabled={pending || !name.trim()} className="gap-2">
          {pending && <Spinner className="size-4" />}
          Save Changes
        </Button>
      </form>

      <Separator />

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-destructive">Danger Zone</h3>

        {!isArchived && (
          <div className="flex items-center justify-between rounded-md border border-border p-4">
            <div>
              <p className="text-sm font-medium">Archive Space</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Hides the Space from the sidebar. Data is preserved and searchable.
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={pending}>
                  Archive
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Archive &ldquo;{spaceName}&rdquo;?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The Space will be hidden from the sidebar. All data is preserved and can be restored at any time.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleArchive}>Archive</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}

        {isAdmin && (
          <div className="flex items-center justify-between rounded-md border border-destructive/30 p-4">
            <div>
              <p className="text-sm font-medium">Delete Space</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Permanently deletes this Space and all its Lists, Tasks, and files. Cannot be undone.
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={pending}>
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete &ldquo;{spaceName}&rdquo;?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the Space and all its contents — Lists, Tasks, Comments, and uploaded files. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete permanently
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>
    </div>
  );
}
