"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { HashIcon, UsersIcon } from "@phosphor-icons/react";
import {
  getChannelMessages,
  getChannelMembers,
  getChannelMentionableMembers,
  sendChannelMessage,
  getChannelDetails,
  type ChannelMessageInfo,
  type MentionableMember,
  type ChannelMemberInfo,
} from "@/app/actions/channel";
import { ChannelMessageList } from "@/components/channel/channel-message-list";
import { ChannelComposer } from "@/components/channel/channel-composer";
import { AddChannelMemberModal } from "@/components/channel/add-channel-member-modal";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export default function ChannelPage() {
  const params = useParams<{ workspaceId: string; channelId: string }>();
  const { workspaceId, channelId } = params;

  const [messages, setMessages] = React.useState<ChannelMessageInfo[]>([]);
  const [members, setMembers] = React.useState<MentionableMember[]>([]);
  const [channelMembers, setChannelMembers] = React.useState<ChannelMemberInfo[]>([]);
  const [addMemberOpen, setAddMemberOpen] = React.useState(false);
  const [currentUserId, setCurrentUserId] = React.useState("");
  const [channelName, setChannelName] = React.useState("");

  // Fetch current user
  React.useEffect(() => {
    fetch("/api/me/notifications?filter=unread")
      .then((r) => r.json())
      .catch(() => null);
    // Get userId from cookie session — use a simple endpoint
    fetch("/api/auth/get-session")
      .then((r) => r.json())
      .then((data) => {
        if (data?.user?.id) setCurrentUserId(data.user.id);
      })
      .catch(() => {});
  }, []);

  // Fetch messages with polling
  const { data: msgData, mutate: mutateMessages } = useSWR(
    `channel-messages-${channelId}`,
    async () => {
      const result = await getChannelMessages(workspaceId, channelId);
      if ("error" in result) return null;
      return result;
    },
    { refreshInterval: 3000 },
  );

  React.useEffect(() => {
    if (msgData?.messages) {
      setMessages(msgData.messages);
    }
  }, [msgData]);

  // Fetch mentionable members
  React.useEffect(() => {
    getChannelMentionableMembers(workspaceId).then((result) => {
      if ("members" in result) setMembers(result.members);
    });
  }, [workspaceId]);

  // Fetch channel members
  React.useEffect(() => {
    getChannelMembers(workspaceId, channelId).then((result) => {
      if ("members" in result) setChannelMembers(result.members);
    });
  }, [workspaceId, channelId]);

  // Fetch channel details (specifically the name)
  React.useEffect(() => {
    getChannelDetails(workspaceId, channelId).then((result) => {
      if ("channel" in result) {
        setChannelName(result.channel.name);
      } else {
        setChannelName("unknown-channel");
      }
    });
  }, [workspaceId, channelId]);

  async function handleSend(content: string, attachmentIds: string[], mentionedUserIds: string[]) {
    const result = await sendChannelMessage(
      workspaceId,
      channelId,
      content,
      attachmentIds.length > 0 ? attachmentIds : undefined,
      mentionedUserIds.length > 0 ? mentionedUserIds : undefined,
    );

    if ("messageId" in result) {
      // Optimistic update — refetch immediately
      mutateMessages();
    }
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
    <div className="flex h-full flex-col">
      {/* Channel header */}
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <HashIcon className="size-5 text-muted-foreground" weight="bold" />
          <h1 className="text-lg font-semibold">{channelName}</h1>
        </div>
        <div className="flex-1" />

        {/* Member avatars */}
        <Popover>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <UsersIcon className="size-4" />
              <span>{channelMembers.length}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-2">
            <p className="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Members
            </p>
            <div className="max-h-48 space-y-0.5 overflow-y-auto">
              {channelMembers.map((m) => (
                <div key={m.userId} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                  <Avatar className="size-6 shrink-0">
                    <AvatarFallback className="text-[10px]">{getInitials(m.name)}</AvatarFallback>
                  </Avatar>
                  <span className="flex-1 truncate">{m.name}</span>
                  {m.role === "ADMIN" && (
                    <span className="text-[10px] font-medium text-muted-foreground uppercase">Admin</span>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={() => setAddMemberOpen(true)}
              className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Add Members
            </button>
          </PopoverContent>
        </Popover>
      </div>

      {/* Messages */}
      <ChannelMessageList messages={messages} currentUserId={currentUserId} />

      {/* Composer */}
      <ChannelComposer
        workspaceId={workspaceId}
        channelId={channelId}
        members={members}
        onSend={handleSend}
      />

      {/* Add member modal */}
      <AddChannelMemberModal
        open={addMemberOpen}
        onOpenChange={setAddMemberOpen}
        workspaceId={workspaceId}
        channelId={channelId}
        existingMemberIds={channelMembers.map((m) => m.userId)}
      />
    </div>
  );
}
