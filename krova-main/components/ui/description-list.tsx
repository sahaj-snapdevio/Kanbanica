import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * KV pair list with a consistent label column width and visual rhythm.
 * Replaces the many ad-hoc `flex justify-between` blocks scattered across
 * detail pages (server detail, plan detail, user detail, cube detail, etc.).
 *
 * Layout:
 *   <DescriptionList>
 *     <DescriptionListItem label="Plan">Pro</DescriptionListItem>
 *     <DescriptionListItem label="Region">Frankfurt</DescriptionListItem>
 *   </DescriptionList>
 *
 * - Renders a real semantic `<dl>` / `<dt>` / `<dd>` so screen readers Read it.
 * - Label column is fixed at `min(40%, 180px)` so two side-by-side cards line up.
 * - Values are right-aligned (matches the "right-side action / right-side
 *   value" rhythm used elsewhere in the app), but a `value="left"` variant is
 *   provided for long-form prose.
 */
function DescriptionList({ className, ...props }: React.ComponentProps<"dl">) {
  return (
    <dl
      data-slot="description-list"
      className={cn("divide-y divide-border text-sm", className)}
      {...props}
    />
  )
}

interface DescriptionListItemProps extends React.ComponentProps<"div"> {
  label: React.ReactNode
  /** "right" (default) right-aligns the value in tabular-aware contexts. */
  align?: "right" | "left"
  /** Render values as monospace tabular numbers (default true for right-align). */
  numeric?: boolean
  children?: React.ReactNode
}

function DescriptionListItem({
  className,
  label,
  align = "right",
  numeric,
  children,
  ...props
}: DescriptionListItemProps) {
  const isNumeric = numeric ?? align === "right"
  return (
    <div
      data-slot="description-list-item"
      className={cn(
        "flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0",
        className
      )}
      {...props}
    >
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 text-foreground",
          align === "right" ? "text-right" : "text-left",
          isNumeric && "font-mono tabular-nums"
        )}
      >
        {children}
      </dd>
    </div>
  )
}

export { DescriptionList, DescriptionListItem }
