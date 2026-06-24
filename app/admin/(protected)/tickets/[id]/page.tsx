"use client";

import { use, useState } from "react";
import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const STATUS_OPTIONS = ["OPEN", "IN_PROGRESS", "CLOSED"] as const;

export default function AdminTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, mutate } = useSWR(`/api/admin/tickets/${id}`, fetcher);
  const [reply, setReply] = useState("");
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [sending, setSending] = useState(false);

  const ticket = data?.ticket;
  const messages: any[] = data?.messages ?? [];

  async function handleReply() {
    if (!reply.trim()) {
      return;
    }
    setSending(true);
    await fetch(`/api/admin/tickets/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: reply, isInternalNote }),
    });
    setReply("");
    await mutate();
    setSending(false);
  }

  async function handleStatusChange(status: string) {
    await fetch(`/api/admin/tickets/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await mutate();
  }

  if (!ticket) {
    return <div className="p-8 text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-muted-foreground font-mono mb-1">
            {ticket.ticketNumber}
          </div>
          <h1 className="text-2xl font-bold">{ticket.subject}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {ticket.category} · Submitted by {ticket.userEmail ?? ticket.userId}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <select
            className="border rounded-md px-3 py-1.5 text-sm bg-background"
            onChange={(e) => handleStatusChange(e.target.value)}
            value={ticket.status}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-3">
        {messages.map((msg) => (
          <div
            className={cn(
              "rounded-lg p-4 border",
              msg.isInternalNote
                ? "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800"
                : msg.isAdmin
                  ? "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800 ml-8"
                  : "bg-muted/30 mr-8"
            )}
            key={msg.id}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {msg.authorName ?? msg.authorId}
                </span>
                {msg.isAdmin && (
                  <Badge className="text-xs" variant="secondary">
                    Admin
                  </Badge>
                )}
                {msg.isInternalNote && (
                  <Badge
                    className="text-xs border-amber-500 text-amber-600"
                    variant="outline"
                  >
                    Internal Note
                  </Badge>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {new Date(msg.createdAt).toLocaleString()}
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
          </div>
        ))}
        {messages.length === 0 && (
          <p className="text-center text-muted-foreground py-6">
            No messages yet
          </p>
        )}
      </div>

      <div className="border rounded-lg p-4 space-y-3">
        <Textarea
          onChange={(e) => setReply(e.target.value)}
          placeholder="Write a reply…"
          rows={4}
          value={reply}
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              checked={isInternalNote}
              className="rounded"
              onChange={(e) => setIsInternalNote(e.target.checked)}
              type="checkbox"
            />
            Internal Note (not visible to customer)
          </label>
          <Button disabled={!reply.trim() || sending} onClick={handleReply}>
            {sending ? "Sending…" : isInternalNote ? "Add Note" : "Reply"}
          </Button>
        </div>
      </div>
    </div>
  );
}
