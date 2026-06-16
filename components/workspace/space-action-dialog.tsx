"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceName: string;
  variant: "archive" | "delete";
  action: () => Promise<{ ok: true } | { error: string }>;
  workspaceId: string;
}

const CONFIG = {
  archive: {
    title: (name: string) => `Archive "${name}"?`,
    description: "The Space will be hidden from the sidebar. All data is preserved and can be restored from Settings at any time.",
    confirmLabel: "Archive",
    buttonVariant: "default" as const,
    successMessage: (name: string) => `"${name}" archived`,
  },
  delete: {
    title: (name: string) => `Delete "${name}"?`,
    description: "This will permanently delete the Space and all its Lists, Tasks, Comments, and uploaded files. This cannot be undone.",
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{config.title(spaceName)}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant={config.buttonVariant} disabled={pending} onClick={handleConfirm} className="gap-2">
            {pending && <Spinner className="size-4" />}
            {config.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
