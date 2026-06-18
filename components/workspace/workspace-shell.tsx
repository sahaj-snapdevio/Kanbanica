"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArchiveIcon,
  BellIcon,
  CaretUpDownIcon,
  CheckCircleIcon,
  CheckIcon,
  CopyIcon,
  DotsThreeIcon,
  FolderIcon,
  GearIcon,
  ListIcon,
  LockSimpleIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  SignOutIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { SearchPalette } from "@/components/search/search-palette";
import { archiveSpace, deleteSpace } from "@/app/actions/space";
import { archiveList, duplicateList } from "@/app/actions/list";
import { SpaceActionDialog } from "@/components/workspace/space-action-dialog";
import { authClient } from "@/lib/auth-client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { CreateSpaceModal } from "@/components/workspace/create-space-modal";
import { CreateListModal } from "@/components/list/create-list-modal";
import { EditListDialog } from "@/components/list/edit-list-dialog";
import { DeleteListDialog } from "@/components/list/delete-list-dialog";
import { NotificationBell } from "@/components/notifications/notification-bell";

interface WorkspaceSummary {
  id: string;
  name: string;
  logoEmoji: string | null;
}

interface ListSummary {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
}

interface SpaceSummary {
  id: string;
  name: string;
  color: string | null;
  isPrivate: boolean;
  canManageList: boolean;
  lists: ListSummary[];
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
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [createSpaceOpen, setCreateSpaceOpen] = React.useState(false);
  const [spaceAction, setSpaceAction] = React.useState<{ id: string; name: string; variant: "archive" | "delete" } | null>(null);
  const [createListForSpace, setCreateListForSpace] = React.useState<{ spaceId: string } | null>(null);
  const [editList, setEditList] = React.useState<{ spaceId: string; list: ListSummary } | null>(null);
  const [deleteList, setDeleteList] = React.useState<{ spaceId: string; list: ListSummary } | null>(null);

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

  // Ctrl+K / Cmd+K shortcut
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
  }

  return (
    <div className="flex h-screen flex-col bg-background overflow-hidden">
      <SearchPalette
        workspaceId={workspace.id}
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
      />
      <CreateSpaceModal
        open={createSpaceOpen}
        onOpenChange={setCreateSpaceOpen}
        workspaceId={workspace.id}
      />

      {createListForSpace && (
        <CreateListModal
          open
          onOpenChange={(open) => !open && setCreateListForSpace(null)}
          workspaceId={workspace.id}
          spaceId={createListForSpace.spaceId}
        />
      )}

      {editList && (
        <EditListDialog
          open
          onOpenChange={(open) => !open && setEditList(null)}
          workspaceId={workspace.id}
          spaceId={editList.spaceId}
          list={editList.list}
        />
      )}

      {deleteList && (
        <DeleteListDialog
          open
          onOpenChange={(open) => !open && setDeleteList(null)}
          workspaceId={workspace.id}
          spaceId={deleteList.spaceId}
          list={deleteList.list}
        />
      )}

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

      {/* Global top bar */}
      <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center border-b bg-card px-3 gap-3">
        {/* Mobile sidebar toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 lg:hidden shrink-0"
          onClick={() => setSidebarOpen(true)}
        >
          <ListIcon className="size-5" />
        </Button>

        {/* Workspace switcher — left side */}
        <Popover>
          <PopoverTrigger asChild>
            <button className="flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-accent max-w-45">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold">
                {workspaceBadge(workspace)}
              </span>
              <span className="truncate hidden sm:block">{workspace.name}</span>
              <CaretUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
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

        <div className="h-5 w-px bg-border shrink-0" />

        {/* Centered search bar */}
        <div className="flex flex-1 justify-center">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 h-8 w-full max-w-md rounded-md border bg-muted/50 px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <MagnifyingGlassIcon className="size-4 shrink-0" />
            <span className="flex-1 text-left text-sm">Search…</span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border bg-background px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
              Ctrl K
            </kbd>
          </button>
        </div>

        {/* Right side — notification bell */}
        <NotificationBell />
      </header>

      {/* Body: sidebar + main content */}
      <div className="flex flex-1 overflow-hidden">

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-12 left-0 z-30 flex w-60 shrink-0 flex-col border-r bg-card transition-transform duration-200 lg:static lg:inset-y-auto lg:h-full",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        {/* Spaces nav */}
        <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
          {/* Global links */}
          <div className="space-y-0.5">
            {[
              {
                href: `/${workspace.id}/my-tasks`,
                label: "My Tasks",
                icon: <CheckCircleIcon className="size-4 shrink-0" weight="fill" />,
              },
            ].map(({ href, label, icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {icon}
                  {label}
                </Link>
              );
            })}
          </div>

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
                    <FolderIcon
                      className="size-4 shrink-0"
                      weight="fill"
                      style={{ color: s.color ?? "#9CA3AF" }}
                    />
                    <span className="flex-1 truncate">{s.name}</span>
                    {s.isPrivate && (
                      <LockSimpleIcon className="size-3 shrink-0 text-muted-foreground" />
                    )}
                    {s.canManageList && (
                      <button
                        onClick={() => setCreateListForSpace({ spaceId: s.id })}
                        className="opacity-0 transition-opacity group-hover:opacity-100 flex size-5 items-center justify-center rounded hover:bg-accent"
                        title="Add list"
                      >
                        <PlusIcon className="size-3.5 text-muted-foreground" />
                      </button>
                    )}
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          className="opacity-0 transition-opacity group-hover:opacity-100 flex size-5 items-center justify-center rounded hover:bg-accent"
                          title="Space options"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DotsThreeIcon className="size-4.5 text-muted-foreground" weight="bold" />
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
                          href={`/${workspace.id}/${s.id}/activity`}
                          onClick={() => setSidebarOpen(false)}
                          className="flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                        >
                          <GearIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          Activity
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
                        <div key={l.id} className="group/list relative flex items-center">
                          <Link
                            href={href}
                            onClick={() => setSidebarOpen(false)}
                            className={cn(
                              "flex flex-1 items-center gap-2 rounded-md py-1.5 pr-7 pl-6 text-sm transition-colors",
                              active
                                ? "bg-accent font-medium text-accent-foreground"
                                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                            )}
                          >
                            <ListIcon
                              className="size-3.5 shrink-0"
                              weight="bold"
                              style={{ color: l.color ?? "#9CA3AF" }}
                            />
                            <span className="truncate">{l.name}</span>
                          </Link>
                          {s.canManageList && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <button
                                  className="absolute right-1 opacity-0 transition-opacity group-hover/list:opacity-100 flex size-5 items-center justify-center rounded hover:bg-accent"
                                  title="List options"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <DotsThreeIcon className="size-4.5 text-foreground/70" weight="bold" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent side="right" align="start" className="w-44 p-1">
                                <button
                                  onClick={() => setEditList({ spaceId: s.id, list: l })}
                                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                                >
                                  <PencilSimpleIcon className="size-3.5 shrink-0 text-muted-foreground" />
                                  Edit
                                </button>
                                <button
                                  onClick={async () => {
                                    await duplicateList(workspace.id, s.id, l.id);
                                  }}
                                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                                >
                                  <CopyIcon className="size-3.5 shrink-0 text-muted-foreground" />
                                  Duplicate
                                </button>
                                <div className="my-1 h-px bg-border" />
                                <button
                                  onClick={async () => {
                                    await archiveList(workspace.id, s.id, l.id);
                                  }}
                                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                >
                                  <ArchiveIcon className="size-3.5 shrink-0" />
                                  Archive
                                </button>
                                {isAdmin && (
                                  <button
                                    onClick={() => setDeleteList({ spaceId: s.id, list: l })}
                                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
                                  >
                                    <TrashIcon className="size-3.5 shrink-0" />
                                    Delete
                                  </button>
                                )}
                              </PopoverContent>
                            </Popover>
                          )}
                        </div>
                      );
                    })}
                    {s.canManageList && (
                      <button
                        onClick={() => setCreateListForSpace({ spaceId: s.id })}
                        className="flex w-full items-center gap-2 rounded-md py-1.5 pl-6 pr-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <PlusIcon className="size-3" />
                        Add list
                      </button>
                    )}
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
              <Link
                href={`/${workspace.id}/notifications/settings`}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                <BellIcon className="size-4" />
                Notification settings
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
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-auto">{children}</main>
      </div>

      </div>{/* end body row */}
    </div>
  );
}
