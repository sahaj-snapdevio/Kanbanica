"use client";

import type { Icon } from "@phosphor-icons/react";
import {
  CameraIcon,
  ClockCounterClockwiseIcon,
  GlobeIcon,
  TerminalIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

interface TabDef {
  href: string;
  icon: Icon;
  label: string;
}

interface CubeDetailTabsProps {
  /** When false, the Snapshots tab is hidden — no storage backend is
   *  configured so snapshot creation would fail. Defaults to true so
   *  legacy admin callers don't lose the tab. */
  canCreateSnapshot?: boolean;
  cubeId: string;
  spaceId: string;
}

/**
 * Route-aware tab nav for the cube detail page.
 *
 * Each tab is a `<Link>` to its own route (`/cubes/[id]/connect` etc.),
 * so refreshing or deep-linking lands on the same tab. Active state is
 * derived from `usePathname()`.
 */
export function CubeDetailTabs({
  spaceId,
  cubeId,
  canCreateSnapshot = true,
}: CubeDetailTabsProps) {
  const pathname = usePathname();
  const base = `/${spaceId}/cubes/${cubeId}`;

  const tabs: TabDef[] = [
    { href: `${base}/connect`, label: "Connect", icon: TerminalIcon },
    { href: `${base}/networking`, label: "Networking", icon: GlobeIcon },
    ...(canCreateSnapshot
      ? [
          {
            href: `${base}/snapshots`,
            label: "Snapshots",
            icon: CameraIcon,
          },
        ]
      : []),
    {
      href: `${base}/activity`,
      label: "Activity",
      icon: ClockCounterClockwiseIcon,
    },
  ];

  return (
    // `min-w-0` on the wrapper lets the inner nav properly own its
    // overflow within a CSS grid column. Without it the column tries to
    // size to its content and the last tab (`Activity`) gets clipped.
    <div className="mb-4 min-w-0">
      <div
        aria-label="Cube sections"
        className="flex w-fit [scrollbar-width:none] items-center gap-1 overflow-x-auto rounded-md bg-muted p-[3px] [&::-webkit-scrollbar]:hidden"
        role="tablist"
      >
        {tabs.map((tab) => {
          const active =
            pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          const Icon = tab.icon;
          return (
            <Link
              aria-selected={active}
              className={cn(
                "relative inline-flex shrink-0 items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-foreground/60 hover:text-foreground"
              )}
              href={tab.href}
              key={tab.href}
              prefetch
              role="tab"
            >
              <Icon className="size-4" />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
