"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { archiveSpace, deleteSpace, updateSpace } from "@/app/actions/space";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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

interface SpaceGeneralSettingsFormProps {
  isAdmin: boolean;
  isArchived: boolean;
  isPrivate: boolean;
  spaceColor: string | null;
  spaceId: string;
  spaceName: string;
  workspaceId: string;
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
      const result = await updateSpace(workspaceId, spaceId, {
        name,
        color,
        isPrivate: priv,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Project updated");
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
      toast.success("Project archived");
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
      toast.success("Project deleted");
      router.push(`/${workspaceId}`);
    });
  }

  return (
    <div className="max-w-xl space-y-8">
      <form className="space-y-5" onSubmit={handleSave}>
        <div className="space-y-1.5">
          <Label htmlFor="space-name">Project Name</Label>
          <Input
            id="space-name"
            onChange={(e) => setName(e.target.value)}
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
                    ? "border-foreground scale-110"
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
                  "flex-1 rounded-md border px-3 py-2 text-sm transition-colors text-left",
                  (v === "private") === priv
                    ? "border-primary bg-primary/5 font-medium"
                    : "border-border hover:bg-accent"
                )}
                key={v}
                onClick={() => setPriv(v === "private")}
                type="button"
              >
                {v === "public" ? "🌐 Public" : "🔒 Private"}
                <p className="text-xs text-muted-foreground font-normal mt-0.5">
                  {v === "public"
                    ? "All workspace members"
                    : "Only invited members"}
                </p>
              </button>
            ))}
          </div>
        </div>

        <Button
          className="gap-2"
          disabled={pending || !name.trim()}
          type="submit"
        >
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
              <p className="text-sm font-medium">Archive Project</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Hides the Project from the sidebar. Data is preserved and
                searchable.
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={pending} size="sm" variant="outline">
                  Archive
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Archive &ldquo;{spaceName}&rdquo;?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    The Project will be hidden from the sidebar. All data is
                    preserved and can be restored at any time.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleArchive}>
                    Archive
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}

        {isAdmin && (
          <div className="flex items-center justify-between rounded-md border border-destructive/30 p-4">
            <div>
              <p className="text-sm font-medium">Delete Project</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Permanently deletes this Project and all its Lists, Tasks, and
                files. Cannot be undone.
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={pending} size="sm" variant="destructive">
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Delete &ldquo;{spaceName}&rdquo;?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the Project and all its
                    contents — Lists, Tasks, Comments, and uploaded files. This
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={handleDelete}
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
