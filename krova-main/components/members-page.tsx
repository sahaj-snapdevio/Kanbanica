"use client";

import {
  CaretDownIcon,
  CopyIcon,
  DotsThreeIcon,
  PaperPlaneTiltIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { cancelInvite, resendInvite } from "@/app/actions/invites";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { InviteDialog } from "@/components/invite-dialog";
import { MembersList } from "@/components/members-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isVisiblePermission, PERMISSION_LABELS } from "@/db/schema/types";
import { useTabParam } from "@/hooks/use-tab-param";
import { copyToClipboard } from "@/lib/clipboard";
import { capitalizeStatus, inviteStatusVariant } from "@/lib/status-display";

interface Member {
  cubeAssignments: string[];
  email: string;
  image: string | null;
  isOwner: boolean;
  membershipId: string;
  name: string;
  permissions: string[];
  userId: string;
}

interface PendingInvite {
  createdAt: string;
  cubeAssignments: string[];
  email: string;
  expiresAt: string;
  id: string;
  permissions: string[];
  status: "pending" | "accepted" | "expired" | "revoked";
  token: string;
}

interface MembersPageProps {
  cubes: { id: string; name: string }[];
  currentUserId: string;
  isOwner: boolean;
  members: Member[];
  pendingInvites: PendingInvite[];
  permissions: string[];
  spaceId: string;
}

function isExpiredByClock(invite: PendingInvite) {
  return new Date(invite.expiresAt).getTime() < Date.now();
}

function inviteEffectiveStatus(
  invite: PendingInvite
): "pending" | "expired" | "accepted" | "revoked" {
  if (invite.status === "pending" && isExpiredByClock(invite)) {
    return "expired";
  }
  return invite.status;
}

const TAB_VALUES = ["members", "invites"] as const;

export function MembersPage({
  spaceId,
  members,
  pendingInvites,
  cubes,
  permissions,
  isOwner,
  currentUserId,
}: MembersPageProps) {
  const router = useRouter();
  const tabParam = useTabParam(TAB_VALUES, "members");
  const canManageMembers = isOwner || permissions.includes("members.manage");
  const canInvite = isOwner || permissions.includes("members.invite");
  const cubeNames = new Map(cubes.map((c) => [c.id, c.name]));

  const [pendingAction, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingKind, setPendingKind] = useState<"resend" | "revoke" | null>(
    null
  );
  const [revokeTarget, setRevokeTarget] = useState<PendingInvite | null>(null);

  function copyInviteUrl(token: string) {
    copyToClipboard(
      `${window.location.origin}/invite/${token}`,
      "Invite link copied"
    );
  }

  function handleResend(invite: PendingInvite) {
    setPendingId(invite.id);
    setPendingKind("resend");
    startTransition(async () => {
      const res = await resendInvite(spaceId, invite.id);
      setPendingId(null);
      setPendingKind(null);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      if (res.warning) {
        toast.warning(res.warning);
      } else {
        toast.success(`Invite resent to ${invite.email}`);
      }
      router.refresh();
    });
  }

  function handleRevokeConfirm() {
    if (!revokeTarget) {
      return;
    }
    const target = revokeTarget;
    setPendingId(target.id);
    setPendingKind("revoke");
    startTransition(async () => {
      const res = await cancelInvite(spaceId, target.id);
      setPendingId(null);
      setPendingKind(null);
      setRevokeTarget(null);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(`Invite to ${target.email} revoked`);
      router.refresh();
    });
  }

  const inviteColumns: DataTableColumn<PendingInvite>[] = [
    {
      id: "email",
      header: "Email",
      cell: (inv) => <span className="font-medium">{inv.email}</span>,
    },
    {
      id: "status",
      header: "Status",
      className: "w-[120px]",
      cell: (inv) => {
        const effective = inviteEffectiveStatus(inv);
        return (
          <Badge variant={inviteStatusVariant(effective)}>
            {capitalizeStatus(effective)}
          </Badge>
        );
      },
    },
    {
      id: "permissions",
      header: "Permissions",
      className: "w-[160px]",
      cell: (inv) => {
        const visiblePerms = inv.permissions.filter(isVisiblePermission);
        if (visiblePerms.length === 0) {
          return <span className="text-muted-foreground">—</span>;
        }
        // Single compact trigger ("7 permissions") that opens a popover
        // listing every granted permission. Inline badge wrapping made the
        // row way too dense — the popover keeps the table scannable while
        // still letting the operator see the full set on demand.
        return (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                className="-ml-2 h-7 gap-1 px-2 text-xs font-normal"
                size="sm"
                variant="ghost"
              >
                <span className="font-mono text-foreground tabular-nums">
                  {visiblePerms.length}
                </span>
                <span className="text-muted-foreground">
                  {visiblePerms.length === 1 ? "permission" : "permissions"}
                </span>
                <CaretDownIcon className="size-3 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-64 p-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="space-y-2">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {inv.email} can
                </p>
                <ul className="space-y-1">
                  {visiblePerms.map((p) => (
                    <li className="flex items-center gap-2 text-sm" key={p}>
                      <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                      <span>{PERMISSION_LABELS[p] ?? p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </PopoverContent>
          </Popover>
        );
      },
    },
    {
      id: "assignments",
      header: "Cubes",
      className: "w-[140px]",
      cell: (inv) => {
        // Empty assignment list = "this invite is scoped to every cube".
        // Render that as a plain muted label so the operator doesn't think
        // they need to expand anything.
        if (inv.cubeAssignments.length === 0) {
          return (
            <span className="text-xs text-muted-foreground">All cubes</span>
          );
        }
        // Otherwise use the same popover pattern as the Permissions column
        // so the row stays tidy: a compact "N cubes ▾" trigger that opens
        // the full list on click.
        return (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                className="-ml-2 h-7 gap-1 px-2 text-xs font-normal"
                size="sm"
                variant="ghost"
              >
                <span className="font-mono text-foreground tabular-nums">
                  {inv.cubeAssignments.length}
                </span>
                <span className="text-muted-foreground">
                  {inv.cubeAssignments.length === 1 ? "cube" : "cubes"}
                </span>
                <CaretDownIcon className="size-3 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-64 p-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="space-y-2">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Scoped to
                </p>
                <ul className="space-y-1 text-sm">
                  {inv.cubeAssignments.map((id) => (
                    <li className="flex items-center gap-2" key={id}>
                      <span className="size-1.5 shrink-0 rounded-full bg-blue-500" />
                      <span className="truncate">
                        {cubeNames.get(id) ?? id}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </PopoverContent>
          </Popover>
        );
      },
    },
    {
      id: "expires",
      header: "Expires",
      className: "w-[140px]",
      cell: (inv) => {
        const effective = inviteEffectiveStatus(inv);
        return (
          <span
            className={
              effective === "expired"
                ? "text-amber-700 dark:text-amber-400"
                : "text-muted-foreground"
            }
          >
            {formatDistanceToNow(new Date(inv.expiresAt), { addSuffix: true })}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      // Narrow kebab column — three actions live inside one dropdown
      // instead of three separate buttons wrapping to a second line.
      className: "w-[60px] text-right",
      cell: (inv) => {
        const effective = inviteEffectiveStatus(inv);
        const isBusy = pendingAction && pendingId === inv.id;
        const expired = effective === "expired";
        const hasAnyAction = !expired || canInvite;
        if (!hasAnyAction) {
          return <span className="text-muted-foreground">—</span>;
        }
        return (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="Invite actions"
                  disabled={isBusy}
                  size="icon-sm"
                  variant="ghost"
                >
                  {isBusy ? (
                    <Spinner className="size-4" />
                  ) : (
                    <DotsThreeIcon className="size-4" weight="bold" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {!expired && (
                  <DropdownMenuItem onClick={() => copyInviteUrl(inv.token)}>
                    <CopyIcon className="size-4" />
                    Copy link
                  </DropdownMenuItem>
                )}
                {canInvite && (
                  <DropdownMenuItem onClick={() => handleResend(inv)}>
                    <PaperPlaneTiltIcon className="size-4" />
                    {pendingKind === "resend" && pendingId === inv.id
                      ? "Resending…"
                      : expired
                        ? "Send new invite"
                        : "Resend"}
                  </DropdownMenuItem>
                )}
                {canInvite && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                      onClick={() => setRevokeTarget(inv)}
                    >
                      <TrashIcon className="size-4" />
                      Revoke
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Members</PageHeaderTitle>
          <PageHeaderDescription>
            Manage members and invitations for this space.
          </PageHeaderDescription>
        </PageHeaderContent>
        {canInvite && (
          <PageHeaderActions>
            <InviteDialog cubes={cubes} spaceId={spaceId} />
          </PageHeaderActions>
        )}
      </PageHeader>

      <Tabs {...tabParam}>
        <TabsList variant="default">
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="invites">
            Invites
            {pendingInvites.length > 0 && (
              <Badge className="ml-1.5 px-1.5 text-xs" variant="secondary">
                {pendingInvites.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent className="mt-6" value="members">
          <MembersList
            canManage={canManageMembers}
            cubes={cubes}
            currentUserId={currentUserId}
            isOwner={isOwner}
            members={members}
            spaceId={spaceId}
          />
        </TabsContent>

        <TabsContent className="mt-6" value="invites">
          <DataTable<PendingInvite>
            columns={inviteColumns}
            data={pendingInvites}
            emptyDescription="Invite someone to this space and pending invites will appear here."
            emptyTitle="No invites"
            pageSize={10}
            rowKey={(inv) => inv.id}
            searchAccessor={(inv) => inv.email}
            searchPlaceholder="Search invites by email…"
          />
        </TabsContent>
      </Tabs>

      <ConfirmActionDialog
        busy={pendingKind === "revoke"}
        confirmLabel={pendingKind === "revoke" ? "Revoking…" : "Revoke invite"}
        description={
          <p>
            The link sent to{" "}
            <span className="font-medium text-foreground">
              {revokeTarget?.email}
            </span>{" "}
            will stop working immediately. They will need a new invite to join
            the space.
          </p>
        }
        onConfirm={handleRevokeConfirm}
        onOpenChange={(open) => {
          if (!open) {
            setRevokeTarget(null);
          }
        }}
        open={!!revokeTarget}
        title="Revoke invite?"
      />
    </div>
  );
}
