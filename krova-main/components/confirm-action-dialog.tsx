"use client";

/**
 * Single-button "Are you sure?" destructive-action dialog — the simpler
 * sibling of `ConfirmDestructiveDialog`. Use when the action is
 * irreversible enough to warrant a confirm step, but trivial enough that
 * a typed-name gate would be ceremony (e.g. delete a snapshot, remove a
 * member, revoke an API key, delete a TCP port mapping).
 *
 * For the destructive type-the-name pattern (delete cube, delete space),
 * use `ConfirmDestructiveDialog` instead — it gates the action button on
 * a matching string and is the right call when an accidental click would
 * destroy customer data the customer cannot reconstruct.
 *
 * Controlled: caller owns `open` + `onOpenChange` so any trigger (icon
 * button, menu item, table-row action) can surface the dialog. `onConfirm`
 * does NOT auto-close — caller decides (so a failed action can keep the
 * dialog open with the toast surfaced). The wrapper prevents the
 * Radix default-close by calling `e.preventDefault()` on the action click.
 */

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
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export interface ConfirmActionDialogProps {
  /** True while the action is in flight. Disables both buttons and renders
   *  a spinner inside the action button. */
  busy?: boolean;
  /** Cancel button label. Defaults to `"Cancel"`. Override for confirmations
   *  where a more concrete dismiss verb reads better — e.g. `"Keep plan"`
   *  on a cancel-subscription dialog. */
  cancelLabel?: string;
  /** Action button label. Defaults to `"Confirm"`. Concrete verbs read
   *  better in destructive contexts — pass `"Delete"`, `"Remove"`,
   *  `"Revoke"`, etc. */
  confirmLabel?: string;
  /** Body content. String becomes a single paragraph; ReactNode is
   *  wrapped in a vertical-stacked container so multiple paragraphs /
   *  lists nest cleanly. */
  description: React.ReactNode;
  /** When true, the action button uses the destructive (red) variant.
   *  Default true — this dialog exists for destructive flows. Set to
   *  false for "are you sure?" prompts that are not data-destructive
   *  (e.g. transferring ownership, re-sending an invite). */
  destructive?: boolean;
  /** Optional content rendered BETWEEN the description and the action
   *  footer. Use for inline form fields that should accompany the confirm
   *  (e.g. the cancellation-reason picker on subscription cancel). */
  extraContent?: React.ReactNode;
  /** Called when the user clicks the action button. Dialog does NOT
   *  auto-close — caller decides. */
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  /** AlertDialog title. */
  title: React.ReactNode;
}

export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  busy = false,
  onConfirm,
  cancelLabel = "Cancel",
  confirmLabel = "Confirm",
  destructive = true,
  extraContent,
}: ConfirmActionDialogProps) {
  return (
    <AlertDialog
      onOpenChange={(next) => {
        if (busy) {
          return;
        }
        onOpenChange(next);
      }}
      open={open}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {extraContent}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            className={cn(
              destructive &&
                "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            )}
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              if (busy) {
                return;
              }
              onConfirm();
            }}
          >
            {busy && <Spinner className="size-4" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
