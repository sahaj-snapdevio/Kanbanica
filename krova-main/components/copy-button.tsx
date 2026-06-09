"use client";

import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

/**
 * Icon button that copies `value` to the clipboard, swaps the icon to a
 * checkmark for ~1.5s, and fires a success / error toast. Centralizes the
 * stateful copy-button pattern that previously lived inline in every
 * orbit table + sheet (subscriptions, credit-purchases, space-detail,
 * job-log-stream, ...).
 *
 * Defaults to a `size-6` ghost icon button to match the original inline
 * implementations in the orbit tables. Pass `size`, `variant`, or
 * `className` to opt out.
 *
 * Pass `successMessage` to override the toast text (e.g. "API key copied").
 *
 * Use `<CopyButton>` for icon-button UIs; reach for the bare
 * `copyToClipboard` helper from `lib/clipboard.ts` when the copy
 * affordance is not a button (e.g. an inline action menu item).
 */
export function CopyButton({
  value,
  successMessage,
  ariaLabel = "Copy",
  className,
  size = "icon",
  variant = "ghost",
  iconClassName = "size-3",
  stopPropagation = true,
}: {
  value: string;
  successMessage?: string;
  ariaLabel?: string;
  className?: string;
  size?: React.ComponentProps<typeof Button>["size"];
  variant?: React.ComponentProps<typeof Button>["variant"];
  iconClassName?: string;
  /**
   * Default true — calls `e.stopPropagation()` so a CopyButton placed
   * inside a clickable table row does not trigger the row navigation.
   * Set to false when the parent does not have a click handler.
   */
  stopPropagation?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      aria-label={ariaLabel}
      className={cn("size-6", className)}
      onClick={(e) => {
        if (stopPropagation) {
          e.stopPropagation();
        }
        copyToClipboard(value, successMessage).then((ok) => {
          if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        });
      }}
      size={size}
      type="button"
      variant={variant}
    >
      {copied ? (
        <CheckIcon className={iconClassName} />
      ) : (
        <CopyIcon className={iconClassName} />
      )}
    </Button>
  );
}
