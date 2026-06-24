import { Skeleton } from "@/components/ui/skeleton";

export default function SpaceSettingsLoading() {
  return (
    <div className="mt-4 rounded-xl border bg-card p-6">
      {/* Section heading */}
      <div className="space-y-2">
        <Skeleton className="h-5 w-40 rounded" />
        <Skeleton className="h-3.5 w-64 rounded" />
      </div>

      <div className="mt-6 space-y-3">
        {/* Member / field rows */}
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            className="flex items-center gap-3 rounded-md border px-3 py-2.5"
            key={i}
          >
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-36 rounded" />
              <Skeleton className="h-3 w-48 rounded" />
            </div>
            <Skeleton className="ml-auto h-7 w-20 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
