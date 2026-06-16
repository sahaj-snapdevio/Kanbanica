import * as React from "react"
import { cn } from "@/lib/utils"

interface StatGridProps extends React.ComponentProps<"div"> {
  columns?: 2 | 3 | 4
  variant?: "cards" | "plain"
}

function StatGrid({ className, columns = 3, variant = "cards", ...props }: StatGridProps) {
  const cols = {
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  }[columns]

  return (
    <div
      data-slot="stat-grid"
      data-variant={variant}
      className={cn("grid gap-4", cols, className)}
      {...props}
    />
  )
}

interface StatProps extends React.ComponentProps<"div"> {
  label: React.ReactNode
  value: React.ReactNode
  sublabel?: React.ReactNode
  icon?: React.ReactNode
  tone?: "default" | "destructive" | "success" | "warning"
}

const toneClasses: Record<NonNullable<StatProps["tone"]>, string> = {
  default: "",
  destructive: "border-destructive/30 bg-destructive/5",
  success: "border-emerald-500/30 bg-emerald-500/5",
  warning: "border-amber-500/30 bg-amber-500/5",
}

const toneValueClasses: Record<NonNullable<StatProps["tone"]>, string> = {
  default: "text-foreground",
  destructive: "text-destructive",
  success: "text-emerald-700 dark:text-emerald-400",
  warning: "text-amber-700 dark:text-amber-400",
}

function Stat({ className, label, value, sublabel, icon, tone = "default", ...props }: StatProps) {
  return (
    <div
      data-slot="stat"
      className={cn(
        "relative border bg-card p-4",
        "[[data-variant=plain]_&]:border-0 [[data-variant=plain]_&]:bg-transparent [[data-variant=plain]_&]:p-0",
        toneClasses[tone],
        className
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            {label}
          </p>
          <p className={cn("font-mono text-2xl leading-none font-semibold tabular-nums", toneValueClasses[tone])}>
            {value}
          </p>
          {sublabel && (
            <p className="text-xs text-muted-foreground">{sublabel}</p>
          )}
        </div>
        {icon && (
          <div className="shrink-0 text-muted-foreground [&>svg]:size-5">{icon}</div>
        )}
      </div>
    </div>
  )
}

export { StatGrid, Stat }
