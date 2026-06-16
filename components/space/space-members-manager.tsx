"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { addSpaceMember, changeSpaceMemberPermission, removeSpaceMember } from "@/app/actions/space";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

type SpacePermission = "FULL_ACCESS" | "EDIT" | "VIEW";

interface WorkspaceMemberOption {
  userId: string;
  name: string | null;
  email: string;
}

interface SpaceMemberRow {
  id: string;
  userId: string;
  permission: SpacePermission;
  user: { id: string; name: string | null; email: string };
}

interface SpaceMembersManagerProps {
  workspaceId: string;
  spaceId: string;
  members: SpaceMemberRow[];
  workspaceMembers: WorkspaceMemberOption[];
}

const PERMISSION_LABELS: Record<SpacePermission, string> = {
  FULL_ACCESS: "Full Access",
  EDIT: "Edit",
  VIEW: "View",
};

function initials(name: string | null, email: string) {
  if (name) return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  return email.slice(0, 2).toUpperCase();
}

export function SpaceMembersManager({
  workspaceId,
  spaceId,
  members,
  workspaceMembers,
}: SpaceMembersManagerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedPermission, setSelectedPermission] = useState<SpacePermission>("VIEW");

  const existingUserIds = new Set(members.map((m) => m.userId));
  const addableMembers = workspaceMembers.filter((m) => !existingUserIds.has(m.userId));

  function handleAdd() {
    if (!selectedUserId) return;
    startTransition(async () => {
      const result = await addSpaceMember(workspaceId, spaceId, selectedUserId, selectedPermission);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Member added");
      setAddOpen(false);
      setSelectedUserId("");
      setSelectedPermission("VIEW");
      router.refresh();
    });
  }

  function handleChangePermission(userId: string, permission: SpacePermission) {
    startTransition(async () => {
      const result = await changeSpaceMemberPermission(workspaceId, spaceId, userId, permission);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleRemove(userId: string) {
    startTransition(async () => {
      const result = await removeSpaceMember(workspaceId, spaceId, userId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Member removed");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {members.length} member{members.length !== 1 ? "s" : ""} with explicit access
        </p>

        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm" disabled={addableMembers.length === 0}>
              Add member
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add member to Space</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label>Workspace member</Label>
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a member…" />
                  </SelectTrigger>
                  <SelectContent>
                    {addableMembers.map((m) => (
                      <SelectItem key={m.userId} value={m.userId}>
                        {m.name ?? m.email}
                        {m.name && (
                          <span className="text-muted-foreground ml-1 text-xs">{m.email}</span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Permission</Label>
                <Select
                  value={selectedPermission}
                  onValueChange={(v) => setSelectedPermission(v as SpacePermission)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PERMISSION_LABELS) as SpacePermission[]).map((p) => (
                      <SelectItem key={p} value={p}>
                        {PERMISSION_LABELS[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAddOpen(false)} disabled={pending}>
                  Cancel
                </Button>
                <Button onClick={handleAdd} disabled={pending || !selectedUserId} className="gap-2">
                  {pending && <Spinner className="size-4" />}
                  Add
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No explicit members yet. Public Spaces are visible to all workspace members with View access.
        </p>
      ) : (
        <div className="divide-y rounded-md border">
          {members.map((member) => (
            <div key={member.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback className="text-xs">
                  {initials(member.user.name, member.user.email)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {member.user.name ?? member.user.email}
                </p>
                {member.user.name && (
                  <p className="text-xs text-muted-foreground truncate">{member.user.email}</p>
                )}
              </div>

              <Select
                value={member.permission}
                onValueChange={(v) => handleChangePermission(member.userId, v as SpacePermission)}
                disabled={pending}
              >
                <SelectTrigger className="w-36 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PERMISSION_LABELS) as SpacePermission[]).map((p) => (
                    <SelectItem key={p} value={p} className="text-xs">
                      {PERMISSION_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    className="text-destructive hover:text-destructive"
                  >
                    Remove
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove member?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {member.user.name ?? member.user.email} will lose explicit access to this Space. They remain a workspace member.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => handleRemove(member.userId)}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Remove
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
