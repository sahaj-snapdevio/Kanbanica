import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Compact list primitive for the "1, 2, 3" instructions that pile up
 * inside Sheet descriptions and Alert dialogs. Replaces long-form
 * paragraphs (one sentence per fact, packed together) so the customer
 * can scan the steps instead of reading a wall of text.
 *
 * Defaults to a bulleted list with emerald discs. Pass `variant="numbered"`
 * for procedural steps where order matters. Pass `variant="checks"` for
 * "here's what's included" lists.
 *
 * Used inside `<SheetDescription>` / `<AlertDialogDescription>` — both of
 * those wrap children in a `<p>` by default, so the parent should pass
 * `asChild` and render this in a `<div>`.
 *
 *   <SheetDescription asChild>
 *     <div className="space-y-3">
 *       <p>Brief one-liner that summarizes what this dialog does.</p>
 *       <InstructionList items={["Fact one", "Fact two", "Fact three"]} />
 *     </div>
 *   </SheetDescription>
 */

export interface InstructionListProps {
  className?: string;
  items: React.ReactNode[];
  variant?: "bulleted" | "numbered" | "checks";
}

export function InstructionList({
  items,
  variant = "bulleted",
  className,
}: InstructionListProps) {
  if (items.length === 0) {
    return null;
  }
  if (variant === "numbered") {
    return (
      <ol
        className={cn(
          "ml-0 list-none space-y-1.5 text-sm text-muted-foreground",
          className
        )}
      >
        {items.map((item, idx) => (
          <li
            className="flex items-start gap-2"
            // biome-ignore lint/suspicious/noArrayIndexKey: instruction lists are static, order-stable
            key={idx}
          >
            <span
              aria-hidden
              className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[10px] font-medium text-primary tabular-nums"
            >
              {idx + 1}
            </span>
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ol>
    );
  }
  if (variant === "checks") {
    return (
      <ul
        className={cn(
          "ml-0 list-none space-y-1.5 text-sm text-muted-foreground",
          className
        )}
      >
        {items.map((item, idx) => (
          <li
            className="flex items-start gap-2"
            // biome-ignore lint/suspicious/noArrayIndexKey: instruction lists are static, order-stable
            key={idx}
          >
            <span
              aria-hidden
              className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-emerald-600 dark:text-emerald-400"
            >
              ✓
            </span>
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul
      className={cn(
        "ml-0 list-none space-y-1.5 text-sm text-muted-foreground",
        className
      )}
    >
      {items.map((item, idx) => (
        <li
          className="flex items-start gap-2"
          // biome-ignore lint/suspicious/noArrayIndexKey: instruction lists are static, order-stable
          key={idx}
        >
          <span
            aria-hidden
            className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500/70"
          />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}
