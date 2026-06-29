"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  BellIcon,
  CaretDownIcon,
  CaretRightIcon,
  CaretUpDownIcon,
  CaretUpIcon,
  ChatCircleIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  DotsThreeIcon,
  FolderIcon,
  GearIcon,
  HeadsetIcon,
  TrayIcon,
  HashIcon,
  LightningIcon,
  ListIcon,
  LockSimpleIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  PushPinIcon,
  PushPinSlashIcon,
  SignOutIcon,
  TrashIcon,
  UserCircleIcon,
  UserPlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import useSWR, { useSWRConfig } from "swr";
import { SearchPalette } from "@/components/search/search-palette";
import { archiveSpace, deleteSpace, unarchiveSpace } from "@/app/actions/space";
import { archiveList, duplicateList, unarchiveList } from "@/app/actions/list";
import { SpaceActionDialog } from "@/components/workspace/space-action-dialog";
import { authClient } from "@/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { CreateSpaceModal } from "@/components/workspace/create-space-modal";
import { CreateListModal } from "@/components/list/create-list-modal";
import { CreateSprintModal } from "@/components/sprint/create-sprint-modal";
import { getSprintSettings } from "@/app/actions/sprint";
import { DeleteListDialog } from "@/components/list/delete-list-dialog";
import { PushNotificationBanner } from "@/components/notifications/push-notification-banner";
import { usePushSubscription } from "@/hooks/use-push-subscription";
import { CreateChannelModal } from "@/components/channel/create-channel-modal";
import { AddChannelMemberModal } from "@/components/channel/add-channel-member-modal";
import { TopbarProvider, useTopbarState } from "@/lib/topbar-context";

function formatSprintDate(date: Date | null, fmt: string): string {
  if (!date) return "?";
  const d = new Date(date);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(2);
  const yyyy = String(d.getFullYear());
  switch (fmt) {
    case "DD/MM": return `${dd}/${mm}`;
    case "MM/DD/YY": return `${mm}/${dd}/${yy}`;
    case "DD/MM/YY": return `${dd}/${mm}/${yy}`;
    case "YYYY/MM/DD": return `${yyyy}/${mm}/${dd}`;
    default: return `${mm}/${dd}`; // MM/DD
  }
}

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

interface SprintSummary {
  id: string;
  name: string;
  status: "PLANNED" | "ACTIVE" | "CLOSED";
  startDate: Date | null;
  endDate: Date | null;
}

interface SpaceSummary {
  id: string;
  name: string;
  color: string | null;
  isPrivate: boolean;
  canManageList: boolean;
  sprintDateFormat: string;
  lists: ListSummary[];
  archivedLists: ListSummary[];
  sprints: SprintSummary[];
}

interface ChannelSummary {
  id: string;
  name: string;
  createdAt: Date;
}

interface WorkspaceShellProps {
  children: React.ReactNode;
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  spaces: SpaceSummary[];
  archivedSpaces: SpaceSummary[];
  channels: ChannelSummary[];
  role: string;
  user: { name: string | null; email: string; image: string | null };
}

function workspaceBadge(ws: WorkspaceSummary) {
  return ws.logoEmoji ?? ws.name.charAt(0).toUpperCase();
}

export function WorkspaceShell({
  children,
  workspace,
  workspaces,
  spaces,
  archivedSpaces,
  channels,
  role,
  user,
}: WorkspaceShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  // Key of the currently-open sidebar three-dot menu (space / list), so it can
  // be closed when an item is selected. Only one menu is open at a time.
  const [openMenu, setOpenMenu] = React.useState<string | null>(null);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [createSpaceOpen, setCreateSpaceOpen] = React.useState(false);
  const [spaceAction, setSpaceAction] = React.useState<{ id: string; name: string; variant: "archive" | "delete" } | null>(null);
  const [createListForSpace, setCreateListForSpace] = React.useState<{ spaceId: string } | null>(null);
  const [deleteList, setDeleteList] = React.useState<{ spaceId: string; list: ListSummary } | null>(null);
  const [createChannelOpen, setCreateChannelOpen] = React.useState(false);
  const [addMemberChannel, setAddMemberChannel] = React.useState<{ id: string; name: string } | null>(null);
  const [createSprintForSpace, setCreateSprintForSpace] = React.useState<{ spaceId: string } | null>(null);
  function openSprintSettings(spaceId: string) {
    router.push(`/${workspace.id}/${spaceId}/settings/sprints`);
  }

  async function handleCreateSprintClick(spaceId: string, spaceName: string) {
    const settings = await getSprintSettings(workspace.id, spaceId);
    if ("error" in settings || settings.sprintStartDay === null) {
      openSprintSettings(spaceId);
    } else {
      setCreateSprintForSpace({ spaceId });
    }
  }

  // Auto-subscribe to push notifications if permission was already granted
  usePushSubscription();

  const { data: notifData } = useSWR<{ unreadCount: number }>(
    "/api/me/notifications?filter=unread",
    (url: string) => fetch(url).then((r) => r.json()),
    { refreshInterval: 30000 },
  );
  const unreadCount = notifData?.unreadCount ?? 0;

  const initials = user.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user.email.slice(0, 2).toUpperCase();
  const displayName = user.name || user.email;
  const avatarUrl = user.image ? `/api/files/${user.image}` : null;
  const isAdmin = role === "OWNER" || role === "ADMIN";
  const [expandedArchivedLists, setExpandedArchivedLists] = React.useState<Set<string>>(new Set());
  const [expandedSprintGroups, setExpandedSprintGroups] = React.useState<Set<string>>(new Set());
  const [showArchivedSpaces, setShowArchivedSpaces] = React.useState(false);
  const [profileOpen, setProfileOpen] = React.useState(false);
  const [showProjectPicker, setShowProjectPicker] = React.useState(false);

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

  // Auto-expand sprint group for the space whose sprint is currently active
  React.useEffect(() => {
    const match = pathname.match(/\/[^/]+\/([^/]+)\/sprint\//);
    if (match) {
      const spaceId = match[1];
      setExpandedSprintGroups((prev) => {
        if (prev.has(spaceId)) return prev;
        const next = new Set(prev);
        next.add(spaceId);
        return next;
      });
    }
  }, [pathname]);

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
  }

  return (
    <div className="workspace-shell flex h-screen bg-background overflow-hidden">
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

      {createSprintForSpace && (
        <CreateSprintModal
          open
          onOpenChange={(open) => !open && setCreateSprintForSpace(null)}
          workspaceId={workspace.id}
          spaceId={createSprintForSpace.spaceId}
          onCreated={() => setCreateSprintForSpace(null)}
          onOpenSettings={() => { setCreateSprintForSpace(null); openSprintSettings(createSprintForSpace.spaceId); }}
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

      <CreateChannelModal
        open={createChannelOpen}
        onOpenChange={setCreateChannelOpen}
        workspaceId={workspace.id}
      />

      {addMemberChannel && (
        <AddChannelMemberModal
          open
          onOpenChange={(open) => !open && setAddMemberChannel(null)}
          workspaceId={workspace.id}
          channelId={addMemberChannel.id}
          existingMemberIds={[]}
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

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — full height */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-60 shrink-0 flex-col border-r border-border bg-(--bg-sidebar) transition-transform duration-200 lg:static lg:h-full",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        {/* Workspace switcher at top of sidebar */}
        <div className="flex h-12 shrink-0 items-center border-b border-[rgba(255,255,255,0.06)] px-2">
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-(--bg-sidebar-item-hover) text-(--text-sidebar-active)">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/15 text-xs font-semibold text-(--text-sidebar-active)">
                  {workspaceBadge(workspace)}
                </span>
                <span className="flex-1 truncate text-left">{workspace.name}</span>
                <CaretUpDownIcon className="size-3.5 shrink-0 text-(--text-muted)" />
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
        </div>

        {/* Main nav */}
        <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
          {/* Global links */}
          <div className="space-y-0.5">
            {[
              {
                href: `/${workspace.id}/notifications`,
                label: "Inbox",
                icon: <TrayIcon className="size-4 shrink-0" weight="fill" />,
                badge: unreadCount > 0 ? unreadCount : null,
              },
              {
                href: `/${workspace.id}/my-tasks`,
                label: "My Tasks",
                icon: <CheckCircleIcon className="size-4 shrink-0" weight="fill" />,
                badge: null,
              },
            ].map(({ href, label, icon, badge }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    "relative flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] transition-colors select-none",
                    active
                      ? "bg-(--bg-sidebar-item-active) text-(--text-sidebar-active) font-medium overflow-hidden after:absolute after:left-0 after:inset-y-0 after:w-0.75 after:bg-primary"
                      : "text-(--text-sidebar) hover:bg-(--bg-sidebar-item-hover) hover:text-(--text-sidebar-active)",
                  )}
                >
                  {icon}
                  <span className="flex-1">{label}</span>
                  {badge !== null && (
                    <span className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-(--brand) px-1 text-2xs font-semibold text-white leading-none">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>

          <div>
            <div className="flex items-center px-3 pb-1 pt-2">
              <p className="flex-1 text-xs font-semibold tracking-widest uppercase text-(--text-muted)">
                Projects
              </p>
              {isAdmin && (
                <button
                  onClick={() => setCreateSpaceOpen(true)}
                  className="flex size-5 items-center justify-center rounded text-(--text-muted) transition-colors hover:bg-(--bg-sidebar-item-hover) hover:text-(--text-sidebar-active)"
                  title="Create Project"
                >
                  <PlusIcon className="size-3.5" />
                </button>
              )}
            </div>
            <div className="space-y-0.5">
              {spaces.map((s) => (
                <div key={s.id}>
                  <div className="group flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium text-(--text-sidebar-active)">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: s.color ?? "#9CA3AF" }}
                    />
                    <span className="flex-1 truncate">{s.name}</span>
                    {s.isPrivate && (
                      <LockSimpleIcon className="size-3 shrink-0 text-(--text-muted)" />
                    )}
                    {s.canManageList && (
                      <button
                        onClick={() => setCreateListForSpace({ spaceId: s.id })}
                        className="opacity-0 transition-opacity group-hover:opacity-100 flex size-5 items-center justify-center rounded hover:bg-(--bg-sidebar-item-hover) text-(--text-muted)"
                        title="Add list"
                      >
                        <PlusIcon className="size-3.5" />
                      </button>
                    )}
                    <Popover
                      open={openMenu === `space-${s.id}`}
                      onOpenChange={(o) => setOpenMenu(o ? `space-${s.id}` : null)}
                    >
                      <PopoverTrigger asChild>
                        <button
                          className="opacity-0 transition-opacity group-hover:opacity-100 flex size-5 items-center justify-center rounded hover:bg-(--bg-sidebar-item-hover) text-(--text-muted)"
                          title="Project options"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DotsThreeIcon className="size-4.5" weight="bold" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent side="right" align="start" className="w-48 p-1" onClick={() => setOpenMenu(null)}>
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
                          <ClockIcon className="size-3.5 shrink-0 text-muted-foreground" />
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
                          Archive Project
                        </button>
                        <button
                          onClick={() => setSpaceAction({ id: s.id, name: s.name, variant: "delete" })}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
                        >
                          <TrashIcon className="size-3.5 shrink-0" />
                          Delete Project
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
                              "relative flex flex-1 items-center gap-2 rounded-md py-1.5 pr-7 pl-7 text-[13px] transition-colors select-none",
                              active
                                ? "bg-(--bg-sidebar-item-active) text-(--text-sidebar-active) font-medium overflow-hidden after:absolute after:left-0 after:inset-y-0 after:w-0.75 after:bg-primary"
                                : "text-(--text-sidebar) hover:bg-(--bg-sidebar-item-hover) hover:text-(--text-sidebar-active)",
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
                            <Popover
                              open={openMenu === `list-${l.id}`}
                              onOpenChange={(o) => setOpenMenu(o ? `list-${l.id}` : null)}
                            >
                              <PopoverTrigger asChild>
                                <button
                                  className="absolute right-1 opacity-0 transition-opacity group-hover/list:opacity-100 flex size-5 items-center justify-center rounded hover:bg-(--bg-sidebar-item-hover)"
                                  title="List options"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <DotsThreeIcon className="size-4.5 text-(--text-muted)" weight="bold" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent side="right" align="start" className="w-44 p-1" onClick={() => setOpenMenu(null)}>
                                <Link
                                  href={`/${workspace.id}/${s.id}/list/${l.id}/settings/general`}
                                  onClick={() => setSidebarOpen(false)}
                                  className="flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                                >
                                  <GearIcon className="size-3.5 shrink-0 text-muted-foreground" />
                                  Settings
                                </Link>
                                <Link
                                  href={`/${workspace.id}/${s.id}/list/${l.id}/settings/statuses`}
                                  onClick={() => setSidebarOpen(false)}
                                  className="flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                                >
                                  <PencilSimpleIcon className="size-3.5 shrink-0 text-muted-foreground" />
                                  Manage Statuses
                                </Link>
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
                                    const res = await archiveList(workspace.id, s.id, l.id);
                                    if (!("error" in res)) router.push(`/${workspace.id}`);
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
                    {s.sprints.length > 0 && (() => {
                      const sprintsExpanded = expandedSprintGroups.has(s.id);
                      const activeSprint = s.sprints.find((sp) => sp.status === "ACTIVE");
                      const isOnSprintRoute = pathname.includes(`/${workspace.id}/${s.id}/sprint/`);
                      return (
                        <div>
                          {/* Sprints folder header */}
                          <button
                            onClick={() => setExpandedSprintGroups((prev) => {
                              const next = new Set(prev);
                              next.has(s.id) ? next.delete(s.id) : next.add(s.id);
                              return next;
                            })}
                            className={cn(
                              "group/sprints relative flex w-full items-center gap-2 rounded-md py-1.5 pr-2 pl-7 text-[13px] transition-colors select-none",
                              isOnSprintRoute
                                ? "text-(--text-sidebar-active)"
                                : "text-(--text-sidebar) hover:bg-(--bg-sidebar-item-hover) hover:text-(--text-sidebar-active)",
                            )}
                          >
                            {sprintsExpanded
                              ? <CaretDownIcon className="size-3 shrink-0 text-(--text-muted)" />
                              : <CaretRightIcon className="size-3 shrink-0 text-(--text-muted)" />
                            }
                            <LightningIcon className="size-3.5 shrink-0" weight="fill" style={{ color: activeSprint ? "#4ADE80" : undefined }} />
                            <span className="flex-1 truncate text-left">Sprints</span>
                            {activeSprint && !sprintsExpanded && (
                              <span className="h-1.5 w-1.5 rounded-full bg-green-400 shrink-0 animate-pulse" />
                            )}
                            {s.canManageList && (
                              <span className="opacity-0 group-hover/sprints:opacity-100 flex items-center gap-0.5 transition-opacity shrink-0">
                                <span
                                  role="button"
                                  onClick={(e) => { e.stopPropagation(); openSprintSettings(s.id); }}
                                  className="flex size-4 items-center justify-center rounded hover:bg-(--bg-sidebar-item-hover)"
                                  title="Sprint settings"
                                >
                                  <GearIcon className="size-3" />
                                </span>
                                <span
                                  role="button"
                                  onClick={(e) => { e.stopPropagation(); handleCreateSprintClick(s.id, s.name); }}
                                  className="flex size-4 items-center justify-center rounded hover:bg-(--bg-sidebar-item-hover)"
                                  title="Create sprint"
                                >
                                  <PlusIcon className="size-3" />
                                </span>
                              </span>
                            )}
                          </button>

                          {/* Sprint items */}
                          {sprintsExpanded && s.sprints.map((sp) => {
                            const href = `/${workspace.id}/${s.id}/sprint/${sp.id}`;
                            const active = pathname === href;
                            return (
                              <Link
                                key={sp.id}
                                href={href}
                                onClick={() => setSidebarOpen(false)}
                                className={cn(
                                  "relative flex items-center gap-2 rounded-md py-1.5 pr-2 pl-12 text-[13px] transition-colors select-none",
                                  active
                                    ? "bg-(--bg-sidebar-item-active) text-(--text-sidebar-active) font-medium overflow-hidden after:absolute after:left-0 after:inset-y-0 after:w-0.75 after:bg-primary"
                                    : "text-(--text-sidebar) hover:bg-(--bg-sidebar-item-hover) hover:text-(--text-sidebar-active)",
                                )}
                              >
                                <LightningIcon
                                  className="size-3.5 shrink-0"
                                  weight={sp.status === "ACTIVE" ? "fill" : "regular"}
                                  style={{ color: sp.status === "ACTIVE" ? "#4ADE80" : undefined }}
                                />
                                <span className="flex-1 min-w-0">
                                  <span className="truncate block">{sp.name}</span>
                                  {(sp.startDate || sp.endDate) && (
                                    <span className="text-2xs text-(--text-muted) font-normal leading-none">
                                      {formatSprintDate(sp.startDate, s.sprintDateFormat)}
                                      {" – "}
                                      {formatSprintDate(sp.endDate, s.sprintDateFormat)}
                                    </span>
                                  )}
                                </span>
                                {sp.status === "ACTIVE" && (
                                  <span className="h-1.5 w-1.5 rounded-full bg-green-400 shrink-0 animate-pulse" />
                                )}
                              </Link>
                            );
                          })}
                        </div>
                      );
                    })()}
                    {s.sprints.length === 0 && s.canManageList && (
                      <button
                        onClick={() => handleCreateSprintClick(s.id, s.name)}
                        className="flex w-full items-center gap-2 rounded-md py-1.5 pl-7 pr-2 text-xs text-(--text-muted) transition-colors hover:bg-(--bg-sidebar-item-hover) hover:text-(--text-sidebar-active)"
                      >
                        <LightningIcon className="size-3" />
                        Create sprint
                      </button>
                    )}
                    {s.canManageList && (
                      <button
                        onClick={() => setCreateListForSpace({ spaceId: s.id })}
                        className="flex w-full items-center gap-2 rounded-md py-1.5 pl-7 pr-2 text-xs text-(--text-muted) transition-colors hover:bg-(--bg-sidebar-item-hover) hover:text-(--text-sidebar-active)"
                      >
                        <PlusIcon className="size-3" />
                        Add list
                      </button>
                    )}
                    {s.archivedLists.length > 0 && (
                      <button
                        onClick={() => setExpandedArchivedLists(prev => {
                          const next = new Set(prev);
                          next.has(s.id) ? next.delete(s.id) : next.add(s.id);
                          return next;
                        })}
                        className="flex items-center gap-1.5 pl-7 pr-2 py-1 text-xs text-(--text-muted) hover:text-(--text-sidebar) transition-colors w-full"
                      >
                        <ArchiveIcon className="size-3" />
                        {expandedArchivedLists.has(s.id) ? "Hide" : `${s.archivedLists.length} archived`}
                      </button>
                    )}
                    {expandedArchivedLists.has(s.id) && s.archivedLists.map((l) => (
                      <div key={l.id} className="group flex items-center gap-2 pl-7 pr-2 py-1 text-xs text-(--text-muted)">
                        <ArchiveIcon className="size-3 shrink-0" />
                        <span className="flex-1 truncate italic">{l.name}</span>
                        {s.canManageList && (
                          <button
                            onClick={async () => { await unarchiveList(workspace.id, s.id, l.id); }}
                            className="hidden group-hover:block text-2xs px-1.5 py-0.5 rounded bg-(--bg-sidebar-item-hover) hover:bg-(--bg-sidebar-item-active) text-(--text-sidebar)"
                          >
                            Unarchive
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {archivedSpaces.length > 0 && (
            <div>
              <button
                onClick={() => setShowArchivedSpaces(v => !v)}
                className="flex items-center gap-1.5 px-3 pb-1 text-xs text-(--text-muted) hover:text-(--text-sidebar) transition-colors w-full"
              >
                <ArchiveIcon className="size-3" />
                <span className="flex-1 text-left uppercase tracking-wide font-medium">
                  {showArchivedSpaces ? "Hide archived projects" : `Archived projects (${archivedSpaces.length})`}
                </span>
              </button>
              {showArchivedSpaces && (
                <div className="space-y-0.5">
                  {archivedSpaces.map((s) => (
                    <div key={s.id} className="group flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] text-(--text-muted)">
                      <span
                        className="size-2 shrink-0 rounded-full opacity-40"
                        style={{ backgroundColor: s.color ?? "#9CA3AF" }}
                      />
                      <span className="flex-1 truncate italic">{s.name}</span>
                      {isAdmin && (
                        <button
                          onClick={async () => { await unarchiveSpace(workspace.id, s.id); }}
                          className="hidden group-hover:block text-xs px-1.5 py-0.5 rounded bg-(--bg-sidebar-item-hover) text-(--text-sidebar)"
                        >
                          Unarchive
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Channels section — post-MVP, hidden for now */}
          {/* <div>
            <div className="flex items-center px-2 pb-1">
              <p className="flex-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Channels
              </p>
              <button
                onClick={() => setAddMemberChannel(channels[0] ? { id: channels[0].id, name: channels[0].name } : null)}
                className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="Add Member"
                disabled={channels.length === 0}
              >
                <UserPlusIcon className="size-3.5" />
              </button>
              <button
                onClick={() => setCreateChannelOpen(true)}
                className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="Create Channel"
              >
                <PlusIcon className="size-3.5" />
              </button>
            </div>
            <div className="space-y-0.5">
              {channels.map((ch) => {
                const href = `/${workspace.id}/channel/${ch.id}`;
                const active = pathname === href;
                return (
                  <div key={ch.id} className="group/channel relative flex items-center">
                    <Link
                      href={href}
                      onClick={() => setSidebarOpen(false)}
                      className={cn(
                        "flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-accent font-medium text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      <HashIcon className="size-4 shrink-0" weight="bold" />
                      <span className="truncate">{ch.name}</span>
                    </Link>
                    <button
                      onClick={() => setAddMemberChannel({ id: ch.id, name: ch.name })}
                      className="absolute right-1 opacity-0 transition-opacity group-hover/channel:opacity-100 flex size-5 items-center justify-center rounded hover:bg-accent"
                      title="Add members"
                    >
                      <UserPlusIcon className="size-3.5 text-muted-foreground" />
                    </button>
                  </div>
                );
              })}
              <button
                onClick={() => setCreateChannelOpen(true)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <PlusIcon className="size-3" />
                Add Channel
              </button>
            </div>
          </div> */}
        </nav>

        {/* Bottom user menu */}
        <div className="border-t border-[rgba(255,255,255,0.08)] p-2">
          <Popover
            open={profileOpen}
            onOpenChange={(open) => {
              setProfileOpen(open);
              if (!open) setShowProjectPicker(false);
            }}
          >
            <PopoverTrigger asChild>
              <button className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-[13px] text-(--text-sidebar) transition-colors hover:bg-(--bg-sidebar-item-hover) hover:text-(--text-sidebar-active) cursor-pointer">
                <Avatar className="size-7 shrink-0">
                  {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
                <span className="flex-1 truncate text-left">{displayName}</span>
                <CaretUpIcon className={`size-3.5 shrink-0 opacity-50 transition-transform duration-200 ${profileOpen ? "rotate-180" : ""}`} />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="top" className="w-56 p-1.5">
              {showProjectPicker && spaces.length > 1 ? (
                /* Project picker — replaces the menu in-place (single popup, no side panel) */
                <div>
                  <button
                    onClick={() => setShowProjectPicker(false)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
                  >
                    <ArrowLeftIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 text-left">Project settings</span>
                  </button>
                  <Separator className="my-1.5" />
                  <div className="max-h-64 overflow-y-auto">
                    {spaces.map((s) => {
                      // The currently-viewed project is the second path segment:
                      // /{workspaceId}/{spaceId}/...
                      const isCurrent = pathname.split("/")[2] === s.id;
                      return (
                        <Link
                          key={s.id}
                          href={`/${workspace.id}/${s.id}/settings/general`}
                          onClick={() => { setProfileOpen(false); setShowProjectPicker(false); }}
                          className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-accent ${isCurrent ? "bg-accent font-medium" : ""}`}
                        >
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: s.color ?? "#6B7280" }}
                          />
                          <span className="flex-1 truncate">{s.name}</span>
                          {isCurrent && <CheckIcon className="size-4 shrink-0 text-primary" />}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* Account menu */
                <div>
                  <Link
                    href={`/${workspace.id}/profile`}
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-accent"
                  >
                    <UserCircleIcon className="size-4 shrink-0 text-muted-foreground" />
                    Edit profile
                  </Link>
                  <Separator className="my-1.5" />
                  {isAdmin && (
                    <Link
                      href={`/${workspace.id}/settings/general`}
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-accent"
                    >
                      <GearIcon className="size-4 shrink-0 text-muted-foreground" />
                      Workspace settings
                    </Link>
                  )}
                  {spaces.length === 1 ? (
                    // Single project — go straight to its settings, no picker needed.
                    <Link
                      href={`/${workspace.id}/${spaces[0].id}/settings/general`}
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-accent"
                    >
                      <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                      Project settings
                    </Link>
                  ) : (
                    <button
                      onClick={() => setShowProjectPicker(true)}
                      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-accent"
                    >
                      <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 text-left">Project settings</span>
                      <CaretRightIcon className="size-3.5 text-muted-foreground" />
                    </button>
                  )}
                  <Link
                    href={`/${workspace.id}/notifications/settings`}
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-accent"
                  >
                    <BellIcon className="size-4 shrink-0 text-muted-foreground" />
                    Notification settings
                  </Link>
                  <Link
                    href={`/${workspace.id}/support`}
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-accent"
                  >
                    <HeadsetIcon className="size-4 shrink-0 text-muted-foreground" />
                    Support
                  </Link>
                  <Separator className="my-1.5" />
                  <button
                    onClick={() => { setProfileOpen(false); handleSignOut(); }}
                    className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
                  >
                    <SignOutIcon className="size-4 shrink-0" />
                    Sign out
                  </button>
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </aside>

      {/* Right column: topbar + main content */}
      <TopbarProvider>
        <TopbarRightColumn
          workspaceId={workspace.id}
          onOpenSidebar={() => setSidebarOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
        >
          {children}
        </TopbarRightColumn>
      </TopbarProvider>
    </div>
  );
}

// ─── Pinned Tasks Tab Strip ───────────────────────────────────────────────────

interface PinnedItem {
  id: string;
  taskId: string;
  taskTitle: string;
  listName: string | null;
  spaceName: string | null;
  orderIndex: number;
}


function PinnedTasksBar({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { mutate } = useSWRConfig();
  const swrKey = `/api/workspaces/${workspaceId}/pinned-tasks`;
  const { data } = useSWR<{ pinnedTasks: PinnedItem[] }>(
    swrKey,
    (url: string) => fetch(url).then((r) => r.json()),
    { refreshInterval: 60000 },
  );
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const pinned = data?.pinnedTasks ?? [];
  if (pinned.length === 0) return null;

  async function handleUnpin(e: React.MouseEvent, taskId: string) {
    e.stopPropagation();
    mutate(swrKey, (prev: { pinnedTasks: PinnedItem[] } | undefined) => ({
      pinnedTasks: (prev?.pinnedTasks ?? []).filter((t) => t.taskId !== taskId),
    }), { revalidate: false });
    window.dispatchEvent(new CustomEvent("task-personal-unpin", { detail: { taskId } }));
    await fetch(`/api/tasks/${taskId}/pin`, { method: 'DELETE' });
    mutate(swrKey);
  }
  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && scrollRef.current) {
      e.preventDefault();
      scrollRef.current.scrollLeft += e.deltaY;
    }
  }


  return (
    <div className="h-9 shrink-0 border-b border-border bg-surface overflow-hidden">
      <div
        ref={scrollRef}
        onWheel={handleWheel}
        className="flex h-full items-center gap-1 px-3 overflow-x-auto [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: 'none' } as React.CSSProperties}
      >
        <PushPinIcon className="size-3 shrink-0 text-muted-foreground" weight="fill" />
        {pinned.map((item) => {
          const isActive = pathname === `/${workspaceId}/task/${item.taskId}`;
          return (
            <div
              key={item.id}
              className={cn(
                "group/pin relative flex h-5 items-center rounded shrink-0 max-w-40 overflow-hidden border",
                isActive ? "bg-primary/10 border-primary/30" : "border-border hover:bg-accent",
              )}
            >
              <button
                onClick={() => router.push(`/${workspaceId}/task/${item.taskId}`)}
                title={[item.spaceName, item.listName].filter(Boolean).join(" · ")}
                className={cn(
                  "min-w-0 flex-1 flex h-full items-center pl-2 pr-1 text-xs font-medium transition-colors cursor-pointer overflow-hidden",
                  isActive ? "text-primary" : "text-muted-foreground group-hover/pin:text-foreground",
                )}
              >
                <span className="truncate block">{item.taskTitle}</span>
              </button>
              <button
                onClick={(e) => handleUnpin(e, item.taskId)}
                title="Unpin"
                className="hidden group-hover/pin:flex shrink-0 h-full items-center px-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <PushPinSlashIcon className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── TopbarRightColumn ────────────────────────────────────────────────────────
// Separated so it can read TopbarContext (must be inside TopbarProvider)

function TopbarRightColumn({
  workspaceId,
  onOpenSidebar,
  onOpenSearch,
  children,
}: {
  workspaceId: string;
  onOpenSidebar: () => void;
  onOpenSearch: () => void;
  children: React.ReactNode;
}) {
  const topbar = useTopbarState();

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* Top bar */}
      <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center border-b border-border bg-surface px-4 gap-3">
        {/* Mobile sidebar toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 lg:hidden shrink-0"
          onClick={onOpenSidebar}
        >
          <ListIcon className="size-5" />
        </Button>

        {/* Breadcrumb — injected by active page */}
        <div className="flex flex-1 items-center gap-1.5 min-w-0 text-sm">
          {topbar ? (
            <>
              {topbar.breadcrumbs.map((crumb, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <CaretRightIcon className="size-3.5 text-muted-foreground shrink-0" />}
                  <span className="flex items-center gap-1.5 text-muted-foreground font-medium shrink-0">
                    {crumb.color && (
                      <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: crumb.color }} />
                    )}
                    {crumb.label}
                  </span>
                </React.Fragment>
              ))}
              {topbar.breadcrumbs.length > 0 && <CaretRightIcon className="size-3.5 text-muted-foreground shrink-0" />}
              <span className="font-semibold text-foreground truncate">{topbar.title}</span>
              {topbar.actions && <div className="ml-auto shrink-0">{topbar.actions}</div>}
            </>
          ) : null}
        </div>

        {/* Search — right side */}
        <button
          onClick={onOpenSearch}
          className="flex items-center gap-2 h-8 w-52 shrink-0 rounded-md border bg-muted/50 px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <MagnifyingGlassIcon className="size-4 shrink-0" />
          <span className="flex-1 text-left text-sm">Search…</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border bg-background px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
            ⌘K
          </kbd>
        </button>
      </header>

      <PushNotificationBanner workspaceId={workspaceId} />
      <PinnedTasksBar workspaceId={workspaceId} />
      <main className="flex-1 overflow-auto bg-app">{children}</main>
    </div>
  );
}
