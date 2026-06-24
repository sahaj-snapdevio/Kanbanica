"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

interface SpaceActionDialogProps {
  action: () => Promise<{ ok: true } | { error: string }>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  spaceName: string;
  variant: "archive" | "delete";
  workspaceId: string;
}

const CONFIG = {
  archive: {
    title: (name: string) => `Archive "${name}"?`,
    description:
      "The Project will be hidden from the sidebar. All data is preserved and can be restored from Settings at any time.",
    confirmLabel: "Archive",
    buttonVariant: "default" as const,
    successMessage: (name: string) => `"${name}" archived`,
  },
  delete: {
    title: (name: string) => `Delete "${name}"?`,
    description:
      "This will permanently delete the Project and all its Lists, Tasks, Comments, and uploaded files. This cannot be undone.",
    confirmLabel: "Delete permanently",
    buttonVariant: "destructive" as const,
    successMessage: (name: string) => `"${name}" deleted`,
  },
};

export function SpaceActionDialog({
  open,
  onOpenChange,
  spaceName,
  variant,
  action,
  workspaceId,
}: SpaceActionDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const config = CONFIG[variant];

  function handleConfirm() {
    startTransition(async () => {
      const result = await action();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(config.successMessage(spaceName));
      onOpenChange(false);
      router.push(`/${workspaceId}`);
      router.refresh();
    });
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{config.title(spaceName)}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() => onOpenChange(false)}
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            className="gap-2"
            disabled={pending}
            onClick={handleConfirm}
            variant={config.buttonVariant}
          >
            {pending && <Spinner className="size-4" />}
            {config.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
