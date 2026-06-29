"use client";

import * as React from "react";
import { MagnifyingGlassIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { addChannelMember, getChannelMentionableMembers, type MentionableMember } from "@/app/actions/channel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface AddChannelMemberModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  channelId: string;
  existingMemberIds: string[];
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
  const [selected, setSelected] = React.useState<Map<string, { member: MentionableMember; role: "ADMIN" | "MEMBER" }>>(
    new Map(),
  );
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    getChannelMentionableMembers(workspaceId).then((result) => {
      if ("members" in result) {
        setMembers(result.members);
      }
      setLoading(false);
    });
  }, [open, workspaceId]);

  const filteredMembers = members.filter((m) => {
    if (existingMemberIds.includes(m.id)) return false;
    if (selected.has(m.id)) return false;
    const q = search.toLowerCase();
    return m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
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
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                  key={id}
                  className="flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs"
                >
                  <span className="font-medium">{member.name}</span>
                  <Select value={role} onValueChange={(v) => updateRole(id, v as "ADMIN" | "MEMBER")}>
                    <SelectTrigger className="h-auto border-0 bg-transparent p-0 text-xs text-muted-foreground shadow-none focus:ring-0 [&>svg]:size-3 [&>svg]:ml-0.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MEMBER" className="text-xs">Member</SelectItem>
                      <SelectItem value="ADMIN" className="text-xs">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <button
                    onClick={() => toggleSelect(member)}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-background"
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
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
              autoFocus
            />
          </div>

          {/* Member list */}
          <div className="max-h-60 space-y-0.5 overflow-y-auto">
            {loading && <p className="py-4 text-center text-sm text-muted-foreground">Loading members…</p>}
            {!loading && filteredMembers.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">No members found</p>
            )}
            {filteredMembers.map((m) => (
              <button
                key={m.id}
                onClick={() => toggleSelect(m)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent"
              >
                <Avatar className="size-7 shrink-0">
                  <AvatarFallback className="text-xs">{getInitials(m.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{m.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                </div>
                <PlusIcon className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || selected.size === 0}>
              {submitting ? "Adding…" : `Add ${selected.size} Member${selected.size !== 1 ? "s" : ""}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
