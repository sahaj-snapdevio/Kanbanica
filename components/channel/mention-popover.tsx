"use client";

import * as React from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface MentionMember {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

interface MentionPopoverProps {
  query: string;
  members: MentionMember[];
  onSelect: (member: MentionMember) => void;
  onClose: () => void;
  position: { top: number; left: number } | null;
  visible: boolean;
}

export function MentionPopover({
  query,
  members,
  onSelect,
  onClose,
  position,
  visible,
}: MentionPopoverProps) {
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);

  const filtered = React.useMemo(() => {
    if (!query) return members.slice(0, 8);
    const q = query.toLowerCase();
    return members
      .filter((m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, members]);

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length, query]);

  // Keyboard navigation
  React.useEffect(() => {
    if (!visible) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          onSelect(filtered[selectedIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [visible, filtered, selectedIndex, onSelect, onClose]);

  // Scroll selected into view
  React.useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[selectedIndex] as HTMLElement;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!visible || filtered.length === 0) return null;

  function getInitials(name: string) {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }

  return (
    <div
      className="absolute z-50 w-64 rounded-lg border bg-popover shadow-lg"
      style={
        position
          ? { bottom: position.top, left: position.left }
          : { bottom: "100%", left: 0 }
      }
    >
      <div ref={listRef} className="max-h-48 overflow-y-auto p-1">
        {filtered.map((m, i) => (
          <button
            key={m.id}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(m);
            }}
            onMouseEnter={() => setSelectedIndex(i)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
              i === selectedIndex
                ? "bg-accent text-accent-foreground"
                : "text-foreground hover:bg-accent/50",
            )}
          >
            <Avatar className="size-6 shrink-0">
              <AvatarFallback className="text-[10px]">{getInitials(m.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{m.name}</p>
              <p className="truncate text-xs text-muted-foreground">{m.email}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
