import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/**
 * Labelled resource-usage bar — shows `used / total (pct%)` with a progress
 * indicator that turns amber above 70% and red above 90%.
 *
 * - `variant="detail"` (default) — larger spacing/text, for the server detail page.
 * - `variant="compact"` — denser, for the servers table.
 */
export function UsageBar({
  label,
  used,
  total,
  variant = "detail",
}: {
  label: string;
  used: number;
  total: number;
  variant?: "detail" | "compact";
}) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  const detail = variant === "detail";
  return (
    <div className={detail ? "space-y-2" : "space-y-1"}>
      <div
        className={cn(
          "flex items-center justify-between",
          detail ? "text-sm" : "text-xs text-muted-foreground"
        )}
      >
        <span className={detail ? "font-medium" : undefined}>{label}</span>
        <span className={detail ? "text-muted-foreground" : undefined}>
          {used} / {total} ({pct}%)
        </span>
      </div>
      <Progress
        className={cn(
          detail ? "h-2" : "h-1.5",
          pct > 90
            ? "*:data-[slot=progress-indicator]:bg-red-500"
            : pct > 70
              ? "*:data-[slot=progress-indicator]:bg-yellow-500"
              : ""
        )}
        value={pct}
      />
    </div>
  );
}
