"use client";

/**
 * Generic admin "trigger a server-side action" button + confirm dialog.
 * Shares the trigger + AlertDialog + useMutation + toast wiring that
 * was duplicated across update-images-button, refresh-caddy-button,
 * and update-caddy-button. Each call site now collapses to a ~10-line
 * config block — the icon, the dialog body, the URL, and the success
 * message are the only varying parts.
 *
 * Use this for idempotent admin operations that route through the worker
 * queue (POST → enqueue job → toast). For destructive operations that
 * need a type-the-name-to-confirm step, see <ConfirmDestructiveDialog>
 * instead (forthcoming).
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useMutation } from "@/hooks/use-mutation";

export interface ServerActionButtonProps {
  /** Overrides the dialog action button label (defaults to `label`). */
  confirmLabel?: string;
  /** AlertDialog body — pass rich JSX (lists, warnings, code samples). */
  description: React.ReactNode;
  /** Server endpoint to POST to. */
  endpoint: string;
  /** Toast text on failure. */
  errorMessage: string;
  /** Icon rendered in the trigger button. */
  icon: React.ReactNode;
  /** Trigger button label + dialog action label come from the same source
   *  — the action verb (e.g. "Update Images", "Refresh Routing"). */
  label: string;
  size?: React.ComponentProps<typeof Button>["size"];
  /** Toast text on success. */
  successMessage: string;
  /** AlertDialog title — usually `"Verb on {hostname}?"`. */
  title: React.ReactNode;
  /** Trigger button variant + size. */
  variant?: React.ComponentProps<typeof Button>["variant"];
}

export function ServerActionButton({
  label,
  icon,
  title,
  description,
  endpoint,
  successMessage,
  errorMessage,
  confirmLabel,
  variant = "outline",
  size = "sm",
}: ServerActionButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { trigger: mutate, isMutating } = useMutation({
    onSuccess: () => router.refresh(),
  });

  async function confirm() {
    await mutate({
      url: endpoint,
      method: "POST",
      successMessage,
      errorMessage,
    });
    setOpen(false);
  }

  return (
    <>
      <Button
        disabled={isMutating}
        onClick={() => setOpen(true)}
        size={size}
        variant={variant}
      >
        {isMutating && <Spinner className="mr-1 size-4" />}
        {icon}
        {label}
      </Button>

      <AlertDialog onOpenChange={setOpen} open={open}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription asChild className="space-y-3">
              <div>{description}</div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isMutating}
              onClick={() => void confirm()}
            >
              {isMutating && <Spinner className="mr-1 size-4" />}
              {confirmLabel ?? label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
