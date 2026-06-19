import { Skeleton } from "@/components/ui/skeleton";

function FieldRowSkeleton() {
  return (
    <div className="flex items-center gap-3 py-3 border-b last:border-b-0">
      <div className="flex items-center gap-2 w-32 shrink-0">
        <Skeleton className="size-3.5 rounded-full" />
        <Skeleton className="h-3.5 w-16 rounded" />
      </div>
      <Skeleton className="h-6 w-28 rounded-full" />
    </div>
  );
}

export function TaskDetailSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b px-5 py-3 shrink-0">
        <Skeleton className="size-7 rounded-md shrink-0" />
        <div className="flex items-center gap-2">
          <Skeleton className="size-4 rounded" />
          <Skeleton className="h-4 w-24 rounded" />
          <Skeleton className="size-3 rounded" />
          <Skeleton className="h-4 w-48 rounded" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-6 w-20 rounded-md" />
          <Skeleton className="h-6 w-16 rounded-md" />
          <Skeleton className="size-7 rounded-md" />
        </div>
      </div>

      {/* Two-column body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Left: main content ── */}
        <div className="flex-1 min-w-0 overflow-y-auto px-8 py-6">
          {/* Title */}
          <Skeleton className="h-8 w-3/4 rounded-lg mb-5" />

          {/* Fields card */}
          <div className="rounded-lg border bg-card px-4 mb-6">
            <FieldRowSkeleton />
            <FieldRowSkeleton />
            <FieldRowSkeleton />
            <FieldRowSkeleton />
            <FieldRowSkeleton />
          </div>

          {/* Description label */}
          <div className="flex items-center gap-2 mb-3">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-4 w-24 rounded" />
          </div>

          {/* Description body */}
          <div className="rounded-lg border bg-card p-4 mb-6 space-y-2.5">
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-5/6 rounded" />
            <Skeleton className="h-4 w-4/6 rounded" />
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-2/3 rounded" />
          </div>

          {/* Attachments section */}
          <div className="rounded-lg border bg-card p-4 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Skeleton className="size-4 rounded" />
              <Skeleton className="h-4 w-24 rounded" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Skeleton className="h-20 rounded-lg" />
              <Skeleton className="h-20 rounded-lg" />
              <Skeleton className="h-20 rounded-lg" />
            </div>
          </div>

          {/* Checklist section */}
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Skeleton className="size-4 rounded" />
              <Skeleton className="h-4 w-20 rounded" />
              <Skeleton className="ml-auto h-2 w-32 rounded-full" />
            </div>
            <div className="space-y-2.5">
              <div className="flex items-center gap-2">
                <Skeleton className="size-4 rounded" />
                <Skeleton className="h-4 w-full rounded" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="size-4 rounded" />
                <Skeleton className="h-4 w-4/5 rounded" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="size-4 rounded" />
                <Skeleton className="h-4 w-3/5 rounded" />
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: activity sidebar ── */}
        <div className="w-80 xl:w-96 shrink-0 border-l flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {/* Comment composer */}
            <Skeleton className="h-20 w-full rounded-lg mb-5" />

            {/* Activity items */}
            <div className="space-y-5">
              {/* Comment item */}
              <div className="flex gap-3">
                <Skeleton className="size-7 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-3.5 w-20 rounded" />
                    <Skeleton className="h-3 w-14 rounded" />
                  </div>
                  <Skeleton className="h-16 w-full rounded-lg" />
                </div>
              </div>

              {/* Activity log item */}
              <div className="flex gap-3 items-start">
                <Skeleton className="size-7 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5 pt-0.5">
                  <Skeleton className="h-3.5 w-3/4 rounded" />
                  <Skeleton className="h-3 w-16 rounded" />
                </div>
              </div>

              {/* Comment item */}
              <div className="flex gap-3">
                <Skeleton className="size-7 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-3.5 w-24 rounded" />
                    <Skeleton className="h-3 w-14 rounded" />
                  </div>
                  <Skeleton className="h-10 w-full rounded-lg" />
                </div>
              </div>

              {/* Activity log item */}
              <div className="flex gap-3 items-start">
                <Skeleton className="size-7 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5 pt-0.5">
                  <Skeleton className="h-3.5 w-2/3 rounded" />
                  <Skeleton className="h-3 w-20 rounded" />
                </div>
              </div>

              {/* Activity log item */}
              <div className="flex gap-3 items-start">
                <Skeleton className="size-7 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5 pt-0.5">
                  <Skeleton className="h-3.5 w-4/5 rounded" />
                  <Skeleton className="h-3 w-12 rounded" />
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t px-5 py-3 shrink-0">
            <Skeleton className="h-3.5 w-40 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}
