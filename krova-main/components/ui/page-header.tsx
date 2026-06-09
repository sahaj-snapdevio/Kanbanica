import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Standard page header used at the top of every dashboard / orbit page.
 * Replaces dozens of ad-hoc `<div className="flex items-center justify-between">`
 * + `<h1 className="text-2xl font-semibold tracking-tight">` blocks so titles,
 * descriptions, and action buttons have one consistent visual rhythm.
 */
function PageHeader({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-header"
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function PageHeaderContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-header-content"
      className={cn("min-w-0 space-y-1", className)}
      {...props}
    />
  )
}

function PageHeaderTitle({ className, ...props }: React.ComponentProps<"h1">) {
  return (
    <h1
      data-slot="page-header-title"
      className={cn(
        "text-2xl font-semibold tracking-tight text-foreground",
        className
      )}
      {...props}
    />
  )
}

function PageHeaderDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="page-header-description"
      className={cn("max-w-prose text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function PageHeaderActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-header-actions"
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-2 [&_button]:h-9",
        className
      )}
      {...props}
    />
  )
}

export {
  PageHeader,
  PageHeaderContent,
  PageHeaderTitle,
  PageHeaderDescription,
  PageHeaderActions,
}
