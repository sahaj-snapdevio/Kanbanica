"use client";

import { MagnifyingGlassIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import * as React from "react";
import {
  addChannelMember,
  getChannelMentionableMembers,
  type MentionableMember,
} from "@/app/actions/channel";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface AddChannelMemberModalProps {
  channelId: string;
  existingMemberIds: string[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
  workspaceId: string;
}

export function AddChannelMemberModal({
  open,
  onOpenChange,
  workspaceId,
  channelId,
  existingMemberIds,
}: AddChannelMemberModalProps) {
  const [search, setSearch] = React.useState("");
  const [members, setMembers] = React.useState<MentionableMember[]>([]);
  const [selected, setSelected] = React.useState<
    Map<string, { member: MentionableMember; role: "ADMIN" | "MEMBER" }>
  >(new Map());
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    setLoading(true);
    getChannelMentionableMembers(workspaceId).then((result) => {
      if ("members" in result) {
        setMembers(result.members);
      }
      setLoading(false);
    });
  }, [open, workspaceId]);

  const filteredMembers = members.filter((m) => {
    if (existingMemberIds.includes(m.id)) {
      return false;
    }
    if (selected.has(m.id)) {
      return false;
    }
    const q = search.toLowerCase();
    return (
      m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
    );
  });

  function toggleSelect(member: MentionableMember) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(member.id)) {
        next.delete(member.id);
      } else {
        next.set(member.id, { member, role: "MEMBER" });
      }
      return next;
    });
  }

  function updateRole(memberId: string, role: "ADMIN" | "MEMBER") {
    setSelected((prev) => {
      const next = new Map(prev);
      const entry = next.get(memberId);
      if (entry) {
        next.set(memberId, { ...entry, role });
      }
      return next;
    });
  }

  async function handleSubmit() {
    setSubmitting(true);
    for (const [userId, { role }] of selected) {
      await addChannelMember(workspaceId, channelId, userId, role);
    }
    setSelected(new Map());
    setSearch("");
    setSubmitting(false);
    onOpenChange(false);
  }

  function getInitials(name: string) {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Members to Channel</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Selected members */}
          {selected.size > 0 && (
            <div className="flex flex-wrap gap-2">
              {Array.from(selected.entries()).map(([id, { member, role }]) => (
                <div
                  className="flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs"
                  key={id}
                >
                  <span className="font-medium">{member.name}</span>
                  <select
                    className="bg-transparent text-xs text-muted-foreground outline-none cursor-pointer"
                    onChange={(e) =>
                      updateRole(id, e.target.value as "ADMIN" | "MEMBER")
                    }
                    value={role}
                  >
                    <option value="MEMBER">Member</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                  <button
                    className="ml-0.5 rounded-full p-0.5 hover:bg-background"
                    onClick={() => toggleSelect(member)}
                  >
                    <XIcon className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              autoFocus
              className="pl-8"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email…"
              value={search}
            />
          </div>

          {/* Member list */}
          <div className="max-h-60 space-y-0.5 overflow-y-auto">
            {loading && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Loading members…
              </p>
            )}
            {!loading && filteredMembers.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No members found
              </p>
            )}
            {filteredMembers.map((m) => (
              <button
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent"
                key={m.id}
                onClick={() => toggleSelect(m)}
              >
                <Avatar className="size-7 shrink-0">
                  <AvatarFallback className="text-xs">
                    {getInitials(m.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{m.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.email}
                  </p>
                </div>
                <PlusIcon className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button
              disabled={submitting}
              onClick={() => onOpenChange(false)}
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              disabled={submitting || selected.size === 0}
              onClick={handleSubmit}
            >
              {submitting
                ? "Adding…"
                : `Add ${selected.size} Member${selected.size === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
