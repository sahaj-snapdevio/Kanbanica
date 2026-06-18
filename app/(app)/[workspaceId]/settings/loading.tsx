import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div className="rounded-xl border bg-card p-6">
      {/* Section heading */}
      <div className="space-y-2">
        <Skeleton className="h-5 w-40 rounded" />
        <Skeleton className="h-3.5 w-64 rounded" />
      </div>

      <div className="mt-6 space-y-5">
        {/* Logo / avatar block */}
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-32 rounded" />
            <Skeleton className="h-3 w-48 rounded" />
          </div>
        </div>

        {/* Field rows */}
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3.5 w-24 rounded" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        ))}

        {/* Save button */}
        <div className="flex justify-end pt-2">
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
      </div>
    </div>
  );
}
