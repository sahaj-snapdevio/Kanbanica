"use client";

/**
 * "Type the name to confirm" destructive dialog — the irreversible-action
 * equivalent of <ServerActionButton>. Shares the AlertDialog + input gate
 * + spinner wiring repeated 7+ times across the codebase (delete cube,
 * delete backup, delete space, delete user account, delete SSH key,
 * delete storage backend, etc.).
 *
 * Controlled: the caller owns `open` + `onOpenChange` so the parent can
 * surface the dialog from any trigger (icon button, menu item, etc.).
 * `confirmText` is what the user must type (case-sensitive); the action
 * button stays disabled until the input matches AND `busy` is false.
 *
 * `description` can be a string OR rich JSX — the dialog wraps it in
 * `<AlertDialogDescription asChild><div className="space-y-3">…</div>`
 * so paragraphs / lists / warnings nest cleanly.
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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export interface ConfirmDestructiveDialogProps {
  /** True while the destructive action is in flight. Disables the input
   *  and the action button + renders a spinner inside the action button. */
  busy?: boolean;
  /** When true, the input/expected comparison is `trim().toLowerCase()` on
   *  both sides. Use for email confirmations (where mixed-case is the norm
   *  for the local-part) — without this, a user with `Alice@example.com`
   *  who types `alice@example.com` is stuck at a disabled button. Defaults
   *  to false (exact case-sensitive match) for the more typical name/slug
   *  confirmation case. */
  caseInsensitive?: boolean;
  /** Action button label. Defaults to `"Delete"`. */
  confirmLabel?: string;
  /** Exact string the user must type to enable the confirm button. */
  confirmText: string;
  /** Current value of the input — caller owns the state so it can be
   *  cleared on close / submit. */
  confirmValue: string;
  /** Body content. String becomes a single paragraph; ReactNode is
   *  wrapped in a vertical-stacked container so multiple paragraphs /
   *  lists / warnings render with consistent spacing. */
  description: React.ReactNode;
  /** Optional content rendered BETWEEN the type-the-name input and the
   *  action footer. Use for adjacent destructive-action toggles like the
   *  "Preserve backup before deleting" checkbox on cube-delete. Renders
   *  outside `<AlertDialogDescription>` so its typography is not muted. */
  extraContent?: React.ReactNode;
  /** Optional placeholder text for the input. Defaults to `confirmText`
   *  so the user sees exactly what to type. */
  inputPlaceholder?: string;
  /** Called when the user clicks the action button after a successful
   *  match. The dialog does NOT auto-close — the caller decides (so a
   *  failed action can keep the dialog open with the input preserved). */
  onConfirm: () => void;
  /** Setter for the input. */
  onConfirmValueChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  /** AlertDialog title. */
  title: React.ReactNode;
}

export function ConfirmDestructiveDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  confirmValue,
  onConfirmValueChange,
  busy = false,
  caseInsensitive = false,
  onConfirm,
  confirmLabel = "Delete",
  inputPlaceholder,
  extraContent,
}: ConfirmDestructiveDialogProps) {
  const matches = caseInsensitive
    ? confirmValue.trim().toLowerCase() === confirmText.trim().toLowerCase()
    : confirmValue === confirmText;
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
        <Input
          autoComplete="off"
          disabled={busy}
          onChange={(e) => onConfirmValueChange(e.target.value)}
          placeholder={inputPlaceholder ?? confirmText}
          spellCheck={false}
          value={confirmValue}
        />
        {extraContent}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={!matches || busy}
            onClick={(e) => {
              e.preventDefault();
              if (!matches || busy) {
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
