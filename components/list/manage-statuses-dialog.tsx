"use client";

import * as React from "react";
import { getListStatuses } from "@/app/actions/list";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ListStatusesSettings } from "./list-statuses-settings";

interface Status {
  id: string;
  name: string;
  color: string;
  type: "OPEN" | "ACTIVE" | "CLOSED";
  orderIndex: number;
}

interface ManageStatusesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  spaceId: string;
  listId: string;
  onSaved?: (statuses: Status[]) => void;
}

export function ManageStatusesDialog({
  open,
  onOpenChange,
  workspaceId,
  spaceId,
  listId,
  onSaved,
}: ManageStatusesDialogProps) {
  const [statuses, setStatuses] = React.useState<Status[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    getListStatuses(workspaceId, spaceId, listId).then((res) => {
      if (!("error" in res)) setStatuses(res);
      setLoading(false);
    });
  }, [open, workspaceId, spaceId, listId]);

  function handleClose(val: boolean) {
    if (!val) onSaved?.(statuses);
    onOpenChange(val);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg flex flex-col max-h-[80vh]">
        <DialogHeader className="shrink-0">
          <DialogTitle>Manage Statuses</DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto flex-1 pr-1" onWheel={(e) => e.stopPropagation()}>
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : (
            <ListStatusesSettings
              workspaceId={workspaceId}
              spaceId={spaceId}
              listId={listId}
              initialStatuses={statuses}
              onStatusesChange={setStatuses}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
