"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CaretUpDownIcon,
  CheckIcon,
  GearIcon,
  ListIcon,
  LockSimpleIcon,
  PlusIcon,
  SignOutIcon,
  XIcon,
} from "@phosphor-icons/react";
import { authClient } from "@/lib/auth-client";
import type { WorkspaceRole } from "@prisma/client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface WorkspaceSummary {
  id: string;
  name: string;
  logoEmoji: string | null;
}

interface SpaceSummary {
  id: string;
  name: string;
  color: string | null;
  isPrivate: boolean;
  lists: { id: string; name: string }[];
}

interface WorkspaceShellProps {
  children: React.ReactNode;
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  spaces: SpaceSummary[];
  role: WorkspaceRole;
  user: { name: string | null; email: string };
}

function workspaceBadge(ws: WorkspaceSummary) {
  return ws.logoEmoji ?? ws.name.charAt(0).toUpperCase();
}

export function WorkspaceShell({
  children,
  workspace,
  workspaces,
  spaces,
  role,
  user,
}: WorkspaceShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  const initials = user.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : user.email.slice(0, 2).toUpperCase();
  const displayName = user.name || user.email;
  const isAdmin = role === "OWNER" || role === "ADMIN";

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen bg-background">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r bg-card transition-transform duration-200 lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Workspace switcher */}
        <div className="flex h-14 items-center gap-1 px-3 border-b">
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex flex-1 min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-accent transition-colors">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs">
                  {workspaceBadge(workspace)}
                </span>
                <span className="truncate">{workspace.name}</span>
                <CaretUpDownIcon className="size-3.5 shrink-0 text-muted-foreground ml-auto" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-1">
              <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Workspaces
              </p>
              {workspaces.map((ws) => (
                <Link
                  key={ws.id}
                  href={`/${ws.id}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs">
                    {workspaceBadge(ws)}
                  </span>
                  <span className="truncate flex-1">{ws.name}</span>
                  {ws.id === workspace.id && <CheckIcon className="size-4 text-primary" />}
                </Link>
              ))}
              <Separator className="my-1" />
              <Link
                href="/onboarding?new=1"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <PlusIcon className="size-4" />
                Create workspace
              </Link>
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden shrink-0"
            onClick={() => setSidebarOpen(false)}
          >
            <XIcon className="size-4" />
          </Button>
        </div>

        {/* Spaces nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
          <div>
            <p className="px-2 pb-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Spaces
            </p>
            <div className="space-y-0.5">
              {spaces.map((space) => (
                <div key={space.id}>
                  <div className="flex items-center gap-2 px-2 py-1.5 text-sm font-medium">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: space.color ?? "#9CA3AF" }}
                    />
                    <span className="truncate">{space.name}</span>
                    {space.isPrivate && (
                      <LockSimpleIcon className="size-3 shrink-0 text-muted-foreground" />
                    )}
                  </div>
                  <div className="space-y-0.5">
                    {space.lists.map((list) => {
                      const href = `/${workspace.id}/${space.id}/list/${list.id}`;
                      const active = pathname === href;
                      return (
                        <Link
                          key={list.id}
                          href={href}
                          onClick={() => setSidebarOpen(false)}
                          className={cn(
                            "flex items-center gap-2 rounded-md py-1.5 pl-7 pr-2 text-sm transition-colors",
                            active
                              ? "bg-accent text-accent-foreground font-medium"
                              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                          )}
                        >
                          <span className="truncate">{list.name}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </nav>

        {/* Bottom bar — settings (admin+) + user profile (docs/design-system.md) */}
        <div className="border-t p-2 space-y-0.5">
          {isAdmin && (
            <Link
              href={`/${workspace.id}/settings/general`}
              onClick={() => setSidebarOpen(false)}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                pathname.startsWith(`/${workspace.id}/settings`)
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <GearIcon className="size-4 shrink-0" />
              Workspace Settings
            </Link>
          )}

          <Popover>
            <PopoverTrigger asChild>
              <button className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent transition-colors">
                <Avatar size="sm" className="h-6 w-6 shrink-0">
                  <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                </Avatar>
                <span className="truncate text-sm">{displayName}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="min-w-[200px] p-1">
              <div className="flex items-center gap-2.5 px-2 py-2">
                <Avatar size="sm">
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{displayName}</p>
                  <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                </div>
              </div>
              <Separator className="my-1" />
              {[
                { label: "Profile & Account", hint: "Arrives with account settings" },
                { label: "Sessions", hint: "Arrives with account settings" },
                { label: "Notifications", hint: "Arrives with notifications" },
              ].map((item) => (
                <button
                  key={item.label}
                  disabled
                  title={item.hint}
                  className="w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground/60 cursor-not-allowed"
                >
                  {item.label}
                </button>
              ))}
              <Separator className="my-1" />
              <button
                onClick={handleSignOut}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent transition-colors"
              >
                <SignOutIcon className="size-4" />
                Sign out
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col min-w-0">
        <header className="sticky top-0 z-10 flex h-14 items-center border-b bg-background/80 backdrop-blur-sm px-4 lg:hidden">
          <Button variant="ghost" size="icon-sm" onClick={() => setSidebarOpen(true)}>
            <ListIcon className="size-5" />
          </Button>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
