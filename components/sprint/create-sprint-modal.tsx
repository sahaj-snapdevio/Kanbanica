"use client";

import { CalendarBlankIcon, LightningIcon } from "@phosphor-icons/react";
import { format } from "date-fns";
import { useEffect, useState } from "react";
import { createSprint } from "@/app/actions/sprint";
import { Button } from "@/components/ui/button";
import { ClickUpCalendar } from "@/components/ui/clickup-calendar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CreateSprintModalProps {
  onCreated: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  spaceId: string;
  workspaceId: string;
}

type DurationWeeks = 1 | 2 | 3 | 4;
type IncompleteStrategy =
  | "move_to_backlog"
  | "move_to_next_sprint"
  | "leave_as_is";

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
    if (!checked) {
      setAutoCloseOnNext(false);
    }
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
      const result = await createSprint(workspaceId, spaceId, {
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
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-130">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LightningIcon className="size-4 text-primary" weight="fill" />
            Create Sprint
          </DialogTitle>
        </DialogHeader>

        <form className="space-y-5 py-1" onSubmit={handleSubmit}>
          {/* Sprint Name */}
          <div className="space-y-1.5">
            <Label htmlFor="sprint-name">
              Sprint Name <span className="text-destructive">*</span>
            </Label>
            <Input
              autoFocus
              id="sprint-name"
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sprint 1, Q3 Week 2"
              value={name}
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
              className="resize-none"
              id="sprint-goal"
              maxLength={200}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="What does this sprint aim to achieve?"
              rows={2}
              value={goal}
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
              <Popover onOpenChange={setStartDateOpen} open={startDateOpen}>
                <PopoverTrigger asChild>
                  <button className="flex h-10 w-full items-center gap-2 border border-input px-3 text-sm transition-colors hover:bg-accent">
                    <CalendarBlankIcon className="size-3.5 text-muted-foreground shrink-0" />
                    <span
                      className={
                        startDate ? "text-foreground" : "text-muted-foreground"
                      }
                    >
                      {startDate
                        ? format(startDate, "MMM d, yyyy")
                        : "Pick a date"}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <ClickUpCalendar
                    onClose={() => setStartDateOpen(false)}
                    onSelect={(date) => {
                      setStartDate(date);
                      setStartDateOpen(false);
                    }}
                    selectedDate={startDate}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sprint-duration">Duration</Label>
              <Select
                onValueChange={(v) =>
                  setDurationWeeks(Number(v) as DurationWeeks)
                }
                value={String(durationWeeks)}
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
              <span className="font-medium">
                {format(endDate, "MMM d, yyyy")}
              </span>
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
                      onValueChange={(v) =>
                        setIncompleteStrategy(v as IncompleteStrategy)
                      }
                      value={incompleteStrategy}
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
              disabled={loading}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={loading} type="submit">
              {loading ? "Creating…" : "Create Sprint"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
