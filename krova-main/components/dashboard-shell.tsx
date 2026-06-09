"use client";

import {
  ArchiveIcon,
  CubeIcon,
  CurrencyDollarIcon,
  GearIcon,
  LightningIcon,
  ListIcon,
  ShieldCheckIcon,
  SignOutIcon,
  SquaresFourIcon,
  UserIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NavProgress } from "@/components/nav-progress";
import { SpaceSwitcher } from "@/components/space-switcher";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { UserMenu } from "@/components/user-menu";
import { LOGO_PATH } from "@/config/platform";
import { initPusherConfig } from "@/hooks/use-pusher";
import { signOut } from "@/lib/auth-client";
import { fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

interface SpaceInfo {
  creditBalance: number;
  id: string;
  isOwner: boolean;
  name: string;
}

interface UserInfo {
  email: string;
  id: string;
  image: string | null;
  name: string;
  role: string | null;
}

interface BrandingInfo {
  productName: string;
}

interface StorageCapabilities {
  canCreateBackup: boolean;
  canCreateSnapshot: boolean;
  hasActiveBackend: boolean;
}

interface DashboardShellProps {
  branding: BrandingInfo;
  children: React.ReactNode;
  impersonatingAs?: string;
  pusherConfig: { key: string; cluster: string; host?: string; port?: number };
  spaces: SpaceInfo[];
  storageCapabilities: StorageCapabilities;
  user: UserInfo;
}

export function DashboardShell({
  spaces,
  user,
  branding,
  pusherConfig,
  impersonatingAs,
  storageCapabilities,
  children,
}: DashboardShellProps) {
  // Initialize Pusher client config before any child components render.
  // Children use usePusherChannel/usePusherEvent hooks that depend on this.
  initPusherConfig(pusherConfig);
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const segments = pathname.split("/").filter(Boolean);
  const spaceIds = new Set(spaces.map((s) => s.id));
  const urlSpaceId =
    segments[0] && spaceIds.has(segments[0]) ? segments[0] : null;

  const firstSpace = spaces.length > 0 ? spaces[0] : null;

  function getStoredSpaceId(): string | null {
    if (typeof window === "undefined") {
      return null;
    }
    const stored = localStorage.getItem("krova:lastSpaceId");
    return stored && spaceIds.has(stored) ? stored : null;
  }

  const currentSpaceId =
    urlSpaceId ?? getStoredSpaceId() ?? (firstSpace ? firstSpace.id : "");

  useEffect(() => {
    if (currentSpaceId) {
      localStorage.setItem("krova:lastSpaceId", currentSpaceId);
    }
  }, [currentSpaceId]);

  // Close mobile menu on navigation
  const prevPathRef = useRef(pathname);
  useEffect(() => {
    if (prevPathRef.current !== pathname) {
      prevPathRef.current = pathname;
      requestAnimationFrame(() => setMobileMenuOpen(false));
    }
  }, [pathname]);

  const currentSpace = spaces.find((s) => s.id === currentSpaceId);

  const navItems = [
    {
      label: "Dashboard",
      href: `/${currentSpaceId}`,
      icon: SquaresFourIcon,
      active:
        pathname === `/${currentSpaceId}` || pathname === `/${currentSpaceId}/`,
    },
    {
      label: "Cubes",
      href: `/${currentSpaceId}/cubes`,
      icon: CubeIcon,
      active: pathname.startsWith(`/${currentSpaceId}/cubes`),
    },
    // Backups nav is hidden when no storage backend is configured.
    // Shown again automatically once an operator provisions one in Orbit.
    ...(storageCapabilities.canCreateBackup
      ? [
          {
            label: "Backups",
            href: `/${currentSpaceId}/backups`,
            icon: ArchiveIcon,
            active: pathname.startsWith(`/${currentSpaceId}/backups`),
          },
        ]
      : []),
    {
      label: "Billing",
      href: `/${currentSpaceId}/billing`,
      icon: CurrencyDollarIcon,
      active: pathname.startsWith(`/${currentSpaceId}/billing`),
    },
    {
      label: "Members",
      href: `/${currentSpaceId}/members`,
      icon: UsersIcon,
      active: pathname.startsWith(`/${currentSpaceId}/members`),
    },
    {
      label: "Webhooks",
      href: `/${currentSpaceId}/webhooks`,
      icon: LightningIcon,
      active: pathname.startsWith(`/${currentSpaceId}/webhooks`),
    },
    {
      label: "Settings",
      href: `/${currentSpaceId}/settings`,
      icon: GearIcon,
      active: pathname.startsWith(`/${currentSpaceId}/settings`),
    },
  ];

  const creditColor =
    (currentSpace?.creditBalance ?? 0) > 5
      ? "text-green-600 dark:text-green-400"
      : (currentSpace?.creditBalance ?? 0) >= 1
        ? "text-yellow-600 dark:text-yellow-400"
        : "text-red-600 dark:text-red-400";

  async function handleStopImpersonating() {
    await fetch("/api/orbit/stop-impersonating", { method: "POST" });
    window.location.href = "/orbit";
  }

  return (
    <div className="min-h-screen bg-background">
      <NavProgress />
      {/* ── Top Navigation Bar ── */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
        {impersonatingAs && (
          <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <span>
              Viewing as <strong>{impersonatingAs}</strong> · Admin session
            </span>
            <button
              className="rounded px-2 py-0.5 font-medium underline-offset-2 hover:underline"
              onClick={handleStopImpersonating}
              type="button"
            >
              Exit
            </button>
          </div>
        )}
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          {/* Logo */}
          <Link
            className="flex shrink-0 items-center gap-2"
            href={currentSpaceId ? `/${currentSpaceId}` : "/"}
          >
            <Image
              alt={branding.productName}
              className="h-7 w-auto"
              height={646}
              priority
              src={LOGO_PATH}
              width={1000}
            />
            <span className="text-lg font-bold tracking-tight">
              {branding.productName}
            </span>
          </Link>

          {/* Separator */}
          <div className="hidden h-5 w-px bg-border md:block" />

          {/* Desktop Navigation */}
          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => (
              <Link
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  item.active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                href={item.href}
                key={item.href}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Credit Balance (desktop) */}
          {currentSpace && (
            <Link
              className={cn(
                "hidden text-sm font-medium tabular-nums transition-opacity hover:opacity-80 md:inline",
                creditColor
              )}
              href={`/${currentSpaceId}/billing`}
            >
              ${fmtUsd(currentSpace.creditBalance)}
            </Link>
          )}

          {/* Space Switcher */}
          <div className="hidden md:block">
            <SpaceSwitcher
              currentSpaceId={currentSpaceId}
              spaces={spaces.map((s) => ({ id: s.id, name: s.name }))}
            />
          </div>

          {/* User Menu (desktop) */}
          <div className="hidden md:flex">
            <UserMenu
              email={user.email}
              image={user.image}
              name={user.name}
              role={user.role}
            />
          </div>

          {/* Mobile Menu Button */}
          <Button
            className="size-8 md:hidden"
            onClick={() => setMobileMenuOpen(true)}
            size="icon"
            variant="ghost"
          >
            <ListIcon className="size-5" />
          </Button>
        </div>
      </header>

      {/* ── Mobile Navigation Sheet ── */}
      <Sheet onOpenChange={setMobileMenuOpen} open={mobileMenuOpen}>
        <SheetContent className="w-72" side="right">
          <SheetHeader className="text-left">
            <SheetTitle className="text-base">Menu</SheetTitle>
            <SheetDescription className="sr-only">
              Navigation menu
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-6 py-4">
            {/* User info */}
            <div className="flex items-center gap-3 px-1">
              <Avatar className="size-9">
                <AvatarImage alt={user.name} src={user.image || undefined} />
                <AvatarFallback className="text-xs">
                  {user.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {user.email}
                </p>
              </div>
            </div>

            {/* Credit balance */}
            {currentSpace && (
              <Link
                className="block rounded-md border px-3 py-2 transition-colors hover:bg-muted"
                href={`/${currentSpaceId}/billing`}
              >
                <p className="text-xs text-muted-foreground">Credits</p>
                <p
                  className={cn(
                    "text-sm font-medium tabular-nums",
                    creditColor
                  )}
                >
                  ${fmtUsd(currentSpace.creditBalance)}
                </p>
              </Link>
            )}

            {/* Space switcher */}
            <SpaceSwitcher
              currentSpaceId={currentSpaceId}
              spaces={spaces.map((s) => ({ id: s.id, name: s.name }))}
            />

            {/* Navigation */}
            <nav className="flex flex-col gap-1">
              {navItems.map((item) => (
                <Link
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    item.active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  href={item.href}
                  key={item.href}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </Link>
              ))}
            </nav>

            {/* Account links */}
            <div className="border-t pt-4">
              <nav className="flex flex-col gap-1">
                <Link
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  href="/profile"
                >
                  <UserIcon className="size-4" />
                  Profile
                </Link>
                {user.role === "admin" && (
                  <Link
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    href="/orbit/users"
                  >
                    <ShieldCheckIcon className="size-4" />
                    Orbit Admin
                  </Link>
                )}
              </nav>
            </div>

            {/* Sign out */}
            <Button
              className="justify-start gap-2 text-muted-foreground"
              onClick={() =>
                signOut({
                  fetchOptions: {
                    onSuccess: () => {
                      window.location.href = "/login";
                    },
                  },
                })
              }
              variant="ghost"
            >
              <SignOutIcon className="size-4" />
              Sign out
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Main Content ── */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
