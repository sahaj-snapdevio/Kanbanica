"use client";

import { ClockCounterClockwiseIcon, GearIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

interface SettingsNavProps {
  spaceId: string;
}

export function SettingsNav({ spaceId }: SettingsNavProps) {
  const pathname = usePathname();

  const items = [
    {
      href: `/${spaceId}/settings`,
      label: "General",
      icon: GearIcon,
    },
    {
      href: `/${spaceId}/settings/audit-logs`,
      label: "Audit Logs",
      icon: ClockCounterClockwiseIcon,
    },
  ];

  return (
    <div className="mb-4 min-w-0">
      <nav className="flex w-fit [scrollbar-width:none] items-center gap-1 overflow-x-auto rounded-md bg-muted p-[3px] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => {
          // The base /settings route should only match exactly, not its
          // sub-routes. Sub-routes (like /settings/audit-logs) use startsWith.
          const isBaseRoute = item.href === `/${spaceId}/settings`;
          const active = isBaseRoute
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              className={cn(
                "relative inline-flex shrink-0 items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-foreground/60 hover:text-foreground"
              )}
              href={item.href}
              key={item.href}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
