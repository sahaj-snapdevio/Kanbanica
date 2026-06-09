import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 10 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton
          <Skeleton className="h-14 w-full rounded-lg" key={i} />
        ))}
      </div>
    </div>
  );
}
