import { Badge } from "@/components/ui/badge";
import { RESOURCE_STATUS_CLASSES } from "@/lib/status-display";
import { cn } from "@/lib/utils";

interface ResourceStatusBadgeProps {
  className?: string;
  status: string;
}

export function ResourceStatusBadge({
  status,
  className,
}: ResourceStatusBadgeProps) {
  return (
    <Badge
      className={cn(
        "border-0 text-xs",
        RESOURCE_STATUS_CLASSES[status] ?? "bg-muted text-muted-foreground",
        className
      )}
      variant="secondary"
    >
      {status}
    </Badge>
  );
}
