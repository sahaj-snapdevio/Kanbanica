import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="rounded-md border">
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 7 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton placeholders with no item identity
          <Skeleton className="mt-px h-14 w-full" key={i} />
        ))}
      </div>
    </div>
  );
}
