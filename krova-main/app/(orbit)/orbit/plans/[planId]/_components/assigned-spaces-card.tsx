"use client";

/**
 * "Assigned spaces" card for custom-visibility plans. Lists current
 * assignments with a per-row "Remove" button, plus an "Add space" sheet with
 * a search-by-name filter over the full space list (passed in from the
 * server component — `availableSpaces` excludes already-assigned spaces).
 */

import {
  MagnifyingGlassIcon,
  PlusIcon,
  TrashIcon,
  UserPlusIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  assignPlanToSpace,
  unassignPlanFromSpace,
} from "@/app/actions/orbit-plans";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";

interface SpaceRow {
  id: string;
  name: string;
  ownerEmail: string | null;
}

export function AssignedSpacesCard({
  planId,
  assigned,
  availableSpaces,
}: {
  planId: string;
  assigned: SpaceRow[];
  availableSpaces: SpaceRow[];
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const filteredAssigned = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return assigned;
    }
    return assigned.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.ownerEmail?.toLowerCase().includes(q) ?? false)
    );
  }, [assigned, search]);

  const pageWindow = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredAssigned.slice(start, start + pageSize);
  }, [filteredAssigned, page, pageSize]);

  const resetKey = `${search}|${pageSize}`;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setPage(1);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Assigned spaces</CardTitle>
              <CardDescription>
                Spaces below are currently on this custom plan. Removing a space
                moves it back to the default plan. Spaces with an active Polar
                subscription must cancel before being reassigned.
              </CardDescription>
            </div>
            <Button
              disabled={availableSpaces.length === 0}
              onClick={() => setAddOpen(true)}
              size="sm"
              type="button"
            >
              <PlusIcon className="size-4" />
              Add space
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative max-w-sm">
            <MagnifyingGlassIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter assigned spaces..."
              value={search}
            />
          </div>
          {assigned.length === 0 ? (
            <Empty>
              <EmptyMedia variant="icon">
                <UserPlusIcon className="size-5" />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>No spaces assigned</EmptyTitle>
                <EmptyDescription>
                  Add a space to move it onto this custom plan.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Space</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead className="w-[8rem]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageWindow.map((s) => (
                    <Fragment key={s.id}>
                      <AssignedRow planId={planId} space={s} />
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
              <div className="border-t p-2">
                <TablePagination
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                  page={page}
                  pageSize={pageSize}
                  total={filteredAssigned.length}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AddSpaceSheet
        available={availableSpaces}
        onOpenChange={setAddOpen}
        open={addOpen}
        planId={planId}
      />
    </>
  );
}

function AssignedRow({ planId, space }: { planId: string; space: SpaceRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleRemove() {
    startTransition(async () => {
      const result = await unassignPlanFromSpace(planId, space.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Removed ${space.name} from this plan`);
      // router.refresh re-runs the RSC plan-detail page so the assigned-
      // spaces list reflects the new state; the space's own billing page
      // (if open in another tab) refreshes via its own dynamic layout.
      router.refresh();
    });
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{space.name}</TableCell>
      <TableCell className="text-muted-foreground">
        {space.ownerEmail ?? "—"}
      </TableCell>
      <TableCell className="text-right">
        <Button
          disabled={isPending}
          onClick={handleRemove}
          size="sm"
          type="button"
          variant="ghost"
        >
          <TrashIcon className="size-4" />
          Remove
        </Button>
      </TableCell>
    </TableRow>
  );
}

function AddSpaceSheet({
  planId,
  open,
  onOpenChange,
  available,
}: {
  planId: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  available: SpaceRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return available;
    }
    return available.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.ownerEmail?.toLowerCase().includes(q) ?? false)
    );
  }, [available, search]);

  function handleAssign(spaceId: string, spaceName: string) {
    startTransition(async () => {
      const result = await assignPlanToSpace(planId, spaceId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      // Surface the post-assign warning (e.g. "N cubes auto-slept") if
      // the action returned one — without this the operator only learns
      // about destructive side-effects via the audit log.
      if (result.warning) {
        toast.warning(result.warning, { duration: 10_000 });
      } else {
        toast.success(`Moved ${spaceName} onto this plan`);
      }
      router.refresh();
      onOpenChange(false);
      setSearch("");
    });
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setSearch("");
    }
    onOpenChange(next);
  }

  return (
    <Sheet onOpenChange={handleOpenChange} open={open}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Move a space onto this plan</SheetTitle>
          <SheetDescription>
            Pick a space to put it on this custom plan immediately. Cubes over
            the new plan&apos;s concurrent-Cube cap are auto-slept and can be
            woken later.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-4 pb-6">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              className="pl-9"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search spaces by name or owner..."
              value={search}
            />
          </div>
          {filtered.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">
              {available.length === 0
                ? "Every space is already assigned."
                : "No spaces match your search."}
            </p>
          ) : (
            <div className="max-h-[28rem] space-y-1 overflow-y-auto">
              {filtered.map((s) => (
                <button
                  className="flex w-full items-center justify-between gap-3 rounded-md border border-transparent px-3 py-2 text-left text-sm transition-colors hover:border-input hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isPending}
                  key={s.id}
                  onClick={() => handleAssign(s.id, s.name)}
                  type="button"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {s.ownerEmail ?? "—"}
                    </span>
                  </div>
                  <PlusIcon className="size-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
