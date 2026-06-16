"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import { CrownIcon, MagnifyingGlassIcon, PaperPlaneTiltIcon, UserPlusIcon } from "@phosphor-icons/react";
import {
  cancelInvite,
  changeMemberRole,
  inviteMember,
  removeMember,
  resendInvite,
  transferOwnership,
} from "@/app/actions/workspace";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER" | "GUEST";

interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  joinedAt: string;
}

interface PendingInvite {
  id: string;
  email: string;
  role: WorkspaceRole;
  invitedByName: string;
  sentAt: string;
  expiresAt: string | null;
}

interface MembersManagerProps {
  workspaceId: string;
  workspaceName: string;
  members: Member[];
  pendingInvites: PendingInvite[];
  currentUserId: string;
  actorRole: WorkspaceRole;
}

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  GUEST: "Guest",
};

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function MembersManager({
  workspaceId,
  workspaceName,
  members,
  pendingInvites,
  currentUserId,
  actorRole,
}: MembersManagerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"ALL" | WorkspaceRole>("ALL");

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "MEMBER" | "GUEST">("MEMBER");

  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);

  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState<string>("");
  const [transferConfirm, setTransferConfirm] = useState("");

  const isOwner = actorRole === "OWNER";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter((m) => {
      if (roleFilter !== "ALL" && m.role !== roleFilter) return false;
      if (q && !m.name.toLowerCase().includes(q) && !m.email.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [members, search, roleFilter]);

  function run(action: () => Promise<{ ok?: true; error?: string } | { error: string }>, onSuccess?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result && "error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      onSuccess?.();
      router.refresh();
    });
  }

  function canManage(target: Member) {
    if (target.userId === currentUserId || target.role === "OWNER") return false;
    if (actorRole === "ADMIN" && target.role === "ADMIN") return false;
    return true;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="normal-case tracking-normal text-base font-semibold">
                Members
              </CardTitle>
              <CardDescription>
                {members.length} {members.length === 1 ? "person" : "people"} in this workspace
              </CardDescription>
            </div>
            <div className="flex gap-2">
              {isOwner && members.length > 1 && (
                <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      <CrownIcon className="size-4" />
                      Transfer ownership
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Transfer ownership</DialogTitle>
                      <DialogDescription>
                        The new Owner gets full control. You become an Admin. This cannot be undone by you.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>New owner</Label>
                        <Select value={transferTarget} onValueChange={setTransferTarget}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a member" />
                          </SelectTrigger>
                          <SelectContent>
                            {members
                              .filter((m) => m.userId !== currentUserId && m.role !== "GUEST")
                              .map((m) => (
                                <SelectItem key={m.id} value={m.id}>
                                  {m.name} ({m.email})
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="transfer-confirm">
                          Type{" "}
                          <span className="normal-case font-semibold tracking-normal">
                            {workspaceName}
                          </span>{" "}
                          to confirm
                        </Label>
                        <Input
                          id="transfer-confirm"
                          value={transferConfirm}
                          onChange={(e) => setTransferConfirm(e.target.value)}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        disabled={pending || !transferTarget || transferConfirm !== workspaceName}
                        onClick={() =>
                          run(
                            () => transferOwnership({ workspaceId, targetMemberId: transferTarget, confirmName: transferConfirm }),
                            () => { setTransferOpen(false); toast.success("Ownership transferred"); },
                          )
                        }
                        className="gap-2"
                      >
                        {pending && <Spinner className="size-4" />}
                        Transfer ownership
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}

              <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2">
                    <UserPlusIcon className="size-4" />
                    Invite
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Invite a teammate</DialogTitle>
                    <DialogDescription>
                      They&apos;ll receive an email invite, valid for 7 days.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="invite-email">Email address</Label>
                      <Input
                        id="invite-email"
                        type="email"
                        placeholder="teammate@example.com"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Role</Label>
                      <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as typeof inviteRole)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {isOwner && <SelectItem value="ADMIN">Admin</SelectItem>}
                          <SelectItem value="MEMBER">Member</SelectItem>
                          <SelectItem value="GUEST">Guest</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      disabled={pending || !inviteEmail.trim()}
                      onClick={() =>
                        run(
                          () => inviteMember({ workspaceId, email: inviteEmail, role: inviteRole }),
                          () => { setInviteOpen(false); setInviteEmail(""); toast.success(`Invite sent to ${inviteEmail.trim()}`); },
                        )
                      }
                      className="gap-2"
                    >
                      {pending ? <Spinner className="size-4" /> : <PaperPlaneTiltIcon className="size-4" />}
                      Send invite
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <div className="relative flex-1 min-w-44">
              <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name or email"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as typeof roleFilter)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All roles</SelectItem>
                <SelectItem value="OWNER">Owner</SelectItem>
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="MEMBER">Member</SelectItem>
                <SelectItem value="GUEST">Guest</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead className="hidden sm:table-cell">Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden md:table-cell">Joined</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar className="size-7 shrink-0">
                        <AvatarFallback className="text-xs">{initialsOf(member.name)}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium">
                        {member.name}
                        {member.userId === currentUserId && (
                          <span className="text-muted-foreground font-normal"> (you)</span>
                        )}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground">
                    {member.email}
                  </TableCell>
                  <TableCell>
                    {canManage(member) ? (
                      <Select
                        value={member.role}
                        onValueChange={(role) =>
                          run(() => changeMemberRole({ workspaceId, memberId: member.id, role: role as "ADMIN" | "MEMBER" | "GUEST" }))
                        }
                      >
                        <SelectTrigger className="h-8 w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {isOwner && <SelectItem value="ADMIN">Admin</SelectItem>}
                          <SelectItem value="MEMBER">Member</SelectItem>
                          <SelectItem value="GUEST">Guest</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant={member.role === "OWNER" ? "default" : "secondary"}>
                        {ROLE_LABELS[member.role]}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">
                    {format(new Date(member.joinedAt), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage(member) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setRemoveTarget(member)}
                      >
                        Remove
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No members match your search
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Remove confirmation */}
      <Dialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removeTarget?.name}?</DialogTitle>
            <DialogDescription>
              They lose access to this workspace and all its Spaces. Tasks they created or were assigned to are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                removeTarget &&
                run(
                  () => removeMember({ workspaceId, memberId: removeTarget.id }),
                  () => { toast.success(`${removeTarget.name} removed`); setRemoveTarget(null); },
                )
              }
              className="gap-2"
            >
              {pending && <Spinner className="size-4" />}
              Remove member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pending invites */}
      <Card>
        <CardHeader>
          <CardTitle className="normal-case tracking-normal text-base font-semibold">
            Pending invites
          </CardTitle>
          <CardDescription>
            {pendingInvites.length === 0
              ? "No outstanding invites."
              : `${pendingInvites.length} invite${pendingInvites.length === 1 ? "" : "s"} waiting to be accepted.`}
          </CardDescription>
        </CardHeader>
        {pendingInvites.length > 0 && (
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead className="hidden sm:table-cell">Invited by</TableHead>
                  <TableHead className="hidden md:table-cell">Sent</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-36" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvites.map((invite) => {
                  const expired = invite.expiresAt && new Date(invite.expiresAt) < new Date();
                  return (
                    <TableRow key={invite.id}>
                      <TableCell className="font-medium">{invite.email}</TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground">
                        {invite.invitedByName}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground">
                        {format(new Date(invite.sentAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        {expired ? (
                          <Badge variant="destructive">Expired</Badge>
                        ) : invite.expiresAt ? (
                          <span className="text-muted-foreground">
                            {format(new Date(invite.expiresAt), "MMM d, yyyy")}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => run(() => resendInvite({ workspaceId, memberId: invite.id }), () => toast.success(`Invite re-sent to ${invite.email}`))}
                        >
                          Resend
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={pending}
                          onClick={() => run(() => cancelInvite({ workspaceId, memberId: invite.id }))}
                        >
                          Cancel
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
