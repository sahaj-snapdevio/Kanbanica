"use client";

import * as React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { MentionMember } from "@/app/actions/mention";

interface MentionListProps {
  items: MentionMember[];
  command: (item: { id: string; label: string }) => void;
}

export interface MentionListRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

function avatarSrc(key: string | null | undefined): string | undefined {
  return key ? `/api/files/${key}` : undefined;
}

export const MentionList = React.forwardRef<MentionListRef, MentionListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = React.useState(0);

    // Reset selection when items change
    React.useEffect(() => setSelectedIndex(0), [items]);

    const selectItem = React.useCallback(
      (index: number) => {
        const item = items[index];
        if (item) command({ id: item.id, label: item.name || item.email });
      },
      [items, command],
    );

    React.useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === "ArrowUp") {
          setSelectedIndex((i) => (i + items.length - 1) % items.length);
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((i) => (i + 1) % items.length);
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          selectItem(selectedIndex);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="rounded-xl border bg-popover shadow-lg px-3 py-2 text-xs text-muted-foreground">
          No members found
        </div>
      );
    }

    return (
      <div className="w-64 rounded-xl border bg-popover shadow-lg overflow-hidden">
        {/* People section header */}
        <p className="px-3 pt-2.5 pb-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          People
        </p>

        <div className="max-h-56 overflow-y-auto pb-1">
          {items.map((item, i) => (
            <button
              key={item.id}
              onMouseDown={(e) => {
                // Prevent the editor from losing focus before the command fires
                e.preventDefault();
                selectItem(i);
              }}
              onMouseEnter={() => setSelectedIndex(i)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors",
                i === selectedIndex ? "bg-accent" : "hover:bg-accent/60",
              )}
            >
              <div className="relative shrink-0">
                <Avatar className="size-7">
                  {item.image && <AvatarImage src={avatarSrc(item.image)} />}
                  <AvatarFallback className="text-2xs bg-primary/10 text-primary font-semibold">
                    {initials(item.name)}
                  </AvatarFallback>
                </Avatar>
                {/* Online indicator placeholder */}
                <span className="absolute bottom-0 right-0 size-2 rounded-full border-2 border-popover bg-muted-foreground/40" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate text-foreground">{item.name}</p>
                <p className="text-2xs text-muted-foreground truncate">{item.email}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Footer hint */}
        <div className="border-t px-3 py-1.5 flex items-center gap-2 text-2xs text-muted-foreground">
          <span><kbd className="font-mono bg-muted px-1 py-0.5 rounded text-2xs">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono bg-muted px-1 py-0.5 rounded text-2xs">↵</kbd> select</span>
        </div>
      </div>
    );
  },
);

MentionList.displayName = "MentionList";
