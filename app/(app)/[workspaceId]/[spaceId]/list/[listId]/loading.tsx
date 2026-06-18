import { Skeleton } from "@/components/ui/skeleton";

export default function ListLoading() {
  return (
    <div className="space-y-5 p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-2.5 w-2.5 rounded-full" />
        <Skeleton className="h-4 w-24 rounded" />
        <Skeleton className="h-3.5 w-3.5 rounded" />
        <Skeleton className="h-4 w-40 rounded" />
      </div>

      {/* Toolbar: view tabs + search + add task */}
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-3 border-b pb-2">
          <Skeleton className="h-4 w-12 rounded" />
          <Skeleton className="h-4 w-14 rounded" />
          <Skeleton className="h-4 w-14 rounded" />
        </div>
        <Skeleton className="h-8 w-48 rounded-md" />
        <Skeleton className="h-8 w-20 rounded-md" />
      </div>

      {/* Filter toolbar */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-7 w-20 rounded-md" />
        <Skeleton className="h-7 w-24 rounded-md" />
        <Skeleton className="h-7 w-20 rounded-md" />
      </div>

      {/* Task rows grouped by status */}
      <div className="space-y-6">
        {[5, 3].map((count, groupIndex) => (
          <div key={groupIndex} className="space-y-2">
            {/* Status group header */}
            <div className="flex items-center gap-2">
              <Skeleton className="h-2.5 w-2.5 rounded-full" />
              <Skeleton className="h-4 w-28 rounded" />
              <Skeleton className="h-4 w-6 rounded-full" />
            </div>

            {/* Rows */}
            <div className="space-y-1.5">
              {Array.from({ length: count }).map((_, rowIndex) => (
                <div
                  key={rowIndex}
                  className="flex items-center gap-3 rounded-md border px-3 py-2.5"
                >
                  <Skeleton className="h-4 w-4 shrink-0 rounded" />
                  <Skeleton className="h-4 flex-1 max-w-[280px] rounded" />
                  <div className="ml-auto flex items-center gap-2">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-5 w-12 rounded-full" />
                    <Skeleton className="h-6 w-6 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
