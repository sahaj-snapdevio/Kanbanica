"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArchiveIcon,
  CaretUpDownIcon,
  CheckIcon,
  DotsThreeIcon,
  GearIcon,
  LockSimpleIcon,
  PlusIcon,
  SignOutIcon,
  TrashIcon,
  XIcon,
  ListIcon,
} from "@phosphor-icons/react";
import { archiveSpace, deleteSpace } from "@/app/actions/space";
import { SpaceActionDialog } from "@/components/workspace/space-action-dialog";
import { authClient } from "@/lib/auth-client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { CreateSpaceModal } from "@/components/workspace/create-space-modal";

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
  role: string;
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
  const [createSpaceOpen, setCreateSpaceOpen] = React.useState(false);
  const [spaceAction, setSpaceAction] = React.useState<{ id: string; name: string; variant: "archive" | "delete" } | null>(null);

  const initials = user.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user.email.slice(0, 2).toUpperCase();
  const displayName = user.name || user.email;
  const isAdmin = role === "OWNER" || role === "ADMIN";

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen bg-background">
      <CreateSpaceModal
        open={createSpaceOpen}
        onOpenChange={setCreateSpaceOpen}
        workspaceId={workspace.id}
      />

      {spaceAction && (
        <SpaceActionDialog
          open
          onOpenChange={(open) => !open && setSpaceAction(null)}
          spaceName={spaceAction.name}
          variant={spaceAction.variant}
          workspaceId={workspace.id}
          action={() =>
            spaceAction.variant === "delete"
              ? deleteSpace(workspace.id, spaceAction.id)
              : archiveSpace(workspace.id, spaceAction.id)
          }
        />
      )}

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
        <div className="flex h-14 items-center gap-1 border-b px-3">
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-accent">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs">
                  {workspaceBadge(workspace)}
                </span>
                <span className="truncate">{workspace.name}</span>
                <CaretUpDownIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-1">
              <p className="px-2 py-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Workspaces
              </p>
              {workspaces.map((ws) => (
                <Link
                  key={ws.id}
                  href={`/${ws.id}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs">
                    {workspaceBadge(ws)}
                  </span>
                  <span className="flex-1 truncate">{ws.name}</span>
                  {ws.id === workspace.id && <CheckIcon className="size-4 text-primary" />}
                </Link>
              ))}
              <Separator className="my-1" />
              <Link
                href="/onboarding?new=1"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <PlusIcon className="size-4" />
                Create workspace
              </Link>
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden shrink-0 size-8"
            onClick={() => setSidebarOpen(false)}
          >
            <XIcon className="size-4" />
          </Button>
        </div>

        {/* Spaces nav */}
        <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
          <div>
            <div className="flex items-center px-2 pb-1">
              <p className="flex-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Spaces
              </p>
              {isAdmin && (
                <button
                  onClick={() => setCreateSpaceOpen(true)}
                  className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title="Create Space"
                >
                  <PlusIcon className="size-3.5" />
                </button>
              )}
            </div>
            <div className="space-y-0.5">
              {spaces.map((s) => (
                <div key={s.id}>
                  <div className="group flex items-center gap-2 px-2 py-1.5 font-medium text-sm">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: s.color ?? "#9CA3AF" }}
                    />
                    <span className="flex-1 truncate">{s.name}</span>
                    {s.isPrivate && (
                      <LockSimpleIcon className="size-3 shrink-0 text-muted-foreground" />
                    )}
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          className="opacity-0 transition-opacity group-hover:opacity-100 flex size-5 items-center justify-center rounded hover:bg-accent"
                          title="Space options"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DotsThreeIcon className="size-4 text-muted-foreground" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent side="right" align="start" className="w-48 p-1">
                        <Link
                          href={`/${workspace.id}/${s.id}/settings/general`}
                          onClick={() => setSidebarOpen(false)}
                          className="flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                        >
                          <GearIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          Settings
                        </Link>
                        <Link
                          href={`/${workspace.id}/${s.id}/settings/members`}
                          onClick={() => setSidebarOpen(false)}
                          className="flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                        >
                          <LockSimpleIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          Members & Permissions
                        </Link>
                        <div className="my-1 h-px bg-border" />
                        <button
                          onClick={() => setSpaceAction({ id: s.id, name: s.name, variant: "archive" })}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <ArchiveIcon className="size-3.5 shrink-0" />
                          Archive Space
                        </button>
                        <button
                          onClick={() => setSpaceAction({ id: s.id, name: s.name, variant: "delete" })}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
                        >
                          <TrashIcon className="size-3.5 shrink-0" />
                          Delete Space
                        </button>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-0.5">
                    {s.lists.map((l) => {
                      const href = `/${workspace.id}/${s.id}/list/${l.id}`;
                      const active = pathname === href;
                      return (
                        <Link
                          key={l.id}
                          href={href}
                          onClick={() => setSidebarOpen(false)}
                          className={cn(
                            "flex items-center gap-2 rounded-md py-1.5 pr-2 pl-7 text-sm transition-colors",
                            active
                              ? "bg-accent font-medium text-accent-foreground"
                              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                          )}
                        >
                          <ListIcon className="size-3.5 shrink-0" />
                          <span className="truncate">{l.name}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </nav>

        {/* Bottom user menu */}
        <div className="border-t p-2">
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-accent">
                <Avatar className="size-7 shrink-0">
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
                <span className="flex-1 truncate text-left">{displayName}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="top" className="w-56 p-1">
              <Link
                href={`/${workspace.id}/settings/general`}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                <GearIcon className="size-4" />
                Workspace settings
              </Link>
              <Separator className="my-1" />
              <button
                onClick={handleSignOut}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-accent"
              >
                <SignOutIcon className="size-4" />
                Sign out
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header */}
        <header className="flex h-14 items-center gap-3 border-b px-4 lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => setSidebarOpen(true)}
          >
            <ListIcon className="size-5" />
          </Button>
          <span className="font-semibold text-sm">{workspace.name}</span>
        </header>

        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
