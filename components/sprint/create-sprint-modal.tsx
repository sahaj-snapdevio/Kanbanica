"use client";

import { useState, useEffect } from "react";
import { CalendarBlankIcon, LightningIcon } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { createSprint } from "@/app/actions/sprint";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CreateSprintModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  spaceId: string;
  listId: string;
  onCreated: () => void;
}

type DurationWeeks = 1 | 2 | 3 | 4;
type IncompleteStrategy = "move_to_backlog" | "move_to_next_sprint" | "leave_as_is";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addWeeks(dateStr: string, weeks: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

function formatDisplayDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CreateSprintModal({
  open,
  onOpenChange,
  workspaceId,
  spaceId,
  listId,
  onCreated,
}: CreateSprintModalProps) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState("");
  const [durationWeeks, setDurationWeeks] = useState<DurationWeeks>(2);
  const [autoCreateNext, setAutoCreateNext] = useState(false);
  const [autoCloseOnNext, setAutoCloseOnNext] = useState(false);
  const [incompleteStrategy, setIncompleteStrategy] =
    useState<IncompleteStrategy>("move_to_backlog");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endDate = startDate ? addWeeks(startDate, durationWeeks) : "";

  // Reset on open
  useEffect(() => {
    if (open) {
      setName("");
      setGoal("");
      setStartDate("");
      setDurationWeeks(2);
      setAutoCreateNext(false);
      setAutoCloseOnNext(false);
      setIncompleteStrategy("move_to_backlog");
      setError(null);
    }
  }, [open]);

  function handleAutoCreateChange(checked: boolean) {
    setAutoCreateNext(checked);
    if (!checked) setAutoCloseOnNext(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim()) {
      setError("Sprint name is required.");
      return;
    }
    if (!startDate) {
      setError("Start date is required.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await createSprint(workspaceId, spaceId, listId, {
        name: name.trim(),
        goal: goal.trim() || undefined,
        startDate: new Date(startDate + "T00:00:00"),
        durationWeeks,
        autoCreateNext,
        autoCloseOnNext,
        autoIncompleteStrategy: incompleteStrategy,
      });

      if ("error" in result) {
        setError(result.error);
        return;
      }

      onCreated();
      onOpenChange(false);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-130">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LightningIcon className="size-4 text-primary" weight="fill" />
            Create Sprint
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 py-1">
          {/* Sprint Name */}
          <div className="space-y-1.5">
            <Label htmlFor="sprint-name">
              Sprint Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="sprint-name"
              placeholder="e.g. Sprint 1, Q3 Week 2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoFocus
            />
          </div>

          {/* Goal */}
          <div className="space-y-1.5">
            <Label htmlFor="sprint-goal">
              Goal{" "}
              <span className="text-xs font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Textarea
              id="sprint-goal"
              placeholder="What does this sprint aim to achieve?"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              maxLength={200}
              rows={2}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground text-right">
              {goal.length}/200
            </p>
          </div>

          {/* Start Date + Duration */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="sprint-start">
                Start Date <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <CalendarBlankIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  id="sprint-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sprint-duration">Duration</Label>
              <Select
                value={String(durationWeeks)}
                onValueChange={(v) =>
                  setDurationWeeks(Number(v) as DurationWeeks)
                }
              >
                <SelectTrigger id="sprint-duration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 week</SelectItem>
                  <SelectItem value="2">2 weeks</SelectItem>
                  <SelectItem value="3">3 weeks</SelectItem>
                  <SelectItem value="4">4 weeks</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* End Date Preview */}
          {endDate && (
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm flex items-center justify-between">
              <span className="text-muted-foreground">End date</span>
              <span className="font-medium">{formatDisplayDate(endDate)}</span>
            </div>
          )}

          <div className="h-px bg-border" />

          {/* Auto-create next sprint */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Auto-create next sprint</p>
                <p className="text-xs text-muted-foreground">
                  Automatically create the next sprint when this one ends
                </p>
              </div>
              <Switch
                checked={autoCreateNext}
                onCheckedChange={handleAutoCreateChange}
              />
            </div>

            {autoCreateNext && (
              <div className="ml-4 space-y-3 border-l-2 border-border pl-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">
                      Auto-close when next sprint is created
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Automatically close this sprint when the next one is
                      auto-created
                    </p>
                  </div>
                  <Switch
                    checked={autoCloseOnNext}
                    onCheckedChange={setAutoCloseOnNext}
                  />
                </div>

                {autoCloseOnNext && (
                  <div className="space-y-1.5">
                    <Label htmlFor="incomplete-strategy">
                      Incomplete task strategy
                    </Label>
                    <Select
                      value={incompleteStrategy}
                      onValueChange={(v) =>
                        setIncompleteStrategy(v as IncompleteStrategy)
                      }
                    >
                      <SelectTrigger id="incomplete-strategy">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="move_to_backlog">
                          Move to Backlog
                        </SelectItem>
                        <SelectItem value="move_to_next_sprint">
                          Move to Next Sprint
                        </SelectItem>
                        <SelectItem value="leave_as_is">Leave as-is</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      What happens to incomplete tasks when the sprint is
                      auto-closed
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating…" : "Create Sprint"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
