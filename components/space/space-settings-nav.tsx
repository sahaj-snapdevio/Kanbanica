"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface SpaceSettingsNavProps {
  spaceId: string;
  workspaceId: string;
}

const NAV_ITEMS = [
  { label: "General", path: "general" },
  { label: "Members", path: "members" },
];

export function SpaceSettingsNav({
  workspaceId,
  spaceId,
}: SpaceSettingsNavProps) {
  const pathname = usePathname();
  const base = `/${workspaceId}/${spaceId}/settings`;

  return (
    <nav className="flex gap-1 border-b mb-6">
      {NAV_ITEMS.map((item) => {
        const href = `${base}/${item.path}`;
        const active = pathname === href;
        return (
          <Link
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            href={href}
            key={item.path}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
