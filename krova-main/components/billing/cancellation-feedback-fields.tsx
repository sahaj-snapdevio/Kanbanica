"use client";

import { CaretDownIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CANCELLATION_REASON_LABELS,
  CANCELLATION_REASON_OPTIONS,
  type CancellationReason,
} from "@/lib/billing/cancellation-reasons";

/**
 * Optional cancellation-feedback inputs rendered inside the cancel-subscription
 * AlertDialog. Both fields are optional — the customer can cancel without
 * filling either. Reason values are Polar's documented
 * `customer_cancellation_reason` enum; comment is the free-text companion.
 */
export function CancellationFeedbackFields({
  reason,
  comment,
  onReasonChange,
  onCommentChange,
  disabled,
}: {
  reason: CancellationReason | null;
  comment: string;
  onReasonChange: (reason: CancellationReason | null) => void;
  onCommentChange: (comment: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3 pt-2">
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">
          Why are you cancelling?{" "}
          <span className="text-xs font-normal text-muted-foreground">
            (optional — helps us improve)
          </span>
        </Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="w-full justify-between font-normal"
              disabled={disabled}
              type="button"
              variant="outline"
            >
              {reason ? CANCELLATION_REASON_LABELS[reason] : "Pick a reason…"}
              <CaretDownIcon className="size-4 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width)">
            {reason !== null && (
              <DropdownMenuItem onClick={() => onReasonChange(null)}>
                <span className="text-muted-foreground">
                  Clear / prefer not to say
                </span>
              </DropdownMenuItem>
            )}
            {CANCELLATION_REASON_OPTIONS.map((opt) => (
              <DropdownMenuItem
                key={opt.value}
                onClick={() => onReasonChange(opt.value)}
              >
                {opt.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">
          Anything else?{" "}
          <span className="text-xs font-normal text-muted-foreground">
            (optional)
          </span>
        </Label>
        <Textarea
          className="min-h-16 resize-none text-sm"
          disabled={disabled}
          maxLength={1000}
          onChange={(e) => onCommentChange(e.target.value)}
          placeholder="Tell us what went wrong, or what would have kept you."
          value={comment}
        />
      </div>
    </div>
  );
}
