"use client";

import { CaretDownIcon, TrashIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { removeMember } from "@/app/actions/members";
import { EditPermissionsDialog } from "@/components/edit-permissions-dialog";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import { isVisiblePermission, PERMISSION_LABELS } from "@/db/schema/types";

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

interface MembersListProps {
  canManage: boolean;
  cubes: { id: string; name: string }[];
  currentUserId: string;
  isOwner: boolean;
  members: Member[];
  spaceId: string;
}

export function MembersList({
  members,
  spaceId,
  canManage,
  cubes,
  currentUserId,
}: MembersListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const pageWindow = useMemo(() => {
    const start = (page - 1) * pageSize;
    return members.slice(start, start + pageSize);
  }, [members, page, pageSize]);

  const [prevPageSize, setPrevPageSize] = useState(pageSize);
  if (prevPageSize !== pageSize) {
    setPrevPageSize(pageSize);
    setPage(1);
  }

  function handleRemove(memberId: string) {
    startTransition(async () => {
      const result = await removeMember(spaceId, memberId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Member has been removed");
      router.refresh();
    });
  }

  const cubeMap = new Map(cubes.map((v) => [v.id, v.name]));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Members</h2>
        <p className="text-sm text-muted-foreground">
          {members.length} member{members.length === 1 ? "" : "s"} in this
          space.
        </p>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead className="w-40">Permissions</TableHead>
              <TableHead className="w-35">Assigned Cubes</TableHead>
              {canManage && (
                <TableHead className="w-20 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageWindow.map((member) => {
              const visiblePerms =
                member.permissions.filter(isVisiblePermission);
              return (
                <TableRow key={member.membershipId}>
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium">
                        {member.name}
                        {member.isOwner && (
                          <Badge className="ml-2 text-xs" variant="secondary">
                            Owner
                          </Badge>
                        )}
                        {member.userId === currentUserId && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (you)
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {member.email}
                      </p>
                    </div>
                  </TableCell>

                  {/* Permissions — same popover pattern as the Invites tab.
                      Owners get a flat label ("All permissions") since
                      enumerating them is just visual noise. */}
                  <TableCell>
                    {member.isOwner ? (
                      <span className="text-xs text-muted-foreground">
                        All permissions
                      </span>
                    ) : visiblePerms.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        None
                      </span>
                    ) : (
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
                              {visiblePerms.length === 1
                                ? "permission"
                                : "permissions"}
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
                              {member.name.split(" ")[0]} can
                            </p>
                            <ul className="space-y-1 text-sm">
                              {visiblePerms.map((p) => (
                                <li className="flex items-center gap-2" key={p}>
                                  <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                                  <span className="truncate">
                                    {PERMISSION_LABELS[p] ?? p}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </TableCell>

                  {/* Assigned cubes — same pattern. Owner sees the wildcard
                      "All cubes" label; non-owner with explicit scoping
                      sees a popover trigger. */}
                  <TableCell>
                    {member.isOwner ? (
                      <span className="text-xs text-muted-foreground">
                        All Cubes
                      </span>
                    ) : member.cubeAssignments.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        None
                      </span>
                    ) : (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            className="-ml-2 h-7 gap-1 px-2 text-xs font-normal"
                            size="sm"
                            variant="ghost"
                          >
                            <span className="font-mono text-foreground tabular-nums">
                              {member.cubeAssignments.length}
                            </span>
                            <span className="text-muted-foreground">
                              {member.cubeAssignments.length === 1
                                ? "cube"
                                : "cubes"}
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
                              {member.cubeAssignments.map((cubeId) => (
                                <li
                                  className="flex items-center gap-2"
                                  key={cubeId}
                                >
                                  <span className="size-1.5 shrink-0 rounded-full bg-blue-500" />
                                  <span className="truncate">
                                    {cubeMap.get(cubeId) ?? cubeId}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </TableCell>

                  {canManage && (
                    <TableCell className="text-right">
                      {!member.isOwner && member.userId !== currentUserId ? (
                        <MemberActionsMenu
                          cubes={cubes}
                          isPending={isPending}
                          member={member}
                          onEdited={() => router.refresh()}
                          onRemove={() => handleRemove(member.membershipId)}
                          spaceId={spaceId}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <TablePagination
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        page={page}
        pageSize={pageSize}
        total={members.length}
      />
    </div>
  );
}

function MemberActionsMenu({
  member,
  spaceId,
  cubes,
  isPending,
  onRemove,
  onEdited,
}: {
  member: Member;
  spaceId: string;
  cubes: { id: string; name: string }[];
  isPending: boolean;
  onRemove: () => void;
  onEdited: () => void;
}) {
  // Two-action cell: Edit + Remove. EditPermissionsDialog renders its own
  // pencil-icon button; Remove sits next to it as a trash icon. Two icons
  // fit comfortably on one row at this column width — no kebab needed.
  return (
    <div className="flex items-center justify-end gap-1">
      <EditPermissionsDialog
        cubes={cubes}
        member={member}
        onSuccess={onEdited}
        spaceId={spaceId}
      />
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            aria-label={`Remove ${member.name}`}
            disabled={isPending}
            size="icon-sm"
            variant="ghost"
          >
            {isPending ? (
              <Spinner className="size-4" />
            ) : (
              <TrashIcon className="size-4 text-destructive" />
            )}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Member</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <strong>{member.name}</strong> from this space? They will
              lose access to all resources immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isPending}
              onClick={onRemove}
            >
              {isPending && <Spinner className="size-4" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
