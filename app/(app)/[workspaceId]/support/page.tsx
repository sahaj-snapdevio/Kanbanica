"use client";

import { use, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const STATUS_COLORS: Record<string, "default" | "secondary" | "outline"> = {
  OPEN: "default",
  IN_PROGRESS: "secondary",
  CLOSED: "outline",
};

const STATUS_TABS = [
  { key: "", label: "All" },
  { key: "OPEN", label: "Open" },
  { key: "IN_PROGRESS", label: "In Progress" },
  { key: "CLOSED", label: "Closed" },
];

const CATEGORIES = ["GENERAL", "TASKS", "BILLING", "TECHNICAL", "OTHER"];

export default function SupportPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = use(params);
  const [status, setStatus] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("GENERAL");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const params2 = new URLSearchParams();
  if (status) params2.set("status", status);
  const { data, isLoading, mutate } = useSWR(`/api/support/tickets?${params2}`, fetcher);
  const tickets: any[] = data?.tickets ?? [];
  const total: number = data?.total ?? 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body, category }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to submit ticket");
        return;
      }
      setShowNew(false);
      setSubject("");
      setBody("");
      setCategory("GENERAL");
      await mutate();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Support</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Submit a request or view your existing tickets</p>
        </div>
        <Button onClick={() => setShowNew(true)}>New Ticket</Button>
      </div>

      {/* Status filter */}
      <div className="flex gap-1 border rounded-md p-1 w-fit">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatus(tab.key)}
            className={cn(
              "px-3 py-1 text-sm rounded transition-colors",
              status === tab.key ? "bg-foreground text-background" : "hover:bg-muted",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Ticket list */}
      <div className="rounded-lg border overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
        ) : tickets.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {status ? "No tickets with that status." : "No support tickets yet. Submit one above."}
          </div>
        ) : (
          <div className="divide-y">
            {tickets.map((t) => (
              <Link
                key={t.id}
                href={`/${workspaceId}/support/${t.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{t.ticketNumber}</span>
                    <Badge variant={STATUS_COLORS[t.status] ?? "secondary"} className="text-xs">
                      {t.status.replace("_", " ")}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{t.category}</span>
                  </div>
                  <p className="text-sm font-medium mt-0.5 truncate">{t.subject}</p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0 ml-4">
                  {new Date(t.updatedAt).toLocaleDateString()}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* New ticket dialog */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Support Ticket</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Briefly describe your issue"
                minLength={5}
                maxLength={200}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="body">Description</Label>
              <Textarea
                id="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Describe the issue in detail (20–5000 characters)"
                rows={5}
                minLength={20}
                maxLength={5000}
                required
              />
              <p className="text-xs text-muted-foreground text-right">{body.length}/5000</p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowNew(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit Ticket"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
