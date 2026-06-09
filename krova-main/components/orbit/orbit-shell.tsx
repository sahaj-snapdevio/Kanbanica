"use client";

import {
  ArchiveIcon,
  ArrowLeftIcon,
  CameraIcon,
  ChartLineIcon,
  ClockCounterClockwiseIcon,
  CoinsIcon,
  CubeIcon,
  CurrencyDollarIcon,
  GlobeIcon,
  HardDriveIcon,
  HardDrivesIcon,
  KeyIcon,
  LightningIcon,
  PlugIcon,
  QueueIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  SlidersIcon,
  StackIcon,
  TagIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavProgress } from "@/components/nav-progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { initPusherConfig } from "@/hooks/use-pusher";

const infrastructureItems = [
  { label: "Regions", href: "/orbit/regions", icon: GlobeIcon },
  { label: "Servers", href: "/orbit/servers", icon: HardDrivesIcon },
  { label: "Storage", href: "/orbit/storage", icon: HardDriveIcon },
  { label: "SSH Keys", href: "/orbit/ssh-keys", icon: KeyIcon },
  { label: "Ports", href: "/orbit/ports", icon: PlugIcon },
];

const managementItems = [
  { label: "Users", href: "/orbit/users", icon: UsersIcon },
  { label: "Spaces", href: "/orbit/spaces", icon: StackIcon },
  { label: "Cubes", href: "/orbit/cubes", icon: CubeIcon },
  { label: "Snapshots", href: "/orbit/snapshots", icon: CameraIcon },
  { label: "Backups", href: "/orbit/backups", icon: ArchiveIcon },
  { label: "Domains", href: "/orbit/domains", icon: GlobeIcon },
  { label: "Webhooks", href: "/orbit/webhooks", icon: LightningIcon },
  { label: "Plans", href: "/orbit/plans", icon: TagIcon },
  {
    label: "Subscriptions",
    href: "/orbit/subscriptions",
    icon: ReceiptIcon,
  },
  {
    label: "Credit Purchases",
    href: "/orbit/credit-purchases",
    icon: CoinsIcon,
  },
  {
    label: "Platform settings",
    href: "/orbit/platform-settings",
    icon: SlidersIcon,
  },
  { label: "Billing", href: "/orbit/billing", icon: CurrencyDollarIcon },
  { label: "Queues", href: "/orbit/queues", icon: QueueIcon },
  {
    label: "Audit Logs",
    href: "/orbit/audit-logs",
    icon: ClockCounterClockwiseIcon,
  },
];

interface PusherClientConfig {
  cluster: string;
  host?: string;
  key: string;
  port?: number;
}

export function OrbitShell({
  children,
  pusherConfig,
}: {
  children: React.ReactNode;
  pusherConfig: PusherClientConfig;
}) {
  // Initialize Pusher client config before any child components render.
  // Children use usePusherChannel/usePusherEvent hooks that depend on this.
  // Without this, JobLogStream's "Live" indicator never flips on and the
  // ServerSetupCard never auto-refreshes after a phase advances.
  initPusherConfig(pusherConfig);

  const pathname = usePathname();

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="p-4">
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="size-5 text-primary" weight="fill" />
            <span className="text-sm font-semibold">Orbit Admin</span>
            <Badge
              className="ml-auto px-1.5 py-0 text-[10px]"
              variant="secondary"
            >
              Admin
            </Badge>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Overview</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/orbit"}>
                    <Link href="/orbit">
                      <ChartLineIcon className="size-4" />
                      <span>Dashboard</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Infrastructure</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {infrastructureItems.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname.startsWith(item.href)}
                    >
                      <Link href={item.href}>
                        <item.icon className="size-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Management</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {managementItems.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname.startsWith(item.href)}
                    >
                      <Link href={item.href}>
                        <item.icon className="size-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="p-4">
          <Link
            className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            href="/post-auth"
          >
            <ArrowLeftIcon className="size-4" />
            <span>Dashboard</span>
          </Link>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 items-center gap-4 border-b px-6">
          <SidebarTrigger />
          <Separator className="h-6" orientation="vertical" />
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheckIcon className="size-4" />
            <span>Orbit Admin</span>
          </div>
        </header>
        <NavProgress />
        <main className="flex-1 p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
