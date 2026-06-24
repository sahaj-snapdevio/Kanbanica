"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const STATUS_COLORS: Record<string, "default" | "secondary" | "outline"> = {
  OPEN: "default",
  IN_PROGRESS: "secondary",
  CLOSED: "outline",
};

export default function TicketDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string; ticketId: string }>;
}) {
  const { workspaceId, ticketId } = use(params);
  const { data, mutate, isLoading } = useSWR(
    `/api/support/tickets/${ticketId}`,
    fetcher
  );
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState("");

  const ticket = data?.ticket;
  const messages: any[] = data?.messages ?? [];

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim()) {
      return;
    }
    setError("");
    setSending(true);
    try {
      const res = await fetch(`/api/support/tickets/${ticketId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to send reply");
        return;
      }
      setReply("");
      await mutate();
    } finally {
      setSending(false);
    }
  }

  async function handleClose() {
    setClosing(true);
    try {
      await fetch(`/api/support/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close" }),
      });
      await mutate();
    } finally {
      setClosing(false);
    }
  }

  if (isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  if (!ticket) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Ticket not found.</p>
        <Link
          className="text-sm text-primary hover:underline mt-2 inline-block"
          href={`/${workspaceId}/support`}
        >
          Back to Support
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Link
          className="text-muted-foreground hover:text-foreground transition-colors"
          href={`/${workspaceId}/support`}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {ticket.ticketNumber}
          </span>
          <Badge variant={STATUS_COLORS[ticket.status] ?? "secondary"}>
            {ticket.status.replace("_", " ")}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {ticket.category}
          </span>
        </div>
      </div>

      <div>
        <h1 className="text-xl font-semibold">{ticket.subject}</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Opened {new Date(ticket.createdAt).toLocaleDateString()}
          {ticket.closedAt &&
            ` · Closed ${new Date(ticket.closedAt).toLocaleDateString()}`}
        </p>
      </div>

      {/* Message thread */}
      <div className="space-y-3">
        {messages.map((msg) => (
          <div
            className={cn(
              "rounded-lg border p-4",
              msg.isAdmin
                ? "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800 ml-6"
                : "bg-muted/30 mr-6"
            )}
            key={msg.id}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium">
                {msg.isAdmin ? "Support Team" : "You"}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(msg.createdAt).toLocaleString()}
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
          </div>
        ))}
        {messages.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-6">
            No messages yet
          </p>
        )}
      </div>

      {/* Reply form */}
      <form className="border rounded-lg p-4 space-y-3" onSubmit={handleReply}>
        <Textarea
          maxLength={5000}
          onChange={(e) => setReply(e.target.value)}
          placeholder={
            ticket.status === "CLOSED"
              ? "Reply to reopen this ticket…"
              : "Write a reply…"
          }
          rows={4}
          value={reply}
        />
        <p className="text-xs text-muted-foreground text-right">
          {reply.length}/5000
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex items-center justify-between">
          {ticket.status !== "CLOSED" && (
            <Button
              className="text-muted-foreground"
              disabled={closing}
              onClick={handleClose}
              size="sm"
              type="button"
              variant="ghost"
            >
              {closing ? "Closing…" : "Close Ticket"}
            </Button>
          )}
          <div className="ml-auto">
            <Button disabled={!reply.trim() || sending} type="submit">
              {sending
                ? "Sending…"
                : ticket.status === "CLOSED"
                  ? "Reply & Reopen"
                  : "Reply"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
