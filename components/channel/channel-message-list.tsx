"use client";

import { DownloadSimpleIcon, FileIcon } from "@phosphor-icons/react";
import * as React from "react";
import type { ChannelMessageInfo } from "@/app/actions/channel";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface ChannelMessageListProps {
  currentUserId: string;
  messages: ChannelMessageInfo[];
}

function getInitials(name: string | null, email: string) {
  if (name) {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return email.slice(0, 2).toUpperCase();
}

function formatTime(date: Date) {
  return new Date(date).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(date: Date) {
  const d = new Date(date);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) {
    return "Today";
  }
  if (d.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }

  return d.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function isSameDay(a: Date, b: Date) {
  const da = new Date(a);
  const db = new Date(b);
  return da.toDateString() === db.toDateString();
}

function isImageMime(mime: string) {
  return mime.startsWith("image/");
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Render content with @mentions highlighted
function renderContent(content: string) {
  const parts = content.split(/(@\w[\w\s]*?)(?=\s|$)/g);
  return parts.map((part, i) => {
    if (part.startsWith("@")) {
      return (
        <span
          className="rounded bg-primary/10 px-1 py-0.5 text-primary font-medium"
          key={i}
        >
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export function ChannelMessageList({
  messages,
  currentUserId,
}: ChannelMessageListProps) {
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const prevLengthRef = React.useRef(0);

  // Auto-scroll on new messages
  React.useEffect(() => {
    if (messages.length > prevLengthRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevLengthRef.current = messages.length;
  }, [messages.length]);

  // Initial scroll to bottom
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, []);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-muted-foreground">
            No messages yet
          </p>
          <p className="mt-1 text-sm text-muted-foreground/70">
            Be the first to send a message in this channel!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4" ref={containerRef}>
      <div className="space-y-0.5">
        {messages.map((msg, idx) => {
          const prev = idx > 0 ? messages[idx - 1] : null;
          const showDateSep =
            !prev || !isSameDay(prev.createdAt, msg.createdAt);
          const showAvatar =
            !prev ||
            prev.senderId !== msg.senderId ||
            showDateSep ||
            new Date(msg.createdAt).getTime() -
              new Date(prev.createdAt).getTime() >
              5 * 60 * 1000;

          return (
            <React.Fragment key={msg.id}>
              {/* Date separator */}
              {showDateSep && (
                <div className="flex items-center gap-3 py-3">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs font-medium text-muted-foreground">
                    {formatDate(msg.createdAt)}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              )}

              {/* Message */}
              <div
                className={cn(
                  "group flex gap-3 rounded-md px-2 py-1 transition-colors hover:bg-accent/30",
                  showAvatar ? "mt-3" : "mt-0"
                )}
              >
                {/* Avatar column */}
                <div className="w-8 shrink-0">
                  {showAvatar && !msg.isDeleted && (
                    <Avatar className="size-8">
                      <AvatarFallback className="text-xs">
                        {getInitials(msg.senderName, msg.senderEmail)}
                      </AvatarFallback>
                    </Avatar>
                  )}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  {showAvatar && !msg.isDeleted && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold">
                        {msg.senderName || msg.senderEmail}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatTime(msg.createdAt)}
                      </span>
                    </div>
                  )}

                  {msg.isDeleted ? (
                    <p className="text-sm italic text-muted-foreground/60">
                      This message was deleted
                    </p>
                  ) : (
                    <>
                      <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                        {renderContent(msg.content)}
                      </div>

                      {/* Attachments */}
                      {msg.attachments.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {msg.attachments.map((att) =>
                            isImageMime(att.mimeType) ? (
                              <a
                                className="block max-w-xs overflow-hidden rounded-lg border transition-opacity hover:opacity-80"
                                href={att.fileUrl}
                                key={att.id}
                                rel="noopener noreferrer"
                                target="_blank"
                              >
                                <img
                                  alt={att.fileName}
                                  className="max-h-64 object-contain"
                                  src={att.fileUrl}
                                />
                              </a>
                            ) : (
                              <a
                                className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm transition-colors hover:bg-accent"
                                href={att.fileUrl}
                                key={att.id}
                                rel="noopener noreferrer"
                                target="_blank"
                              >
                                <FileIcon className="size-5 shrink-0 text-muted-foreground" />
                                <div className="min-w-0">
                                  <p className="truncate font-medium">
                                    {att.fileName}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {formatFileSize(att.fileSize)}
                                  </p>
                                </div>
                                <DownloadSimpleIcon className="size-4 shrink-0 text-muted-foreground" />
                              </a>
                            )
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
      <div ref={bottomRef} />
    </div>
  );
}
