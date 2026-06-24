"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface ListSettingsNavProps {
  workspaceId: string;
  spaceId: string;
  listId: string;
}

const NAV_ITEMS = [
  { label: "General",  path: "general" },
  { label: "Statuses", path: "statuses" },
];

export function ListSettingsNav({ workspaceId, spaceId, listId }: ListSettingsNavProps) {
  const pathname = usePathname();
  const base = `/${workspaceId}/${spaceId}/list/${listId}/settings`;

  return (
    <nav className="flex gap-1 border-b mb-6">
      {NAV_ITEMS.map((item) => {
        const href = `${base}/${item.path}`;
        const active = pathname === href;
        return (
          <Link
            key={item.path}
            href={href}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
