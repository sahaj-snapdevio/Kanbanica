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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { createSprint, getCreateSprintDefaults } from "@/app/actions/sprint";
import { format } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CreateSprintModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  spaceId: string;
  onCreated: () => void;
  onOpenSettings?: () => void;
}

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
  onOpenSettings,
}: CreateSprintModalProps) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [startDateOpen, setStartDateOpen] = useState(false);
  const [durationWeeks, setDurationWeeks] = useState(2);
  const [sprintStartDay, setSprintStartDay] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endDate = startDate ? addWeeks(startDate, durationWeeks) : null;

  // Load smart defaults when opened
  useEffect(() => {
    if (!open) return;
    setName("");
    setGoal("");
    setStartDate(null);
    setDurationWeeks(2);
    setSprintStartDay(null);
    setError(null);

    getCreateSprintDefaults(workspaceId, spaceId).then((result) => {
      if ("error" in result) return;
      setName(result.suggestedName);
      if (result.suggestedStartDate) setStartDate(result.suggestedStartDate);
      setDurationWeeks(Math.min(4, Math.max(1, result.durationWeeks)));
      setSprintStartDay(result.sprintStartDay);
    });
  }, [open, workspaceId, spaceId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim()) { setError("Sprint name is required."); return; }
    if (!startDate) { setError("Start date is required."); return; }

    setLoading(true);
    setError(null);

    try {
      const result = await createSprint(workspaceId, spaceId, {
        name: name.trim(),
        goal: goal.trim() || undefined,
        startDate,
        durationWeeks,
      });

      if ("error" in result) { setError(result.error); return; }

      onCreated();
      onOpenChange(false);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
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
              <span className="text-xs font-normal text-muted-foreground">(optional)</span>
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
            <p className="text-xs text-muted-foreground text-right">{goal.length}/200</p>
          </div>

          {/* Start Date + End Date */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>
                Start Date <span className="text-destructive">*</span>
              </Label>
              <Popover open={startDateOpen} onOpenChange={setStartDateOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex h-10 w-full items-center gap-2 rounded-md border border-input px-3 text-sm transition-colors hover:bg-accent"
                  >
                    <CalendarBlankIcon className="size-3.5 text-muted-foreground shrink-0" />
                    <span className={startDate ? "text-foreground" : "text-muted-foreground"}>
                      {startDate ? format(startDate, "MMM d, yyyy") : "Pick a date"}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate ?? undefined}
                    onSelect={(date) => { setStartDate(date ?? null); setStartDateOpen(false); }}
                    disabled={sprintStartDay !== null ? (d) => d.getDay() !== sprintStartDay : undefined}

                  />
                </PopoverContent>
              </Popover>
              {sprintStartDay !== null && (
                <p className="text-xs text-muted-foreground">
                  Starts on {DAY_NAMES[sprintStartDay]}s
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>End Date</Label>
              <div className="flex h-10 w-full items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-sm">
                <CalendarBlankIcon className="size-3.5 text-muted-foreground shrink-0" />
                <span className={endDate ? "text-foreground" : "text-muted-foreground"}>
                  {endDate ? format(endDate, "MMM d, yyyy") : `${durationWeeks}w from start`}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {durationWeeks} {durationWeeks === 1 ? "week" : "weeks"} duration
              </p>
            </div>
          </div>

          {/* Settings hint */}
          <p className="text-xs text-muted-foreground">
            Duration and start day are set in{" "}
            {onOpenSettings ? (
              <button
                type="button"
                onClick={() => { onOpenChange(false); onOpenSettings(); }}
                className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
              >
                Sprint Settings
              </button>
            ) : (
              <span className="text-foreground font-medium">Sprint Settings</span>
            )}
            .
          </p>

          {/* Error */}
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
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
