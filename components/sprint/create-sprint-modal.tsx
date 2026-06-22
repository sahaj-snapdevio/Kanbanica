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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ClickUpCalendar } from "@/components/ui/clickup-calendar";
import { createSprint } from "@/app/actions/sprint";
import { format } from "date-fns";

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

function addWeeks(date: Date, weeks: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + weeks * 7);
  return d;
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
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [startDateOpen, setStartDateOpen] = useState(false);
  const [durationWeeks, setDurationWeeks] = useState<DurationWeeks>(2);
  const [autoCreateNext, setAutoCreateNext] = useState(false);
  const [autoCloseOnNext, setAutoCloseOnNext] = useState(false);
  const [incompleteStrategy, setIncompleteStrategy] =
    useState<IncompleteStrategy>("move_to_backlog");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endDate = startDate ? addWeeks(startDate, durationWeeks) : null;

  // Reset on open
  useEffect(() => {
    if (open) {
      setName("");
      setGoal("");
      setStartDate(null);
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
        startDate: startDate!,
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
              <Label>
                Start Date <span className="text-destructive">*</span>
              </Label>
              <Popover open={startDateOpen} onOpenChange={setStartDateOpen}>
                <PopoverTrigger asChild>
                  <button className="flex h-10 w-full items-center gap-2 border border-input px-3 text-sm transition-colors hover:bg-accent">
                    <CalendarBlankIcon className="size-3.5 text-muted-foreground shrink-0" />
                    <span className={startDate ? "text-foreground" : "text-muted-foreground"}>
                      {startDate ? format(startDate, "MMM d, yyyy") : "Pick a date"}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <ClickUpCalendar
                    selectedDate={startDate}
                    onSelect={(date) => { setStartDate(date); setStartDateOpen(false); }}
                    onClose={() => setStartDateOpen(false)}
                  />
                </PopoverContent>
              </Popover>
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
              <span className="font-medium">{format(endDate, "MMM d, yyyy")}</span>
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
