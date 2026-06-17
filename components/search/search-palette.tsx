"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  MagnifyingGlassIcon,
  XIcon,
  ListIcon,
  SquaresFourIcon,
  UserIcon,
  ClockIcon,
} from "@phosphor-icons/react";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { globalSearch, recordSearchVisit, type GlobalSearchResults } from "@/app/actions/search";
import { cn } from "@/lib/utils";
import { format, isPast } from "date-fns";

interface SearchPaletteProps {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
}

const PRIORITY_LABELS: Record<string, string> = {
  NONE: "No priority",
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

export function SearchPalette({ workspaceId, open, onClose }: SearchPaletteProps) {
  const router = useRouter();
  const { query, setQuery, debouncedQuery } = useDebouncedSearch(300);
  const [results, setResults] = React.useState<GlobalSearchResults | null>(null);
  const [loading, setLoading] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Focus input when opened
  React.useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
      setResults(null);
    }
  }, [open, setQuery]);

  // Search on debounced query change
  React.useEffect(() => {
    if (!debouncedQuery) {
      setResults(null);
      return;
    }
    setLoading(true);
    globalSearch(workspaceId, debouncedQuery)
      .then((res) => {
        if (!("error" in res)) setResults(res);
      })
      .finally(() => setLoading(false));
  }, [debouncedQuery, workspaceId]);

  // Close on Escape
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  async function navigateTask(taskId: string) {
    await recordSearchVisit(workspaceId, "task", taskId);
    onClose();
    router.push(`/${workspaceId}/task/${taskId}`);
  }

  async function navigateList(listId: string, spaceId: string) {
    await recordSearchVisit(workspaceId, "list", listId);
    onClose();
    router.push(`/${workspaceId}/${spaceId}/list/${listId}`);
  }

  async function navigateSpace(spaceId: string) {
    await recordSearchVisit(workspaceId, "space", spaceId);
    onClose();
    router.push(`/${workspaceId}/${spaceId}`);
  }

  if (!open) return null;

  const hasResults =
    results &&
    (results.tasks.length > 0 ||
      results.lists.length > 0 ||
      results.spaces.length > 0 ||
      results.members.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-xl rounded-xl border bg-card shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <MagnifyingGlassIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search tasks, lists, spaces, members…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
              <XIcon className="size-4" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 text-2xs font-medium text-muted-foreground">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              Searching…
            </div>
          )}

          {!loading && debouncedQuery && !hasResults && (
            <div className="flex flex-col items-center gap-2 py-10">
              <MagnifyingGlassIcon className="size-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No results for &ldquo;{debouncedQuery}&rdquo;</p>
            </div>
          )}

          {!loading && !debouncedQuery && (
            <div className="flex flex-col items-center gap-2 py-10">
              <MagnifyingGlassIcon className="size-8 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">Type 2+ characters to search</p>
            </div>
          )}

          {!loading && hasResults && results && (
            <div className="divide-y">
              {/* Tasks */}
              {results.tasks.length > 0 && (
                <section className="py-2">
                  <p className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Tasks
                  </p>
                  {results.tasks.map((t) => {
                    const overdue =
                      t.dueDateEnd && isPast(new Date(t.dueDateEnd));
                    return (
                      <button
                        key={t.id}
                        onClick={() => navigateTask(t.id)}
                        className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-accent transition-colors"
                      >
                        <span
                          className="mt-0.5 inline-flex h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: t.statusColor }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-sm font-medium">{t.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {t.spaceName} › {t.listName}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {t.dueDateEnd && (
                            <span
                              className={cn(
                                "text-xs",
                                overdue ? "text-destructive" : "text-muted-foreground",
                              )}
                            >
                              {format(new Date(t.dueDateEnd), "MMM d")}
                            </span>
                          )}
                          <span
                            className="rounded-full px-2 py-0.5 text-2xs font-medium"
                            style={{ backgroundColor: t.statusColor + "33", color: t.statusColor }}
                          >
                            {t.statusName}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </section>
              )}

              {/* Lists */}
              {results.lists.length > 0 && (
                <section className="py-2">
                  <p className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Lists
                  </p>
                  {results.lists.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => navigateList(l.id, l.spaceId)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-accent transition-colors"
                    >
                      <ListIcon className="size-4 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium">{l.name}</p>
                        <p className="text-xs text-muted-foreground">{l.spaceName}</p>
                      </div>
                    </button>
                  ))}
                </section>
              )}

              {/* Spaces */}
              {results.spaces.length > 0 && (
                <section className="py-2">
                  <p className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Spaces
                  </p>
                  {results.spaces.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => navigateSpace(s.id)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-accent transition-colors"
                    >
                      <SquaresFourIcon className="size-4 shrink-0 text-muted-foreground" />
                      <p className="truncate text-sm font-medium">{s.name}</p>
                    </button>
                  ))}
                </section>
              )}

              {/* Members */}
              {results.members.length > 0 && (
                <section className="py-2">
                  <p className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Members
                  </p>
                  {results.members.map((m) => (
                    <div
                      key={m.userId}
                      className="flex w-full items-center gap-3 px-4 py-2"
                    >
                      <UserIcon className="size-4 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium">{m.name ?? m.email}</p>
                        {m.name && (
                          <p className="text-xs text-muted-foreground">{m.email}</p>
                        )}
                      </div>
                      <span className="text-2xs text-muted-foreground uppercase">
                        {m.role}
                      </span>
                    </div>
                  ))}
                </section>
              )}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-3 border-t px-4 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <ClockIcon className="size-3" /> recent items tracked automatically
          </span>
        </div>
      </div>
    </div>
  );
}
