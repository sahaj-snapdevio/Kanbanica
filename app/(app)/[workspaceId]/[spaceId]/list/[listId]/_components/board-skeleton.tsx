import { Skeleton } from "@/components/ui/skeleton";

// Board-shaped loading skeleton — mirrors the column layout in board-view.tsx
// so switching into the Board view doesn't flash a blank panel.
export function BoardSkeleton({ columns = 4 }: { columns?: number }) {
  // Vary card counts per column so it reads as a real board, not a grid.
  const cardCounts = [3, 4, 2, 3, 2];

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {Array.from({ length: columns }).map((_, colIndex) => (
        <div
          className="flex w-72 shrink-0 flex-col gap-2 self-start rounded-xl bg-muted/40 p-2"
          key={colIndex}
        >
          {/* Column header */}
          <div className="flex items-center gap-2 px-1 py-1">
            <Skeleton className="h-2.5 w-2.5 rounded-full" />
            <Skeleton className="h-4 w-24 flex-1 rounded" />
            <Skeleton className="h-4 w-6 rounded-full" />
          </div>

          {/* Cards */}
          <div className="flex flex-col gap-2 p-1">
            {Array.from({
              length: cardCounts[colIndex % cardCounts.length],
            }).map((_, cardIndex) => (
              <div
                className="rounded-lg border bg-card p-3 shadow-sm"
                key={cardIndex}
              >
                <Skeleton className="h-4 w-[85%] rounded" />
                <div className="mt-1.5 flex gap-1">
                  <Skeleton className="h-4 w-12 rounded-full" />
                  <Skeleton className="h-4 w-10 rounded-full" />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <Skeleton className="h-3 w-8 rounded" />
                  <Skeleton className="h-7 w-7 rounded-full" />
                </div>
              </div>
            ))}
          </div>

          {/* Add task placeholder */}
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
      ))}
    </div>
  );
}
